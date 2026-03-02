// GREEN-API hosts instances on cluster-specific subdomains.
// The cluster prefix is the first 4 digits of idInstance (e.g. "3100" from "3100525112").
// Full URL pattern from the GREEN-API console: https://{cluster}.api.green-api.com
function getApiHost(idInstance: string): string {
  const cluster = idInstance.substring(0, 4);
  return `https://${cluster}.api.green-api.com`;
}

/**
 * GREEN-API MAX accepts exactly three chatId formats:
 *   1. "79991234567@c.us"  — phone number (10+ digits) + @c.us
 *   2. "41837581"          — MAX internal user_id (plain digits, NO suffix)
 *   3. "-1001234567890"    — group_id (negative number)
 *
 * Short numeric IDs (< 10 digits) are MAX internal user IDs, NOT phone numbers.
 * If they arrive with an @c.us suffix (legacy bad data), strip it so GREEN-API accepts them.
 */
function sanitizeMaxChatId(chatId: string): string {
  const match = chatId.match(/^(\d+)@c\.us$/);
  if (match && match[1].length < 10) {
    return match[1];
  }
  return chatId;
}

const BASE_URL = (idInstance: string) =>
  `${getApiHost(idInstance)}/v3/waInstance${idInstance}`;

function fetchWithTimeout(url: string, options: RequestInit = {}, timeoutMs = 20000): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  return fetch(url, { ...options, signal: controller.signal })
    .finally(() => clearTimeout(timer));
}

export class MaxGreenApiAdapter {
  async getState(idInstance: string, token: string): Promise<string> {
    const url = `${BASE_URL(idInstance)}/getStateInstance/${token}`;
    let res: Response;
    try {
      res = await fetchWithTimeout(url);
    } catch (err: any) {
      if (err.name === "AbortError") {
        throw new Error(`GREEN-API request timed out after 20s: ${url}`);
      }
      throw err;
    }
    if (!res.ok) {
      throw new Error(`GREEN-API getState failed: ${res.status} ${res.statusText}`);
    }
    const data = (await res.json()) as { stateInstance: string };
    return data.stateInstance;
  }

  async getAccountInfo(
    idInstance: string,
    token: string
  ): Promise<{ nameAccount?: string; wid?: string }> {
    const url = `${BASE_URL(idInstance)}/getAccountSettings/${token}`;
    let res: Response;
    try {
      res = await fetchWithTimeout(url);
    } catch (err: any) {
      if (err.name === "AbortError") {
        throw new Error(`GREEN-API request timed out after 20s: ${url}`);
      }
      throw err;
    }
    if (!res.ok) {
      throw new Error(`GREEN-API getAccountInfo failed: ${res.status} ${res.statusText}`);
    }
    return res.json();
  }

  async getQR(idInstance: string, token: string): Promise<{ type: string; message: string }> {
    const url = `${BASE_URL(idInstance)}/qr/${token}`;
    let res: Response;
    try {
      res = await fetchWithTimeout(url);
    } catch (err: any) {
      if (err.name === "AbortError") {
        throw new Error(`GREEN-API request timed out after 20s: ${url}`);
      }
      throw err;
    }
    if (!res.ok) {
      throw new Error(`GREEN-API getQR failed: ${res.status} ${res.statusText}`);
    }
    return res.json() as Promise<{ type: string; message: string }>;
  }

  async setWebhook(idInstance: string, token: string, webhookUrl: string): Promise<void> {
    const url = `${BASE_URL(idInstance)}/setSettings/${token}`;
    let res: Response;
    try {
      res = await fetchWithTimeout(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          webhookUrl,
          incomingWebhook: "yes",
          outgoingWebhook: "no",
          outgoingMessageWebhook: "no",
          outgoingAPIMessageWebhook: "yes",
          stateWebhook: "yes",
          deviceWebhook: "no",
          pollMessageWebhook: "no",
          editedMessageWebhook: "no",
          deletedMessageWebhook: "no",
        }),
      });
    } catch (err: any) {
      if (err.name === "AbortError") {
        throw new Error(`GREEN-API request timed out after 20s: ${url}`);
      }
      throw err;
    }
    if (!res.ok) {
      throw new Error(`GREEN-API setWebhook failed: ${res.status} ${res.statusText}`);
    }
  }

  async sendMessage(
    idInstance: string,
    token: string,
    chatId: string,
    text: string
  ): Promise<{ idMessage: string }> {
    const url = `${BASE_URL(idInstance)}/sendMessage/${token}`;
    const sanitizedChatId = sanitizeMaxChatId(chatId);
    if (sanitizedChatId !== chatId) {
      console.log(`[MaxGreenApi] chatId sanitized for send: "${chatId}" → "${sanitizedChatId}"`);
    }
    let res: Response;
    try {
      res = await fetchWithTimeout(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ chatId: sanitizedChatId, message: text }),
      });
    } catch (err: any) {
      if (err.name === "AbortError") {
        throw new Error(`GREEN-API request timed out after 20s: ${url}`);
      }
      throw err;
    }
    if (!res.ok) {
      const errBody = await res.text().catch(() => "");
      throw new Error(`GREEN-API sendMessage failed: ${res.status} ${res.statusText} | chatId=${sanitizedChatId} | body=${errBody}`);
    }
    return res.json();
  }

  async sendFile(
    idInstance: string,
    token: string,
    chatId: string,
    buffer: Buffer,
    mimeType: string,
    fileName: string,
    caption?: string
  ): Promise<{ idMessage: string }> {
    const url = `${BASE_URL(idInstance)}/sendFileByUpload/${token}`;
    const sanitizedChatId = sanitizeMaxChatId(chatId);
    const form = new FormData();
    form.append("chatId", sanitizedChatId);
    form.append("file", new Blob([buffer], { type: mimeType }), fileName);
    if (caption) form.append("caption", caption);

    let res: Response;
    try {
      res = await fetchWithTimeout(url, { method: "POST", body: form });
    } catch (err: any) {
      if (err.name === "AbortError") {
        throw new Error(`GREEN-API request timed out after 20s: ${url}`);
      }
      throw err;
    }
    if (!res.ok) {
      const errBody = await res.text().catch(() => "");
      throw new Error(`GREEN-API sendFile failed: ${res.status} ${res.statusText} | chatId=${sanitizedChatId} | body=${errBody}`);
    }
    return res.json();
  }
}

export const maxGreenApiAdapter = new MaxGreenApiAdapter();
