'use strict';
// Clinic queue management, kiosk, and pre-arrival alert API routes.
// All routes scoped by facilityFilter based on logged-in user's role.
const crypto = require('crypto');
const path   = require('path');
const logger = require('../logger');
const { sendWhatsAppMessage } = require('../lib/whatsapp');
const { msg }                 = require('../lib/messages');
const { deterministicRedClassifier } = require('../governance');
const { detectClinicalPatterns, generateHealthEducation } = require('../lib/triage');

// Wrapper for patient lookup — uses triage.js pattern detection
function detectPatterns(triages, outcomes) {
  try { return detectClinicalPatterns(triages, outcomes); }
  catch (e) { return []; }
}

module.exports = function registerQueueRoutes(app, {
  supabase,
  requireDashboardAuth,
  facilityFilter,
  logAudit,
  logTriage,
  getSession,
  saveSession,
  scheduleFollowUp,
  queueEvent,
  sendPreArrivalAlert,
  refreshPreArrivalAlert,
  triageToQueueType,
}) {

// ================================================================
// CLINICAL DASHBOARD — API ENDPOINTS
// ================================================================

// /api/clinical/* routes moved to routes/clinical.js

// /api/governance/* routes moved to routes/governance.js

// ── GET /api/clinic/print-queue ──────────────────────────────────
// Returns a printable HTML page of today's expected patients.
// Load-shedding safety net — open in browser, print (Ctrl+P).
// Sorted: RED first, then ORANGE, YELLOW, GREEN.
// Usage: window.open('/api/clinic/print-queue') from clinic.html
app.get('/api/clinic/print-queue', requireDashboardAuth, async (req, res) => {
  try {
    const todayStart = new Date(); todayStart.setHours(0,0,0,0);
    let q = supabase
      .from('triage_logs')
      .select('*')
      .gte('created_at', todayStart.toISOString())
      .not('facility_name', 'is', null)
      .order('created_at', { ascending: true });
    q = facilityFilter(req, q, 'facility_name');
    const { data: triages } = await q;

    const levelOrder = { RED: 0, ORANGE: 1, YELLOW: 2, GREEN: 3 };
    const colourMap  = { RED: '#dc2626', ORANGE: '#ea580c', YELLOW: '#ca8a04', GREEN: '#16a34a' };
    const bgMap      = { RED: '#fef2f2', ORANGE: '#fff7ed', YELLOW: '#fefce8', GREEN: '#f0fdf4' };

    // Deduplicate by patient_id, keeping latest triage
    const seen = new Set(); const rows = [];
    for (const t of (triages || [])) {
      if (seen.has(t.patient_id)) continue;
      seen.add(t.patient_id);
      const { data: sd } = await supabase.from('sessions').select('data').eq('patient_id', t.patient_id).single();
      const s = sd?.data || {};
      const { data: sc } = await supabase.from('study_codes').select('study_code').eq('patient_id', t.patient_id).limit(1);
      rows.push({
        triage_level: t.triage_level,
        name: [s.firstName, s.surname].filter(Boolean).join(' ') || '—',
        dob: s.dob?.dob_string || '—',
        study_code: sc?.[0]?.study_code || s.studyCode || '—',
        symptoms: (t.symptoms || '').slice(0, 120),
        triage_time: new Date(t.created_at).toLocaleTimeString('en-ZA', { hour:'2-digit', minute:'2-digit' }),
        chronic: (s.chronicConditions || []).map(c => c.label_en || c.key).join(', ') || '—',
        file_hint: s.surname ? (s.surname[0] <= 'F' ? 'A–F' : s.surname[0] <= 'M' ? 'G–M' : 'N–Z') : '—',
        is_new: s.fileStatus === 'new',
      });
    }
    rows.sort((a,b) => (levelOrder[a.triage_level]??9) - (levelOrder[b.triage_level]??9));

    const facilityName = req.user?.facility_name || 'All Facilities';
    const today = todayStart.toLocaleDateString('en-ZA', { weekday:'long', year:'numeric', month:'long', day:'numeric' });
    const printedAt = new Date().toLocaleTimeString('en-ZA', { hour:'2-digit', minute:'2-digit' });

    // Fetch clinical governance lead for the print footer
    let govLead = null;
    if (req.user?.facility_name) {
      const { data: fac } = await supabase.from('facilities')
        .select('clinical_governance_lead, clinical_governance_lead_title')
        .eq('name', req.user.facility_name).single();
      if (fac?.clinical_governance_lead) {
        govLead = fac.clinical_governance_lead + (fac.clinical_governance_lead_title ? ' (' + fac.clinical_governance_lead_title + ')' : '');
      }
    }

    const tableRows = rows.map((p, i) => `
      <tr style="background:${bgMap[p.triage_level]||'#fff'}">
        <td style="font-weight:bold;color:${colourMap[p.triage_level]||'#333'};white-space:nowrap">${p.triage_level}</td>
        <td style="font-weight:bold">${p.name}${p.is_new ? ' <span style="background:#dbeafe;color:#1d4ed8;font-size:10px;padding:1px 5px;border-radius:3px;font-weight:normal">NEW</span>' : ''}</td>
        <td style="font-family:monospace;font-size:12px">${p.study_code}</td>
        <td>${p.dob}</td>
        <td style="font-size:11px;color:#555">${p.symptoms}</td>
        <td style="font-size:11px">${p.chronic}</td>
        <td style="font-size:11px;color:#555">${p.file_hint}</td>
        <td style="font-size:11px;color:#888">${p.triage_time}</td>
      </tr>`).join('');

    const html = `<!DOCTYPE html><html><head><meta charset="utf-8">
    <title>BIZUSIZO Expected Patients — ${today}</title>
    <style>
      body { font-family: Arial, sans-serif; font-size: 13px; margin: 16px; color: #111; }
      h1 { font-size: 16px; margin: 0 0 2px 0; }
      .sub { color: #555; font-size: 12px; margin-bottom: 12px; }
      table { width: 100%; border-collapse: collapse; }
      th { background: #1e293b; color: #fff; padding: 6px 8px; text-align: left; font-size: 12px; }
      td { padding: 5px 8px; border-bottom: 1px solid #e2e8f0; vertical-align: top; }
      .footer { margin-top: 12px; font-size: 10px; color: #888; border-top: 1px solid #e2e8f0; padding-top: 6px; }
      @media print { body { margin: 8px; } button { display: none; } }
    </style>
    </head><body>
    <div style="display:flex;justify-content:space-between;align-items:flex-start">
      <div>
        <h1>BIZUSIZO — Expected Patients</h1>
        <div class="sub">${facilityName} &nbsp;·&nbsp; ${today} &nbsp;·&nbsp; Printed ${printedAt} &nbsp;·&nbsp; ${rows.length} patient${rows.length!==1?'s':''}</div>
      </div>
      <button onclick="window.print()" style="padding:6px 14px;background:#0f766e;color:#fff;border:none;border-radius:4px;cursor:pointer;font-size:12px">🖨️ Print</button>
    </div>
    <table>
      <thead><tr>
        <th>Triage</th><th>Name</th><th>BZ Code</th><th>DOB</th>
        <th>Symptoms</th><th>Chronic</th><th>File shelf</th><th>Time</th>
      </tr></thead>
      <tbody>${tableRows || '<tr><td colspan="8" style="text-align:center;color:#888;padding:20px">No expected patients yet today</td></tr>'}</tbody>
    </table>
    <div class="footer">
      Sorted by triage priority (RED first). For clinical emergencies call 10177.
      This printout is for internal clinic use only — handle as confidential patient information.
      ${govLead ? '<br>Clinical Governance Lead: <strong>' + govLead + '</strong>' : '<br><span style="color:#dc2626">⚠ Clinical Governance Lead: NOT SET — required for governance compliance</span>'}
    </div>
    <script>window.onload = function(){ if(${rows.length > 0}) window.print(); }</script>
    </body></html>`;

    res.setHeader('Content-Type', 'text/html');
    res.send(html);
  } catch (e) { res.status(500).json({ error: 'Server error' }); }
});

// ================================================================
// CLINIC QUEUE MANAGEMENT SYSTEM
// ================================================================
// Supabase table required: clinic_queue
// See clinic-queue-migration.sql for schema
// ================================================================

// GET /api/clinic/expected — Today's expected patients for file preparation
// Admin opens this at 07:00 to pre-pull files
app.get('/api/clinic/expected', requireDashboardAuth, async (req, res) => {
  try {
    const facility = req.query.facility;
    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);

    let query = supabase
      .from('triage_logs')
      .select('*')
      .gte('created_at', todayStart.toISOString())
      .not('facility_name', 'is', null)
      .order('created_at', { ascending: true });

    // Facility filtering: scope by role
    if (req.user && req.user.role === 'district') {
      if (req.user.district_facilities && req.user.district_facilities.length > 0) {
        query = query.in('facility_name', req.user.district_facilities);
      }
    } else if (req.user && req.user.facility_name && req.user.role !== 'admin') {
      query = query.eq('facility_name', req.user.facility_name);
    } else if (facility) {
      query = query.eq('facility_name', facility);
    }

    const { data: triages, error } = await query;
    if (error) throw error;

    const expectedPatients = [];
    const seenPatients = new Set();

    for (const t of (triages || [])) {
      if (seenPatients.has(t.patient_id)) continue;
      seenPatients.add(t.patient_id);

      const { data: sessionData } = await supabase
        .from('sessions')
        .select('data')
        .eq('patient_id', t.patient_id)
        .single();

      const s = sessionData?.data || {};

      const { data: studyCodeData } = await supabase
        .from('study_codes')
        .select('study_code')
        .eq('patient_id', t.patient_id)
        .limit(1);

      // Generate file hints for admin
      const fileHints = [];
      if (s.surname) {
        const initial = s.surname.charAt(0).toUpperCase();
        if (initial <= 'F') fileHints.push('Check A–F shelf');
        else if (initial <= 'M') fileHints.push('Check G–M shelf');
        else fileHints.push('Check N–Z shelf');
      }
      if ((s.chronicConditions || []).length > 0) {
        fileHints.push('Check chronic files section');
      }
      if (s.fileStatus === 'new') {
        fileHints.push('NEW PATIENT — create folder');
      }

      expectedPatients.push({
        patient_id: t.patient_id,
        first_name: s.firstName || null,
        surname: s.surname || null,
        dob: s.dob?.dob_string || null,
        age: s.dob?.age || s.patientAge || null,
        sex: s.sex || null,
        triage_level: t.triage_level,
        triage_confidence: t.confidence,
        symptoms_summary: t.symptoms ? t.symptoms.slice(0, 200) : null,
        facility_name: t.facility_name,
        triage_time: t.created_at,
        study_code: studyCodeData?.[0]?.study_code || s.studyCode || null,
        chronic_conditions: (s.chronicConditions || []).map(c => c.label_en || c.key),
        is_returning: s.isReturningPatient,
        file_status: s.fileStatus || 'unknown',
        file_hints: fileHints,
        language: s.language || 'en',
      });
    }

    res.json({
      date: todayStart.toISOString().split('T')[0],
      facility: facility || 'all',
      count: expectedPatients.length,
      patients: expectedPatients,
    });
  } catch (e) {
    res.status(500).json({ error: 'Server error' });
  }
});

// ── registerPreArrivalRoutes ─────────────────────────────────────
// Dashboard endpoints for incoming patient pre-arrival alerts.
// GET  /api/clinic/pre-arrival         — list active alerts
// PATCH /api/clinic/pre-arrival/:id/resolve — mark patient arrived
function registerPreArrivalRoutes(app, requireDashboardAuth, supabase, facilityFilter) {
  app.get('/api/clinic/pre-arrival', requireDashboardAuth, async (req, res) => {
    try {
      const showResolved = req.query.resolved === 'true';
      let query = supabase
        .from('pre_arrival_alerts')
        .select('*')
        .order('estimated_arrival_at', { ascending: true })
        .limit(50);
      if (!showResolved) query = query.eq('resolved', false);
      query = facilityFilter(req, query, 'facility_name');
      const { data: alerts, error } = await query;
      if (error) throw error;
      const urgent   = (alerts || []).filter(a => a.priority === 'URGENT');
      const soon     = (alerts || []).filter(a => a.priority === 'SOON');
      const routine  = (alerts || []).filter(a => a.priority === 'ROUTINE');
      const newPatients = (alerts || []).filter(a => a.is_new_patient).length;
      res.json({ urgent, soon, routine, new_patients: newPatients });
    } catch (e) { res.status(500).json({ error: 'Server error' }); }
  });

  app.patch('/api/clinic/pre-arrival/:id/resolve', requireDashboardAuth, async (req, res) => {
    try {
      const { data, error } = await supabase
        .from('pre_arrival_alerts')
        .update({ resolved: true, resolved_at: new Date().toISOString() })
        .eq('id', req.params.id).select().single();
      if (error) throw error;
      res.json({ success: true, alert: data });
    } catch (e) { res.status(500).json({ error: 'Server error' }); }
  });

  // PATCH /api/clinic/pre-arrival/:id/verify-identity
  // Called by reception when patient arrives and shows ID/clinic card.
  // Updates pre_arrival_alerts, clinic_queue, and triage_logs for this patient.
  app.patch('/api/clinic/pre-arrival/:id/verify-identity', requireDashboardAuth, async (req, res) => {
    try {
      const verifiedAt = new Date().toISOString();
      const verifiedBy = req.user ? req.user.display_name : 'reception';

      // 1. Get the alert to find patient_id
      const { data: alert, error: fetchErr } = await supabase
        .from('pre_arrival_alerts')
        .select('patient_id, patient_name')
        .eq('id', req.params.id)
        .single();
      if (fetchErr || !alert) return res.status(404).json({ error: 'Alert not found' });

      // 2. Mark pre_arrival_alert as identity verified
      await supabase.from('pre_arrival_alerts')
        .update({ identity_verified: true, identity_verified_at: verifiedAt, identity_verified_by: verifiedBy })
        .eq('id', req.params.id);

      // 3. Mark clinic_queue entry as identity verified
      await supabase.from('clinic_queue')
        .update({ identity_verified: true })
        .eq('patient_id', alert.patient_id)
        .eq('status', 'waiting');

      // 4. Mark triage_logs as identity verified (today's entries for this patient)
      const todayStart = new Date(); todayStart.setHours(0,0,0,0);
      await supabase.from('triage_logs')
        .update({ identity_verified: true })
        .eq('patient_id', alert.patient_id)
        .gte('created_at', todayStart.toISOString());

      // 5. Audit log
      await logAudit(req, 'IDENTITY_VERIFIED', req.params.id, {
        patient_id: alert.patient_id,
        patient_name: alert.patient_name,
        verified_by: verifiedBy,
      });

      logger.info(`[IDENTITY] Verified by ${verifiedBy} for patient ${alert.patient_id}`);
      res.json({ success: true, verified_by: verifiedBy, verified_at: verifiedAt });
    } catch (e) {
      logger.error('[IDENTITY] Verify error:', e.message);
      res.status(500).json({ error: 'Server error' });
    }
  });
}

// GET /api/clinic/queue — Get current queue (or filter by status)
// ── Pre-arrival alert routes (fires when patient completes triage) ──
registerPreArrivalRoutes(app, requireDashboardAuth, supabase, facilityFilter);

// PATCH /api/clinic/queue/verify-identity — verify by patient_id (fallback for walk-ins / no pre-arrival alert)
app.patch('/api/clinic/queue/verify-identity', requireDashboardAuth, async (req, res) => {
  try {
    const { patient_id } = req.body;
    if (!patient_id) return res.status(400).json({ error: 'patient_id required' });
    const verifiedBy = req.user ? req.user.display_name : 'reception';
    const todayStart = new Date(); todayStart.setHours(0,0,0,0);

    await supabase.from('clinic_queue')
      .update({ identity_verified: true })
      .eq('patient_id', patient_id).eq('status', 'waiting');

    await supabase.from('triage_logs')
      .update({ identity_verified: true })
      .eq('patient_id', patient_id)
      .gte('created_at', todayStart.toISOString());

    await logAudit(req, 'IDENTITY_VERIFIED', null, { patient_id, verified_by: verifiedBy });
    res.json({ success: true });
  } catch (e) { res.status(500).json({ error: 'Server error' }); }
});

app.get('/api/clinic/queue', requireDashboardAuth, async (req, res) => {
  try {
    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);

    let query = supabase
      .from('clinic_queue')
      .select('*')
      .gte('checked_in_at', todayStart.toISOString());

    // Facility filtering
    query = facilityFilter(req, query);

    // Filter by status (default: waiting + in_consultation + paused)
    if (req.query.status) {
      query = query.eq('status', req.query.status);
    } else {
      query = query.in('status', ['waiting', 'in_consultation', 'paused']);
    }

    query = query.order('queue_type', { ascending: true })
      .order('position', { ascending: true });

    if (req.query.queue_type) {
      query = query.eq('queue_type', req.query.queue_type);
    }

    const { data, error } = await query;
    if (error) throw error;
    res.json({ queue: data || [] });
  } catch (e) {
    res.status(500).json({ error: 'Server error' });
  }
});

// GET /api/clinic/queue/stats — Live queue statistics
app.get('/api/clinic/queue/stats', requireDashboardAuth, async (req, res) => {
  try {
    let activeQuery = supabase
      .from('clinic_queue')
      .select('queue_type, status, triage_level, checked_in_at, facility_name')
      .in('status', ['waiting', 'in_consultation']);
    activeQuery = facilityFilter(req, activeQuery);
    const { data: active, error } = await activeQuery;

    if (error) throw error;

    const waiting = (active || []).filter(p => p.status === 'waiting');
    const inConsult = (active || []).filter(p => p.status === 'in_consultation');

    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);

    let completedQuery = supabase
      .from('clinic_queue')
      .select('checked_in_at, called_at, queue_type, facility_name')
      .eq('status', 'completed')
      .gte('checked_in_at', todayStart.toISOString())
      .not('called_at', 'is', null);
    completedQuery = facilityFilter(req, completedQuery);
    const { data: completed } = await completedQuery;

    const avgWaitByQueue = {};
    if (completed && completed.length > 0) {
      const grouped = {};
      completed.forEach(p => {
        const qt = p.queue_type || 'walk_in';
        if (!grouped[qt]) grouped[qt] = [];
        const waitMs = new Date(p.called_at) - new Date(p.checked_in_at);
        if (waitMs > 0) grouped[qt].push(waitMs);
      });
      Object.entries(grouped).forEach(([qt, waits]) => {
        avgWaitByQueue[qt] = Math.round(waits.reduce((a, b) => a + b, 0) / waits.length / 60000);
      });
    }

    const stats = {
      fast_track: { waiting: 0, in_consultation: 0 },
      routine: { waiting: 0, in_consultation: 0 },
      walk_in: { waiting: 0, in_consultation: 0 },
      total_waiting: waiting.length,
      total_in_consultation: inConsult.length,
      avg_wait_minutes: avgWaitByQueue,
    };

    waiting.forEach(p => {
      const qt = p.queue_type || 'walk_in';
      if (stats[qt]) stats[qt].waiting++;
    });

    inConsult.forEach(p => {
      const qt = p.queue_type || 'walk_in';
      if (stats[qt]) stats[qt].in_consultation++;
    });

    let todayQuery = supabase
      .from('clinic_queue')
      .select('status, facility_name')
      .gte('checked_in_at', todayStart.toISOString());
    todayQuery = facilityFilter(req, todayQuery);
    const { data: todayAll } = await todayQuery;

    stats.today_total = todayAll ? todayAll.length : 0;
    stats.today_completed = todayAll ? todayAll.filter(p => p.status === 'completed').length : 0;
    stats.today_no_show = todayAll ? todayAll.filter(p => p.status === 'no_show').length : 0;

    res.json(stats);
  } catch (e) {
    res.status(500).json({ error: 'Server error' });
  }
});

// GET /api/clinic/lookup — Lookup patient by phone number or study code
app.get('/api/clinic/lookup', requireDashboardAuth, async (req, res) => {
  try {
    const { phone, study_code } = req.query;

    if (!phone && !study_code) {
      return res.status(400).json({ error: 'Provide phone or study_code' });
    }

    let patientId;
    let studyCodeData = null;

    if (study_code) {
      const { data } = await supabase
        .from('study_codes')
        .select('*')
        .eq('study_code', study_code.toUpperCase().trim())
        .limit(1);
      if (data && data.length > 0) {
        patientId = data[0].patient_id;
        studyCodeData = data[0];
      }
    } else if (phone) {
      patientId = crypto.createHash('sha256').update(phone).digest('hex').slice(0, 16);
    }

    if (!patientId) {
      return res.json({ found: false });
    }

    const { data: triages } = await supabase
      .from('triage_logs')
      .select('*')
      .eq('patient_id', patientId)
      .order('created_at', { ascending: false })
      .limit(5);

    const { data: sessionData } = await supabase
      .from('sessions')
      .select('data')
      .eq('patient_id', patientId)
      .single();

    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);
    const [queueRes, outcomeRes, feedbackRes, labRes, rxRes] = await Promise.all([
      supabase.from('clinic_queue').select('*')
        .eq('patient_id', patientId)
        .gte('checked_in_at', todayStart.toISOString())
        .in('status', ['waiting', 'in_consultation']).limit(1),
      supabase.from('follow_up_outcomes').select('*')
        .eq('patient_id', patientId)
        .order('response_received_at', { ascending: false }).limit(5),
      supabase.from('triage_feedback').select('*')
        .eq('patient_id', patientId)
        .order('created_at', { ascending: false }).limit(5),
      supabase.from('lab_results').select('*')
        .eq('patient_id', patientId)
        .order('created_at', { ascending: false }).limit(10),
      supabase.from('prescriptions').select('*')
        .eq('patient_id', patientId)
        .order('prescribed_at', { ascending: false }).limit(10),
    ]);

    const queueEntry = queueRes.data;
    const session = sessionData?.data || {};

    // Build triage trend (e.g. GREEN → YELLOW → ORANGE)
    const triageList = triages || [];
    const trend = triageList.length >= 2
      ? triageList.slice().reverse().map(t => t.triage_level).join(' → ')
      : triageList.length === 1 ? triageList[0].triage_level : null;

    // Count visits from follow-up outcomes
    const outcomes = outcomeRes.data || [];
    const visitedCount = outcomes.filter(o => o.visited_clinic === 'clinic' || o.visited_clinic === 'hospital').length;
    const accessFailures = outcomes.filter(o => o.access_failure).map(o => o.access_failure);

    res.json({
      found: true,
      patient_id: patientId,
      first_name: session.firstName || null,
      surname: session.surname || null,
      dob: session.dob?.dob_string || null,
      age: session.dob?.age || session.patientAge || null,
      sex: session.sex || null,
      study_code: studyCodeData?.study_code || session.studyCode || null,
      language: session.language || 'en',
      triage_history: triageList,
      latest_triage: triageList.length > 0 ? triageList[0] : null,
      triage_trend: trend,
      triage_count: triageList.length,
      chronic_conditions: session.ccmddConditions || session.chronicConditions || [],
      is_returning: session.isReturningPatient,
      file_status: session.fileStatus || 'unknown',
      already_in_queue: queueEntry && queueEntry.length > 0 ? queueEntry[0] : null,
      follow_up_outcomes: outcomes,
      follow_up_visited_count: visitedCount,
      follow_up_access_failures: accessFailures,
      nurse_feedback: feedbackRes.data || [],
      clinical_flags: detectPatterns(triageList, outcomes),
      passport_views: await (async () => {
        try {
          const { data } = await supabase.from('passport_views')
            .select('viewed_at, ip_address')
            .eq('patient_id', patientId)
            .order('viewed_at', { ascending: false }).limit(10);
          return data || [];
        } catch (e) { return []; }
      })(),
      lab_results: (labRes.data || []).map(r => ({
        id: r.id,
        test_type: r.test_type,
        test_date: r.test_date,
        result_status: r.result_status,
        result_summary: r.result_summary,
        result_category: r.result_category,
        facility: r.facility,
        patient_notified: r.patient_notified,
        created_at: r.created_at,
      })),
      prescriptions: (rxRes.data || []).map(r => ({
        id: r.id,
        medication: r.medication,
        dosage: r.dosage,
        duration: r.duration,
        quantity: r.quantity,
        prescribed_by: r.prescribed_by,
        facility_name: r.facility_name,
        notes: r.notes,
        status: r.status,
        prescribed_at: r.prescribed_at,
      })),
    });
  } catch (e) {
    res.status(500).json({ error: 'Server error' });
  }
});

// POST /api/clinic/unlink — Staff action: unlink a wrongly linked phone from a patient record
// Use case: patient typed the wrong BZ code and got linked to someone else's history.
// This reverses the link, gives the current phone a fresh session, and logs the action.
app.post('/api/clinic/unlink', requireDashboardAuth, async (req, res) => {
  try {
    const { patient_id, reason } = req.body;
    if (!patient_id) return res.status(400).json({ error: 'patient_id required' });

    // Find the base session that points to this patient_id via _activeSubId
    const { data: sessions } = await supabase
      .from('sessions')
      .select('patient_id, data')
      .like('patient_id', '%') // scan all
      .limit(500);

    let baseId = null;
    if (sessions) {
      for (const s of sessions) {
        const d = s.data || {};
        if (d._activeSubId === patient_id && d._isSharedPhone) {
          baseId = s.patient_id;
          break;
        }
      }
    }

    if (baseId) {
      // Clear the link — reset base session to point to itself
      await supabase.from('sessions').update({
        data: {},
        updated_at: new Date(),
      }).eq('patient_id', baseId);

      logger.info(`[UNLINK] Cleared link from base ${baseId} → ${patient_id} by ${req.user?.display_name || 'staff'}`);
    }

    // Audit trail
    await logAudit(req, 'UNLINK_PATIENT', patient_id, {
      unlinked_patient_id: patient_id,
      base_phone_id: baseId || 'not_found',
      reason: reason || 'Wrong BZ code used during phone linking',
      performed_by: req.user?.display_name || 'staff',
    });

    res.json({
      success: true,
      message: baseId
        ? 'Phone unlinked. Next message from that phone will start a fresh session.'
        : 'Patient record cleared. No active phone link was found to remove.',
    });
  } catch (e) {
    logger.error('[UNLINK] Error:', e.message);
    res.status(500).json({ error: 'Server error' });
  }
});

// POST /api/clinic/verify-identity — Staff enters patient's SA ID number
// The ID is hashed immediately — plaintext never stored (POPIA).
// Used to: (1) confirm patient identity, (2) detect duplicates across phones,
// (3) prepare for NHI integration.
app.post('/api/clinic/verify-identity', requireDashboardAuth, async (req, res) => {
  try {
    const { patient_id, id_number, alt_doc_type, alt_doc_number, alt_doc_country, notes } = req.body;
    if (!patient_id) return res.status(400).json({ error: 'patient_id required' });

    let idHash = null;
    let duplicateWarning = null;
    let docType = 'sa_id';

    if (id_number) {
      // SA ID path — validate 13-digit format
      const cleaned = id_number.replace(/\s/g, '');
      if (!/^\d{13}$/.test(cleaned)) {
        return res.status(400).json({ error: 'SA ID number must be 13 digits' });
      }

      // Hash immediately — plaintext never touches the database
      idHash = crypto.createHash('sha256').update(cleaned).digest('hex');

      // Check for duplicate — same ID linked to a different patient
      const { data: existing } = await supabase
        .from('patient_identities')
        .select('patient_id, verified_by, verified_at, facility_name')
        .eq('id_number_hash', idHash)
        .neq('patient_id', patient_id)
        .limit(1);

      if (existing && existing.length > 0) {
        duplicateWarning = {
          message: 'This ID number is already linked to another patient record.',
          existing_patient_id: existing[0].patient_id,
          verified_by: existing[0].verified_by,
          verified_at: existing[0].verified_at,
          facility: existing[0].facility_name,
        };
      }
    } else if (alt_doc_number) {
      // Alternative document path (passport, asylum permit, refugee ID, etc.)
      docType = alt_doc_type || 'other';
      // Hash the alt document number for deduplication (same as SA ID)
      const altKey = (docType + ':' + alt_doc_number + (alt_doc_country ? ':' + alt_doc_country : '')).toLowerCase();
      idHash = crypto.createHash('sha256').update(altKey).digest('hex');

      // Check for duplicate
      const { data: existing } = await supabase
        .from('patient_identities')
        .select('patient_id, verified_by, verified_at, facility_name')
        .eq('id_number_hash', idHash)
        .neq('patient_id', patient_id)
        .limit(1);

      if (existing && existing.length > 0) {
        duplicateWarning = {
          message: 'This document is already linked to another patient record.',
          existing_patient_id: existing[0].patient_id,
          verified_by: existing[0].verified_by,
          verified_at: existing[0].verified_at,
          facility: existing[0].facility_name,
        };
      }
    } else {
      // No document at all — still mark as verified (staff confirmed identity visually)
      docType = 'none';
    }

    // Upsert the identity record
    await supabase.from('patient_identities').upsert({
      patient_id,
      id_number_hash: idHash,
      id_verified: true,
      verified_by: req.user?.display_name || 'staff',
      verified_at: new Date().toISOString(),
      facility_name: req.user?.facility_name || null,
      notes: (docType !== 'sa_id' && docType !== 'none' ? `[${docType}${alt_doc_country ? ' / ' + alt_doc_country : ''}] ` : '') + (notes || ''),
      updated_at: new Date().toISOString(),
    }, { onConflict: 'patient_id' });

    // Also update the session to flag identity as staff-verified
    const session = await getSession(patient_id);
    if (session) {
      session.identity_verified = true;
      session.id_verified_by = req.user?.display_name || 'staff';
      session.id_verified_at = new Date().toISOString();
      await saveSession(patient_id, session);
    }

    // Audit trail
    await logAudit(req, 'VERIFY_IDENTITY', patient_id, {
      id_provided: !!id_number,
      has_duplicate: !!duplicateWarning,
      notes: notes || null,
    });

    res.json({
      success: true,
      id_verified: true,
      duplicate_warning: duplicateWarning,
    });
  } catch (e) {
    logger.error('[VERIFY_ID] Error:', e.message);
    res.status(500).json({ error: 'Server error' });
  }
});

// GET /api/clinic/check-id — Check if an ID number exists (for duplicate detection)
app.get('/api/clinic/check-id', requireDashboardAuth, async (req, res) => {
  try {
    const { id_number } = req.query;
    if (!id_number) return res.status(400).json({ error: 'id_number required' });

    const cleaned = id_number.replace(/\s/g, '');
    if (!/^\d{13}$/.test(cleaned)) return res.status(400).json({ error: 'Invalid SA ID format' });

    const idHash = crypto.createHash('sha256').update(cleaned).digest('hex');
    const { data } = await supabase
      .from('patient_identities')
      .select('patient_id, verified_by, verified_at, facility_name')
      .eq('id_number_hash', idHash)
      .limit(1);

    if (data && data.length > 0) {
      const match = data[0];
      const session = await getSession(match.patient_id);
      res.json({
        found: true,
        patient_id: match.patient_id,
        name: session?.firstName && session?.surname ? `${session.firstName} ${session.surname}` : null,
        study_code: session?.studyCode || null,
        verified_by: match.verified_by,
        facility: match.facility_name,
      });
    } else {
      res.json({ found: false });
    }
  } catch (e) {
    res.status(500).json({ error: 'Server error' });
  }
});

// POST /api/clinic/queue — Add patient to queue
app.post('/api/clinic/queue', requireDashboardAuth, async (req, res) => {
  try {
    const { patient_id, patient_phone, patient_name, triage_level,
            triage_confidence, symptoms_summary, queue_type, notes,
            study_code, added_by } = req.body;

    if (!patient_id || !queue_type) {
      return res.status(400).json({ error: 'patient_id and queue_type required' });
    }

    const { data: lastInQueue } = await supabase
      .from('clinic_queue')
      .select('position')
      .eq('queue_type', queue_type)
      .eq('status', 'waiting')
      .order('position', { ascending: false })
      .limit(1);

    const nextPosition = (lastInQueue && lastInQueue.length > 0)
      ? lastInQueue[0].position + 1
      : 1;

    const entry = {
      patient_id,
      patient_phone: patient_phone || null,
      patient_name: patient_name || null,
      triage_level: triage_level || 'UNKNOWN',
      triage_confidence: triage_confidence || null,
      symptoms_summary: symptoms_summary || null,
      queue_type,
      status: 'waiting',
      checked_in_at: new Date(),
      position: nextPosition,
      notes: notes || null,
      study_code: study_code || null,
      facility_name: req.user ? req.user.facility_name : null,
      created_at: new Date(),
    };

    const { data, error } = await supabase
      .from('clinic_queue')
      .insert(entry)
      .select()
      .single();

    if (error) throw error;
    await logAudit(req, 'REGISTER_WALKIN', data?.id, { patient_name, queue_type, triage_level });
    res.json({ success: true, queue_entry: data });
  } catch (e) {
    res.status(500).json({ error: 'Server error' });
  }
});

// POST /api/clinic/queue/ems — Register EMS/ambulance-delivered patient
// Post-stabilisation entry point: captures transport details for audit trail.
// Patient is added to appropriate queue based on triage level on arrival.
app.post('/api/clinic/queue/ems', requireDashboardAuth, async (req, res) => {
  try {
    const { patient_id, patient_phone, patient_name, triage_level,
            symptoms_summary, queue_type, ems_provider, ems_crew_id,
            added_by, notes } = req.body;

    if (!patient_id || !triage_level) {
      return res.status(400).json({ error: 'patient_id and triage_level required' });
    }

    // Get next position — RED gets position 1 (front), others get end
    const targetQueue = queue_type || 'emergency';
    let nextPosition = 1;
    if (triage_level !== 'RED') {
      const { data: lastInQueue } = await supabase
        .from('clinic_queue')
        .select('position')
        .eq('queue_type', targetQueue)
        .eq('status', 'waiting')
        .order('position', { ascending: false })
        .limit(1);
      nextPosition = (lastInQueue && lastInQueue.length > 0) ? lastInQueue[0].position + 1 : 1;
    }

    const entry = {
      patient_id,
      patient_phone: patient_phone || null,
      patient_name: patient_name || 'EMS Patient',
      triage_level,
      triage_confidence: null,
      symptoms_summary: symptoms_summary || 'EMS arrival',
      queue_type: targetQueue,
      status: 'waiting',
      checked_in_at: new Date(),
      position: nextPosition,
      notes: (notes || '') + ` | EMS: ${ems_provider || 'unknown'} crew:${ems_crew_id || 'n/a'}`,
      facility_name: req.user ? req.user.facility_name : null,
      created_at: new Date(),
      entry_method: 'ems',
    };

    const { data, error } = await supabase
      .from('clinic_queue')
      .insert(entry)
      .select()
      .single();

    if (error) throw error;

    // Log to triage_logs for tracking
    await supabase.from('triage_logs').insert({
      patient_id,
      triage_level,
      confidence: null,
      escalation: triage_level === 'RED',
      pathway: 'ems_arrival',
      facility_name: entry.facility_name,
      symptoms: symptoms_summary || 'EMS arrival',
      input_source: 'ems_handover',
    });

    // Governance audit
    await logAudit(req, 'EMS_ARRIVAL', data?.id, {
      patient_name, triage_level, ems_provider, ems_crew_id,
      registered_by: added_by || req.user?.display_name,
    });

    logger.info(`[EMS] Patient ${patient_id} registered via ${ems_provider || 'EMS'} as ${triage_level} at position ${nextPosition}`);
    res.json({ success: true, queue_entry: data });
  } catch (e) {
    logger.error('[EMS] Registration error:', e.message);
    res.status(500).json({ error: 'Server error' });
  }
});

// POST /api/clinic/queue/critical — ONE-TAP EMERGENCY (DoH Entry Screening)
// When someone walks in unconscious, bleeding, or in respiratory distress,
// reception taps this button. Creates an immediate RED queue entry at position 0
// (front of ALL queues) with no registration required.
// DoH: "If critical → skip queue → go directly to triage nurse"
app.post('/api/clinic/queue/critical', requireDashboardAuth, async (req, res) => {
  try {
    const { patient_name, description, nurse_name } = req.body;

    // Position 0 = front of queue (before everyone)
    const entry = {
      patient_id: 'critical_' + Date.now(),
      patient_name: patient_name || 'CRITICAL WALK-IN',
      triage_level: 'RED',
      triage_confidence: 100,
      symptoms_summary: description || 'CRITICAL — entered via emergency button at reception',
      queue_type: 'emergency',
      status: 'waiting',
      checked_in_at: new Date(),
      position: 0,
      notes: 'CRITICAL WALK-IN — bypass all queues. ' + (nurse_name ? 'Flagged by: ' + nurse_name : ''),
      facility_name: req.user ? req.user.facility_name : null,
      created_at: new Date(),
    };

    const { data, error } = await supabase
      .from('clinic_queue')
      .insert(entry)
      .select()
      .single();

    if (error) throw error;

    await logAudit(req, 'CRITICAL_WALKIN', data?.id, { patient_name, description });

    // Also log to triage_logs for expected patients tracking
    await supabase.from('triage_logs').insert({
      patient_id: entry.patient_id,
      triage_level: 'RED',
      confidence: 100,
      escalation: true,
      pathway: 'critical_walkin',
      facility_name: entry.facility_name,
      symptoms: entry.symptoms_summary,
    });

    res.json({ success: true, queue_entry: data, message: 'CRITICAL patient added at front of emergency queue' });
  } catch (e) {
    res.status(500).json({ error: 'Server error' });
  }
});

// PUT /api/clinic/queue/:id/call — Call patient (move to in_consultation)
app.put('/api/clinic/queue/:id/call', requireDashboardAuth, async (req, res) => {
  try {
    const { assigned_to, room } = req.body;

    // Get patient details before updating
    const { data: patient } = await supabase
      .from('clinic_queue')
      .select('patient_phone, patient_id')
      .eq('id', req.params.id)
      .single();

    const { error } = await supabase
      .from('clinic_queue')
      .update({
        status: 'in_consultation',
        called_at: new Date(),
        assigned_to: assigned_to || null,
      })
      .eq('id', req.params.id);

    if (error) throw error;

    // Send WhatsApp notification to patient (best-effort)
    let whatsappSent = false;
    if (patient && patient.patient_phone) {
      try {
        const session = await getSession(patient.patient_id);
        const lang = session.language || 'en';
        const displayName = room || assigned_to || null;
        const calledMsg = typeof MESSAGES.queue_called[lang] === 'function'
          ? MESSAGES.queue_called[lang](displayName)
          : MESSAGES.queue_called['en'](displayName);
        whatsappSent = await sendWhatsAppMessage(patient.patient_phone, calledMsg);
      } catch (e) {
        logger.error('[QUEUE_CALL] WhatsApp notification failed:', e.message);
      }
    }

    res.json({ success: true, whatsapp_sent: whatsappSent });
    await logAudit(req, 'CALL', req.params.id, { assigned_to, room });
  } catch (e) {
    res.status(500).json({ error: 'Server error' });
  }
});

// PUT /api/clinic/queue/:id/escalate — Escalate patient to hospital (referral)
// Creates a referral record, updates queue, sends referral to patient on WhatsApp
// If the hospital uses BIZUSIZO, they can look up the patient by referral_id or study_code
app.put('/api/clinic/queue/:id/escalate', requireDashboardAuth, async (req, res) => {
  try {
    const { transport_method, nurse_notes, destination_hospital, nurse_name, study_code } = req.body;

    // Get patient details
    const { data: patient } = await supabase
      .from('clinic_queue')
      .select('*')
      .eq('id', req.params.id)
      .single();

    if (!patient) return res.status(404).json({ error: 'Patient not found' });

    // Get session for full patient info
    const session = patient.patient_id ? await getSession(patient.patient_id) : {};

    // Generate referral ID
    const referralId = 'REF-' + Date.now().toString(36).toUpperCase() + '-' + Math.random().toString(36).slice(2, 6).toUpperCase();

    // Create referral record in triage_logs (reuse existing table for now)
    await supabase.from('triage_logs').insert({
      patient_id: patient.patient_id,
      triage_level: patient.triage_level || 'RED',
      confidence: 100,
      escalation: true,
      pathway: transport_method === 'ambulance' ? 'hospital_referral_ambulance' : 'hospital_referral_self_transport',
      facility_name: destination_hospital || 'Nearest hospital',
      symptoms: `REFERRAL ${referralId} | Nurse: ${nurse_name || 'unknown'} | Reason: ${nurse_notes || 'Clinical escalation'} | Transport: ${transport_method} | Original symptoms: ${patient.symptoms_summary || 'N/A'}`,
    });

    // Update queue status
    await supabase.from('clinic_queue').update({
      status: 'completed',
      completed_at: new Date(),
      notes: (patient.notes ? patient.notes + ' | ' : '') + `REFERRED TO HOSPITAL: ${referralId} by ${nurse_name || 'nurse'} via ${transport_method}. ${nurse_notes || ''}`,
    }).eq('id', req.params.id);

    // Build referral summary for WhatsApp
    const lang = session.language || 'en';
    const patientName = patient.patient_name || session.firstName || 'Patient';
    const dob = session.dob?.dob_string || 'Unknown';
    const sex = session.sex || 'Unknown';
    const chronic = (session.chronicConditions || []).map(c => c.label_en || c.key).join(', ') || 'None';

    // Detect referral type — hospital vs specialist (psychiatry/psychology/other)
    const isSpecialist = (nurse_notes || '').includes('DOCTOR REFERRAL to ');
    const referralTypeLabel = isSpecialist
      ? (nurse_notes.match(/DOCTOR REFERRAL to (\w+)/)?.[1] || 'Specialist')
      : 'Hospital';
    const referralIcon = isSpecialist ? '📋' : '🏥';
    const showTo = isSpecialist ? 'the specialist' : 'the hospital';
    const goTo = isSpecialist
      ? `Your clinic will arrange an appointment with ${destination_hospital || 'the specialist'}. You will be contacted with the date and time.`
      : (transport_method === 'ambulance'
        ? '🚑 An ambulance has been requested. Wait for the ambulance or ask the nurse for updates.'
        : '🚗 Please go to the hospital now. Show this message to the hospital reception.');

    const referralMsg = {
      en: `${referralIcon} *${referralTypeLabel.toUpperCase()} REFERRAL*\n\n` +
        `You are being referred to ${destination_hospital || (isSpecialist ? 'a specialist' : 'the nearest hospital')}.\n\n` +
        `📋 *Referral Summary* (show this to ${showTo}):\n` +
        `━━━━━━━━━━━━━━━━━━━━\n` +
        `Referral ID: *${referralId}*\n` +
        `Patient: *${patientName}*\n` +
        `DOB: ${dob} | Sex: ${sex}\n` +
        `BZ Code: *${study_code || session.studyCode || 'N/A'}*\n` +
        `Triage: *${patient.triage_level}*\n` +
        `Symptoms: ${patient.symptoms_summary || 'See clinical notes'}\n` +
        `Chronic: ${chronic}\n` +
        `Referred by: ${nurse_name || 'Doctor'}\n` +
        `Reason: ${nurse_notes || 'Clinical referral'}\n` +
        `Time: ${new Date().toLocaleString('en-ZA', { timeZone: 'Africa/Johannesburg' })}\n` +
        `━━━━━━━━━━━━━━━━━━━━\n\n` +
        goTo,

      zu: `🏥 *UKUDLULISELWA ESIBHEDLELA*\n\n` +
        `Udluliselwa ${destination_hospital || 'esibhedlela esiseduze'}.\n\n` +
        `📋 *Isifinyezo sokudluliselwa* (khombisa loku esibhedlela):\n` +
        `━━━━━━━━━━━━━━━━━━━━\n` +
        `I-Referral ID: *${referralId}*\n` +
        `Isiguli: *${patientName}*\n` +
        `Usuku lokuzalwa: ${dob} | Ubulili: ${sex}\n` +
        `Ikhodi ye-BZ: *${study_code || session.studyCode || 'N/A'}*\n` +
        `Isimo: *${patient.triage_level}*\n` +
        `Izimpawu: ${patient.symptoms_summary || 'Bheka amanothi kanesi'}\n` +
        `Esingamahlalakhona: ${chronic}\n` +
        `Udluliselwe ngu: ${nurse_name || 'Unesi'}\n` +
        `Isizathu: ${nurse_notes || 'Ukudluliselwa kwezempilo'}\n` +
        `Isikhathi: ${new Date().toLocaleString('en-ZA', { timeZone: 'Africa/Johannesburg' })}\n` +
        `━━━━━━━━━━━━━━━━━━━━\n\n` +
        (transport_method === 'ambulance'
          ? '🚑 I-ambulensi iceliwe. Linda i-ambulensi noma ubuze unesi.'
          : '🚗 Yana esibhedlela manje. Khombisa lo myalezo e-reception yesibhedlela.'),

      xh: `🏥 *UKUDLULISELWA ESIBHEDLELE*\n\n` +
        `Udluliselwa ${destination_hospital || 'esibhedlele esikufutshane'}.\n\n` +
        `📋 *Isishwankathelo sokudluliselwa* (bonisa oku esibhedlele):\n` +
        `━━━━━━━━━━━━━━━━━━━━\n` +
        `I-Referral ID: *${referralId}*\n` +
        `Isigulana: *${patientName}*\n` +
        `Umhla wokuzalwa: ${dob} | Isini: ${sex}\n` +
        `Ikhowudi ye-BZ: *${study_code || session.studyCode || 'N/A'}*\n` +
        `Inqanaba: *${patient.triage_level}*\n` +
        `Iimpawu: ${patient.symptoms_summary || 'Jonga amanqaku omongikazi'}\n` +
        `Ezinganyangekiyo: ${chronic}\n` +
        `Udluliselwe ngu: ${nurse_name || 'Umongikazi'}\n` +
        `Isizathu: ${nurse_notes || 'Ukudluliselwa kwezempilo'}\n` +
        `Ixesha: ${new Date().toLocaleString('en-ZA', { timeZone: 'Africa/Johannesburg' })}\n` +
        `━━━━━━━━━━━━━━━━━━━━\n\n` +
        (transport_method === 'ambulance'
          ? '🚑 I-ambulensi iceliwe. Linda i-ambulensi okanye ubuze umongikazi.'
          : '🚗 Yiya esibhedlele ngoku. Bonisa lo myalezo e-reception yesibhedlele.'),

      af: `🏥 *HOSPITAALVERWYSING*\n\n` +
        `Jy word verwys na ${destination_hospital || 'die naaste hospitaal'}.\n\n` +
        `📋 *Verwysingsopsomming* (wys dit by die hospitaal):\n` +
        `━━━━━━━━━━━━━━━━━━━━\n` +
        `Verwysing ID: *${referralId}*\n` +
        `Pasiënt: *${patientName}*\n` +
        `Geboortedatum: ${dob} | Geslag: ${sex}\n` +
        `BZ Kode: *${study_code || session.studyCode || 'N/A'}*\n` +
        `Triage: *${patient.triage_level}*\n` +
        `Simptome: ${patient.symptoms_summary || 'Sien verpleegster notas'}\n` +
        `Chronies: ${chronic}\n` +
        `Verwys deur: ${nurse_name || 'Verpleegster'}\n` +
        `Rede: ${nurse_notes || 'Kliniese verwysing'}\n` +
        `Tyd: ${new Date().toLocaleString('en-ZA', { timeZone: 'Africa/Johannesburg' })}\n` +
        `━━━━━━━━━━━━━━━━━━━━\n\n` +
        (transport_method === 'ambulance'
          ? '🚑 \'n Ambulans is versoek. Wag vir die ambulans of vra die verpleegster.'
          : '🚗 Gaan nou na die hospitaal. Wys hierdie boodskap by die hospitaal ontvangs.'),

      nso: `🏥 *PHETIŠETŠO YA BOOKELO*\n\n` +
        `O romelwa go ${destination_hospital || 'bookelo ya kgauswi'}.\n\n` +
        `📋 *Kakaretšo ya phetišetšo* (bontšha se bookelong):\n` +
        `━━━━━━━━━━━━━━━━━━━━\n` +
        `Referral ID: *${referralId}*\n` +
        `Molwetši: *${patientName}*\n` +
        `Letšatši la matswalo: ${dob} | Bong: ${sex}\n` +
        `BZ Code: *${study_code || session.studyCode || 'N/A'}*\n` +
        `Triage: *${patient.triage_level}*\n` +
        `Dika: ${patient.symptoms_summary || 'Bona dinoutše tša mooki'}\n` +
        `Malwetši a go dulela: ${chronic}\n` +
        `O rometswe ke: ${nurse_name || 'Mooki'}\n` +
        `Lebaka: ${nurse_notes || 'Phetišetšo ya kalafo'}\n` +
        `Nako: ${new Date().toLocaleString('en-ZA', { timeZone: 'Africa/Johannesburg' })}\n` +
        `━━━━━━━━━━━━━━━━━━━━\n\n` +
        (transport_method === 'ambulance'
          ? '🚑 Ambulense e kgopetšwe. Ema ambulense goba botšiša mooki.'
          : '🚗 Ya bookelong bjale. Bontšha molaetša wo resepsheneng ya bookelo.'),

      tn: `🏥 *PHETISO YA BOOKELONG*\n\n` +
        `O romelwa go ${destination_hospital || 'bookelong ya gaufi'}.\n\n` +
        `📋 *Kakaretso ya phetiso* (bontsha se kwa bookelong):\n` +
        `━━━━━━━━━━━━━━━━━━━━\n` +
        `Referral ID: *${referralId}*\n` +
        `Molwetse: *${patientName}*\n` +
        `Letsatsi la matsalo: ${dob} | Bong: ${sex}\n` +
        `BZ Code: *${study_code || session.studyCode || 'N/A'}*\n` +
        `Triage: *${patient.triage_level}*\n` +
        `Matshwao: ${patient.symptoms_summary || 'Bona dinoute tsa mooki'}\n` +
        `Malwetse a go nnela ruri: ${chronic}\n` +
        `O rometswe ke: ${nurse_name || 'Mooki'}\n` +
        `Lebaka: ${nurse_notes || 'Phetiso ya kalafi'}\n` +
        `Nako: ${new Date().toLocaleString('en-ZA', { timeZone: 'Africa/Johannesburg' })}\n` +
        `━━━━━━━━━━━━━━━━━━━━\n\n` +
        (transport_method === 'ambulance'
          ? '🚑 Ambulense e kopilwe. Ema ambulense kgotsa botsa mooki.'
          : '🚗 Ya bookelong jaanong. Bontsha molaetsa o resepsheneng ya bookelong.'),

      st: `🏥 *PHETISO HO SEPETLELE*\n\n` +
        `O romelwa ho ${destination_hospital || 'sepetlele se haufi'}.\n\n` +
        `📋 *Kakaretso ya phetiso* (bontsha sena sepetleleng):\n` +
        `━━━━━━━━━━━━━━━━━━━━\n` +
        `Referral ID: *${referralId}*\n` +
        `Mokudi: *${patientName}*\n` +
        `Letsatsi la tswalo: ${dob} | Botona/Botsehadi: ${sex}\n` +
        `BZ Code: *${study_code || session.studyCode || 'N/A'}*\n` +
        `Triage: *${patient.triage_level}*\n` +
        `Matshwao: ${patient.symptoms_summary || 'Bona dinoutse tsa mooki'}\n` +
        `Mahlale: ${chronic}\n` +
        `O rometswe ke: ${nurse_name || 'Mooki'}\n` +
        `Lebaka: ${nurse_notes || 'Phetiso ya kalafo'}\n` +
        `Nako: ${new Date().toLocaleString('en-ZA', { timeZone: 'Africa/Johannesburg' })}\n` +
        `━━━━━━━━━━━━━━━━━━━━\n\n` +
        (transport_method === 'ambulance'
          ? '🚑 Ambulense e kopilwe. Ema ambulense kapa botsa mooki.'
          : '🚗 Eya sepetleleng hona joale. Bontsha molaetsa ona resepsheneng.'),

      ts: `🏥 *KU HUNDZISERIWA XIBEDLHELE*\n\n` +
        `U hundziseriwa eka ${destination_hospital || 'xibedlhele xa kusuhi'}.\n\n` +
        `📋 *Nkoka wa ku hundziseriwa* (komba leswi exibedlhele):\n` +
        `━━━━━━━━━━━━━━━━━━━━\n` +
        `Referral ID: *${referralId}*\n` +
        `Muvabyi: *${patientName}*\n` +
        `Siku ra ku velekiwa: ${dob} | Rimbewu: ${sex}\n` +
        `BZ Code: *${study_code || session.studyCode || 'N/A'}*\n` +
        `Triage: *${patient.triage_level}*\n` +
        `Swikombiso: ${patient.symptoms_summary || 'Vona tinoto ta muongi'}\n` +
        `Vuvabyi bya vurhongo: ${chronic}\n` +
        `U hundziseriwile hi: ${nurse_name || 'Muongi'}\n` +
        `Xivangelo: ${nurse_notes || 'Ku hundziseriwa ka vuongori'}\n` +
        `Nkarhi: ${new Date().toLocaleString('en-ZA', { timeZone: 'Africa/Johannesburg' })}\n` +
        `━━━━━━━━━━━━━━━━━━━━\n\n` +
        (transport_method === 'ambulance'
          ? '🚑 Ambulense yi kombetiwile. Yima ambulense kumbe vutisa muongi.'
          : '🚗 Ya exibedlhele sweswi. Komba muvulavulo lowu eka resepsheni.'),

      ss: `🏥 *KUDLULISELA ESIBHEDLELA*\n\n` +
        `Udluliswa ku ${destination_hospital || 'sibhedlela lesisedvute'}.\n\n` +
        `📋 *Sifinyeto sekudlulisela* (khombisa loku esibhedlela):\n` +
        `━━━━━━━━━━━━━━━━━━━━\n` +
        `Referral ID: *${referralId}*\n` +
        `Sigulane: *${patientName}*\n` +
        `Lusuku lwekutalwa: ${dob} | Bulili: ${sex}\n` +
        `BZ Code: *${study_code || session.studyCode || 'N/A'}*\n` +
        `Triage: *${patient.triage_level}*\n` +
        `Timphawu: ${patient.symptoms_summary || 'Buka emanothsi enesi'}\n` +
        `Sifo lesikhashana: ${chronic}\n` +
        `Udluliswe ngu: ${nurse_name || 'Unesi'}\n` +
        `Sizatfu: ${nurse_notes || 'Kudlulisela kwekwelapha'}\n` +
        `Sikhatsi: ${new Date().toLocaleString('en-ZA', { timeZone: 'Africa/Johannesburg' })}\n` +
        `━━━━━━━━━━━━━━━━━━━━\n\n` +
        (transport_method === 'ambulance'
          ? '🚑 I-ambulensi icelwe. Lindza i-ambulensi noma buta unesi.'
          : '🚗 Hamba esibhedlela nyalo. Khombisa lomlayezo ku-reception.'),

      ve: `🏥 *U RUMELWA SIBADELA*\n\n` +
        `Ni khou rumelwa kha ${destination_hospital || 'sibadela tshi re tsini'}.\n\n` +
        `📋 *Manweledzo a u rumelwa* (sumbedzani izwi kha sibadela):\n` +
        `━━━━━━━━━━━━━━━━━━━━\n` +
        `Referral ID: *${referralId}*\n` +
        `Mulwadze: *${patientName}*\n` +
        `Ḓuvha la u bebwa: ${dob} | Mbeu: ${sex}\n` +
        `BZ Code: *${study_code || session.studyCode || 'N/A'}*\n` +
        `Triage: *${patient.triage_level}*\n` +
        `Zwiga: ${patient.symptoms_summary || 'Vhonani maṅwalo a muongi'}\n` +
        `Vhulwadze: ${chronic}\n` +
        `No rumelwa nga: ${nurse_name || 'Muongi'}\n` +
        `Tshiitisi: ${nurse_notes || 'U rumelwa ha mutakalo'}\n` +
        `Tshifhinga: ${new Date().toLocaleString('en-ZA', { timeZone: 'Africa/Johannesburg' })}\n` +
        `━━━━━━━━━━━━━━━━━━━━\n\n` +
        (transport_method === 'ambulance'
          ? '🚑 Ambulensi yo humbelwa. Lindelan ambulensi kana vhudzisani muongi.'
          : '🚗 Yani kha sibadela zwino. Sumbedzani mulaedza uyu kha resepsheni.'),

      nr: `🏥 *UKUDLULISELWA ESIBHEDLELA*\n\n` +
        `Udluliselwa ku ${destination_hospital || 'isibhedlela esiseduze'}.\n\n` +
        `📋 *Isifinyeto sokudlulisela* (khombisa loku esibhedlela):\n` +
        `━━━━━━━━━━━━━━━━━━━━\n` +
        `Referral ID: *${referralId}*\n` +
        `Isigulani: *${patientName}*\n` +
        `Ilanga lokubelethwa: ${dob} | Ubulili: ${sex}\n` +
        `BZ Code: *${study_code || session.studyCode || 'N/A'}*\n` +
        `Triage: *${patient.triage_level}*\n` +
        `Iimphawu: ${patient.symptoms_summary || 'Bona amanothsi kanesi'}\n` +
        `Isifo sesikhathi eside: ${chronic}\n` +
        `Udluliswe ngu: ${nurse_name || 'Unesi'}\n` +
        `Isizathu: ${nurse_notes || 'Ukudlulisela kwezokuphila'}\n` +
        `Isikhathi: ${new Date().toLocaleString('en-ZA', { timeZone: 'Africa/Johannesburg' })}\n` +
        `━━━━━━━━━━━━━━━━━━━━\n\n` +
        (transport_method === 'ambulance'
          ? '🚑 I-ambulensi icelwe. Linda i-ambulensi noma buza unesi.'
          : '🚗 Yiya esibhedlela nje. Khombisa lomlayezo ku-reception.'),
    };

    // Send referral to patient on WhatsApp
    if (patient.patient_phone) {
      await sendWhatsAppMessage(patient.patient_phone, referralMsg[lang] || referralMsg['en']);
    }

    // Log for governance
    logger.info(`[REFERRAL] ${referralId}: ${patientName} → ${destination_hospital || 'nearest hospital'} by ${nurse_name} (${transport_method})`);

    // Generate EMS call helper — pre-filled editable fields for the nurse's 10177 call.
    // The nurse can edit any field based on their clinical assessment before calling.
    const emsCallHelper = transport_method === 'ambulance' ? {
      call_number: '10177',
      fields: {
        facility: patient.facility_name || req.user?.facility_name || '',
        patient_name: patientName,
        patient_sex: sex,
        patient_dob: dob,
        patient_age: session.dob?.age || session.patientAge || '',
        triage_level: patient.triage_level || 'RED',
        presenting_complaint: patient.symptoms_summary || '',
        nurse_clinical_findings: nurse_notes || '',
        vitals: '',  // Nurse fills this in — BP, pulse, RR, SpO2, GCS
        chronic_conditions: chronic,
        allergies: '',  // Nurse fills in if known
        current_medication: '',  // Nurse fills in if known
        interventions_given: '',  // What the nurse did before calling (e.g. "IV access, oxygen")
        referral_id: referralId,
        nurse_on_duty: nurse_name || req.user?.display_name || '',
        nurse_contact: req.user?.phone || '',
        destination: destination_hospital || '',
      },
      instructions: 'Review and edit these details based on YOUR assessment. Then call 10177. Read the fields to the dispatcher. Stay with the patient until EMS arrives.',
    } : null;

    // Store EMS call helper on the referral record so any staff member can access it
    // Nurse authorises the escalation; clerk/receptionist can retrieve the script to make the call
    if (emsCallHelper) {
      await supabase.from('referrals').upsert({
        patient_id: patient.patient_id,
        ref_number: referralId,
        ems_call_helper: emsCallHelper,
        ems_call_status: 'pending',       // pending → called → ems_dispatched → ems_arrived
        ems_authorised_by: nurse_name || req.user?.display_name,
        ems_authorised_at: new Date().toISOString(),
        created_at: new Date(),
      }, { onConflict: 'ref_number' }).catch(e => logger.error('[EMS] Failed to store call helper:', e.message));
    }

    res.json({ success: true, referral_id: referralId, ems_call_helper: emsCallHelper });
    await logAudit(req, 'ESCALATE', req.params.id, { referral_id: referralId, destination: destination_hospital, transport_method });
    // Also store in the new referrals table for hospital lookup
    try {
      await supabase.from('referrals').insert({
        ref_number: referralId,
        session_id: patient.id,
        patient_name: patient.patient_name?.split(' ')[0] || null,
        patient_surname: patient.patient_name?.split(' ').slice(1).join(' ') || null,
        triage_colour: patient.triage_level,
        symptom_summary: patient.symptoms_summary,
        originating_facility_name: req.user?.facility_name || patient.notes?.replace('Facility: ', '') || null,
        receiving_facility_name: destination_hospital,
        referral_reason: nurse_notes,
        transport_method,
        status: 'pending'
      });
    } catch (refErr) { logger.error('[REFERRAL] referrals table insert error:', refErr.message); }

    // Schedule post-hospital follow-ups — since we're not integrated with the hospital,
    // WhatsApp is the only way to maintain continuity of care after escalation
    if (patient.patient_phone) {
      try {
        // 4 hours: did you make it to the hospital?
        await supabase.from('follow_ups').insert({
          patient_id: patient.patient_id,
          phone: patient.patient_phone,
          triage_level: patient.triage_level || 'RED',
          scheduled_at: new Date(Date.now() + 4 * 60 * 60 * 1000),
          status: 'pending',
          type: 'hospital_arrival_check',
          data: JSON.stringify({
            referral_id: referralId,
            destination: destination_hospital,
            facility_name: patient.facility_name,
          }),
        });

        // 5 days: are you still in hospital or discharged?
        // Most medical admissions resolve within 3-7 days. Asking at 48h is premature.
        await supabase.from('follow_ups').insert({
          patient_id: patient.patient_id,
          phone: patient.patient_phone,
          triage_level: patient.triage_level || 'RED',
          scheduled_at: new Date(Date.now() + 5 * 24 * 60 * 60 * 1000),
          status: 'pending',
          type: 'hospital_discharge_check',
          data: JSON.stringify({
            referral_id: referralId,
            destination: destination_hospital,
            facility_name: patient.facility_name,
          }),
        });
      } catch (fuErr) { logger.error('[REFERRAL] Follow-up scheduling error:', fuErr.message); }
    }
  } catch (e) {
    logger.error('[REFERRAL] Error:', e.message);
    res.status(500).json({ error: 'Server error' });
  }
});

// PUT /api/clinic/queue/:id/feedback — Nurse triage feedback (agree/disagree)
app.put('/api/clinic/queue/:id/feedback', requireDashboardAuth, async (req, res) => {
  try {
    const { verdict, nurse_triage_level, nurse_name, override_reason, override_notes } = req.body;

    // Get current queue entry
    const { data: entry } = await supabase
      .from('clinic_queue')
      .select('patient_id, triage_level, notes, symptoms_summary')
      .eq('id', req.params.id)
      .single();

    if (!entry) return res.status(404).json({ error: 'Patient not found' });

    // Fetch the rule that fired from triage_logs for this patient (most recent today)
    const todayStart = new Date(); todayStart.setHours(0,0,0,0);
    const { data: triageLog } = await supabase
      .from('triage_logs')
      .select('rule_override, discriminator_matched')
      .eq('patient_id', entry.patient_id)
      .gte('created_at', todayStart.toISOString())
      .order('created_at', { ascending: false })
      .limit(1)
      .single()
      .catch(() => ({ data: null }));
    entry.rule_override = triageLog?.rule_override || null;
    entry.discriminator_matched = triageLog?.discriminator_matched || null;

    // Store feedback in notes
    const reasonStr = override_reason ? ` [Reason: ${override_reason}]` : '';
    const notesStr = override_notes ? ` [Notes: ${override_notes}]` : '';
    const feedbackNote = `Nurse ${nurse_name || 'unknown'}: ${verdict}${nurse_triage_level ? ' → ' + nurse_triage_level : ''} (AI was ${entry.triage_level})${reasonStr}${notesStr}`;
    const updatedNotes = (entry.notes ? entry.notes + ' | ' : '') + feedbackNote;

    const update = { notes: updatedNotes };

    // If nurse disagrees, update triage level and potentially reassign queue
    if (verdict === 'disagree' && nurse_triage_level) {
      update.triage_level = nurse_triage_level;
      if (['RED', 'ORANGE'].includes(nurse_triage_level) && entry.triage_level !== 'RED' && entry.triage_level !== 'ORANGE') {
        update.queue_type = 'fast_track';
      } else if (['YELLOW', 'GREEN'].includes(nurse_triage_level) && ['RED', 'ORANGE'].includes(entry.triage_level)) {
        update.queue_type = 'routine';
      }
    }

    await supabase.from('clinic_queue').update(update).eq('id', req.params.id);

    // Log structured feedback — store rule that fired so monthly review can identify problem rules
    await supabase.from('triage_feedback').insert({
      queue_entry_id:    req.params.id,
      patient_id:        entry.patient_id,
      facility_name:     req.user ? req.user.facility_name : null,
      facility_id:       req.user ? req.user.facility_id : null,
      nurse_name:        req.user ? req.user.display_name : (nurse_name || 'unknown'),
      verdict:           verdict,                              // 'agree' | 'disagree'
      ai_triage_level:   entry.triage_level,                  // what AI said
      nurse_triage_level: nurse_triage_level || null,         // what nurse said (null if agree)
      direction:         verdict === 'disagree'
        ? (['RED','ORANGE'].includes(nurse_triage_level) && !['RED','ORANGE'].includes(entry.triage_level) ? 'upgrade'
          : ['GREEN','YELLOW'].includes(nurse_triage_level) && ['RED','ORANGE'].includes(entry.triage_level) ? 'downgrade'
          : 'lateral')
        : null,
      rule_fired:        entry.rule_override || entry.discriminator_matched || null,
      symptoms_summary:  (entry.symptoms_summary || '').slice(0, 300),
      override_reason:   override_reason || null,
      override_notes:    override_notes || null,
      created_at:        new Date().toISOString(),
    }).catch(e => logger.error('[FEEDBACK] Insert error:', e.message));

    // Also update triage_logs with structured nurse feedback
    await supabase.from('triage_logs')
      .update({
        nurse_verdict:        verdict,
        nurse_triage_level:   nurse_triage_level || null,
        nurse_name:           req.user ? req.user.display_name : (nurse_name || null),
        nurse_feedback_at:    new Date().toISOString(),
      })
      .eq('patient_id', entry.patient_id)
      .order('created_at', { ascending: false })
      .limit(1);

    res.json({ success: true });
    const auditAction = verdict === 'agree' ? 'AGREE' : 'DISAGREE';
    await logAudit(req, auditAction, req.params.id, {
      ai_level: entry.triage_level,
      nurse_level: nurse_triage_level || entry.triage_level,
      nurse_name: req.user ? req.user.display_name : nurse_name,
      rule_fired: entry.rule_override || entry.discriminator_matched || null,
      direction: verdict === 'disagree'
        ? (['RED','ORANGE'].includes(nurse_triage_level) && !['RED','ORANGE'].includes(entry.triage_level) ? 'upgrade' : 'other')
        : null,
    });
  } catch (e) {
    res.status(500).json({ error: 'Server error' });
  }
});

// GET /api/referral/:id — Lookup a referral by ID (for hospitals using BIZUSIZO)
// Hospital reception types the referral ID → gets full patient summary
app.get('/api/referral/:id', requireDashboardAuth, async (req, res) => {
  try {
    const refId = req.params.id.toUpperCase().trim();

    // Find the referral in triage_logs by searching symptoms field for the referral ID
    const { data: logs } = await supabase
      .from('triage_logs')
      .select('*')
      .like('symptoms', `%${refId}%`)
      .eq('escalation', true)
      .order('created_at', { ascending: false })
      .limit(1);

    if (!logs || logs.length === 0) {
      return res.json({ found: false, message: 'Referral not found' });
    }

    const log = logs[0];
    const patientId = log.patient_id;

    // Get full session data
    const session = await getSession(patientId);

    // Get study code + full history in parallel
    const [codeRes, triageHistRes, outcomeHistRes, labHistRes] = await Promise.all([
      supabase.from('study_codes').select('study_code').eq('patient_id', patientId).limit(1),
      supabase.from('triage_logs').select('*').eq('patient_id', patientId).order('created_at', { ascending: false }).limit(10),
      supabase.from('follow_up_outcomes').select('*').eq('patient_id', patientId).order('response_received_at', { ascending: false }).limit(5),
      supabase.from('lab_results').select('*').eq('patient_id', patientId).order('created_at', { ascending: false }).limit(10),
    ]);

    const triageHist = triageHistRes.data || [];
    const trend = triageHist.length >= 2
      ? triageHist.slice().reverse().map(t => t.triage_level).join(' → ')
      : log.triage_level;

    res.json({
      found: true,
      referral_id: refId,
      patient: {
        name: (session.firstName && session.surname) ? `${session.firstName} ${session.surname}` : null,
        dob: session.dob?.dob_string || null,
        age: session.dob?.age || session.patientAge || null,
        sex: session.sex || null,
        study_code: codeRes.data?.[0]?.study_code || session.studyCode || null,
        language: session.language || 'en',
      },
      triage: {
        level: log.triage_level,
        symptoms: log.symptoms,
        pathway: log.pathway,
        facility: log.facility_name,
        time: log.created_at,
        reasoning: log.reasoning || null,
        rule_override: log.rule_override || null,
        tews_score: log.tews_score ?? null,
        low_confidence_flag: log.low_confidence_flag || false,
      },
      triage_history: triageHist.map(t => ({
        triage_level: t.triage_level,
        confidence: t.confidence,
        symptoms: t.symptoms,
        facility_name: t.facility_name,
        created_at: t.created_at,
        reasoning: t.reasoning || null,
        rule_override: t.rule_override || null,
        low_confidence_flag: t.low_confidence_flag || false,
      })),
      triage_trend: trend,
      chronic_conditions: (session.chronicConditions || []).map(c => c.label_en || c.key),
      follow_up_outcomes: (outcomeHistRes.data || []).map(o => ({
        symptom_outcome: o.symptom_outcome,
        visited_clinic: o.visited_clinic,
        access_failure: o.access_failure,
        response_received_at: o.response_received_at,
      })),
      lab_results: (labHistRes.data || []).map(l => ({
        test_type: l.test_type,
        test_date: l.test_date,
        result_status: l.result_status,
        result_summary: l.result_summary,
        result_category: l.result_category,
        facility: l.facility,
        created_at: l.created_at,
      })),
    });
  } catch (e) {
    res.status(500).json({ error: 'Server error' });
  }
});

// POST /api/clinic/arrive — Patient arrival check-in via WhatsApp
// Called when patient sends "arrived" or "here" command
app.post('/api/clinic/arrive', async (req, res) => {
  try {
    const { patient_id } = req.body;
    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);

    const { data, error } = await supabase
      .from('clinic_queue')
      .update({ notes: 'ARRIVED — confirmed via WhatsApp' })
      .eq('patient_id', patient_id)
      .eq('status', 'waiting')
      .gte('checked_in_at', todayStart.toISOString());

    if (error) throw error;
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ error: 'Server error' });
  }
});

// PUT /api/clinic/queue/:id/tews — Record TEWS score (DoH Documentation)
// Supports BOTH real-time (nurse at bedside) AND retrospective (clerk/data capturer later)
// Tracks: who entered, when entered, role, whether retrospective, original paper timestamp
app.put('/api/clinic/queue/:id/tews', requireDashboardAuth, async (req, res) => {
  try {
    const { tews_score, tews_colour, discriminators, vitals, nurse_name,
            entered_by_role, is_retrospective, original_assessment_time, notes } = req.body;

    const now = new Date();
    const enteredBy = nurse_name || req.user?.display_name || 'Unknown';
    const role = entered_by_role || 'nurse'; // nurse, clerk, data_capturer, facility_manager

    const tewsData = {
      tews_score,
      tews_colour,
      discriminators: discriminators || [],
      vitals: vitals || {},
      entered_by: enteredBy,
      entered_by_role: role,
      entered_at: now,
      is_retrospective: is_retrospective || false,
      original_assessment_time: original_assessment_time || null, // when vitals were actually taken (from paper)
      notes: notes || null,
    };

    // Update the queue entry with TEWS data
    const { error } = await supabase
      .from('clinic_queue')
      .update({
        tews_score,
        tews_colour,
        tews_data: tewsData,
        // If TEWS colour is more urgent than current triage level, upgrade
        ...(shouldUpgrade(tews_colour, null) ? { triage_level: tews_colour } : {}),
      })
      .eq('id', req.params.id);

    if (error) throw error;

    // Auto-save vitals to longitudinal history — every TEWS feeds the trend
    if (vitals && (vitals.rr || vitals.hr || vitals.sbp || vitals.temp)) {
      const { data: queueEntry } = await supabase
        .from('clinic_queue').select('patient_id').eq('id', req.params.id).single();

      if (queueEntry?.patient_id) {
        await supabase.from('vitals_history').insert({
          patient_id: queueEntry.patient_id,
          facility_name: req.user?.facility_name || null,
          recorded_by: enteredBy,
          recorded_by_role: role,
          source: 'tews',
          systolic_bp: vitals.sbp ? parseInt(vitals.sbp) : null,
          heart_rate: vitals.hr ? parseInt(vitals.hr) : null,
          respiratory_rate: vitals.rr ? parseInt(vitals.rr) : null,
          temperature: vitals.temp ? parseFloat(vitals.temp) : null,
          avpu: vitals.avpu || null,
          recorded_at: is_retrospective && original_assessment_time
            ? new Date(original_assessment_time)
            : new Date(),
        }).catch(e => logger.error('[VITALS] Auto-save from TEWS failed:', e.message));
      }
    }

    await logAudit(req, 'TEWS_RECORDED', req.params.id, {
      tews_score, tews_colour, discriminators,
      entered_by: enteredBy, role, is_retrospective: is_retrospective || false,
    });

    res.json({ success: true, tews_score, tews_colour });
  } catch (e) {
    res.status(500).json({ error: 'Server error' });
  }
});

// Helper: should TEWS colour upgrade the triage level?
function shouldUpgrade(tewsColour, currentLevel) {
  const order = { RED: 4, ORANGE: 3, YELLOW: 2, GREEN: 1 };
  return (order[tewsColour] || 0) > (order[currentLevel] || 0);
}

// PUT /api/clinic/queue/:id/complete — Complete consultation (DoH Exit Flow)
// Captures: treatment given, tests done, medication dispensed, next visit, notes
// Sends WhatsApp exit message with treatment summary + health education + next visit
app.put('/api/clinic/queue/:id/complete', requireDashboardAuth, async (req, res) => {
  try {
    const { treatments, tests, medications, next_visit_date, notes, nurse_name,
            entered_by_role, is_retrospective, original_completion_time } = req.body;

    const enteredBy = nurse_name || req.user?.display_name || 'Unknown';
    const role = entered_by_role || 'nurse';

    // Get patient details for WhatsApp notification
    const { data: patient } = await supabase
      .from('clinic_queue')
      .select('patient_phone, patient_id, patient_name, triage_level, queue_type, symptoms_summary, facility_name')
      .eq('id', req.params.id)
      .single();

    // Build exit summary
    const exitData = {
      treatments: treatments || [],
      tests: tests || [],
      medications: medications || [],
      next_visit_date: next_visit_date || null,
      entered_by: enteredBy,
      entered_by_role: role,
      entered_at: new Date(),
      is_retrospective: is_retrospective || false,
      original_completion_time: original_completion_time || null,
    };

    const { error } = await supabase
      .from('clinic_queue')
      .update({
        status: 'completed',
        completed_at: new Date(),
        notes: (notes ? notes + ' | ' : '') + 'EXIT: ' + JSON.stringify(exitData),
        exit_data: exitData,
      })
      .eq('id', req.params.id);

    if (error) throw error;

    // Send WhatsApp exit message to patient (if phone available)
    if (patient?.patient_phone) {
      try {
        // Get patient language from session
        const patientId = patient.patient_id;
        const { data: sessionData } = await supabase.from('sessions').select('data').eq('patient_id', patientId).single();
        const lang = sessionData?.data?.language || 'en';

        // Build exit message components
        const treatmentLabels = { medication: 'Medication', injection: 'Injection', wound_care: 'Wound care', nebulisation: 'Nebulisation', counselling: 'Counselling', procedure: 'Procedure' };
        const testLabels = { hiv_test: 'HIV test', bp_check: 'BP check', glucose: 'Glucose test', urine: 'Urine test', blood_draw: 'Blood draw', pap_smear: 'Pap smear' };
        const medLabels = { prescription: 'Prescription', chronic_meds: 'Chronic medication', otc: 'Over-the-counter medication' };

        const treatmentStr = (treatments || []).map(t => treatmentLabels[t] || t).join(', ') || 'General consultation';
        const testStr = (tests || []).length > 0 ? (tests || []).map(t => testLabels[t] || t).join(', ') : null;
        const medStr = (medications || []).length > 0 ? (medications || []).map(m => medLabels[m] || m).join(', ') : null;
        const nextVisitStr = next_visit_date ? new Date(next_visit_date).toLocaleDateString('en-ZA', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }) : null;

        const exitMsg = {
          en: `✅ *Your visit is complete.*\n\n🏥 ${patient.facility_name || 'Clinic'}\n💊 Treatment: ${treatmentStr}${testStr ? '\n🔬 Tests: ' + testStr : ''}${medStr ? '\n💊 Medication: ' + medStr : ''}${nextVisitStr ? '\n📅 Next visit: *' + nextVisitStr + '*' : ''}\n\nIf your symptoms worsen or you need help, type *0* to start a new consultation.\n\nStay well. 🙏`,
          zu: `✅ *Ukuvakashela kwakho kuphelile.*\n\n🏥 ${patient.facility_name || 'Umtholampilo'}\n💊 Ukwelashwa: ${treatmentStr}${testStr ? '\n🔬 Izinhlolo: ' + testStr : ''}${medStr ? '\n💊 Umuthi: ' + medStr : ''}${nextVisitStr ? '\n📅 Ukuvakashela okulandelayo: *' + nextVisitStr + '*' : ''}\n\nUma izimpawu zakho ziba zimbi noma udinga usizo, bhala *0* ukuqala kabusha.\n\nUhlale kahle. 🙏`,
          xh: `✅ *Utyelelo lwakho lugqityiwe.*\n\n🏥 ${patient.facility_name || 'Ikliniki'}\n💊 Unyango: ${treatmentStr}${testStr ? '\n🔬 Izilingo: ' + testStr : ''}${medStr ? '\n💊 Amayeza: ' + medStr : ''}${nextVisitStr ? '\n📅 Utyelelo olulandelayo: *' + nextVisitStr + '*' : ''}\n\nUkuba iimpawu zakho ziya zisiba mbi okanye ufuna uncedo, bhala *0* ukuqala kwakhona.\n\nHlala kakuhle. 🙏`,
          af: `✅ *Jou besoek is voltooi.*\n\n🏥 ${patient.facility_name || 'Kliniek'}\n💊 Behandeling: ${treatmentStr}${testStr ? '\n🔬 Toetse: ' + testStr : ''}${medStr ? '\n💊 Medikasie: ' + medStr : ''}${nextVisitStr ? '\n📅 Volgende besoek: *' + nextVisitStr + '*' : ''}\n\nAs jou simptome vererger of jy hulp nodig het, tik *0* vir nuwe konsultasie.\n\nBly gesond. 🙏`,
          nso: `✅ *Ketelo ya gago e phethilwe.*\n\n🏥 ${patient.facility_name || 'Kliniki'}\n💊 Kalafo: ${treatmentStr}${testStr ? '\n🔬 Diteko: ' + testStr : ''}${medStr ? '\n💊 Dihlare: ' + medStr : ''}${nextVisitStr ? '\n📅 Ketelo ye e latelago: *' + nextVisitStr + '*' : ''}\n\nGe dika di mpefala goba o nyaka thušo, ngwala *0* go thoma lefsa.\n\nDula gabotse. 🙏`,
          tn: `✅ *Ketelo ya gago e fedile.*\n\n🏥 ${patient.facility_name || 'Kliniki'}\n💊 Kalafo: ${treatmentStr}${testStr ? '\n🔬 Diteko: ' + testStr : ''}${medStr ? '\n💊 Dimelemo: ' + medStr : ''}${nextVisitStr ? '\n📅 Ketelo e e latelang: *' + nextVisitStr + '*' : ''}\n\nFa matshwao a maswe kgotsa o tlhoka thuso, kwala *0* go simolola sešwa.\n\nNna sentle. 🙏`,
          st: `✅ *Ketelo ya hao e phethilwe.*\n\n🏥 ${patient.facility_name || 'Kliniki'}\n💊 Pheko: ${treatmentStr}${testStr ? '\n🔬 Diteko: ' + testStr : ''}${medStr ? '\n💊 Meriana: ' + medStr : ''}${nextVisitStr ? '\n📅 Ketelo e latelang: *' + nextVisitStr + '*' : ''}\n\nHaeba matshwao a mpefala kapa o hloka thuso, ngola *0* ho qala bocha.\n\nPhela hantle. 🙏`,
          ts: `✅ *Ku endzela ka wena ku hetile.*\n\n🏥 ${patient.facility_name || 'Kliniki'}\n💊 Vurhanyi: ${treatmentStr}${testStr ? '\n🔬 Mavonelo: ' + testStr : ''}${medStr ? '\n💊 Mirhi: ' + medStr : ''}${nextVisitStr ? '\n📅 Ku endzela loku landzelaka: *' + nextVisitStr + '*' : ''}\n\nLoko swikombiso swi nyanya kumbe u lava mpfuno, tsala *0* ku sungula hi vuntshwa.\n\nTshama kahle. 🙏`,
          ss: `✅ *Kuvakashela kwakho kuphelile.*\n\n🏥 ${patient.facility_name || 'Umtfolamphilo'}\n💊 Kwelapha: ${treatmentStr}${testStr ? '\n🔬 Kuhlolwa: ' + testStr : ''}${medStr ? '\n💊 Imitsi: ' + medStr : ''}${nextVisitStr ? '\n📅 Kuvakashela lokulandzelako: *' + nextVisitStr + '*' : ''}\n\nNangabe timphawu tiba timbi noma udzinga lusito, bhala *0* kucala kabusha.\n\nHlala kahle. 🙏`,
          ve: `✅ *U dalela haṋu ho fhela.*\n\n🏥 ${patient.facility_name || 'Kiliniki'}\n💊 Vhulafhi: ${treatmentStr}${testStr ? '\n🔬 Ndingo: ' + testStr : ''}${medStr ? '\n💊 Mushonga: ' + medStr : ''}${nextVisitStr ? '\n📅 U dalela hu tevhelaho: *' + nextVisitStr + '*' : ''}\n\nArali zwiga zwi tshi vhifha kana ni tshi ṱoḓa thuso, ṅwalani *0* u thoma hafhu.\n\nDzulani zwavhuḓi. 🙏`,
          nr: `✅ *Ukuvakatjhela kwakho kuphelile.*\n\n🏥 ${patient.facility_name || 'Ikliniki'}\n💊 Ukwelapha: ${treatmentStr}${testStr ? '\n🔬 Ukuhlolwa: ' + testStr : ''}${medStr ? '\n💊 Imitjhoga: ' + medStr : ''}${nextVisitStr ? '\n📅 Ukuvakatjhela okulandelako: *' + nextVisitStr + '*' : ''}\n\nNangabe iimphawu ziba zimbi noma udinga isizo, tlola *0* ukuthoma kabutjha.\n\nHlala kuhle. 🙏`,
        };
        await sendWhatsAppMessage(patient.patient_phone, exitMsg[lang] || exitMsg['en']);

        // Health education — DoH Exit Process requires education for ALL triage levels
        // GREEN patients get self-care advice during triage; YELLOW/ORANGE/RED get post-visit education here
        if (['RED', 'ORANGE', 'YELLOW'].includes(patient.triage_level)) {
          try {
            const education = await generateHealthEducation(
              patient.triage_level,
              patient.symptoms_summary,
              treatments,
              lang
            );
            if (education) {
              await sendWhatsAppMessage(patient.patient_phone, education);
            }
          } catch (edErr) {
            logger.error('[HEALTH-ED] Failed to send health education:', edErr.message);
          }
        }
      } catch (e) {
        logger.error('[EXIT] WhatsApp exit message failed:', e.message);
        // Non-critical — don't fail the completion
      }
    }

    // Dispensing confirmation — ask patient to confirm they received medication
    // DoH Exit Process requires medication dispensing verification
    if (patient?.patient_phone && (medications || []).length > 0) {
      try {
        const medLabels = { prescription: 'Prescription', chronic_meds: 'Chronic medication', otc: 'Over-the-counter medication' };
        const medList = (medications || []).map(m => medLabels[m] || m).join(', ');

        // Schedule dispensing confirmation 2 hours after completion (gives time for pharmacy queue)
        await supabase.from('follow_ups').insert({
          patient_id: patient.patient_id,
          phone: patient.patient_phone,
          triage_level: patient.triage_level || 'GREEN',
          scheduled_at: new Date(Date.now() + 2 * 60 * 60 * 1000),
          status: 'pending',
          type: 'dispensing_confirmation',
          data: JSON.stringify({ medications: medications, facility_name: patient.facility_name }),
        });
      } catch (dispErr) {
        logger.error('[DISPENSING] Failed to schedule dispensing confirmation:', dispErr.message);
      }
    }

    // Treatment adherence follow-up — 48h post-visit medication compliance check
    // Only for patients who received prescription or chronic meds (not just OTC)
    if (patient?.patient_phone && (medications || []).some(m => m === 'prescription' || m === 'chronic_meds')) {
      try {
        const medLabels = { prescription: 'prescription medication', chronic_meds: 'chronic medication', otc: 'over-the-counter medication' };
        const relevantMeds = (medications || []).filter(m => m === 'prescription' || m === 'chronic_meds').map(m => medLabels[m] || m);
        await supabase.from('follow_ups').insert({
          patient_id: patient.patient_id,
          phone: patient.patient_phone,
          triage_level: patient.triage_level || 'GREEN',
          scheduled_at: new Date(Date.now() + 48 * 60 * 60 * 1000),
          status: 'pending',
          type: 'treatment_adherence',
          data: JSON.stringify({ medications: relevantMeds, facility_name: patient.facility_name }),
        });
      } catch (adhErr) {
        logger.error('[ADHERENCE] Failed to schedule adherence check:', adhErr.message);
      }
    }

    // Schedule next visit reminder if date provided
    if (next_visit_date && patient?.patient_phone) {
      try {
        const visitDate = new Date(next_visit_date);
        const reminderDate = new Date(visitDate);
        reminderDate.setDate(reminderDate.getDate() - 1); // Day before
        reminderDate.setHours(6, 30, 0, 0); // 06:30 SAST (04:30 UTC)

        await supabase.from('follow_ups').insert({
          patient_id: patient.patient_id,
          phone: patient.patient_phone,
          triage_level: patient.triage_level || 'GREEN',
          scheduled_at: reminderDate,
          status: 'pending',
          type: 'next_visit_reminder',
        });
      } catch (e) {
        logger.error('[EXIT] Next visit reminder scheduling failed:', e.message);
      }
    }

    // Schedule patient satisfaction survey — 4 hours after completion
    // DoH Exit Process: patient experience measurement for continuous improvement
    if (patient?.patient_phone) {
      try {
        await supabase.from('follow_ups').insert({
          patient_id: patient.patient_id,
          phone: patient.patient_phone,
          triage_level: patient.triage_level || 'GREEN',
          scheduled_at: new Date(Date.now() + 4 * 60 * 60 * 1000),
          status: 'pending',
          type: 'satisfaction_survey',
          data: JSON.stringify({ facility_name: patient.facility_name, queue_type: patient.queue_type }),
        });
      } catch (satErr) {
        logger.error('[SATISFACTION] Failed to schedule survey:', satErr.message);
      }
    }

    res.json({ success: true, exit_data: exitData });
    await logAudit(req, 'COMPLETE', req.params.id, { ...exitData, patient_name: patient?.patient_name });
  } catch (e) {
    res.status(500).json({ error: 'Server error' });
  }
});

// PUT /api/clinic/queue/:id/discharge — Formal discharge summary (DoH Exit Process)
// Captures structured clinical data from the nurse/doctor back into Bizusizo.
// Separate from 'complete' — this is the clinical summary, not the queue completion.
app.put('/api/clinic/queue/:id/discharge', requireDashboardAuth, async (req, res) => {
  try {
    const { diagnosis, diagnosis_icd10, clinical_notes, discharge_instructions,
            follow_up_plan, referral_to, medications_prescribed, tests_ordered,
            vitals_at_discharge, nurse_name } = req.body;

    const { data: patient } = await supabase
      .from('clinic_queue')
      .select('patient_id, patient_name, patient_phone, triage_level, facility_name')
      .eq('id', req.params.id)
      .single();

    if (!patient) return res.status(404).json({ error: 'Patient not found' });

    const summary = {
      diagnosis: diagnosis || null,
      diagnosis_icd10: diagnosis_icd10 || null,
      clinical_notes: clinical_notes || null,
      discharge_instructions: discharge_instructions || null,
      follow_up_plan: follow_up_plan || null,
      referral_to: referral_to || null,
      medications_prescribed: medications_prescribed || [],
      tests_ordered: tests_ordered || [],
      vitals_at_discharge: vitals_at_discharge || null,
      entered_by: nurse_name || req.user?.display_name || 'Unknown',
      entered_at: new Date().toISOString(),
    };

    // Store in discharge_summaries table
    await supabase.from('discharge_summaries').insert({
      patient_id: patient.patient_id,
      queue_entry_id: req.params.id,
      facility_name: patient.facility_name || req.user?.facility_name,
      triage_level: patient.triage_level,
      ...summary,
      created_at: new Date(),
    });

    // Also update the queue entry with discharge reference
    await supabase.from('clinic_queue')
      .update({ discharge_summary: summary })
      .eq('id', req.params.id);

    // If patient has phone, send discharge instructions via WhatsApp
    if (patient.patient_phone && discharge_instructions) {
      try {
        const { data: sessionData } = await supabase.from('sessions').select('data').eq('patient_id', patient.patient_id).single();
        const lang = sessionData?.data?.language || 'en';
        const dischargeMsg = {
          en: `📋 *Discharge Summary*\n\n${diagnosis ? '🏥 Diagnosis: ' + diagnosis + '\n' : ''}${discharge_instructions}\n\n${follow_up_plan ? '📅 Follow-up: ' + follow_up_plan + '\n' : ''}${medications_prescribed?.length ? '💊 Medication: ' + medications_prescribed.join(', ') + '\n' : ''}\nKeep this message for your records. If your condition worsens, type *0* or call *10177*.`,
          zu: `📋 *Isifinyezo Sokuphuma*\n\n${diagnosis ? '🏥 Isimo: ' + diagnosis + '\n' : ''}${discharge_instructions}\n\n${follow_up_plan ? '📅 Ukulandelela: ' + follow_up_plan + '\n' : ''}${medications_prescribed?.length ? '💊 Umuthi: ' + medications_prescribed.join(', ') + '\n' : ''}\nGcina lo mlayezo emarekhothini akho. Uma isimo sakho sibhibha, bhala *0* noma shaya *10177*.`,
          xh: `📋 *Isishwankathelo Sokukhululwa*\n\n${diagnosis ? '🏥 Isimo: ' + diagnosis + '\n' : ''}${discharge_instructions}\n\n${follow_up_plan ? '📅 Ukulandelela: ' + follow_up_plan + '\n' : ''}${medications_prescribed?.length ? '💊 Amayeza: ' + medications_prescribed.join(', ') + '\n' : ''}\nGcina lo myalezo kwirekhodi yakho. Ukuba imeko yakho iyabhibha, bhala *0* okanye tsalela *10177*.`,
          af: `📋 *Ontslag Opsomming*\n\n${diagnosis ? '🏥 Diagnose: ' + diagnosis + '\n' : ''}${discharge_instructions}\n\n${follow_up_plan ? '📅 Opvolg: ' + follow_up_plan + '\n' : ''}${medications_prescribed?.length ? '💊 Medikasie: ' + medications_prescribed.join(', ') + '\n' : ''}\nBewaar hierdie boodskap vir jou rekords. As jou toestand vererger, tik *0* of bel *10177*.`,
        };
        await sendWhatsAppMessage(patient.patient_phone, dischargeMsg[lang] || dischargeMsg['en']);
      } catch (e) {
        logger.error('[DISCHARGE] WhatsApp message failed:', e.message);
      }
    }

    res.json({ success: true, discharge_summary: summary });
    await logAudit(req, 'DISCHARGE_SUMMARY', req.params.id, {
      patient_name: patient.patient_name, diagnosis, entered_by: summary.entered_by,
    });
  } catch (e) {
    logger.error('[DISCHARGE] Error:', e.message);
    res.status(500).json({ error: 'Server error' });
  }
});

// PUT /api/clinic/queue/:id/regimen-change — Record chronic medication regimen change
// HPCSA requires: drugs + dosage, reason for change, who decided, patient counselled.
// Sends WhatsApp notification to patient with new medication details.
app.put('/api/clinic/queue/:id/regimen-change', requireDashboardAuth, async (req, res) => {
  try {
    const { condition, previous_medication, new_medication, dosage,
            change_reason, change_reason_detail, lab_results_trigger,
            nurse_name, authorised_by_role, patient_counselled, counselling_notes } = req.body;

    if (!condition || !new_medication || !change_reason) {
      return res.status(400).json({ error: 'condition, new_medication, and change_reason required' });
    }

    const { data: patient } = await supabase
      .from('clinic_queue')
      .select('patient_id, patient_phone, patient_name, facility_name')
      .eq('id', req.params.id)
      .single();

    if (!patient) return res.status(404).json({ error: 'Patient not found' });

    const authoriser = nurse_name || req.user?.display_name || 'Unknown';
    const role = authorised_by_role || 'nurse';

    // Store regimen change
    const { data: changeRecord, error } = await supabase.from('regimen_changes').insert({
      patient_id: patient.patient_id,
      queue_entry_id: parseInt(req.params.id),
      facility_name: patient.facility_name || req.user?.facility_name,
      condition,
      previous_medication: previous_medication || null,
      new_medication,
      dosage: dosage || null,
      change_reason,
      change_reason_detail: change_reason_detail || null,
      lab_results_trigger: lab_results_trigger || null,
      authorised_by: authoriser,
      authorised_by_role: role,
      patient_counselled: patient_counselled || false,
      counselling_notes: counselling_notes || null,
      created_at: new Date(),
    }).select().single();

    if (error) throw error;

    // Send WhatsApp notification to patient about the medication change
    if (patient.patient_phone) {
      try {
        const { data: sessionData } = await supabase.from('sessions').select('data').eq('patient_id', patient.patient_id).single();
        const lang = sessionData?.data?.language || 'en';

        const reasonLabels = {
          step_up: 'your current medication is not controlling your condition well enough',
          step_down: 'your condition is well controlled and you can move to a simpler regimen',
          adverse_effect: 'you experienced side effects with your previous medication',
          viral_failure: 'your viral load results show the current treatment needs to change',
          treatment_failure: 'your current treatment is not achieving the target results',
          stockout: 'your usual medication is temporarily unavailable',
          patient_preference: 'you requested a change',
          new_diagnosis: 'a new condition has been identified',
          other: 'your clinician has determined a change is needed',
        };
        const reasonText = reasonLabels[change_reason] || reasonLabels.other;

        const changeMsg = {
          en: `💊 *Medication Change*\n\n${previous_medication ? 'Your medication has been changed from *' + previous_medication + '* to' : 'You have been started on'} *${new_medication}*${dosage ? ' (' + dosage + ')' : ''}.\n\n📋 Reason: ${reasonText}${lab_results_trigger ? '\n🔬 Based on: ' + lab_results_trigger : ''}\n\n${change_reason === 'adverse_effect' ? '⚠️ If you experience any new side effects, contact your clinic or type *0*.\n\n' : ''}Take your new medication exactly as instructed. Do not stop your medication without speaking to a nurse or doctor.\n\nQuestions? Contact your clinic or type *0*.`,
          zu: `💊 *Ukushintsha Komuthi*\n\n${previous_medication ? 'Umuthi wakho ushintshwe kusuka ku-*' + previous_medication + '* kuya ku' : 'Uqalile ukuthatha'} *${new_medication}*${dosage ? ' (' + dosage + ')' : ''}.\n\n📋 Isizathu: ${reasonText}${lab_results_trigger ? '\n🔬 Ngokusekelwe ku: ' + lab_results_trigger : ''}\n\nThatha umuthi wakho omusha njengoba ufundisiwe. Ungayeki umuthi wakho ngaphandle kokukhuluma nonesi noma udokotela.\n\nImibuzo? Thinta umtholampilo wakho noma bhala *0*.`,
          xh: `💊 *Ukutshintsha Kwamayeza*\n\n${previous_medication ? 'Amayeza akho atshintshwe asuka ku-*' + previous_medication + '* aya ku' : 'Uqalile ukuthatha'} *${new_medication}*${dosage ? ' (' + dosage + ')' : ''}.\n\n📋 Isizathu: ${reasonText}${lab_results_trigger ? '\n🔬 Ngokusekwe ku: ' + lab_results_trigger : ''}\n\nThatha amayeza akho amatsha njengoko ufundisiwe. Musa ukuyeka amayeza ngaphandle kokuthetha nomongikazi okanye ugqirha.\n\nImibuzo? Qhagamshelana nekliniki yakho okanye bhala *0*.`,
          af: `💊 *Medikasie Verandering*\n\n${previous_medication ? 'Jou medikasie is verander van *' + previous_medication + '* na' : 'Jy is begin op'} *${new_medication}*${dosage ? ' (' + dosage + ')' : ''}.\n\n📋 Rede: ${reasonText}${lab_results_trigger ? '\n🔬 Gebaseer op: ' + lab_results_trigger : ''}\n\nNeem jou nuwe medikasie presies soos aangedui. Moenie jou medikasie stop sonder om met \'n verpleegster of dokter te praat nie.\n\nVrae? Kontak jou kliniek of tik *0*.`,
        };
        await sendWhatsAppMessage(patient.patient_phone, changeMsg[lang] || changeMsg['en']);
      } catch (e) {
        logger.error('[REGIMEN] WhatsApp notification failed:', e.message);
      }
    }

    // Schedule adherence follow-up for new medication (48h)
    if (patient.patient_phone) {
      try {
        await supabase.from('follow_ups').insert({
          patient_id: patient.patient_id,
          phone: patient.patient_phone,
          triage_level: 'GREEN',
          scheduled_at: new Date(Date.now() + 48 * 60 * 60 * 1000),
          status: 'pending',
          type: 'treatment_adherence',
          data: JSON.stringify({
            medications: [new_medication],
            facility_name: patient.facility_name,
            is_regimen_change: true,
          }),
        });
      } catch (e) { /* non-critical */ }
    }

    // Governance alert if change was due to adverse effect or treatment failure
    if (['adverse_effect', 'viral_failure', 'treatment_failure'].includes(change_reason)) {
      await supabase.from('governance_alerts').insert({
        alert_type: 'regimen_change_' + change_reason,
        severity: change_reason === 'adverse_effect' ? 'MEDIUM' : 'HIGH',
        pillar: 'clinical_performance',
        message: `Regimen change for ${condition}: ${previous_medication || 'none'} → ${new_medication}. Reason: ${change_reason}. Authorised by ${authoriser} (${role}).`,
        data: { patient_id: patient.patient_id, condition, change_reason, lab_results_trigger },
        resolved: false,
      }).catch(e => logger.error('[REGIMEN] Governance alert failed:', e.message));
    }

    res.json({ success: true, regimen_change: changeRecord });
    await logAudit(req, 'REGIMEN_CHANGE', req.params.id, {
      condition, previous: previous_medication, new_med: new_medication,
      reason: change_reason, authorised_by: authoriser, role,
      patient_counselled,
    });
  } catch (e) {
    logger.error('[REGIMEN] Error:', e.message);
    res.status(500).json({ error: 'Server error' });
  }
});

// GET /api/clinic/regimen-history/:patient_id — View patient's regimen change history
app.get('/api/clinic/regimen-history/:patient_id', requireDashboardAuth, async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('regimen_changes')
      .select('*')
      .eq('patient_id', req.params.patient_id)
      .order('created_at', { ascending: false })
      .limit(20);

    if (error) throw error;
    res.json({ history: data || [] });
  } catch (e) {
    res.status(500).json({ error: 'Server error' });
  }
});

// ================================================================
// VITALS HISTORY — Longitudinal vital signs tracking
// ================================================================

// POST /api/clinic/vitals — Record vitals for a patient
app.post('/api/clinic/vitals', requireDashboardAuth, async (req, res) => {
  try {
    const { patient_id, systolic_bp, diastolic_bp, heart_rate, respiratory_rate,
            temperature, spo2, glucose, glucose_context, weight_kg, height_cm,
            avpu, gcs, pain_score, context_notes, source } = req.body;

    if (!patient_id) return res.status(400).json({ error: 'patient_id required' });

    // Calculate BMI if weight and height provided
    let bmi = null;
    if (weight_kg && height_cm) {
      bmi = Math.round(weight_kg / ((height_cm / 100) ** 2) * 10) / 10;
    }

    const entry = {
      patient_id,
      facility_name: req.user?.facility_name || null,
      recorded_by: req.user?.display_name || 'Unknown',
      recorded_by_role: req.user?.role || 'nurse',
      source: source || 'manual',
      systolic_bp: systolic_bp || null,
      diastolic_bp: diastolic_bp || null,
      heart_rate: heart_rate || null,
      respiratory_rate: respiratory_rate || null,
      temperature: temperature || null,
      spo2: spo2 || null,
      glucose: glucose || null,
      glucose_context: glucose_context || null,
      weight_kg: weight_kg || null,
      height_cm: height_cm || null,
      bmi,
      avpu: avpu || null,
      gcs: gcs || null,
      pain_score: pain_score || null,
      context_notes: context_notes || null,
      recorded_at: new Date(),
    };

    const { data, error } = await supabase.from('vitals_history').insert(entry).select().single();
    if (error) throw error;

    // Check for critical vitals and alert
    const alerts = [];
    if (systolic_bp && (systolic_bp >= 180 || systolic_bp <= 80)) alerts.push(`BP ${systolic_bp}/${diastolic_bp || '?'} — critical`);
    if (heart_rate && (heart_rate >= 130 || heart_rate <= 40)) alerts.push(`HR ${heart_rate} — critical`);
    if (spo2 && spo2 < 90) alerts.push(`SpO2 ${spo2}% — hypoxia`);
    if (temperature && (temperature >= 39.5 || temperature < 35)) alerts.push(`Temp ${temperature}°C — critical`);
    if (glucose && (glucose <= 3.5 || glucose >= 20)) alerts.push(`Glucose ${glucose} mmol/L — critical`);

    if (alerts.length > 0) {
      await supabase.from('governance_alerts').insert({
        alert_type: 'critical_vitals', severity: 'HIGH', pillar: 'clinical_performance',
        message: `Critical vitals recorded: ${alerts.join('; ')}`,
        data: { patient_id, vitals: entry, alerts },
        resolved: false,
      }).catch(e => {});
    }

    res.json({ success: true, vitals: data, critical_alerts: alerts });
    await logAudit(req, 'RECORD_VITALS', null, { patient_id, source, has_critical: alerts.length > 0 });
  } catch (e) {
    logger.error('[VITALS] Error:', e.message);
    res.status(500).json({ error: 'Server error' });
  }
});

// GET /api/clinic/vitals/:patient_id — Get vitals history for trending
app.get('/api/clinic/vitals/:patient_id', requireDashboardAuth, async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('vitals_history')
      .select('*')
      .eq('patient_id', req.params.patient_id)
      .order('recorded_at', { ascending: false })
      .limit(50);

    if (error) throw error;

    // Calculate trends if enough data
    const vitals = data || [];
    const trends = {};
    if (vitals.length >= 2) {
      const latest = vitals[0];
      const previous = vitals[1];
      if (latest.systolic_bp && previous.systolic_bp) {
        const diff = latest.systolic_bp - previous.systolic_bp;
        trends.bp = diff > 10 ? 'rising' : diff < -10 ? 'falling' : 'stable';
        trends.bp_change = diff;
      }
      if (latest.weight_kg && previous.weight_kg) {
        const diff = latest.weight_kg - previous.weight_kg;
        trends.weight = diff > 1 ? 'gaining' : diff < -1 ? 'losing' : 'stable';
        trends.weight_change_kg = Math.round(diff * 10) / 10;
      }
      if (latest.glucose && previous.glucose) {
        const diff = latest.glucose - previous.glucose;
        trends.glucose = diff > 2 ? 'rising' : diff < -2 ? 'falling' : 'stable';
      }
    }

    res.json({ vitals, trends, count: vitals.length });
  } catch (e) {
    res.status(500).json({ error: 'Server error' });
  }
});

// ================================================================
// ALLERGY RECORD
// ================================================================

// POST /api/clinic/allergies — Add an allergy for a patient
app.post('/api/clinic/allergies', requireDashboardAuth, async (req, res) => {
  try {
    const { patient_id, allergy_type, allergen, reaction, severity, confirmed, notes } = req.body;
    if (!patient_id || !allergen || !allergy_type) {
      return res.status(400).json({ error: 'patient_id, allergy_type, and allergen required' });
    }

    // Check for duplicate
    const { data: existing } = await supabase
      .from('patient_allergies')
      .select('id')
      .eq('patient_id', patient_id)
      .ilike('allergen', allergen.trim())
      .eq('active', true)
      .limit(1);

    if (existing && existing.length > 0) {
      return res.status(409).json({ error: 'Allergy already recorded', existing_id: existing[0].id });
    }

    const { data, error } = await supabase.from('patient_allergies').insert({
      patient_id,
      allergy_type,
      allergen: allergen.trim(),
      reaction: reaction || null,
      severity: severity || 'unknown',
      confirmed: confirmed || false,
      reported_by: req.user?.display_name || 'Unknown',
      notes: notes || null,
    }).select().single();

    if (error) throw error;

    // If life-threatening allergy, create governance alert
    if (severity === 'life_threatening' || severity === 'severe') {
      await supabase.from('governance_alerts').insert({
        alert_type: 'severe_allergy_recorded', severity: 'MEDIUM', pillar: 'patient_safety',
        message: `${severity} allergy recorded: ${allergen} (${reaction || 'reaction not specified'})`,
        data: { patient_id, allergen, reaction, severity },
        resolved: false,
      }).catch(e => {});
    }

    res.json({ success: true, allergy: data });
    await logAudit(req, 'ADD_ALLERGY', null, { patient_id, allergen, allergy_type, severity });
  } catch (e) {
    logger.error('[ALLERGY] Error:', e.message);
    res.status(500).json({ error: 'Server error' });
  }
});

// GET /api/clinic/allergies/:patient_id — Get patient's allergy list
app.get('/api/clinic/allergies/:patient_id', requireDashboardAuth, async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('patient_allergies')
      .select('*')
      .eq('patient_id', req.params.patient_id)
      .eq('active', true)
      .order('severity', { ascending: true }); // life_threatening first

    if (error) throw error;
    res.json({ allergies: data || [], has_severe: (data || []).some(a => a.severity === 'severe' || a.severity === 'life_threatening') });
  } catch (e) {
    res.status(500).json({ error: 'Server error' });
  }
});

// PUT /api/clinic/allergies/:id/deactivate — Remove an allergy (disproven or entered in error)
app.put('/api/clinic/allergies/:id/deactivate', requireDashboardAuth, async (req, res) => {
  try {
    const { reason } = req.body;
    const { error } = await supabase
      .from('patient_allergies')
      .update({ active: false, notes: reason || 'Deactivated' })
      .eq('id', req.params.id);

    if (error) throw error;
    res.json({ success: true });
    await logAudit(req, 'DEACTIVATE_ALLERGY', req.params.id, { reason });
  } catch (e) {
    res.status(500).json({ error: 'Server error' });
  }
});

// GET /api/clinic/ems-calls — List pending EMS calls for this facility
// Available to ALL authenticated staff (receptionist, clerk, nurse, doctor)
// Shows calls that have been authorised by a nurse but not yet made
app.get('/api/clinic/ems-calls', requireDashboardAuth, async (req, res) => {
  try {
    let query = supabase
      .from('referrals')
      .select('ref_number, patient_name, ems_call_helper, ems_call_status, ems_authorised_by, ems_authorised_at, created_at')
      .not('ems_call_helper', 'is', null)
      .in('ems_call_status', ['pending', 'called']);

    query = facilityFilter(req, query, 'originating_facility_name');
    const { data, error } = await query;
    if (error) throw error;

    res.json({ ems_calls: data || [] });
  } catch (e) {
    res.status(500).json({ error: 'Server error' });
  }
});

// PUT /api/clinic/ems-call/:ref/status — Update EMS call status
// Any authenticated staff can update (they're the one making the call)
// Tracks: pending → called → ems_dispatched → ems_arrived
app.put('/api/clinic/ems-call/:ref/status', requireDashboardAuth, async (req, res) => {
  try {
    const { status, called_by, ems_reference, notes } = req.body;
    const validStatuses = ['called', 'ems_dispatched', 'ems_arrived', 'cancelled'];
    if (!validStatuses.includes(status)) {
      return res.status(400).json({ error: 'Invalid status. Must be: ' + validStatuses.join(', ') });
    }

    const updates = {
      ems_call_status: status,
    };
    if (status === 'called') {
      updates.ems_called_by = called_by || req.user?.display_name || 'Staff';
      updates.ems_called_at = new Date().toISOString();
      if (ems_reference) updates.ems_dispatch_reference = ems_reference;
    }
    if (status === 'ems_dispatched' && ems_reference) {
      updates.ems_dispatch_reference = ems_reference;
    }
    if (status === 'ems_arrived') {
      updates.ems_arrived_at = new Date().toISOString();
    }

    const { error } = await supabase
      .from('referrals')
      .update(updates)
      .eq('ref_number', req.params.ref);

    if (error) throw error;

    await logAudit(req, 'EMS_CALL_' + status.toUpperCase(), null, {
      ref_number: req.params.ref,
      called_by: called_by || req.user?.display_name,
      ems_reference,
      notes,
    });

    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ error: 'Server error' });
  }
});

// PUT /api/clinic/queue/:id/mark-arrived — Reception marks patient as physically arrived
// Any authenticated staff can mark arrival. Updates notes + triggers audit.
app.put('/api/clinic/queue/:id/mark-arrived', requireDashboardAuth, async (req, res) => {
  try {
    const { marked_by } = req.body;
    const arrivedBy = marked_by || req.user?.display_name || 'reception';
    const arrivedAt = new Date().toLocaleTimeString('en-ZA', { hour: '2-digit', minute: '2-digit' });

    const { data: entry } = await supabase.from('clinic_queue').select('notes, patient_id').eq('id', req.params.id).single();
    if (!entry) return res.status(404).json({ error: 'Patient not found' });

    // Don't double-mark
    if ((entry.notes || '').includes('ARRIVED')) {
      return res.json({ success: true, already_arrived: true });
    }

    await supabase.from('clinic_queue').update({
      notes: ((entry.notes || '') + ' | ARRIVED at ' + arrivedAt + ' — confirmed by ' + arrivedBy).trim(),
    }).eq('id', req.params.id);

    await logAudit(req, 'MARK_ARRIVED', req.params.id, { marked_by: arrivedBy, arrived_at: arrivedAt });
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ error: 'Server error' });
  }
});

// PUT /api/clinic/queue/:id/no-show — Mark as no-show
app.put('/api/clinic/queue/:id/no-show', requireDashboardAuth, async (req, res) => {
  try {
    const { error } = await supabase
      .from('clinic_queue')
      .update({
        status: 'no_show',
        completed_at: new Date(),
      })
      .eq('id', req.params.id);

    if (error) throw error;
    res.json({ success: true });
    await logAudit(req, 'NO_SHOW', req.params.id);
  } catch (e) {
    res.status(500).json({ error: 'Server error' });
  }
});

// PUT /api/clinic/queue/:id/pause — Pause consultation (nurse handling emergency)
app.put('/api/clinic/queue/:id/pause', requireDashboardAuth, async (req, res) => {
  try {
    const { nurse_name } = req.body;
    const { error } = await supabase
      .from('clinic_queue')
      .update({
        status: 'paused',
        notes: supabase.raw ? undefined : null, // Append handled below
      })
      .eq('id', req.params.id);

    // Append note
    const { data: entry } = await supabase.from('clinic_queue').select('notes').eq('id', req.params.id).single();
    await supabase.from('clinic_queue').update({
      notes: ((entry?.notes || '') + ' | PAUSED by ' + (nurse_name || 'nurse') + ' at ' + new Date().toLocaleTimeString('en-ZA')).trim()
    }).eq('id', req.params.id);

    if (error) throw error;
    res.json({ success: true });
    await logAudit(req, 'PAUSE', req.params.id, { nurse_name });
  } catch (e) {
    res.status(500).json({ error: 'Server error' });
  }
});

// PUT /api/clinic/queue/:id/resume — Resume paused consultation
app.put('/api/clinic/queue/:id/resume', requireDashboardAuth, async (req, res) => {
  try {
    const { nurse_name } = req.body;

    const { data: entry } = await supabase.from('clinic_queue').select('notes, patient_phone, patient_id').eq('id', req.params.id).single();

    const { error } = await supabase
      .from('clinic_queue')
      .update({
        status: 'in_consultation',
        notes: ((entry?.notes || '') + ' | RESUMED by ' + (nurse_name || 'nurse') + ' at ' + new Date().toLocaleTimeString('en-ZA')).trim()
      })
      .eq('id', req.params.id);

    // Notify patient on WhatsApp that they're being called back
    if (entry?.patient_phone) {
      try {
        const session = entry.patient_id ? await getSession(entry.patient_id) : {};
        const lang = session.language || 'en';
        const resumeMsg = {
          en: '📢 *You are being called back!* Please return to the consultation room now.',
          zu: '📢 *Uyabizwa futhi!* Sicela ubuyele egumbini lokubonana manje.',
          xh: '📢 *Uyabizwa kwakhona!* Nceda ubuyele kwigumbi lokubonana ngoku.',
          af: '📢 *Jy word weer geroep!* Keer asseblief nou terug na die spreekkamer.',
          nso: '📢 *O bitšwa gape!* Hle boela ka phapošing ya go bonana bjale.',
          tn: '📢 *O bidiwa gape!* Tsweetswee boela kwa phaposing ya go bonana jaanong.',
          st: '📢 *O bitswa hape!* Ka kopo khutlela kamoreng ya ho bonana joale.',
          ts: '📢 *U vitiwa nakambe!* Hi kombela u tlhelela ka kamareni ya mbulavurisano sweswi.',
          ss: '📢 *Uyabitwa futsi!* Sicela ubuyele ekamelweni lekuhlangana nyalo.',
          ve: '📢 *Ni khou vhidziwa hafhu!* Ri humbela ni humele kamurini ya u bonana zwino.',
          nr: '📢 *Uyabitwa godu!* Sibawa ubuyele ekamelweni lokuhlangana nje.',
        };
        await sendWhatsAppMessage(entry.patient_phone, resumeMsg[lang] || resumeMsg['en']);
      } catch (e) {
        logger.error('[RESUME] WhatsApp notification failed:', e.message);
      }
    }

    if (error) throw error;
    res.json({ success: true });
    await logAudit(req, 'RESUME', req.params.id, { nurse_name });
  } catch (e) {
    res.status(500).json({ error: 'Server error' });
  }
});

// PUT /api/clinic/queue/:id/left — Left Without Being Seen (LWBS)
app.put('/api/clinic/queue/:id/left', requireDashboardAuth, async (req, res) => {
  try {
    const { nurse_name } = req.body;
    const { error } = await supabase
      .from('clinic_queue')
      .update({
        status: 'left_without_seen',
        completed_at: new Date(),
        notes: 'LEFT WITHOUT BEING SEEN — recorded by ' + (nurse_name || 'staff'),
      })
      .eq('id', req.params.id);

    if (error) throw error;
    res.json({ success: true });
    await logAudit(req, 'LWBS', req.params.id, { nurse_name });
  } catch (e) {
    res.status(500).json({ error: 'Server error' });
  }
});

// PUT /api/clinic/queue/:id/reassign — Move patient to different queue
app.put('/api/clinic/queue/:id/reassign', requireDashboardAuth, async (req, res) => {
  try {
    const { queue_type } = req.body;
    if (!queue_type) return res.status(400).json({ error: 'queue_type required' });

    const { data: lastInQueue } = await supabase
      .from('clinic_queue')
      .select('position')
      .eq('queue_type', queue_type)
      .eq('status', 'waiting')
      .order('position', { ascending: false })
      .limit(1);

    const nextPosition = (lastInQueue && lastInQueue.length > 0)
      ? lastInQueue[0].position + 1
      : 1;

    const { error } = await supabase
      .from('clinic_queue')
      .update({
        queue_type,
        position: nextPosition,
      })
      .eq('id', req.params.id);

    if (error) throw error;
    res.json({ success: true });
    await logAudit(req, 'REASSIGN', req.params.id, { new_queue: queue_type });
  } catch (e) {
    res.status(500).json({ error: 'Server error' });
  }
});

// PUT /api/clinic/queue/:id/refer-to-doctor — Intra-clinic doctor referral
// Nurse determines patient needs doctor review (not hospital escalation).
// If doctor is available today, moves patient to doctor queue.
// If not, sends WhatsApp message with next doctor day and schedules reminder.
app.put('/api/clinic/queue/:id/refer-to-doctor', requireDashboardAuth, async (req, res) => {
  try {
    const { nurse_name, clinical_reason, doctor_name } = req.body;
    if (!clinical_reason) return res.status(400).json({ error: 'clinical_reason required' });

    // Get patient details
    const { data: patient } = await supabase
      .from('clinic_queue')
      .select('*')
      .eq('id', req.params.id)
      .single();

    if (!patient) return res.status(404).json({ error: 'Patient not found' });

    // Get patient session for language + phone
    const session = patient.patient_id ? await getSession(patient.patient_id) : {};
    const lang = session.language || 'en';

    // Check doctor availability for this facility today
    const today = new Date().toLocaleDateString('en-US', { weekday: 'lowercase', timeZone: 'Africa/Johannesburg' });
    const todayDay = new Date().toLocaleDateString('en-US', { weekday: 'long', timeZone: 'Africa/Johannesburg' }).toLowerCase();

    // Look up doctor schedule for this facility
    const { data: schedule } = await supabase
      .from('doctor_schedules')
      .select('*')
      .eq('facility_name', patient.facility_name)
      .eq('active', true);

    const todaySchedule = (schedule || []).find(s =>
      (s.days || []).map(d => d.toLowerCase()).includes(todayDay)
    );

    const doctorAvailableToday = !!todaySchedule;

    // ── Helper: get all available slots for a date ──
    async function getAvailableSlots(facilityName, date, scheduleObj) {
      const startHour = scheduleObj.start_time ? parseInt(String(scheduleObj.start_time).split(':')[0]) : 8;
      const endHour = scheduleObj.end_time ? parseInt(String(scheduleObj.end_time).split(':')[0]) : 16;
      const consultMins = scheduleObj.consultation_minutes || 20;
      const maxElective = scheduleObj.max_elective_patients || 10;

      // Get already booked slots for this date
      const { data: existing } = await supabase
        .from('doctor_referrals')
        .select('assigned_slot')
        .eq('facility_name', facilityName)
        .eq('referral_date', date)
        .in('status', ['scheduled', 'waiting', 'in_progress']);

      const bookedSlots = new Set((existing || []).map(r => r.assigned_slot).filter(Boolean));

      // Generate all possible slots
      const allSlots = [];
      for (let i = 0; i < maxElective; i++) {
        const slotMinutes = startHour * 60 + i * consultMins;
        const slotHour = Math.floor(slotMinutes / 60);
        const slotMin = slotMinutes % 60;
        if (slotHour >= endHour) break;
        const slotStr = `${String(slotHour).padStart(2, '0')}:${String(slotMin).padStart(2, '0')}`;
        if (!bookedSlots.has(slotStr)) {
          allSlots.push(slotStr);
        }
      }
      return allSlots;
    }

    // ── Helper: count existing referrals for a date ──
    async function countReferralsForDate(facilityName, date) {
      const { data } = await supabase
        .from('doctor_referrals')
        .select('id')
        .eq('facility_name', facilityName)
        .eq('referral_date', date)
        .in('status', ['scheduled', 'waiting', 'in_progress']);
      return (data || []).length;
    }

    // ── Helper: assign time slot based on position ──
    function assignSlot(schedule, slotIndex) {
      const startHour = schedule.start_time ? parseInt(String(schedule.start_time).split(':')[0]) : 8;
      const consultMins = schedule.consultation_minutes || 20;
      const slotMinutes = startHour * 60 + slotIndex * consultMins;
      const slotHour = Math.floor(slotMinutes / 60);
      const slotMin = slotMinutes % 60;
      const endHour = schedule.end_time ? parseInt(String(schedule.end_time).split(':')[0]) : 16;
      if (slotHour >= endHour) return null; // Past end of session
      return `${String(slotHour).padStart(2, '0')}:${String(slotMin).padStart(2, '0')}`;
    }

    if (doctorAvailableToday) {
      // ── Doctor is here today — check capacity before accepting ──
      const assignedDoctor = doctor_name || todaySchedule.doctor_name || 'Doctor';
      const todayStr = new Date().toISOString().slice(0, 10);
      const existingCount = await countReferralsForDate(patient.facility_name, todayStr);
      const maxElective = todaySchedule.max_elective_patients || 10;
      const sameDayReserve = todaySchedule.same_day_reserve || 4;
      const totalCapacity = maxElective + sameDayReserve;

      // Same-day referrals draw from the same_day_reserve pool first,
      // then from any unused elective slots
      const doctorFullToday = existingCount >= totalCapacity;

      if (doctorFullToday) {
        // ── Doctor is here but fully booked — schedule for NEXT doctor day ──
        // Don't silently add to an overflowing queue
        // Fall through to the "doctor not available" path below
        // but with a different message explaining why

        // Find next doctor day (reuse the logic below)
        const dayOrder = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'];
        const todayIdx = dayOrder.indexOf(todayDay);
        let nextDoctorDay = null;
        let nextSchedule = null;
        for (let offset = 1; offset <= 7; offset++) {
          const checkDay = dayOrder[(todayIdx + offset) % 7];
          const match = (schedule || []).find(s =>
            (s.days || []).map(d => d.toLowerCase()).includes(checkDay)
          );
          if (match) { nextDoctorDay = checkDay; nextSchedule = match; break; }
        }

        let nextDate = null;
        let nextDateStr = 'the next available doctor day';
        let assignedSlot = null;
        if (nextDoctorDay) {
          const now = new Date();
          const nextIdx = dayOrder.indexOf(nextDoctorDay);
          const daysUntil = ((nextIdx - todayIdx) + 7) % 7 || 7;
          nextDate = new Date(now.getTime() + daysUntil * 24 * 60 * 60 * 1000);
          nextDateStr = nextDate.toLocaleDateString('en-ZA', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'Africa/Johannesburg' });
          const nextDateCount = await countReferralsForDate(patient.facility_name, nextDate.toISOString().slice(0, 10));
          assignedSlot = assignSlot(nextSchedule || todaySchedule, nextDateCount);
        }

        const nextDoctor = doctor_name || nextSchedule?.doctor_name || assignedDoctor;

        await supabase.from('clinic_queue').update({
          status: 'completed', completed_at: new Date(),
          notes: (patient.notes ? patient.notes + ' | ' : '') +
            `DOCTOR REFERRAL (today full — rescheduled) by ${nurse_name || 'nurse'}: ${clinical_reason}. Doctor fully booked today (${existingCount}/${totalCapacity}). Rescheduled to ${nextDateStr}${assignedSlot ? ' at ' + assignedSlot : ''}.`,
        }).eq('id', req.params.id);

        await supabase.from('doctor_referrals').insert({
          queue_entry_id: patient.id, patient_id: patient.patient_id,
          patient_name: patient.patient_name, facility_name: patient.facility_name,
          facility_id: patient.facility_id, referred_by: nurse_name || 'nurse',
          clinical_reason, doctor_name: nextDoctor,
          status: 'scheduled', referral_date: nextDate ? nextDate.toISOString().slice(0, 10) : null,
          assigned_slot: assignedSlot, created_at: new Date(),
        });

        if (patient.patient_phone) {
          const fullMsg = {
            en: `👨‍⚕️ *DOCTOR APPOINTMENT*\n\nThe nurse has referred you to the doctor, but today's doctor session is fully booked.\n\n📋 Reason: ${clinical_reason}\n📅 Your appointment: *${nextDateStr}*${assignedSlot ? '\n⏰ Time slot: *' + assignedSlot + '*' : ''}\n👤 Doctor: ${nextDoctor}\n\nPlease come at your assigned time — this helps avoid long waits.\n\nWe will send you a reminder the day before.\n\nIf your condition worsens before then, please come to the clinic immediately or call 10177.`,
            zu: `👨‍⚕️ *ISIKHATHI SOKUBONA UDOKOTELA*\n\nUnesi ukudlulisele kudokotela, kodwa isikhathi sikadokotela sanamuhla sigcwele.\n\n📋 Isizathu: ${clinical_reason}\n📅 Isikhathi sakho: *${nextDateStr}*${assignedSlot ? '\n⏰ Isikhathi: *' + assignedSlot + '*' : ''}\n👤 Udokotela: ${nextDoctor}\n\nSicela uze ngesikhathi sakho — lokhu kusiza ukugwema ukulinda isikhathi eside.\n\nSizokuthumelela isikhumbuzo ngosuku olungaphambi.\n\nUma isimo sakho sibhebhetheka, sicela uze emtholampilo ngokushesha noma ushayele i-10177.`,
            xh: `👨‍⚕️ *IDINGA LOKUBONA UGQIRHA*\n\nUmongikazi ukudlulisele kugqirha, kodwa iseshoni kagqirha yanamhlanje igcwele.\n\n📋 Isizathu: ${clinical_reason}\n📅 Idinga lakho: *${nextDateStr}*${assignedSlot ? '\n⏰ Ixesha: *' + assignedSlot + '*' : ''}\n👤 Ugqirha: ${nextDoctor}\n\nNceda uze ngexesha lakho — oku kunceda ukuphepha ukulinda ixesha elide.\n\nSiza kukuthumela isikhumbuzo ngosuku olungaphambi.\n\nUkuba imeko yakho iya isiba mbi, nceda uze ekliniki ngokukhawuleza okanye utsalele i-10177.`,
            af: `👨‍⚕️ *DOKTER AFSPRAAK*\n\nDie verpleegster het jou verwys, maar vandag se doktersessie is vol.\n\n📋 Rede: ${clinical_reason}\n📅 Jou afspraak: *${nextDateStr}*${assignedSlot ? '\n⏰ Tydgleuf: *' + assignedSlot + '*' : ''}\n👤 Dokter: ${nextDoctor}\n\nKom asseblief op jou toegewysde tyd — dit help om lang wagtye te vermy.\n\nOns sal jou die dag voor herinner.\n\nAs jou toestand versleg, kom dadelik na die kliniek of bel 10177.`,
          };
          try { await sendWhatsAppMessage(patient.patient_phone, fullMsg[lang] || fullMsg.en); } catch (e) { /* non-critical */ }
        }

        // Schedule reminder
        if (nextDate && patient.patient_id) {
          const reminderTime = new Date(nextDate.getTime() - 18 * 60 * 60 * 1000);
          try {
            await supabase.from('follow_ups').insert({
              patient_id: patient.patient_id, phone: patient.patient_phone,
              type: 'doctor_appointment_reminder',
              status: 'pending', scheduled_at: reminderTime,
              data: JSON.stringify({ doctor_name: nextDoctor, clinical_reason, appointment_date: nextDateStr, assigned_slot: assignedSlot, facility_name: patient.facility_name, referral_id: referralData?.id || null }),
            });
          } catch (e) { /* non-critical */ }
        }

        res.json({
          success: true, doctor_available_today: true, doctor_full_today: true,
          rescheduled_to: nextDateStr, assigned_slot: assignedSlot,
          existing_count: existingCount, capacity: totalCapacity,
          doctor: nextDoctor,
        });
        await logAudit(req, 'REFER_TO_DOCTOR', req.params.id, {
          nurse_name, clinical_reason, doctor: nextDoctor,
          same_day: false, reason: 'today_full', existing: existingCount, capacity: totalCapacity,
          next_date: nextDateStr, slot: assignedSlot,
        });
        return;
      }

      // ── Doctor is here and has capacity — assign same-day slot ──
      const assignedSlot = assignSlot(todaySchedule, existingCount);

      await supabase.from('clinic_queue').update({
        status: 'waiting_for_doctor',
        queue_type: 'doctor',
        notes: (patient.notes ? patient.notes + ' | ' : '') +
          `DOCTOR REFERRAL by ${nurse_name || 'nurse'}: ${clinical_reason}. Assigned to ${assignedDoctor}${assignedSlot ? ' at ' + assignedSlot : ''}.`,
      }).eq('id', req.params.id);

      await supabase.from('doctor_referrals').insert({
        queue_entry_id: patient.id, patient_id: patient.patient_id,
        patient_name: patient.patient_name, facility_name: patient.facility_name,
        facility_id: patient.facility_id, referred_by: nurse_name || 'nurse',
        clinical_reason, doctor_name: assignedDoctor,
        status: 'waiting', referral_date: todayStr,
        assigned_slot: assignedSlot, created_at: new Date(),
      });

      if (patient.patient_phone) {
        const msgs = {
          en: `👨‍⚕️ *DOCTOR REFERRAL*\n\nThe nurse has referred you to the doctor for further assessment.\n\n📋 Reason: ${clinical_reason}\n👤 Doctor: ${assignedDoctor}${assignedSlot ? '\n⏰ Estimated time: *' + assignedSlot + '*' : ''}\n\nPlease wait — you will be called${assignedSlot ? ' around ' + assignedSlot : ' when the doctor is ready'}.\n\nYour file and triage summary have been prepared for the doctor.`,
          zu: `👨‍⚕️ *UKUDLULISELWA KUDOKOTELA*\n\nUnesi ukudlulisele kudokotela ukuze uhlolwe kabanzi.\n\n📋 Isizathu: ${clinical_reason}\n👤 Udokotela: ${assignedDoctor}${assignedSlot ? '\n⏰ Isikhathi esilindelekile: *' + assignedSlot + '*' : ''}\n\nSicela ulinde — uzobizelwa${assignedSlot ? ' cishe ngo-' + assignedSlot : ' uma udokotela esekulungele'}.\n\nIfayela lakho nesifinyezo sokutriage kulungiselelwe udokotela.`,
          xh: `👨‍⚕️ *UKUDLULISELWA KUGQIRHA*\n\nUmongikazi ukudlulisele kugqirha ukuze uhlolwe ngakumbi.\n\n📋 Isizathu: ${clinical_reason}\n👤 Ugqirha: ${assignedDoctor}${assignedSlot ? '\n⏰ Ixesha elilindelekileyo: *' + assignedSlot + '*' : ''}\n\nNceda ulinde — uza kubizwa${assignedSlot ? ' malunga no-' + assignedSlot : ' xa ugqirha elungile'}.\n\nIfayile yakho nesishwankathelo setriage zilungiselelwe ugqirha.`,
          af: `👨‍⚕️ *VERWYSING NA DOKTER*\n\nDie verpleegster het jou na die dokter verwys vir verdere beoordeling.\n\n📋 Rede: ${clinical_reason}\n👤 Dokter: ${assignedDoctor}${assignedSlot ? '\n⏰ Geskatte tyd: *' + assignedSlot + '*' : ''}\n\nWag asseblief — jy sal geroep word${assignedSlot ? ' omtrent ' + assignedSlot : ' wanneer die dokter gereed is'}.\n\nJou lêer en triage-opsomming is vir die dokter voorberei.`,
        };
        const msg = msgs[lang] || msgs.en;
        try { await sendWhatsAppMessage(patient.patient_phone, msg); } catch (e) { /* non-critical */ }
      }

      res.json({
        success: true, doctor_available_today: true, doctor_full_today: false,
        doctor: assignedDoctor, assigned_slot: assignedSlot,
        position: existingCount + 1, capacity: totalCapacity,
      });
      await logAudit(req, 'REFER_TO_DOCTOR', req.params.id, {
        nurse_name, clinical_reason, doctor: assignedDoctor,
        same_day: true, slot: assignedSlot, position: existingCount + 1,
      });

    } else {
      // ── Doctor is NOT here today — find next doctor day ──
      const dayOrder = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'];
      const todayIdx = dayOrder.indexOf(todayDay);
      let nextDoctorDay = null;
      let nextSchedule = null;

      // Search the next 7 days for a scheduled doctor
      for (let offset = 1; offset <= 7; offset++) {
        const checkDay = dayOrder[(todayIdx + offset) % 7];
        const match = (schedule || []).find(s =>
          (s.days || []).map(d => d.toLowerCase()).includes(checkDay)
        );
        if (match) {
          nextDoctorDay = checkDay;
          nextSchedule = match;
          break;
        }
      }

      // Calculate the actual date of the next doctor day
      let nextDate = null;
      let nextDateStr = 'the next available doctor day';
      if (nextDoctorDay) {
        const now = new Date();
        const nextIdx = dayOrder.indexOf(nextDoctorDay);
        const daysUntil = ((nextIdx - todayIdx) + 7) % 7 || 7;
        nextDate = new Date(now.getTime() + daysUntil * 24 * 60 * 60 * 1000);
        nextDateStr = nextDate.toLocaleDateString('en-ZA', {
          weekday: 'long', day: 'numeric', month: 'long',
          timeZone: 'Africa/Johannesburg'
        });
      }

      const assignedDoctor = doctor_name || nextSchedule?.doctor_name || 'the doctor';

      // ── Staggered time slot + capacity check for next doctor day ──
      let assignedSlot = null;
      let nextDayCount = 0;
      const maxElective = (nextSchedule || todaySchedule)?.max_elective_patients || 10;

      if (nextDate) {
        nextDayCount = await countReferralsForDate(patient.facility_name, nextDate.toISOString().slice(0, 10));

        // If next doctor day is also full, search further
        if (nextDayCount >= maxElective) {
          // Try subsequent doctor days
          for (let extraOffset = 2; extraOffset <= 14; extraOffset++) {
            const checkDay = dayOrder[(todayIdx + extraOffset) % 7];
            const match = (schedule || []).find(s =>
              (s.days || []).map(d => d.toLowerCase()).includes(checkDay)
            );
            if (match) {
              const candidateDate = new Date(new Date().getTime() + extraOffset * 24 * 60 * 60 * 1000);
              const candidateCount = await countReferralsForDate(patient.facility_name, candidateDate.toISOString().slice(0, 10));
              const candidateMax = match.max_elective_patients || 10;
              if (candidateCount < candidateMax) {
                nextDate = candidateDate;
                nextDateStr = candidateDate.toLocaleDateString('en-ZA', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'Africa/Johannesburg' });
                nextDayCount = candidateCount;
                nextSchedule = match;
                break;
              }
            }
          }
        }

        // Don't auto-assign — let patient choose
      }

      // Get available slots for patient to choose from
      const availableSlots = nextDate
        ? await getAvailableSlots(patient.facility_name, nextDate.toISOString().slice(0, 10), nextSchedule || todaySchedule)
        : [];

      // Mark patient as needing doctor follow-up
      await supabase.from('clinic_queue').update({
        status: 'completed',
        completed_at: new Date(),
        notes: (patient.notes ? patient.notes + ' | ' : '') +
          `DOCTOR REFERRAL (return visit) by ${nurse_name || 'nurse'}: ${clinical_reason}. Doctor not available today. Next doctor day: ${nextDateStr}. Patient choosing time slot.`,
      }).eq('id', req.params.id);

      // Log the referral — status pending_slot_choice until patient picks
      const { data: referralData } = await supabase.from('doctor_referrals').insert({
        queue_entry_id: patient.id,
        patient_id: patient.patient_id,
        patient_name: patient.patient_name,
        facility_name: patient.facility_name,
        facility_id: patient.facility_id,
        referred_by: nurse_name || 'nurse',
        clinical_reason,
        doctor_name: assignedDoctor,
        status: availableSlots.length > 0 ? 'pending_slot_choice' : 'scheduled',
        referral_date: nextDate ? nextDate.toISOString().slice(0, 10) : null,
        assigned_slot: availableSlots.length > 0 ? null : assignSlot(nextSchedule || todaySchedule, nextDayCount),
        created_at: new Date(),
      }).select().single();

      // Send WhatsApp with slot options for patient to choose
      if (patient.patient_phone) {
        if (availableSlots.length > 1) {
          // Show up to 6 slots to choose from (spread across the session)
          const displaySlots = availableSlots.length <= 6
            ? availableSlots
            : [0, 1, 2, Math.floor(availableSlots.length / 2), availableSlots.length - 2, availableSlots.length - 1]
                .map(i => availableSlots[Math.min(i, availableSlots.length - 1)])
                .filter((v, i, a) => a.indexOf(v) === i); // deduplicate

          const slotList = displaySlots.map((s, i) => `${i + 1} — ${s}`).join('\n');
          const slotChoiceMsg = {
            en: `👨‍⚕️ *DOCTOR APPOINTMENT*\n\nThe nurse has referred you to see the doctor.\n\n📋 Reason: ${clinical_reason}\n📅 Date: *${nextDateStr}*\n👤 Doctor: ${assignedDoctor}\n\nPlease choose a time that works for you:\n\n${slotList}\n\nReply with the number of your preferred time.`,
            zu: `👨‍⚕️ *ISIKHATHI SOKUBONA UDOKOTELA*\n\nUnesi ukudlulisele kudokotela.\n\n📋 Isizathu: ${clinical_reason}\n📅 Usuku: *${nextDateStr}*\n👤 Udokotela: ${assignedDoctor}\n\nSicela ukhethe isikhathi esikufanelayo:\n\n${slotList}\n\nPhendula ngenombolo yesikhathi osithandayo.`,
            xh: `👨‍⚕️ *IDINGA LOKUBONA UGQIRHA*\n\nUmongikazi ukudlulisele kugqirha.\n\n📋 Isizathu: ${clinical_reason}\n📅 Umhla: *${nextDateStr}*\n👤 Ugqirha: ${assignedDoctor}\n\nNceda ukhethe ixesha elikufaneleyo:\n\n${slotList}\n\nPhendula ngenombolo yexesha olithandayo.`,
            af: `👨‍⚕️ *DOKTER AFSPRAAK*\n\nDie verpleegster het jou na die dokter verwys.\n\n📋 Rede: ${clinical_reason}\n📅 Datum: *${nextDateStr}*\n👤 Dokter: ${assignedDoctor}\n\nKies asseblief 'n tyd wat jou pas:\n\n${slotList}\n\nAntwoord met die nommer van jou voorkeur tyd.`,
          };
          try { await sendWhatsAppMessage(patient.patient_phone, slotChoiceMsg[lang] || slotChoiceMsg.en); } catch (e) { /* non-critical */ }

          // Store pending choice in session so the orchestration can handle the response
          if (patient.patient_id) {
            const patSession = await getSession(patient.patient_id);
            patSession.awaitingDoctorSlotChoice = true;
            patSession.doctorSlotReferralId = referralData?.id || null;
            patSession.doctorSlotOptions = displaySlots;
            patSession.doctorSlotDate = nextDateStr;
            patSession.doctorSlotDoctor = assignedDoctor;
            patSession.doctorSlotFacility = patient.facility_name;
            patSession.doctorSlotClinicalReason = clinical_reason;
            await saveSession(patient.patient_id, patSession);
          }
        } else {
          // Only 1 slot or no slots — auto-assign and notify
          const autoSlot = availableSlots[0] || assignSlot(nextSchedule || todaySchedule, nextDayCount);
          if (referralData?.id && autoSlot) {
            await supabase.from('doctor_referrals').update({ assigned_slot: autoSlot, status: 'scheduled' }).eq('id', referralData.id);
          }
          const msgs = {
            en: `👨‍⚕️ *DOCTOR APPOINTMENT*\n\nThe nurse has referred you to see the doctor.\n\n📋 Reason: ${clinical_reason}\n📅 Your appointment: *${nextDateStr}*${autoSlot ? '\n⏰ Time: *' + autoSlot + '*' : ''}\n👤 Doctor: ${assignedDoctor}\n\nPlease come at your assigned time.\n\n⏰ We will send you a reminder the day before.\n\nIf your condition worsens, come to the clinic immediately or call 10177.`,
            zu: `👨‍⚕️ *ISIKHATHI SOKUBONA UDOKOTELA*\n\nUnesi ukudlulisele kudokotela.\n\n📋 Isizathu: ${clinical_reason}\n📅 Isikhathi sakho: *${nextDateStr}*${autoSlot ? '\n⏰ Isikhathi: *' + autoSlot + '*' : ''}\n👤 Udokotela: ${assignedDoctor}\n\nSicela uze ngesikhathi sakho.\n\n⏰ Sizokuthumelela isikhumbuzo.\n\nUma isimo sakho sibhebhetheka, sicela uze emtholampilo noma ushayele i-10177.`,
            xh: `👨‍⚕️ *IDINGA LOKUBONA UGQIRHA*\n\nUmongikazi ukudlulisele kugqirha.\n\n📋 Isizathu: ${clinical_reason}\n📅 Idinga lakho: *${nextDateStr}*${autoSlot ? '\n⏰ Ixesha: *' + autoSlot + '*' : ''}\n👤 Ugqirha: ${assignedDoctor}\n\nNceda uze ngexesha lakho.\n\n⏰ Siza kukuthumela isikhumbuzo.\n\nUkuba imeko yakho iya isiba mbi, nceda uze ekliniki okanye utsalele i-10177.`,
            af: `👨‍⚕️ *DOKTER AFSPRAAK*\n\nDie verpleegster het jou na die dokter verwys.\n\n📋 Rede: ${clinical_reason}\n📅 Jou afspraak: *${nextDateStr}*${autoSlot ? '\n⏰ Tyd: *' + autoSlot + '*' : ''}\n👤 Dokter: ${assignedDoctor}\n\nKom asseblief op jou toegewysde tyd.\n\n⏰ Ons sal jou herinner.\n\nAs jou toestand versleg, kom na die kliniek of bel 10177.`,
          };
          try { await sendWhatsAppMessage(patient.patient_phone, msgs[lang] || msgs.en); } catch (e) { /* non-critical */ }
        }
      }

      // Schedule a reminder follow-up for the day before
      if (nextDate && patient.patient_id) {
        const reminderTime = new Date(nextDate.getTime() - 18 * 60 * 60 * 1000); // 6am day before
        try {
          await supabase.from('follow_ups').insert({
            patient_id: patient.patient_id,
            type: 'doctor_appointment_reminder', phone: patient.patient_phone,
            status: 'pending',
            scheduled_at: reminderTime,
            data: JSON.stringify({
              doctor_name: assignedDoctor,
              clinical_reason,
              appointment_date: nextDateStr,
              facility_name: patient.facility_name,
              referral_id: referralData?.id || null,
            }),
          });
        } catch (e) { /* non-critical */ }
      }

      res.json({
        success: true,
        doctor_available_today: false,
        next_doctor_day: nextDateStr,
        doctor: assignedDoctor,
        reminder_scheduled: !!nextDate,
      });
      await logAudit(req, 'REFER_TO_DOCTOR', req.params.id, {
        nurse_name, clinical_reason, doctor: assignedDoctor,
        same_day: false, next_date: nextDateStr,
      });
    }

  } catch (e) {
    console.error('[DOCTOR-REFERRAL]', e.message);
    res.status(500).json({ error: 'Server error' });
  }
});

// PUT /api/clinic/doctor-break — Doctor taking a break, shift remaining appointments
// Recalculates all remaining slots and notifies affected patients
app.put('/api/clinic/doctor-break', requireDashboardAuth, async (req, res) => {
  try {
    const { duration_minutes, reason, doctor_name } = req.body;
    if (!duration_minutes) return res.status(400).json({ error: 'duration_minutes required' });

    const breakMins = parseInt(duration_minutes);
    if (breakMins < 5 || breakMins > 120) return res.status(400).json({ error: 'Break must be 5-120 minutes' });

    const today = new Date().toISOString().slice(0, 10);
    const nowTime = new Date().toLocaleTimeString('en-ZA', { hour: '2-digit', minute: '2-digit', timeZone: 'Africa/Johannesburg' });
    const docName = doctor_name || req.user?.display_name || 'Doctor';

    // Get all remaining referrals for today that haven't been seen yet
    let query = supabase
      .from('doctor_referrals')
      .select('id, patient_id, patient_name, assigned_slot, status')
      .eq('referral_date', today)
      .in('status', ['scheduled', 'confirmed', 'waiting', 'pending_slot_choice']);

    query = facilityFilter(req, query);
    const { data: referrals, error } = await query;
    if (error) throw error;

    // Filter to only future slots (slots after current time)
    const affectedReferrals = (referrals || []).filter(r => {
      if (!r.assigned_slot) return false;
      return r.assigned_slot >= nowTime;
    });

    if (affectedReferrals.length === 0) {
      return res.json({ success: true, affected: 0, message: 'No remaining appointments to shift' });
    }

    // ── Calculate buffer: how far ahead of schedule is the doctor? ──
    // If doctor sees patients faster than 20-min slots, buffer accumulates.
    // Buffer absorbs some or all of the break — no need to shift by full duration.
    let bufferMinutes = 0;
    try {
      // Get completed referrals from today to calculate actual pace
      const { data: completed } = await supabase
        .from('doctor_referrals')
        .select('assigned_slot, completed_at')
        .eq('referral_date', today)
        .eq('status', 'completed')
        .not('assigned_slot', 'is', null)
        .not('completed_at', 'is', null);

      if (completed && completed.length > 0) {
        // Find the most recently completed patient
        const lastCompleted = completed.sort((a, b) =>
          new Date(b.completed_at) - new Date(a.completed_at)
        )[0];

        // What time was the last patient scheduled?
        const [schH, schM] = lastCompleted.assigned_slot.split(':').map(Number);
        const scheduledMinutes = schH * 60 + schM;

        // What time did the doctor actually finish?
        const completedTime = new Date(lastCompleted.completed_at);
        const completedSAST = new Date(completedTime.getTime() + (2 * 60 * 60 * 1000));
        const actualMinutes = completedSAST.getUTCHours() * 60 + completedSAST.getUTCMinutes();

        // Next patient's scheduled slot
        const nextSlot = affectedReferrals
          .map(r => { const [h, m] = r.assigned_slot.split(':').map(Number); return h * 60 + m; })
          .sort((a, b) => a - b)[0];

        if (nextSlot) {
          // Buffer = how many minutes until the next scheduled slot, minus how long ago the doctor finished
          const nowSAST = new Date(Date.now() + (2 * 60 * 60 * 1000));
          const nowMinutes = nowSAST.getUTCHours() * 60 + nowSAST.getUTCMinutes();
          bufferMinutes = Math.max(0, nextSlot - nowMinutes);
        }
      }
    } catch (e) {
      logger.error('[DOCTOR-BREAK] Buffer calculation failed, using full break duration:', e.message);
    }

    // Effective shift = break minus buffer (doctor's ahead-of-schedule time absorbs part of the break)
    const effectiveShift = Math.max(0, breakMins - bufferMinutes);

    if (effectiveShift === 0) {
      // Buffer fully absorbs the break — no shift needed
      logger.info(`[DOCTOR-BREAK] ${breakMins}min break fully absorbed by ${bufferMinutes}min buffer. No slots shifted.`);
      return res.json({
        success: true, affected: 0, break_duration: breakMins,
        buffer_minutes: bufferMinutes, effective_shift: 0,
        message: `Doctor is ${bufferMinutes} minutes ahead of schedule. The ${breakMins}-minute break is fully absorbed — no appointments need to shift.`,
      });
    }

    // Shift each slot by effective duration (not full break)
    const notifications = [];
    for (const ref of affectedReferrals) {
      const [h, m] = ref.assigned_slot.split(':').map(Number);
      const oldMinutes = h * 60 + m;
      const newMinutes = oldMinutes + effectiveShift;
      const newH = String(Math.floor(newMinutes / 60)).padStart(2, '0');
      const newM = String(newMinutes % 60).padStart(2, '0');
      const newSlot = `${newH}:${newM}`;

      // Update the slot
      await supabase.from('doctor_referrals')
        .update({ assigned_slot: newSlot })
        .eq('id', ref.id);

      notifications.push({
        referral_id: ref.id,
        patient_id: ref.patient_id,
        patient_name: ref.patient_name,
        old_slot: ref.assigned_slot,
        new_slot: newSlot,
      });
    }

    // Notify affected patients via WhatsApp
    for (const n of notifications) {
      try {
        // Get patient phone from queue or session
        const { data: queueEntry } = await supabase
          .from('clinic_queue')
          .select('patient_phone')
          .eq('patient_id', n.patient_id)
          .order('checked_in_at', { ascending: false })
          .limit(1)
          .single();

        if (queueEntry?.patient_phone) {
          const { data: sessionData } = await supabase.from('sessions').select('data').eq('patient_id', n.patient_id).single();
          const lang = sessionData?.data?.language || 'en';

          const shiftMsg = {
            en: `⏰ *Appointment Time Update*\n\nYour doctor appointment has been moved from *${n.old_slot}* to *${n.new_slot}* due to a short break.\n\nPlease arrive at your new time. We apologise for the inconvenience.`,
            zu: `⏰ *Ushintsho Lwesikhathi*\n\nIsikhathi sakho sikadokotela sishintshwe kusuka ngo-*${n.old_slot}* kuya ku-*${n.new_slot}* ngenxa yekhefu elifushane.\n\nSicela ufike ngesikhathi esisha. Siyaxolisa ngokuphazamisa.`,
            xh: `⏰ *Utshintsho Lwexesha*\n\nIdinga lakho logqirha lisuswe ukusuka ngo-*${n.old_slot}* ukuya ku-*${n.new_slot}* ngenxa yekhefu elifutshane.\n\nNceda ufike ngexesha elitsha. Siyaxolisa ngokuphazamisa.`,
            af: `⏰ *Tyd Opdatering*\n\nJou dokterafspraak is verskuif van *${n.old_slot}* na *${n.new_slot}* weens 'n kort pouse.\n\nKom asseblief op jou nuwe tyd. Ons vra om verskoning vir die ongerief.`,
          };
          await sendWhatsAppMessage(queueEntry.patient_phone, shiftMsg[lang] || shiftMsg['en']);
        }
      } catch (e) {
        logger.error('[DOCTOR-BREAK] Failed to notify patient:', e.message);
      }
    }

    await logAudit(req, 'DOCTOR_BREAK', null, {
      doctor: docName, duration_minutes: breakMins, reason,
      buffer_minutes: bufferMinutes, effective_shift: effectiveShift,
      affected_patients: notifications.length,
      shifts: notifications.map(n => `${n.old_slot}→${n.new_slot}`),
    });

    logger.info(`[DOCTOR-BREAK] ${docName} taking ${breakMins}min break (buffer: ${bufferMinutes}min, effective shift: ${effectiveShift}min). ${notifications.length} appointments shifted.`);

    res.json({
      success: true,
      affected: notifications.length,
      break_duration: breakMins,
      buffer_minutes: bufferMinutes,
      effective_shift: effectiveShift,
      shifts: notifications.map(n => ({
        patient: n.patient_name,
        old_slot: n.old_slot,
        new_slot: n.new_slot,
      })),
    });
  } catch (e) {
    logger.error('[DOCTOR-BREAK] Error:', e.message);
    res.status(500).json({ error: 'Server error' });
  }
});

// GET /api/clinic/doctor-queue — Doctor's view of referred patients
app.get('/api/clinic/doctor-queue', requireDashboardAuth, async (req, res) => {
  try {
    const today = new Date().toISOString().slice(0, 10);

    // Get today's doctor referrals for this facility
    let query = supabase
      .from('doctor_referrals')
      .select('*')
      .eq('referral_date', today)
      .in('status', ['waiting', 'scheduled', 'in_progress'])
      .order('created_at', { ascending: true });

    query = facilityFilter(req, query);
    const { data: referrals, error } = await query;
    if (error) throw error;

    // Also get patients currently in doctor queue from clinic_queue
    let queueQuery = supabase
      .from('clinic_queue')
      .select('*')
      .eq('status', 'waiting_for_doctor')
      .order('checked_in_at', { ascending: true });

    queueQuery = facilityFilter(req, queueQuery);
    const { data: queuePatients } = await queueQuery;

    res.json({
      referrals: referrals || [],
      queue: queuePatients || [],
      total: (referrals || []).length + (queuePatients || []).length,
    });
  } catch (e) {
    logger.error('[DOCTOR-QUEUE] Error:', e.message);
    res.status(500).json({ error: e.message });
  }
});

// PUT /api/clinic/doctor-referral/:id/complete — Doctor completes referral
app.put('/api/clinic/doctor-referral/:id/complete', requireDashboardAuth, async (req, res) => {
  try {
    const { doctor_name, doctor_notes, outcome } = req.body;

    // Update referral status
    const { data: referral, error } = await supabase
      .from('doctor_referrals')
      .update({
        status: 'completed',
        doctor_notes: doctor_notes || '',
        outcome: outcome || 'assessed',
        completed_at: new Date(),
      })
      .eq('id', req.params.id)
      .select()
      .single();

    if (error) throw error;

    // If patient is still in clinic_queue as waiting_for_doctor, update
    if (referral?.queue_entry_id) {
      await supabase.from('clinic_queue').update({
        status: 'completed',
        completed_at: new Date(),
        notes: (referral.notes || '') + ` | DOCTOR SEEN by ${doctor_name || 'doctor'}: ${doctor_notes || 'Assessment complete'}. Outcome: ${outcome || 'assessed'}.`,
      }).eq('id', referral.queue_entry_id);
    }

    res.json({ success: true });
    await logAudit(req, 'DOCTOR_COMPLETE', req.params.id, { doctor_name, outcome });
  } catch (e) {
    res.status(500).json({ error: 'Server error' });
  }
});

// GET /api/clinic/nurse-view — Next patients per queue + priority alerts
app.get('/api/clinic/nurse-view', requireDashboardAuth, async (req, res) => {
  try {
    let waitingQuery = supabase
      .from('clinic_queue')
      .select('*')
      .eq('status', 'waiting')
      .order('position', { ascending: true });
    waitingQuery = facilityFilter(req, waitingQuery);
    const { data: waiting, error } = await waitingQuery;

    const fastTrack = (waiting || []).filter(p => p.queue_type === 'emergency' || p.queue_type === 'acute' || p.queue_type === 'fast_track');
    const routine = (waiting || []).filter(p => p.queue_type === 'general' || p.queue_type === 'routine');
    const maternal = (waiting || []).filter(p => p.queue_type === 'maternal' || p.queue_type === 'child');
    const chronic = (waiting || []).filter(p => p.queue_type === 'chronic');
    const pharmacy = (waiting || []).filter(p => p.queue_type === 'pharmacy');
    const walkIn = (waiting || []).filter(p => p.queue_type === 'walk_in' || p.queue_type === 'preventative');

    const now = Date.now();
    const alerts = (waiting || []).filter(p => {
      const waitMin = (now - new Date(p.checked_in_at).getTime()) / 60000;
      return (
        (p.triage_level === 'RED' && waitMin > 5) ||
        (p.triage_level === 'ORANGE' && waitMin > 15) ||
        (p.triage_level === 'YELLOW' && waitMin > 60)
      );
    }).map(p => ({
      ...p,
      wait_minutes: Math.round((now - new Date(p.checked_in_at).getTime()) / 60000),
      alert_reason: p.triage_level === 'RED' ? 'RED patient waiting > 5 min'
        : p.triage_level === 'ORANGE' ? 'ORANGE patient waiting > 15 min'
        : 'YELLOW patient waiting > 60 min',
    }));

    // Reassessment alerts (DoH requirement)
    const reassessAlerts = (waiting || []).filter(p => {
      const waitMin = (now - new Date(p.checked_in_at).getTime()) / 60000;
      return (
        (p.triage_level === 'ORANGE' && waitMin > 15 && Math.floor(waitMin) % 15 < 2) ||
        (p.triage_level === 'YELLOW' && waitMin > 60 && Math.floor(waitMin) % 60 < 2)
      );
    }).map(p => ({
      ...p,
      wait_minutes: Math.round((now - new Date(p.checked_in_at).getTime()) / 60000),
      alert_reason: p.triage_level === 'ORANGE' ? 'REASSESS: ORANGE patient (every 15 min)' : 'REASSESS: YELLOW patient (every 60 min)',
    }));

    res.json({
      fast_track: fastTrack.slice(0, 10),
      routine: routine.slice(0, 10),
      maternal: maternal.slice(0, 10),
      chronic: chronic.slice(0, 10),
      pharmacy: pharmacy.slice(0, 10),
      walk_in: walkIn.slice(0, 10),
      alerts: [...alerts, ...reassessAlerts],
    });
  } catch (e) {
    res.status(500).json({ error: 'Server error' });
  }
});

// ================== KIOSK — Self-service clinic entrance device ==================
// Serves a touch-friendly web app for patients without WhatsApp.
// Same triage logic, feeds into the same clinic_queue and dashboard.

app.get('/kiosk', (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'public', 'kiosk.html'));
});

// POST /api/kiosk/verify-pin — Verify facility PIN before kiosk access
app.post('/api/kiosk/verify-pin', (req, res) => {
  const kioskPin = process.env.KIOSK_PIN;
  if (!kioskPin) {
    // No PIN configured — allow access (dev/setup mode)
    return res.json({ success: true, requiresPin: false });
  }
  const { pin } = req.body;
  if (!pin || pin !== kioskPin) {
    return res.status(401).json({ error: 'Incorrect PIN' });
  }
  res.json({ success: true, requiresPin: true });
});

// GET /api/kiosk/requires-pin — Check if PIN is configured
app.get('/api/kiosk/requires-pin', (req, res) => {
  res.json({ requiresPin: !!process.env.KIOSK_PIN });
});

// POST /api/kiosk/check-in — Patient who triaged via WhatsApp confirms arrival at kiosk
// Bypasses reception queue — patient enters BZ code, system marks them as arrived
app.post('/api/kiosk/check-in', async (req, res) => {
  try {
    // Verify kiosk PIN if configured
    const kioskPin = process.env.KIOSK_PIN;
    if (kioskPin) {
      const providedPin = req.headers['x-kiosk-pin'];
      if (!providedPin || providedPin !== kioskPin) {
        return res.status(401).json({ error: 'Kiosk not authorized' });
      }
    }

    const { study_code } = req.body;
    if (!study_code) return res.status(400).json({ error: 'BZ code required' });

    // Look up the patient by study code
    const { data: codeEntry } = await supabase
      .from('study_codes')
      .select('patient_id')
      .eq('study_code', study_code.toUpperCase().trim())
      .limit(1)
      .single();

    if (!codeEntry) {
      return res.status(404).json({ success: false, error: 'Code not found. Please check your BZ code or ask reception.' });
    }

    const patientId = codeEntry.patient_id;

    // Find their queue entry (today, waiting status)
    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);

    const { data: queueEntry } = await supabase
      .from('clinic_queue')
      .select('id, patient_name, queue_type, position, notes, status')
      .eq('patient_id', patientId)
      .gte('checked_in_at', todayStart.toISOString())
      .in('status', ['waiting', 'in_consultation'])
      .order('checked_in_at', { ascending: false })
      .limit(1)
      .single();

    if (!queueEntry) {
      // No queue entry today — they may have triaged but not been added to queue yet,
      // or they're from a previous day
      return res.status(404).json({ success: false, error: 'No queue entry found for today. You may need to check in with reception.' });
    }

    // Mark as arrived (same as reception button and WhatsApp "arrived" command)
    if (!(queueEntry.notes || '').includes('ARRIVED')) {
      const arrivedAt = new Date().toLocaleTimeString('en-ZA', { hour: '2-digit', minute: '2-digit' });
      await supabase.from('clinic_queue').update({
        notes: ((queueEntry.notes || '') + ' | ARRIVED at ' + arrivedAt + ' — confirmed via kiosk').trim(),
      }).eq('id', queueEntry.id);
    }

    logger.info(`[KIOSK-CHECKIN] Patient ${patientId} checked in via kiosk with code ${study_code}`);

    res.json({
      success: true,
      patient_name: queueEntry.patient_name,
      queue_type: queueEntry.queue_type,
      position: queueEntry.position,
    });
  } catch (e) {
    logger.error('[KIOSK-CHECKIN] Error:', e.message);
    res.status(500).json({ error: 'Server error' });
  }
});

// POST /api/kiosk/triage — Process kiosk check-in
// Takes patient details + symptoms, runs triage, creates queue entry
// Rate limited: 10 triages per IP per hour (prevents queue flooding)
const _kioskRateLimit = new Map();
app.post('/api/kiosk/triage', async (req, res) => {
  try {
    // Verify kiosk PIN if configured
    const kioskPin = process.env.KIOSK_PIN;
    if (kioskPin) {
      const providedPin = req.headers['x-kiosk-pin'];
      if (!providedPin || providedPin !== kioskPin) {
        return res.status(401).json({ error: 'Kiosk not authorized. Enter facility PIN.' });
      }
    }

    // Rate limit per IP
    const ip = req.headers['x-forwarded-for'] || req.socket.remoteAddress || 'unknown';
    const now = Date.now();
    const entry = _kioskRateLimit.get(ip) || { count: 0, windowStart: now };
    if (now - entry.windowStart > 60 * 60 * 1000) { entry.count = 0; entry.windowStart = now; }
    entry.count++;
    _kioskRateLimit.set(ip, entry);
    if (entry.count > 10) {
      return res.status(429).json({ error: 'Too many check-ins. Please wait or ask reception for help.' });
    }

    let { firstName, surname, dob, sex, category, categoryName, severity, symptoms, language, facility_name,
          phone, imciDangerSigns, ancPathway, chronicPathway } = req.body;

    // Sanitize text inputs — strip HTML tags to prevent stored XSS
    const stripTags = (s) => typeof s === 'string' ? s.replace(/<[^>]*>/g, '') : s;
    firstName = stripTags(firstName);
    surname   = stripTags(surname);
    symptoms  = stripTags(symptoms);

    if (!firstName) return res.status(400).json({ error: 'Name required' });

    // Generate a patient ID from name + DOB (kiosk patients don't have phone numbers)
    const kioskId = 'kiosk_' + crypto.createHash('sha256')
      .update((firstName + surname + dob + Date.now()).toLowerCase())
      .digest('hex').slice(0, 16);

    // ── Handle special pathways (IMCI, ANC, Chronic) before triage ──
    // These bypass normal severity → AI triage for specific categories

    // IMCI: child illness with danger signs → immediate RED/ORANGE
    if (category === '7' && imciDangerSigns && imciDangerSigns.length > 0) {
      const isRed = imciDangerSigns.includes('convulsions') || imciDangerSigns.includes('lethargic_unconscious');
      const dangerStr = imciDangerSigns.join(', ');
      severity = isRed ? 'severe' : 'severe';
      symptoms = `IMCI DANGER SIGNS: ${dangerStr}. ${symptoms || ''}`;
    }

    // ANC: routine/supplements → GREEN bypass; emergency → RED
    if (category === '3' && ancPathway) {
      if (ancPathway === 'routine' || ancPathway === 'supplements') {
        // Skip triage — route directly
        const triageLevel = 'GREEN';
        const pathway = ancPathway === 'supplements' ? 'anc_supplements_only' : 'anc_routine';
        const queueType = ancPathway === 'supplements' ? 'pharmacy' : 'maternal';
        const refNum = Math.floor(1000 + Math.random() * 9000);
        const refCode = 'BZ-' + refNum;
        const kioskId = 'kiosk_' + crypto.createHash('sha256').update((firstName + surname + dob + Date.now()).toLowerCase()).digest('hex').slice(0, 16);

        try { await supabase.from('study_codes').insert({ patient_id: kioskId, study_code: refCode, created_at: new Date() }); } catch (e) {}
        await logTriage({ patient_id: kioskId, triage_level: triageLevel, confidence: 95, escalation: false, pathway, facility_name: facility_name || null, symptoms: `${ancPathway} ANC visit` });

        const { data: lastInQueue } = await supabase.from('clinic_queue').select('position').eq('queue_type', queueType).eq('status', 'waiting').order('position', { ascending: false }).limit(1);
        const nextPos = (lastInQueue?.[0]?.position || 0) + 1;
        await supabase.from('clinic_queue').insert({ patient_id: kioskId, patient_name: firstName + (surname ? ' ' + surname : ''), patient_phone: phone || null, triage_level: triageLevel, queue_type: queueType, position: nextPos, status: 'waiting', checked_in_at: new Date(), symptoms_summary: `${ancPathway} ANC visit`, facility_name: facility_name || null, entry_method: 'kiosk' });

        if (phone) { await scheduleFollowUp(kioskId, phone, triageLevel); }

        return res.json({ success: true, triage_level: triageLevel, confidence: 95, ref_code: refCode, queue_position: nextPos, queue_type: queueType });
      }
      if (ancPathway === 'emergency') { severity = 'severe'; symptoms = `Pregnancy emergency: ${symptoms || 'bleeding, severe pain, or baby not moving'}`; }
    }

    // Chronic: stable → GREEN bypass to pharmacy/chronic queue
    if (category === '8' && chronicPathway === 'stable') {
      const triageLevel = 'GREEN';
      const queueType = 'chronic'; // Kiosk can't determine CCMDD status — nurse checks
      const refNum = Math.floor(1000 + Math.random() * 9000);
      const refCode = 'BZ-' + refNum;
      const kioskId = 'kiosk_' + crypto.createHash('sha256').update((firstName + surname + dob + Date.now()).toLowerCase()).digest('hex').slice(0, 16);

      try { await supabase.from('study_codes').insert({ patient_id: kioskId, study_code: refCode, created_at: new Date() }); } catch (e) {}
      await logTriage({ patient_id: kioskId, triage_level: triageLevel, confidence: 95, escalation: false, pathway: 'chronic_bypass_stable_kiosk', facility_name: facility_name || null, symptoms: 'Stable chronic patient — medication collection (kiosk)' });

      const { data: lastInQueue } = await supabase.from('clinic_queue').select('position').eq('queue_type', queueType).eq('status', 'waiting').order('position', { ascending: false }).limit(1);
      const nextPos = (lastInQueue?.[0]?.position || 0) + 1;
      await supabase.from('clinic_queue').insert({ patient_id: kioskId, patient_name: firstName + (surname ? ' ' + surname : ''), patient_phone: phone || null, triage_level: triageLevel, queue_type: queueType, position: nextPos, status: 'waiting', checked_in_at: new Date(), symptoms_summary: 'Stable chronic — medication collection', facility_name: facility_name || null, entry_method: 'kiosk' });

      if (phone) { await scheduleFollowUp(kioskId, phone, triageLevel); }

      return res.json({ success: true, triage_level: triageLevel, confidence: 95, ref_code: refCode, queue_position: nextPos, queue_type: queueType });
    }

    // Build symptom text for triage
    const severityLabels = { mild: 'MILD', moderate: 'MODERATE', severe: 'SEVERE' };
    const symptomText = `Category: ${categoryName || category}. Severity: ${severityLabels[severity] || 'UNKNOWN'}. ${symptoms ? 'Patient says: ' + symptoms : ''}`;

    // Run triage via Claude API
    let triageLevel = 'YELLOW';
    let confidence = 75;
    try {
      const triageResult = await callTriageAI(symptomText, {
        age: dob ? calculateAge(dob) : null,
        sex,
        chronicConditions: [],
        language: language || 'en',
      });
      triageLevel = triageResult.triage_level || 'YELLOW';
      confidence = triageResult.confidence || 75;
    } catch (e) {
      logger.error('[KIOSK] AI triage failed, using severity fallback:', e.message);
      // Fallback: map severity to triage level
      triageLevel = severity === 'severe' ? 'ORANGE' : severity === 'moderate' ? 'YELLOW' : 'GREEN';
      confidence = 60;
    }

    // Deterministic overrides
    const redResult = deterministicRedClassifier(symptomText);
    if (redResult.isRed) {
      triageLevel = 'RED';
      confidence = 100;
    }

    // Generate reference code
    const refNum = Math.floor(1000 + Math.random() * 9000);
    const refCode = 'BZ-' + refNum;

    // Store study code
    try {
      await supabase.from('study_codes').insert({
        patient_id: kioskId,
        study_code: refCode,
        created_at: new Date()
      });
    } catch (e) { /* ignore duplicate */ }

    // Log triage
    await logTriage({
      patient_id: kioskId,
      triage_level: triageLevel,
      confidence,
      escalation: false,
      pathway: 'kiosk',
      facility_name: facility_name || null,
      symptoms: symptomText,
    });

    // Add to clinic queue — use DoH-aligned streaming
    const queueType = triageToQueueType(triageLevel, category);

    const { data: lastInQueue } = await supabase
      .from('clinic_queue')
      .select('position')
      .eq('queue_type', queueType)
      .order('position', { ascending: false })
      .limit(1);
    const nextPos = (lastInQueue?.[0]?.position || 0) + 1;

    const { data: queueEntry, error: queueError } = await supabase.from('clinic_queue').insert({
      patient_id: kioskId,
      patient_name: firstName + (surname ? ' ' + surname : ''),
      patient_phone: phone || null, // Kiosk patients may optionally provide phone for follow-up
      triage_level: triageLevel,
      queue_type: queueType,
      position: nextPos,
      status: 'waiting',
      checked_in_at: new Date(),
      symptoms_summary: symptomText.slice(0, 500),
      facility_name: req.body.facility_name || null,
      entry_method: 'kiosk',
      notes: 'ARRIVED at ' + new Date().toLocaleTimeString('en-ZA', { hour: '2-digit', minute: '2-digit' }) + ' — kiosk (patient is physically present)',
    }).select().single();

    // If insert failed, try without optional columns (source/study_code may not exist yet)
    if (queueError) {
      logger.error('[KIOSK] Queue insert error (trying minimal):', queueError.message);
      await supabase.from('clinic_queue').insert({
        patient_id: kioskId,
        patient_name: firstName + (surname ? ' ' + surname : ''),
        triage_level: triageLevel,
        queue_type: queueType,
        position: nextPos,
        status: 'waiting',
        checked_in_at: new Date(),
        symptoms_summary: symptomText.slice(0, 500),
        facility_name: req.body.facility_name || null,
      });
    }

    // Schedule follow-ups if phone provided (equity with WhatsApp patients)
    if (phone) {
      try {
        await scheduleFollowUp(kioskId, phone, triageLevel);
      } catch (fuErr) { logger.error('[KIOSK] Follow-up scheduling error:', fuErr.message); }
    }

    logger.info(`[KIOSK] ${firstName} ${surname || ''} → ${triageLevel} (${confidence}%) → Queue #${nextPos} (${queueType}) → ${refCode}${phone ? ' [phone provided]' : ''}`);

    res.json({
      success: true,
      triage_level: triageLevel,
      confidence,
      ref_code: refCode,
      queue_position: nextPos,
      queue_type: queueType,
    });
  } catch (e) {
    logger.error('[KIOSK] Error:', e.message);
    res.status(500).json({ error: 'Server error' });
  }
});

// Helper: Calculate age from DOB string (DD-MM-YYYY)
function calculateAge(dobStr) {
  if (!dobStr) return null;
  const parts = dobStr.split(/[-/]/);
  if (parts.length !== 3) return null;
  const d = parseInt(parts[0]), m = parseInt(parts[1]) - 1, y = parseInt(parts[2]);
  const birth = new Date(y, m, d);
  const now = new Date();
  let age = now.getFullYear() - birth.getFullYear();
  if (now.getMonth() < m || (now.getMonth() === m && now.getDate() < d)) age--;
  return age > 0 && age < 150 ? age : null;
}

// Helper: Call triage AI (reuses existing orchestration logic)
async function callTriageAI(symptoms, context) {
  const systemPrompt = `You are BIZUSIZO, a South African PHC triage assistant using SATS.
Patient context: age ${context.age || 'unknown'}, sex ${context.sex || 'unknown'}, conditions: ${(context.chronicConditions || []).join(', ') || 'none'}.

DETERMINISTIC RED rules — return RED immediately if any present:
- Chest pain + breathing difficulty, or chest tightness + arm/jaw pain
- Not breathing / baby not breathing / limp and not moving
- Unresponsive / unconscious / not waking up
- Snake bite
- Active seizure / fitting
- Heavy bleeding in pregnancy
- Severe burns (boiling water, significant body area)

ORANGE: febrile seizure, stroke symptoms, thunderclap headache, open fracture (bone visible), pre-eclampsia, head trauma with loss of consciousness, acute confusion with DM/HTN, major burns
YELLOW: TB symptoms (3+ week cough + night sweats + weight loss), UTI + back pain, high sugar 15+ with symptoms, severe right-sided abdo pain, asthma not responding to inhaler, fever + stiff neck in HIV+, possible fracture, BP 170+ with headache, lower abdo pain + missed period, travel fever, deep laceration
GREEN: URTI, medication collection, mild rash, routine chronic review, mild headache, mechanical back pain

- If severity is MILD and no life-threatening indicators: GREEN or YELLOW — NEVER RED.
- If severity is MODERATE: YELLOW or ORANGE — only RED if clear emergency indicators present.
- If severity is SEVERE: ORANGE or RED.
- When uncertain, escalate to a HIGHER triage level.

Return ONLY valid JSON, no markdown: {"triage_level":"RED|ORANGE|YELLOW|GREEN","confidence":0-100,"reasoning":"brief"}`;

  const response = await anthropic.messages.create({
    model: 'claude-sonnet-4-20250514',
    max_tokens: 200,
    system: systemPrompt,
    messages: [{ role: 'user', content: symptoms }],
  });

  const text = response.content[0]?.text || '';
  try {
    const parsed = JSON.parse(text.replace(/```json|```/g, '').trim());
    return parsed;
  } catch (e) {
    // Secondary JSON parse failure — extract level from text if possible
    // Use confidence 40 so the clarification flow triggers, never the emergency path
    if (text.includes('RED')) return { triage_level: 'RED', confidence: 100 };
    if (text.includes('ORANGE')) return { triage_level: 'ORANGE', confidence: 40 };
    if (text.includes('YELLOW')) return { triage_level: 'YELLOW', confidence: 40 };
    return { triage_level: 'YELLOW', confidence: 40 };
  }
}

}; // end registerQueueRoutes
