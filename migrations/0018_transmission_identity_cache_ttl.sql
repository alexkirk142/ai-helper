ALTER TABLE transmission_identity_cache
  ADD COLUMN IF NOT EXISTS expires_at TIMESTAMP;
UPDATE transmission_identity_cache
  SET expires_at = created_at + INTERVAL '30 days'
  WHERE expires_at IS NULL;
