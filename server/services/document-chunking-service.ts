import { DOC_TYPES, type DocType } from "@shared/schema";

export interface ChunkingConfig {
  minTokens: number;
  maxTokens: number;
  overlapTokens: number;
}

export interface ChunkMetadata {
  title: string;
  docType: DocType | null;
  headings: string[];
  chunkIndex: number;
  totalChunks: number;
}

export interface DocumentChunk {
  content: string;
  tokenCount: number;
  metadata: ChunkMetadata;
}

const DEFAULT_CONFIG: ChunkingConfig = {
  minTokens: 300,
  maxTokens: 600,
  overlapTokens: 75,
};

const MIN_OVERLAP_TOKENS = 50;
const MAX_OVERLAP_TOKENS = 100;

export function estimateTokenCount(text: string): number {
  const words = text.split(/\s+/).filter(w => w.length > 0);
  return Math.ceil(words.length * 1.3);
}

function extractHeadings(text: string): string[] {
  const headingPatterns = [
    /^#{1,6}\s+(.+)$/gm,
    /^(.+)\n[=\-]{3,}$/gm,
    /^\*\*(.+)\*\*$/gm,
  ];
  
  const headings: string[] = [];
  for (const pattern of headingPatterns) {
    let match;
    while ((match = pattern.exec(text)) !== null) {
      headings.push(match[1].trim());
    }
  }
  return headings;
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

function buildOverlapBuffer(
  items: string[],
  targetTokens: number
): { buffer: string[]; tokenCount: number } {
  const buffer: string[] = [];
  let tokenCount = 0;
  
  for (let i = items.length - 1; i >= 0 && tokenCount < targetTokens; i--) {
    const itemTokens = estimateTokenCount(items[i]);
    if (tokenCount + itemTokens <= MAX_OVERLAP_TOKENS) {
      buffer.unshift(items[i]);
      tokenCount += itemTokens;
    } else if (tokenCount < MIN_OVERLAP_TOKENS) {
      buffer.unshift(items[i]);
      tokenCount += itemTokens;
      break;
    } else {
      break;
    }
  }
  
  return { buffer, tokenCount };
}

export function chunkDocument(
  content: string,
  title: string,
  docType: DocType | null = null,
  config: ChunkingConfig = DEFAULT_CONFIG
): DocumentChunk[] {
  if (!content || content.trim().length === 0) {
    return [];
  }

  const { minTokens, maxTokens, overlapTokens } = config;
  const headings = extractHeadings(content);
  const paragraphs = splitIntoParagraphs(content);
  
  const chunks: DocumentChunk[] = [];
  let currentChunk: string[] = [];
  let currentTokens = 0;

  function finalizeChunk() {
    if (currentChunk.length === 0) return;
    
    const chunkContent = currentChunk.join("\n\n").trim();
    if (chunkContent.length === 0) return;
    
    const tokenCount = estimateTokenCount(chunkContent);
    if (tokenCount === 0) return;
    
    const chunkHeadings = extractHeadings(chunkContent);
    
    chunks.push({
      content: chunkContent,
      tokenCount,
      metadata: {
        title,
        docType,
        headings: chunkHeadings.length > 0 ? chunkHeadings : headings.slice(0, 3),
        chunkIndex: chunks.length,
        totalChunks: 0,
      },
    });
  }

  for (const paragraph of paragraphs) {
    const paragraphTokens = estimateTokenCount(paragraph);
    
    if (paragraphTokens > maxTokens) {
      if (currentChunk.length > 0) {
        finalizeChunk();
        const overlap = buildOverlapBuffer(currentChunk, overlapTokens);
        currentChunk = [...overlap.buffer];
        currentTokens = overlap.tokenCount;
      }
      
      const sentences = splitIntoSentences(paragraph);
      for (const sentence of sentences) {
        const sentenceTokens = estimateTokenCount(sentence);
        
        if (currentTokens + sentenceTokens > maxTokens && currentTokens >= minTokens) {
          finalizeChunk();
          
          const overlap = buildOverlapBuffer(currentChunk, overlapTokens);
          currentChunk = [...overlap.buffer];
          currentTokens = overlap.tokenCount;
        }
        
        currentChunk.push(sentence);
        currentTokens += sentenceTokens;
      }
    } else {
      if (currentTokens + paragraphTokens > maxTokens && currentTokens >= minTokens) {
        finalizeChunk();
        
        const overlap = buildOverlapBuffer(currentChunk, overlapTokens);
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

  for (const chunk of chunks) {
    chunk.metadata.totalChunks = chunks.length;
  }

  return chunks;
}

export function validateDocType(docType: string | null | undefined): DocType | null {
  if (!docType) return null;
  if (DOC_TYPES.includes(docType as DocType)) {
    return docType as DocType;
  }
  return null;
}

export const documentChunkingService = {
  chunkDocument,
  estimateTokenCount,
  validateDocType,
  DEFAULT_CONFIG,
};
