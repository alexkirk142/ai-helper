-- Migration: add skip_auto_response_for_existing to tenants
-- When true, the auto-response is NOT sent if the phone number already
-- exists as a customer record for this tenant (repeat lead protection).

ALTER TABLE tenants ADD COLUMN IF NOT EXISTS skip_auto_response_for_existing BOOLEAN NOT NULL DEFAULT false;
