-- ============================================================
-- BIZUSIZO Pre-Pilot Migration: Authentication, Audit & Referrals
-- Run this in Supabase SQL Editor
-- ============================================================

-- 0. ADD FACILITY_NAME TO EXISTING TABLES
-- ============================================================
ALTER TABLE clinic_queue ADD COLUMN IF NOT EXISTS facility_name TEXT;

-- Backfill from notes field for existing records
UPDATE clinic_queue 
SET facility_name = REPLACE(notes, 'Facility: ', '')
WHERE notes LIKE 'Facility: %' AND facility_name IS NULL;

-- Index for facility filtering
CREATE INDEX IF NOT EXISTS idx_clinic_queue_facility ON clinic_queue(facility_name);

-- 1. FACILITY USERS TABLE
-- Stores login credentials for clinic staff
-- ============================================================

CREATE TABLE IF NOT EXISTS facility_users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  facility_id UUID NOT NULL,
  username TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  display_name TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'nurse' CHECK (role IN ('nurse', 'reception', 'manager', 'admin')),
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_login TIMESTAMPTZ
);

-- Index for fast login lookups
CREATE INDEX IF NOT EXISTS idx_facility_users_username ON facility_users(username);
CREATE INDEX IF NOT EXISTS idx_facility_users_facility ON facility_users(facility_id);

-- 2. SESSIONS TABLE
-- Tracks active login sessions (JWT alternative — simpler for clinic tablets)
-- ============================================================

CREATE TABLE IF NOT EXISTS user_sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES facility_users(id) ON DELETE CASCADE,
  facility_id UUID NOT NULL,
  facility_name TEXT,
  token TEXT NOT NULL UNIQUE,
  role TEXT NOT NULL,
  display_name TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at TIMESTAMPTZ NOT NULL,
  is_active BOOLEAN NOT NULL DEFAULT true
);

CREATE INDEX IF NOT EXISTS idx_sessions_token ON user_sessions(token);
CREATE INDEX IF NOT EXISTS idx_sessions_active ON user_sessions(is_active, expires_at);

-- 3. AUDIT LOG TABLE
-- Records every dashboard action for POPIA compliance and EVAH evaluation
-- ============================================================

CREATE TABLE IF NOT EXISTS audit_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES facility_users(id),
  facility_id UUID,
  action TEXT NOT NULL,
  target_id UUID,
  metadata JSONB DEFAULT '{}',
  ip_address TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Indexes for common audit queries
CREATE INDEX IF NOT EXISTS idx_audit_log_facility ON audit_log(facility_id, created_at);
CREATE INDEX IF NOT EXISTS idx_audit_log_user ON audit_log(user_id, created_at);
CREATE INDEX IF NOT EXISTS idx_audit_log_action ON audit_log(action, created_at);

-- 4. REFERRALS TABLE (enhanced)
-- Tracks hospital referrals with status lifecycle
-- ============================================================

CREATE TABLE IF NOT EXISTS referrals (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  ref_number TEXT NOT NULL UNIQUE,
  session_id UUID,
  patient_name TEXT,
  patient_surname TEXT,
  patient_age TEXT,
  patient_sex TEXT,
  triage_colour TEXT,
  triage_category TEXT,
  symptom_summary TEXT,
  risk_factors TEXT,
  originating_facility_id UUID,
  originating_facility_name TEXT,
  receiving_facility_id UUID,
  receiving_facility_name TEXT,
  referral_reason TEXT,
  transport_method TEXT,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'accepted', 'completed', 'expired')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  looked_up_at TIMESTAMPTZ,
  looked_up_by TEXT,
  completed_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_referrals_ref_number ON referrals(ref_number);
CREATE INDEX IF NOT EXISTS idx_referrals_status ON referrals(status);
CREATE INDEX IF NOT EXISTS idx_referrals_originating ON referrals(originating_facility_id);

-- 5. SEED DATA: Create initial users for 3 pilot clinics
-- Change passwords before deployment!
-- ============================================================

-- NOTE: These use bcrypt hashes. The plaintext passwords are listed in comments.
-- Generate real hashes at deployment with: await bcrypt.hash('YourPassword', 10)
-- For now, these are placeholder hashes for the password 'bizusizo2026'
-- You MUST regenerate these before pilot launch.

-- Eersterust CHC
INSERT INTO facility_users (facility_id, username, password_hash, display_name, role)
VALUES 
  -- Replace 'EERSTERUST_FACILITY_UUID' with actual facility_id from your facilities table
  ('00000000-0000-0000-0000-000000000001', 'eersterust_nurse', '$PLACEHOLDER_HASH$', 'Eersterust Nurse', 'nurse'),
  ('00000000-0000-0000-0000-000000000001', 'eersterust_reception', '$PLACEHOLDER_HASH$', 'Eersterust Reception', 'reception'),
  ('00000000-0000-0000-0000-000000000001', 'eersterust_manager', '$PLACEHOLDER_HASH$', 'Eersterust Manager', 'manager')
ON CONFLICT (username) DO NOTHING;

-- Soshanguve CHC
INSERT INTO facility_users (facility_id, username, password_hash, display_name, role)
VALUES 
  ('00000000-0000-0000-0000-000000000002', 'soshanguve_nurse', '$PLACEHOLDER_HASH$', 'Soshanguve Nurse', 'nurse'),
  ('00000000-0000-0000-0000-000000000002', 'soshanguve_reception', '$PLACEHOLDER_HASH$', 'Soshanguve Reception', 'reception'),
  ('00000000-0000-0000-0000-000000000002', 'soshanguve_manager', '$PLACEHOLDER_HASH$', 'Soshanguve Manager', 'manager')
ON CONFLICT (username) DO NOTHING;

-- Skinner Street Clinic
INSERT INTO facility_users (facility_id, username, password_hash, display_name, role)
VALUES 
  ('00000000-0000-0000-0000-000000000003', 'skinner_nurse', '$PLACEHOLDER_HASH$', 'Skinner Street Nurse', 'nurse'),
  ('00000000-0000-0000-0000-000000000003', 'skinner_reception', '$PLACEHOLDER_HASH$', 'Skinner Street Reception', 'reception'),
  ('00000000-0000-0000-0000-000000000003', 'skinner_manager', '$PLACEHOLDER_HASH$', 'Skinner Street Manager', 'manager')
ON CONFLICT (username) DO NOTHING;

-- BIZUSIZO Admin (sees all facilities)
INSERT INTO facility_users (facility_id, username, password_hash, display_name, role)
VALUES 
  ('00000000-0000-0000-0000-000000000000', 'bizusizo_admin', '$PLACEHOLDER_HASH$', 'BIZUSIZO Admin', 'admin')
ON CONFLICT (username) DO NOTHING;

-- 6. AUTO-EXPIRE REFERRALS
-- Function to mark referrals as expired after 72 hours
-- ============================================================

CREATE OR REPLACE FUNCTION expire_old_referrals()
RETURNS void AS $$
BEGIN
  UPDATE referrals 
  SET status = 'expired' 
  WHERE status = 'pending' 
    AND created_at < now() - INTERVAL '72 hours';
END;
$$ LANGUAGE plpgsql;

-- 7. HELPER VIEW: Audit summary for EVAH evaluation
-- ============================================================

CREATE OR REPLACE VIEW audit_daily_summary AS
SELECT 
  DATE(created_at) as date,
  facility_id,
  COUNT(DISTINCT user_id) as unique_users,
  COUNT(*) FILTER (WHERE action = 'LOGIN') as logins,
  COUNT(*) FILTER (WHERE action = 'AGREE') as agrees,
  COUNT(*) FILTER (WHERE action = 'DISAGREE') as disagrees,
  COUNT(*) FILTER (WHERE action = 'ESCALATE') as escalations,
  COUNT(*) FILTER (WHERE action = 'CHECK_IN') as check_ins,
  COUNT(*) FILTER (WHERE action = 'REGISTER_WALKIN') as walk_ins,
  COUNT(*) FILTER (WHERE action = 'VIEW_REFERRAL') as referral_lookups
FROM audit_log
GROUP BY DATE(created_at), facility_id
ORDER BY date DESC;
