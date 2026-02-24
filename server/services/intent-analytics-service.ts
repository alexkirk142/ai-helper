import { storage } from "../storage";
import type { IntentPerformance, IntentAnalytics, AiSuggestion, CsatRating, Conversion } from "@shared/schema";

interface IntentData {
  suggestions: AiSuggestion[];
  conversationIds: Set<string>;
  csatRatings: CsatRating[];
  conversions: Conversion[];
  nonConvertedConversations: number;
}

function calculateStatus(metrics: {
  autosendRate: number;
  escalationRate: number;
  avgConfidence: number;
  csatAvg: number;
  conversionRate: number;
}): "good" | "warning" | "critical" {
  if (metrics.csatAvg < 3 || metrics.escalationRate > 50 || metrics.avgConfidence < 50) {
    return "critical";
  }
  if (metrics.csatAvg < 4 || metrics.escalationRate > 30 || metrics.avgConfidence < 70 || metrics.autosendRate < 20) {
    return "warning";
  }
  return "good";
}

function generateRecommendation(metrics: {
  autosendRate: number;
  escalationRate: number;
  avgConfidence: number;
  csatAvg: number;
  conversionRate: number;
  totalConversations: number;
}): string {
  if (metrics.totalConversations < 5) {
    return "Недостаточно данных для анализа";
  }
  
  if (metrics.avgConfidence < 50) {
    return "Добавить данные в базу знаний";
  }
  
  if (metrics.escalationRate > 50 || metrics.csatAvg < 3) {
    return "Нужен человек";
  }
  
  if (metrics.avgConfidence >= 80 && metrics.csatAvg >= 4 && metrics.autosendRate < 50) {
    return "Можно включить autosend";
  }
  
  if (metrics.csatAvg >= 4 && metrics.conversionRate >= 30) {
    return "Хорошая эффективность";
  }
  
  return "Требуется анализ";
}

export async function getIntentAnalytics(tenantId: string): Promise<IntentAnalytics> {
  const [suggestions, csatRatings, conversions, conversations] = await Promise.all([
    storage.getSuggestionsByTenant(tenantId),
    storage.getCsatRatingsByTenant(tenantId),
    storage.getConversionsByTenant(tenantId),
    storage.getConversationsByTenant(tenantId),
  ]);

  const intentMap = new Map<string, IntentData>();

  for (const suggestion of suggestions) {
    const intent = suggestion.intent || "other";
    
    if (!intentMap.has(intent)) {
      intentMap.set(intent, {
        suggestions: [],
        conversationIds: new Set(),
        csatRatings: [],
        conversions: [],
        nonConvertedConversations: 0,
      });
    }
    
    const data = intentMap.get(intent)!;
    data.suggestions.push(suggestion);
    data.conversationIds.add(suggestion.conversationId);
  }

  for (const rating of csatRatings) {
    const intent = rating.intent || "other";
    if (intentMap.has(intent)) {
      intentMap.get(intent)!.csatRatings.push(rating);
    }
  }

  for (const conversion of conversions) {
    const intent = conversion.intent || "other";
    if (intentMap.has(intent)) {
      intentMap.get(intent)!.conversions.push(conversion);
    }
  }

  const conversionConversationIds = new Set(conversions.map((c: Conversion) => c.conversationId));
  for (const [, data] of Array.from(intentMap.entries())) {
    let nonConverted = 0;
    for (const convId of Array.from(data.conversationIds)) {
      if (!conversionConversationIds.has(convId)) {
        nonConverted++;
      }
    }
    data.nonConvertedConversations = nonConverted;
  }

  const intents: IntentPerformance[] = [];

  for (const [intent, data] of Array.from(intentMap.entries())) {
    const totalConversations = data.conversationIds.size;
    const totalSuggestions = data.suggestions.length;

    const autosendCount = data.suggestions.filter((s: AiSuggestion) => s.decision === "AUTO_SEND").length;
    const escalationCount = data.suggestions.filter((s: AiSuggestion) => s.decision === "ESCALATE").length;
    const autosendRate = totalSuggestions > 0 
      ? Math.round((autosendCount / totalSuggestions) * 100) 
      : 0;
    const escalationRate = totalSuggestions > 0 
      ? Math.round((escalationCount / totalSuggestions) * 100) 
      : 0;

    const confidenceValues = data.suggestions
      .filter((s: AiSuggestion) => s.confidence !== null && s.confidence !== undefined)
      .map((s: AiSuggestion) => s.confidence as number);
    const avgConfidence = confidenceValues.length > 0
      ? Math.round(confidenceValues.reduce((a: number, b: number) => a + b, 0) / confidenceValues.length)
      : 0;

    const csatValues = data.csatRatings.map((r: CsatRating) => r.rating);
    const csatAvg = csatValues.length > 0
      ? Math.round((csatValues.reduce((a: number, b: number) => a + b, 0) / csatValues.length) * 100) / 100
      : 0;

    const conversionCount = data.conversions.length;
    const conversionRate = totalConversations > 0
      ? Math.round((conversionCount / totalConversations) * 100)
      : 0;

    const lostDealRate = totalConversations > 0
      ? Math.round((data.nonConvertedConversations / totalConversations) * 100)
      : 0;

    const metrics = { autosendRate, escalationRate, avgConfidence, csatAvg, conversionRate, totalConversations };
    const status = calculateStatus(metrics);
    const recommendation = generateRecommendation(metrics);

    intents.push({
      intent,
      totalConversations,
      autosendRate,
      escalationRate,
      avgConfidence,
      csatAvg,
      conversionRate,
      lostDealRate,
      status,
      recommendation,
    });
  }

  intents.sort((a, b) => b.totalConversations - a.totalConversations);

  return {
    intents,
    totalConversations: conversations.length,
    totalIntents: intents.length,
  };
}
