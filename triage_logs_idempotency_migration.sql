-- ================================================================
-- Migration: triage_logs idempotency
-- ================================================================
-- Adds whatsapp_message_id column + partial unique index to triage_logs
-- enabling cross-restart webhook-retry deduplication. See lib/session.js
-- logTriage() for the code-side change to enable the upsert path
-- after this migration is applied.
--
-- Context: Meta webhook dedup is currently in-memory (index.js
-- _seenMessages Set, 5-min TTL). This handles the common retry case
-- but loses state on server restart. A retry delivered after a restart
-- will be processed again, inserting a duplicate triage_logs row.
-- At pilot traffic levels this is rare (<1/week expected) but makes
-- concordance analysis noisier.
--
-- This migration is SAFE TO APPLY ONLINE. Partial unique index with
-- WHERE clause allows NULL whatsapp_message_id rows (legacy data)
-- without conflict.
-- ================================================================

BEGIN;

-- Step 1: add column (nullable, so existing rows don't block)
ALTER TABLE triage_logs
  ADD COLUMN IF NOT EXISTS whatsapp_message_id TEXT;

-- Step 2: partial unique index on (patient_id, whatsapp_message_id)
-- where the message_id is NOT NULL. This blocks duplicate inserts for
-- new rows while allowing legacy rows (which have NULL) to coexist.
CREATE UNIQUE INDEX IF NOT EXISTS triage_logs_patient_msg_uniq
  ON triage_logs (patient_id, whatsapp_message_id)
  WHERE whatsapp_message_id IS NOT NULL;

COMMIT;

-- After this migration lands, update lib/session.js logTriage():
-- 1. Remove the defensive `delete entry.whatsapp_message_id` block
-- 2. Replace `.insert(entry)` with:
--    if (entry.whatsapp_message_id) {
--      await _supabase.from('triage_logs')
--        .upsert(entry, { onConflict: 'patient_id,whatsapp_message_id' });
--    } else {
--      await _supabase.from('triage_logs').insert(entry);
--    }
-- 3. Update index.js logTriage() callers to pass whatsapp_message_id
--    from msgObj.id on the webhook path.
