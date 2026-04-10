import { Router } from "express";
import { enqueueMarquizLead } from "../services/marquiz-lead-queue";
import type { MarquizLeadJobData } from "../services/marquiz-lead-queue";
import { processMarquizLeadDirect } from "../workers/marquiz-lead.worker";

const router = Router();

// Marquiz webhook payload shapes:
// { quiz: string, results: Array<{ name: string, value: string }>, phone?: string, ... }
interface MarquizResultField {
  name: string;
  value: string;
}

interface MarquizPayload {
  quiz?: string;
  quizId?: string;
  phone?: string;
  email?: string;
  name?: string;
  results?: MarquizResultField[];
  [key: string]: unknown;
}

/**
 * Flatten all fields from Marquiz payload into a lowercase-keyed map
 * so we can look up answers regardless of label capitalisation.
 */
function extractFields(body: MarquizPayload): Record<string, string> {
  const fields: Record<string, string> = {};

  // Structured results array (primary format)
  if (Array.isArray(body.results)) {
    for (const field of body.results) {
      if (field.name != null && field.value != null) {
        fields[String(field.name).toLowerCase().trim()] = String(field.value).trim();
      }
    }
  }

  // Top-level string fields (fallback / alternative format)
  for (const [key, val] of Object.entries(body)) {
    if (typeof val === "string" && val.trim() !== "") {
      fields[key.toLowerCase().trim()] = val.trim();
    }
  }

  return fields;
}

function normalizePhone(raw: string): string {
  const digits = raw.replace(/\D/g, "");
  if (digits.startsWith("8") && digits.length === 11) {
    return "7" + digits.slice(1);
  }
  return digits;
}

// Fuzzy field lookup — returns first field whose key starts with any of the given prefixes
function findField(fields: Record<string, string>, ...prefixes: string[]): string {
  for (const prefix of prefixes) {
    const found = Object.entries(fields).find(([k]) => k.startsWith(prefix));
    if (found) return found[1];
  }
  return "";
}

router.post("/", async (req, res) => {
  // Acknowledge immediately so Marquiz doesn't retry
  res.status(200).json({ ok: true });

  try {
    const body = req.body as MarquizPayload;
    // Log the full payload to help debug format issues
    console.log("[MarquizWebhook] Incoming lead payload:", JSON.stringify(body));

    const fields = extractFields(body);
    console.log("[MarquizWebhook] Extracted fields:", JSON.stringify(fields));

    // Phone — top-level field has priority, then results array
    const rawPhone =
      (typeof body.phone === "string" ? body.phone : "") ||
      findField(fields, "телефон", "phone", "номер");

    if (!rawPhone || normalizePhone(rawPhone).length < 10) {
      console.warn("[MarquizWebhook] No valid phone in payload, skipping:", JSON.stringify(body));
      return;
    }

    // MAX phone — dedicated quiz field; fall back to main phone
    const rawMaxPhone = findField(fields, "max") || rawPhone;

    const quizName = typeof body.quiz === "string" ? body.quiz.trim() : "Квиз";

    const gearboxType = findField(fields, "выберите тип коробки", "тип коробки", "тип кпп", "коробка");
    const carInfo = findField(fields, "марка авто", "марка и год", "автомобиль", "машина", "авто");
    const vin = findField(fields, "vin", "вин", "номер кузова");
    const city = findField(fields, "город", "ваш город", "city");
    const clientName =
      (typeof body.name === "string" ? body.name : "") ||
      findField(fields, "имя", "name", "ваше имя");

    const leadData: MarquizLeadJobData = {
      quizName,
      phone: rawPhone,
      maxPhone: rawMaxPhone,
      gearboxType,
      carInfo,
      vin,
      city,
      clientName,
      rawFields: fields,
    };

    console.log(`[MarquizWebhook] Lead data: phone=${rawPhone}, maxPhone=${rawMaxPhone}, name=${clientName}`);

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
