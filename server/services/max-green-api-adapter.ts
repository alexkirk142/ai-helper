const BASE_URL = (idInstance: string) =>
  `https://api.green-api.com/waInstance${idInstance}`;

export class MaxGreenApiAdapter {
  async getState(idInstance: string, token: string): Promise<string> {
    const url = `${BASE_URL(idInstance)}/getStateInstance/${token}`;
    const res = await fetch(url);
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
    const res = await fetch(url);
    if (!res.ok) {
      throw new Error(`GREEN-API getAccountInfo failed: ${res.status} ${res.statusText}`);
    }
    return res.json();
  }

  async setWebhook(idInstance: string, token: string, webhookUrl: string): Promise<void> {
    const url = `${BASE_URL(idInstance)}/setSettings/${token}`;
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        webhookUrl,
        incomingWebhook: "yes",
        outgoingWebhook: "no",
      }),
    });
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
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chatId, message: text }),
    });
    if (!res.ok) {
      throw new Error(`GREEN-API sendMessage failed: ${res.status} ${res.statusText}`);
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
    const form = new FormData();
    form.append("chatId", chatId);
    form.append("file", new Blob([buffer], { type: mimeType }), fileName);
    if (caption) form.append("caption", caption);

    const res = await fetch(url, { method: "POST", body: form });
    if (!res.ok) {
      throw new Error(`GREEN-API sendFile failed: ${res.status} ${res.statusText}`);
    }
    return res.json();
  }
}

export const maxGreenApiAdapter = new MaxGreenApiAdapter();
