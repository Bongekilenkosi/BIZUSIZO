'use strict';
// Session DB layer + identity helpers.
// All Supabase reads/writes for patient sessions, triage logs, and follow-ups live here.
// Identity helpers (hashPhone, levenshtein, parseDOB, validateDOB, capitalizeName)
// are pure functions exported for use in orchestrate() and routes.
const crypto = require('crypto');
const logger = require('../logger');
const { TRIAGE_PROMPT_VERSION } = require('./triage');

let _supabase = null;
function init(supabase) { _supabase = supabase; }

function levenshtein(a, b) {
  if (a.length === 0) return b.length;
  if (b.length === 0) return a.length;
  const matrix = [];
  for (let i = 0; i <= b.length; i++) matrix[i] = [i];
  for (let j = 0; j <= a.length; j++) matrix[0][j] = j;
  for (let i = 1; i <= b.length; i++) {
    for (let j = 1; j <= a.length; j++) {
      const cost = a[j - 1] === b[i - 1] ? 0 : 1;
      matrix[i][j] = Math.min(
        matrix[i - 1][j] + 1,      // deletion
        matrix[i][j - 1] + 1,      // insertion
        matrix[i - 1][j - 1] + cost // substitution
      );
    }
  }
  return matrix[b.length][a.length];
}

function hashPhone(phone) {
  return crypto.createHash('sha256').update(phone).digest('hex').slice(0, 16);
}

// ================== IDENTITY HELPERS ==================
// DOB parsing handles common SA input patterns:
// "15-03-1992", "15/03/1992", "15 03 1992", "1992-03-15", "15031992"
function parseDOB(input) {
  const cleaned = (input || '').trim();
  let match = cleaned.match(/^(\d{1,2})[\/\-\s](\d{1,2})[\/\-\s](\d{4})$/);
  if (match) {
    const [, d, m, y] = match;
    return validateDOB(parseInt(d), parseInt(m), parseInt(y));
  }
  match = cleaned.match(/^(\d{4})[\/\-\s](\d{1,2})[\/\-\s](\d{1,2})$/);
  if (match) {
    const [, y, m, d] = match;
    return validateDOB(parseInt(d), parseInt(m), parseInt(y));
  }
  match = cleaned.match(/^(\d{2})(\d{2})(\d{4})$/);
  if (match) {
    const [, d, m, y] = match;
    return validateDOB(parseInt(d), parseInt(m), parseInt(y));
  }
  return { valid: false };
}

function validateDOB(day, month, year) {
  const now = new Date();
  const currentYear = now.getFullYear();
  if (year < 1900 || year > currentYear) return { valid: false };
  if (month < 1 || month > 12) return { valid: false };
  if (day < 1 || day > 31) return { valid: false };
  const dob = new Date(year, month - 1, day);
  if (dob > now) return { valid: false };
  const age = Math.floor((now - dob) / (365.25 * 24 * 60 * 60 * 1000));
  return {
    valid: true, day, month, year,
    dob_string: `${String(day).padStart(2, '0')}-${String(month).padStart(2, '0')}-${year}`,
    dob_iso: dob.toISOString().split('T')[0],
    age,
  };
}

function capitalizeName(name) {
  return (name || '').trim()
    .split(/\s+/)
    .map(w => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
    .join(' ');
}

// ================== STUDY CODE GENERATOR ==================
// Generates a short, memorable code like "BZ-4827" that links
// the patient's BIZUSIZO session to clinic register data.
// The code is shown to the patient on WhatsApp after onboarding.
// The research assistant records it alongside the nurse triage.
// This bridges digital (hashed patient_id) and paper (clinic register).
async function generateStudyCode(patientId) {
  // Check if patient already has a code
  const { data: existing } = await _supabase
    .from('study_codes')
    .select('study_code')
    .eq('patient_id', patientId)
    .limit(1);

  if (existing && existing.length > 0) {
    return existing[0].study_code;
  }

  // Generate a unique code: BZ-XXXX (4 digits, checked for uniqueness)
  let code;
  let attempts = 0;
  while (attempts < 10) {
    const num = Math.floor(1000 + Math.random() * 9000); // 1000-9999
    code = `BZ-${num}`;

    const { data: clash } = await _supabase
      .from('study_codes')
      .select('id')
      .eq('study_code', code)
      .limit(1);

    if (!clash || clash.length === 0) break;
    attempts++;
  }

  // If 4-digit space exhausted (unlikely with <9000 patients), extend to 5 digits
  if (attempts >= 10) {
    const num = Math.floor(10000 + Math.random() * 90000);
    code = `BZ-${num}`;
  }

  // Store the mapping
  await _supabase.from('study_codes').insert({
    patient_id: patientId,
    study_code: code,
    created_at: new Date()
  });

  return code;
}

// Lookup patient by study code (used by research assistants via API)
async function lookupStudyCode(studyCode) {
  const { data } = await _supabase
    .from('study_codes')
    .select('*')
    .eq('study_code', studyCode.toUpperCase().trim())
    .limit(1);

  return data && data.length > 0 ? data[0] : null;
}

// WHATSAPP_API_VERSION, sendWhatsAppMessage extracted to lib/whatsapp.js

// ================== DATABASE ==================
async function getSession(patientId) {
  const { data } = await _supabase
    .from('sessions')
    .select('*')
    .eq('patient_id', patientId)
    .single();
  if (!data?.data) return {};
  // 90-day session expiry — stale sessions are treated as empty
  const SESSION_TTL_MS = 90 * 24 * 60 * 60 * 1000;
  if (data.updated_at && (Date.now() - new Date(data.updated_at).getTime()) > SESSION_TTL_MS) {
    logger.info(`[SESSION] Expired session for patient (updated ${data.updated_at})`);
    return {};
  }
  return data.data;
}

async function saveSession(patientId, session) {
  // NOTE — concurrency: this is upsert-on-patient_id (last-write-wins).
  // Two concurrent webhook handlers for the same patient will clobber each
  // other silently. In practice this is mitigated by (a) webhook-level
  // dedup in index.js (_seenMessages Set with 5-min TTL), which catches
  // Meta's own retries within a single process, and (b) sessionId-per-
  // conversation avoiding patient-side parallelism. Full protection
  // against multi-process race requires an optimistic-concurrency version
  // column on the sessions table — flagged as a pre-scale (not pre-pilot)
  // item; low probability at pilot traffic levels.
  await _supabase.from('sessions').upsert({
    patient_id: patientId,
    data: session,
    updated_at: new Date()
  });
}

async function logTriage(entry) {
  // identity_verified defaults to false unless explicitly set — all WhatsApp names are self-reported
  if (entry.identity_verified === undefined) entry.identity_verified = false;
  // input_source: 'voice_note' | 'text' | null — flags transcription-based triages for nurse review
  if (entry.input_source === undefined) entry.input_source = 'text';
  // prompt_version — links every triage event to the system prompt that produced it
  if (entry.prompt_version === undefined) entry.prompt_version = triageLib.TRIAGE_PROMPT_VERSION;
  // safety_net_upgrade — flag when rules engine upgraded GREEN→YELLOW (under-triage prevention)
  if (entry.rule_override === 'green_safety_net') entry.safety_net_upgrade = true;
  // low_confidence_flag — confidence remained below threshold after clarification; flagged for nurse review
  if (entry.low_confidence_flag === undefined) entry.low_confidence_flag = false;

  // IDEMPOTENCY — post-restart webhook retry safety.
  // index.js has in-memory webhook-level dedup (_seenMessages, 5-min TTL)
  // that handles Meta's retry-within-process case. For cross-restart
  // dedup, the migration at triage_logs_idempotency_migration.sql adds
  // a partial unique index on (patient_id, whatsapp_message_id).
  // Callers that pass whatsapp_message_id get upsert semantics (retry-
  // safe). Callers that omit it get insert semantics (unchanged).
  if (entry.whatsapp_message_id) {
    await _supabase.from('triage_logs')
      .upsert(entry, { onConflict: 'patient_id,whatsapp_message_id' });
  } else {
    await _supabase.from('triage_logs').insert(entry);
  }
}

async function scheduleFollowUp(patientId, phone, triageLevel) {
  // Deduplicate — don't double-schedule check_in/symptom_check rows.
  // Exclude morning_reminder and next_visit_reminder from this check.
  const { data: existing } = await _supabase.from('follow_ups')
    .select('id')
    .eq('patient_id', patientId)
    .in('status', ['pending', 'sent'])
    .or('type.is.null,type.eq.check_in,type.eq.symptom_check')
    .limit(1);
  if (existing && existing.length > 0) return;

  const now = Date.now();
  // 24h check-in — lightweight "did you make it?"
  await _supabase.from('follow_ups').insert({
    patient_id: patientId,
    phone,
    triage_level: triageLevel,
    scheduled_at: new Date(now + 24 * 60 * 60 * 1000),
    status: 'pending',
    type: 'check_in'
  });
  // 72h symptom check — full 1/2/3 outcome capture
  await _supabase.from('follow_ups').insert({
    patient_id: patientId,
    phone,
    triage_level: triageLevel,
    scheduled_at: new Date(now + 72 * 60 * 60 * 1000),
    status: 'pending',
    type: 'symptom_check'
  });
}

async function getDueFollowUps() {
  const { data } = await _supabase
    .from('follow_ups')
    .select('*')
    .lte('scheduled_at', new Date())
    .eq('status', 'pending');
  return data || [];
}

async function markFollowUpDone(id) {
  await _supabase
    .from('follow_ups')
    .update({ status: 'completed' })
    .eq('id', id);
}

module.exports = {
  init,
  // DB layer
  getSession, saveSession,
  logTriage, scheduleFollowUp,
  getDueFollowUps, markFollowUpDone,
  // Identity helpers
  hashPhone, levenshtein,
  parseDOB, validateDOB, capitalizeName,
  generateStudyCode, lookupStudyCode,
};
