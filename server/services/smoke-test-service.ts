import { storage } from "../storage";
import { generateWithDecisionEngine, type DecisionResult, type GenerationContext } from "./decision-engine";
import type { ReadinessCheck } from "@shared/schema";

export interface SmokeTestQuestion {
  id: string;
  question: string;
  expectedIntent: string;
  shouldEscalate: boolean;
}

export interface SmokeTestResult {
  question: string;
  intent: string | null;
  decision: string;
  confidence: number;
  usedSourcesCount: number;
  penalties: { type: string; weight: number; reason: string }[];
  explanations: string[];
  hasStaleData: boolean;
  hasConflictingSources: boolean;
  passed: boolean;
}

export interface SmokeTestSummary {
  results: SmokeTestResult[];
  passedCount: number;
  totalCount: number;
  check: ReadinessCheck;
  recommendations: string[];
}

export const SMOKE_TEST_QUESTIONS: SmokeTestQuestion[] = [
  {
    id: "price",
    question: "Сколько стоит ваш самый популярный товар?",
    expectedIntent: "price",
    shouldEscalate: false,
  },
  {
    id: "availability",
    question: "Есть ли в наличии товары из категории 'новинки'?",
    expectedIntent: "availability",
    shouldEscalate: false,
  },
  {
    id: "delivery",
    question: "Как происходит доставка и сколько это стоит?",
    expectedIntent: "shipping",
    shouldEscalate: false,
  },
  {
    id: "returns",
    question: "Могу ли я вернуть товар, если он мне не подойдёт?",
    expectedIntent: "return",
    shouldEscalate: false,
  },
  {
    id: "complaint",
    question: "Я очень недоволен качеством вашего сервиса, хочу пожаловаться и получить скидку!",
    expectedIntent: "complaint",
    shouldEscalate: true,
  },
];

export const SMOKE_TEST_WEIGHT = 10;

export interface SmokeTestProgress {
  current: number;
  total: number;
  questionId: string;
}

export type ProgressCallback = (progress: SmokeTestProgress) => void;

export async function runSmokeTest(
  tenantId: string,
  onProgress?: ProgressCallback
): Promise<SmokeTestSummary> {
  const results: SmokeTestResult[] = [];
  const recommendations: string[] = [];

  const tenant = await storage.getTenant(tenantId);
  if (!tenant) {
    throw new Error("Tenant not found");
  }

  const products = await storage.getProductsByTenant(tenantId);
  const docs = await storage.getKnowledgeDocsByTenant(tenantId);
  const total = SMOKE_TEST_QUESTIONS.length;

  for (let i = 0; i < SMOKE_TEST_QUESTIONS.length; i++) {
    const testQuestion = SMOKE_TEST_QUESTIONS[i];
    
    if (onProgress) {
      onProgress({ current: i, total, questionId: testQuestion.id });
    }
    try {
      const context: GenerationContext = {
        conversationId: `smoke-test-${testQuestion.id}`,
        tenantId,
        tenant,
        customerMessage: testQuestion.question,
        conversationHistory: [],
        products,
        docs,
        customerMemory: null,
      };

      const result: DecisionResult = await generateWithDecisionEngine(context);

      const hasStaleData = result.penalties.some(p => p.code === "STALE_DATA");
      const hasConflictingSources = result.penalties.some(p => p.code === "CONFLICTING_SOURCES");

      const hasSources = result.usedSources.length > 0;
      const noMajorPenalties = !hasStaleData && !hasConflictingSources;

      let passed: boolean;
      if (testQuestion.shouldEscalate) {
        const didEscalate = result.decision === "ESCALATE" || result.needsHandoff;
        passed = didEscalate && noMajorPenalties;
      } else {
        passed = hasSources && noMajorPenalties;
      }

      results.push({
        question: testQuestion.question,
        intent: result.intent,
        decision: result.decision,
        confidence: result.confidence.total,
        usedSourcesCount: result.usedSources.length,
        penalties: result.penalties.map(p => ({
          type: p.code,
          weight: p.value,
          reason: p.message,
        })),
        explanations: result.explanations,
        hasStaleData,
        hasConflictingSources,
        passed,
      });
    } catch (error) {
      console.error(`[SmokeTest] Error testing question "${testQuestion.id}":`, error);
      results.push({
        question: testQuestion.question,
        intent: null,
        decision: "ERROR",
        confidence: 0,
        usedSourcesCount: 0,
        penalties: [],
        explanations: [(error as Error).message],
        hasStaleData: false,
        hasConflictingSources: false,
        passed: false,
      });
    }
  }

  const passedCount = results.filter(r => r.passed).length;
  const totalCount = results.length;

  const resultsByQuestionId = new Map<string, SmokeTestResult>();
  for (let i = 0; i < results.length; i++) {
    resultsByQuestionId.set(SMOKE_TEST_QUESTIONS[i].id, results[i]);
  }

  const priceTest = resultsByQuestionId.get("price");
  if (priceTest && !priceTest.passed && priceTest.usedSourcesCount === 0) {
    recommendations.push("Добавьте цены товаров для корректных ответов на вопросы о стоимости");
  }

  const availabilityTest = resultsByQuestionId.get("availability");
  if (availabilityTest && !availabilityTest.passed && availabilityTest.usedSourcesCount === 0) {
    recommendations.push("Заполните информацию о наличии товаров");
  }

  const deliveryTest = resultsByQuestionId.get("delivery");
  if (deliveryTest && !deliveryTest.passed && deliveryTest.usedSourcesCount === 0) {
    recommendations.push("Добавьте документ о доставке в базу знаний");
  }

  const returnsTest = resultsByQuestionId.get("returns");
  if (returnsTest && !returnsTest.passed && returnsTest.usedSourcesCount === 0) {
    recommendations.push("Добавьте документ о возвратах в базу знаний");
  }

  const hasStaleDataIssues = results.some(r => r.hasStaleData);
  if (hasStaleDataIssues) {
    recommendations.push("Обновите устаревшие данные в базе знаний (переиндексируйте RAG)");
  }

  let check: ReadinessCheck;
  if (passedCount >= 4) {
    check = {
      code: "SMOKE_TEST_PASS",
      status: "PASS",
      message: `${passedCount}/${totalCount} тестов пройдено`,
      weight: SMOKE_TEST_WEIGHT,
    };
  } else if (passedCount >= 2) {
    check = {
      code: "SMOKE_TEST_PASS",
      status: "WARN",
      message: `Только ${passedCount}/${totalCount} тестов пройдено`,
      weight: SMOKE_TEST_WEIGHT,
    };
  } else {
    check = {
      code: "SMOKE_TEST_PASS",
      status: "FAIL",
      message: `${passedCount}/${totalCount} тестов пройдено`,
      weight: SMOKE_TEST_WEIGHT,
    };
  }

  return {
    results,
    passedCount,
    totalCount,
    check,
    recommendations,
  };
}
