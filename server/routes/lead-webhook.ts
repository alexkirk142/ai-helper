/**
 * Universal lead webhook — accepts any JSON form submission from any site.
 *
 * POST /webhooks/lead/:tenantId
 *
 * The payload is flexible. The handler looks for contact fields under common
 * names and puts everything else into rawFields.
 *
 * Minimal required field: phone OR telegram username.
 *
 * Example payloads:
 *
 * Tilda / custom form:
 *   { "Phone": "79991234567", "Name": "Иван", "Comment": "Нужна консультация" }
 *
 * Flat JSON:
 *   { "phone": "+7 999 123-45-67", "name": "Иван", "telegram": "@ivan", "city": "Москва" }
 *
 * Nested fields object:
 *   { "phone": "...", "fields": { "Вопрос 1": "Ответ 1", "Город": "Казань" } }
 */

import { Router } from "express";
import { enqueueMarquizLead } from "../services/marquiz-lead-queue";
import type { MarquizLeadJobData } from "../services/marquiz-lead-queue";
import { processMarquizLeadDirect } from "../workers/marquiz-lead.worker";
import { storage } from "../storage";

const router = Router({ mergeParams: true });

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function normalizePhone(raw: string): string {
  const digits = raw.replace(/\D/g, "");
  if (digits.startsWith("8") && digits.length === 11) {
    return "7" + digits.slice(1);
  }
  return digits;
}

const looksLikePhone = (s: string) => /^[+\d][\d\s\-()]{6,}$/.test(s.trim());

/**
 * Extract a string value from an object by trying multiple key names
 * (case-insensitive, trimmed).
 */
function pick(obj: Record<string, unknown>, ...keys: string[]): string {
  for (const key of keys) {
    for (const [k, v] of Object.entries(obj)) {
      if (k.toLowerCase().trim() === key.toLowerCase() && typeof v === "string" && v.trim()) {
        return v.trim();
      }
    }
  }
  return "";
}

/** Flatten a potentially nested object into a flat string map, skipping nulls/objects. */
function flattenFields(obj: Record<string, unknown>): Record<string, string> {
  const result: Record<string, string> = {};
  for (const [key, value] of Object.entries(obj)) {
    if (value === null || value === undefined) continue;
    if (typeof value === "object") {
      // One level of nesting — e.g. { fields: { Q1: "A1" } }
      for (const [nestedKey, nestedVal] of Object.entries(value as Record<string, unknown>)) {
        if (typeof nestedVal === "string" && nestedVal.trim()) {
          result[nestedKey.trim()] = nestedVal.trim();
        } else if (nestedVal !== null && nestedVal !== undefined && typeof nestedVal !== "object") {
          result[nestedKey.trim()] = String(nestedVal).trim();
        }
      }
    } else if (typeof value === "string" && value.trim()) {
      result[key.trim()] = value.trim();
    } else if (typeof value === "number" || typeof value === "boolean") {
      result[key.trim()] = String(value);
    }
  }
  return result;
}

// Contact field synonyms
const PHONE_KEYS    = ["phone", "телефон", "tel", "мобильный", "номер", "contact_phone", "Phone", "phonenumber"];
const NAME_KEYS     = ["name", "имя", "фио", "fullname", "full_name", "clientname", "client_name", "Name", "ваше имя"];
const TELEGRAM_KEYS = ["telegram", "телеграм", "tg", "username", "юзернейм", "telegram_username"];
const CITY_KEYS     = ["city", "город", "location"];
const EMAIL_KEYS    = ["email", "e-mail", "почта", "емейл"];
const SOURCE_KEYS   = ["source", "источник", "utm_source", "site", "form_name", "quiz_name", "quizname"];

/** Resolve tenantId from URL param, validate it exists. */
async function resolveTenant(paramTenantId?: string): Promise<string | null> {
  if (!paramTenantId) {
    console.error("[LeadWebhook] No tenantId in URL");
    return null;
  }
  const tenant = await storage.getTenant(paramTenantId).catch(() => null);
  if (!tenant) {
    console.warn(`[LeadWebhook] Unknown tenantId: ${paramTenantId}`);
    return null;
  }
  return paramTenantId;
}

// ---------------------------------------------------------------------------
// Core handler
// ---------------------------------------------------------------------------

async function handleLeadWebhook(req: any, res: any, tenantId: string) {
  try {
    const body = req.body as Record<string, unknown>;
    console.log(`[LeadWebhook] tenant=${tenantId} payload:`, JSON.stringify(body));

    // ── Phone ────────────────────────────────────────────────────────────
    const rawPhone = pick(body, ...PHONE_KEYS);
    const normalizedPhone = normalizePhone(rawPhone);
    const hasPhone = rawPhone && normalizedPhone.length >= 10;

    // ── Telegram username ─────────────────────────────────────────────────
    const rawTelegram = pick(body, ...TELEGRAM_KEYS);
    const cleanedTg = rawTelegram.replace(/^@/, "").trim();
    const telegramUsername = (!cleanedTg || looksLikePhone(rawTelegram) || cleanedTg.length < 5)
      ? ""
      : cleanedTg;

    if (!hasPhone && !telegramUsername) {
      console.warn("[LeadWebhook] No valid phone or Telegram username — skipping lead");
      return;
    }

    // ── Contact fields ────────────────────────────────────────────────────
    const clientName  = pick(body, ...NAME_KEYS);
    const city        = pick(body, ...CITY_KEYS);
    const email       = pick(body, ...EMAIL_KEYS);
    const sourceName  = pick(body, ...SOURCE_KEYS) || "lead_webhook";
    const quizName    = pick(body, "quiz_name", "quizname", "form_name", "formname", "source", "название", "quiz") || "Заявка";

    // ── Preferred channel (optional) ─────────────────────────────────────
    const messengerRaw = (pick(body, "messenger", "channel", "preferred_channel") || "").toLowerCase();
    let preferredChannel: string | undefined;
    if (messengerRaw === "telegram" || messengerRaw === "tg") preferredChannel = "telegram";
    else if (messengerRaw === "max" || messengerRaw === "whatsapp") preferredChannel = messengerRaw;

    // ── rawFields: all fields except known contact/service ones ───────────
    const CONTACT_KEYS_SET = new Set([
      ...PHONE_KEYS.map(k => k.toLowerCase()),
      ...NAME_KEYS.map(k => k.toLowerCase()),
      ...TELEGRAM_KEYS.map(k => k.toLowerCase()),
      ...CITY_KEYS.map(k => k.toLowerCase()),
      ...EMAIL_KEYS.map(k => k.toLowerCase()),
      ...SOURCE_KEYS.map(k => k.toLowerCase()),
      "messenger", "channel", "preferred_channel",
    ]);

    const allFlat = flattenFields(body);
    const rawFields: Record<string, string> = {};
    for (const [key, value] of Object.entries(allFlat)) {
      if (!CONTACT_KEYS_SET.has(key.toLowerCase())) {
        rawFields[key] = value;
      }
    }
    // City goes into rawFields too if present, so it appears in the message summary
    if (city) rawFields["Город"] = city;
    if (email) rawFields["Email"] = email;

    // ── MAX phone: same as primary phone for generic leads ────────────────
    const maxPhoneRaw = rawPhone;

    const leadData: MarquizLeadJobData = {
      tenantId,
      quizName,
      phone: rawPhone,
      maxPhone: maxPhoneRaw,
      telegramUsername,
      preferredChannel,
      clientName,
      city,
      rawFields,
      source: sourceName,
    };

    console.log(
      `[LeadWebhook] Parsed lead: phone=${rawPhone}, name=${clientName}, source="${sourceName}", fields=${Object.keys(rawFields).length}`,
    );

    const queued = await enqueueMarquizLead(leadData);
    if (queued) {
      console.log(`[LeadWebhook] Lead enqueued, jobId=${queued.jobId}, tenant=${tenantId}`);
    } else {
      console.warn("[LeadWebhook] Queue unavailable — processing lead directly");
      await processMarquizLeadDirect(leadData);
    }
  } catch (err: any) {
    console.error("[LeadWebhook] Unhandled error:", err.message, err.stack);
  }
}

// ---------------------------------------------------------------------------
// Routes
// ---------------------------------------------------------------------------

router.post("/:tenantId", async (req, res) => {
  res.status(200).json({ ok: true });
  const tenantId = await resolveTenant(req.params.tenantId);
  if (!tenantId) return;
  await handleLeadWebhook(req, res, tenantId);
});

export default router;
