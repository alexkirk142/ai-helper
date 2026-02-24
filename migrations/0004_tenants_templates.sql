-- Migration: Add tenant templates (gearbox lookup texts)
-- Adds jsonb column templates to tenants for configurable reply texts.

ALTER TABLE tenants ADD COLUMN IF NOT EXISTS templates JSONB DEFAULT '{}';

COMMENT ON COLUMN tenants.templates IS 'Tenant text templates: gearboxLookupFound, gearboxLookupModelOnly, gearboxTagRequest (placeholders: {{oem}}, {{model}}, {{source}})';
