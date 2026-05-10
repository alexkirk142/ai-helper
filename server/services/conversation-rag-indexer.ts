import { storage } from "../storage";
import { embeddingService } from "./embedding-service";
import { featureFlagService } from "./feature-flags";
import { estimateTokenCount } from "./document-chunking-service";

const MIN_CUSTOMER_MESSAGES = 2;
const MIN_ASSISTANT_MESSAGES = 2;

/**
 * Builds the conversation text in "Клиент/Оператор" dialog format.
 * Pairs customer messages with the next assistant reply in sequence.
 */
function buildConversationText(
  messages: Array<{ role: string; content: string }>
): string {
  const lines: string[] = [];

  for (let i = 0; i < messages.length; i++) {
    const msg = messages[i];
    if (msg.role === "customer") {
      lines.push(`Клиент: ${msg.content}`);
    } else if (msg.role === "assistant" || msg.role === "owner") {
      lines.push(`Оператор: ${msg.content}`);
    }
  }

  return lines.join("\n");
}

/**
 * Splits a conversation text into overlapping chunks suitable for embedding.
 * Each chunk covers a window of dialog turns.
 */
function chunkConversationText(
  text: string,
  maxTokens = 400
): Array<{ text: string; tokenCount: number }> {
  const paragraphs = text.split("\n").filter((l) => l.trim().length > 0);
  const chunks: Array<{ text: string; tokenCount: number }> = [];

  let current: string[] = [];
  let currentTokens = 0;

  for (const line of paragraphs) {
    const lineTokens = estimateTokenCount(line);

    if (currentTokens + lineTokens > maxTokens && current.length > 0) {
      const chunkText = current.join("\n").trim();
      chunks.push({ text: chunkText, tokenCount: estimateTokenCount(chunkText) });
      // Keep last 2 lines for overlap context
      current = current.slice(-2);
      currentTokens = current.reduce((acc, l) => acc + estimateTokenCount(l), 0);
    }

    current.push(line);
    currentTokens += lineTokens;
  }

  if (current.length > 0) {
    const chunkText = current.join("\n").trim();
    if (chunkText.length > 0) {
      chunks.push({ text: chunkText, tokenCount: estimateTokenCount(chunkText) });
    }
  }

  return chunks;
}

/**
 * Indexes a resolved conversation into the RAG knowledge base.
 *
 * Eligibility conditions:
 * - At least 2 customer messages and 2 assistant messages
 * - At least one APPROVED/EDITED training sample OR operator wrote manually
 * - No existing RAG document with type=CONVERSATION + sourceId=conversationId
 *
 * Is idempotent: safe to call multiple times for the same conversation.
 */
export async function indexConversation(
  conversationId: string,
  tenantId: string
): Promise<void> {
  const isEnabled = await featureFlagService.isEnabled(
    "AUTO_LEARNING_ENABLED",
    tenantId
  );
  if (!isEnabled) {
    return;
  }

  if (!embeddingService.isAvailable()) {
    console.warn(
      "[ConversationRAG] Embedding service not available, skipping indexation"
    );
    return;
  }

  const messages = await storage.getMessagesByConversation(
    conversationId,
    tenantId
  );

  const customerMessages = messages.filter((m) => m.role === "customer");
  const assistantMessages = messages.filter(
    (m) => m.role === "assistant" || m.role === "owner"
  );

  if (
    customerMessages.length < MIN_CUSTOMER_MESSAGES ||
    assistantMessages.length < MIN_ASSISTANT_MESSAGES
  ) {
    console.info(
      `[ConversationRAG] Conversation ${conversationId} skipped: not enough messages (${customerMessages.length} customer, ${assistantMessages.length} assistant)`
    );
    return;
  }

  // Check if operator wrote manually (no suggestionId in metadata) — qualifies as valuable signal
  const hasManualOperatorMessages = assistantMessages.some((m) => {
    const meta = m.metadata as Record<string, unknown> | null;
    return !meta?.suggestionId;
  });

  // Check for APPROVED/EDITED training samples
  const trainingSamples = await storage.getAiTrainingSamplesByConversation(
    conversationId,
    tenantId
  );
  const hasQualifyingTrainingSamples = trainingSamples.some(
    (s) =>
      s.outcome === "APPROVED" ||
      s.outcome === "EDITED" ||
      s.outcome === "OPERATOR_MANUAL"
  );

  if (!hasManualOperatorMessages && !hasQualifyingTrainingSamples) {
    console.info(
      `[ConversationRAG] Conversation ${conversationId} skipped: no qualifying training samples and no manual operator messages`
    );
    return;
  }

  // Deduplication: check if already indexed
  const existing = await storage.findRagDocumentBySource(
    tenantId,
    "CONVERSATION",
    conversationId
  );
  if (existing) {
    console.info(
      `[ConversationRAG] Conversation ${conversationId} already indexed (ragDoc: ${existing.id}), skipping`
    );
    return;
  }

  // Build dialog text
  const conversationText = buildConversationText(messages);
  if (conversationText.trim().length === 0) {
    return;
  }

  // Create RAG document
  const ragDoc = await storage.createRagDocument({
    tenantId,
    type: "CONVERSATION",
    sourceId: conversationId,
    content: conversationText,
    metadata: {
      conversationId,
      messageCount: messages.length,
      customerMessages: customerMessages.length,
      assistantMessages: assistantMessages.length,
      hasManualOperatorMessages,
      hasQualifyingTrainingSamples,
      indexedAt: new Date().toISOString(),
    },
  });

  // Chunk + embed
  const chunks = chunkConversationText(conversationText);

  for (let i = 0; i < chunks.length; i++) {
    const chunk = chunks[i];

    const ragChunk = await storage.createRagChunk({
      ragDocumentId: ragDoc.id,
      chunkText: chunk.text,
      chunkIndex: i,
      tokenCount: chunk.tokenCount,
      embedding: null,
      embeddingVector: null,
      metadata: {
        sourceType: "CONVERSATION",
        sourceId: conversationId,
        conversationId,
        tenantId,
        chunkIndex: i,
      },
    });

    const embeddingResult = await embeddingService.createEmbedding(chunk.text);
    if (embeddingResult) {
      await storage.updateRagChunkEmbedding(ragChunk.id, embeddingResult.embedding);
    } else {
      console.warn(
        `[ConversationRAG] Failed to create embedding for chunk ${i} of conversation ${conversationId}`
      );
    }
  }

  console.info(
    `[ConversationRAG] Indexed conversation ${conversationId}: ${chunks.length} chunks created`
  );
}
