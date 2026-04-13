import { Router } from "express";
import { enqueueMarquizLead } from "../services/marquiz-lead-queue";
import type { MarquizLeadJobData } from "../services/marquiz-lead-queue";
import { processMarquizLeadDirect } from "../workers/marquiz-lead.worker";

const router = Router();

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

router.post("/", async (req, res) => {
  // Acknowledge immediately so Marquiz doesn't retry
  res.status(200).json({ ok: true });

  try {
    const body = req.body as MarquizPayload;
    console.log("[MarquizWebhook] Incoming payload:", JSON.stringify(body));

    // ── Phone ──────────────────────────────────────────────────────────────
    // Primary: contacts.phone (standard Marquiz format)
    // Fallback: top-level phone field (older/alternative format)
    const rawPhone =
      body.contacts?.phone?.trim() ||
      (typeof body.phone === "string" ? body.phone.trim() : "") ||
      "";

    const normalizedPhone = normalizePhone(rawPhone);
    if (!rawPhone || normalizedPhone.length < 10) {
      console.warn(
        "[MarquizWebhook] No valid phone found. contacts.phone=",
        body.contacts?.phone,
        "body.phone=",
        body.phone,
      );
      return;
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

    // MAX phone — dedicated quiz field named "max" or similar
    const maxPhoneRaw =
      findAnswer(answers, "max") ||
      findAnswer(answers, "номер max", "max номер", "номер в max", "ваш номер max") ||
      rawPhone;

    const leadData: MarquizLeadJobData = {
      quizName,
      phone: rawPhone,
      maxPhone: maxPhoneRaw,
      gearboxType,
      engineType,
      engineVolume,
      engineModel,
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
      console.log(`[MarquizWebhook] Lead enqueued, jobId=${queued.jobId}`);
    } else {
      console.warn("[MarquizWebhook] Queue unavailable — processing lead directly");
      await processMarquizLeadDirect(leadData);
    }
  } catch (err: any) {
    console.error("[MarquizWebhook] Unhandled error:", err.message, err.stack);
  }
});

export default router;
