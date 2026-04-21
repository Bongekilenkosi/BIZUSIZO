'use strict';
// ============================================================
// FHIR R4 Export Endpoints
// Exposes Bizusizo data as FHIR R4-compliant JSON resources.
// Authenticated via dashboard auth (same as clinical endpoints).
// Supports: Patient, Observation (triage), ServiceRequest (referral),
//           Appointment (follow-up), Organization (facility).
// Reference: https://hl7.org/fhir/R4/
// ============================================================
const logger = require('../logger');

// SATS triage colour → FHIR priority mapping
const TRIAGE_TO_PRIORITY = {
  RED: 'stat',
  ORANGE: 'asap',
  YELLOW: 'urgent',
  GREEN: 'routine',
};

// SA language code → BCP-47
const LANG_TO_BCP47 = {
  en: 'en-ZA', zu: 'zu-ZA', xh: 'xh-ZA', af: 'af-ZA',
  nso: 'nso-ZA', tn: 'tn-ZA', st: 'st-ZA', ts: 'ts-ZA',
  ss: 'ss-ZA', ve: 've-ZA', nr: 'nr-ZA',
};

// Build a FHIR Patient resource from session data
function toFhirPatient(session) {
  const d = session.data || {};
  const resource = {
    resourceType: 'Patient',
    id: session.patient_id,
    meta: {
      lastUpdated: session.updated_at || session.created_at,
      profile: ['http://hl7.org/fhir/StructureDefinition/Patient'],
    },
    active: true,
    name: [],
    communication: [],
  };

  // Name
  if (d.firstName || d.surname) {
    resource.name.push({
      use: 'official',
      family: d.surname || undefined,
      given: d.firstName ? [d.firstName] : undefined,
    });
  }

  // Date of birth
  if (d.dob && d.dob.raw) {
    resource.birthDate = d.dob.raw; // YYYY-MM-DD
  }

  // Gender
  if (d.sex) {
    const sexMap = { male: 'male', female: 'female', m: 'male', f: 'female' };
    resource.gender = sexMap[d.sex.toLowerCase()] || 'unknown';
  }

  // Language (stored inside session.data)
  const lang = d.language;
  if (lang) {
    resource.communication.push({
      language: {
        coding: [{
          system: 'urn:ietf:bcp:47',
          code: LANG_TO_BCP47[lang] || lang,
        }],
      },
      preferred: true,
    });
  }

  // Chronic conditions as extensions
  const conditions = d.chronicConditions || d.ccmddConditions || [];
  if (conditions.length > 0) {
    resource.extension = conditions.map(c => ({
      url: 'http://bizusizo.co.za/fhir/StructureDefinition/chronic-condition',
      valueString: c.label_en || c,
    }));
  }

  return resource;
}

// Build a FHIR Observation (triage) from triage_logs row
function toFhirTriageObservation(triage) {
  return {
    resourceType: 'Observation',
    id: `triage-${triage.id}`,
    meta: {
      lastUpdated: triage.created_at,
      profile: ['http://hl7.org/fhir/StructureDefinition/Observation'],
    },
    status: 'final',
    category: [{
      coding: [{
        system: 'http://terminology.hl7.org/CodeSystem/observation-category',
        code: 'survey',
        display: 'Survey',
      }],
    }],
    code: {
      coding: [{
        system: 'http://loinc.org',
        code: '74728-7',
        display: 'Vital signs, weight, height, head circumference, oxygen saturation and BMI panel',
      }],
      text: 'South African Triage Scale (SATS) Assessment',
    },
    subject: { reference: `Patient/${triage.patient_id}` },
    effectiveDateTime: triage.created_at,
    valueCodeableConcept: {
      coding: [{
        system: 'http://bizusizo.co.za/fhir/CodeSystem/sats-triage-level',
        code: triage.triage_level,
        display: triage.triage_level,
      }],
      text: `SATS: ${triage.triage_level}`,
    },
    interpretation: [{
      coding: [{
        system: 'http://terminology.hl7.org/CodeSystem/v3-ObservationInterpretation',
        code: TRIAGE_TO_PRIORITY[triage.triage_level] || 'routine',
      }],
    }],
    note: [
      triage.symptoms ? { text: triage.symptoms } : null,
      triage.reasoning ? { text: `AI reasoning: ${triage.reasoning}` } : null,
    ].filter(Boolean),
    component: [
      {
        code: { text: 'confidence' },
        valueQuantity: { value: parseInt(triage.confidence) || 0, unit: '%' },
      },
      triage.discriminator_matched ? {
        code: { text: 'discriminator_matched' },
        valueString: triage.discriminator_matched,
      } : null,
      triage.rule_override ? {
        code: { text: 'rule_override' },
        valueString: triage.rule_override,
      } : null,
      triage.safety_net_upgrade ? {
        code: { text: 'safety_net_upgrade' },
        valueBoolean: true,
      } : null,
      // ICD-10 code from DCSL mapping (if governance metadata includes it)
      (triage.governance?.icd10 || triage.icd10_code) ? {
        code: {
          coding: [{
            system: 'http://hl7.org/fhir/sid/icd-10-cm',
            code: (triage.governance?.icd10?.code || triage.icd10_code),
            display: (triage.governance?.icd10?.display || triage.icd10_display || 'ICD-10 mapped'),
          }],
          text: 'ICD-10-CM category (triage-level, not diagnosis)',
        },
        valueString: (triage.governance?.icd10?.code || triage.icd10_code),
      } : null,
    ].filter(Boolean),
  };
}

// Build a FHIR ServiceRequest (referral)
function toFhirServiceRequest(referral) {
  return {
    resourceType: 'ServiceRequest',
    id: `referral-${referral.id}`,
    meta: { lastUpdated: referral.updated_at || referral.created_at },
    status: referral.status === 'completed' ? 'completed' : 'active',
    intent: 'order',
    priority: TRIAGE_TO_PRIORITY[referral.triage_level] || 'routine',
    code: {
      text: referral.reason || 'Triage referral',
    },
    subject: { reference: `Patient/${referral.patient_id}` },
    requester: referral.originating_facility_name
      ? { display: referral.originating_facility_name }
      : undefined,
    performer: referral.destination_facility
      ? [{ display: referral.destination_facility }]
      : undefined,
    authoredOn: referral.created_at,
    note: referral.symptoms_summary
      ? [{ text: referral.symptoms_summary }]
      : undefined,
  };
}

// Build a FHIR Organization (facility)
function toFhirOrganization(facility) {
  return {
    resourceType: 'Organization',
    id: `facility-${facility.id}`,
    meta: { lastUpdated: facility.updated_at },
    active: facility.active !== false,
    name: facility.name,
    type: [{
      coding: [{
        system: 'http://bizusizo.co.za/fhir/CodeSystem/facility-type',
        code: facility.type,
        display: facility.type === 'clinic' ? 'Primary Health Care Clinic'
          : facility.type === 'chc' ? 'Community Health Centre'
          : 'Hospital',
      }],
    }],
    telecom: facility.phone ? [{ system: 'phone', value: facility.phone }] : undefined,
    address: facility.address ? [{
      text: facility.address,
      state: facility.province || 'Gauteng',
      country: 'ZA',
    }] : undefined,
    extension: [
      facility.opening_hours ? {
        url: 'http://bizusizo.co.za/fhir/StructureDefinition/opening-hours',
        valueString: facility.opening_hours,
      } : null,
      facility.latitude ? {
        url: 'http://hl7.org/fhir/StructureDefinition/geolocation',
        extension: [
          { url: 'latitude', valueDecimal: facility.latitude },
          { url: 'longitude', valueDecimal: facility.longitude },
        ],
      } : null,
    ].filter(Boolean),
  };
}

// FHIR Bundle wrapper
function toBundle(type, resources, total) {
  return {
    resourceType: 'Bundle',
    type: type || 'searchset',
    total: total !== undefined ? total : resources.length,
    entry: resources.map(r => ({
      resource: r,
      fullUrl: `urn:uuid:${r.id}`,
    })),
  };
}

module.exports = function registerFhirRoutes(app, { supabase, requireDashboardAuth }) {

  // ── FHIR Capability Statement (metadata) ─────────────────
  app.get('/api/fhir/metadata', (req, res) => {
    res.json({
      resourceType: 'CapabilityStatement',
      status: 'active',
      date: new Date().toISOString(),
      kind: 'instance',
      software: { name: 'Bizusizo', version: '2.3' },
      fhirVersion: '4.0.1',
      format: ['json'],
      rest: [{
        mode: 'server',
        resource: [
          { type: 'Patient', interaction: [{ code: 'read' }, { code: 'search-type' }] },
          { type: 'Observation', interaction: [{ code: 'read' }, { code: 'search-type' }] },
          { type: 'ServiceRequest', interaction: [{ code: 'read' }, { code: 'search-type' }] },
          { type: 'Organization', interaction: [{ code: 'read' }, { code: 'search-type' }] },
        ],
      }],
    });
  });

  // ── GET /api/fhir/Patient?_count=N ────────────────────────
  app.get('/api/fhir/Patient', requireDashboardAuth, async (req, res) => {
    try {
      const count = Math.min(parseInt(req.query._count) || 50, 200);
      const { data, error } = await supabase
        .from('sessions')
        .select('patient_id, data, created_at, updated_at')
        .order('updated_at', { ascending: false })
        .limit(count);

      if (error) throw error;
      const patients = (data || []).map(toFhirPatient);
      res.json(toBundle('searchset', patients));
    } catch (e) {
      logger.error('[FHIR] Patient search error:', e.message);
      res.status(500).json({ resourceType: 'OperationOutcome', issue: [{ severity: 'error', code: 'exception', diagnostics: 'Server error' }] });
    }
  });

  // ── GET /api/fhir/Patient/:id ─────────────────────────────
  app.get('/api/fhir/Patient/:id', requireDashboardAuth, async (req, res) => {
    try {
      const { data, error } = await supabase
        .from('sessions')
        .select('patient_id, data, created_at, updated_at')
        .eq('patient_id', req.params.id)
        .single();

      if (error || !data) {
        return res.status(404).json({ resourceType: 'OperationOutcome', issue: [{ severity: 'error', code: 'not-found' }] });
      }
      res.json(toFhirPatient(data));
    } catch (e) {
      logger.error('[FHIR] Patient read error:', e.message);
      res.status(500).json({ resourceType: 'OperationOutcome', issue: [{ severity: 'error', code: 'exception', diagnostics: 'Server error' }] });
    }
  });

  // ── GET /api/fhir/Observation?patient=X&_count=N ──────────
  app.get('/api/fhir/Observation', requireDashboardAuth, async (req, res) => {
    try {
      const count = Math.min(parseInt(req.query._count) || 50, 200);
      let query = supabase
        .from('triage_logs')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(count);

      if (req.query.patient) {
        query = query.eq('patient_id', req.query.patient);
      }

      const { data, error } = await query;
      if (error) throw error;
      const observations = (data || []).map(toFhirTriageObservation);
      res.json(toBundle('searchset', observations));
    } catch (e) {
      logger.error('[FHIR] Observation search error:', e.message);
      res.status(500).json({ resourceType: 'OperationOutcome', issue: [{ severity: 'error', code: 'exception', diagnostics: 'Server error' }] });
    }
  });

  // ── GET /api/fhir/Observation/:id ─────────────────────────
  app.get('/api/fhir/Observation/:id', requireDashboardAuth, async (req, res) => {
    try {
      const triageId = req.params.id.replace('triage-', '');
      const { data, error } = await supabase
        .from('triage_logs')
        .select('*')
        .eq('id', triageId)
        .single();

      if (error || !data) {
        return res.status(404).json({ resourceType: 'OperationOutcome', issue: [{ severity: 'error', code: 'not-found' }] });
      }
      res.json(toFhirTriageObservation(data));
    } catch (e) {
      logger.error('[FHIR] Observation read error:', e.message);
      res.status(500).json({ resourceType: 'OperationOutcome', issue: [{ severity: 'error', code: 'exception', diagnostics: 'Server error' }] });
    }
  });

  // ── GET /api/fhir/ServiceRequest?patient=X&_count=N ───────
  app.get('/api/fhir/ServiceRequest', requireDashboardAuth, async (req, res) => {
    try {
      const count = Math.min(parseInt(req.query._count) || 50, 200);
      let query = supabase
        .from('referrals')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(count);

      if (req.query.patient) {
        query = query.eq('patient_id', req.query.patient);
      }

      const { data, error } = await query;
      if (error) throw error;
      const requests = (data || []).map(toFhirServiceRequest);
      res.json(toBundle('searchset', requests));
    } catch (e) {
      logger.error('[FHIR] ServiceRequest search error:', e.message);
      res.status(500).json({ resourceType: 'OperationOutcome', issue: [{ severity: 'error', code: 'exception', diagnostics: 'Server error' }] });
    }
  });

  // ── GET /api/fhir/Patient/:id/$summary ─────────────────────
  // FHIR $summary operation — returns a complete handover bundle
  // for a single patient: demographics, all triages, referrals,
  // follow-up outcomes, and chronic conditions. Designed for
  // hospital receiving doctors who need full context in one call.
  app.get('/api/fhir/Patient/:id/\\$summary', requireDashboardAuth, async (req, res) => {
    try {
      const patientId = req.params.id;

      // Fetch all patient data in parallel
      const [sessionRes, triageRes, referralRes, outcomeRes, feedbackRes] = await Promise.all([
        supabase.from('sessions').select('*').eq('patient_id', patientId).single(),
        supabase.from('triage_logs').select('*').eq('patient_id', patientId).order('created_at', { ascending: false }).limit(20),
        supabase.from('referrals').select('*').eq('patient_id', patientId).order('created_at', { ascending: false }).limit(10),
        supabase.from('follow_up_outcomes').select('*').eq('patient_id', patientId).order('response_received_at', { ascending: false }).limit(10),
        supabase.from('triage_feedback').select('*').eq('patient_id', patientId).order('created_at', { ascending: false }).limit(10),
      ]);

      if (sessionRes.error && !triageRes.data?.length) {
        return res.status(404).json({ resourceType: 'OperationOutcome', issue: [{ severity: 'error', code: 'not-found', diagnostics: 'Patient not found' }] });
      }

      const resources = [];

      // Patient resource
      if (sessionRes.data) {
        resources.push(toFhirPatient(sessionRes.data));
      }

      // All triage observations
      for (const t of (triageRes.data || [])) {
        resources.push(toFhirTriageObservation(t));
      }

      // All referrals
      for (const r of (referralRes.data || [])) {
        resources.push(toFhirServiceRequest(r));
      }

      // Follow-up outcomes as Observations
      for (const o of (outcomeRes.data || [])) {
        resources.push({
          resourceType: 'Observation',
          id: `followup-${o.id}`,
          status: 'final',
          category: [{ coding: [{ system: 'http://terminology.hl7.org/CodeSystem/observation-category', code: 'survey' }] }],
          code: { text: 'Follow-up Outcome' },
          subject: { reference: `Patient/${patientId}` },
          effectiveDateTime: o.response_received_at,
          component: [
            { code: { text: 'symptom_outcome' }, valueString: o.symptom_outcome || 'unknown' },
            { code: { text: 'visited_clinic' }, valueString: o.visited_clinic || 'unknown' },
            o.access_failure ? { code: { text: 'access_failure' }, valueString: o.access_failure } : null,
            o.facility_name ? { code: { text: 'facility' }, valueString: o.facility_name } : null,
          ].filter(Boolean),
        });
      }

      // Nurse feedback as Observations
      for (const f of (feedbackRes.data || [])) {
        resources.push({
          resourceType: 'Observation',
          id: `feedback-${f.id}`,
          status: 'final',
          category: [{ coding: [{ system: 'http://terminology.hl7.org/CodeSystem/observation-category', code: 'exam' }] }],
          code: { text: 'Nurse Triage Feedback' },
          subject: { reference: `Patient/${patientId}` },
          effectiveDateTime: f.created_at,
          component: [
            { code: { text: 'ai_triage_level' }, valueString: f.ai_triage_level || 'unknown' },
            { code: { text: 'nurse_triage_level' }, valueString: f.nurse_triage_level || f.ai_triage_level || 'unknown' },
            { code: { text: 'verdict' }, valueString: f.verdict || 'unknown' },
            f.symptoms_summary ? { code: { text: 'symptoms' }, valueString: f.symptoms_summary } : null,
          ].filter(Boolean),
        });
      }

      // Build a clinical summary narrative
      const session = sessionRes.data?.data || {};
      const triages = triageRes.data || [];
      const conditions = (session.chronicConditions || []).map(c => c.label_en || c).join(', ') || 'None known';
      const lastTriage = triages[0];
      const triageCount = triages.length;
      const trend = triages.length >= 2
        ? `${triages[1].triage_level} → ${triages[0].triage_level}`
        : lastTriage ? lastTriage.triage_level : 'No triage';

      const narrative = {
        resourceType: 'Composition',
        id: `summary-${patientId}`,
        status: 'final',
        type: { coding: [{ system: 'http://loinc.org', code: '60591-5', display: 'Patient summary Document' }] },
        subject: { reference: `Patient/${patientId}` },
        date: new Date().toISOString(),
        title: 'BIZUSIZO Patient Handover Summary',
        section: [
          {
            title: 'Demographics',
            text: { status: 'generated', div: `<div>Name: ${session.firstName || ''} ${session.surname || ''} | DOB: ${session.dob?.display || 'Unknown'} | Sex: ${session.sex || 'Unknown'} | Language: ${session.language || 'en'}</div>` },
          },
          {
            title: 'Chronic Conditions',
            text: { status: 'generated', div: `<div>${conditions}</div>` },
          },
          {
            title: 'Triage History',
            text: { status: 'generated', div: `<div>${triageCount} triage(s). Latest: ${lastTriage ? lastTriage.triage_level + ' (confidence ' + lastTriage.confidence + '%)' : 'None'}. Trend: ${trend}.</div>` },
          },
          lastTriage ? {
            title: 'Current Presentation',
            text: { status: 'generated', div: `<div>Symptoms: ${lastTriage.symptoms || lastTriage.original_message || 'Not recorded'}. Discriminator: ${lastTriage.rule_override || lastTriage.discriminator_matched || 'AI classification'}. Pathway: ${lastTriage.pathway || 'Unknown'}.</div>` },
          } : null,
          (outcomeRes.data || []).length > 0 ? {
            title: 'Follow-up History',
            text: { status: 'generated', div: `<div>${(outcomeRes.data || []).map(o => `${o.symptom_outcome || '?'} — ${o.visited_clinic === 'clinic' ? 'visited clinic' : o.visited_clinic === 'no' ? 'did not visit' : o.visited_clinic || '?'}${o.access_failure ? ' (' + o.access_failure + ')' : ''}`).join('; ')}</div>` },
          } : null,
        ].filter(Boolean),
      };
      resources.unshift(narrative);

      res.json(toBundle('document', resources, resources.length));
    } catch (e) {
      logger.error('[FHIR] Patient summary error:', e.message);
      res.status(500).json({ resourceType: 'OperationOutcome', issue: [{ severity: 'error', code: 'exception', diagnostics: 'Server error' }] });
    }
  });

  // ── GET /api/fhir/Organization ────────────────────────────
  app.get('/api/fhir/Organization', requireDashboardAuth, async (req, res) => {
    try {
      const { data, error } = await supabase.from('facilities').select('*').eq('active', true);
      if (error) throw error;
      const orgs = (data || []).map(toFhirOrganization);
      res.json(toBundle('searchset', orgs));
    } catch (e) {
      logger.error('[FHIR] Organization search error:', e.message);
      res.status(500).json({ resourceType: 'OperationOutcome', issue: [{ severity: 'error', code: 'exception', diagnostics: 'Server error' }] });
    }
  });

  // ── GET /api/fhir/Organization/:id ────────────────────────
  app.get('/api/fhir/Organization/:id', requireDashboardAuth, async (req, res) => {
    try {
      const facId = req.params.id.replace('facility-', '');
      const { data, error } = await supabase
        .from('facilities')
        .select('*')
        .eq('id', facId)
        .single();

      if (error || !data) {
        return res.status(404).json({ resourceType: 'OperationOutcome', issue: [{ severity: 'error', code: 'not-found' }] });
      }
      res.json(toFhirOrganization(data));
    } catch (e) {
      logger.error('[FHIR] Organization read error:', e.message);
      res.status(500).json({ resourceType: 'OperationOutcome', issue: [{ severity: 'error', code: 'exception', diagnostics: 'Server error' }] });
    }
  });

  // ══════════════════════════════════════════════════════════════
  // PATIENT HEALTH PASSPORT — portable, shareable health summary
  // ══════════════════════════════════════════════════════════════
  // Patient opens a URL on their phone → readable health summary.
  // No login, no app — just a link. Secured by 24h token.
  // Patient can show this to any private doctor or pharmacist.

  const crypto = require('crypto');

  // Generate a passport token
  app.post('/api/fhir/passport/generate', requireDashboardAuth, async (req, res) => {
    try {
      const { patient_id } = req.body;
      if (!patient_id) return res.status(400).json({ error: 'patient_id required' });

      const token = crypto.randomBytes(24).toString('hex');
      const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000);

      await supabase.from('passport_tokens').upsert({
        patient_id,
        token,
        expires_at: expiresAt.toISOString(),
        created_at: new Date().toISOString(),
      }, { onConflict: 'patient_id' });

      const baseUrl = process.env.BASE_URL || 'https://bizusizo.up.railway.app';
      res.json({ success: true, url: `${baseUrl}/passport/${token}`, expires_at: expiresAt.toISOString() });
    } catch (e) {
      logger.error('[PASSPORT] Generate error:', e.message);
      res.status(500).json({ error: 'Server error' });
    }
  });

  // Passport feedback (public — no auth, validated by token)
  app.post('/api/fhir/passport/feedback', async (req, res) => {
    try {
      const { token, rating, comment } = req.body;
      if (!token || !rating) return res.status(400).json({ error: 'token and rating required' });
      if (!['yes', 'no'].includes(rating)) return res.status(400).json({ error: 'rating must be yes or no' });

      // Validate token exists (don't require it to be unexpired — feedback may come after viewing)
      const { data: tok } = await supabase
        .from('passport_tokens').select('patient_id')
        .eq('token', token).single();

      await supabase.from('passport_feedback').insert({
        patient_id: tok?.patient_id || null,
        token,
        rating,
        comment: (comment || '').slice(0, 500),
        ip_address: req.headers['x-forwarded-for'] || req.socket.remoteAddress || 'unknown',
        created_at: new Date().toISOString(),
      });

      res.json({ success: true });
    } catch (e) {
      logger.error('[PASSPORT] Feedback error:', e.message);
      res.status(500).json({ error: 'Server error' });
    }
  });

  // Render the passport (public — secured by token, not login)
  app.get('/passport/:token', async (req, res) => {
    try {
      const { data: tok } = await supabase
        .from('passport_tokens').select('*')
        .eq('token', req.params.token)
        .gt('expires_at', new Date().toISOString()).single();

      // Viewer type comes from query param: ?viewer=patient or ?viewer=doctor
      // If no param, show a splash screen asking who is viewing
      const viewerType = req.query.viewer;

      if (tok && !viewerType) {
        // Show viewer selection splash — no health data shown yet
        const exp = new Date(tok.expires_at).toLocaleString('en-ZA');
        return res.setHeader('Content-Type', 'text/html').send(`<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>BIZUSIZO Health Passport</title><style>*{margin:0;padding:0;box-sizing:border-box}body{font-family:-apple-system,sans-serif;background:#0a0e17;color:#e2e8f0;display:flex;align-items:center;justify-content:center;min-height:100vh;padding:20px}</style></head><body>
<div style="text-align:center;max-width:400px">
<div style="font-size:22px;font-weight:700;color:#3b82f6;margin-bottom:8px">BIZUSIZO Health Passport</div>
<div style="font-size:13px;color:#94a3b8;margin-bottom:24px">Who is viewing this health summary?</div>
<a href="?viewer=patient" style="display:block;padding:16px;margin-bottom:12px;border-radius:8px;border:1px solid rgba(34,197,94,.3);background:rgba(34,197,94,.08);color:#22c55e;font-size:15px;font-weight:600;text-decoration:none">👤 I am the patient</a>
<a href="?viewer=doctor" style="display:block;padding:16px;margin-bottom:12px;border-radius:8px;border:1px solid rgba(59,130,246,.3);background:rgba(59,130,246,.08);color:#3b82f6;font-size:15px;font-weight:600;text-decoration:none">🩺 I am a healthcare provider</a>
<a href="?viewer=pharmacist" style="display:block;padding:16px;margin-bottom:12px;border-radius:8px;border:1px solid rgba(139,92,246,.3);background:rgba(139,92,246,.08);color:#8b5cf6;font-size:15px;font-weight:600;text-decoration:none">💊 I am a pharmacist</a>
<div style="font-size:10px;color:#475569;margin-top:16px">Expires: ${exp}</div>
</div></body></html>`);
      }

      if (tok) {
        // Log view with viewer type
        await supabase.from('passport_views').insert({
          patient_id: tok.patient_id,
          token: req.params.token,
          viewed_at: new Date().toISOString(),
          viewer_type: viewerType || 'unknown',
          ip_address: req.headers['x-forwarded-for'] || req.socket.remoteAddress || 'unknown',
          user_agent: (req.headers['user-agent'] || '').slice(0, 200),
        }).catch(e => logger.error('[PASSPORT] View log failed:', e.message));
      }

      if (!tok) {
        return res.status(403).send('<!DOCTYPE html><html><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>BIZUSIZO</title></head><body style="font-family:sans-serif;background:#0a0e17;color:#e2e8f0;display:flex;align-items:center;justify-content:center;min-height:100vh;margin:0"><div style="text-align:center;padding:20px"><h2>Link Expired</h2><p style="color:#94a3b8">This health passport link has expired or is invalid.</p><p style="color:#64748b;font-size:13px">Type <b>passport</b> on WhatsApp for a new link.</p></div></body></html>');
      }

      const pid = tok.patient_id;
      const [sesRes, triRes, outRes, labRes, rxRes] = await Promise.all([
        supabase.from('sessions').select('*').eq('patient_id', pid).single(),
        supabase.from('triage_logs').select('*').eq('patient_id', pid).order('created_at', { ascending: false }).limit(20),
        supabase.from('follow_up_outcomes').select('*').eq('patient_id', pid).order('response_received_at', { ascending: false }).limit(10),
        supabase.from('lab_results').select('*').eq('patient_id', pid).order('created_at', { ascending: false }).limit(10),
        supabase.from('prescriptions').select('*').eq('patient_id', pid).eq('status', 'active').order('prescribed_at', { ascending: false }).limit(10),
      ]);

      const s = sesRes.data?.data || {};
      const triages = triRes.data || [];
      const outcomes = outRes.data || [];
      const labs = labRes.data || [];
      const rxs = rxRes.data || [];

      const name = [s.firstName, s.surname].filter(Boolean).join(' ') || 'Patient';
      const dob = s.dob?.display || s.dob?.raw || '';
      const age = s.dob?.age || s.patientAge || '';
      const sex = s.sex || '';
      const conditions = (s.chronicConditions || []).map(c => c.label_en || c).join(', ') || 'None known';
      const code = s.studyCode || '';
      const tc = { RED: '#ef4444', ORANGE: '#f97316', YELLOW: '#eab308', GREEN: '#22c55e' };

      const triageHtml = triages.map(t => {
        const c = tc[t.triage_level] || '#64748b';
        const d = new Date(t.created_at).toLocaleDateString('en-ZA', { day:'numeric', month:'short', year:'numeric' });
        const tm = new Date(t.created_at).toLocaleTimeString('en-ZA', { hour:'2-digit', minute:'2-digit' });
        return `<div style="display:flex;align-items:center;gap:8px;padding:8px;border-left:3px solid ${c};margin-bottom:6px;background:rgba(255,255,255,.03);border-radius:0 6px 6px 0"><span style="color:${c};font-weight:700;min-width:55px">${t.triage_level}</span><span style="color:#64748b;min-width:80px;font-size:12px">${d} ${tm}</span><span style="color:#94a3b8;font-size:12px">${(t.symptoms||'').slice(0,120)}${t.facility_name?' — '+t.facility_name:''}</span></div>`;
      }).join('') || '<div style="color:#475569">No triage history</div>';

      const outcomeHtml = outcomes.map(o => {
        const i = o.symptom_outcome==='better'?'💚':o.symptom_outcome==='worse'?'🔴':'🟡';
        const v = o.visited_clinic==='clinic'?'visited clinic':o.visited_clinic==='hospital'?'hospital':o.visited_clinic==='no'?'did not visit':'unknown';
        const f = o.access_failure?' ⚠️ '+o.access_failure:'';
        return `<div style="font-size:13px;color:#94a3b8;margin-bottom:4px">${i} ${o.symptom_outcome||'?'} — ${v}${f}</div>`;
      }).join('');

      const labHtml = labs.map(l => {
        const i = l.result_status==='ready'?'✅':l.result_status==='pending'?'⏳':'📋';
        const cc = l.result_category==='normal'?'#22c55e':l.result_category==='action_required'?'#f97316':'#94a3b8';
        const d = new Date(l.test_date||l.created_at).toLocaleDateString('en-ZA',{day:'numeric',month:'short'});
        return `<div style="font-size:13px;color:#94a3b8;margin-bottom:4px">${i} <b style="color:#e2e8f0">${l.test_type}</b> · ${d} · <span style="color:${cc}">${l.result_summary||l.result_status}</span>${l.facility?' · '+l.facility:''}</div>`;
      }).join('');

      const exp = new Date(tok.expires_at).toLocaleString('en-ZA');
      const latest = triages[0];

      res.setHeader('Content-Type', 'text/html');
      res.send(`<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>BIZUSIZO Health Passport</title><style>*{margin:0;padding:0;box-sizing:border-box}body{font-family:-apple-system,sans-serif;background:#0a0e17;color:#e2e8f0;padding:16px;max-width:600px;margin:0 auto}.card{background:#111827;border:1px solid #1e293b;border-radius:10px;padding:16px;margin-bottom:12px}.label{font-size:10px;color:#64748b;text-transform:uppercase;letter-spacing:.05em;margin-bottom:8px;font-weight:600}</style></head><body>
<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px"><span style="font-size:18px;font-weight:700;color:#3b82f6">BIZUSIZO Health Passport</span><span style="font-size:10px;color:#475569">Expires: ${exp}</span></div>
<div class="card"><div style="display:flex;justify-content:space-between;align-items:flex-start"><div><div style="font-size:20px;font-weight:700">${name}</div><div style="font-size:13px;color:#94a3b8;margin-top:4px">${dob}${age?' ('+age+'y)':''}${sex?' · '+sex.charAt(0).toUpperCase()+sex.slice(1):''}</div></div><div style="text-align:right"><div style="font-size:11px;color:#3b82f6;font-weight:600">${code}</div>${latest?'<div style="margin-top:4px;padding:3px 10px;border-radius:99px;font-size:12px;font-weight:700;color:'+(tc[latest.triage_level]||'#64748b')+';border:1px solid '+(tc[latest.triage_level]||'#64748b')+'33">'+latest.triage_level+'</div>':''}</div></div></div>
<div class="card"><div class="label">Chronic Conditions</div><div style="font-size:14px">${conditions}</div></div>
<div class="card"><div class="label">Triage History (${triages.length})</div>${triageHtml}</div>
${outcomeHtml?'<div class="card"><div class="label">Follow-up Outcomes</div>'+outcomeHtml+'</div>':''}
${labHtml?'<div class="card"><div class="label">Lab Results</div>'+labHtml+'</div>':''}
${rxs.length > 0 ? '<div class="card"><div class="label">Current Prescriptions</div>' + rxs.map(r => '<div style="font-size:13px;margin-bottom:6px;padding:6px 8px;background:rgba(236,72,153,.05);border-left:2px solid #ec4899;border-radius:0 4px 4px 0"><div style="color:#e2e8f0;font-weight:600">' + r.medication + '</div>' + (r.dosage ? '<div style="color:#94a3b8">' + r.dosage + (r.duration ? ' · ' + r.duration : '') + (r.quantity ? ' · Qty: ' + r.quantity : '') + '</div>' : '') + '<div style="color:#475569;font-size:11px">Prescribed by: ' + r.prescribed_by + (r.facility_name ? ' · ' + r.facility_name : '') + ' · ' + new Date(r.prescribed_at).toLocaleDateString('en-ZA', {day:'numeric',month:'short',year:'numeric'}) + '</div>' + (r.notes ? '<div style="color:#64748b;font-size:11px;font-style:italic">' + r.notes + '</div>' : '') + '</div>').join('') + '</div>' : ''}
<div style="margin-top:16px;padding:12px;background:rgba(59,130,246,.08);border:1px solid rgba(59,130,246,.2);border-radius:8px;font-size:11px;color:#3b82f6">This is a patient health summary generated by BIZUSIZO, an AI-assisted triage system used in SA public healthcare clinics. It is not a diagnosis. For clinical decisions, please conduct your own assessment.</div>
<div id="feedback-box" style="margin-top:16px;padding:14px;background:#111827;border:1px solid #1e293b;border-radius:8px">
<div style="font-size:12px;color:#94a3b8;margin-bottom:10px;text-align:center">Was this health summary useful to you?</div>
<div style="display:flex;gap:12px;justify-content:center;margin-bottom:10px">
<button onclick="sendFeedback('yes')" style="padding:10px 28px;border-radius:6px;border:1px solid rgba(34,197,94,.3);background:rgba(34,197,94,.1);color:#22c55e;font-size:14px;cursor:pointer">👍 Yes</button>
<button onclick="sendFeedback('no')" style="padding:10px 28px;border-radius:6px;border:1px solid rgba(239,68,68,.3);background:rgba(239,68,68,.1);color:#ef4444;font-size:14px;cursor:pointer">👎 No</button>
</div>
<div style="display:flex;gap:8px">
<input id="feedback-text" placeholder="What was missing or could be better? (optional)" style="flex:1;padding:8px 10px;border-radius:6px;border:1px solid #1e293b;background:#0a0e17;color:#e2e8f0;font-size:12px">
</div>
<div id="feedback-result" style="text-align:center;font-size:12px;margin-top:8px"></div>
</div>
<script>
async function sendFeedback(rating){
  var comment=document.getElementById('feedback-text').value.trim();
  try{
    await fetch('/api/fhir/passport/feedback',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({token:'${req.params.token}',rating:rating,comment:comment})});
    document.getElementById('feedback-box').innerHTML='<div style="text-align:center;color:#22c55e;padding:12px;font-size:13px">✅ Thank you for your feedback!</div>';
  }catch(e){
    document.getElementById('feedback-result').textContent='Failed to send — thank you for trying.';
  }
}
</script>
<div style="margin-top:8px;font-size:10px;color:#475569;text-align:center">BIZUSIZO · bizusizo.co.za · POPIA compliant</div>
</body></html>`);
    } catch (e) {
      logger.error('[PASSPORT] Render error:', e.message);
      res.status(500).send('Server error');
    }
  });

};
