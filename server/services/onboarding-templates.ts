import OpenAI from "openai";
import { z } from "zod";

export const templateOptionsSchema = z.object({
  includeFaq: z.boolean().default(true),
  includePolicy: z.boolean().default(true),
  includeDelivery: z.boolean().default(true),
  includeReturns: z.boolean().default(true),
});

export type TemplateOptions = z.infer<typeof templateOptionsSchema>;

export const DOC_TYPES = ["policy", "faq", "delivery", "returns"] as const;
export type DocType = typeof DOC_TYPES[number];

export interface TemplateDraft {
  title: string;
  docType: DocType;
  content: string;
}

export interface GenerateTemplatesInput {
  businessName: string;
  businessDescription?: string;
  categories?: string[];
  deliveryInfo?: string;
  returnsInfo?: string;
  paymentInfo?: string;
  discountInfo?: string;
}

const openai = new OpenAI({
  apiKey: process.env.AI_INTEGRATIONS_OPENAI_API_KEY || process.env.OPENAI_API_KEY || "sk-placeholder",
  baseURL: process.env.AI_INTEGRATIONS_OPENAI_BASE_URL || undefined,
});

function buildPrompt(input: GenerateTemplatesInput, docType: DocType): string {
  const categories = Array.isArray(input.categories) 
    ? input.categories 
    : (typeof input.categories === 'string' ? [input.categories] : []);
    
  const businessContext = `
Бизнес: ${input.businessName}
${input.businessDescription ? `Описание: ${input.businessDescription}` : ""}
${categories.length ? `Категории товаров: ${categories.join(", ")}` : ""}
${input.deliveryInfo ? `Доставка: ${input.deliveryInfo}` : ""}
${input.returnsInfo ? `Возвраты: ${input.returnsInfo}` : ""}
${input.paymentInfo ? `Оплата: ${input.paymentInfo}` : ""}
${input.discountInfo ? `Скидки: ${input.discountInfo}` : ""}
`.trim();

  const prompts: Record<DocType, string> = {
    policy: `Создай документ "Политика магазина" для интернет-магазина.
${businessContext}

Требования:
- 3-5 коротких секций
- Русский язык
- Формальный тон
- Без персональных данных (телефонов, email, имён)
- Секции: Общие положения, Условия покупки, Гарантии, Конфиденциальность

Формат: markdown с заголовками ##`,

    faq: `Создай документ "Часто задаваемые вопросы (FAQ)" для интернет-магазина.
${businessContext}

Требования:
- 5-8 вопросов и ответов
- Русский язык
- Дружелюбный тон
- Без персональных данных
- Темы: заказ, оплата, доставка, возврат, гарантия

Формат: markdown, каждый вопрос с "### Q:" и ответ с "A:"`,

    delivery: `Создай документ "Условия доставки" для интернет-магазина.
${businessContext}

Требования:
- 3-5 секций
- Русский язык
- Чёткие условия
- Без персональных данных
- Секции: Способы доставки, Сроки, Стоимость, Зоны доставки, Отслеживание

Формат: markdown с заголовками ##`,

    returns: `Создай документ "Политика возврата и обмена" для интернет-магазина.
${businessContext}

Требования:
- 3-5 секций
- Русский язык
- Юридически корректный тон
- Без персональных данных
- Секции: Условия возврата, Сроки, Процедура, Исключения, Возврат денег

Формат: markdown с заголовками ##`,
  };

  return prompts[docType];
}

export async function generateTemplate(
  input: GenerateTemplatesInput,
  docType: DocType
): Promise<TemplateDraft> {
  const prompt = buildPrompt(input, docType);
  
  const titles: Record<DocType, string> = {
    policy: "Политика магазина",
    faq: "Часто задаваемые вопросы",
    delivery: "Условия доставки",
    returns: "Возврат и обмен",
  };

  try {
    const response = await openai.chat.completions.create({
      model: "gpt-4o",
      messages: [
        {
          role: "system",
          content: "Ты — помощник для создания документации интернет-магазина. Создавай краткие, профессиональные документы на русском языке без персональных данных.",
        },
        {
          role: "user",
          content: prompt,
        },
      ],
      max_tokens: 1000,
      temperature: 0.7,
    });

    const content = response.choices[0]?.message?.content || "";
    
    return {
      title: titles[docType],
      docType,
      content: content.trim(),
    };
  } catch (error) {
    console.error(`Error generating ${docType} template:`, error);
    return {
      title: titles[docType],
      docType,
      content: getFallbackContent(docType, input.businessName),
    };
  }
}

function getFallbackContent(docType: DocType, businessName: string): string {
  const fallbacks: Record<DocType, string> = {
    policy: `## Политика магазина "${businessName}"

### Общие положения
Добро пожаловать в наш магазин. Совершая покупку, вы соглашаетесь с условиями данной политики.

### Условия покупки
Все цены указаны в рублях и включают НДС. Оплата принимается банковскими картами и наличными.

### Гарантии
На все товары действует гарантия производителя. Гарантийный срок указан в карточке товара.`,

    faq: `## Часто задаваемые вопросы

### Q: Как оформить заказ?
A: Добавьте товары в корзину и оформите заказ, указав контактные данные и адрес доставки.

### Q: Какие способы оплаты доступны?
A: Мы принимаем банковские карты, оплату при получении и банковские переводы.

### Q: Как отследить заказ?
A: После отправки вы получите трек-номер для отслеживания.

### Q: Можно ли вернуть товар?
A: Да, в течение 14 дней при сохранении товарного вида.`,

    delivery: `## Условия доставки "${businessName}"

### Способы доставки
- Курьерская доставка
- Самовывоз из пункта выдачи
- Почтовая доставка

### Сроки
Доставка осуществляется в течение 1-7 рабочих дней в зависимости от региона.

### Стоимость
Стоимость доставки рассчитывается при оформлении заказа.`,

    returns: `## Возврат и обмен "${businessName}"

### Условия возврата
Товар надлежащего качества можно вернуть в течение 14 дней.

### Процедура
Свяжитесь с нами для оформления возврата. Товар должен сохранить товарный вид.

### Возврат денег
Деньги возвращаются в течение 10 рабочих дней после получения товара.`,
  };

  return fallbacks[docType];
}

export async function generateTemplates(
  input: GenerateTemplatesInput,
  options: TemplateOptions
): Promise<TemplateDraft[]> {
  const drafts: TemplateDraft[] = [];
  const typesToGenerate: DocType[] = [];

  if (options.includePolicy) typesToGenerate.push("policy");
  if (options.includeFaq) typesToGenerate.push("faq");
  if (options.includeDelivery) typesToGenerate.push("delivery");
  if (options.includeReturns) typesToGenerate.push("returns");

  for (const docType of typesToGenerate) {
    const draft = await generateTemplate(input, docType);
    drafts.push(draft);
  }

  return drafts;
}

export const applyDraftsSchema = z.object({
  drafts: z.array(z.object({
    title: z.string().min(1),
    docType: z.enum(DOC_TYPES),
    content: z.string().min(1),
  })),
});

export type ApplyDraftsInput = z.infer<typeof applyDraftsSchema>;
