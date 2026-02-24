import { storage } from "../storage";
import type { AiTrainingSample } from "@shared/schema";
import { sanitizeString } from "../utils/sanitizer";

// Static built-in examples for new intents.
// Included as fallback when the DB has no approved training samples for a given intent.
// Real dialog examples from production conversations.
export const BUILTIN_FEW_SHOT_EXAMPLES: FewShotExample[] = [
  // photo_request
  {
    userMessage: "Есть фото или видео коробки?",
    assistantReply: "Сделал запрос на склад, по ответу скину фото.",
    intent: "photo_request",
    category: null,
    score: 1.0,
  },
  {
    userMessage: "Можете фото прислать?",
    assistantReply: "Сделал запрос на склад, по ответу скину Вам фото.",
    intent: "photo_request",
    category: null,
    score: 1.0,
  },
  // ready_to_buy
  {
    userMessage: "Как заключается договор?",
    assistantReply:
      "Для оформления заказа напишите: ФИО, контактный номер телефона, email, адрес ближайшего пункта доставки, адрес прописки или регистрации, выбранный вариант оплаты.",
    intent: "ready_to_buy",
    category: null,
    score: 1.0,
  },
  {
    userMessage: "Давайте оформляем",
    assistantReply:
      "Отлично! Напишите пожалуйста: ФИО, телефон, email, адрес пункта СДЭК, адрес прописки и вариант оплаты.",
    intent: "ready_to_buy",
    category: null,
    score: 1.0,
  },
  // payment_blocked
  {
    userMessage: "Банк заблокировал платёж",
    assistantReply:
      "Это стандартная ситуация при крупных суммах — банки усилили проверки. Попробуйте подтвердить платёж звонком на номер с обратной стороны карты, или оплатите с другой карты.",
    intent: "payment_blocked",
    category: null,
    score: 1.0,
  },
  {
    userMessage: "Не проходит оплата, блокируют",
    assistantReply:
      "Такое бывает при первых крупных онлайн-платежах. Позвоните в банк и подтвердите что это вы делаете платёж. Если не поможет — попробуйте другой банк или карту.",
    intent: "payment_blocked",
    category: null,
    score: 1.0,
  },
  // warranty_question
  {
    userMessage: "Гарантия действует если сам установлю в гараже?",
    assistantReply:
      "Да, гарантия действует. Главное условие — агрегат не должен вскрываться, пломбировочная краска должна быть целой. Установить можно самостоятельно.",
    intent: "warranty_question",
    category: null,
    score: 1.0,
  },
  {
    userMessage: "Какие условия гарантии?",
    assistantReply:
      "Гарантия 12 месяцев или 30 000 км. Дополнительно 14 дней на установку после получения. Условие: агрегат не вскрывался и не имеет следов внешнего воздействия.",
    intent: "warranty_question",
    category: null,
    score: 1.0,
  },
  // what_included
  {
    userMessage: "ЭБУ с коробкой идёт?",
    assistantReply:
      "Да, коробка полностью укомплектована всем необходимым — взял, поставил и поехал.",
    intent: "what_included",
    category: null,
    score: 1.0,
  },
  {
    userMessage: "Навесное оборудование в комплекте?",
    assistantReply:
      "Коробка полностью укомплектована, всё необходимое для установки включено.",
    intent: "what_included",
    category: null,
    score: 1.0,
  },
  // invalid_vin
  {
    userMessage: "XWBDD45J59K500790",
    assistantReply:
      "Проверьте пожалуйста ВИН код — возможно опечатка. ВИН состоит из 17 символов, без букв И, О, Q.",
    intent: "invalid_vin",
    category: null,
    score: 1.0,
  },
  // mileage_preference
  {
    userMessage: "Лучше подешевле",
    assistantReply:
      "Отлично! Для вас оптимален вариант с пробегом до {{budget_mileage}} км по цене от {{budget_price}} ₽. " +
      "Есть в наличии, контрактная. Оформляем?",
    intent: "mileage_preference",
    category: null,
    score: 1.0,
  },
  {
    userMessage: "Хочу с минимальным пробегом",
    assistantReply:
      "Есть отличный вариант — пробег до {{quality_mileage}} км, цена от {{quality_price}} ₽. " +
      "Контрактная, не использовалась в РФ. Оформляем?",
    intent: "mileage_preference",
    category: null,
    score: 1.0,
  },
];

export interface FewShotConfig {
  maxExamples: number;
  maxTokens: number;
  minConfidence: number;
  preferredIntent?: string;
  preferredCategory?: string;
}

export const DEFAULT_FEW_SHOT_CONFIG: FewShotConfig = {
  maxExamples: 5,
  maxTokens: 1500,
  minConfidence: 0.7,
};

export interface FewShotExample {
  userMessage: string;
  assistantReply: string;
  intent: string | null;
  category: string | null;
  score: number;
}

export interface FewShotResult {
  examples: FewShotExample[];
  promptBlock: string;
  totalTokens: number;
  groupedByIntent: Map<string, FewShotExample[]>;
}

const TOKENS_PER_CHAR = 0.25;

function estimateTokens(text: string): number {
  return Math.ceil(text.length * TOKENS_PER_CHAR);
}

function extractCategoryFromSample(sample: AiTrainingSample): string | null {
  return null;
}

function scoreExample(
  sample: AiTrainingSample,
  config: FewShotConfig
): number {
  let score = 1.0;
  
  if (sample.outcome === "EDITED") {
    score += 0.5;   // operator corrected the AI → highest training signal
  } else if (sample.outcome === "APPROVED") {
    score += 0.2;   // AI was already correct → lower priority
  }
  
  if (config.preferredIntent && sample.intent === config.preferredIntent) {
    score += 0.5;
  }
  
  const category = extractCategoryFromSample(sample);
  if (config.preferredCategory && category === config.preferredCategory) {
    score += 0.3;
  }
  
  if (sample.decision === "AUTO_SEND") {
    score += 0.15;
  }
  
  return score;
}

function isHighConfidence(sample: AiTrainingSample, minConfidence: number): boolean {
  if (sample.decision === "AUTO_SEND") {
    return true;
  }
  if (sample.decision === "NEED_APPROVAL" && sample.outcome === "APPROVED") {
    return true;
  }
  if (sample.outcome === "EDITED") {
    return true;
  }
  return false;
}

export async function selectFewShotExamples(
  tenantId: string,
  config: Partial<FewShotConfig> = {}
): Promise<FewShotExample[]> {
  const fullConfig: FewShotConfig = { ...DEFAULT_FEW_SHOT_CONFIG, ...config };
  
  const allSamples = await storage.getAiTrainingSamplesByTenant(tenantId);
  const policy = await storage.getAiTrainingPolicy(tenantId);
  const disabledIntents = policy?.disabledLearningIntents ?? [];
  
  const eligibleSamples = allSamples.filter(sample => {
    if (sample.outcome !== "APPROVED" && sample.outcome !== "EDITED") {
      return false;
    }
    
    if (!sample.finalAnswer || sample.finalAnswer.trim() === "") {
      return false;
    }
    
    if (!isHighConfidence(sample, fullConfig.minConfidence)) {
      return false;
    }
    
    if (disabledIntents.length > 0 && sample.intent && disabledIntents.includes(sample.intent)) {
      return false;
    }
    
    return true;
  });
  
  const scoredSamples = eligibleSamples.map(sample => ({
    sample,
    score: scoreExample(sample, fullConfig),
  }));
  
  scoredSamples.sort((a, b) => b.score - a.score);
  
  const selected = scoredSamples.slice(0, fullConfig.maxExamples);
  
  const dbExamples: FewShotExample[] = selected.map(({ sample, score }) => ({
    userMessage: sample.userMessage,
    assistantReply: sample.finalAnswer!,
    intent: sample.intent,
    category: extractCategoryFromSample(sample),
    score,
  }));

  // Merge built-in static examples for intents not yet covered by DB training data.
  // Only inject up to 2 built-in examples per uncovered intent so DB-approved samples
  // always take precedence when they exist.
  const coveredIntents = new Set(dbExamples.map(e => e.intent));
  const builtinToAdd = BUILTIN_FEW_SHOT_EXAMPLES.filter(
    e => !coveredIntents.has(e.intent) &&
         !(disabledIntents.length > 0 && e.intent && disabledIntents.includes(e.intent))
  );

  return [...dbExamples, ...builtinToAdd];
}

export function groupByIntent(examples: FewShotExample[]): Map<string, FewShotExample[]> {
  const grouped = new Map<string, FewShotExample[]>();
  
  for (const example of examples) {
    const key = example.intent || "other";
    const existing = grouped.get(key) || [];
    existing.push(example);
    grouped.set(key, existing);
  }
  
  return grouped;
}

export function buildFewShotPromptBlock(
  examples: FewShotExample[],
  maxTokens: number
): { promptBlock: string; totalTokens: number; usedExamples: FewShotExample[] } {
  if (examples.length === 0) {
    return { promptBlock: "", totalTokens: 0, usedExamples: [] };
  }
  
  const header = "\n## Примеры успешных ответов:\n\n";
  let promptBlock = header;
  let totalTokens = estimateTokens(header);
  const usedExamples: FewShotExample[] = [];
  
  for (const example of examples) {
    const safeUserMessage = sanitizeString(example.userMessage);
    const safeAssistantReply = sanitizeString(example.assistantReply);
    const exampleBlock = `Клиент: ${safeUserMessage}\nОператор: ${safeAssistantReply}\n\n`;
    const exampleTokens = estimateTokens(exampleBlock);
    
    if (totalTokens + exampleTokens > maxTokens) {
      break;
    }
    
    promptBlock += exampleBlock;
    totalTokens += exampleTokens;
    usedExamples.push(example);
  }
  
  if (usedExamples.length === 0) {
    return { promptBlock: "", totalTokens: 0, usedExamples: [] };
  }
  
  return { promptBlock, totalTokens, usedExamples };
}

export async function buildFewShotBlock(
  tenantId: string,
  config: Partial<FewShotConfig> = {}
): Promise<FewShotResult> {
  const fullConfig: FewShotConfig = { ...DEFAULT_FEW_SHOT_CONFIG, ...config };
  
  const examples = await selectFewShotExamples(tenantId, fullConfig);
  
  const groupedByIntent = groupByIntent(examples);
  
  const { promptBlock, totalTokens, usedExamples } = buildFewShotPromptBlock(
    examples,
    fullConfig.maxTokens
  );
  
  return {
    examples: usedExamples,
    promptBlock,
    totalTokens,
    groupedByIntent,
  };
}

export const fewShotBuilder = {
  selectFewShotExamples,
  groupByIntent,
  buildFewShotPromptBlock,
  buildFewShotBlock,
  estimateTokens,
  DEFAULT_FEW_SHOT_CONFIG,
};
