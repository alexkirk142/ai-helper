import type { IStorage } from "../storage";
import type { 
  LostDeal, 
  InsertLostDeal, 
  LostDealReason, 
  LostDealsAnalytics,
  LostDealsByReason,
  LostDealsByIntent,
  LostDealsTimelinePoint,
  AiSuggestion,
  Conversation,
} from "@shared/schema";
import { LOST_DEAL_REASONS } from "@shared/schema";

const ESCALATION_TIMEOUT_MINUTES = 30;

export class LostDealsService {
  constructor(private storage: IStorage) {}

  async detectLostDeal(
    conversationId: string,
    suggestion: AiSuggestion | null,
    conversation: Conversation
  ): Promise<LostDealReason | null> {
    const existing = await this.storage.getLostDealByConversation(conversationId);
    if (existing) {
      return null;
    }

    if (suggestion?.decision === "ESCALATE") {
      const timeSinceEscalation = Date.now() - new Date(suggestion.createdAt).getTime();
      const minutesSinceEscalation = timeSinceEscalation / (1000 * 60);
      
      if (minutesSinceEscalation > ESCALATION_TIMEOUT_MINUTES) {
        const messages = await this.storage.getMessagesByConversation(conversationId);
        const operatorReplied = messages.some(m => 
          (m.role === "assistant" || m.role === "owner") && 
          new Date(m.createdAt) > new Date(suggestion.createdAt)
        );
        
        if (!operatorReplied) {
          return "ESCALATED_NO_RESPONSE";
        }
      }
    }

    if (suggestion?.penalties && Array.isArray(suggestion.penalties)) {
      const penalties = suggestion.penalties as Array<{ code: string }>;
      const hasStaleData = penalties.some(p => p.code === "STALE_DATA");
      if (hasStaleData) {
        return "AI_ERROR";
      }
    }

    if (suggestion?.intent === "availability" && suggestion.penalties && Array.isArray(suggestion.penalties)) {
      const penalties = suggestion.penalties as Array<{ code: string }>;
      const hasMissingStock = penalties.some(p => p.code === "MISSING_STOCK" || p.code === "OUT_OF_STOCK");
      if (hasMissingStock) {
        return "NO_STOCK";
      }
    }

    return null;
  }

  async createLostDeal(
    tenantId: string,
    conversationId: string,
    reason: LostDealReason,
    detectedAutomatically: boolean = true,
    notes?: string
  ): Promise<LostDeal> {
    const data: InsertLostDeal = {
      tenantId,
      conversationId,
      reason,
      detectedAutomatically,
      notes,
    };
    return this.storage.createLostDeal(data);
  }

  async recordManualLostDeal(
    tenantId: string,
    conversationId: string,
    reason: LostDealReason,
    notes?: string
  ): Promise<LostDeal> {
    const existing = await this.storage.getLostDealByConversation(conversationId);
    if (existing) {
      throw new Error("Lost deal already recorded for this conversation");
    }
    return this.createLostDeal(tenantId, conversationId, reason, false, notes);
  }

  async getLostDealsAnalytics(tenantId: string): Promise<LostDealsAnalytics> {
    const lostDeals = await this.storage.getLostDealsByTenant(tenantId);
    const conversations = await this.storage.getConversationsByTenant(tenantId);
    const suggestions = await this.storage.getSuggestionsByTenant(tenantId);

    const conversationMap = new Map(conversations.map(c => [c.id, c]));
    const suggestionMap = new Map<string, AiSuggestion>();
    for (const s of suggestions) {
      if (!suggestionMap.has(s.conversationId)) {
        suggestionMap.set(s.conversationId, s);
      }
    }

    const totalLostDeals = lostDeals.length;

    const reasonCounts = new Map<LostDealReason, number>();
    for (const reason of LOST_DEAL_REASONS) {
      reasonCounts.set(reason, 0);
    }
    for (const deal of lostDeals) {
      const reason = deal.reason as LostDealReason;
      reasonCounts.set(reason, (reasonCounts.get(reason) || 0) + 1);
    }

    const byReason: LostDealsByReason[] = [];
    Array.from(reasonCounts.entries()).forEach(([reason, count]) => {
      if (count > 0 || totalLostDeals === 0) {
        byReason.push({
          reason,
          count,
          percentage: totalLostDeals > 0 ? Math.round((count / totalLostDeals) * 100) : 0,
        });
      }
    });
    byReason.sort((a, b) => b.count - a.count);

    const intentCounts = new Map<string, number>();
    for (const deal of lostDeals) {
      const suggestion = suggestionMap.get(deal.conversationId);
      const intent = suggestion?.intent || "unknown";
      intentCounts.set(intent, (intentCounts.get(intent) || 0) + 1);
    }

    const byIntent: LostDealsByIntent[] = [];
    Array.from(intentCounts.entries()).forEach(([intent, count]) => {
      byIntent.push({
        intent,
        count,
        percentage: totalLostDeals > 0 ? Math.round((count / totalLostDeals) * 100) : 0,
      });
    });
    byIntent.sort((a, b) => b.count - a.count);

    const dateCounts = new Map<string, number>();
    for (const deal of lostDeals) {
      const date = new Date(deal.createdAt).toISOString().split("T")[0];
      dateCounts.set(date, (dateCounts.get(date) || 0) + 1);
    }

    const timeline: LostDealsTimelinePoint[] = [];
    const sortedDates = Array.from(dateCounts.keys()).sort();
    for (const date of sortedDates) {
      timeline.push({
        date,
        count: dateCounts.get(date) || 0,
      });
    }

    return {
      totalLostDeals,
      byReason: byReason.filter(r => r.count > 0),
      byIntent,
      timeline,
    };
  }
}
