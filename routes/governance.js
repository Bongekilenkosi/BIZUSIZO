'use strict';
const logger = require('../logger');

module.exports = function registerGovernanceRoutes(app, { supabase, requireDashboardAuth, facilityFilter, governance, outbreak }) {

const { runOutbreakSurveillanceAgent, OUTBREAK_SYNDROMES } = outbreak;

// GOVERNANCE DASHBOARD — API ENDPOINTS
// ================================================================

// GET /api/governance/status — Full governance status across all pillars
app.get('/api/governance/status', requireDashboardAuth, async (req, res) => {
  try {
    const status = await governance.getGovernanceStatus();
    res.json(status);
  } catch (e) {
    res.status(500).json({ error: 'Server error' });
  }
});

// GET /api/governance/drift — Run drift detection on demand
app.get('/api/governance/drift', requireDashboardAuth, async (req, res) => {
  try {
    const result = await governance.clinicalPerformance.runDriftDetection();
    res.json(result);
  } catch (e) {
    res.status(500).json({ error: 'Server error' });
  }
});

// GET /api/governance/subgroup-performance — Disaggregated performance by language, facility, triage level
// Yegon principle: "Disaggregated performance is mandatory — subgroup analysis matters more than averages"
app.get('/api/governance/subgroup-performance', requireDashboardAuth, async (req, res) => {
  try {
    const days = parseInt(req.query.days) || 30;
    const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();

    // Fetch triage logs with language info from sessions
    const [triageRes, feedbackRes, outcomeRes] = await Promise.all([
      supabase.from('triage_logs')
        .select('patient_id, triage_level, confidence, language, facility_name, rule_override, created_at')
        .gte('created_at', since),
      supabase.from('triage_feedback')
        .select('patient_id, verdict, ai_triage_level, nurse_triage_level, direction, facility_name, created_at')
        .gte('created_at', since),
      supabase.from('follow_up_outcomes')
        .select('patient_id, triage_level, symptom_outcome, visited_clinic, access_failure, facility_name')
        .gte('response_received_at', since),
    ]);

    const triages = triageRes.data || [];
    const feedback = feedbackRes.data || [];
    const outcomes = outcomeRes.data || [];

    // ── BY LANGUAGE ────────────────────────────────────────
    const langMap = {};
    for (const t of triages) {
      const lang = t.language || 'unknown';
      if (!langMap[lang]) langMap[lang] = { total: 0, levels: {}, avg_confidence: [], rule_overrides: 0 };
      langMap[lang].total++;
      langMap[lang].levels[t.triage_level] = (langMap[lang].levels[t.triage_level] || 0) + 1;
      if (t.confidence) langMap[lang].avg_confidence.push(t.confidence);
      if (t.rule_override) langMap[lang].rule_overrides++;
    }
    // Calculate averages and distributions
    const byLanguage = {};
    for (const [lang, data] of Object.entries(langMap)) {
      const avgConf = data.avg_confidence.length > 0
        ? Math.round(data.avg_confidence.reduce((a, b) => a + b, 0) / data.avg_confidence.length * 10) / 10
        : null;
      const dist = {};
      for (const [level, count] of Object.entries(data.levels)) {
        dist[level] = Math.round(count / data.total * 1000) / 10;
      }
      byLanguage[lang] = {
        total_triages: data.total,
        avg_confidence: avgConf,
        distribution_pct: dist,
        rule_override_rate: Math.round(data.rule_overrides / data.total * 1000) / 10,
      };
    }

    // ── FEEDBACK BY LANGUAGE ───────────────────────────────
    // Join feedback to triage language via patient_id
    const patientLangMap = {};
    for (const t of triages) {
      if (t.language) patientLangMap[t.patient_id] = t.language;
    }
    const feedbackByLang = {};
    for (const f of feedback) {
      const lang = patientLangMap[f.patient_id] || 'unknown';
      if (!feedbackByLang[lang]) feedbackByLang[lang] = { total: 0, disagree: 0, upgrades: 0, downgrades: 0 };
      feedbackByLang[lang].total++;
      if (f.verdict === 'disagree') {
        feedbackByLang[lang].disagree++;
        if (f.direction === 'upgrade') feedbackByLang[lang].upgrades++;
        if (f.direction === 'downgrade') feedbackByLang[lang].downgrades++;
      }
    }
    for (const [lang, data] of Object.entries(feedbackByLang)) {
      data.disagree_rate = data.total > 0 ? Math.round(data.disagree / data.total * 1000) / 10 : 0;
    }

    // ── BY FACILITY ────────────────────────────────────────
    const facilityMap = {};
    for (const t of triages) {
      const fac = t.facility_name || 'unknown';
      if (!facilityMap[fac]) facilityMap[fac] = { total: 0, levels: {}, avg_confidence: [] };
      facilityMap[fac].total++;
      facilityMap[fac].levels[t.triage_level] = (facilityMap[fac].levels[t.triage_level] || 0) + 1;
      if (t.confidence) facilityMap[fac].avg_confidence.push(t.confidence);
    }
    const byFacility = {};
    for (const [fac, data] of Object.entries(facilityMap)) {
      byFacility[fac] = {
        total_triages: data.total,
        avg_confidence: data.avg_confidence.length > 0
          ? Math.round(data.avg_confidence.reduce((a, b) => a + b, 0) / data.avg_confidence.length * 10) / 10
          : null,
        distribution_pct: Object.fromEntries(
          Object.entries(data.levels).map(([l, c]) => [l, Math.round(c / data.total * 1000) / 10])
        ),
      };
    }

    // Feedback by facility
    const feedbackByFacility = {};
    for (const f of feedback) {
      const fac = f.facility_name || 'unknown';
      if (!feedbackByFacility[fac]) feedbackByFacility[fac] = { total: 0, disagree: 0 };
      feedbackByFacility[fac].total++;
      if (f.verdict === 'disagree') feedbackByFacility[fac].disagree++;
    }
    for (const [fac, data] of Object.entries(feedbackByFacility)) {
      data.disagree_rate = data.total > 0 ? Math.round(data.disagree / data.total * 1000) / 10 : 0;
    }

    // ── OUTCOME DISPARITIES ────────────────────────────────
    const outcomeByLevel = {};
    for (const o of outcomes) {
      const level = o.triage_level || 'unknown';
      if (!outcomeByLevel[level]) outcomeByLevel[level] = { total: 0, better: 0, same: 0, worse: 0, access_failures: 0 };
      outcomeByLevel[level].total++;
      if (o.symptom_outcome === 'better') outcomeByLevel[level].better++;
      if (o.symptom_outcome === 'same') outcomeByLevel[level].same++;
      if (o.symptom_outcome === 'worse') outcomeByLevel[level].worse++;
      if (o.access_failure) outcomeByLevel[level].access_failures++;
    }

    // ── BY AGE GROUP + SEX ──────────────────────────────────
    // Fetch sessions for unique patient IDs to get age/sex demographics
    const uniquePatientIds = [...new Set(triages.map(t => t.patient_id))];
    const patientDemographics = {};
    // Batch in chunks of 100 to avoid query limits
    for (let i = 0; i < uniquePatientIds.length; i += 100) {
      const batch = uniquePatientIds.slice(i, i + 100);
      const { data: sessions } = await supabase
        .from('sessions')
        .select('patient_id, data')
        .in('patient_id', batch);
      for (const s of (sessions || [])) {
        const d = s.data || {};
        patientDemographics[s.patient_id] = {
          age: d.dob?.age ?? d.patientAge ?? null,
          sex: d.sex || null,
        };
      }
    }

    // Age bands: paediatric (<12), adolescent (12-17), adult (18-59), elderly (60+)
    const ageBands = { paediatric: [0, 11], adolescent: [12, 17], adult: [18, 59], elderly: [60, 200] };
    function getAgeBand(age) {
      if (age == null) return 'unknown';
      for (const [band, [min, max]] of Object.entries(ageBands)) {
        if (age >= min && age <= max) return band;
      }
      return 'unknown';
    }

    const ageGroupMap = {};
    const sexMap = {};
    for (const t of triages) {
      const demo = patientDemographics[t.patient_id] || {};
      const band = getAgeBand(demo.age);
      const sex = demo.sex || 'unknown';

      // Age group aggregation
      if (!ageGroupMap[band]) ageGroupMap[band] = { total: 0, levels: {}, avg_confidence: [], rule_overrides: 0 };
      ageGroupMap[band].total++;
      ageGroupMap[band].levels[t.triage_level] = (ageGroupMap[band].levels[t.triage_level] || 0) + 1;
      if (t.confidence) ageGroupMap[band].avg_confidence.push(t.confidence);
      if (t.rule_override) ageGroupMap[band].rule_overrides++;

      // Sex aggregation
      if (!sexMap[sex]) sexMap[sex] = { total: 0, levels: {}, avg_confidence: [], rule_overrides: 0 };
      sexMap[sex].total++;
      sexMap[sex].levels[t.triage_level] = (sexMap[sex].levels[t.triage_level] || 0) + 1;
      if (t.confidence) sexMap[sex].avg_confidence.push(t.confidence);
      if (t.rule_override) sexMap[sex].rule_overrides++;
    }

    const byAgeGroup = {};
    for (const [band, data] of Object.entries(ageGroupMap)) {
      const avgConf = data.avg_confidence.length > 0
        ? Math.round(data.avg_confidence.reduce((a, b) => a + b, 0) / data.avg_confidence.length * 10) / 10
        : null;
      byAgeGroup[band] = {
        total_triages: data.total,
        avg_confidence: avgConf,
        distribution_pct: Object.fromEntries(
          Object.entries(data.levels).map(([l, c]) => [l, Math.round(c / data.total * 1000) / 10])
        ),
        rule_override_rate: Math.round(data.rule_overrides / data.total * 1000) / 10,
      };
    }

    const bySex = {};
    for (const [sex, data] of Object.entries(sexMap)) {
      const avgConf = data.avg_confidence.length > 0
        ? Math.round(data.avg_confidence.reduce((a, b) => a + b, 0) / data.avg_confidence.length * 10) / 10
        : null;
      bySex[sex] = {
        total_triages: data.total,
        avg_confidence: avgConf,
        distribution_pct: Object.fromEntries(
          Object.entries(data.levels).map(([l, c]) => [l, Math.round(c / data.total * 1000) / 10])
        ),
        rule_override_rate: Math.round(data.rule_overrides / data.total * 1000) / 10,
      };
    }

    // Feedback by age group
    const feedbackByAgeGroup = {};
    for (const f of feedback) {
      const demo = patientDemographics[f.patient_id] || {};
      const band = getAgeBand(demo.age);
      if (!feedbackByAgeGroup[band]) feedbackByAgeGroup[band] = { total: 0, disagree: 0, upgrades: 0, downgrades: 0 };
      feedbackByAgeGroup[band].total++;
      if (f.verdict === 'disagree') {
        feedbackByAgeGroup[band].disagree++;
        if (f.direction === 'upgrade') feedbackByAgeGroup[band].upgrades++;
        if (f.direction === 'downgrade') feedbackByAgeGroup[band].downgrades++;
      }
    }
    for (const [band, data] of Object.entries(feedbackByAgeGroup)) {
      data.disagree_rate = data.total > 0 ? Math.round(data.disagree / data.total * 1000) / 10 : 0;
    }

    // ── DISPARITY FLAGS ────────────────────────────────────
    const disparities = [];

    // Flag languages with significantly higher disagree rates
    const overallDisagreeRate = feedback.length > 0
      ? feedback.filter(f => f.verdict === 'disagree').length / feedback.length
      : 0;
    for (const [lang, data] of Object.entries(feedbackByLang)) {
      if (data.total >= 5 && data.disagree_rate / 100 > overallDisagreeRate + 0.15) {
        disparities.push({
          type: 'language_disagree_disparity',
          severity: 'HIGH',
          detail: `${lang} patients have ${data.disagree_rate}% nurse disagreement rate vs ${Math.round(overallDisagreeRate * 1000) / 10}% overall (${data.total} feedback entries).`,
          action: `Review DCSL rules and AI prompt performance for ${lang}. May indicate translation quality issue or missing discriminator keywords.`,
        });
      }
    }

    // Flag languages with significantly lower average confidence
    const overallAvgConf = triages.filter(t => t.confidence).length > 0
      ? triages.filter(t => t.confidence).reduce((a, t) => a + t.confidence, 0) / triages.filter(t => t.confidence).length
      : 0;
    for (const [lang, data] of Object.entries(byLanguage)) {
      if (data.total_triages >= 10 && data.avg_confidence && data.avg_confidence < overallAvgConf - 15) {
        disparities.push({
          type: 'language_confidence_disparity',
          severity: 'MEDIUM',
          detail: `${lang} patients have avg confidence ${data.avg_confidence}% vs ${Math.round(overallAvgConf * 10) / 10}% overall (${data.total_triages} triages).`,
          action: `AI may be less certain when processing ${lang} input. Review triage prompt language handling.`,
        });
      }
    }

    // Flag facilities with high access failure rates
    for (const [fac, data] of Object.entries(byFacility)) {
      const facOutcomes = outcomes.filter(o => o.facility_name === fac);
      const accessFailures = facOutcomes.filter(o => o.access_failure).length;
      if (facOutcomes.length >= 5 && accessFailures / facOutcomes.length > 0.20) {
        disparities.push({
          type: 'facility_access_disparity',
          severity: 'HIGH',
          detail: `${fac} has ${Math.round(accessFailures / facOutcomes.length * 100)}% access failure rate (${accessFailures}/${facOutcomes.length} patients turned away or stockout).`,
          action: `Escalate to facility manager — patients are being triaged but not receiving care.`,
        });
      }
    }

    // Flag age groups with significantly higher disagree rates
    for (const [band, data] of Object.entries(feedbackByAgeGroup)) {
      if (data.total >= 5 && data.disagree_rate / 100 > overallDisagreeRate + 0.15) {
        disparities.push({
          type: 'age_group_disagree_disparity',
          severity: 'HIGH',
          detail: `${band} patients have ${data.disagree_rate}% nurse disagreement rate vs ${Math.round(overallDisagreeRate * 1000) / 10}% overall (${data.total} feedback entries).`,
          action: `Review triage accuracy for ${band} age group. Paediatric and elderly patients may present atypically.`,
        });
      }
    }

    // Flag age groups with significantly lower confidence
    for (const [band, data] of Object.entries(byAgeGroup)) {
      if (data.total_triages >= 10 && data.avg_confidence && data.avg_confidence < overallAvgConf - 15) {
        disparities.push({
          type: 'age_group_confidence_disparity',
          severity: 'MEDIUM',
          detail: `${band} patients have avg confidence ${data.avg_confidence}% vs ${Math.round(overallAvgConf * 10) / 10}% overall (${data.total_triages} triages).`,
          action: `AI may be less certain for ${band} patients. Review prompt handling for age-specific presentations.`,
        });
      }
    }

    res.json({
      period_days: days,
      total_triages: triages.length,
      total_feedback: feedback.length,
      total_outcomes: outcomes.length,
      by_language: byLanguage,
      feedback_by_language: feedbackByLang,
      by_facility: byFacility,
      feedback_by_facility: feedbackByFacility,
      by_age_group: byAgeGroup,
      feedback_by_age_group: feedbackByAgeGroup,
      by_sex: bySex,
      outcomes_by_triage_level: outcomeByLevel,
      disparities,
      generated_at: new Date().toISOString(),
    });
  } catch (e) {
    logger.error('[SUBGROUP] Performance report error:', e.message);
    res.status(500).json({ error: 'Server error' });
  }
});

// GET /api/governance/alerts — List governance alerts (filterable)
app.get('/api/governance/alerts', requireDashboardAuth, async (req, res) => {
  try {
    let query = supabase
      .from('governance_alerts')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(parseInt(req.query.limit) || 50);

    if (req.query.pillar) query = query.eq('pillar', req.query.pillar);
    if (req.query.severity) query = query.eq('severity', req.query.severity);
    if (req.query.resolved === 'false') query = query.eq('resolved', false);
    if (req.query.resolved === 'true') query = query.eq('resolved', true);

    const { data, error } = await query;
    if (error) throw error;
    res.json({ alerts: data });
  } catch (e) {
    res.status(500).json({ error: 'Server error' });
  }
});

// PUT /api/governance/alerts/:id/resolve — Resolve an alert
app.put('/api/governance/alerts/:id/resolve', requireDashboardAuth, async (req, res) => {
  try {
    await supabase
      .from('governance_alerts')
      .update({ resolved: true, resolved_at: new Date(), resolved_by: req.body.resolved_by || 'dashboard' })
      .eq('id', req.params.id);
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ error: 'Server error' });
  }
});

// POST /api/governance/incidents — Report an incident (L1-L4)
app.post('/api/governance/incidents', requireDashboardAuth, async (req, res) => {
  try {
    const result = await governance.incidentManager.reportIncident(req.body);
    res.json(result);
  } catch (e) {
    res.status(500).json({ error: 'Server error' });
  }
});

// GET /api/governance/incidents — List incidents
app.get('/api/governance/incidents', requireDashboardAuth, async (req, res) => {
  try {
    let query = supabase
      .from('governance_incidents')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(parseInt(req.query.limit) || 50);

    if (req.query.severity_level) query = query.eq('severity_level', parseInt(req.query.severity_level));
    if (req.query.status) query = query.eq('status', req.query.status);

    const { data, error } = await query;
    if (error) throw error;
    res.json({ incidents: data });
  } catch (e) {
    res.status(500).json({ error: 'Server error' });
  }
});

// PUT /api/governance/incidents/:id/resolve — Resolve an incident
app.put('/api/governance/incidents/:id/resolve', requireDashboardAuth, async (req, res) => {
  try {
    const result = await governance.incidentManager.resolveIncident(req.params.id, req.body);
    res.json(result);
  } catch (e) {
    res.status(500).json({ error: 'Server error' });
  }
});

// POST /api/governance/audit/run — Trigger monthly audit manually
app.post('/api/governance/audit/run', requireDashboardAuth, async (req, res) => {
  try {
    const result = await governance.incidentManager.runMonthlyAudit();
    res.json(result);
  } catch (e) {
    res.status(500).json({ error: 'Server error' });
  }
});

// GET /api/governance/audits — List audits
app.get('/api/governance/audits', requireDashboardAuth, async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('governance_audits')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(parseInt(req.query.limit) || 20);

    if (error) throw error;
    res.json({ audits: data });
  } catch (e) {
    res.status(500).json({ error: 'Server error' });
  }
});

// PUT /api/governance/audits/:id — Submit clinical review for an audit
app.put('/api/governance/audits/:id', requireDashboardAuth, async (req, res) => {
  try {
    const { clinician_feedback, computed_metrics, reviewed_by } = req.body;

    await supabase
      .from('governance_audits')
      .update({
        clinician_feedback,
        computed_metrics: computed_metrics || null,
        reviewed_by: reviewed_by || 'clinical_governance_lead',
        reviewed_at: new Date(),
        status: 'reviewed'
      })
      .eq('id', req.params.id);

    // If metrics provided, trigger statistical check
    if (computed_metrics) {
      await governance.clinicalPerformance.runStatisticalCheck();
    }

    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ error: 'Server error' });
  }
});

// GET /api/governance/metrics — Performance metrics over time
app.get('/api/governance/metrics', requireDashboardAuth, async (req, res) => {
  try {
    const days = parseInt(req.query.days) || 30;
    const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

    const { data, error } = await supabase
      .from('governance_metrics')
      .select('*')
      .gte('recorded_at', since.toISOString())
      .order('recorded_at', { ascending: true });

    if (error) throw error;
    res.json({ metrics: data, period_days: days });
  } catch (e) {
    res.status(500).json({ error: 'Server error' });
  }
});

// POST /api/governance/baselines — Set/update validation baselines
app.post('/api/governance/baselines', requireDashboardAuth, async (req, res) => {
  try {
    const { ppv, sensitivity, concordance, set_by } = req.body;

    // Deactivate previous baselines
    await supabase
      .from('governance_baselines')
      .update({ active: false })
      .eq('active', true);

    // Insert new baseline
    const { data, error } = await supabase
      .from('governance_baselines')
      .insert({
        values: { ppv, sensitivity, concordance },
        active: true,
        set_by: set_by || 'dashboard',
        created_at: new Date()
      })
      .select()
      .single();

    if (error) throw error;

    // Reload baselines in the clinical monitor
    await governance.clinicalPerformance._loadBaselines();

    res.json({ success: true, baseline: data });
  } catch (e) {
    res.status(500).json({ error: 'Server error' });
  }
});

// GET /api/governance/regression — Latest regression test results
app.get('/api/governance/regression', requireDashboardAuth, async (req, res) => {
  try {
    // Latest run summary
    const { data: runs } = await supabase
      .from('regression_test_runs')
      .select('*')
      .order('run_at', { ascending: false })
      .limit(10);

    // Latest run details
    const latestRun = runs?.[0];
    let results = [];
    if (latestRun) {
      const { data } = await supabase
        .from('regression_test_results')
        .select('*')
        .eq('run_id', latestRun.id)
        .order('test_id', { ascending: true });
      results = data || [];
    }

    const failures = results.filter(r => r.under_triage);
    const drift    = results.filter(r => r.is_consistency_test && !r.pass);

    res.json({
      latest_run: latestRun || null,
      history: runs || [],
      failures,
      drift,
      by_language: results.reduce((acc, r) => {
        if (!acc[r.language]) acc[r.language] = { pass: 0, fail: 0, under: 0 };
        r.pass ? acc[r.language].pass++ : acc[r.language].fail++;
        if (r.under_triage) acc[r.language].under++;
        return acc;
      }, {}),
      by_category: results.reduce((acc, r) => {
        if (!acc[r.category]) acc[r.category] = { pass: 0, fail: 0 };
        r.pass ? acc[r.category].pass++ : acc[r.category].fail++;
        return acc;
      }, {}),
    });
  } catch (e) { res.status(500).json({ error: 'Server error' }); }
});

// GET /api/governance/disagreement-report — Monthly rule review report
// Returns the top disagreed-with triage rules for a given month.
// This is the data that drives the monthly clinical review meeting.
app.get('/api/governance/disagreement-report', requireDashboardAuth, async (req, res) => {
  try {
    const month  = req.query.month || new Date().toISOString().slice(0, 7); // YYYY-MM
    const start  = new Date(month + '-01T00:00:00.000Z');
    const end    = new Date(new Date(start).setMonth(start.getMonth() + 1));

    // Pull all disagree records for the month
    const { data: feedback, error } = await supabase
      .from('triage_feedback')
      .select('*')
      .eq('verdict', 'disagree')
      .gte('created_at', start.toISOString())
      .lt('created_at', end.toISOString())
      .order('created_at', { ascending: false });

    if (error) throw error;
    const records = feedback || [];

    // Also get total agree+disagree for the month (for rate calculation)
    const { count: totalFeedback } = await supabase
      .from('triage_feedback')
      .select('*', { count: 'exact', head: true })
      .gte('created_at', start.toISOString())
      .lt('created_at', end.toISOString());

    const { count: totalAgree } = await supabase
      .from('triage_feedback')
      .select('*', { count: 'exact', head: true })
      .eq('verdict', 'agree')
      .gte('created_at', start.toISOString())
      .lt('created_at', end.toISOString());

    const totalDisagree = records.length;
    const disagreeRate  = totalFeedback > 0 ? ((totalDisagree / totalFeedback) * 100).toFixed(1) : '0.0';

    // Group by rule_fired — which rules are nurses overriding most?
    const ruleMap = {};
    for (const r of records) {
      const rule = r.rule_fired || 'AI_MODEL_NO_RULE'; // no discriminator — pure model decision
      if (!ruleMap[rule]) {
        ruleMap[rule] = {
          rule,
          disagree_count: 0,
          upgrades: 0,    // nurse went higher (under-triage by AI)
          downgrades: 0,  // nurse went lower (over-triage by AI)
          lateral: 0,     // same severity tier, different colour
          examples: [],   // up to 3 symptom examples
          ai_levels:   {},
          nurse_levels: {},
          facilities: {},
        };
      }
      const entry = ruleMap[rule];
      entry.disagree_count++;
      if (r.direction === 'upgrade')   entry.upgrades++;
      if (r.direction === 'downgrade') entry.downgrades++;
      if (r.direction === 'lateral')   entry.lateral++;
      if (r.ai_triage_level)    entry.ai_levels[r.ai_triage_level]    = (entry.ai_levels[r.ai_triage_level]    || 0) + 1;
      if (r.nurse_triage_level) entry.nurse_levels[r.nurse_triage_level] = (entry.nurse_levels[r.nurse_triage_level] || 0) + 1;
      if (r.facility_name)      entry.facilities[r.facility_name]       = (entry.facilities[r.facility_name]       || 0) + 1;
      if (entry.examples.length < 3 && r.symptoms_summary) entry.examples.push(r.symptoms_summary);
    }

    // Sort by disagree_count descending — top 5 problem rules
    const topRules = Object.values(ruleMap)
      .sort((a, b) => b.disagree_count - a.disagree_count)
      .slice(0, 10);

    // Safety signal: any upgrades to RED that AI missed?
    const missedRed = records.filter(r => r.nurse_triage_level === 'RED' && r.ai_triage_level !== 'RED');

    res.json({
      month,
      total_feedback:   totalFeedback || 0,
      total_agree:      totalAgree    || 0,
      total_disagree:   totalDisagree,
      disagree_rate:    disagreeRate + '%',
      missed_red_count: missedRed.length,
      missed_red_cases: missedRed.map(r => ({ rule: r.rule_fired, symptoms: r.symptoms_summary, facility: r.facility_name, date: r.created_at })),
      top_rules:        topRules,
      review_required:  topRules.filter(r => r.disagree_count >= 3),  // rules that need action
    });
  } catch (e) {
    res.status(500).json({ error: 'Server error' });
  }
});

// GET /api/governance/reviews — Lifecycle reviews
app.get('/api/governance/reviews', requireDashboardAuth, async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('governance_reviews')
      .select('*')
      .order('created_at', { ascending: false });

    if (error) throw error;
    res.json({ reviews: data });
  } catch (e) {
    res.status(500).json({ error: 'Server error' });
  }
});

// PUT /api/governance/reviews/:id — Complete a lifecycle review
app.put('/api/governance/reviews/:id', requireDashboardAuth, async (req, res) => {
  try {
    const { decision, notes, reviewed_by, actions } = req.body;
    // decision: 'continue' | 'retrain' | 'reprompt' | 'retire_pathway' | 'rollback'

    await supabase
      .from('governance_reviews')
      .update({
        status: 'completed',
        decision,
        notes,
        reviewed_by: reviewed_by || 'governance_forum',
        completed_at: new Date(),
        actions: actions || []
      })
      .eq('id', req.params.id);

    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ error: 'Server error' });
  }
});

// ── Outbreak Surveillance API endpoints ──────────────────────────

// GET /api/outbreak/alerts — Active outbreak alerts for dashboard
// Returns flat array — dashboard groups client-side
app.get('/api/outbreak/alerts', requireDashboardAuth, async (req, res) => {
  try {
    const showResolved = req.query.resolved === 'true';
    const limit = Math.min(parseInt(req.query.limit) || 100, 200);
    let query = supabase
      .from('outbreak_alerts')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(limit);
    if (showResolved) {
      query = query.eq('resolved', true);
    } else {
      query = query.eq('resolved', false);
    }
    if (req.query.syndrome) query = query.eq('syndrome_id', req.query.syndrome);
    const { data, error } = await query;
    if (error) throw error;
    res.json(data || []);
  } catch (e) { res.status(500).json({ error: 'Server error' }); }
});

// PATCH /api/outbreak/alerts/:id/resolve — Clinician marks alert reviewed
app.patch('/api/outbreak/alerts/:id/resolve', requireDashboardAuth, async (req, res) => {
  try {
    await supabase.from('outbreak_alerts')
      .update({ resolved: true, resolved_at: new Date(), resolved_by: req.body.resolved_by || 'dashboard' })
      .eq('id', req.params.id);
    res.json({ success: true });
  } catch (e) { res.status(500).json({ error: 'Server error' }); }
});

// POST /api/outbreak/agent/run — Manually trigger surveillance agent
app.post('/api/outbreak/agent/run', requireDashboardAuth, async (req, res) => {
  try {
    await runOutbreakSurveillanceAgent();
    res.json({ success: true, message: 'Surveillance agent run complete' });
  } catch (e) { res.status(500).json({ error: 'Server error' }); }
});

// GET /api/outbreak/config — List syndrome configurations
app.get('/api/outbreak/config', requireDashboardAuth, async (req, res) => {
  try {
    const { data, error } = await supabase.from('outbreak_config').select('*').order('syndrome_id');
    if (error) throw error;
    // Merge with hardcoded defaults so dashboard shows all syndromes even before DB seed
    const configMap = {};
    if (data) data.forEach(r => { configMap[r.syndrome_id] = r; });
    const merged = OUTBREAK_SYNDROMES.map(s => ({
      ...s,
      db_override: configMap[s.id] || null,
      effective_thresholds: configMap[s.id]?.thresholds || s.thresholds,
      effective_window_hours: configMap[s.id]?.window_hours || s.window_hours,
    }));
    res.json({ syndromes: merged });
  } catch (e) { res.status(500).json({ error: 'Server error' }); }
});

// GET /api/governance/reports — Aggregated reporting data for date range
// Feeds the Reports tab on the governance dashboard
app.get('/api/governance/reports', requireDashboardAuth, async (req, res) => {
  try {
    const start = req.query.start || new Date(Date.now() - 7 * 86400000).toISOString().split('T')[0];
    const end = req.query.end || new Date().toISOString().split('T')[0];
    const endDate = new Date(end);
    endDate.setDate(endDate.getDate() + 1); // Include the end date

    // 1. Triage logs for date range
    const { data: triages } = await supabase
      .from('triage_logs')
      .select('*')
      .gte('created_at', start)
      .lt('created_at', endDate.toISOString())
      .order('created_at', { ascending: true });
    const t = triages || [];

    // 2. Queue entries for date range
    const { data: queueEntries } = await supabase
      .from('clinic_queue')
      .select('queue_type, triage_level, checked_in_at, called_at, completed_at, status')
      .gte('checked_in_at', start)
      .lt('checked_in_at', endDate.toISOString());
    const q = queueEntries || [];

    // 3. Follow-ups for date range
    const { data: followups } = await supabase
      .from('follow_ups')
      .select('status, created_at')
      .gte('created_at', start)
      .lt('created_at', endDate.toISOString());
    const f = followups || [];

    // 4. Audit log for nurse agree/disagree
    const { data: auditEntries } = await supabase
      .from('audit_log')
      .select('action, created_at')
      .in('action', ['AGREE', 'DISAGREE'])
      .gte('created_at', start)
      .lt('created_at', endDate.toISOString());
    const a = auditEntries || [];

    // Aggregate: triage distribution
    const triage_distribution = {};
    t.forEach(r => { triage_distribution[r.triage_level] = (triage_distribution[r.triage_level] || 0) + 1; });

    // Aggregate: queue stream distribution
    const queue_distribution = {};
    q.forEach(r => { queue_distribution[r.queue_type] = (queue_distribution[r.queue_type] || 0) + 1; });

    // Aggregate: average confidence
    const confidences = t.filter(r => r.confidence).map(r => r.confidence);
    const avg_confidence = confidences.length > 0 ? Math.round(confidences.reduce((a, b) => a + b, 0) / confidences.length) : 0;

    // Aggregate: daily volume
    const daily_volume = {};
    t.forEach(r => {
      const day = r.created_at.split('T')[0];
      daily_volume[day] = (daily_volume[day] || 0) + 1;
    });

    // Aggregate: follow-up rates
    const followup_sent = f.filter(r => ['sent','completed','awaiting_visit_response'].includes(r.status)).length;
    const followup_responded = f.filter(r => r.status === 'completed').length;
    const followup_no_response = f.filter(r => r.status === 'no_response').length;
    const followup_completion_rate = followup_sent > 0 ? Math.round(followup_responded / followup_sent * 100) : 0;
    // Lost-to-follow-up rate = no_response / sent (national baseline 28%)
    const followup_lost_rate = followup_sent > 0 ? Math.round(followup_no_response / followup_sent * 100) : null;

    // Aggregate: follow-up outcomes from follow_up_outcomes table
    const { data: outcomes } = await supabase
      .from('follow_up_outcomes')
      .select('symptom_outcome, visited_clinic, access_failure, triage_level, facility_name')
      .gte('response_received_at', start)
      .lt('response_received_at', endDate.toISOString());
    const o = outcomes || [];

    const outcome_better   = o.filter(r => r.symptom_outcome === 'better').length;
    const outcome_same     = o.filter(r => r.symptom_outcome === 'same').length;
    const outcome_worse    = o.filter(r => r.symptom_outcome === 'worse').length;
    const visited_clinic   = o.filter(r => r.visited_clinic === 'clinic' && !r.access_failure).length;
    const visited_hospital = o.filter(r => r.visited_clinic === 'hospital').length;
    const did_not_visit    = o.filter(r => r.visited_clinic === 'no').length;

    // Access failure signals (stockout / turned away)
    const access_failures_stockout     = o.filter(r => r.access_failure === 'stockout').length;
    const access_failures_turned_away  = o.filter(r => r.access_failure === 'turned_away').length;

    // Per-facility access failure breakdown
    const access_failures_by_facility = {};
    o.filter(r => r.access_failure && r.facility_name).forEach(r => {
      const f = r.facility_name;
      if (!access_failures_by_facility[f]) access_failures_by_facility[f] = { stockout: 0, turned_away: 0 };
      access_failures_by_facility[f][r.access_failure] = (access_failures_by_facility[f][r.access_failure] || 0) + 1;
    });

    // Safety signal: YELLOW patients who did not visit clinic and are not better
    const yellow_no_visit_not_better = o.filter(r =>
      r.triage_level === 'YELLOW' && r.visited_clinic === 'no' && r.symptom_outcome !== 'better').length;

    // Aggregate: nurse feedback
    const nurse_agree = a.filter(r => r.action === 'AGREE').length;
    const nurse_disagree = a.filter(r => r.action === 'DISAGREE').length;

    res.json({
      period: { start, end },
      total_patients: t.length,
      avg_confidence,
      triage_distribution,
      queue_distribution,
      daily_volume,
      followup_sent,
      followup_responded,
      followup_no_response,
      followup_lost_rate,
      followup_completion_rate,
      outcomes: { better: outcome_better, same: outcome_same, worse: outcome_worse, total: o.length },
      clinic_visits: { visited_clinic, visited_hospital, did_not_visit, yellow_no_visit_not_better },
      access_failures: {
        stockout: access_failures_stockout,
        turned_away: access_failures_turned_away,
        total: access_failures_stockout + access_failures_turned_away,
        by_facility: access_failures_by_facility,
      },
      nurse_agree,
      nurse_disagree,
      raw_triages: t.map(r => ({
        created_at: r.created_at,
        patient_id: r.patient_id,
        triage_level: r.triage_level,
        confidence: r.confidence,
        pathway: r.pathway,
        facility_name: r.facility_name,
        symptoms: r.symptoms,
      })),
    });
  } catch (e) {
    res.status(500).json({ error: 'Server error' });
  }
});

// /api/reports/concordance, /api/reports/consent-log, /api/reports/referrals
// moved to routes/reports.js


// ... last existing endpoint above

// POST /api/outbreak/alerts/:id/confirm — Nurse confirms or dismisses an IMMEDIATE alert
app.post('/api/outbreak/alerts/:id/confirm', requireDashboardAuth, async (req, res) => {
  try {
    const { confirmed, dismiss_reason } = req.body;
    const user = req.headers['x-dashboard-user'] || 'dashboard';

    if (confirmed) {
      const { error } = await supabase.from('outbreak_alerts')
        .update({
          nurse_confirmed: true,
          nurse_confirmed_at: new Date().toISOString(),
          nurse_confirmed_by: user,
        })
        .eq('id', req.params.id);
      if (error) throw error;
      logger.info(`[OUTBREAK] Alert ${req.params.id} confirmed by ${user}`);
    } else {
      // Dismissed — resolve the alert with the reason
      const { error } = await supabase.from('outbreak_alerts')
        .update({
          nurse_confirmed: false,
          nurse_confirmed_at: new Date().toISOString(),
          nurse_confirmed_by: user,
          resolution_notes: dismiss_reason || 'Dismissed without reason',
          resolved: true,
          resolved_at: new Date().toISOString(),
          resolved_by: user,
        })
        .eq('id', req.params.id);
      if (error) throw error;
      logger.info(`[OUTBREAK] Alert ${req.params.id} dismissed by ${user}: ${dismiss_reason}`);
    }
    res.json({ success: true });
  } catch (e) {
    logger.error('[OUTBREAK] Confirm error:', e.message);
    res.status(500).json({ error: 'Server error' });
  }
});

// POST /api/outbreak/alerts/:id/mark-notified — Record NICD notification
app.post('/api/outbreak/alerts/:id/mark-notified', requireDashboardAuth, async (req, res) => {
  try {
    const { notification_method, reference_number } = req.body;
    const user = req.headers['x-dashboard-user'] || 'dashboard';

    const { error } = await supabase.from('outbreak_alerts')
      .update({
        nmc_notified: true,
        nmc_notified_at: new Date().toISOString(),
        nmc_notified_by: user,
        nmc_notification_method: notification_method,
        nmc_reference_number: reference_number || null,
      })
      .eq('id', req.params.id);
    if (error) throw error;

    logger.info(`[OUTBREAK] Alert ${req.params.id} — NICD notified by ${user} via ${notification_method}`);
    res.json({ success: true });
  } catch (e) {
    logger.error('[OUTBREAK] Mark-notified error:', e.message);
    res.status(500).json({ error: 'Server error' });
  }
});

// ================================================================
// OUTCOME-TRIAGE CORRELATION — HAIRA Level 5
// ================================================================
// Systematic correlation between triage decisions and patient outcomes.
// Answers: "Did RED patients actually have emergencies? Are GREEN patients
// actually getting better?" Moves governance from Level 3-4 to Level 5.
app.get('/api/governance/outcome-correlation', requireDashboardAuth, async (req, res) => {
  try {
    const days = parseInt(req.query.days) || 90;
    const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();

    // Fetch triages and their follow-up outcomes
    const [triageRes, outcomeRes] = await Promise.all([
      supabase.from('triage_logs')
        .select('patient_id, triage_level, confidence, rule_override, created_at')
        .gte('created_at', since),
      supabase.from('follow_up_outcomes')
        .select('patient_id, triage_level, symptom_outcome, visited_clinic, access_failure, response_received_at')
        .gte('response_received_at', since),
    ]);

    const triages = triageRes.data || [];
    const outcomes = outcomeRes.data || [];

    // Build outcome map by patient for matching
    const outcomeByPatient = {};
    for (const o of outcomes) {
      if (!outcomeByPatient[o.patient_id]) outcomeByPatient[o.patient_id] = [];
      outcomeByPatient[o.patient_id].push(o);
    }

    // Correlate triage level → outcome
    const correlation = {};
    const LEVELS = ['RED', 'ORANGE', 'YELLOW', 'GREEN'];
    for (const level of LEVELS) {
      correlation[level] = {
        total_triaged: 0,
        with_outcome: 0,
        outcomes: { better: 0, same: 0, worse: 0 },
        visited: { clinic: 0, hospital: 0, none: 0 },
        access_failures: 0,
        rule_override_count: 0,
        avg_confidence: [],
      };
    }

    for (const t of triages) {
      const level = t.triage_level;
      if (!correlation[level]) continue;
      correlation[level].total_triaged++;
      if (t.confidence) correlation[level].avg_confidence.push(t.confidence);
      if (t.rule_override) correlation[level].rule_override_count++;

      // Match with outcomes
      const patientOutcomes = outcomeByPatient[t.patient_id] || [];
      // Find the outcome closest to this triage (within 7 days after)
      const triageTime = new Date(t.created_at).getTime();
      const matchedOutcome = patientOutcomes.find(o => {
        const oTime = new Date(o.response_received_at).getTime();
        return oTime > triageTime && oTime - triageTime < 7 * 24 * 60 * 60 * 1000;
      });

      if (matchedOutcome) {
        correlation[level].with_outcome++;
        if (matchedOutcome.symptom_outcome === 'better') correlation[level].outcomes.better++;
        if (matchedOutcome.symptom_outcome === 'same') correlation[level].outcomes.same++;
        if (matchedOutcome.symptom_outcome === 'worse') correlation[level].outcomes.worse++;
        if (matchedOutcome.visited_clinic === 'clinic') correlation[level].visited.clinic++;
        else if (matchedOutcome.visited_clinic === 'hospital') correlation[level].visited.hospital++;
        else correlation[level].visited.none++;
        if (matchedOutcome.access_failure) correlation[level].access_failures++;
      }
    }

    // Calculate rates and safety signals
    const safety_signals = [];
    for (const level of LEVELS) {
      const c = correlation[level];
      c.avg_confidence = c.avg_confidence.length > 0
        ? Math.round(c.avg_confidence.reduce((a, b) => a + b, 0) / c.avg_confidence.length * 10) / 10
        : null;
      c.outcome_response_rate = c.total_triaged > 0
        ? Math.round(c.with_outcome / c.total_triaged * 1000) / 10
        : 0;

      if (c.with_outcome > 0) {
        c.better_rate = Math.round(c.outcomes.better / c.with_outcome * 1000) / 10;
        c.worse_rate = Math.round(c.outcomes.worse / c.with_outcome * 1000) / 10;
        c.visit_rate = Math.round((c.visited.clinic + c.visited.hospital) / c.with_outcome * 1000) / 10;
      }

      // Safety signal: GREEN patients getting worse
      if (level === 'GREEN' && c.with_outcome >= 5 && c.outcomes.worse / c.with_outcome > 0.15) {
        safety_signals.push({
          type: 'green_patients_worsening',
          severity: 'HIGH',
          detail: `${Math.round(c.outcomes.worse / c.with_outcome * 100)}% of GREEN patients reported worsening symptoms (${c.outcomes.worse}/${c.with_outcome}).`,
          action: 'Review GREEN triage accuracy — may indicate under-triage. Check if DCSL safety nets are catching enough cases.',
        });
      }

      // Safety signal: RED patients not visiting hospital
      if (level === 'RED' && c.with_outcome >= 3 && c.visited.hospital / c.with_outcome < 0.5) {
        safety_signals.push({
          type: 'red_patients_not_visiting_hospital',
          severity: 'HIGH',
          detail: `Only ${Math.round(c.visited.hospital / c.with_outcome * 100)}% of RED patients visited hospital (${c.visited.hospital}/${c.with_outcome}).`,
          action: 'Investigate barriers: transport, cost, distance, or possible over-triage inflating RED counts.',
        });
      }

      // Safety signal: YELLOW patients not visiting at all
      if (level === 'YELLOW' && c.with_outcome >= 5 && c.visited.none / c.with_outcome > 0.4) {
        safety_signals.push({
          type: 'yellow_patients_not_visiting',
          severity: 'MEDIUM',
          detail: `${Math.round(c.visited.none / c.with_outcome * 100)}% of YELLOW patients did not visit any facility (${c.visited.none}/${c.with_outcome}).`,
          action: 'Review messaging effectiveness — patients triaged as urgent should be visiting. Check access barriers.',
        });
      }
    }

    // Time-series: monthly correlation trends
    const monthlyTrends = {};
    for (const t of triages) {
      const month = t.created_at.slice(0, 7); // YYYY-MM
      if (!monthlyTrends[month]) monthlyTrends[month] = { total: 0, with_outcome: 0, worse: 0 };
      monthlyTrends[month].total++;
      const patientOutcomes = outcomeByPatient[t.patient_id] || [];
      const triageTime = new Date(t.created_at).getTime();
      const matched = patientOutcomes.find(o => {
        const oTime = new Date(o.response_received_at).getTime();
        return oTime > triageTime && oTime - triageTime < 7 * 24 * 60 * 60 * 1000;
      });
      if (matched) {
        monthlyTrends[month].with_outcome++;
        if (matched.symptom_outcome === 'worse') monthlyTrends[month].worse++;
      }
    }

    res.json({
      period_days: days,
      total_triages: triages.length,
      total_outcomes: outcomes.length,
      correlation,
      safety_signals,
      monthly_trends: monthlyTrends,
      generated_at: new Date().toISOString(),
    });
  } catch (e) {
    logger.error('[OUTCOME-CORRELATION] Error:', e.message);
    res.status(500).json({ error: 'Server error' });
  }
});

};
