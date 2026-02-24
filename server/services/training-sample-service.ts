import { storage } from "../storage";
import type { AiSuggestion, InsertAiTrainingSample, AiTrainingSample } from "@shared/schema";
import { sanitizeForPrompt } from "../utils/sanitizer";

export type TrainingOutcome = "APPROVED" | "EDITED" | "REJECTED";

interface RecordSampleParams {
  suggestion: AiSuggestion;
  userMessage: string;
  finalAnswer: string | null; // null for REJECTED
  outcome: TrainingOutcome;
  tenantId: string;
  rejectionReason?: string | null; // reason for REJECTED outcomes
}

function containsForbiddenTopic(text: string, forbiddenTopics: string[]): boolean {
  if (!forbiddenTopics || forbiddenTopics.length === 0) return false;
  const lowerText = text.toLowerCase();
  return forbiddenTopics.some(topic => lowerText.includes(topic.toLowerCase()));
}

export async function recordTrainingSample(params: RecordSampleParams): Promise<AiTrainingSample | null> {
  const { suggestion, userMessage, finalAnswer, outcome, tenantId, rejectionReason } = params;

  const policy = await storage.getAiTrainingPolicy(tenantId);
  if (policy?.forbiddenTopics && policy.forbiddenTopics.length > 0) {
    const textToCheck = `${userMessage} ${suggestion.suggestedReply} ${finalAnswer || ""}`;
    if (containsForbiddenTopic(textToCheck, policy.forbiddenTopics)) {
      console.warn(
        `[TrainingSample] Sample dropped — forbidden topic matched. ` +
        `intent=${suggestion.intent}, outcome=${outcome}, ` +
        `conversationId=${suggestion.conversationId}`
      );
      return null;
    }
  }

  const sample: InsertAiTrainingSample = {
    tenantId,
    conversationId: suggestion.conversationId,
    userMessage,
    aiSuggestion: suggestion.suggestedReply,
    finalAnswer,
    intent: suggestion.intent || null,
    decision: suggestion.decision || null,
    outcome,
    rejectionReason: rejectionReason || null,
  };

  return storage.createAiTrainingSample(sample);
}

export async function getTrainingSamples(
  tenantId: string,
  outcome?: TrainingOutcome
): Promise<AiTrainingSample[]> {
  return storage.getAiTrainingSamplesByTenant(tenantId, outcome);
}

export async function getTrainingSamplesCount(tenantId: string): Promise<number> {
  return storage.getAiTrainingSamplesCount(tenantId);
}

export interface ExportFormat {
  version: string;
  exportedAt: string;
  tenantId: string;
  totalSamples: number;
  samples: ExportedSample[];
}

export interface ExportedSample {
  userMessage: string;
  aiSuggestion: string;
  finalAnswer: string | null;
  intent: string | null;
  decision: string | null;
  outcome: string;
  rejectionReason: string | null;
  createdAt: string;
}

export async function exportTrainingSamples(
  tenantId: string,
  outcome?: TrainingOutcome
): Promise<ExportFormat> {
  const samples = await getTrainingSamples(tenantId, outcome);

  const exportedSamples: ExportedSample[] = samples.map(s => ({
    userMessage: sanitizeForPrompt(s.userMessage),
    aiSuggestion: sanitizeForPrompt(s.aiSuggestion),
    finalAnswer: s.finalAnswer ? sanitizeForPrompt(s.finalAnswer) : null,
    intent: s.intent,
    decision: s.decision,
    outcome: s.outcome,
    rejectionReason: s.rejectionReason ? sanitizeForPrompt(s.rejectionReason) : null,
    createdAt: s.createdAt.toISOString(),
  }));

  return {
    version: "1.0",
    exportedAt: new Date().toISOString(),
    tenantId,
    totalSamples: exportedSamples.length,
    samples: exportedSamples,
  };
}

export const trainingSampleService = {
  recordTrainingSample,
  getTrainingSamples,
  getTrainingSamplesCount,
  exportTrainingSamples,
};
