import { Router, type Request, type Response } from "express";
import { requireAuth } from "../../middleware/rbac";

const router = Router();

// Telegram file proxy (Bot API)
router.get("/api/telegram/file/:fileId", requireAuth, async (req: Request, res: Response) => {
  try {
    const { fileId } = req.params;
    if (!fileId || typeof fileId !== "string") {
      return res.status(400).json({ error: "Invalid file ID" });
    }

    const token = process.env.TELEGRAM_BOT_TOKEN;
    if (!token) {
      return res.status(503).json({ error: "Telegram Bot API not configured" });
    }

    const getFileResp = await fetch(
      `https://api.telegram.org/bot${token}/getFile?file_id=${encodeURIComponent(fileId)}`,
    );
    if (!getFileResp.ok) {
      return res.status(502).json({ error: "Failed to resolve file from Telegram" });
    }
    const getFileJson = (await getFileResp.json()) as { ok: boolean; result?: { file_path: string } };
    if (!getFileJson.ok || !getFileJson.result?.file_path) {
      return res.status(404).json({ error: "File not found on Telegram" });
    }

    const fileUrl = `https://api.telegram.org/file/bot${token}/${getFileJson.result.file_path}`;
    const fileResp = await fetch(fileUrl);
    if (!fileResp.ok || !fileResp.body) {
      return res.status(502).json({ error: "Failed to fetch file content" });
    }

    const contentType = fileResp.headers.get("content-type") || "application/octet-stream";
    const contentLength = fileResp.headers.get("content-length");
    res.setHeader("Content-Type", contentType);
    res.setHeader("Cache-Control", "private, max-age=3600");
    if (contentLength) res.setHeader("Content-Length", contentLength);

    const { Readable } = await import("stream");
    const nodeStream = Readable.fromWeb(fileResp.body as any);
    nodeStream.pipe(res);
  } catch (error: any) {
    console.error("[TelegramFileProxy] Error:", error.message);
    res.status(500).json({ error: "Failed to proxy file" });
  }
});

export default router;
