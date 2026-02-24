import OpenAI from "openai";
import { storage } from "../storage";
import { sanitizeString } from "../utils/sanitizer";
import { auditLog } from "./audit-log";
import type { Message } from "@shared/schema";

const openai = new OpenAI({
  apiKey: process.env.AI_INTEGRATIONS_OPENAI_API_KEY || process.env.OPENAI_API_KEY || "sk-placeholder",
  baseURL: process.env.AI_INTEGRATIONS_OPENAI_BASE_URL || undefined,
});

const DEFAULT_MESSAGE_LIMIT = 30;
const SUMMARY_TRIGGER_MESSAGE_COUNT = 10;

export interface SummaryResult {
  success: boolean;
  summary?: string;
  error?: string;
}

async function getRecentCustomerMessages(
  tenantId: string,
  customerId: string,
  limit: number = DEFAULT_MESSAGE_LIMIT
): Promise<Message[]> {
  const conversations = await storage.getConversationsByTenant(tenantId);
  const customerConversations = conversations.filter(c => c.customerId === customerId);
  
  const allMessages: Message[] = [];
  for (const conv of customerConversations) {
    const messages = await storage.getMessagesByConversation(conv.id);
    allMessages.push(...messages);
  }
  
  allMessages.sort((a, b) => 
    new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
  );
  
  return allMessages.slice(0, limit);
}

function formatMessagesForSummary(messages: Message[]): string {
  const chronological = [...messages].reverse();
  
  return chronological.map(m => {
    const role = m.role === "customer" ? "Клиент" : "Оператор";
    const content = sanitizeString(m.content);
    return `[${role}]: ${content}`;
  }).join("\n");
}

export async function generateCustomerSummary(
  tenantId: string,
  customerId: string,
  triggeredBy: "conversation_resolved" | "message_count" | "manual_rebuild"
): Promise<SummaryResult> {
  try {
    const messages = await getRecentCustomerMessages(tenantId, customerId);
    
    if (messages.length < 3) {
      return {
        success: true,
        summary: undefined,
      };
    }
    
    const formattedMessages = formatMessagesForSummary(messages);
    
    const systemPrompt = `Ты — ассистент, который создаёт краткие сводки по истории общения с клиентом.

ЗАДАЧА:
Проанализируй переписку и создай краткую сводку (3-6 буллетов) о том, что клиент хотел, какие вопросы задавал, какие предпочтения высказывал.

ПРАВИЛА:
1. Пиши на русском языке
2. Используй буллет-поинты (-)
3. НЕ включай персональные данные (email, телефон, адрес)
4. Фокусируйся на: предпочтениях, частых вопросах, интересах к товарам
5. Максимум 6 пунктов, минимум 3
6. Каждый пункт — не более 15 слов

ФОРМАТ ОТВЕТА (JSON):
{
  "summary_bullets": [
    "- Интересовался ценами на смартфоны Samsung",
    "- Предпочитает доставку курьером",
    "- Спрашивал о гарантии на электронику"
  ]
}`;

    const response = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: `Переписка:\n${formattedMessages}` },
      ],
      response_format: { type: "json_object" },
      max_completion_tokens: 512,
    });

    const responseContent = response.choices[0]?.message?.content || "{}";
    let parsed: { summary_bullets?: string[] };
    
    try {
      parsed = JSON.parse(responseContent);
    } catch {
      auditLog.setContext({ tenantId });
      await auditLog.log(
        "customer_summary_failed" as any,
        "customer_memory",
        customerId,
        "system",
        "ai",
        { triggeredBy, error: "Failed to parse LLM response" }
      );
      return {
        success: false,
        error: "Failed to parse LLM response",
      };
    }

    if (!parsed.summary_bullets || !Array.isArray(parsed.summary_bullets)) {
      auditLog.setContext({ tenantId });
      await auditLog.log(
        "customer_summary_failed" as any,
        "customer_memory",
        customerId,
        "system",
        "ai",
        { triggeredBy, error: "Invalid summary format from LLM" }
      );
      return {
        success: false,
        error: "Invalid summary format from LLM",
      };
    }

    const summaryText = parsed.summary_bullets
      .slice(0, 6)
      .map(b => sanitizeString(b))
      .join("\n");

    await storage.upsertCustomerMemory({
      tenantId,
      customerId,
      lastSummaryText: summaryText,
    });

    auditLog.setContext({ tenantId });
    await auditLog.log(
      "customer_summary_generated" as any,
      "customer_memory",
      customerId,
      "system",
      "ai",
      {
        triggeredBy,
        messageCount: messages.length,
        bulletCount: parsed.summary_bullets.length,
      }
    );

    return {
      success: true,
      summary: summaryText,
    };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : "Unknown error";
    
    auditLog.setContext({ tenantId });
    await auditLog.log(
      "customer_summary_failed" as any,
      "customer_memory",
      customerId,
      "system",
      "ai",
      {
        triggeredBy,
        error: errorMessage,
      }
    );

    return {
      success: false,
      error: errorMessage,
    };
  }
}

export async function shouldTriggerSummaryByMessageCount(
  tenantId: string,
  customerId: string
): Promise<boolean> {
  const messages = await getRecentCustomerMessages(tenantId, customerId, SUMMARY_TRIGGER_MESSAGE_COUNT + 1);
  
  if (messages.length < SUMMARY_TRIGGER_MESSAGE_COUNT) {
    return false;
  }

  const memory = await storage.getCustomerMemory(tenantId, customerId);
  
  if (!memory?.lastSummaryText) {
    return true;
  }

  return messages.length % SUMMARY_TRIGGER_MESSAGE_COUNT === 0;
}

export async function triggerSummaryOnConversationResolved(
  tenantId: string,
  customerId: string
): Promise<void> {
  await generateCustomerSummary(tenantId, customerId, "conversation_resolved");
}

export { DEFAULT_MESSAGE_LIMIT, SUMMARY_TRIGGER_MESSAGE_COUNT };
