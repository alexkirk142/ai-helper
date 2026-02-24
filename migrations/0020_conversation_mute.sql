ALTER TABLE conversations ADD COLUMN IF NOT EXISTS is_muted boolean NOT NULL DEFAULT false;
