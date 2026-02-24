import { storage } from "../storage";
import type { CsatAnalytics, CsatBreakdown, CsatDistribution, InsertCsatRating } from "@shared/schema";
import { sanitizeForPrompt } from "../utils/sanitizer";

export async function submitCsatRating(data: InsertCsatRating): Promise<{ success: boolean; error?: string }> {
  const existing = await storage.getCsatRatingByConversation(data.conversationId);
  if (existing) {
    return { success: false, error: "CSAT rating already submitted for this conversation" };
  }

  const conversation = await storage.getConversation(data.conversationId);
  if (!conversation) {
    return { success: false, error: "Conversation not found" };
  }

  if (conversation.tenantId !== data.tenantId) {
    return { success: false, error: "Tenant mismatch" };
  }

  const sanitizedData = {
    ...data,
    comment: data.comment ? sanitizeForPrompt(data.comment) : data.comment,
  };

  await storage.createCsatRating(sanitizedData);
  return { success: true };
}

export async function getCsatAnalytics(tenantId: string): Promise<CsatAnalytics> {
  const ratings = await storage.getCsatRatingsByTenant(tenantId);

  if (ratings.length === 0) {
    return {
      avgScore: 0,
      totalRatings: 0,
      distribution: [1, 2, 3, 4, 5].map(r => ({ rating: r, count: 0, percentage: 0 })),
      byIntent: [],
      byDecision: [],
      problemIntents: [],
    };
  }

  const avgScore = ratings.reduce((sum: number, r) => sum + r.rating, 0) / ratings.length;

  const distributionMap = new Map<number, number>();
  for (let i = 1; i <= 5; i++) distributionMap.set(i, 0);
  for (const r of ratings) {
    distributionMap.set(r.rating, (distributionMap.get(r.rating) || 0) + 1);
  }

  const distribution: CsatDistribution[] = [];
  for (let i = 1; i <= 5; i++) {
    const count = distributionMap.get(i) || 0;
    distribution.push({
      rating: i,
      count,
      percentage: Math.round((count / ratings.length) * 100),
    });
  }

  const byIntent = calculateBreakdown(ratings, "intent");
  const byDecision = calculateBreakdown(ratings, "decision");

  const problemIntents = byIntent
    .filter(b => b.avgScore < 3.5 && b.count >= 1)
    .sort((a, b) => a.avgScore - b.avgScore);

  return {
    avgScore: Math.round(avgScore * 100) / 100,
    totalRatings: ratings.length,
    distribution,
    byIntent,
    byDecision,
    problemIntents,
  };
}

function calculateBreakdown(
  ratings: { rating: number; intent: string | null; decision: string | null }[],
  key: "intent" | "decision"
): CsatBreakdown[] {
  const groups = new Map<string, number[]>();

  for (const r of ratings) {
    const value = r[key];
    if (value) {
      if (!groups.has(value)) {
        groups.set(value, []);
      }
      groups.get(value)!.push(r.rating);
    }
  }

  const result: CsatBreakdown[] = [];
  for (const [groupKey, groupRatings] of Array.from(groups.entries())) {
    const avg = groupRatings.reduce((sum: number, r: number) => sum + r, 0) / groupRatings.length;
    result.push({
      key: groupKey,
      avgScore: Math.round(avg * 100) / 100,
      count: groupRatings.length,
    });
  }

  return result.sort((a, b) => b.count - a.count);
}

export function calculateAvgCsat(ratings: number[]): number {
  if (ratings.length === 0) return 0;
  return ratings.reduce((sum, r) => sum + r, 0) / ratings.length;
}
