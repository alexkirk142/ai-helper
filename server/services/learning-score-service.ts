import { storage } from "../storage";
import { LEARNING_SCORE_REASONS, type LearningScoreReason, type AiSuggestion } from "@shared/schema";

export interface ScoreCalculationResult {
  score: number;
  reasons: LearningScoreReason[];
}

export interface ScoreContext {
  suggestion: AiSuggestion;
  outcome: "APPROVED" | "EDITED" | "REJECTED";
  messageCount?: number;
  tenantId: string;
  conversationId: string;
}

const LONG_CONVERSATION_THRESHOLD = 10;

export function calculateLearningScore(context: ScoreContext): ScoreCalculationResult {
  let score = 0;
  const reasons: LearningScoreReason[] = [];

  if (context.suggestion.decision === "ESCALATE") {
    score += LEARNING_SCORE_REASONS.ESCALATED.score;
    reasons.push("ESCALATED");
  }

  if (context.outcome === "EDITED") {
    score += LEARNING_SCORE_REASONS.EDITED.score;
    reasons.push("EDITED");
  }

  const penalties = context.suggestion.penalties as Record<string, number> | null;
  if (penalties) {
    if (penalties.LOW_SIMILARITY && penalties.LOW_SIMILARITY > 0) {
      score += LEARNING_SCORE_REASONS.LOW_SIMILARITY.score;
      reasons.push("LOW_SIMILARITY");
    }
    if (penalties.STALE_DATA && penalties.STALE_DATA > 0) {
      score += LEARNING_SCORE_REASONS.STALE_DATA.score;
      reasons.push("STALE_DATA");
    }
  }

  if (context.messageCount && context.messageCount > LONG_CONVERSATION_THRESHOLD) {
    score += LEARNING_SCORE_REASONS.LONG_CONVERSATION.score;
    reasons.push("LONG_CONVERSATION");
  }

  return { score, reasons };
}

export async function addToLearningQueue(context: ScoreContext): Promise<void> {
  const { score, reasons } = calculateLearningScore(context);
  
  if (score === 0) {
    return;
  }

  await storage.upsertLearningQueueItem({
    tenantId: context.tenantId,
    conversationId: context.conversationId,
    learningScore: score,
    reasons,
    status: "pending",
  });
}

export async function getLearningQueue(
  tenantId: string,
  minScore?: number
): Promise<{
  items: Awaited<ReturnType<typeof storage.getLearningQueueByTenant>>;
  total: number;
}> {
  const items = await storage.getLearningQueueByTenant(tenantId, minScore);
  return {
    items,
    total: items.length,
  };
}

export async function markReviewed(
  conversationId: string,
  userId: string
): Promise<boolean> {
  const item = await storage.getLearningQueueItem(conversationId);
  if (!item) return false;
  
  await storage.updateLearningQueueItem(item.id, {
    status: "reviewed",
    reviewedBy: userId,
  });
  return true;
}

export const learningScoreService = {
  calculateLearningScore,
  addToLearningQueue,
  getLearningQueue,
  markReviewed,
};
