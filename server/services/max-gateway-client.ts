// Клиент для MAX Gateway Admin API.
// Ключи читаются из зашифрованного хранилища secrets (не process.env).
import { getSecret } from "./secret-resolver";

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
  ): Promise<{ apiToken: string }> {
    const data = await this.request<{
      ok: boolean;
      status: { instanceId: string; connected: boolean; authenticated: boolean; awaitingQr: boolean; apiToken?: string };
    }>("POST", "/instances", { instanceId, tenantId, webhookUrl });

    if (!data.status.apiToken) {
      throw new Error(`MAX Gateway createInstance: apiToken missing in response for ${instanceId}`);
    }
    return { apiToken: data.status.apiToken };
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

  async setWebhook(instanceId: string, url: string): Promise<void> {
    await this.request<{ ok: boolean }>("POST", `/instances/${instanceId}/webhook`, { url });
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
