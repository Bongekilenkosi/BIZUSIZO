-- ============================================================
-- HealthBridgeSA — Supabase Schema Migration (Complete)
-- Run this in Supabase SQL Editor (supabase.com → your project → SQL Editor)
--
-- FHIR R4 annotations are included as COMMENT ON COLUMN statements.
-- These map each column to its FHIR equivalent resource/element,
-- enabling NHI interoperability review and future FHIR export without
-- requiring schema changes. See: https://hl7.org/fhir/R4/
--
-- Safe to run on a fresh project or an existing one — all statements
-- use IF NOT EXISTS / ADD COLUMN IF NOT EXISTS.
-- ============================================================


-- ============================================================
-- PART 0: PRE-MIGRATION COLUMN ADDITIONS
-- Must run BEFORE CREATE TABLE/INDEX so pre-existing tables
-- get patient_id before the indexes try to reference it.
-- DO blocks swallow undefined_table on a fresh (empty) DB.
-- ============================================================

DO $$ BEGIN ALTER TABLE sessions           ADD COLUMN IF NOT EXISTS patient_id TEXT; EXCEPTION WHEN undefined_table THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE triage_logs        ADD COLUMN IF NOT EXISTS patient_id TEXT; EXCEPTION WHEN undefined_table THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE follow_ups         ADD COLUMN IF NOT EXISTS patient_id TEXT; EXCEPTION WHEN undefined_table THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE consent_log        ADD COLUMN IF NOT EXISTS patient_id TEXT; EXCEPTION WHEN undefined_table THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE follow_up_outcomes ADD COLUMN IF NOT EXISTS patient_id TEXT; EXCEPTION WHEN undefined_table THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE feedback           ADD COLUMN IF NOT EXISTS patient_id TEXT; EXCEPTION WHEN undefined_table THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE referrals          ADD COLUMN IF NOT EXISTS patient_id TEXT; EXCEPTION WHEN undefined_table THEN NULL; END $$;


-- ============================================================
-- PART 1: PATIENT & CLINICAL TABLES
-- ============================================================

-- 1. Sessions — persistent WhatsApp conversation state per patient
CREATE TABLE IF NOT EXISTS sessions (
  patient_id   TEXT PRIMARY KEY,   -- FHIR: Patient.id (hashed phone, no PII)
  data         JSONB NOT NULL DEFAULT '{}',
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON TABLE sessions IS 'WhatsApp session state per patient. FHIR equivalent: Patient + related context resources.';
COMMENT ON COLUMN sessions.patient_id IS 'FHIR R4: Patient.id — hashed phone number used as logical patient identifier (POPIA-compliant, no PII stored here).';
COMMENT ON COLUMN sessions.data IS 'FHIR R4: Patient demographics (name, DOB) + communication (language) + condition list (chronicConditions) + consent status. Serialised JSONB pending normalisation.';


-- 2. Triage logs — every triage interaction (primary audit trail)
CREATE TABLE IF NOT EXISTS triage_logs (
  id                    BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  patient_id            TEXT NOT NULL,             -- FHIR: Patient.id
  phone_hash            TEXT,                      -- FHIR: Patient.telecom (hashed, POPIA)
  language              TEXT DEFAULT 'en',         -- FHIR: Patient.communication.language (BCP-47)
  original_message      TEXT,                      -- FHIR: Observation.note (raw symptom text)
  english_summary       TEXT,                      -- FHIR: Observation.note (translated summary)
  symptoms              TEXT,                      -- denormalised symptom text for dashboard display
  symptoms_summary      TEXT,                      -- truncated version for queue card
  triage_level          TEXT NOT NULL,             -- FHIR: Observation.valueCodeableConcept (SATS: RED/ORANGE/YELLOW/GREEN)
  confidence            TEXT DEFAULT 'HIGH',       -- FHIR: Observation.interpretation (HIGH/MEDIUM/LOW)
  method                TEXT DEFAULT 'menu',       -- FHIR: Observation.method (menu/free_text/rule_override)
  category              TEXT,                      -- FHIR: Observation.category (symptom domain 1–13)
  followup_answer       TEXT,
  escalation            BOOLEAN DEFAULT FALSE,     -- FHIR: ReferralRequest.priority = urgent
  escalation_reason     TEXT,                      -- FHIR: ReferralRequest.reasonCode
  pathway               TEXT,                      -- FHIR: CarePlan.activity.detail.code
  facility_name         TEXT,                      -- FHIR: Organization.name (routed facility)
  facility_id           INT,                       -- FHIR: Organization.id
  location              JSONB,                     -- FHIR: Location.position (lat/lng)
  prompt_version        TEXT,                      -- links triage event to system prompt version for concordance
  rule_override         TEXT,                      -- discriminator rule that fired (if any)
  discriminator_matched TEXT,                      -- AI-reported discriminator match
  governance            JSONB,                     -- governance audit metadata (pillar, flags)
  input_source          TEXT DEFAULT 'text',       -- 'text' | 'voice_note' — flags transcribed triages
  identity_verified     BOOLEAN DEFAULT FALSE,     -- TRUE when patient showed ID at reception
  needs_human_review    BOOLEAN DEFAULT FALSE,
  reviewed              BOOLEAN DEFAULT FALSE,
  reviewed_by           TEXT,
  reviewed_at           TIMESTAMPTZ,
  review_notes          TEXT,
  -- Nurse feedback (written back after queue feedback)
  nurse_verdict         TEXT,                      -- 'agree' | 'disagree'
  nurse_triage_level    TEXT,                      -- nurse's override level (if disagree)
  nurse_name            TEXT,
  nurse_feedback_at     TIMESTAMPTZ,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now()  -- FHIR: Observation.effectiveDateTime
);

COMMENT ON TABLE triage_logs IS 'FHIR R4 equivalent: Observation (triage assessment). Each row = one AI triage event. Primary audit and concordance trail.';
COMMENT ON COLUMN triage_logs.triage_level IS 'FHIR R4: Observation.valueCodeableConcept — SATS triage colour (RED=immediate, ORANGE=very urgent, YELLOW=urgent, GREEN=routine). Maps to LOINC 74728-7.';
COMMENT ON COLUMN triage_logs.escalation IS 'FHIR R4: ServiceRequest.priority = "urgent" or "asap". TRUE when AI upgraded severity due to comorbidities, age, or clinical rules.';
COMMENT ON COLUMN triage_logs.pathway IS 'FHIR R4: CarePlan.activity.detail.code — clinical pathway taken (e.g. red_dispatch, green_self_care, chronic_medication).';
COMMENT ON COLUMN triage_logs.facility_name IS 'FHIR R4: Organization.name — facility the patient was routed to.';
COMMENT ON COLUMN triage_logs.location IS 'FHIR R4: Location.position — patient GPS coordinates at time of triage (lat/lng JSONB).';
COMMENT ON COLUMN triage_logs.language IS 'FHIR R4: Patient.communication.language — BCP-47 code (en, zu, xh, af, nso, tn, st, ts, ss, ve, nr).';
COMMENT ON COLUMN triage_logs.rule_override IS 'Internal: deterministic SATS discriminator rule that overrode AI result. Links to applyClinicalRules() for concordance review.';
COMMENT ON COLUMN triage_logs.prompt_version IS 'Internal: TRIAGE_PROMPT_VERSION constant at time of triage — enables regression analysis when prompt changes.';

CREATE INDEX IF NOT EXISTS idx_triage_logs_patient    ON triage_logs (patient_id);
CREATE INDEX IF NOT EXISTS idx_triage_logs_level      ON triage_logs (triage_level);
CREATE INDEX IF NOT EXISTS idx_triage_logs_escalation ON triage_logs (needs_human_review, reviewed);
CREATE INDEX IF NOT EXISTS idx_triage_logs_created    ON triage_logs (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_triage_logs_facility   ON triage_logs (facility_name) WHERE facility_name IS NOT NULL;


-- 3. Follow-ups — scheduled check-ins post-triage
CREATE TABLE IF NOT EXISTS follow_ups (
  id              BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  patient_id      TEXT NOT NULL,               -- FHIR: Patient.id
  phone           TEXT NOT NULL,               -- FHIR: Patient.telecom (plain, for sending)
  triage_level    TEXT NOT NULL,               -- FHIR: Appointment.reasonCode (original triage)
  triage_log_id   BIGINT REFERENCES triage_logs(id),
  type            TEXT DEFAULT 'check_in',     -- check_in | symptom_check | next_visit_reminder | phase2_after_red | morning_reminder
  scheduled_at    TIMESTAMPTZ NOT NULL,        -- FHIR: Appointment.start
  status          TEXT NOT NULL DEFAULT 'pending',  -- pending | sent | completed | expired | no_response | cancelled
  response        TEXT,                        -- FHIR: QuestionnaireResponse.item (patient reply)
  sent_at         TIMESTAMPTZ,                 -- FHIR: Appointment.created
  completed_at    TIMESTAMPTZ,                 -- FHIR: Appointment.end
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON TABLE follow_ups IS 'FHIR R4 equivalent: Appointment (follow-up encounter). Tracks 24h check-in, 72h symptom review, and next-visit reminders scheduled after triage.';
COMMENT ON COLUMN follow_ups.type IS 'check_in (24h), symptom_check (72h), next_visit_reminder (day-before slot), phase2_after_red (identity capture delay for RED patients).';
COMMENT ON COLUMN follow_ups.status IS 'FHIR R4: Appointment.status — pending | sent | completed | expired | no_response | cancelled.';
COMMENT ON COLUMN follow_ups.response IS 'FHIR R4: QuestionnaireResponse.item — raw patient reply (visited / not_visited_yet / better / same / worse).';

CREATE INDEX IF NOT EXISTS idx_follow_ups_due     ON follow_ups (scheduled_at, status) WHERE status = 'pending';
CREATE INDEX IF NOT EXISTS idx_follow_ups_patient  ON follow_ups (patient_id, status);
CREATE INDEX IF NOT EXISTS idx_follow_ups_type     ON follow_ups (type, status);


-- 4. Facilities — clinics and hospitals with live capacity
CREATE TABLE IF NOT EXISTS facilities (
  id                SERIAL PRIMARY KEY,        -- FHIR: Organization.id
  name              TEXT NOT NULL,             -- FHIR: Organization.name
  type              TEXT NOT NULL,             -- FHIR: Organization.type (clinic | hospital | chc)
  latitude          DOUBLE PRECISION NOT NULL, -- FHIR: Location.position.latitude
  longitude         DOUBLE PRECISION NOT NULL, -- FHIR: Location.position.longitude
  capacity          INT DEFAULT 20,            -- FHIR: Location.physicalType capacity extension
  current_queue     INT DEFAULT 0,
  wait_time_minutes INT DEFAULT 30,
  phone             TEXT,                      -- FHIR: Organization.telecom
  address           TEXT,                      -- FHIR: Organization.address.text
  province          TEXT DEFAULT 'Gauteng',    -- FHIR: Organization.address.state
  active            BOOLEAN DEFAULT TRUE,      -- FHIR: Organization.active
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON TABLE facilities IS 'FHIR R4 equivalent: Organization + Location. Each row = one public health facility (PHC clinic, CHC, or hospital).';
COMMENT ON COLUMN facilities.type IS 'FHIR R4: Organization.type — clinic (PHC), chc (Community Health Centre), hospital. Maps to HL7 v3 RoleCode.';
COMMENT ON COLUMN facilities.active IS 'FHIR R4: Organization.active — FALSE = facility temporarily closed or delisted.';

-- Seed Gauteng facilities
INSERT INTO facilities (name, type, latitude, longitude, capacity, current_queue, wait_time_minutes, address) VALUES
  ('Benoni Clinic',                   'clinic',   -26.188, 28.320, 20,  5,  30, 'Benoni, Gauteng'),
  ('Tambo Memorial Hospital',         'hospital', -26.204, 28.312, 50,  20, 45, 'Boksburg, Gauteng'),
  ('Charlotte Maxeke Hospital',       'hospital', -26.181, 28.047, 60,  15, 40, 'Parktown, Johannesburg'),
  ('Thelle Mogoerane Hospital',       'hospital', -26.281, 28.148, 45,  18, 50, 'Vosloorus, Gauteng'),
  ('Edenvale General Hospital',       'hospital', -26.141, 28.152, 40,  12, 35, 'Edenvale, Gauteng'),
  ('Daveyton Clinic',                 'clinic',   -26.160, 28.418, 15,  3,  20, 'Daveyton, Gauteng'),
  ('Tembisa Hospital',                'hospital', -25.998, 28.227, 55,  25, 60, 'Tembisa, Gauteng'),
  ('Wattville Clinic',                'clinic',   -26.178, 28.343, 12,  4,  25, 'Wattville, Benoni'),
  ('Far East Rand Hospital',          'hospital', -26.226, 28.396, 35,  10, 40, 'Springs, Gauteng'),
  ('Chris Hani Baragwanath Hospital', 'hospital', -26.261, 27.943, 100, 45, 90, 'Soweto, Johannesburg')
ON CONFLICT DO NOTHING;


-- 5. Study codes — patient BZ-XXXX reference numbers (POPIA-safe identifier)
CREATE TABLE IF NOT EXISTS study_codes (
  id          BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  patient_id  TEXT NOT NULL UNIQUE,
  study_code  TEXT NOT NULL UNIQUE,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON TABLE study_codes IS 'Maps hashed patient_id to human-readable BZ-XXXX reference code. Used by clinic staff to locate patient records without exposing phone numbers.';

CREATE INDEX IF NOT EXISTS idx_study_codes_code ON study_codes (study_code);


-- 6. Feedback — patient satisfaction after visits
CREATE TABLE IF NOT EXISTS feedback (
  id              BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  patient_id      TEXT NOT NULL,               -- FHIR: Patient.id
  triage_log_id   BIGINT REFERENCES triage_logs(id),
  facility_id     INT REFERENCES facilities(id),
  rating          INT CHECK (rating >= 1 AND rating <= 5),  -- FHIR: QuestionnaireResponse (1–5 Likert)
  comment         TEXT,
  status          TEXT NOT NULL DEFAULT 'pending',
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  completed_at    TIMESTAMPTZ
);

COMMENT ON TABLE feedback IS 'FHIR R4 equivalent: QuestionnaireResponse. Patient-reported satisfaction after clinic visit.';


-- 7. Consent log — immutable POPIA audit trail
CREATE TABLE IF NOT EXISTS consent_log (
  id               BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  patient_id       TEXT NOT NULL,               -- FHIR: Patient.id
  event_type       TEXT NOT NULL,               -- service_consent_given | service_consent_declined | service_consent_withdrawn | study_consent_given | study_consent_declined
  consented        BOOLEAN,                     -- FHIR: Consent.status (TRUE=active, FALSE=withheld/withdrawn). NULL for informational events.
  language         TEXT DEFAULT 'en',           -- FHIR: Consent.language
  consent_version  TEXT,                        -- version of consent text shown (e.g. 'v2.0-2026-04-01')
  channel          TEXT DEFAULT 'whatsapp',     -- channel through which consent was captured
  metadata         JSONB DEFAULT '{}',          -- additional context (study_code, ip_hash, trigger word)
  logged_at        TIMESTAMPTZ NOT NULL DEFAULT now()  -- FHIR: Consent.dateTime
);

COMMENT ON TABLE consent_log IS 'FHIR R4 equivalent: Consent. POPIA s11(3) compliant immutable audit record. Every consent change creates a new row — never updated, never deleted.';
COMMENT ON COLUMN consent_log.event_type IS 'service_consent_given | service_consent_declined | service_consent_withdrawn | study_consent_given | study_consent_declined.';
COMMENT ON COLUMN consent_log.consent_version IS 'Version string of the consent text the patient was shown — required for POPIA audit to prove what was consented to.';

CREATE INDEX IF NOT EXISTS idx_consent_patient ON consent_log (patient_id, logged_at DESC);
CREATE INDEX IF NOT EXISTS idx_consent_event   ON consent_log (event_type, logged_at DESC);


-- 8. Follow-up outcomes — structured outcome per follow-up cycle
CREATE TABLE IF NOT EXISTS follow_up_outcomes (
  id                   BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  patient_id           TEXT NOT NULL,          -- FHIR: Patient.id
  triage_level         TEXT,                   -- FHIR: Observation.valueCodeableConcept (original SATS level)
  symptom_outcome      TEXT,                   -- FHIR: Observation.interpretation (better/same/worse)
  visited_clinic       TEXT,                   -- FHIR: Encounter.status (clinic/hospital/no)
  access_failure       TEXT,                   -- FHIR: Encounter.reasonCode (stockout/turned_away)
  facility_name        TEXT,                   -- FHIR: Organization.name
  response_received_at TIMESTAMPTZ NOT NULL DEFAULT now()  -- FHIR: Observation.effectiveDateTime
);

COMMENT ON TABLE follow_up_outcomes IS 'FHIR R4 equivalent: Observation (follow-up) + Encounter (clinic visit). Primary impact measurement table.';
COMMENT ON COLUMN follow_up_outcomes.access_failure IS 'FHIR R4: Encounter.reasonCode — care access barrier: stockout (no medicine) | turned_away. NULL = no barrier.';

CREATE INDEX IF NOT EXISTS idx_follow_up_outcomes_patient  ON follow_up_outcomes (patient_id);
CREATE INDEX IF NOT EXISTS idx_follow_up_outcomes_facility ON follow_up_outcomes (facility_name) WHERE facility_name IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_follow_up_outcomes_access   ON follow_up_outcomes (access_failure) WHERE access_failure IS NOT NULL;


-- ============================================================
-- PART 2: CLINIC OPERATIONS TABLES
-- ============================================================

-- 9. Clinic queue — real-time patient queue for the clinic dashboard
CREATE TABLE IF NOT EXISTS clinic_queue (
  id                 BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  patient_id         TEXT NOT NULL,
  patient_name       TEXT,                     -- self-reported name (not verified until ID shown)
  patient_phone      TEXT,                     -- plain phone number (for calling patient)
  triage_level       TEXT NOT NULL,            -- RED | ORANGE | YELLOW | GREEN
  queue_type         TEXT NOT NULL,            -- emergency | fast_track | routine | maternal | child | chronic | preventative | general | walk_in
  position           INT,
  status             TEXT NOT NULL DEFAULT 'waiting',  -- waiting | called | with_nurse | with_doctor | completed | no_show | left | paused
  source             TEXT DEFAULT 'whatsapp',  -- whatsapp | kiosk | walk_in
  symptoms_summary   TEXT,                     -- truncated symptom text for queue card (max 500 chars)
  notes              TEXT,                     -- nurse notes (includes feedback verdict)
  facility_name      TEXT,
  facility_id        INT REFERENCES facilities(id),
  identity_verified  BOOLEAN DEFAULT FALSE,    -- TRUE when patient showed ID/clinic card at reception
  checked_in_at      TIMESTAMPTZ,
  called_at          TIMESTAMPTZ,              -- when nurse called the patient (for wait-time metric)
  completed_at       TIMESTAMPTZ,
  paused_at          TIMESTAMPTZ,
  paused_reason      TEXT,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON TABLE clinic_queue IS 'Real-time clinic patient queue. Each row = one patient visit. Feeds the clinic dashboard. Queue type implements DoH-aligned patient streaming.';
COMMENT ON COLUMN clinic_queue.queue_type IS 'DoH PHC streaming: emergency (RED), fast_track (ORANGE), routine, maternal, child, chronic, preventative, general, walk_in.';
COMMENT ON COLUMN clinic_queue.identity_verified IS 'Set TRUE by reception when patient presents ID/clinic card — enables concordance audit.';

CREATE INDEX IF NOT EXISTS idx_clinic_queue_facility ON clinic_queue (facility_name, status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_clinic_queue_patient  ON clinic_queue (patient_id);
CREATE INDEX IF NOT EXISTS idx_clinic_queue_status   ON clinic_queue (status, triage_level);


-- 10. Pre-arrival alerts — sent to clinic dashboard when patient completes triage
CREATE TABLE IF NOT EXISTS pre_arrival_alerts (
  id                    BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  patient_id            TEXT NOT NULL,
  alert_type            TEXT NOT NULL DEFAULT 'pre_arrival',
  priority              TEXT NOT NULL,          -- URGENT (RED) | SOON (ORANGE) | ROUTINE (YELLOW/GREEN)
  triage_level          TEXT NOT NULL,
  triage_confidence     TEXT,
  rule_override         TEXT,
  discriminator_matched TEXT,
  facility_name         TEXT,
  estimated_arrival_at  TIMESTAMPTZ,
  estimated_minutes     INT,
  is_new_patient        BOOLEAN DEFAULT TRUE,
  patient_name          TEXT,
  patient_age           INT,
  patient_sex           TEXT,
  chronic_conditions    TEXT,
  symptoms_summary      TEXT,
  study_code            TEXT,
  identity_verified     BOOLEAN DEFAULT FALSE,
  identity_verified_at  TIMESTAMPTZ,
  identity_verified_by  TEXT,
  resolved              BOOLEAN DEFAULT FALSE,
  resolved_at           TIMESTAMPTZ,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON TABLE pre_arrival_alerts IS 'Fired when patient completes triage on WhatsApp. Gives clinic staff advance notice before patient walks in. Priority = URGENT/SOON/ROUTINE based on SATS colour.';

CREATE INDEX IF NOT EXISTS idx_pre_arrival_facility  ON pre_arrival_alerts (facility_name, resolved, estimated_arrival_at);
CREATE INDEX IF NOT EXISTS idx_pre_arrival_patient   ON pre_arrival_alerts (patient_id);


-- 11. Triage feedback — structured nurse verdict on AI triage (concordance data)
CREATE TABLE IF NOT EXISTS triage_feedback (
  id                 BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  queue_entry_id     BIGINT REFERENCES clinic_queue(id),
  patient_id         TEXT NOT NULL,
  facility_name      TEXT,
  facility_id        INT REFERENCES facilities(id),
  nurse_name         TEXT,
  verdict            TEXT NOT NULL,            -- 'agree' | 'disagree'
  ai_triage_level    TEXT NOT NULL,
  nurse_triage_level TEXT,                     -- nurse override (null if agree)
  direction          TEXT,                     -- 'upgrade' | 'downgrade' | 'lateral' | null
  rule_fired         TEXT,                     -- which discriminator or rule fired for the AI
  symptoms_summary   TEXT,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON TABLE triage_feedback IS 'EVAH concordance data. Each row = one nurse verdict on AI triage. Primary outcome measure for the EVAH study — AI vs nurse agreement rate.';
COMMENT ON COLUMN triage_feedback.verdict IS 'agree = nurse confirms AI level. disagree = nurse overrides. Direction: upgrade (AI under-triaged) | downgrade (AI over-triaged) | lateral (same urgency, different colour).';

CREATE INDEX IF NOT EXISTS idx_triage_feedback_facility ON triage_feedback (facility_name, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_triage_feedback_verdict  ON triage_feedback (verdict, direction);


-- 12. Referrals — hospital escalations with transport method
CREATE TABLE IF NOT EXISTS referrals (
  id                      BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  ref_number              TEXT UNIQUE,
  patient_id              TEXT NOT NULL,
  patient_name            TEXT,
  patient_age             INT,
  patient_sex             TEXT,
  chronic_conditions      TEXT,
  symptoms_summary        TEXT,
  triage_level            TEXT NOT NULL,
  originating_facility_name TEXT,
  originating_facility_id INT REFERENCES facilities(id),
  destination_facility    TEXT,
  transport_method        TEXT,                -- ambulance | self | family
  reason                  TEXT,
  referred_by             TEXT,               -- nurse/clinician name
  status                  TEXT DEFAULT 'pending',  -- pending | accepted | arrived | completed
  created_at              TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at              TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON TABLE referrals IS 'FHIR R4 equivalent: ServiceRequest. Hospital escalations initiated from WhatsApp triage or clinic queue.';

CREATE INDEX IF NOT EXISTS idx_referrals_facility ON referrals (originating_facility_name, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_referrals_patient  ON referrals (patient_id);


-- ============================================================
-- DOCTOR REFERRALS — Intra-clinic nurse-to-doctor escalation
-- Tracks when a nurse determines a patient needs doctor review
-- rather than hospital referral. Supports same-day queue placement
-- and return-visit scheduling with WhatsApp reminders.
-- ============================================================
CREATE TABLE IF NOT EXISTS doctor_referrals (
  id            BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  queue_entry_id BIGINT REFERENCES clinic_queue(id),
  patient_id    TEXT NOT NULL,
  patient_name  TEXT,
  facility_name TEXT,
  facility_id   INT,
  referred_by   TEXT,                                            -- nurse name
  clinical_reason TEXT NOT NULL,                                 -- why doctor is needed
  doctor_name   TEXT,                                            -- assigned/scheduled doctor
  status        TEXT DEFAULT 'waiting'                           -- waiting | scheduled | in_progress | completed | no_show
                CHECK (status IN ('waiting','scheduled','in_progress','completed','no_show')),
  referral_date DATE,                                            -- date patient should see doctor
  doctor_notes  TEXT,                                            -- doctor's assessment notes
  outcome       TEXT,                                            -- assessed | prescribed | referred_hospital | follow_up
  completed_at  TIMESTAMPTZ,
  created_at    TIMESTAMPTZ DEFAULT NOW()
);

COMMENT ON TABLE doctor_referrals IS 'Intra-clinic doctor referrals. Nurse determines patient needs doctor review (not hospital escalation). Supports same-day and scheduled return visits.';

CREATE INDEX IF NOT EXISTS idx_doctor_referrals_facility ON doctor_referrals (facility_name, referral_date);
CREATE INDEX IF NOT EXISTS idx_doctor_referrals_patient  ON doctor_referrals (patient_id);
CREATE INDEX IF NOT EXISTS idx_doctor_referrals_status   ON doctor_referrals (status, referral_date);

-- ============================================================
-- DOCTOR SCHEDULES — Which doctors are at which facility on which days
-- Simple schedule for sessional medical officers shared across clinics.
-- ============================================================
CREATE TABLE IF NOT EXISTS doctor_schedules (
  id            BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  doctor_name   TEXT NOT NULL,
  facility_name TEXT NOT NULL,
  facility_id   INT,
  days          TEXT[] NOT NULL,                                  -- e.g. {'monday','wednesday','friday'}
  start_time    TIME DEFAULT '08:00',
  end_time      TIME DEFAULT '16:00',
  active        BOOLEAN DEFAULT TRUE,
  notes         TEXT,                                            -- e.g. 'Sessional MO, available alternate weeks'
  created_at    TIMESTAMPTZ DEFAULT NOW()
);

-- Capacity and slot management columns (added v2.7)
DO $$ BEGIN ALTER TABLE doctor_schedules ADD COLUMN IF NOT EXISTS max_elective_patients INT DEFAULT 10; EXCEPTION WHEN undefined_table THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE doctor_schedules ADD COLUMN IF NOT EXISTS consultation_minutes INT DEFAULT 20; EXCEPTION WHEN undefined_table THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE doctor_schedules ADD COLUMN IF NOT EXISTS same_day_reserve INT DEFAULT 4; EXCEPTION WHEN undefined_table THEN NULL; END $$;

COMMENT ON TABLE doctor_schedules IS 'Doctor availability schedule per facility. Used by nurse-to-doctor referral to determine if doctor is available today or when to schedule return visit. max_elective_patients caps advance bookings to prevent overloading. same_day_reserve holds slots for same-day nurse referrals (18% of consultations per SAMJ 2023 data).';

-- Add assigned_slot to doctor_referrals for staggered appointment times
DO $$ BEGIN ALTER TABLE doctor_referrals ADD COLUMN IF NOT EXISTS assigned_slot TEXT; EXCEPTION WHEN undefined_table THEN NULL; END $$;

CREATE INDEX IF NOT EXISTS idx_doctor_schedules_facility ON doctor_schedules (facility_name, active);

-- ============================================================
-- PART 3: AUTH & ACCESS TABLES
-- ============================================================

-- 13. Facility users — clinic staff accounts
CREATE TABLE IF NOT EXISTS facility_users (
  id             BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  username       TEXT NOT NULL UNIQUE,
  password_hash  TEXT NOT NULL,               -- bcrypt hash
  display_name   TEXT NOT NULL,
  role           TEXT NOT NULL DEFAULT 'nurse',  -- admin | district_admin | nurse | receptionist | viewer
  facility_id    INT REFERENCES facilities(id),
  facility_name  TEXT,
  district_name  TEXT,                        -- for district_admin role (sees all facilities in district)
  is_active      BOOLEAN DEFAULT TRUE,
  last_login     TIMESTAMPTZ,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON TABLE facility_users IS 'Clinical dashboard staff accounts. Roles: admin (system-wide), district_admin (multi-facility read), nurse (queue + feedback), doctor (doctor queue only), receptionist (check-in), viewer (read-only).';

CREATE INDEX IF NOT EXISTS idx_facility_users_username  ON facility_users (username);
CREATE INDEX IF NOT EXISTS idx_facility_users_facility  ON facility_users (facility_id) WHERE is_active = TRUE;


-- 14. User sessions — dashboard auth tokens
CREATE TABLE IF NOT EXISTS user_sessions (
  id            BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  user_id       BIGINT REFERENCES facility_users(id),
  facility_id   INT REFERENCES facilities(id),
  facility_name TEXT,
  token         TEXT NOT NULL UNIQUE,
  role          TEXT NOT NULL,
  is_active     BOOLEAN NOT NULL DEFAULT TRUE,
  expires_at    TIMESTAMPTZ NOT NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_user_sessions_token  ON user_sessions (token) WHERE is_active = TRUE;
CREATE INDEX IF NOT EXISTS idx_user_sessions_user   ON user_sessions (user_id);


-- 15. Audit log — every dashboard action (POPIA + clinical governance)
CREATE TABLE IF NOT EXISTS audit_log (
  id          BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  user_id     BIGINT REFERENCES facility_users(id),
  facility_id INT REFERENCES facilities(id),
  user_name   TEXT,
  action      TEXT NOT NULL,               -- LOGIN | LOGOUT | PASSWORD_CHANGE | AGREE | DISAGREE | IDENTITY_VERIFIED | VIEW_REFERRAL | etc.
  target_id   TEXT,                        -- ID of the record acted on
  metadata    JSONB DEFAULT '{}',
  ip_address  TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON TABLE audit_log IS 'Immutable audit trail of all dashboard actions. Required for POPIA accountability principle and clinical governance review.';

CREATE INDEX IF NOT EXISTS idx_audit_log_user     ON audit_log (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_log_facility ON audit_log (facility_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_log_action   ON audit_log (action, created_at DESC);


-- 16. Dashboard access logs
CREATE TABLE IF NOT EXISTS dashboard_access_logs (
  id          BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  user_id     BIGINT REFERENCES facility_users(id),
  action      TEXT,
  ip_address  TEXT,
  user_agent  TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);


-- ============================================================
-- PART 4: GOVERNANCE TABLES
-- ============================================================

-- 17. Governance alerts — system-generated clinical + operational alerts
CREATE TABLE IF NOT EXISTS governance_alerts (
  id           BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  alert_type   TEXT NOT NULL,               -- consent_log_failure | abandoned_high_risk_session | outbreak_* | whatsapp_send_failure | etc.
  severity     TEXT NOT NULL,               -- CRITICAL | HIGH | MEDIUM | LOW
  pillar        TEXT NOT NULL,               -- patient_safety | system_integrity | clinical_governance | syndromic_surveillance
  message      TEXT NOT NULL,
  data         JSONB,                       -- structured context for the alert
  resolved     BOOLEAN NOT NULL DEFAULT FALSE,
  resolved_at  TIMESTAMPTZ,
  assigned_to  TEXT,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_governance_alerts_unresolved ON governance_alerts (severity, created_at DESC) WHERE resolved = FALSE;
CREATE INDEX IF NOT EXISTS idx_governance_alerts_pillar     ON governance_alerts (pillar, created_at DESC);


-- 18. Governance metrics — time-series performance metrics
CREATE TABLE IF NOT EXISTS governance_metrics (
  id           BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  metric_type  TEXT NOT NULL,
  value        NUMERIC,
  metadata     JSONB,
  recorded_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_governance_metrics_type ON governance_metrics (metric_type, recorded_at DESC);


-- 19. Governance incidents
CREATE TABLE IF NOT EXISTS governance_incidents (
  id           BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  incident_type TEXT NOT NULL,
  severity     TEXT NOT NULL,
  description  TEXT,
  data         JSONB,
  resolved     BOOLEAN DEFAULT FALSE,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);


-- 20. Governance baselines
CREATE TABLE IF NOT EXISTS governance_baselines (
  id           BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  metric_type  TEXT NOT NULL UNIQUE,
  baseline_value NUMERIC,
  metadata     JSONB,
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);


-- 21. Governance reviews
CREATE TABLE IF NOT EXISTS governance_reviews (
  id           BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  review_type  TEXT NOT NULL,
  reviewer     TEXT,
  findings     TEXT,
  data         JSONB,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);


-- 22. Governance audits
CREATE TABLE IF NOT EXISTS governance_audits (
  id           BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  audit_type   TEXT NOT NULL,
  target_id    TEXT,
  data         JSONB,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);


-- 23. Event queue — Supabase-backed, file fallback for DB outages
CREATE TABLE IF NOT EXISTS event_queue (
  id           BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  event_type   TEXT NOT NULL,
  target_table TEXT NOT NULL,
  payload      JSONB NOT NULL,
  flushed      BOOLEAN NOT NULL DEFAULT FALSE,
  queued_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  flushed_at   TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_event_queue_pending ON event_queue (queued_at) WHERE flushed = FALSE;


-- ============================================================
-- PART 5: SURVEILLANCE TABLES
-- ============================================================

-- 24. Outbreak alerts — syndromic cluster signals
CREATE TABLE IF NOT EXISTS outbreak_alerts (
  id                   BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  syndrome_id          TEXT NOT NULL,
  syndrome_name        TEXT NOT NULL,
  nicd_programme       TEXT,
  facility_key         TEXT NOT NULL,           -- facility_name or 'national'
  alert_level          TEXT NOT NULL,           -- WARNING | ALERT | IMMEDIATE
  case_count           INT NOT NULL,
  paediatric_count     INT DEFAULT 0,
  window_start         TIMESTAMPTZ NOT NULL,
  window_end           TIMESTAMPTZ NOT NULL,
  window_hours         INT NOT NULL,
  triage_distribution  JSONB,                   -- { RED: n, ORANGE: n, ... }
  nmc_category         TEXT,                    -- NMC notification category (1A, 1B, 2, 3)
  nmc_immediate        BOOLEAN DEFAULT FALSE,   -- TRUE = immediate NMC notification required
  threshold_used       JSONB,
  rationale            TEXT,
  resolved             BOOLEAN DEFAULT FALSE,
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at           TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON TABLE outbreak_alerts IS 'Syndromic surveillance cluster signals. alert_level IMMEDIATE = NMC notifiable — requires clinic manager action within 24h.';

CREATE INDEX IF NOT EXISTS idx_outbreak_alerts_active   ON outbreak_alerts (facility_key, resolved, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_outbreak_alerts_syndrome ON outbreak_alerts (syndrome_id, created_at DESC);


-- 25. Outbreak config — runtime threshold overrides (adjustable without deploy)
CREATE TABLE IF NOT EXISTS outbreak_config (
  id             BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  syndrome_id    TEXT NOT NULL,
  window_hours   INT,
  thresholds     JSONB,                         -- override for warning/alert/immediate thresholds
  active         BOOLEAN DEFAULT TRUE,
  updated_by     TEXT,
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON TABLE outbreak_config IS 'Runtime overrides for outbreak syndrome thresholds. Applied by runOutbreakSurveillanceAgent() on each cycle — no deploy required to tighten thresholds.';


-- ============================================================
-- PART 6: CCMDD (CHRONIC MEDICATION) TABLES
-- ============================================================

-- 26. CCMDD pickup points — community ARV/chronic medication collection sites
CREATE TABLE IF NOT EXISTS ccmdd_pickup_points (
  id          BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  name        TEXT NOT NULL,
  type        TEXT,                             -- pharmacy | adherence_club | community_site
  address     TEXT,
  latitude    DOUBLE PRECISION,
  longitude   DOUBLE PRECISION,
  facility_id INT REFERENCES facilities(id),   -- linked facility that manages the point
  active      BOOLEAN DEFAULT TRUE,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON TABLE ccmdd_pickup_points IS 'Community ARV/chronic medication dispensing points. Used to suggest CCMDD to eligible patients — 2M+ SA patients enrolled nationally.';


-- 27. CCMDD patient profiles — per-patient CCMDD enrolment state
CREATE TABLE IF NOT EXISTS ccmdd_patient_profiles (
  patient_id         TEXT PRIMARY KEY,
  enrolled           BOOLEAN DEFAULT FALSE,
  pickup_point_id    INT REFERENCES ccmdd_pickup_points(id),
  pickup_point_name  TEXT,
  conditions         JSONB,                    -- which conditions enrolled for
  next_collection_at TIMESTAMPTZ,
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);


-- 28. CCMDD collections — log of medication collection events
CREATE TABLE IF NOT EXISTS ccmdd_collections (
  id             BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  patient_id     TEXT NOT NULL,
  pickup_point_id INT REFERENCES ccmdd_pickup_points(id),
  status         TEXT DEFAULT 'scheduled',     -- scheduled | reminded | collected | missed
  next_reminder_at TIMESTAMPTZ,
  collected_at   TIMESTAMPTZ,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_ccmdd_collections_due ON ccmdd_collections (next_reminder_at, status) WHERE status IN ('scheduled', 'reminded');


-- ============================================================
-- PART 7: REGRESSION TESTING TABLES
-- ============================================================

-- 29. Regression test runs
CREATE TABLE IF NOT EXISTS regression_test_runs (
  id           BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  run_by       TEXT,
  prompt_version TEXT,
  total_cases  INT,
  passed       INT,
  failed       INT,
  pass_rate    NUMERIC,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);


-- 30. Regression test results — per-case outcomes
CREATE TABLE IF NOT EXISTS regression_test_results (
  id             BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  run_id         BIGINT REFERENCES regression_test_runs(id),
  case_id        TEXT,
  input_text     TEXT,
  expected_level TEXT,
  actual_level   TEXT,
  passed         BOOLEAN,
  confidence     INT,
  reasoning      TEXT,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);


-- ============================================================
-- PART 8: LAB RESULTS (NHLS INTEGRATION — DORMANT)
-- ============================================================

-- 31. Lab results — placeholder for future NHLS API integration
CREATE TABLE IF NOT EXISTS lab_results (
  id             BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  patient_id     TEXT NOT NULL,
  test_type      TEXT,
  result         TEXT,
  result_date    TIMESTAMPTZ,
  facility_name  TEXT,
  status         TEXT DEFAULT 'pending',       -- pending | ready | delivered
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_lab_results_patient ON lab_results (patient_id, created_at DESC);


-- ============================================================
-- PART 9: IDEMPOTENT COLUMN ADDITIONS
-- ============================================================
DO $body$ BEGIN ALTER TABLE follow_up_outcomes ADD COLUMN IF NOT EXISTS access_failure TEXT;       EXCEPTION WHEN undefined_table OR duplicate_column THEN NULL; END $body$;
DO $body$ BEGIN ALTER TABLE triage_logs        ADD COLUMN IF NOT EXISTS prompt_version TEXT;        EXCEPTION WHEN undefined_table OR duplicate_column THEN NULL; END $body$;
DO $body$ BEGIN ALTER TABLE triage_logs        ADD COLUMN IF NOT EXISTS symptoms TEXT;              EXCEPTION WHEN undefined_table OR duplicate_column THEN NULL; END $body$;
DO $body$ BEGIN ALTER TABLE triage_logs        ADD COLUMN IF NOT EXISTS symptoms_summary TEXT;      EXCEPTION WHEN undefined_table OR duplicate_column THEN NULL; END $body$;
DO $body$ BEGIN ALTER TABLE triage_logs        ADD COLUMN IF NOT EXISTS rule_override TEXT;         EXCEPTION WHEN undefined_table OR duplicate_column THEN NULL; END $body$;
DO $body$ BEGIN ALTER TABLE triage_logs        ADD COLUMN IF NOT EXISTS discriminator_matched TEXT; EXCEPTION WHEN undefined_table OR duplicate_column THEN NULL; END $body$;
DO $body$ BEGIN ALTER TABLE triage_logs        ADD COLUMN IF NOT EXISTS governance JSONB;           EXCEPTION WHEN undefined_table OR duplicate_column THEN NULL; END $body$;
DO $body$ BEGIN ALTER TABLE triage_logs        ADD COLUMN IF NOT EXISTS input_source TEXT DEFAULT 'text'; EXCEPTION WHEN undefined_table OR duplicate_column THEN NULL; END $body$;
DO $body$ BEGIN ALTER TABLE triage_logs        ADD COLUMN IF NOT EXISTS identity_verified BOOLEAN DEFAULT FALSE; EXCEPTION WHEN undefined_table OR duplicate_column THEN NULL; END $body$;
DO $body$ BEGIN ALTER TABLE triage_logs        ADD COLUMN IF NOT EXISTS nurse_verdict TEXT;         EXCEPTION WHEN undefined_table OR duplicate_column THEN NULL; END $body$;
DO $body$ BEGIN ALTER TABLE triage_logs        ADD COLUMN IF NOT EXISTS nurse_triage_level TEXT;    EXCEPTION WHEN undefined_table OR duplicate_column THEN NULL; END $body$;
DO $body$ BEGIN ALTER TABLE triage_logs        ADD COLUMN IF NOT EXISTS nurse_name TEXT;            EXCEPTION WHEN undefined_table OR duplicate_column THEN NULL; END $body$;
DO $body$ BEGIN ALTER TABLE triage_logs        ADD COLUMN IF NOT EXISTS nurse_feedback_at TIMESTAMPTZ; EXCEPTION WHEN undefined_table OR duplicate_column THEN NULL; END $body$;
DO $body$ BEGIN ALTER TABLE consent_log        ADD COLUMN IF NOT EXISTS event_type TEXT;            EXCEPTION WHEN undefined_table OR duplicate_column THEN NULL; END $body$;
DO $body$ BEGIN ALTER TABLE consent_log        ADD COLUMN IF NOT EXISTS consent_version TEXT;       EXCEPTION WHEN undefined_table OR duplicate_column THEN NULL; END $body$;
DO $body$ BEGIN ALTER TABLE consent_log        ADD COLUMN IF NOT EXISTS channel TEXT DEFAULT 'whatsapp'; EXCEPTION WHEN undefined_table OR duplicate_column THEN NULL; END $body$;
DO $body$ BEGIN ALTER TABLE consent_log        ADD COLUMN IF NOT EXISTS metadata JSONB DEFAULT '{}'; EXCEPTION WHEN undefined_table OR duplicate_column THEN NULL; END $body$;
DO $body$ BEGIN ALTER TABLE consent_log        ADD COLUMN IF NOT EXISTS logged_at TIMESTAMPTZ DEFAULT now(); EXCEPTION WHEN undefined_table OR duplicate_column THEN NULL; END $body$;
DO $body$ BEGIN ALTER TABLE follow_ups         ADD COLUMN IF NOT EXISTS type TEXT DEFAULT 'check_in'; EXCEPTION WHEN undefined_table OR duplicate_column THEN NULL; END $body$;


-- ============================================================
-- PART 10: ROW LEVEL SECURITY
-- ============================================================

-- Enable RLS on all tables — backend uses service role key (bypasses RLS)
-- DO blocks handle the case where a table doesn't exist yet (partial state from a prior failed run)
DO $$ BEGIN ALTER TABLE sessions              ENABLE ROW LEVEL SECURITY; EXCEPTION WHEN undefined_table THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE triage_logs           ENABLE ROW LEVEL SECURITY; EXCEPTION WHEN undefined_table THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE follow_ups            ENABLE ROW LEVEL SECURITY; EXCEPTION WHEN undefined_table THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE facilities            ENABLE ROW LEVEL SECURITY; EXCEPTION WHEN undefined_table THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE feedback              ENABLE ROW LEVEL SECURITY; EXCEPTION WHEN undefined_table THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE consent_log           ENABLE ROW LEVEL SECURITY; EXCEPTION WHEN undefined_table THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE follow_up_outcomes    ENABLE ROW LEVEL SECURITY; EXCEPTION WHEN undefined_table THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE clinic_queue          ENABLE ROW LEVEL SECURITY; EXCEPTION WHEN undefined_table THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE pre_arrival_alerts    ENABLE ROW LEVEL SECURITY; EXCEPTION WHEN undefined_table THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE triage_feedback       ENABLE ROW LEVEL SECURITY; EXCEPTION WHEN undefined_table THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE referrals             ENABLE ROW LEVEL SECURITY; EXCEPTION WHEN undefined_table THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE study_codes           ENABLE ROW LEVEL SECURITY; EXCEPTION WHEN undefined_table THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE facility_users        ENABLE ROW LEVEL SECURITY; EXCEPTION WHEN undefined_table THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE user_sessions         ENABLE ROW LEVEL SECURITY; EXCEPTION WHEN undefined_table THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE audit_log             ENABLE ROW LEVEL SECURITY; EXCEPTION WHEN undefined_table THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE governance_alerts     ENABLE ROW LEVEL SECURITY; EXCEPTION WHEN undefined_table THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE outbreak_alerts       ENABLE ROW LEVEL SECURITY; EXCEPTION WHEN undefined_table THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE event_queue           ENABLE ROW LEVEL SECURITY; EXCEPTION WHEN undefined_table THEN NULL; END $$;

-- Service role full access policy (backend uses SUPABASE_SERVICE_ROLE_KEY)
-- CREATE POLICY only if it doesn't exist — Postgres doesn't have IF NOT EXISTS for policies,
-- so use DO blocks to handle the duplicate gracefully.
DO $$ BEGIN
  CREATE POLICY "Service role full access" ON sessions         FOR ALL USING (true) WITH CHECK (true);
EXCEPTION WHEN duplicate_object OR undefined_table THEN NULL; END $$;
DO $$ BEGIN
  CREATE POLICY "Service role full access" ON triage_logs      FOR ALL USING (true) WITH CHECK (true);
EXCEPTION WHEN duplicate_object OR undefined_table THEN NULL; END $$;
DO $$ BEGIN
  CREATE POLICY "Service role full access" ON follow_ups        FOR ALL USING (true) WITH CHECK (true);
EXCEPTION WHEN duplicate_object OR undefined_table THEN NULL; END $$;
DO $$ BEGIN
  CREATE POLICY "Service role full access" ON facilities        FOR ALL USING (true) WITH CHECK (true);
EXCEPTION WHEN duplicate_object OR undefined_table THEN NULL; END $$;
DO $$ BEGIN
  CREATE POLICY "Service role full access" ON feedback          FOR ALL USING (true) WITH CHECK (true);
EXCEPTION WHEN duplicate_object OR undefined_table THEN NULL; END $$;
DO $$ BEGIN
  CREATE POLICY "Service role full access" ON consent_log       FOR ALL USING (true) WITH CHECK (true);
EXCEPTION WHEN duplicate_object OR undefined_table THEN NULL; END $$;
DO $$ BEGIN
  CREATE POLICY "Service role full access" ON follow_up_outcomes FOR ALL USING (true) WITH CHECK (true);
EXCEPTION WHEN duplicate_object OR undefined_table THEN NULL; END $$;
DO $$ BEGIN
  CREATE POLICY "Service role full access" ON clinic_queue      FOR ALL USING (true) WITH CHECK (true);
EXCEPTION WHEN duplicate_object OR undefined_table THEN NULL; END $$;
DO $$ BEGIN
  CREATE POLICY "Service role full access" ON pre_arrival_alerts FOR ALL USING (true) WITH CHECK (true);
EXCEPTION WHEN duplicate_object OR undefined_table THEN NULL; END $$;
DO $$ BEGIN
  CREATE POLICY "Service role full access" ON triage_feedback   FOR ALL USING (true) WITH CHECK (true);
EXCEPTION WHEN duplicate_object OR undefined_table THEN NULL; END $$;
DO $$ BEGIN
  CREATE POLICY "Service role full access" ON referrals         FOR ALL USING (true) WITH CHECK (true);
EXCEPTION WHEN duplicate_object OR undefined_table THEN NULL; END $$;
DO $$ BEGIN
  CREATE POLICY "Service role full access" ON study_codes       FOR ALL USING (true) WITH CHECK (true);
EXCEPTION WHEN duplicate_object OR undefined_table THEN NULL; END $$;
DO $$ BEGIN
  CREATE POLICY "Service role full access" ON facility_users    FOR ALL USING (true) WITH CHECK (true);
EXCEPTION WHEN duplicate_object OR undefined_table THEN NULL; END $$;
DO $$ BEGIN
  CREATE POLICY "Service role full access" ON user_sessions     FOR ALL USING (true) WITH CHECK (true);
EXCEPTION WHEN duplicate_object OR undefined_table THEN NULL; END $$;
DO $$ BEGIN
  CREATE POLICY "Service role full access" ON audit_log         FOR ALL USING (true) WITH CHECK (true);
EXCEPTION WHEN duplicate_object OR undefined_table THEN NULL; END $$;
DO $$ BEGIN
  CREATE POLICY "Service role full access" ON governance_alerts FOR ALL USING (true) WITH CHECK (true);
EXCEPTION WHEN duplicate_object OR undefined_table THEN NULL; END $$;
DO $$ BEGIN
  CREATE POLICY "Service role full access" ON outbreak_alerts   FOR ALL USING (true) WITH CHECK (true);
EXCEPTION WHEN duplicate_object OR undefined_table THEN NULL; END $$;
DO $$ BEGIN
  CREATE POLICY "Service role full access" ON event_queue       FOR ALL USING (true) WITH CHECK (true);
EXCEPTION WHEN duplicate_object OR undefined_table THEN NULL; END $$;


-- ============================================================
-- PART 12: FACILITY HOURS + SAFETY NET TRACKING
-- ============================================================

-- Add opening_hours to facilities (e.g. 'Mon-Fri 07:00-16:00' or '24 hours')
DO $body$ BEGIN ALTER TABLE facilities ADD COLUMN IF NOT EXISTS opening_hours TEXT; EXCEPTION WHEN undefined_table OR duplicate_column THEN NULL; END $body$;
-- Add district to facilities for future district-level queries
DO $body$ BEGIN ALTER TABLE facilities ADD COLUMN IF NOT EXISTS district TEXT; EXCEPTION WHEN undefined_table OR duplicate_column THEN NULL; END $body$;

COMMENT ON COLUMN facilities.opening_hours IS 'Human-readable operating hours string shown to patients in routing messages. NULL = use type-based default.';

-- Set defaults based on facility type
UPDATE facilities SET opening_hours = '24 hours' WHERE type = 'hospital' AND opening_hours IS NULL;
UPDATE facilities SET opening_hours = 'Mon-Fri 07:00-20:00' WHERE type = 'chc' AND opening_hours IS NULL;
UPDATE facilities SET opening_hours = 'Mon-Fri 07:00-16:00' WHERE type = 'clinic' AND opening_hours IS NULL;

-- Track safety net upgrades in triage_logs (GREEN→YELLOW by rules engine)
DO $body$ BEGIN ALTER TABLE triage_logs ADD COLUMN IF NOT EXISTS safety_net_upgrade BOOLEAN DEFAULT FALSE; EXCEPTION WHEN undefined_table OR duplicate_column THEN NULL; END $body$;
COMMENT ON COLUMN triage_logs.safety_net_upgrade IS 'TRUE when rules engine upgraded GREEN to YELLOW due to concerning keywords. Key safety metric.';


-- ============================================================
-- PART 12b: PATIENT IDENTITY VERIFICATION
-- ============================================================

-- Store verified SA ID number (entered by receptionist, not patient)
-- This becomes the authoritative patient identifier for NHI readiness.
-- Stored as a hash for POPIA compliance — the raw ID is never persisted.
CREATE TABLE IF NOT EXISTS patient_identities (
  id              BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  patient_id      TEXT NOT NULL,             -- FHIR: Patient.id (hashed phone or sub-ID)
  id_number_hash  TEXT,                      -- SHA-256 of SA ID number (POPIA: no plaintext)
  id_verified     BOOLEAN DEFAULT FALSE,     -- TRUE when receptionist confirmed ID document
  verified_by     TEXT,                      -- Staff display_name who verified
  verified_at     TIMESTAMPTZ,
  facility_name   TEXT,                      -- Where verification happened
  notes           TEXT,                      -- e.g. "passport used" or "under 16, parent ID"
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_patient_identities_patient ON patient_identities (patient_id);
CREATE INDEX IF NOT EXISTS idx_patient_identities_id_hash ON patient_identities (id_number_hash) WHERE id_number_hash IS NOT NULL;

COMMENT ON TABLE patient_identities IS 'Staff-verified patient identity. SA ID number stored as hash only (POPIA). Enables cross-phone deduplication and NHI readiness.';
COMMENT ON COLUMN patient_identities.id_number_hash IS 'SHA-256 of SA 13-digit ID number. Used to detect duplicate registrations across different phones. Raw ID never stored.';

DO $$ BEGIN ALTER TABLE patient_identities ENABLE ROW LEVEL SECURITY; EXCEPTION WHEN undefined_table THEN NULL; END $$;
DO $$ BEGIN CREATE POLICY "Service role full access" ON patient_identities FOR ALL USING (true) WITH CHECK (true); EXCEPTION WHEN duplicate_object OR undefined_table THEN NULL; END $$;


-- ============================================================
-- PART 12c: PATIENT HEALTH PASSPORT TOKENS
-- ============================================================
CREATE TABLE IF NOT EXISTS passport_tokens (
  id          BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  patient_id  TEXT NOT NULL UNIQUE,
  token       TEXT NOT NULL UNIQUE,
  expires_at  TIMESTAMPTZ NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_passport_tokens_token ON passport_tokens (token, expires_at);

DO $$ BEGIN ALTER TABLE passport_tokens ENABLE ROW LEVEL SECURITY; EXCEPTION WHEN undefined_table THEN NULL; END $$;
DO $$ BEGIN CREATE POLICY "Service role full access" ON passport_tokens FOR ALL USING (true) WITH CHECK (true); EXCEPTION WHEN duplicate_object OR undefined_table THEN NULL; END $$;

COMMENT ON TABLE passport_tokens IS 'Time-limited tokens for patient health passport URLs. 24h expiry. Allows patients to share health summary with private doctors without login.';

-- Passport view audit log — tracks every time a doctor opens a passport link
CREATE TABLE IF NOT EXISTS passport_views (
  id           BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  patient_id   TEXT NOT NULL,
  token        TEXT NOT NULL,
  viewed_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  viewer_type  TEXT DEFAULT 'unknown',   -- 'patient', 'doctor', 'pharmacist', 'unknown'
  ip_address   TEXT,
  user_agent   TEXT
);
DO $body$ BEGIN ALTER TABLE passport_views ADD COLUMN IF NOT EXISTS viewer_type TEXT DEFAULT 'unknown'; EXCEPTION WHEN undefined_table OR duplicate_column THEN NULL; END $body$;

CREATE INDEX IF NOT EXISTS idx_passport_views_patient ON passport_views (patient_id, viewed_at DESC);

DO $$ BEGIN ALTER TABLE passport_views ENABLE ROW LEVEL SECURITY; EXCEPTION WHEN undefined_table THEN NULL; END $$;
DO $$ BEGIN CREATE POLICY "Service role full access" ON passport_views FOR ALL USING (true) WITH CHECK (true); EXCEPTION WHEN duplicate_object OR undefined_table THEN NULL; END $$;

COMMENT ON TABLE passport_views IS 'Audit trail for health passport views. Each row = one page load by a doctor/pharmacist. IP + user agent help distinguish unique viewers.';

-- Passport feedback — doctors rate whether the health summary was useful
CREATE TABLE IF NOT EXISTS passport_feedback (
  id          BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  patient_id  TEXT,
  token       TEXT NOT NULL,
  rating      TEXT NOT NULL,      -- 'yes' or 'no'
  comment     TEXT,               -- optional free text (max 500 chars)
  ip_address  TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_passport_feedback_rating ON passport_feedback (rating, created_at DESC);

DO $$ BEGIN ALTER TABLE passport_feedback ENABLE ROW LEVEL SECURITY; EXCEPTION WHEN undefined_table THEN NULL; END $$;
DO $$ BEGIN CREATE POLICY "Service role full access" ON passport_feedback FOR ALL USING (true) WITH CHECK (true); EXCEPTION WHEN duplicate_object OR undefined_table THEN NULL; END $$;

COMMENT ON TABLE passport_feedback IS 'Doctor/pharmacist feedback on health passport usefulness. Rating + optional comment. Key EVAH outcome metric for data portability.';

-- Prescriptions — recorded by nurse/doctor, displayed on health passport
-- The tool does NOT prescribe — it records what a licensed human prescribed.
CREATE TABLE IF NOT EXISTS prescriptions (
  id              BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  patient_id      TEXT NOT NULL,
  medication      TEXT NOT NULL,            -- e.g. 'Amoxicillin 500mg'
  dosage          TEXT,                     -- e.g. '1 tablet 3x daily'
  duration        TEXT,                     -- e.g. '7 days'
  quantity        TEXT,                     -- e.g. '21 tablets'
  prescribed_by   TEXT NOT NULL,            -- nurse/doctor display_name
  facility_name   TEXT,                     -- where prescribed
  notes           TEXT,                     -- e.g. 'Take with food', 'Review in 2 weeks'
  status          TEXT DEFAULT 'active',    -- active | completed | cancelled
  prescribed_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_prescriptions_patient ON prescriptions (patient_id, prescribed_at DESC);

DO $$ BEGIN ALTER TABLE prescriptions ENABLE ROW LEVEL SECURITY; EXCEPTION WHEN undefined_table THEN NULL; END $$;
DO $$ BEGIN CREATE POLICY "Service role full access" ON prescriptions FOR ALL USING (true) WITH CHECK (true); EXCEPTION WHEN duplicate_object OR undefined_table THEN NULL; END $$;

COMMENT ON TABLE prescriptions IS 'Prescriptions recorded by licensed clinic staff. Displayed on health passport for pharmacist reference. The system does NOT generate prescriptions — only records what a human prescribed.';

-- ============================================================
-- PART 13A: DISPENSING OUTCOMES
-- Tracks whether patients received their medication after consultation.
-- Part of the DoH Exit Process — medication dispensing verification.
-- ============================================================

CREATE TABLE IF NOT EXISTS dispensing_outcomes (
  id            BIGSERIAL PRIMARY KEY,
  patient_id    TEXT NOT NULL,
  follow_up_id  BIGINT,
  outcome       TEXT NOT NULL CHECK (outcome IN ('received', 'return_later', 'stockout', 'not_yet')),
  facility_name TEXT,
  response_received_at TIMESTAMPTZ DEFAULT NOW(),
  created_at    TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_dispensing_patient ON dispensing_outcomes (patient_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_dispensing_outcome ON dispensing_outcomes (outcome, created_at DESC);

DO $$ BEGIN ALTER TABLE dispensing_outcomes ENABLE ROW LEVEL SECURITY; EXCEPTION WHEN undefined_table THEN NULL; END $$;
DO $$ BEGIN CREATE POLICY "Service role full access" ON dispensing_outcomes FOR ALL USING (true) WITH CHECK (true); EXCEPTION WHEN duplicate_object OR undefined_table THEN NULL; END $$;

COMMENT ON TABLE dispensing_outcomes IS 'Tracks medication dispensing confirmation from patients. Stockout reports trigger governance alerts. Maps to FHIR MedicationDispense resource.';

-- ============================================================
-- PART 13B: SATISFACTION SURVEYS
-- Patient experience feedback after clinic visit.
-- Poor ratings (1-2) trigger governance alerts for facility review.
-- ============================================================

CREATE TABLE IF NOT EXISTS satisfaction_surveys (
  id            BIGSERIAL PRIMARY KEY,
  patient_id    TEXT NOT NULL,
  follow_up_id  BIGINT,
  rating        INTEGER NOT NULL CHECK (rating BETWEEN 1 AND 5),
  feedback_text TEXT,
  facility_name TEXT,
  response_received_at TIMESTAMPTZ DEFAULT NOW(),
  created_at    TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_satisfaction_patient ON satisfaction_surveys (patient_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_satisfaction_facility ON satisfaction_surveys (facility_name, rating);

DO $$ BEGIN ALTER TABLE satisfaction_surveys ENABLE ROW LEVEL SECURITY; EXCEPTION WHEN undefined_table THEN NULL; END $$;
DO $$ BEGIN CREATE POLICY "Service role full access" ON satisfaction_surveys FOR ALL USING (true) WITH CHECK (true); EXCEPTION WHEN duplicate_object OR undefined_table THEN NULL; END $$;

COMMENT ON TABLE satisfaction_surveys IS 'Patient satisfaction ratings (1-5) collected 4h after clinic visit. Poor ratings trigger governance alerts. Used for DoH quality improvement reporting.';

-- ============================================================
-- PART 13C: DISCHARGE SUMMARIES
-- Structured clinical discharge data from nurse/doctor back into Bizusizo.
-- DoH Exit Process: formal documentation of diagnosis, instructions, follow-up.
-- ============================================================

CREATE TABLE IF NOT EXISTS discharge_summaries (
  id                     BIGSERIAL PRIMARY KEY,
  patient_id             TEXT NOT NULL,
  queue_entry_id         BIGINT,
  facility_name          TEXT,
  triage_level           TEXT,
  diagnosis              TEXT,
  diagnosis_icd10        TEXT,
  clinical_notes         TEXT,
  discharge_instructions TEXT,
  follow_up_plan         TEXT,
  referral_to            TEXT,
  medications_prescribed TEXT[],
  tests_ordered          TEXT[],
  vitals_at_discharge    JSONB,
  entered_by             TEXT,
  entered_at             TIMESTAMPTZ,
  created_at             TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_discharge_patient ON discharge_summaries (patient_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_discharge_facility ON discharge_summaries (facility_name, created_at DESC);

DO $$ BEGIN ALTER TABLE discharge_summaries ENABLE ROW LEVEL SECURITY; EXCEPTION WHEN undefined_table THEN NULL; END $$;
DO $$ BEGIN CREATE POLICY "Service role full access" ON discharge_summaries FOR ALL USING (true) WITH CHECK (true); EXCEPTION WHEN duplicate_object OR undefined_table THEN NULL; END $$;

COMMENT ON TABLE discharge_summaries IS 'Structured clinical discharge summaries. Maps to FHIR Encounter.hospitalization.dischargeDisposition and DiagnosticReport. Sent to patient via WhatsApp.';

-- Add discharge_summary JSONB to clinic_queue for quick reference
DO $$ BEGIN ALTER TABLE clinic_queue ADD COLUMN IF NOT EXISTS discharge_summary JSONB; EXCEPTION WHEN undefined_table THEN NULL; END $$;

-- ============================================================
-- PART 13F: LONGITUDINAL VITALS HISTORY
-- Every BP, HR, RR, temp, glucose, weight recorded over time.
-- Enables trending: "is this patient's BP going up?"
-- Fed by: TEWS calculator, nurse assessment, discharge vitals.
-- ============================================================

CREATE TABLE IF NOT EXISTS vitals_history (
  id              BIGSERIAL PRIMARY KEY,
  patient_id      TEXT NOT NULL,
  facility_name   TEXT,
  recorded_by     TEXT,                -- nurse/doctor name
  recorded_by_role TEXT DEFAULT 'nurse',
  source          TEXT DEFAULT 'manual', -- 'tews', 'manual', 'discharge', 'kiosk'
  -- Vital signs
  systolic_bp     INT,                 -- mmHg
  diastolic_bp    INT,                 -- mmHg
  heart_rate      INT,                 -- bpm
  respiratory_rate INT,                -- breaths/min
  temperature     DECIMAL(4,1),        -- °C
  spo2            INT,                 -- % oxygen saturation
  glucose         DECIMAL(5,1),        -- mmol/L (fasting or random — noted in context)
  glucose_context TEXT,                -- 'fasting', 'random', 'post_meal'
  weight_kg       DECIMAL(5,1),        -- kg
  height_cm       INT,                 -- cm (usually only measured once)
  bmi             DECIMAL(4,1),        -- calculated
  avpu            TEXT,                -- A/V/P/U (level of consciousness)
  gcs             INT,                 -- Glasgow Coma Scale (3-15)
  pain_score      INT,                 -- 0-10
  -- Context
  context_notes   TEXT,                -- e.g. "post-exercise", "on medication", "fasting"
  recorded_at     TIMESTAMPTZ DEFAULT NOW(),
  created_at      TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_vitals_patient ON vitals_history (patient_id, recorded_at DESC);
CREATE INDEX IF NOT EXISTS idx_vitals_facility ON vitals_history (facility_name, recorded_at DESC);

DO $$ BEGIN ALTER TABLE vitals_history DISABLE ROW LEVEL SECURITY; EXCEPTION WHEN undefined_table THEN NULL; END $$;

COMMENT ON TABLE vitals_history IS 'Longitudinal vital signs history. Every BP, HR, temperature etc recorded over time. Enables clinical trending. Maps to FHIR Observation (vital-signs category). Deleted on STOP.';

-- ============================================================
-- PART 13G: ALLERGY RECORD
-- Drug allergies, food allergies, environmental allergies.
-- Prevents prescribing errors. Shown on pre-arrival alerts.
-- ============================================================

CREATE TABLE IF NOT EXISTS patient_allergies (
  id              BIGSERIAL PRIMARY KEY,
  patient_id      TEXT NOT NULL,
  allergy_type    TEXT NOT NULL CHECK (allergy_type IN ('drug', 'food', 'environmental', 'other')),
  allergen        TEXT NOT NULL,        -- e.g. 'Penicillin', 'Peanuts', 'Latex'
  reaction        TEXT,                 -- e.g. 'Rash', 'Anaphylaxis', 'Swelling'
  severity        TEXT DEFAULT 'unknown' CHECK (severity IN ('mild', 'moderate', 'severe', 'life_threatening', 'unknown')),
  confirmed       BOOLEAN DEFAULT FALSE, -- clinician-confirmed vs patient-reported
  reported_by     TEXT,                 -- who recorded it
  reported_at     TIMESTAMPTZ DEFAULT NOW(),
  active          BOOLEAN DEFAULT TRUE, -- can be deactivated if disproven
  notes           TEXT,
  created_at      TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_allergies_patient ON patient_allergies (patient_id, active);

DO $$ BEGIN ALTER TABLE patient_allergies DISABLE ROW LEVEL SECURITY; EXCEPTION WHEN undefined_table THEN NULL; END $$;

COMMENT ON TABLE patient_allergies IS 'Patient allergy record. Drug, food, environmental. Severity-graded. Shown on pre-arrival alerts and discharge summaries. Maps to FHIR AllergyIntolerance. Deleted on STOP.';

-- Add EMS call tracking columns to referrals table
DO $$ BEGIN ALTER TABLE referrals ADD COLUMN IF NOT EXISTS ems_call_helper JSONB; EXCEPTION WHEN undefined_table THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE referrals ADD COLUMN IF NOT EXISTS ems_call_status TEXT DEFAULT 'pending'; EXCEPTION WHEN undefined_table THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE referrals ADD COLUMN IF NOT EXISTS ems_authorised_by TEXT; EXCEPTION WHEN undefined_table THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE referrals ADD COLUMN IF NOT EXISTS ems_authorised_at TIMESTAMPTZ; EXCEPTION WHEN undefined_table THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE referrals ADD COLUMN IF NOT EXISTS ems_called_by TEXT; EXCEPTION WHEN undefined_table THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE referrals ADD COLUMN IF NOT EXISTS ems_called_at TIMESTAMPTZ; EXCEPTION WHEN undefined_table THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE referrals ADD COLUMN IF NOT EXISTS ems_dispatch_reference TEXT; EXCEPTION WHEN undefined_table THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE referrals ADD COLUMN IF NOT EXISTS ems_arrived_at TIMESTAMPTZ; EXCEPTION WHEN undefined_table THEN NULL; END $$;

-- ============================================================
-- PART 13E: CHRONIC REGIMEN CHANGES
-- Tracks medication regimen changes for chronic patients.
-- HPCSA requires: drugs + dosage, reason, who decided, patient counselled.
-- ============================================================

CREATE TABLE IF NOT EXISTS regimen_changes (
  id                    BIGSERIAL PRIMARY KEY,
  patient_id            TEXT NOT NULL,
  queue_entry_id        BIGINT,
  facility_name         TEXT,
  condition             TEXT NOT NULL,           -- e.g. 'hiv', 'hypertension', 'diabetes'
  previous_medication   TEXT,                    -- what they were on
  new_medication        TEXT NOT NULL,            -- what they're changing to
  dosage                TEXT,                    -- dosage of new medication
  change_reason         TEXT NOT NULL CHECK (change_reason IN ('step_up', 'step_down', 'adverse_effect', 'viral_failure', 'treatment_failure', 'stockout', 'patient_preference', 'new_diagnosis', 'other')),
  change_reason_detail  TEXT,                    -- free text detail
  lab_results_trigger   TEXT,                    -- e.g. 'VL 5400 copies/mL' or 'HbA1c 9.2%'
  authorised_by         TEXT NOT NULL,           -- nurse or doctor name
  authorised_by_role    TEXT DEFAULT 'nurse',     -- 'nurse', 'doctor', 'cnp'
  patient_counselled    BOOLEAN DEFAULT FALSE,   -- HPCSA requirement
  counselling_notes     TEXT,                    -- what was explained to patient
  effective_date        DATE DEFAULT CURRENT_DATE,
  created_at            TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_regimen_patient ON regimen_changes (patient_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_regimen_facility ON regimen_changes (facility_name, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_regimen_condition ON regimen_changes (condition, change_reason);

DO $$ BEGIN ALTER TABLE regimen_changes ENABLE ROW LEVEL SECURITY; EXCEPTION WHEN undefined_table THEN NULL; END $$;
DO $$ BEGIN CREATE POLICY "Service role full access" ON regimen_changes FOR ALL USING (true) WITH CHECK (true); EXCEPTION WHEN duplicate_object OR undefined_table THEN NULL; END $$;

COMMENT ON TABLE regimen_changes IS 'Chronic medication regimen changes per HPCSA documentation requirements. Tracks previous→new medication, reason, authoriser, lab trigger, and patient counselling. Deleted on STOP.';

-- ============================================================
-- PART 13D: CLINICAL GOVERNANCE LEAD
-- Named individual accountable for AI tool outcomes at each facility.
-- Addresses Edreco Amos governance question #2: "Name the person."
-- ============================================================

-- Add governance lead fields to facilities table
DO $$ BEGIN ALTER TABLE facilities ADD COLUMN IF NOT EXISTS clinical_governance_lead TEXT; EXCEPTION WHEN undefined_table THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE facilities ADD COLUMN IF NOT EXISTS clinical_governance_lead_contact TEXT; EXCEPTION WHEN undefined_table THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE facilities ADD COLUMN IF NOT EXISTS clinical_governance_lead_title TEXT; EXCEPTION WHEN undefined_table THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE facilities ADD COLUMN IF NOT EXISTS governance_lead_updated_at TIMESTAMPTZ; EXCEPTION WHEN undefined_table THEN NULL; END $$;

COMMENT ON COLUMN facilities.clinical_governance_lead IS 'Named individual accountable for AI triage tool outcomes at this facility. Required for governance compliance per DoH AI accountability framework.';

-- Add entry_method to clinic_queue for EMS tracking
DO $$ BEGIN ALTER TABLE clinic_queue ADD COLUMN IF NOT EXISTS entry_method TEXT DEFAULT 'whatsapp'; EXCEPTION WHEN undefined_table THEN NULL; END $$;

-- Add override_reason and override_notes to triage_feedback if not already present
DO $$ BEGIN ALTER TABLE triage_feedback ADD COLUMN IF NOT EXISTS override_reason TEXT; EXCEPTION WHEN undefined_table THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE triage_feedback ADD COLUMN IF NOT EXISTS override_notes TEXT; EXCEPTION WHEN undefined_table THEN NULL; END $$;

-- ============================================================
-- PART 13: SERVICE ROLE GRANTS
-- Required after any table recreation — RLS blocks service role by default
-- Run this after every migration that creates or recreates tables
-- ============================================================
GRANT ALL ON ALL TABLES IN SCHEMA public TO service_role;
GRANT ALL ON ALL TABLES IN SCHEMA public TO anon;
GRANT ALL ON ALL TABLES IN SCHEMA public TO authenticated;
GRANT USAGE ON SCHEMA public TO service_role, anon, authenticated;