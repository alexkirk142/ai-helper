ALTER TABLE ai_suggestions
  ADD COLUMN IF NOT EXISTS escalation_data JSONB;
