import type { Product, KnowledgeDoc, RagDocument, RagChunk, InsertRagDocument, InsertRagChunk, RagDocType } from "@shared/schema";
import { RAG_DOC_TYPES } from "@shared/schema";
import { estimateTokenCount } from "./document-chunking-service";
import { createHash } from "crypto";

export function computeContentHash(text: string): string {
  return createHash("sha256").update(text.trim()).digest("hex").slice(0, 16);
}

export interface RagIndexerConfig {
  minTokens: number;
  maxTokens: number;
  overlapTokens: number;
}

const DEFAULT_CONFIG: RagIndexerConfig = {
  minTokens: 100,
  maxTokens: 400,
  overlapTokens: 50,
};

export interface RagChunkResult {
  chunkText: string;
  chunkIndex: number;
  tokenCount: number;
  metadata: Record<string, unknown>;
  isCritical?: boolean;
  chunkType?: "info" | "price" | "stock" | "description" | "specs";
}

export interface RagIndexResult {
  ragDocument: InsertRagDocument;
  chunks: RagChunkResult[];
}

interface ProductLogicalBlock {
  text: string;
  chunkType: "info" | "price" | "stock" | "description" | "specs";
  isCritical: boolean;
}

function buildProductLogicalBlocks(product: Product): ProductLogicalBlock[] {
  const blocks: ProductLogicalBlock[] = [];
  
  const infoParts: string[] = [];
  if (product.name) {
    infoParts.push(`Название: ${product.name}`);
  }
  if (product.sku) {
    infoParts.push(`Артикул: ${product.sku}`);
  }
  if (product.category) {
    infoParts.push(`Категория: ${product.category}`);
  }
  if (infoParts.length > 0) {
    blocks.push({
      text: infoParts.join("\n"),
      chunkType: "info",
      isCritical: false,
    });
  }
  
  if (product.description) {
    blocks.push({
      text: `Описание: ${product.description}`,
      chunkType: "description",
      isCritical: false,
    });
  }
  
  if (product.variants && Array.isArray(product.variants) && product.variants.length > 0) {
    const specsText = `Характеристики:\n${product.variants.map((v: unknown) => {
      if (typeof v === "object" && v !== null) {
        const variant = v as Record<string, unknown>;
        return `- ${variant.name || "Вариант"}: ${variant.value || ""}`;
      }
      return `- ${String(v)}`;
    }).join("\n")}`;
    blocks.push({
      text: specsText,
      chunkType: "specs",
      isCritical: false,
    });
  }
  
  if (product.price !== null && product.price !== undefined) {
    const priceText = `Цена товара "${product.name}": ${product.price} ${product.currency || "RUB"}`;
    blocks.push({
      text: priceText,
      chunkType: "price",
      isCritical: true,
    });
  }
  
  if (product.inStock !== null && product.inStock !== undefined) {
    const stockParts: string[] = [];
    stockParts.push(`Наличие товара "${product.name}": ${product.inStock ? "В наличии" : "Нет в наличии"}`);
    if (product.stockQuantity !== null && product.stockQuantity !== undefined) {
      stockParts.push(`Количество на складе: ${product.stockQuantity} шт.`);
    }
    if (product.deliveryInfo) {
      stockParts.push(`Доставка: ${product.deliveryInfo}`);
    }
    blocks.push({
      text: stockParts.join("\n"),
      chunkType: "stock",
      isCritical: true,
    });
  }
  
  return blocks;
}

function buildProductContent(product: Product): string {
  const blocks = buildProductLogicalBlocks(product);
  return blocks.map(b => b.text).join("\n\n");
}

function buildDocumentContent(doc: KnowledgeDoc): string {
  const parts: string[] = [];
  
  if (doc.title) {
    parts.push(`# ${doc.title}`);
  }
  if (doc.content) {
    parts.push(doc.content);
  }
  
  return parts.join("\n\n");
}

function splitIntoSentences(text: string): string[] {
  return text
    .split(/(?<=[.!?])\s+/)
    .map(s => s.trim())
    .filter(s => s.length > 0);
}

function splitIntoParagraphs(text: string): string[] {
  return text
    .split(/\n\n+/)
    .map(p => p.trim())
    .filter(p => p.length > 0);
}

function chunkContent(
  content: string,
  config: RagIndexerConfig = DEFAULT_CONFIG
): { text: string; tokenCount: number }[] {
  if (!content || content.trim().length === 0) {
    return [];
  }

  const { minTokens, maxTokens, overlapTokens } = config;
  const paragraphs = splitIntoParagraphs(content);
  
  const chunks: { text: string; tokenCount: number }[] = [];
  let currentChunk: string[] = [];
  let currentTokens = 0;

  function finalizeChunk() {
    if (currentChunk.length === 0) return;
    
    const chunkText = currentChunk.join("\n\n").trim();
    if (chunkText.length === 0) return;
    
    const tokenCount = estimateTokenCount(chunkText);
    if (tokenCount === 0) return;
    
    chunks.push({ text: chunkText, tokenCount });
  }

  function buildOverlapBuffer(): { buffer: string[]; tokenCount: number } {
    const buffer: string[] = [];
    let tokenCount = 0;
    
    for (let i = currentChunk.length - 1; i >= 0 && tokenCount < overlapTokens; i--) {
      const itemTokens = estimateTokenCount(currentChunk[i]);
      if (tokenCount + itemTokens <= overlapTokens * 1.5) {
        buffer.unshift(currentChunk[i]);
        tokenCount += itemTokens;
      } else if (tokenCount < overlapTokens * 0.5) {
        buffer.unshift(currentChunk[i]);
        tokenCount += itemTokens;
        break;
      } else {
        break;
      }
    }
    
    return { buffer, tokenCount };
  }

  for (const paragraph of paragraphs) {
    const paragraphTokens = estimateTokenCount(paragraph);
    
    if (paragraphTokens > maxTokens) {
      if (currentChunk.length > 0) {
        finalizeChunk();
        const overlap = buildOverlapBuffer();
        currentChunk = [...overlap.buffer];
        currentTokens = overlap.tokenCount;
      }
      
      const sentences = splitIntoSentences(paragraph);
      for (const sentence of sentences) {
        const sentenceTokens = estimateTokenCount(sentence);
        
        if (currentTokens + sentenceTokens > maxTokens && currentTokens >= minTokens) {
          finalizeChunk();
          const overlap = buildOverlapBuffer();
          currentChunk = [...overlap.buffer];
          currentTokens = overlap.tokenCount;
        }
        
        currentChunk.push(sentence);
        currentTokens += sentenceTokens;
      }
    } else {
      if (currentTokens + paragraphTokens > maxTokens && currentTokens >= minTokens) {
        finalizeChunk();
        const overlap = buildOverlapBuffer();
        currentChunk = [...overlap.buffer];
        currentTokens = overlap.tokenCount;
      }
      
      currentChunk.push(paragraph);
      currentTokens += paragraphTokens;
    }
  }

  if (currentChunk.length > 0) {
    finalizeChunk();
  }

  return chunks;
}

export function indexProduct(
  product: Product,
  _config: RagIndexerConfig = DEFAULT_CONFIG
): RagIndexResult {
  const logicalBlocks = buildProductLogicalBlocks(product);
  const content = logicalBlocks.map(b => b.text).join("\n\n");
  
  const baseMetadata = {
    productId: product.id,
    sku: product.sku || null,
    category: product.category || null,
    priceVersion: product.price !== null ? Date.now() : null,
  };
  
  const ragDocument: InsertRagDocument = {
    tenantId: product.tenantId,
    type: "PRODUCT" as RagDocType,
    sourceId: product.id,
    content,
    metadata: {
      ...baseMetadata,
      name: product.name,
      price: product.price,
      currency: product.currency,
      inStock: product.inStock,
    },
  };
  
  const chunks: RagChunkResult[] = logicalBlocks.map((block, index) => ({
    chunkText: block.text,
    chunkIndex: index,
    tokenCount: estimateTokenCount(block.text),
    chunkType: block.chunkType,
    isCritical: block.isCritical,
    metadata: {
      sourceType: "PRODUCT",
      sourceId: product.id,
      productId: product.id,
      productName: product.name,
      sku: product.sku || null,
      category: product.category || null,
      priceVersion: baseMetadata.priceVersion,
      tenantId: product.tenantId,
      chunkType: block.chunkType,
      isCritical: block.isCritical,
      contentHash: computeContentHash(block.text),
    },
  }));
  
  return { ragDocument, chunks };
}

export function indexDocument(
  doc: KnowledgeDoc,
  config: RagIndexerConfig = DEFAULT_CONFIG
): RagIndexResult {
  const content = buildDocumentContent(doc);
  const rawChunks = chunkContent(content, config);
  
  const ragDocument: InsertRagDocument = {
    tenantId: doc.tenantId,
    type: "DOC" as RagDocType,
    sourceId: doc.id,
    content,
    metadata: {
      category: doc.category || null,
      docType: doc.docType || null,
      title: doc.title,
      tags: doc.tags || [],
    },
  };
  
  const chunks: RagChunkResult[] = rawChunks.map((chunk, index) => ({
    chunkText: chunk.text,
    chunkIndex: index,
    tokenCount: chunk.tokenCount,
    metadata: {
      sourceType: "DOC",
      sourceId: doc.id,
      docTitle: doc.title,
      docType: doc.docType,
      category: doc.category || null,
      tenantId: doc.tenantId,
      contentHash: computeContentHash(chunk.text),
    },
  }));
  
  return { ragDocument, chunks };
}

export function validateRagDocType(type: string | null | undefined): RagDocType | null {
  if (!type) return null;
  if (RAG_DOC_TYPES.includes(type as RagDocType)) {
    return type as RagDocType;
  }
  return null;
}

export interface RagCleanupParams {
  sourceType: RagDocType;
  sourceId: string;
  tenantId: string;
}

export function buildCleanupQuery(params: RagCleanupParams): { type: RagDocType; sourceId: string; tenantId: string } {
  return {
    type: params.sourceType,
    sourceId: params.sourceId,
    tenantId: params.tenantId,
  };
}

export const ragIndexer = {
  indexProduct,
  indexDocument,
  chunkContent,
  validateRagDocType,
  buildCleanupQuery,
  DEFAULT_CONFIG,
};
