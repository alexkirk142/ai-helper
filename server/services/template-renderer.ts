/**
 * Template renderer — replaces {{variable_name}} placeholders with actual values.
 * Variables not supplied in the `variables` map are left as-is (not blanked out),
 * so operators can see which variables are missing when previewing.
 */

export type TemplateType = "price_result" | "payment_options" | "tag_request" | "not_found" | "price_options";

/** Documented variables per template type (for UI hints). */
export const TEMPLATE_VARIABLES: Record<TemplateType, string[]> = {
  price_result: [
    "transmission_model",
    "oem",
    "min_price",
    "max_price",
    "avg_price",
    "origin",
    "manufacturer",
    "car_brand",
    "date",
    "mileage_min",
    "mileage_max",
    "mileage_range",
    "listings_count",
  ],
  price_options: [
    "transmission_model",
    "oem",
    "manufacturer",
    "origin",
    "budget_price",
    "budget_mileage",
    "mid_price",
    "mid_mileage",
    "quality_price",
    "quality_mileage",
    "listings_count",
    "date",
  ],
  payment_options: [],
  tag_request: [],
  not_found: [],
};

/** Sample values used by the /api/templates/preview endpoint. */
export const TEMPLATE_SAMPLE_VALUES: Record<string, string> = {
  transmission_model: "АКПП U760E",
  oem: "3530060360",
  min_price: "45 000",
  max_price: "65 000",
  avg_price: "55 000",
  origin: "Япония",
  manufacturer: "Toyota",
  car_brand: "Toyota Camry",
  date: new Date().toLocaleDateString("ru-RU"),
  mileage_min: "63 000",
  mileage_max: "95 000",
  mileage_range: "63 000 — 95 000 км",
  listings_count: "7",
  // price_options tier variables
  budget_price: "44 000",
  budget_mileage: "98 000",
  mid_price: "57 000",
  mid_mileage: "74 000",
  quality_price: "71 000",
  quality_mileage: "52 000",
};

/**
 * Render a template string by substituting `{{variable_name}}` tokens.
 *
 * @param content   Raw template text
 * @param variables Map of variable names to replacement values.
 *                  Values are coerced to strings.
 *                  Unknown variables are left untouched.
 */
export function renderTemplate(
  content: string,
  variables: Record<string, string | number>
): string {
  return content.replace(/\{\{(\w+)\}\}/g, (match, key: string) => {
    if (Object.prototype.hasOwnProperty.call(variables, key)) {
      return String(variables[key]);
    }
    return match; // leave unknown variables unchanged
  });
}

/** Default template contents seeded for every new tenant. */
export const DEFAULT_TEMPLATES: Array<{
  type: TemplateType;
  name: string;
  content: string;
  order: number;
}> = [
  {
    type: "price_result",
    name: "Результат поиска цены",
    content:
      "Нашёл для вас контрактную {{transmission_model}} (OEM: {{oem}}).\n\n" +
      "💰 Стоимость: {{min_price}} — {{max_price}} ₽\n" +
      "📊 Средняя цена: {{avg_price}} ₽\n\n" +
      "Есть в наличии. Готов ответить на все вопросы!",
    order: 0,
  },
  {
    type: "price_options",
    name: "Варианты по цене и пробегу",
    content:
      "Нашёл варианты контрактной {{transmission_model}} (OEM: {{oem}}):\n\n" +
      "📦 Эконом — от {{budget_price}} ₽\n" +
      "🔧 Пробег до {{budget_mileage}} км\n\n" +
      "📦 Оптимум — от {{mid_price}} ₽\n" +
      "🔧 Пробег до {{mid_mileage}} км\n\n" +
      "📦 Минимальный пробег — от {{quality_price}} ₽\n" +
      "🔧 Пробег до {{quality_mileage}} км\n\n" +
      "Все контрактные, не использовались в РФ.\n" +
      "Что важнее — цена или минимальный пробег?",
    order: 1,
  },
  {
    type: "not_found",
    name: "Не найдено / уточнение цены",
    content:
      "Есть в наличии, уточним стоимость для вас. Оставьте контакт — свяжемся в течение часа.",
    order: 0,
  },
];
