// Клиент для MAX Gateway Admin API.
// Ключи читаются из зашифрованного хранилища secrets (не process.env).
import { getSecret } from "./secret-resolver";

/** Thrown when the gateway responds 404 with code=PHONE_NOT_REGISTERED */
export class GatewayPhoneNotRegisteredError extends Error {
  constructor(phone: string) {
    super(`Phone number ${phone} is not registered in MAX`);
    this.name = "GatewayPhoneNotRegisteredError";
  }
}

export interface GatewayStats {
  totals: {
    instances: number;
    authenticated: number;
    connected: number;
    awaitingQr: number;
    withTenant: number;
    noTenant: number;
  };
  byTenant: Array<{
    tenantId: string;
    instances: number;
    authenticated: number;
    connected: number;
    awaitingQr: number;
  }>;
}

export interface GatewayInstance {
  instanceId: string;
  tenantId?: string;
  connected: boolean;
  authenticated: boolean;
  userId?: number;
  displayName?: string;
  phone?: string;
  webhookUrl?: string;
  awaitingQr: boolean;
  createdAt?: number;
  lastLogin?: number;
  chatsCount?: number;
}

export interface GatewayProxy {
  id: string;
  url: string;
  label?: string;
  active: boolean;
  addedAt: number;
  instanceCount: number;
}

function fetchWithTimeout(
  url: string,
  options: RequestInit = {},
  timeoutMs = 15000
): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  return fetch(url, { ...options, signal: controller.signal }).finally(() =>
    clearTimeout(timer)
  );
}

export class MaxGatewayClient {
  private async resolveBaseUrl(): Promise<string> {
    const val = await getSecret({ scope: "global", keyName: "MAX_GATEWAY_URL" });
    return (val ?? "").replace(/\/$/, "");
  }

  private async resolveAdminKey(): Promise<string> {
    return (await getSecret({ scope: "global", keyName: "MAX_GATEWAY_ADMIN_KEY" })) ?? "";
  }

  static async isConfigured(): Promise<boolean> {
    const url = await getSecret({ scope: "global", keyName: "MAX_GATEWAY_URL" });
    const key = await getSecret({ scope: "global", keyName: "MAX_GATEWAY_ADMIN_KEY" });
    return !!(url && key);
  }

  private async request<T>(
    method: string,
    path: string,
    body?: unknown,
    timeoutMs = 15000
  ): Promise<T> {
    const baseUrl = await this.resolveBaseUrl();
    const adminKey = await this.resolveAdminKey();
    const url = `${baseUrl}${path}`;
    const headers: Record<string, string> = { Authorization: `Bearer ${adminKey}` };
    let fetchBody: BodyInit | undefined;

    if (body !== undefined) {
      headers["Content-Type"] = "application/json";
      fetchBody = JSON.stringify(body);
    }

    let res: Response;
    try {
      res = await fetchWithTimeout(url, { method, headers, body: fetchBody }, timeoutMs);
    } catch (err: any) {
      if (err.name === "AbortError") {
        throw new Error(`MAX Gateway request timed out after ${timeoutMs}ms: ${method} ${path}`);
      }
      throw err;
    }

    if (!res.ok) {
      const errBody = await res.text().catch(() => "");
      // 404 with PHONE_NOT_REGISTERED is a known business error, not a crash
      if (res.status === 404) {
        let parsed: Record<string, unknown> = {};
        try { parsed = JSON.parse(errBody); } catch { /* ignore */ }
        if (parsed.code === "PHONE_NOT_REGISTERED") {
          // Extract the phone from the path query string if present
          const phoneMatch = path.match(/[?&]phone=([^&]+)/);
          throw new GatewayPhoneNotRegisteredError(phoneMatch ? decodeURIComponent(phoneMatch[1]) : "unknown");
        }
      }
      throw new Error(
        `MAX Gateway ${method} ${path} failed: ${res.status} ${res.statusText}${errBody ? ` | ${errBody}` : ""}`
      );
    }

    return res.json() as Promise<T>;
  }

  // ── Instance Management ───────────────────────────────────────────────────

  async createInstance(
    instanceId: string,
    tenantId: string,
    webhookUrl: string
  ): Promise<{ apiToken: string | null }> {
    const data = await this.request<{
      ok: boolean;
      status: { instanceId: string; connected: boolean; authenticated: boolean; awaitingQr: boolean; apiToken?: string };
    }>("POST", "/instances", { instanceId, tenantId, webhookUrl });

    // apiToken may be absent in POST response — fall back to GET /instances/:id
    if (data.status.apiToken) {
      return { apiToken: data.status.apiToken };
    }

    const status = await this.request<{
      instanceId: string;
      connected: boolean;
      authenticated: boolean;
      awaitingQr: boolean;
      apiToken?: string;
    }>("GET", `/instances/${instanceId}`);

    return { apiToken: status.apiToken ?? null };
  }

  async deleteInstance(instanceId: string): Promise<void> {
    await this.request<{ ok: boolean }>("DELETE", `/instances/${instanceId}`);
  }

  async getInstanceStatus(instanceId: string): Promise<{
    connected: boolean;
    authenticated: boolean;
    awaitingQr: boolean;
    userId?: number;
    displayName?: string;
    phone?: string;
  }> {
    return this.request<{
      connected: boolean;
      authenticated: boolean;
      awaitingQr: boolean;
      userId?: number;
      displayName?: string;
      phone?: string;
    }>("GET", `/instances/${instanceId}`);
  }

  /**
   * Check whether a phone number is registered in MAX.
   * Returns the MAX userId (usable as chatId) and display name when found.
   * Pass digits-only phone, e.g. "79991234567".
   */
  async checkPhone(
    instanceId: string,
    phone: string,
  ): Promise<{ registered: true; userId: number; name: string } | { registered: false }> {
    const digits = phone.replace(/\D/g, "");
    return this.request<{ registered: true; userId: number; name: string } | { registered: false }>(
      "GET",
      `/instances/${instanceId}/check-phone?phone=${encodeURIComponent(digits)}`,
    );
  }

  async setWebhook(instanceId: string, url: string): Promise<void> {
    await this.request<{ ok: boolean }>("POST", `/instances/${instanceId}/webhook`, { url });
  }

  /** Start a QR auth session for the instance. */
  async startQrSession(instanceId: string): Promise<{ qrLink?: string; expiresAt?: number }> {
    return this.request<{ ok: boolean; qrLink?: string; expiresAt?: number }>(
      "POST",
      `/instances/${instanceId}/qr`
    );
  }

  /**
   * Fetch the current QR PNG image for an instance and return it as a base64 string.
   * The endpoint is public (no auth), so we just proxy it.
   * Returns null if no active QR session.
   */
  async getQrImageBase64(instanceId: string): Promise<string | null> {
    const baseUrl = await this.resolveBaseUrl();
    const url = `${baseUrl}/instances/${instanceId}/qr.png`;
    let res: Response;
    try {
      res = await fetchWithTimeout(url, {}, 10000);
    } catch (err: any) {
      if (err.name === "AbortError") return null;
      throw err;
    }
    if (res.status === 404) return null;
    if (!res.ok) return null;
    const buf = Buffer.from(await res.arrayBuffer());
    return buf.toString("base64");
  }

  // ── Messaging ─────────────────────────────────────────────────────────────

  async sendMessage(instanceId: string, chatId: string | number, text: string): Promise<{ messageId?: string }> {
    const data = await this.request<{ ok: boolean; message?: { id?: string } }>(
      "POST",
      `/instances/${instanceId}/send`,
      { chatId: typeof chatId === "string" ? Number(chatId) || chatId : chatId, text }
    );
    return { messageId: data.message?.id };
  }

  async sendFile(
    instanceId: string,
    chatId: string | number,
    fileBase64: string,
    fileName: string,
    mimeType: string,
  ): Promise<{ messageId?: string }> {
    const numericChatId = typeof chatId === "string" ? Number(chatId) || chatId : chatId;
    const isPhoto = mimeType.startsWith("image/");

    let data: { ok: boolean; message?: { id?: string } };
    if (isPhoto) {
      data = await this.request("POST", `/instances/${instanceId}/send-photo`, {
        chatId: numericChatId,
        photoBase64: fileBase64,
        mimeType,
      });
    } else {
      data = await this.request("POST", `/instances/${instanceId}/send-file`, {
        chatId: numericChatId,
        fileBase64,
        fileName,
        mimeType,
      });
    }
    return { messageId: data.message?.id };
  }

  // ── Stats & Monitoring ────────────────────────────────────────────────────

  async getStats(): Promise<GatewayStats> {
    return this.request<GatewayStats>("GET", "/admin/stats");
  }

  async getAllInstances(): Promise<GatewayInstance[]> {
    const data = await this.request<{ instances: GatewayInstance[] }>("GET", "/admin/instances");
    return data.instances;
  }

  async getTenantInstances(tenantId: string): Promise<GatewayInstance[]> {
    const data = await this.request<{ tenantId: string; instances: GatewayInstance[] }>(
      "GET",
      `/admin/tenants/${tenantId}/instances`
    );
    return data.instances;
  }

  // ── Proxy Pool ────────────────────────────────────────────────────────────

  async getProxies(): Promise<{ proxies: GatewayProxy[]; total: number; active: number }> {
    return this.request<{ proxies: GatewayProxy[]; total: number; active: number }>(
      "GET",
      "/admin/proxies"
    );
  }

  async addProxies(
    proxiesText: string,
    label?: string
  ): Promise<{ added: number; errors: string[] }> {
    const body: Record<string, string> = { proxies: proxiesText };
    if (label !== undefined) body.label = label;
    const data = await this.request<{ ok: boolean; added: number; errors: string[] }>(
      "POST",
      "/admin/proxies",
      body
    );
    return { added: data.added, errors: data.errors };
  }

  async uploadProxies(
    fileBuffer: Buffer,
    label?: string,
    replace?: boolean
  ): Promise<{ added: number; errors: string[]; total: number; active: number; replaced: boolean }> {
    const baseUrl = await this.resolveBaseUrl();
    const adminKey = await this.resolveAdminKey();
    const url = `${baseUrl}/admin/proxies/upload`;
    const form = new FormData();
    form.append("file", new Blob([fileBuffer], { type: "text/plain" }), "proxies.txt");
    if (label !== undefined) form.append("label", label);
    if (replace !== undefined) form.append("replace", String(replace));

    let res: Response;
    try {
      res = await fetchWithTimeout(
        url,
        { method: "POST", headers: { Authorization: `Bearer ${adminKey}` }, body: form },
        60000
      );
    } catch (err: any) {
      if (err.name === "AbortError") {
        throw new Error("MAX Gateway uploadProxies timed out after 60s");
      }
      throw err;
    }

    if (!res.ok) {
      const errBody = await res.text().catch(() => "");
      throw new Error(
        `MAX Gateway POST /admin/proxies/upload failed: ${res.status} ${res.statusText}${errBody ? ` | ${errBody}` : ""}`
      );
    }

    const data = await res.json() as {
      ok: boolean;
      added: number;
      errors: string[];
      total: number;
      active: number;
      replaced: boolean;
    };
    return { added: data.added, errors: data.errors, total: data.total, active: data.active, replaced: data.replaced };
  }

  async replaceProxies(
    proxiesText: string,
    label?: string
  ): Promise<{ added: number; errors: string[] }> {
    const body: Record<string, string> = { proxies: proxiesText };
    if (label !== undefined) body.label = label;
    const data = await this.request<{ ok: boolean; added: number; errors: string[] }>(
      "PUT",
      "/admin/proxies/replace",
      body
    );
    return { added: data.added, errors: data.errors };
  }

  async deleteProxy(proxyId: string): Promise<void> {
    await this.request<{ ok: boolean }>("DELETE", `/admin/proxies/${proxyId}`);
  }

  async toggleProxy(proxyId: string, active: boolean): Promise<void> {
    await this.request<{ ok: boolean }>("PATCH", `/admin/proxies/${proxyId}`, { active });
  }

  async clearProxies(): Promise<void> {
    await this.request<{ ok: boolean }>("DELETE", "/admin/proxies");
  }
}

export const maxGatewayClient = new MaxGatewayClient();
