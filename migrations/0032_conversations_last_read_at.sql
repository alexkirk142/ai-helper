-- Add last_read_at to conversations: tracks when the contact last read our outgoing messages (read receipt from MAX gateway)
ALTER TABLE "conversations" ADD COLUMN IF NOT EXISTS "last_read_at" timestamp;
