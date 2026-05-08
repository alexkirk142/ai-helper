import { Router } from "express";
import { enqueueMarquizLead } from "../services/marquiz-lead-queue";
import type { MarquizLeadJobData } from "../services/marquiz-lead-queue";
import { processMarquizLeadDirect } from "../workers/marquiz-lead.worker";
import { storage } from "../storage";

const router = Router({ mergeParams: true });

// Actual Marquiz webhook format (from https://help.marquiz.ru/article/518):
// {
//   contacts: { name, email, phone },
//   answers: [{ q: "question text", a: "answer text" }],
//   quiz: { id, name },
//   created: "ISO date",
//   extra: { utm, ... }
// }
interface MarquizContacts {
  name?: string;
  email?: string;
  phone?: string;
}

interface MarquizAnswer {
  q: string;
  a: string;
}

interface MarquizPayload {
  contacts?: MarquizContacts;
  answers?: MarquizAnswer[];
  quiz?: { id?: string; name?: string } | string;
  created?: string;
  extra?: Record<string, unknown>;
  // Legacy / alternative top-level fields
  phone?: string;
  name?: string;
  results?: Array<{ name: string; value: string }>;
  [key: string]: unknown;
}

function normalizePhone(raw: string): string {
  const digits = raw.replace(/\D/g, "");
  if (digits.startsWith("8") && digits.length === 11) {
    return "7" + digits.slice(1);
  }
  return digits;
}

/** Look for an answer whose question text contains any of the given keywords (case-insensitive) */
function findAnswer(answers: MarquizAnswer[], ...keywords: string[]): string {
  for (const keyword of keywords) {
    const found = answers.find((a) =>
      a.q.toLowerCase().includes(keyword.toLowerCase()),
    );
    if (found) return found.a;
  }
  return "";
}

/** Fuzzy field lookup in legacy results format */
function findField(fields: Record<string, string>, ...prefixes: string[]): string {
  for (const prefix of prefixes) {
    const found = Object.entries(fields).find(([k]) =>
      k.toLowerCase().startsWith(prefix.toLowerCase()),
    );
    if (found) return found[1];
  }
  return "";
}

/** Resolve tenantId: from URL param first, then legacy env var */
async function resolveTenantId(paramTenantId?: string): Promise<string | null> {
  if (paramTenantId) {
    const tenant = await storage.getTenant(paramTenantId).catch(() => null);
    if (!tenant) {
      console.warn(`[MarquizWebhook] Unknown tenantId in URL: ${paramTenantId}`);
      return null;
    }
    return paramTenantId;
  }
  const envTenantId = process.env.MARQUIZ_TENANT_ID ?? "";
  if (!envTenantId) {
    console.error("[MarquizWebhook] No tenantId in URL and MARQUIZ_TENANT_ID not set");
    return null;
  }
  return envTenantId;
}

async function handleWebhook(req: any, res: any, tenantId: string) {
  try {
    const body = req.body as MarquizPayload;
    console.log(`[MarquizWebhook] tenant=${tenantId} payload:`, JSON.stringify(body));

    // ── Phone ──────────────────────────────────────────────────────────────
    const rawPhone =
      body.contacts?.phone?.trim() ||
      (typeof body.phone === "string" ? body.phone.trim() : "") ||
      "";

    // ── Telegram username (needed before phone check) ───────────────────────
    // Marquiz sometimes puts the phone number into contacts.telegram when the
    // user picks MAX/Telegram as delivery channel — guard against that.
    const looksLikePhone = (s: string) => /^[+\d][\d\s\-()]{6,}$/.test(s.trim());

    const rawTelegramEarly =
      (body.contacts as any)?.telegram?.trim() ||
      findAnswer(body.answers ?? [], "telegram", "телеграм", "юзернейм", "username") ||
      "";
    const cleanedTg = rawTelegramEarly.replace(/^@/, "").trim();
    // Discard if it looks like a phone number or is too short to be a username (min 5 chars)
    const telegramUsernameEarly = (!cleanedTg || looksLikePhone(rawTelegramEarly) || cleanedTg.length < 5)
      ? ""
      : cleanedTg;

    const normalizedPhone = normalizePhone(rawPhone);
    const hasPhone = rawPhone && normalizedPhone.length >= 10;
    const hasTelegram = telegramUsernameEarly.length > 0;

    if (!hasPhone && !hasTelegram) {
      console.warn(
        "[MarquizWebhook] No valid phone or Telegram username found — skipping lead.",
        "contacts.phone=", body.contacts?.phone,
        "contacts.telegram=", (body.contacts as any)?.telegram,
      );
      return;
    }

    if (!hasPhone) {
      console.log(
        `[MarquizWebhook] No phone in payload — Telegram-only lead (@${telegramUsernameEarly}), will send via Telegram Personal`,
      );
    }

    // ── Name ───────────────────────────────────────────────────────────────
    const clientName =
      body.contacts?.name?.trim() ||
      (typeof body.name === "string" ? body.name.trim() : "") ||
      "";

    // ── Quiz name ──────────────────────────────────────────────────────────
    const quizName =
      typeof body.quiz === "object"
        ? (body.quiz?.name ?? "Квиз").trim()
        : typeof body.quiz === "string"
          ? body.quiz.trim()
          : "Квиз";

    // ── Answers ────────────────────────────────────────────────────────────
    // Support both formats: answers[] and legacy results[]
    const answers: MarquizAnswer[] = body.answers ?? [];

    // Also build legacy fields map from results[] if present
    const legacyFields: Record<string, string> = {};
    if (Array.isArray(body.results)) {
      for (const field of body.results) {
        if (field.name && field.value) {
          legacyFields[field.name.toLowerCase().trim()] = field.value.trim();
        }
      }
    }

    const gearboxType =
      findAnswer(answers, "тип коробки", "тип кпп", "коробка передач", "коробка") ||
      findField(legacyFields, "тип коробки", "тип кпп", "коробка");

    const engineType =
      findAnswer(answers, "тип двигателя", "вид двигателя", "двигатель") ||
      findField(legacyFields, "тип двигателя", "двигатель");

    const engineVolume =
      findAnswer(answers, "объем двигателя", "объём двигателя", "объем мотора", "объём") ||
      findField(legacyFields, "объем двигателя", "объём");

    const engineModel =
      findAnswer(answers, "модель двигателя", "маркировка двигателя", "модель мотора") ||
      findField(legacyFields, "модель двигателя");

    const carInfo =
      findAnswer(answers, "марка авто", "марка и год", "автомобиль", "марка машины", "авто") ||
      findField(legacyFields, "марка авто", "автомобиль", "авто");

    const vin =
      findAnswer(answers, "vin", "вин", "номер кузова") ||
      findField(legacyFields, "vin", "вин");

    const city =
      findAnswer(answers, "город", "ваш город") ||
      findField(legacyFields, "город");

    // ── Tires fields ───────────────────────────────────────────────────────
    const tireSeason =
      findAnswer(answers, "сезон", "комплект шин") ||
      findField(legacyFields, "сезон");

    const tireMethod =
      findAnswer(answers, "удобнее подобрать", "способ подбора", "как подобрать") ||
      findField(legacyFields, "удобнее подобрать");

    const tireWidth =
      findAnswer(answers, "ширина") ||
      findField(legacyFields, "ширина");

    const tireHeight =
      findAnswer(answers, "высота") ||
      findField(legacyFields, "высота");

    const tireDiameter =
      findAnswer(answers, "диаметр") ||
      findField(legacyFields, "диаметр");

    // MAX phone — dedicated quiz field named "max" or similar
    const maxPhoneRaw =
      findAnswer(answers, "max") ||
      findAnswer(answers, "номер max", "max номер", "номер в max", "ваш номер max") ||
      rawPhone;

    // Telegram username already resolved above (telegramUsernameEarly)
    const telegramUsername = telegramUsernameEarly;

    // ── Preferred channel (strict routing) ─────────────────────────────────
    // Marquiz sets extra.messenger to the channel the client chose in the quiz.
    // We normalise to "telegram" | "max" | undefined.
    const messengerRaw = (body.extra?.messenger as string | undefined)?.toLowerCase().trim() ?? "";
    // Also detect from contacts object: if only contacts.telegram is present → telegram
    const hasTelegramContact = !!(body.contacts as any)?.telegram && !body.contacts?.phone;
    const hasMaxContact = !!(body.contacts as any)?.max;

    let preferredChannel: string | undefined;
    if (messengerRaw === "telegram" || hasTelegramContact) {
      preferredChannel = "telegram";
    } else if (messengerRaw === "max" || hasMaxContact) {
      preferredChannel = "max";
    }

    console.log(`[MarquizWebhook] preferredChannel="${preferredChannel ?? "auto"}" (extra.messenger="${messengerRaw}")`);

    const leadData: MarquizLeadJobData = {
      tenantId,
      quizName,
      phone: rawPhone,
      maxPhone: maxPhoneRaw,
      telegramUsername,
      preferredChannel,
      gearboxType,
      engineType,
      engineVolume,
      engineModel,
      tireSeason,
      tireMethod,
      tireWidth,
      tireHeight,
      tireDiameter,
      carInfo,
      vin,
      city,
      clientName,
      rawFields: Object.fromEntries(
        answers.map((a) => [a.q.toLowerCase().slice(0, 60), a.a]),
      ),
    };

    console.log(
      `[MarquizWebhook] Parsed lead: phone=${rawPhone}, name=${clientName}, quiz="${quizName}", gearbox="${gearboxType}", engine="${engineType}", car="${carInfo}"`,
    );

    // Try BullMQ queue first; fall back to direct processing if Redis unavailable
    const queued = await enqueueMarquizLead(leadData);
    if (queued) {
      console.log(`[MarquizWebhook] Lead enqueued, jobId=${queued.jobId}, tenant=${tenantId}`);
    } else {
      console.warn("[MarquizWebhook] Queue unavailable — processing lead directly");
      await processMarquizLeadDirect(leadData);
    }
  } catch (err: any) {
    console.error("[MarquizWebhook] Unhandled error:", err.message, err.stack);
  }
}

// ── Per-tenant route: POST /webhooks/marquiz/:tenantId ────────────────────────
router.post("/:tenantId", async (req, res) => {
  res.status(200).json({ ok: true });
  const tenantId = await resolveTenantId(req.params.tenantId);
  if (!tenantId) return;
  await handleWebhook(req, res, tenantId);
});

// ── Legacy global route: POST /webhooks/marquiz (uses MARQUIZ_TENANT_ID env) ──
router.post("/", async (req, res) => {
  res.status(200).json({ ok: true });
  const tenantId = await resolveTenantId();
  if (!tenantId) return;
  await handleWebhook(req, res, tenantId);
});

export default router;
