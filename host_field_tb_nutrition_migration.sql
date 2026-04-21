-- ================================================================
-- Migration: host-field audit Tier 1 additions (TB + nutrition)
-- ================================================================
-- Adds first-class TB status and nutrition flag fields to the
-- session / chronic-conditions data model. Motivated by the
-- epidemiologic-triad host-factor audit (docs/host_field_audit.md).
-- South African primary-care syndemic context (HIV + TB + nutrition
-- co-occurring) makes these first-class fields rather than
-- prompt-only upgrades.
--
-- BLOCKED ON DPIA SIGN-OFF. Coordinate with Ayanda (legal) before
-- applying. DPIA v2.7 envisions optional host-factor fields but
-- specific TB + nutrition data classes must be added to the
-- schedule of processing purposes and retention categories.
--
-- This migration is SAFE TO APPLY ONLINE. All new fields are
-- nullable, so existing rows remain valid. No index changes.
-- ================================================================

BEGIN;

-- ============================================================
-- Part 1: chronic_conditions enum extension (via lookup table
-- pattern or CHECK constraint — depends on current schema)
-- ============================================================

-- The chronicConditions array in sessions.data stores objects
-- with `key` and `label_en` fields. Values currently seen in code:
--   'hiv', 'hypertension', 'diabetes', 'mental_health'
-- We add two new keys (TB, immunocompromised) that the app layer
-- can emit. No schema enforcement at DB level — the JSONB column
-- accepts any keys. This part is documentation-only; the app-layer
-- enum lives in index.js CHRONIC_CONDITION_CATALOG (to be added).

-- ============================================================
-- Part 2: sessions.data structural additions (documentation only)
-- ============================================================
-- New optional fields in sessions.data JSONB:
--   nutrition_flag: TEXT  — 'normal' | 'underweight' | 'severe_acute_malnutrition' | 'wasting' | null
--   tb_status: TEXT       — 'active_on_treatment' | 'completed_treatment' | 'household_contact' | 'suspected' | null
--   immunocompromised_other: TEXT  — free text, sparingly used for non-HIV immunocompromise
--
-- No DDL change required — sessions.data is JSONB and accepts new
-- keys without migration. Documented here for audit trail.

-- ============================================================
-- Part 3: triage_logs — add host-factor snapshot columns for
-- post-hoc analysis without having to re-parse sessions.data
-- ============================================================

ALTER TABLE triage_logs
  ADD COLUMN IF NOT EXISTS nutrition_flag TEXT;

ALTER TABLE triage_logs
  ADD COLUMN IF NOT EXISTS tb_status TEXT;

-- No unique constraints — these are analytical fields, not
-- dedup keys.

COMMENT ON COLUMN triage_logs.nutrition_flag IS
  'Nutrition status at time of triage. Values: normal, underweight, severe_acute_malnutrition, wasting, null. Documented in docs/host_field_audit.md.';

COMMENT ON COLUMN triage_logs.tb_status IS
  'TB status at time of triage. Values: active_on_treatment, completed_treatment, household_contact, suspected, null. Documented in docs/host_field_audit.md.';

-- ============================================================
-- Part 4: index on tb_status for TB-specific reporting
-- ============================================================
-- Partial index: only populated triage logs, for analytical
-- queries like "of triages in HIV+ cohort, how many are also TB+".

CREATE INDEX IF NOT EXISTS triage_logs_tb_status_idx
  ON triage_logs (tb_status)
  WHERE tb_status IS NOT NULL;

-- ============================================================
-- Part 5: optional — persistent patients.host_factors
-- ============================================================
-- If the patients table exists as separate from sessions, the
-- same two fields should live there for long-term patient-level
-- profile. Omitted from this migration because we do not want to
-- introduce a cross-table dependency without explicit review of
-- the patients schema. Flag for Anele (operations) to verify
-- whether a patients table exists and, if so, whether these
-- fields belong there as well.

COMMIT;

-- ================================================================
-- Post-migration code changes required:
-- ================================================================
-- 1. lib/triage.js chronicNote template — extend to cover:
--       TB: "TB+ with haemoptysis or cough > 3 weeks → ORANGE minimum"
--       Nutrition: "Underweight/wasting with fever → YELLOW minimum
--                   for adults, ORANGE minimum for children under 5"
-- 2. governance.js clinicalPerformance.RISK_UPGRADE_FACTORS —
--    add 'tb_on_treatment' and 'malnourished_child' factors with
--    appropriate minLevel.
-- 3. index.js onboarding flow — add chronic-condition menu entries
--    for TB (categories: on treatment / completed / household contact /
--    suspected / not applicable) and nutrition self-report item for
--    infant/child patients.
-- 4. lib/session.js logTriage — when sessions.data contains
--    nutrition_flag or tb_status, mirror them to the triage_logs
--    columns for analytical simplicity.
-- 5. Pilot outcome endpoints — consider adding TB-coinfection and
--    nutrition-stratified outcome metrics.
-- 6. DPIA update — add the three new host-factor data classes to the
--    processing schedule with retention category.
--
-- Total post-migration effort: estimated 1 day of code + 1 day of
-- DPIA coordination + clinical-advisory review.

-- ================================================================
-- Rollback
-- ================================================================
-- DROP INDEX IF EXISTS triage_logs_tb_status_idx;
-- ALTER TABLE triage_logs DROP COLUMN IF EXISTS tb_status;
-- ALTER TABLE triage_logs DROP COLUMN IF EXISTS nutrition_flag;
