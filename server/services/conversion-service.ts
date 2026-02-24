import { storage } from "../storage";
import type { ConversionAnalytics, ConversionBreakdown, Conversion } from "@shared/schema";

interface SubmitConversionInput {
  tenantId: string;
  conversationId: string;
  amount: number;
  currency?: string;
}

interface SubmitConversionResult {
  success: boolean;
  conversion?: Conversion;
  error?: string;
}

export async function submitConversion(input: SubmitConversionInput): Promise<SubmitConversionResult> {
  const existing = await storage.getConversionByConversation(input.conversationId);
  if (existing) {
    return { success: false, error: "Conversion already submitted for this conversation" };
  }

  const conversation = await storage.getConversation(input.conversationId);
  if (!conversation) {
    return { success: false, error: "Conversation not found" };
  }

  if (conversation.tenantId !== input.tenantId) {
    return { success: false, error: "Tenant mismatch" };
  }

  const suggestions = await storage.getSuggestionsByConversation(input.conversationId);
  const lastSuggestion = suggestions.length > 0 ? suggestions[suggestions.length - 1] : null;

  const conversion = await storage.createConversion({
    tenantId: input.tenantId,
    conversationId: input.conversationId,
    amount: input.amount,
    currency: input.currency ?? "RUB",
    intent: lastSuggestion?.intent ?? null,
    decision: lastSuggestion?.decision ?? null,
  });

  return { success: true, conversion };
}

export async function getConversionByConversation(conversationId: string): Promise<Conversion | undefined> {
  return storage.getConversionByConversation(conversationId);
}

function calculateBreakdown(conversions: Conversion[], keyFn: (c: Conversion) => string | null): ConversionBreakdown[] {
  const groups = new Map<string, { count: number; totalRevenue: number }>();

  for (const conv of conversions) {
    const key = keyFn(conv) || "unknown";
    const existing = groups.get(key) || { count: 0, totalRevenue: 0 };
    existing.count += 1;
    existing.totalRevenue += conv.amount;
    groups.set(key, existing);
  }

  return Array.from(groups.entries()).map(([key, data]) => ({
    key,
    count: data.count,
    totalRevenue: Math.round(data.totalRevenue * 100) / 100,
    avgAmount: Math.round((data.totalRevenue / data.count) * 100) / 100,
  }));
}

export async function getConversionAnalytics(tenantId: string): Promise<ConversionAnalytics> {
  const conversions = await storage.getConversionsByTenant(tenantId);
  const conversations = await storage.getConversationsByTenant(tenantId);

  const totalConversations = conversations.length;
  const totalConversions = conversions.length;
  const totalRevenue = conversions.reduce((sum, c) => sum + c.amount, 0);

  const conversionRate = totalConversations > 0 
    ? Math.round((totalConversions / totalConversations) * 100 * 100) / 100 
    : 0;

  const avgAmount = totalConversions > 0 
    ? Math.round((totalRevenue / totalConversions) * 100) / 100 
    : 0;

  const currency = conversions[0]?.currency ?? "RUB";

  const byIntent = calculateBreakdown(conversions, c => c.intent);
  const byDecision = calculateBreakdown(conversions, c => c.decision);

  const topIntentsByRevenue = [...byIntent]
    .sort((a, b) => b.totalRevenue - a.totalRevenue)
    .slice(0, 5);

  let avgTimeToConversion: number | null = null;
  if (conversions.length > 0) {
    const times: number[] = [];
    for (const conv of conversions) {
      const conversation = conversations.find(c => c.id === conv.conversationId);
      if (conversation && conversation.createdAt && conv.createdAt) {
        const convTime = new Date(conv.createdAt).getTime();
        const startTime = new Date(conversation.createdAt).getTime();
        const hoursToConversion = (convTime - startTime) / (1000 * 60 * 60);
        if (hoursToConversion >= 0) {
          times.push(hoursToConversion);
        }
      }
    }
    if (times.length > 0) {
      avgTimeToConversion = Math.round((times.reduce((a, b) => a + b, 0) / times.length) * 100) / 100;
    }
  }

  return {
    conversionRate,
    totalConversations,
    totalConversions,
    totalRevenue: Math.round(totalRevenue * 100) / 100,
    avgAmount,
    currency,
    byIntent,
    byDecision,
    topIntentsByRevenue,
    avgTimeToConversion,
  };
}
