import { storage } from "../storage";
import type { LearningQueueItem, Message } from "@shared/schema";

const MIN_LEARNING_SCORE = 1;

/**
 * Extracts customer→assistant pairs from a conversation's message list.
 * Returns pairs where a customer message is followed by an assistant reply.
 */
export function extractTrainingPairsFromConversation(
  messages: Message[]
): Array<{ userMessage: string; finalAnswer: string }> {
  const pairs: Array<{ userMessage: string; finalAnswer: string }> = [];

  for (let i = 0; i < messages.length - 1; i++) {
    const current = messages[i];
    const next = messages[i + 1];

    if (current.role === "customer" && (next.role === "assistant" || next.role === "owner")) {
      if (current.content?.trim() && next.content?.trim()) {
        pairs.push({
          userMessage: current.content.trim(),
          finalAnswer: next.content.trim(),
        });
      }
    }
  }

  return pairs;
}

/**
 * Processes a single learning queue item:
 * 1. Checks tenant training policies (forbidden topics, disabled intents)
 * 2. Loads conversation messages
 * 3. Extracts training pairs
 * 4. Creates training samples for pairs that don't already exist
 * 5. Marks the queue item as "reviewed"
 */
export async function processLearningQueueItem(item: LearningQueueItem): Promise<{
  processed: number;
  skipped: number;
  reason?: string;
}> {
  const { tenantId, conversationId } = item;

  if ((item.learningScore ?? 0) < MIN_LEARNING_SCORE) {
    await storage.updateLearningQueueItem(item.id, { status: "dismissed" });
    return { processed: 0, skipped: 1, reason: "score_too_low" };
  }

  const messages = await storage.getMessagesByConversation(conversationId, tenantId);
  if (!messages || messages.length < 2) {
    await storage.updateLearningQueueItem(item.id, { status: "reviewed" });
    return { processed: 0, skipped: 1, reason: "too_few_messages" };
  }

  const policy = await storage.getAiTrainingPolicy(tenantId);
  const forbiddenTopics = policy?.forbiddenTopics ?? [];
  const disabledIntents = policy?.disabledLearningIntents ?? [];

  const pairs = extractTrainingPairsFromConversation(messages);
  if (pairs.length === 0) {
    await storage.updateLearningQueueItem(item.id, { status: "reviewed" });
    return { processed: 0, skipped: 1, reason: "no_pairs_found" };
  }

  // Load existing training samples for this conversation to avoid duplicates
  const convSamples = await storage.getAiTrainingSamplesByConversation(conversationId, tenantId);
  const existingKeys = new Set(convSamples.map(s => s.userMessage));

  let processed = 0;
  let skipped = 0;

  for (const pair of pairs) {
    // Skip if a training sample with same userMessage already exists for this conversation
    if (existingKeys.has(pair.userMessage)) {
      skipped++;
      continue;
    }

    // Skip if any forbidden topic appears in the content
    if (forbiddenTopics.length > 0) {
      const combined = `${pair.userMessage} ${pair.finalAnswer}`.toLowerCase();
      const hasForbidden = forbiddenTopics.some(t => combined.includes(t.toLowerCase()));
      if (hasForbidden) {
        skipped++;
        continue;
      }
    }

    // Create training sample as OPERATOR_MANUAL (operator wrote it manually)
    const syntheticSuggestion = {
      conversationId,
      suggestedReply: "",
      intent: null,
      decision: null,
    };

    try {
      const { recordTrainingSample } = await import("./training-sample-service");
      await recordTrainingSample({
        suggestion: syntheticSuggestion as any,
        userMessage: pair.userMessage,
        finalAnswer: pair.finalAnswer,
        outcome: "OPERATOR_MANUAL",
        tenantId,
      });
      existingKeys.add(pair.userMessage); // prevent duplicates within same batch
      processed++;
    } catch (err: any) {
      console.error(`[LearningQueueProcessor] Failed to create training sample: ${err.message}`);
      skipped++;
    }
  }

  await storage.updateLearningQueueItem(item.id, { status: "reviewed" });

  return { processed, skipped };
}

/**
 * Processes all pending learning queue items across all tenants, up to batchSize.
 */
export async function processPendingLearningQueue(batchSize = 50): Promise<{
  total: number;
  processed: number;
  skipped: number;
}> {
  const items = await storage.getAllPendingLearningQueueItems(batchSize);
  let processedTotal = 0;
  let skippedTotal = 0;

  for (const item of items) {
    try {
      const result = await processLearningQueueItem(item);
      processedTotal += result.processed;
      skippedTotal += result.skipped;
    } catch (err: any) {
      console.error(`[LearningQueueProcessor] Error processing item ${item.id}: ${err.message}`);
      skippedTotal++;
    }
  }

  return { total: items.length, processed: processedTotal, skipped: skippedTotal };
}
