/**
 * Default gearbox/vehicle lookup reply templates and helpers.
 * Tenant can override via tenants.templates (jsonb).
 */

export const DEFAULT_GEARBOX_TEMPLATES = {
  gearboxLookupFound:
    "По вашему {{idType}} определяется модель КПП: {{model}} (OEM: {{oem}}).\nЕсли есть возможность — пришлите фото шильдика/маркировки КПП для сверки.\nЕсли сейчас не можете — продолжим подбор по OEM.",
  gearboxLookupModelOnly:
    "По {{idType}} определяется модель КПП: {{model}}. OEM номер узла на сайте не отобразился.\nЕсли можете — пришлите фото шильдика/маркировки КПП, чтобы точно определить OEM.",
  gearboxTagRequest:
    "Начал проверку по {{idType}} 👍\nЧтобы точно сверить коробку и исключить ошибку, если есть возможность — пришлите фото шильдика (маркировки) на коробке передач.\nЕсли сейчас не можете — ничего страшного, продолжу подбор по OEM.",
  gearboxLookupFallback:
    "По VIN коробка передач {{gearboxType}} в каталоге не отображается.\nИщу варианты {{gearboxType}} {{make}} {{model}} на основе вашего запроса.\nЕсли есть фото шильдика/маркировки КПП — пришлите, это поможет точнее подобрать.",
  gearboxNoVin:
    "Здравствуйте! Чтобы сразу посчитать цену, нужна маркировка коробки (на шильдике КПП) или VIN. Что можете прислать?",
} as const;

export type GearboxTemplateKey = keyof typeof DEFAULT_GEARBOX_TEMPLATES;

export type GearboxTemplates = {
  gearboxLookupFound?: string | null;
  gearboxLookupModelOnly?: string | null;
  gearboxTagRequest?: string | null;
  gearboxLookupFallback?: string | null;
  gearboxNoVin?: string | null;
};

/** Raw tenant.templates from DB (may be null or partial). */
function getTenantTemplatesRaw(tenant: { templates?: unknown } | null | undefined): GearboxTemplates | null {
  if (!tenant) return null;
  const t = tenant.templates;
  if (t === null || t === undefined) return null;
  if (typeof t !== "object" || Array.isArray(t)) return null;
  return t as GearboxTemplates;
}

export type MergedGearboxTemplates = {
  [K in keyof typeof DEFAULT_GEARBOX_TEMPLATES]: string;
};

/** Merged templates: tenant overrides + defaults. Never null; missing keys use defaults. */
export function getMergedGearboxTemplates(tenant: { templates?: unknown } | null | undefined): MergedGearboxTemplates {
  const raw = getTenantTemplatesRaw(tenant);
  return {
    gearboxLookupFound: (raw?.gearboxLookupFound != null && raw.gearboxLookupFound !== "")
      ? raw.gearboxLookupFound
      : DEFAULT_GEARBOX_TEMPLATES.gearboxLookupFound,
    gearboxLookupModelOnly: (raw?.gearboxLookupModelOnly != null && raw.gearboxLookupModelOnly !== "")
      ? raw.gearboxLookupModelOnly
      : DEFAULT_GEARBOX_TEMPLATES.gearboxLookupModelOnly,
    gearboxTagRequest: (raw?.gearboxTagRequest != null && raw.gearboxTagRequest !== "")
      ? raw.gearboxTagRequest
      : DEFAULT_GEARBOX_TEMPLATES.gearboxTagRequest,
    gearboxLookupFallback: (raw?.gearboxLookupFallback != null && raw.gearboxLookupFallback !== "")
      ? raw.gearboxLookupFallback
      : DEFAULT_GEARBOX_TEMPLATES.gearboxLookupFallback,
    gearboxNoVin: (raw?.gearboxNoVin != null && raw.gearboxNoVin !== "")
      ? raw.gearboxNoVin
      : DEFAULT_GEARBOX_TEMPLATES.gearboxNoVin,
  };
}

export type FillParams = {
  oem?: string | null;
  model?: string | null;
  source?: string | null;
  factoryCode?: string | null;
  gearboxType?: string | null;
  make?: string | null;
  idType?: string | null;
};

/** Replace {{oem}}, {{model}}, {{source}}, {{factoryCode}}, {{gearboxType}}, {{make}}, {{idType}} in template. Null/undefined -> empty string. */
export function fillGearboxTemplate(template: string, params: FillParams): string {
  const oem = params.oem ?? "";
  const model = params.model ?? "";
  const source = params.source ?? "";
  const factoryCode = params.factoryCode ?? "";
  const gearboxType = params.gearboxType ?? "";
  const make = params.make ?? "";
  const idType = params.idType ?? "";
  return template
    .replace(/\{\{oem\}\}/g, oem)
    .replace(/\{\{model\}\}/g, model)
    .replace(/\{\{source\}\}/g, source)
    .replace(/\{\{factoryCode\}\}/g, factoryCode)
    .replace(/\{\{gearboxType\}\}/g, gearboxType)
    .replace(/\{\{make\}\}/g, make)
    .replace(/\{\{idType\}\}/g, idType);
}
