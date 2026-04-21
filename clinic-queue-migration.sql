-- ============================================================
-- BIZUSIZO: Clinic Queue Management Table
-- Run this in your Supabase SQL editor
-- ============================================================

CREATE TABLE IF NOT EXISTS clinic_queue (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  patient_id TEXT NOT NULL,
  patient_phone TEXT,
  patient_name TEXT,
  
  -- Triage data (pulled from BIZUSIZO WhatsApp triage)
  triage_level TEXT DEFAULT 'UNKNOWN',  -- RED, ORANGE, YELLOW, GREEN, UNKNOWN
  triage_confidence INTEGER,
  symptoms_summary TEXT,
  
  -- Queue assignment
  queue_type TEXT NOT NULL DEFAULT 'walk_in',  -- fast_track, routine, walk_in
  status TEXT NOT NULL DEFAULT 'waiting',       -- waiting, in_consultation, completed, no_show
  position INTEGER DEFAULT 1,
  
  -- Timestamps
  checked_in_at TIMESTAMPTZ DEFAULT NOW(),
  called_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  
  -- Staff
  assigned_to TEXT,       -- nurse/doctor name who called the patient
  added_by TEXT,          -- reception staff who checked patient in
  
  -- Metadata
  notes TEXT,
  study_code TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Indexes for fast queries
CREATE INDEX IF NOT EXISTS idx_clinic_queue_status ON clinic_queue(status);
CREATE INDEX IF NOT EXISTS idx_clinic_queue_queue_type ON clinic_queue(queue_type);
CREATE INDEX IF NOT EXISTS idx_clinic_queue_patient_id ON clinic_queue(patient_id);
CREATE INDEX IF NOT EXISTS idx_clinic_queue_checked_in ON clinic_queue(checked_in_at);
CREATE INDEX IF NOT EXISTS idx_clinic_queue_status_type ON clinic_queue(status, queue_type);

-- Enable Row Level Security (but allow service role full access)
ALTER TABLE clinic_queue ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Service role full access" ON clinic_queue
  FOR ALL USING (true) WITH CHECK (true);

-- ============================================================
-- Optional: View for today's queue (convenience)
-- ============================================================
CREATE OR REPLACE VIEW today_queue AS
SELECT 
  *,
  EXTRACT(EPOCH FROM (COALESCE(called_at, NOW()) - checked_in_at)) / 60 AS wait_minutes
FROM clinic_queue
WHERE checked_in_at >= CURRENT_DATE
ORDER BY 
  CASE queue_type 
    WHEN 'fast_track' THEN 1 
    WHEN 'routine' THEN 2 
    WHEN 'walk_in' THEN 3 
  END,
  position ASC;
