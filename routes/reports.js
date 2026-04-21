'use strict';
// Pure DB report endpoints — no session state, no WhatsApp
// All routes scoped by facilityFilter based on logged-in user's role
const logger = require('../logger');

module.exports = function registerReportRoutes(app, { supabase, requireDashboardAuth, facilityFilter }) {

  // GET /api/reports/concordance
  // Primary EVAH outcome: AI triage vs nurse triage per patient.
  // Joins triage_logs (AI result) with clinic_queue (nurse feedback).
  app.get('/api/reports/concordance', requireDashboardAuth, async (req, res) => {
    try {
      const { start, end } = req.query;
      let triageQ = supabase
        .from('triage_logs')
        .select('created_at,patient_id,triage_level,confidence,pathway,facility_name,symptoms')
        .order('created_at', { ascending: false })
        .limit(2000);
      if (start) triageQ = triageQ.gte('created_at', new Date(start).toISOString());
      if (end) { const e = new Date(end); e.setDate(e.getDate() + 1); triageQ = triageQ.lt('created_at', e.toISOString()); }
      triageQ = facilityFilter(req, triageQ, 'facility_name');
      const { data: triages, error: te } = await triageQ;
      if (te) throw te;

      let queueQ = supabase.from('clinic_queue').select('patient_id,triage_level,notes,queue_type').not('notes', 'is', null);
      queueQ = facilityFilter(req, queueQ, 'facility_name');
      const { data: queue } = await queueQ;

      const feedbackMap = {};
      (queue || []).forEach(q => {
        const noteMatch = (q.notes || '').match(/Nurse (\w+): (agree|disagree)(?:\s*→\s*(\w+))?/i);
        if (noteMatch) {
          feedbackMap[q.patient_id] = {
            verdict: noteMatch[2].toLowerCase(),
            nurse_triage_level: noteMatch[3] || q.triage_level || null,
          };
        }
      });

      const records = (triages || []).map(t => ({
        created_at:    t.created_at,
        patient_id:    t.patient_id,
        facility_name: t.facility_name,
        ai_triage:     t.triage_level,
        ai_confidence: t.confidence,
        nurse_triage:  feedbackMap[t.patient_id]?.nurse_triage_level || null,
        verdict:       feedbackMap[t.patient_id]?.verdict || null,
        category:      t.pathway,
        symptoms:      t.symptoms,
      }));

      res.json({ records, period: { start, end } });
    } catch (e) { res.status(500).json({ error: 'Server error' }); }
  });

  // GET /api/reports/consent-log
  // POPIA audit: every consent event with timestamp.
  app.get('/api/reports/consent-log', requireDashboardAuth, async (req, res) => {
    try {
      const { start, end } = req.query;
      let q = supabase.from('consent_log').select('*').order('logged_at', { ascending: false }).limit(5000);
      if (start) q = q.gte('logged_at', new Date(start).toISOString());
      if (end) { const e = new Date(end); e.setDate(e.getDate() + 1); q = q.lt('logged_at', e.toISOString()); }
      const { data, error } = await q;
      if (error) throw error;
      res.json({ records: data || [], period: { start, end } });
    } catch (e) { res.status(500).json({ error: 'Server error' }); }
  });

  // GET /api/reports/referrals
  // All hospital escalations with transport method.
  app.get('/api/reports/referrals', requireDashboardAuth, async (req, res) => {
    try {
      const { start, end } = req.query;
      let q = supabase.from('referrals').select('*').order('created_at', { ascending: false }).limit(1000);
      if (start) q = q.gte('created_at', new Date(start).toISOString());
      if (end) { const e = new Date(end); e.setDate(e.getDate() + 1); q = q.lt('created_at', e.toISOString()); }
      q = facilityFilter(req, q, 'originating_facility_name');
      const { data, error } = await q;
      if (error) throw error;
      res.json({ records: data || [], period: { start, end } });
    } catch (e) { res.status(500).json({ error: 'Server error' }); }
  });

  // GET /api/reports/passport-views — All health passport view events
  app.get('/api/reports/passport-views', requireDashboardAuth, async (req, res) => {
    try {
      const { start, end } = req.query;
      let q = supabase.from('passport_views').select('*').order('viewed_at', { ascending: false }).limit(1000);
      if (start) q = q.gte('viewed_at', new Date(start).toISOString());
      if (end) { const e = new Date(end); e.setDate(e.getDate() + 1); q = q.lt('viewed_at', e.toISOString()); }
      const { data, error } = await q;
      if (error) throw error;

      // Also fetch feedback for the same period
      let fq = supabase.from('passport_feedback').select('*').order('created_at', { ascending: false }).limit(500);
      if (start) fq = fq.gte('created_at', new Date(start).toISOString());
      if (end) { const e2 = new Date(end); e2.setDate(e2.getDate() + 1); fq = fq.lt('created_at', e2.toISOString()); }
      const { data: feedback } = await fq;

      res.json({ records: data || [], feedback: feedback || [], period: { start, end } });
    } catch (e) { res.status(500).json({ error: 'Server error' }); }
  });

};
