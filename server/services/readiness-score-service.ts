import type { IStorage } from "../storage";
import type { ReadinessCheck, ReadinessCheckCode, ReadinessCheckStatus } from "@shared/schema";

export interface ReadinessCheckConfig {
  code: ReadinessCheckCode;
  weight: number;
}

export const READINESS_CHECKS: ReadinessCheckConfig[] = [
  { code: "PRODUCTS_PRESENT", weight: 25 },
  { code: "PRODUCTS_HAVE_PRICE_STOCK", weight: 20 },
  { code: "KB_PRESENT", weight: 20 },
  { code: "RAG_INDEX_READY", weight: 15 },
  { code: "TRAINING_POLICY_SET", weight: 10 },
  { code: "FEW_SHOT_ENABLED", weight: 10 },
  { code: "SMOKE_TEST_PASS", weight: 10 },
];

export interface ReadinessResult {
  score: number;
  checks: ReadinessCheck[];
  recommendations: string[];
}

export async function calculateReadinessScore(
  tenantId: string,
  storage: IStorage,
  featureFlagEnabled: (flag: string) => boolean
): Promise<ReadinessResult> {
  const checks: ReadinessCheck[] = [];
  const recommendations: string[] = [];
  let totalScore = 0;

  const products = await storage.getProductsByTenant(tenantId);
  const productCount = products.length;
  const productsWithPriceStock = products.filter(p => p.price != null && p.price > 0 && p.inStock === true);
  const priceStockPercent = productCount > 0 ? (productsWithPriceStock.length / productCount) * 100 : 0;

  if (productCount >= 10) {
    checks.push({
      code: "PRODUCTS_PRESENT",
      status: "PASS",
      message: `${productCount} товаров загружено`,
      weight: 25,
    });
    totalScore += 25;
  } else if (productCount > 0) {
    checks.push({
      code: "PRODUCTS_PRESENT",
      status: "WARN",
      message: `Только ${productCount} товаров (рекомендуется минимум 10)`,
      weight: 25,
    });
    totalScore += Math.round(25 * (productCount / 10));
    recommendations.push("Добавьте больше товаров для лучшей работы AI");
  } else {
    checks.push({
      code: "PRODUCTS_PRESENT",
      status: "FAIL",
      message: "Нет товаров в каталоге",
      weight: 25,
    });
    recommendations.push("Загрузите товары в каталог");
  }

  if (priceStockPercent >= 70) {
    checks.push({
      code: "PRODUCTS_HAVE_PRICE_STOCK",
      status: "PASS",
      message: `${Math.round(priceStockPercent)}% товаров с ценой и остатками`,
      weight: 20,
    });
    totalScore += 20;
  } else if (priceStockPercent >= 30) {
    checks.push({
      code: "PRODUCTS_HAVE_PRICE_STOCK",
      status: "WARN",
      message: `Только ${Math.round(priceStockPercent)}% товаров с ценой и остатками`,
      weight: 20,
    });
    totalScore += Math.round(20 * (priceStockPercent / 70));
    recommendations.push("Заполните цены и остатки для большего числа товаров");
  } else {
    checks.push({
      code: "PRODUCTS_HAVE_PRICE_STOCK",
      status: "FAIL",
      message: productCount > 0 ? `Только ${Math.round(priceStockPercent)}% товаров с ценой и остатками` : "Нет товаров с ценой и остатками",
      weight: 20,
    });
    if (productCount > 0) {
      recommendations.push("Заполните цены и остатки для товаров");
    }
  }

  const knowledgeDocs = await storage.getKnowledgeDocsByTenant(tenantId);
  const requiredDocTypes = ["delivery", "returns", "faq", "policy"];
  const presentDocTypes = new Set(knowledgeDocs.map(d => d.docType).filter(Boolean));
  const hasRequiredDocs = requiredDocTypes.filter(t => presentDocTypes.has(t));

  if (hasRequiredDocs.length >= 3) {
    checks.push({
      code: "KB_PRESENT",
      status: "PASS",
      message: `${hasRequiredDocs.length} из 4 типов документов в базе знаний`,
      weight: 20,
    });
    totalScore += 20;
  } else if (hasRequiredDocs.length > 0) {
    checks.push({
      code: "KB_PRESENT",
      status: "WARN",
      message: `Только ${hasRequiredDocs.length} из 4 типов документов`,
      weight: 20,
    });
    totalScore += Math.round(20 * (hasRequiredDocs.length / 3));
    const missingTypes = requiredDocTypes.filter(t => !presentDocTypes.has(t));
    recommendations.push(`Добавьте документы: ${missingTypes.join(", ")}`);
  } else {
    checks.push({
      code: "KB_PRESENT",
      status: "FAIL",
      message: "Нет документов в базе знаний",
      weight: 20,
    });
    recommendations.push("Добавьте документы в базу знаний (доставка, возврат, FAQ, политика)");
  }

  const ragEnabled = process.env.RAG_ENABLED === "true";
  const staleChunks = ragEnabled ? await storage.getRagChunksWithoutEmbedding(tenantId, 1) : [];
  const hasEmbeddings = ragEnabled && staleChunks.length === 0;

  if (!ragEnabled) {
    checks.push({
      code: "RAG_INDEX_READY",
      status: "WARN",
      message: "RAG индексация отключена",
      weight: 15,
    });
    totalScore += 8;
    recommendations.push("Включите RAG для улучшенного поиска по базе знаний");
  } else if (hasEmbeddings) {
    checks.push({
      code: "RAG_INDEX_READY",
      status: "PASS",
      message: "RAG индекс готов, все embeddings актуальны",
      weight: 15,
    });
    totalScore += 15;
  } else {
    checks.push({
      code: "RAG_INDEX_READY",
      status: "WARN",
      message: "RAG индекс требует обновления embeddings",
      weight: 15,
    });
    totalScore += 8;
    recommendations.push("Обновите RAG индекс для актуальных embeddings");
  }

  const policy = await storage.getAiTrainingPolicy(tenantId);
  const hasPolicySet = policy && (
    (policy.alwaysEscalateIntents && policy.alwaysEscalateIntents.length > 0) ||
    (policy.forbiddenTopics && policy.forbiddenTopics.length > 0) ||
    (policy.disabledLearningIntents && policy.disabledLearningIntents.length > 0)
  );

  if (hasPolicySet) {
    checks.push({
      code: "TRAINING_POLICY_SET",
      status: "PASS",
      message: "Политики обучения AI настроены",
      weight: 10,
    });
    totalScore += 10;
  } else {
    checks.push({
      code: "TRAINING_POLICY_SET",
      status: "WARN",
      message: "Политики обучения AI не настроены",
      weight: 10,
    });
    totalScore += 5;
    recommendations.push("Настройте политики обучения AI для контроля автоматизации");
  }

  const fewShotEnabled = featureFlagEnabled("FEW_SHOT_LEARNING");
  if (fewShotEnabled) {
    checks.push({
      code: "FEW_SHOT_ENABLED",
      status: "PASS",
      message: "Few-shot обучение включено",
      weight: 10,
    });
    totalScore += 10;
  } else {
    checks.push({
      code: "FEW_SHOT_ENABLED",
      status: "WARN",
      message: "Few-shot обучение отключено",
      weight: 10,
    });
    totalScore += 5;
    recommendations.push("Включите few-shot обучение для улучшения качества ответов");
  }

  const score = Math.min(100, Math.max(0, totalScore));

  return { score, checks, recommendations };
}

export function mergeWithSmokeTestResult(
  readinessResult: ReadinessResult,
  smokeTestCheck: ReadinessCheck | null,
  smokeTestRecommendations: string[]
): ReadinessResult {
  if (!smokeTestCheck) {
    return readinessResult;
  }

  const checks = [...readinessResult.checks, smokeTestCheck];
  const recommendations = [...readinessResult.recommendations, ...smokeTestRecommendations];

  let scoreBonus = 0;
  if (smokeTestCheck.status === "PASS") {
    scoreBonus = smokeTestCheck.weight;
  } else if (smokeTestCheck.status === "WARN") {
    scoreBonus = Math.round(smokeTestCheck.weight / 2);
  }

  const newScore = Math.min(100, readinessResult.score + scoreBonus);

  return {
    score: newScore,
    checks,
    recommendations,
  };
}

export const READINESS_THRESHOLD = 80;
