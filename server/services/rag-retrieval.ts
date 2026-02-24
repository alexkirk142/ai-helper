import type { RagDocType } from "@shared/schema";
import { storage } from "../storage";
import { embeddingService } from "./embedding-service";

export interface RetrievalConfig {
  productTopK: number;
  docTopK: number;
  retrievalConfidenceThreshold: number;
  minSimilarity: number;
}

const DEFAULT_CONFIG: RetrievalConfig = {
  productTopK: 5,
  docTopK: 3,
  retrievalConfidenceThreshold: 0.7,
  minSimilarity: 0.5,
};

export interface RetrievalFilter {
  tenantId: string;
  category?: string;
  sku?: string;
  intent?: string;
}

export interface RetrievedChunk {
  chunkText: string;
  similarity: number;
  sourceType: RagDocType;
  sourceId: string;
  metadata: Record<string, unknown>;
  chunkIndex: number;
  isCritical?: boolean;
}

export interface RetrievalResult {
  chunks: RetrievedChunk[];
  productChunks: RetrievedChunk[];
  docChunks: RetrievedChunk[];
  usedDocFallback: boolean;
  queryEmbedding: number[] | null;
  topProductSimilarity: number;
  topDocSimilarity: number;
}

function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length || a.length === 0) return 0;
  
  let dotProduct = 0;
  let normA = 0;
  let normB = 0;
  
  for (let i = 0; i < a.length; i++) {
    dotProduct += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  
  const magnitude = Math.sqrt(normA) * Math.sqrt(normB);
  if (magnitude === 0) return 0;
  
  return dotProduct / magnitude;
}

export async function retrieveContext(
  query: string,
  filter: RetrievalFilter,
  config: Partial<RetrievalConfig> = {}
): Promise<RetrievalResult> {
  const cfg = { ...DEFAULT_CONFIG, ...config };
  
  const emptyResult: RetrievalResult = {
    chunks: [],
    productChunks: [],
    docChunks: [],
    usedDocFallback: false,
    queryEmbedding: null,
    topProductSimilarity: 0,
    topDocSimilarity: 0,
  };

  if (!embeddingService.isAvailable()) {
    console.warn("[RAG Retrieval] Embedding service not available");
    return emptyResult;
  }

  const queryResult = await embeddingService.createEmbedding(query);
  if (!queryResult) {
    console.warn("[RAG Retrieval] Failed to create query embedding");
    return emptyResult;
  }
  
  const queryEmbedding = queryResult.embedding;

  const allChunks = await storage.getAllRagChunksWithEmbedding(filter.tenantId);
  
  if (allChunks.length === 0) {
    return { ...emptyResult, queryEmbedding };
  }

  const scoredChunks: (RetrievedChunk & { embedding: number[] })[] = [];
  
  for (const chunk of allChunks) {
    if (!chunk.embedding) continue;
    
    const embedding = typeof chunk.embedding === "string" 
      ? JSON.parse(chunk.embedding) as number[]
      : chunk.embedding;
    
    const similarity = cosineSimilarity(queryEmbedding, embedding);
    
    if (similarity < cfg.minSimilarity) continue;

    const metadata = chunk.metadata as Record<string, unknown>;
    const sourceType = metadata.sourceType as RagDocType;
    const sourceId = metadata.sourceId as string;

    if (filter.category && metadata.category && metadata.category !== filter.category) {
      continue;
    }
    if (filter.sku && metadata.sku && metadata.sku !== filter.sku) {
      continue;
    }

    scoredChunks.push({
      chunkText: chunk.chunkText,
      similarity,
      sourceType,
      sourceId,
      metadata,
      chunkIndex: chunk.chunkIndex,
      isCritical: metadata.isCritical as boolean | undefined,
      embedding,
    });
  }

  scoredChunks.sort((a, b) => b.similarity - a.similarity);

  const productChunks = scoredChunks
    .filter(c => c.sourceType === "PRODUCT")
    .slice(0, cfg.productTopK)
    .map(({ embedding, ...rest }) => rest);

  const topProductSimilarity = productChunks.length > 0 ? productChunks[0].similarity : 0;

  let docChunks: RetrievedChunk[] = [];
  let usedDocFallback = false;

  if (topProductSimilarity < cfg.retrievalConfidenceThreshold) {
    usedDocFallback = true;
    docChunks = scoredChunks
      .filter(c => c.sourceType === "DOC")
      .slice(0, cfg.docTopK)
      .map(({ embedding, ...rest }) => rest);
  }

  const topDocSimilarity = docChunks.length > 0 ? docChunks[0].similarity : 0;

  const chunks = [...productChunks, ...docChunks];

  return {
    chunks,
    productChunks,
    docChunks,
    usedDocFallback,
    queryEmbedding,
    topProductSimilarity,
    topDocSimilarity,
  };
}

export function formatContextForPrompt(result: RetrievalResult): string {
  if (result.chunks.length === 0) {
    return "";
  }

  const sections: string[] = [];

  if (result.productChunks.length > 0) {
    const productLines = result.productChunks.map((chunk, i) => {
      const name = chunk.metadata.productName || chunk.metadata.sku || "Товар";
      return `[Товар ${i + 1}: ${name}, сходство: ${(chunk.similarity * 100).toFixed(0)}%]\n${chunk.chunkText}`;
    });
    sections.push("=== ТОВАРЫ ===\n" + productLines.join("\n\n"));
  }

  if (result.docChunks.length > 0) {
    const docLines = result.docChunks.map((chunk, i) => {
      const title = chunk.metadata.docTitle || chunk.metadata.category || "Документ";
      return `[Документ ${i + 1}: ${title}, сходство: ${(chunk.similarity * 100).toFixed(0)}%]\n${chunk.chunkText}`;
    });
    sections.push("=== ДОКУМЕНТЫ ===\n" + docLines.join("\n\n"));
  }

  return sections.join("\n\n");
}

export const ragRetrieval = {
  DEFAULT_CONFIG,
  retrieveContext,
  formatContextForPrompt,
  cosineSimilarity,
};
