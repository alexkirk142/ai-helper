import OpenAI from "openai";
import { featureFlagService } from "./feature-flags";

const EMBEDDING_MODEL = "text-embedding-3-large";
const EMBEDDING_DIMENSIONS = 3072;

let openaiClient: OpenAI | null = null;

function getOpenAIClient(): OpenAI | null {
  if (openaiClient) return openaiClient;
  
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    console.warn("OPENAI_API_KEY not set - embeddings disabled");
    return null;
  }
  
  openaiClient = new OpenAI({ apiKey });
  return openaiClient;
}

export interface EmbeddingResult {
  embedding: number[];
  model: string;
  tokenCount: number;
}

export async function createEmbedding(text: string): Promise<EmbeddingResult | null> {
  const isRagEnabled = await featureFlagService.isEnabled("RAG_ENABLED");
  if (!isRagEnabled) {
    return null;
  }
  
  const client = getOpenAIClient();
  if (!client) {
    return null;
  }
  
  try {
    const response = await client.embeddings.create({
      model: EMBEDDING_MODEL,
      input: text.trim(),
      dimensions: EMBEDDING_DIMENSIONS,
    });
    
    const data = response.data[0];
    return {
      embedding: data.embedding,
      model: EMBEDDING_MODEL,
      tokenCount: response.usage?.total_tokens ?? 0,
    };
  } catch (error) {
    console.error("Failed to create embedding:", error);
    return null;
  }
}

export async function createEmbeddings(texts: string[]): Promise<(EmbeddingResult | null)[]> {
  const isRagEnabled = await featureFlagService.isEnabled("RAG_ENABLED");
  if (!isRagEnabled) {
    return texts.map(() => null);
  }
  
  const client = getOpenAIClient();
  if (!client) {
    return texts.map(() => null);
  }
  
  try {
    const cleanTexts = texts.map(t => t.trim()).filter(t => t.length > 0);
    if (cleanTexts.length === 0) {
      return texts.map(() => null);
    }
    
    const response = await client.embeddings.create({
      model: EMBEDDING_MODEL,
      input: cleanTexts,
      dimensions: EMBEDDING_DIMENSIONS,
    });
    
    const results: (EmbeddingResult | null)[] = [];
    let embIdx = 0;
    
    for (const text of texts) {
      if (text.trim().length === 0) {
        results.push(null);
      } else {
        const data = response.data[embIdx];
        results.push({
          embedding: data.embedding,
          model: EMBEDDING_MODEL,
          tokenCount: Math.floor((response.usage?.total_tokens ?? 0) / cleanTexts.length),
        });
        embIdx++;
      }
    }
    
    return results;
  } catch (error) {
    console.error("Failed to create embeddings batch:", error);
    return texts.map(() => null);
  }
}

export function isEmbeddingServiceAvailable(): boolean {
  return !!process.env.OPENAI_API_KEY;
}

export const embeddingService = {
  createEmbedding,
  createEmbeddings,
  isAvailable: isEmbeddingServiceAvailable,
  MODEL: EMBEDDING_MODEL,
  DIMENSIONS: EMBEDDING_DIMENSIONS,
};
