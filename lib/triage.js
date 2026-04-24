'use strict';

// ─────────────────────────────────────────────────────────────
// DCSL keyword sets — loaded from config/dcsl_keywords.json at
// startup. The config file is gitignored; it is NOT present in
// public scientific-record snapshots. See SECURITY.md.
// Override with DCSL_KEYWORDS_PATH env var (e.g., on Railway).
// ─────────────────────────────────────────────────────────────
const DCSL_KEYWORDS = (() => {
  const _path = require('path');
  const _fs = require('fs');
  const _cfg = process.env.DCSL_KEYWORDS_PATH
    || _path.join(__dirname, '..', 'config', 'dcsl_keywords.json');
  if (!_fs.existsSync(_cfg)) {
    throw new Error(
      'DCSL keyword config not found at ' + _cfg + '. ' +
      'Expected path: config/dcsl_keywords.json (gitignored). ' +
      'See config/dcsl_keywords.example.json for the required shape, ' +
      'or set DCSL_KEYWORDS_PATH to an alternate location.'
    );
  }
  return JSON.parse(_fs.readFileSync(_cfg, 'utf8')).sets;
})();

// Clinical triage engine — SA SATS v2 aligned.
// Three-layer classification: AI prompt → deterministic rules → governance wrapper.
// Exports are called from orchestrate() and governance.runTriageWithGovernance().
const Anthropic = require('@anthropic-ai/sdk');
const logger    = require('../logger');

const TRIAGE_MODEL        = process.env.TRIAGE_MODEL || 'claude-sonnet-4-20250514';
const FAST_MODEL          = process.env.FAST_MODEL || 'claude-haiku-4-5-20251001'; // For self-care, translation — speed + cost
const TRIAGE_PROMPT_VERSION = 'sats-v2.4'; // bump when system prompt changes

// ── Production guard: Opus not permitted as triage model ──
// The N=5 cross-model eval on 2026-04-18 (docs/eval_findings.md)
// documented reproducible under-triage by Opus 4.7 on three LMIC
// scenarios (pregnancy+orthopnea, isiZulu ACS with minimisation,
// Sesotho HIV+fever+meningism). Until a prompt-sensitivity follow-up
// demonstrates Opus safety parity with Sonnet, Opus is not accepted
// as the clinical triage model. Set ALLOW_OPUS_TRIAGE=true to
// override (e.g. for an experimental re-evaluation run).
if (/opus/i.test(TRIAGE_MODEL) && process.env.ALLOW_OPUS_TRIAGE !== 'true') {
  throw new Error(
    `[TRIAGE] Opus is not permitted as TRIAGE_MODEL (current: ${TRIAGE_MODEL}). ` +
    `N=5 cross-model eval found reproducible under-triage of LMIC scenarios. ` +
    `See docs/eval_findings.md. To override for a controlled experiment, ` +
    `set ALLOW_OPUS_TRIAGE=true. Recommended triage model: claude-sonnet-4-20250514.`
  );
}

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

let _supabase = null;
function init(supabase) { _supabase = supabase; }

// ── Per-patient triage rate limiter (in-memory, resets on restart) ──
const _triageRateLimit = new Map();
const TRIAGE_HOURLY_MAX = 3;
const TRIAGE_DAILY_MAX  = 10;

function checkTriageRateLimit(patientId) {
  const now = Date.now();
  const record = _triageRateLimit.get(patientId) || { calls: [] };

  // Prune calls older than 24h
  record.calls = record.calls.filter(t => now - t < 24 * 60 * 60 * 1000);

  const lastHour = record.calls.filter(t => now - t < 60 * 60 * 1000).length;
  if (lastHour >= TRIAGE_HOURLY_MAX || record.calls.length >= TRIAGE_DAILY_MAX) {
    _triageRateLimit.set(patientId, record);
    return false; // rate limited
  }

  record.calls.push(now);
  _triageRateLimit.set(patientId, record);
  return true; // allowed
}

// Cleanup stale entries every 10 minutes
setInterval(() => {
  const cutoff = Date.now() - 24 * 60 * 60 * 1000;
  for (const [pid, record] of _triageRateLimit) {
    record.calls = record.calls.filter(t => t > cutoff);
    if (record.calls.length === 0) _triageRateLimit.delete(pid);
  }
}, 10 * 60 * 1000);

async function getPatientHistory(patientId) {
  try {
    const [triageRes, outcomeRes] = await Promise.all([
      _supabase
        .from('triage_logs')
        .select('triage_level, pathway, facility_name, symptoms, created_at')
        .eq('patient_id', patientId)
        .order('created_at', { ascending: false })
        .limit(10),
      _supabase
        .from('follow_up_outcomes')
        .select('triage_level, symptom_outcome, visited_clinic, access_failure, response_received_at')
        .eq('patient_id', patientId)
        .order('response_received_at', { ascending: false })
        .limit(5),
    ]);

    const triages = triageRes.data || [];
    const outcomes = outcomeRes.data || [];
    const lastOutcome = outcomes[0] || null;

    if (triages.length === 0) return null;

    const last = triages[0];
    const daysAgo = Math.round((Date.now() - new Date(last.created_at)) / (1000 * 60 * 60 * 24));

    // ── PATTERN DETECTION ──────────────────────────────────────
    // Scans all recent triages for recurring symptom patterns that
    // may indicate an undiagnosed chronic condition.
    const clinicalFlags = detectClinicalPatterns(triages, outcomes);

    return {
      lastTriageLevel:    last.triage_level,
      lastTriageFacility: last.facility_name || null,
      lastTriagePathway:  last.pathway || null,
      lastTriageDaysAgo:  daysAgo,
      priorTriageLevel:   triages[1]?.triage_level || null,
      totalTriages:       triages.length,
      lastOutcome:        lastOutcome ? {
        symptomOutcome:  lastOutcome.symptom_outcome,
        visitedClinic:   lastOutcome.visited_clinic,
        accessFailure:   lastOutcome.access_failure,
        daysAgo: Math.round((Date.now() - new Date(lastOutcome.response_received_at)) / (1000 * 60 * 60 * 24)),
      } : null,
      clinicalFlags,
    };
  } catch (e) {
    logger.error('[HISTORY] Failed to fetch patient history:', e.message);
    return null;
  }
}

// ── LONGITUDINAL PATTERN DETECTION ──────────────────────────────
// Scans a patient's triage history for recurring symptom clusters
// that may indicate an undiagnosed condition. Flags are injected
// into the AI triage prompt AND shown on the clinic dashboard.
//
// NOT a diagnosis — a signal for clinical follow-up.
function detectClinicalPatterns(triages, outcomes) {
  if (!triages || triages.length < 2) return [];

  const flags = [];
  const allSymptoms = triages.map(t => (t.symptoms || '').toLowerCase()).join(' ');
  const visitCount = triages.length;
  const daySpan = triages.length >= 2
    ? Math.round((new Date(triages[0].created_at) - new Date(triages[triages.length - 1].created_at)) / (1000 * 60 * 60 * 24))
    : 0;

  // Count keyword occurrences across all visits
  const count = (...terms) => terms.reduce((n, t) => n + (allSymptoms.split(t).length - 1), 0);

  // ── FREQUENT VISITOR (3+ triages in 30 days) ──
  if (visitCount >= 3 && daySpan <= 30) {
    flags.push({
      flag: 'frequent_visitor',
      severity: 'medium',
      message: `Patient has triaged ${visitCount} times in ${daySpan} days. Recurring presentations may indicate an unmanaged condition.`,
      action: 'Review pattern — consider comprehensive clinical assessment.',
    });
  }

  // ── WORSENING TREND ──
  const notImproving = outcomes.filter(o => o.symptom_outcome === 'worse' || o.symptom_outcome === 'same').length;
  if (notImproving >= 2) {
    flags.push({
      flag: 'not_improving',
      severity: 'high',
      message: `Patient reported not improving ${notImproving} times across follow-ups despite clinic visits.`,
      action: 'Symptoms not resolving — escalate for clinical review.',
    });
  }

  // ── POSSIBLE UNDIAGNOSED TB ──
  // 3-week cough + night sweats + weight loss across visits
  const coughVisits = triages.filter(t => {
    const s = (t.symptoms || '').toLowerCase();
    return s.includes('cough') || s.includes('khwehlela') || s.includes('khohlela') || s.includes('hoes');
  }).length;
  const hasSweats = allSymptoms.includes('sweat') || allSymptoms.includes('night sweat') || allSymptoms.includes('perspire')
    || allSymptoms.includes('juluka') || allSymptoms.includes('sweet');
  const hasWeightLoss = allSymptoms.includes('weight loss') || allSymptoms.includes('losing weight') || allSymptoms.includes('lost weight')
    || allSymptoms.includes('konda') || allSymptoms.includes('gewig verloor');
  if (coughVisits >= 2 && (hasSweats || hasWeightLoss) && daySpan >= 14) {
    flags.push({
      flag: 'possible_tb',
      severity: 'high',
      message: `Recurring cough (${coughVisits} visits) with ${hasSweats ? 'night sweats' : ''}${hasSweats && hasWeightLoss ? ' and ' : ''}${hasWeightLoss ? 'weight loss' : ''} over ${daySpan} days.`,
      action: 'Screen for TB — sputum test recommended. TB triad pattern detected across visits.',
    });
  }

  // ── POSSIBLE UNDIAGNOSED DIABETES ──
  // Recurring thirst, frequent urination, fatigue, blurred vision
  const diabetesKeywords = count('thirst', 'very thirsty', 'urinate', 'frequent urination', 'peeing a lot',
    'blurred vision', 'tired all the time', 'fatigue', 'wounds not healing', 'sugar high',
    'omile', 'ukuchama', 'dors', 'moeilik sien');
  if (diabetesKeywords >= 3 && visitCount >= 2) {
    flags.push({
      flag: 'possible_diabetes',
      severity: 'medium',
      message: `Recurring symptoms suggestive of diabetes: thirst, urination frequency, fatigue, or vision changes across ${visitCount} visits.`,
      action: 'Screen for diabetes — fasting glucose or HbA1c recommended.',
    });
  }

  // ── POSSIBLE UNDIAGNOSED HIV ──
  // Recurring fever, weight loss, oral thrush, persistent diarrhoea, skin rash
  const hivKeywords = count('weight loss', 'losing weight', 'oral thrush', 'thrush', 'mouth sores',
    'persistent diarrhoea', 'recurring fever', 'night sweats', 'swollen glands', 'swollen lymph',
    'rash that won\'t go away', 'recurring skin');
  if (hivKeywords >= 3 && visitCount >= 2 && daySpan >= 14) {
    flags.push({
      flag: 'possible_hiv',
      severity: 'high',
      message: `Recurring symptoms across ${visitCount} visits over ${daySpan} days: pattern includes weight loss, recurrent infections, or persistent symptoms.`,
      action: 'Offer HIV testing if status unknown — recurrent symptom pattern warrants screening.',
    });
  }

  // ── POSSIBLE UNDIAGNOSED HYPERTENSION ──
  // Recurring headaches, dizziness, nosebleeds, visual changes
  const htnKeywords = count('headache', 'dizzy', 'dizziness', 'nosebleed', 'nose bleed', 'blurred vision',
    'ikhanda', 'isiyezi', 'hoofpyn', 'duiselig', 'hlogo');
  if (htnKeywords >= 4 && visitCount >= 3 && daySpan >= 14) {
    flags.push({
      flag: 'possible_hypertension',
      severity: 'medium',
      message: `Recurring headaches/dizziness (${htnKeywords} mentions) across ${visitCount} visits over ${daySpan} days.`,
      action: 'Check blood pressure — pattern may indicate undiagnosed hypertension.',
    });
  }

  // ── POSSIBLE UNDIAGNOSED ASTHMA (PAEDIATRIC) ──
  // Child with recurring respiratory symptoms
  const respiratoryVisits = triages.filter(t => {
    const s = (t.symptoms || '').toLowerCase();
    return s.includes('wheez') || s.includes('chest tight') || s.includes('breathing') || s.includes('inhaler')
      || s.includes('isifuba') || s.includes('phefumula') || s.includes('asem');
  }).length;
  const isChildContext = allSymptoms.includes('child') || allSymptoms.includes('baby') || allSymptoms.includes('ingane')
    || allSymptoms.includes('ngwana') || allSymptoms.includes('son') || allSymptoms.includes('daughter');
  if (respiratoryVisits >= 3 && (isChildContext || daySpan <= 42)) {
    flags.push({
      flag: 'possible_asthma',
      severity: 'medium',
      message: `Recurring respiratory symptoms (${respiratoryVisits} visits) — wheezing, chest tightness, or breathing difficulty.`,
      action: 'Assess for chronic asthma — may need prophylactic inhaler rather than acute treatment.',
    });
  }

  // ── ACCESS BARRIER PATTERN ──
  const accessFailures = outcomes.filter(o => o.access_failure).length;
  if (accessFailures >= 2) {
    flags.push({
      flag: 'access_barrier',
      severity: 'high',
      message: `Patient reported ${accessFailures} access failures (stockout or turned away) — care is not being received despite seeking it.`,
      action: 'Escalate to facility manager — patient repeatedly unable to access care.',
    });
  }

  return flags;
}

// Strip personally identifiable information before sending to AI
function stripPII(text) {
  let cleaned = text;
  // Remove SA ID numbers (13 digits)
  cleaned = cleaned.replace(/\b\d{13}\b/g, '[ID_REMOVED]');
  // Remove phone numbers (10+ digits, with optional + prefix)
  cleaned = cleaned.replace(/\+?\d[\d\s-]{8,}\d/g, '[PHONE_REMOVED]');
  // Remove email addresses
  cleaned = cleaned.replace(/[\w.-]+@[\w.-]+\.\w+/g, '[EMAIL_REMOVED]');
  return cleaned;
}

async function runTriage(text, lang, sessionContext) {
  // Rate limit check — protect Anthropic API budget
  const patientId = sessionContext?.patientId;
  if (patientId && !checkTriageRateLimit(patientId)) {
    logger.warn({ patientId }, '[TRIAGE] Rate limited — 3/hour or 10/day exceeded');
    return { rateLimited: true };
  }

  // POPIA compliance: strip PII before sending to external AI service
  text = stripPII(text);

  const age = sessionContext?.age || null;
  const chronicConditions = sessionContext?.chronicConditions || [];
  const isPregnant = sessionContext?.isPregnant || false;
  const isPaediatric = age !== null && age < 12;
  const comorbidStr = chronicConditions.length > 0
    ? chronicConditions.map(c => c.label_en || c).join(', ')
    : 'none known';

  const paediatricNote = isPaediatric
    ? `\n⚠️ PAEDIATRIC PATIENT (age ${age}): Apply paediatric SATS. Children deteriorate faster — upgrade one level if any doubt. RED signs include: not breathing, unconscious, currently seizing, petechial/purpuric rash, severe dehydration (sunken fontanelle, no tears, very dry mouth). ORANGE includes: febrile seizure (fit with fever), severe respiratory distress, post-ictal, acute severe dehydration with vomiting.`
    : '';
  const pregnancyNote = isPregnant
    ? `\n⚠️ PREGNANT PATIENT: Any bleeding = RED until proven otherwise. Headache + swelling + high BP = ORANGE (pre-eclampsia). Lower abdo pain + missed period = YELLOW minimum.`
    : '';
  const chronicNote = comorbidStr !== 'none known'
    ? `\n⚠️ COMORBIDITIES: ${comorbidStr}. Upgrade one level for: HIV+ with fever (YELLOW→ORANGE), DM with confusion (YELLOW→ORANGE), epilepsy + post-ictal (YELLOW→ORANGE), TB + haemoptysis (YELLOW→ORANGE).`
    : '';

  const history = sessionContext?.priorHistory || null;
  let longitudinalNote = '';
  if (history) {
    const parts = [`\n⚕️ PRIOR HISTORY (${history.lastTriageDaysAgo}d ago): Last triage was ${history.lastTriageLevel}`];
    if (history.lastTriageFacility) parts.push(`at ${history.lastTriageFacility}`);
    if (history.lastTriagePathway)  parts.push(`(pathway: ${history.lastTriagePathway})`);
    parts.push('.');
    if (history.lastOutcome) {
      const o = history.lastOutcome;
      const visitStr = o.visitedClinic === 'clinic' ? 'visited clinic'
        : o.visitedClinic === 'hospital' ? 'went to hospital'
        : o.accessFailure === 'stockout' ? 'went but no medicine (stockout)'
        : o.accessFailure === 'turned_away' ? 'went but was turned away'
        : 'did not visit';
      parts.push(` Follow-up (${o.daysAgo}d ago): ${visitStr}, symptom trend: ${o.symptomOutcome || 'unknown'}.`);
      // Clinical rule: escalate if prior visit + same/worse outcome
      if ((o.symptomOutcome === 'worse' || o.symptomOutcome === 'same') && o.visitedClinic === 'clinic') {
        parts.push(' ⚠️ Patient was already seen and is not improving — upgrade one level if any ambiguity.');
      }
    }
    if (history.priorTriageLevel && history.priorTriageLevel !== history.lastTriageLevel) {
      parts.push(` Preceding triage: ${history.priorTriageLevel} (trend: ${history.priorTriageLevel} → ${history.lastTriageLevel}).`);
    }
    longitudinalNote = parts.join('');

    // Inject clinical flags from pattern detection
    if (history.clinicalFlags && history.clinicalFlags.length > 0) {
      const flagNotes = history.clinicalFlags.map(f =>
        `\n🔍 PATTERN FLAG [${f.severity.toUpperCase()}]: ${f.message} → ${f.action}`
      ).join('');
      longitudinalNote += flagNotes;
    }
  }

  // ── MINIMISATION DETECTION ──────────────────────────────
  // Culturally common in SA: patients downplay symptoms to avoid "being a bother."
  // Detect minimising language and add a system prompt note so the AI weights
  // clinical indicators over self-assessment. Does NOT change the triage level —
  // just informs the AI's reasoning.
  const minimisationPatterns = [
    // English
    /it'?s\s*(probably|just|only)\s*(nothing|fine|okay|minor)/i,
    /don'?t\s*want\s*to\s*(bother|trouble|waste)/i,
    /i'?m\s*(sure|certain)\s*it'?s\s*(nothing|fine|okay)/i,
    /not\s*that\s*(bad|serious|sore)/i,
    /sorry\s*to\s*(bother|trouble)/i,
    /maybe\s*i'?m\s*(overreacting|exaggerating)/i,
    /i\s*can\s*(manage|cope|handle)/i,
    // isiZulu — "akusimbi kangako" (not that bad), "ngiyaxolisa" (sorry to bother)
    /akusi(mbi|bi)\s*kangako/i,
    /ngiyaxolisa\s*uku(hlupha|phazamisa)/i,
    /akukhona\s*into\s*embi/i,
    /ngingakwazi\s*uku(bhekana|melana)/i,  // "I can manage"
    // isiXhosa
    /asikokubi\s*kangako/i,
    /ndiyaxolisa\s*uku(phazamisa|hlupha)/i,
    /asiyonto\s*(imbi|inkulu)/i,  // "it's nothing serious"
    /ndingakwazi\s*uku(melana|bhekana)/i,  // "I can cope"
    // Afrikaans
    /dis\s*(seker\s*)?(niks|nie\s*erg)/i,
    /ek\s*wil\s*nie\s*pla/i,
    /ek\s*kan\s*(dit\s*)?hanteer/i,  // "I can handle it"
    // Sepedi (nso) — "ga se selo se segolo" (it's nothing big), "ke kgona go itshwara" (I can manage)
    /ga\s*se\s*selo\s*se\s*(segolo|sebe)/i,
    /ke\s*kgona\s*go\s*(itshwara|kgotlelela)/i,
    /ke\s*maswabi\s*go\s*(hlupha|ferekanyo)/i,  // "sorry to bother"
    /ga\s*se\s*bohloko\s*bo\s*bogolo/i,  // "not that painful"
    // Setswana (tn) — "ga se sepe se segolo" (it's nothing big), "ke kgona go itshoka" (I can cope)
    /ga\s*se\s*sepe\s*se\s*(segolo|sebe)/i,
    /ke\s*kgona\s*go\s*(itshoka|kgotlelela)/i,
    /ke\s*maswabi\s*go\s*(hlupha|tshwenya)/i,
    /ga\s*go\s*botlhoko\s*(thata|go\s*le\s*kalo)/i,  // "not that painful"
    // Sesotho (st) — "ha se letho le leholo" (it's nothing big), "nka kgona ho itshwara" (I can manage)
    /ha\s*se\s*letho\s*le\s*(leholo|lebe)/i,
    /nka\s*kgona\s*ho\s*(itshwara|mamella)/i,
    /ke\s*maswabi\s*ho\s*(hlopha|tshwenya)/i,
    /ha\s*ho\s*bohloko\s*(haholo|ho\s*le\s*kalo)/i,  // "not that painful"
    // Xitsonga (ts) — "a swi na nchumu" (it's nothing), "ndzi nga swi kota" (I can manage)
    /a\s*swi\s*na\s*(nchumu|mhaka)/i,
    /ndzi\s*nga\s*swi\s*(kota|tiyisela)/i,
    /ndzi\s*khomile\s*hi\s*ku\s*(hlupha|pfuxa)/i,  // "sorry to bother"
    /a\s*swi\s*vavi\s*(ngopfu|swinene)/i,  // "it doesn't hurt that much"
    // siSwati (ss) — "akusiyo intfo lenkhulu" (it's not a big thing), "ngiyakhona kukumela" (I can cope)
    /akusiyo\s*intfo\s*(lenkhulu|lembi)/i,
    /ngiyakhona\s*ku(kumela|beketela)/i,
    /ngiyacolisa\s*ku(hlupha|phazamisa)/i,  // "sorry to bother"
    /akubuhlungu\s*kangako/i,  // "it's not that painful"
    // Tshivenda (ve) — "a si tshithu tshihulwane" (it's nothing big), "ndi a kona u konḓelela" (I can cope)
    /a\s*si\s*tshithu\s*tshi(hulwane|vhi)/i,
    /ndi\s*a\s*kona\s*u\s*(konḓelela|ḓifarela)/i,
    /ndi\s*khou\s*humbela\s*pfarelo\s*(u\s*hlupha|u\s*dina)/i,  // "sorry to bother"
    /a\s*zwi\s*vhavhi\s*(vhukuma|nga\s*maanḓa)/i,  // "it doesn't really hurt"
    // isiNdebele (nr) — "akusiyinto ekulu" (it's not a big thing), "ngiyakghona ukubekezela" (I can cope)
    /akusiyinto\s*(ekulu|embi)/i,
    /ngiyakghona\s*uku(bekezela|kghodlhelela)/i,
    /ngiyacolisa\s*uku(hlupha|phazamisa)/i,  // "sorry to bother"
    /akubuhlungu\s*(khulu|kangako)/i,  // "it's not that painful"
  ];
  const isMinimising = minimisationPatterns.some(p => p.test(text));
  if (isMinimising) logger.info({ patientId }, '[TRIAGE] Minimisation language detected — weighting clinical indicators over self-assessment');
  const minimisationNote = isMinimising
    ? '\n⚠️ MINIMISATION DETECTED: Patient language suggests they may be downplaying symptoms. Weight clinical indicators (discriminators, TEWS signs) more heavily than the patient\'s self-assessment of severity. In SA cultural context, patients often minimise to avoid being seen as troublesome.'
    : '';

  const systemPrompt = `You are a clinical triage classifier for South Africa, aligned with the South African Triage Scale (SATS) as used at Primary Health Care (PHC) level.

Patient: age ${age || 'unknown'}, comorbidities: ${comorbidStr}.${paediatricNote}${pregnancyNote}${chronicNote}${longitudinalNote}${minimisationNote}

The input may be in any of South Africa's 11 official languages, including code-switching and township medical terms (e.g. "sugar"=diabetes, "high blood"=hypertension, "ikhanda"=headache, "isifuba"=chest, "fit/banjwa"=seizure).

════════════════════════════════════════════
STEP 1 — DISCRIMINATORS (check FIRST, before reading severity)
Discriminators override severity self-report completely.
════════════════════════════════════════════

RED — Immediate emergency (ALWAYS RED — do not downgrade to ORANGE):
• Not breathing / respiratory or cardiac arrest
• Unconscious / unresponsive
• Active seizure (currently fitting — not post-ictal)
• Chest pain + breathing difficulty = RED (NOT ORANGE — in ANY language, if a patient describes chest pain AND difficulty breathing at the same time, output RED immediately, no exceptions)
• Chest pain radiating to arm/jaw + sweating
• Obstetric haemorrhage (pregnant + heavy bleeding)
• Snake bite
• Anaphylaxis = RED (NOT ORANGE): any of — throat closing, lips swelling, tongue swelling, mouth swelling — especially after eating or bee sting, WITH OR WITHOUT breathing difficulty. If mouth/tongue/lips are swelling after food or sting, output RED immediately.
• Uncontrollable spurting bleeding
• Purpuric/non-blanching rash (meningococcal)
• Baby/newborn not breathing or unconscious

ORANGE — Very urgent (NOT YELLOW — do not downgrade these):
• FAST stroke signs: face droop, arm weakness, speech slurred/confused
• Thunderclap headache (sudden worst-ever headache) = ORANGE (NOT YELLOW — sudden severe headache unlike any before is always ORANGE)
• Post-ictal: had a seizure, now drowsy/confused
• Acute severe asthma: can't speak full sentences, inhaler not working, exhausted
• Pre-eclampsia: pregnant + headache + visual changes + face/hands swollen
• Ectopic pregnancy: missed period + one-sided abdominal pain = ORANGE (NOT YELLOW — any missed period + lower abdominal pain is ORANGE minimum, ectopic until proven otherwise)
• Febrile seizure: child had a fit with fever
• Acute confusion in patient with DM/HTN/HIV
• Head trauma + loss of consciousness/vomiting/confusion afterwards
• Open fracture (visible bone)
• High energy mechanism injury (MVA, fall from height, crush injury)
• Significant burns to face/airway/large body area
• Overdose already taken (patient says they swallowed pills/substances) = ORANGE psychiatric emergency (NOT YELLOW — overdose already taken is different from suicidal ideation which is thinking about it but not yet acted)
• Severe hypoglycaemia (very low glucose + unconscious/fitting)
• Preterm labour (<34 weeks) = ORANGE (NOT YELLOW — pregnancy under 34 weeks with contractions or severe pain is always ORANGE)

YELLOW — Urgent (needs clinic today, within 1–4 hours):
• Severe pain (patient describes as 8–10/10, unbearable, worst ever)
• Suicidal ideation (thinking about self-harm but NOT yet acted — if they have already taken pills or harmed themselves, that is ORANGE, not YELLOW) (thinking of killing self — not yet acting)
• Suspected abuse/assault/rape
• Pyelonephritis (burning urine + back/kidney pain + fever + chills)
• DKA: diabetic + vomiting + fruity breath + glucose >15
• TB triad: cough >3 weeks + night sweats + weight loss
• Possible fracture (deformed limb, can't weight bear after trauma)
• Hypertensive urgency: very high BP + headache/visual changes/confusion
• Appendicitis pattern: right lower abdo pain + fever + vomiting
• Asthma: inhaler not working but can still speak
• Fever + stiff neck (meningism)
• HIV positive patient with fever
• Lower abdo pain + missed period (ectopic rule-out)
• Vomiting blood or blood in stool
• Deep/contaminated wound/animal bite/rusty nail
• Sudden vision loss
• Severe dehydration in vulnerable patient (infant, elderly, diabetic, HIV)

════════════════════════════════════════════
STEP 2 — TEWS PROXY (only if no discriminator matched)
Score each indicator present from the patient's self-report (+1 each):
• Breathing fast / short of breath at rest
• Heart racing / pounding / feeling faint
• Confused / dizzy / can't think straight
• Shivering / very hot / high temperature
• Can't walk / can't move without help
• Trauma / injury present
Score 0–2=GREEN, 3–4=YELLOW, 5–6=ORANGE, 7+=RED
════════════════════════════════════════════

STEP 3 — SEVERITY SELF-REPORT (tiebreaker only, never overrides discriminators):
  MILD + no discriminator → GREEN/YELLOW
  MODERATE → YELLOW
  SEVERE → ORANGE
  NEVER assign RED from severity alone without a discriminator

STEP 4 — COMORBIDITY UPGRADE (apply after Steps 1–3):
  HIV + fever → upgrade YELLOW → ORANGE
  DM + confusion → upgrade → ORANGE
  Epilepsy + post-ictal → upgrade → ORANGE
  Pregnancy + bleeding or severe pain → ORANGE minimum
  TB + haemoptysis → upgrade → ORANGE

STEP 5 — WHEN IN DOUBT: UPGRADE one level. Under-triage is more dangerous than over-triage.

Return ONLY valid JSON: {"triage_level":"RED|ORANGE|YELLOW|GREEN","confidence":0-100,"reasoning":"≤50 words explaining which SATS step determined the level and why","discriminator_matched":"rule name or null","tews_score":0-7}`;

  // Retry logic — survives intermittent connectivity (load-shedding, flaky networks)
  const MAX_RETRIES = 2;
  // Claude Opus 4.7 has two API incompatibilities vs Haiku/Sonnet:
  //   (1) `temperature` parameter deprecated — Opus returns 400 on any temp value.
  //   (2) assistant-message prefill not supported — Opus requires the conversation
  //       to end with a user message.
  // Detect and branch for opus models; keep original (tighter) behaviour for
  // haiku/sonnet where temperature + prefill give deterministic clean JSON.
  const _isOpus = /opus/i.test(TRIAGE_MODEL);
  const _triageApiParams = {
    model: TRIAGE_MODEL,
    max_tokens: 300,
    system: systemPrompt,
  };
  if (!_isOpus) {
    _triageApiParams.temperature = 0.1; // deterministic clinical decisions
  }
  const _triageMessages = _isOpus
    ? [{ role: 'user', content: text }]
    : [
        { role: 'user', content: text },
        { role: 'assistant', content: '{' }, // Prefill forces clean JSON on Haiku/Sonnet
      ];

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    try {
      const res = await anthropic.messages.create({
        ..._triageApiParams,
        messages: _triageMessages,
      });

      const rawText = res.content[0]?.text || '';
      try {
        // Haiku/Sonnet path: prepend the '{' we prefilled, then parse.
        // Opus path: response already includes leading '{' (no prefill),
        // so don't prepend. Strip code fences either way.
        const cleaned = rawText.replace(/```json|```/g, '').trim();
        const fullJson = _isOpus ? cleaned : '{' + cleaned;
        const parsed = JSON.parse(fullJson);
        return {
          triage_level: parsed.triage_level || 'YELLOW',
          confidence: parsed.confidence || 50,
          reasoning: parsed.reasoning || '',
          discriminator_matched: parsed.discriminator_matched || null,
          tews_score: parsed.tews_score ?? null,
        };
      } catch (parseErr) {
        if (rawText.includes('RED')) return { triage_level: 'RED', confidence: 100, reasoning: 'text_parse_fallback' };
        if (rawText.includes('ORANGE')) return { triage_level: 'ORANGE', confidence: 40, reasoning: 'text_parse_fallback' };
        if (rawText.includes('YELLOW')) return { triage_level: 'YELLOW', confidence: 40, reasoning: 'text_parse_fallback' };
        return { triage_level: 'YELLOW', confidence: 40, reasoning: 'parse_failure_default' };
      }
    } catch (apiErr) {
      if (attempt < MAX_RETRIES && (apiErr.status === 429 || apiErr.status >= 500 || apiErr.code === 'ECONNRESET' || apiErr.code === 'ETIMEDOUT')) {
        logger.warn(`[TRIAGE] API attempt ${attempt + 1} failed (${apiErr.code || apiErr.status}), retrying in ${(attempt + 1) * 2}s...`);
        await new Promise(r => setTimeout(r, (attempt + 1) * 2000));
        continue;
      }
      logger.error('[TRIAGE] AI call failed:', apiErr.message);
      return { triage_level: 'YELLOW', confidence: 30, reasoning: 'api_failure_default' };
    }
  }
  return { triage_level: 'YELLOW', confidence: 30, reasoning: 'api_failure_default' };
}

// ================== RULES ENGINE ==================
// ================== SELF-CARE ADVICE (GREEN triage) ==================
// Generates symptom-specific home care advice for GREEN patients.
// Uses the same triage model for cost efficiency.
// Advice is practical, SA-context-aware, and avoids medical jargon.
async function generateSelfCareAdvice(symptomsText, lang) {
  symptomsText = stripPII(symptomsText);
  const langNames = {
    en:'English', zu:'isiZulu', xh:'isiXhosa', af:'Afrikaans',
    nso:'Sepedi', tn:'Setswana', st:'Sesotho', ts:'Xitsonga',
    ss:'siSwati', ve:'Tshivenda', nr:'isiNdebele'
  };

  try {
    const res = await anthropic.messages.create({
      model: FAST_MODEL, // Haiku — self-care advice is simple text, speed matters
      max_tokens: 300,
      temperature: 0.7, // Medium temperature for natural, varied advice
      system: `You are a South African community health advisor giving practical self-care advice via WhatsApp.

The patient has been triaged as GREEN (routine/non-urgent). Give them specific, actionable home care advice.

RULES:
- Write in ${langNames[lang] || 'English'} (everyday spoken language, not textbook)
- Keep it SHORT — max 5 bullet points, WhatsApp-friendly
- Use practical SA advice (e.g. "drink rooibos tea", "take Panado from the pharmacy")
- Reference affordable, available remedies (not expensive brands)
- Include ONE clear warning sign that means they should come to the clinic
- Do NOT diagnose — give care tips only
- Start with "💊 *Self-care tips:*" 
- End with "⚠️ Come to the clinic if: [one specific warning sign]"
- No greetings, no disclaimers, just the tips`,
      messages: [{ role: 'user', content: `Patient symptoms: ${symptomsText}` }]
    });

    const advice = res.content[0].text.trim();
    // Safety check: don't send if it looks like a diagnosis or is too long
    if (advice.length > 800 || advice.toLowerCase().includes('diagnos')) {
      return null;
    }
    return advice;
  } catch (e) {
    logger.error('[SELF-CARE] AI generation failed:', e.message);
    return null;
  }
}

// ================== HEALTH EDUCATION (ALL TRIAGE LEVELS) ==================
// Generates post-visit health education for YELLOW/ORANGE/RED patients.
// Covers: what was treated, warning signs to return, medication adherence,
// and practical recovery advice. Sent as part of the DoH Exit Process.
async function generateHealthEducation(triageLevel, symptomsText, treatments, lang) {
  symptomsText = stripPII(symptomsText || '');
  const langNames = {
    en:'English', zu:'isiZulu', xh:'isiXhosa', af:'Afrikaans',
    nso:'Sepedi', tn:'Setswana', st:'Sesotho', ts:'Xitsonga',
    ss:'siSwati', ve:'Tshivenda', nr:'isiNdebele'
  };

  const levelContext = {
    RED: 'This patient was an emergency case. Focus on: recognising if the emergency is recurring, when to call an ambulance (10177), importance of follow-up visit.',
    ORANGE: 'This patient was urgent. Focus on: medication adherence, what warning signs mean they must return immediately, importance of the follow-up visit.',
    YELLOW: 'This patient was moderately urgent. Focus on: completing the full course of any medication, home care tips, warning signs to return, and when the next visit should be.',
  };

  const treatmentStr = (treatments || []).join(', ') || 'general consultation';

  try {
    const res = await anthropic.messages.create({
      model: FAST_MODEL,
      max_tokens: 350,
      temperature: 0.7,
      system: `You are a South African community health educator sending a WhatsApp message after a clinic visit.

Patient triage level: ${triageLevel}
Treatment received: ${treatmentStr}
${levelContext[triageLevel] || levelContext.YELLOW}

RULES:
- Write in ${langNames[lang] || 'English'} (everyday spoken language, not textbook)
- Keep it SHORT — max 5 bullet points, WhatsApp-friendly
- Use practical SA context (affordable, available)
- Include ONE specific warning sign that means they must return to the clinic immediately
- Include ONE medication adherence tip if medication was given
- Do NOT diagnose — give recovery and prevention tips only
- Start with "📚 *Health tips after your visit:*"
- End with "🚨 Return to the clinic immediately if: [one specific sign]"
- No greetings, no disclaimers, just the education content`,
      messages: [{ role: 'user', content: `Patient symptoms: ${symptomsText}. Treatments: ${treatmentStr}` }]
    });

    const education = res.content[0].text.trim();
    if (education.length > 900 || education.toLowerCase().includes('diagnos')) {
      return null;
    }
    return education;
  } catch (e) {
    logger.error('[HEALTH-ED] AI generation failed:', e.message);
    return null;
  }
}

// ================== RULES ENGINE — FULL SATS DISCRIMINATORS ==================
// Expanded from ~8 rules to full SA PHC-appropriate discriminator set.
// Discriminators fire BEFORE severity (true SATS order).
// Each match returns rule_override label for governance audit trail.
// ── ICD-10 Code Mapping for DCSL Discriminators ────────────────
// Maps each DCSL rule to its most applicable ICD-10-CM code.
// These are triage-level category codes, not clinical diagnoses.
// Used by FHIR Observation resources for interoperability.
const DCSL_ICD10_MAP = {
  // RED
  respiratory_cardiac_arrest: { code: 'I46.9', display: 'Cardiac arrest, cause unspecified' },
  unconscious: { code: 'R40.20', display: 'Unspecified coma' },
  active_seizure: { code: 'R56.9', display: 'Unspecified convulsions' },
  cardiac_emergency: { code: 'R07.9', display: 'Chest pain, unspecified' },
  cardiac_emergency_radiation: { code: 'I24.9', display: 'Acute ischaemic heart disease, unspecified' },
  acs_radiation: { code: 'I21.9', display: 'Acute myocardial infarction, unspecified' },
  obstetric_haemorrhage: { code: 'O46.90', display: 'Antepartum haemorrhage, unspecified' },
  obstetric_cord_or_fetal: { code: 'O69.0XX0', display: 'Labour complicated by prolapse of cord' },
  envenomation: { code: 'T63.091A', display: 'Toxic effect of snake venom, accidental, initial' },
  severe_burns: { code: 'T30.0', display: 'Burn of unspecified body region, unspecified degree' },
  neonatal_apnoea: { code: 'P28.4', display: 'Other apnoea of newborn' },
  paediatric_unconscious: { code: 'R40.20', display: 'Unspecified coma' },
  meningococcal_rash: { code: 'A39.0', display: 'Meningococcal meningitis' },
  anaphylaxis: { code: 'T78.2XXA', display: 'Anaphylactic shock, unspecified, initial' },
  traumatic_haemorrhage: { code: 'T79.2XXA', display: 'Traumatic secondary haemorrhage' },
  // RED language variants map to same codes
  respiratory_cardiac_arrest_zu: { code: 'I46.9', display: 'Cardiac arrest, cause unspecified' },
  respiratory_cardiac_arrest_xh: { code: 'I46.9', display: 'Cardiac arrest, cause unspecified' },
  respiratory_cardiac_arrest_af: { code: 'I46.9', display: 'Cardiac arrest, cause unspecified' },
  respiratory_cardiac_arrest_nso: { code: 'I46.9', display: 'Cardiac arrest, cause unspecified' },
  respiratory_cardiac_arrest_tn: { code: 'I46.9', display: 'Cardiac arrest, cause unspecified' },
  respiratory_cardiac_arrest_st: { code: 'I46.9', display: 'Cardiac arrest, cause unspecified' },
  respiratory_cardiac_arrest_ts: { code: 'I46.9', display: 'Cardiac arrest, cause unspecified' },
  respiratory_cardiac_arrest_ss: { code: 'I46.9', display: 'Cardiac arrest, cause unspecified' },
  respiratory_cardiac_arrest_ve: { code: 'I46.9', display: 'Cardiac arrest, cause unspecified' },
  respiratory_cardiac_arrest_nr: { code: 'I46.9', display: 'Cardiac arrest, cause unspecified' },
  unconscious_zu: { code: 'R40.20', display: 'Unspecified coma' },
  unconscious_xh: { code: 'R40.20', display: 'Unspecified coma' },
  unconscious_af: { code: 'R40.20', display: 'Unspecified coma' },
  unconscious_nso: { code: 'R40.20', display: 'Unspecified coma' },
  unconscious_tn: { code: 'R40.20', display: 'Unspecified coma' },
  unconscious_st: { code: 'R40.20', display: 'Unspecified coma' },
  unconscious_ts: { code: 'R40.20', display: 'Unspecified coma' },
  unconscious_ss: { code: 'R40.20', display: 'Unspecified coma' },
  unconscious_ve: { code: 'R40.20', display: 'Unspecified coma' },
  unconscious_nr: { code: 'R40.20', display: 'Unspecified coma' },
  active_seizure_zu: { code: 'R56.9', display: 'Unspecified convulsions' },
  active_seizure_xh: { code: 'R56.9', display: 'Unspecified convulsions' },
  active_seizure_af: { code: 'R56.9', display: 'Unspecified convulsions' },
  active_seizure_nso: { code: 'R56.9', display: 'Unspecified convulsions' },
  active_seizure_tn: { code: 'R56.9', display: 'Unspecified convulsions' },
  active_seizure_st: { code: 'R56.9', display: 'Unspecified convulsions' },
  active_seizure_ts: { code: 'R56.9', display: 'Unspecified convulsions' },
  active_seizure_ss: { code: 'R56.9', display: 'Unspecified convulsions' },
  active_seizure_ve: { code: 'R56.9', display: 'Unspecified convulsions' },
  active_seizure_nr: { code: 'R56.9', display: 'Unspecified convulsions' },
  cardiac_emergency_zu: { code: 'R07.9', display: 'Chest pain, unspecified' },
  cardiac_emergency_xh: { code: 'R07.9', display: 'Chest pain, unspecified' },
  cardiac_emergency_af: { code: 'R07.9', display: 'Chest pain, unspecified' },
  cardiac_emergency_nso: { code: 'R07.9', display: 'Chest pain, unspecified' },
  cardiac_emergency_tn: { code: 'R07.9', display: 'Chest pain, unspecified' },
  cardiac_emergency_st: { code: 'R07.9', display: 'Chest pain, unspecified' },
  cardiac_emergency_ts: { code: 'R07.9', display: 'Chest pain, unspecified' },
  cardiac_emergency_ss: { code: 'R07.9', display: 'Chest pain, unspecified' },
  cardiac_emergency_ve: { code: 'R07.9', display: 'Chest pain, unspecified' },
  cardiac_emergency_nr: { code: 'R07.9', display: 'Chest pain, unspecified' },
  severe_burns_context: { code: 'T30.0', display: 'Burn of unspecified body region' },
  severe_burns_nso: { code: 'T30.0', display: 'Burn of unspecified body region' },
  severe_burns_tn: { code: 'T30.0', display: 'Burn of unspecified body region' },
  severe_burns_st: { code: 'T30.0', display: 'Burn of unspecified body region' },
  severe_burns_ts: { code: 'T30.0', display: 'Burn of unspecified body region' },
  severe_burns_ss: { code: 'T30.0', display: 'Burn of unspecified body region' },
  severe_burns_ve: { code: 'T30.0', display: 'Burn of unspecified body region' },
  severe_burns_nr: { code: 'T30.0', display: 'Burn of unspecified body region' },
  // ORANGE
  stroke_facial_droop: { code: 'I63.9', display: 'Cerebral infarction, unspecified' },
  stroke_arm_weakness: { code: 'I63.9', display: 'Cerebral infarction, unspecified' },
  stroke_speech: { code: 'I63.9', display: 'Cerebral infarction, unspecified' },
  thunderclap_headache: { code: 'R51.9', display: 'Headache, unspecified' },
  post_ictal: { code: 'R56.9', display: 'Unspecified convulsions' },
  post_ictal_zu: { code: 'R56.9', display: 'Unspecified convulsions' },
  post_ictal_nso: { code: 'R56.9', display: 'Unspecified convulsions' },
  post_ictal_tn: { code: 'R56.9', display: 'Unspecified convulsions' },
  post_ictal_st: { code: 'R56.9', display: 'Unspecified convulsions' },
  post_ictal_ts: { code: 'R56.9', display: 'Unspecified convulsions' },
  post_ictal_ss: { code: 'R56.9', display: 'Unspecified convulsions' },
  post_ictal_ve: { code: 'R56.9', display: 'Unspecified convulsions' },
  post_ictal_nr: { code: 'R56.9', display: 'Unspecified convulsions' },
  severe_asthma: { code: 'J45.51', display: 'Severe persistent asthma with acute exacerbation' },
  pre_eclampsia: { code: 'O14.90', display: 'Unspecified pre-eclampsia' },
  ectopic_pregnancy: { code: 'O00.90', display: 'Unspecified ectopic pregnancy' },
  febrile_seizure: { code: 'R56.00', display: 'Simple febrile convulsions' },
  infant_sepsis_screen: { code: 'A41.9', display: 'Sepsis, unspecified organism (screen)' },
  hiv_meningism: { code: 'G03.9', display: 'Meningitis, unspecified (HIV context screen)' },
  acute_confusion_chronic: { code: 'R41.0', display: 'Disorientation, unspecified' },
  head_trauma_loc: { code: 'S06.9X0A', display: 'Intracranial injury, unspecified, initial' },
  head_trauma_loc_zu: { code: 'S06.9X0A', display: 'Intracranial injury, unspecified, initial' },
  open_fracture: { code: 'T14.8XXA', display: 'Other injury of unspecified body region, initial' },
  high_energy_mechanism: { code: 'V89.2XXA', display: 'Person injured in unspecified motor-vehicle accident' },
  burns_significant: { code: 'T30.0', display: 'Burn of unspecified body region' },
  burns_xh: { code: 'T30.0', display: 'Burn of unspecified body region' },
  acute_abdomen: { code: 'R10.0', display: 'Acute abdomen' },
  psychiatric_emergency_imminent: { code: 'T14.91XA', display: 'Suicide attempt, initial encounter' },
  severe_hypoglycaemia: { code: 'E16.2', display: 'Hypoglycaemia, unspecified' },
  preterm_labour: { code: 'O60.10X0', display: 'Preterm labour with preterm delivery' },
  acute_confusion_dm_af: { code: 'R41.0', display: 'Disorientation, unspecified' },
  // ORANGE — GBV
  gbv_sexual_assault: { code: 'T74.21XA', display: 'Adult sexual abuse, confirmed, initial' },
  // YELLOW
  severe_pain: { code: 'R52', display: 'Pain, unspecified' },
  suicidal_ideation: { code: 'R45.851', display: 'Suicidal ideations' },
  abuse_assault: { code: 'T74.11XA', display: 'Adult physical abuse, confirmed, initial' },
  pyelonephritis: { code: 'N10', display: 'Acute tubulo-interstitial nephritis' },
  dka: { code: 'E11.65', display: 'Type 2 diabetes with hyperglycaemia' },
  tb_triad: { code: 'R05.3', display: 'Chronic cough' },
  possible_fracture: { code: 'M84.9XXA', display: 'Disorder of continuity of bone, unspecified, initial' },
  hypertensive_urgency: { code: 'I16.0', display: 'Hypertensive urgency' },
  hypertensive_urgency_reading: { code: 'I16.0', display: 'Hypertensive urgency' },
  appendicitis_pattern: { code: 'K35.80', display: 'Unspecified acute appendicitis' },
  asthma_inhaler_failure: { code: 'J45.41', display: 'Moderate persistent asthma with acute exacerbation' },
  meningism: { code: 'R29.1', display: 'Meningismus' },
  hiv_fever: { code: 'B20', display: 'HIV disease' },
  lower_abdo_missed_period: { code: 'O00.90', display: 'Unspecified ectopic pregnancy' },
  pregnancy_complication: { code: 'O26.90', display: 'Pregnancy-related condition, unspecified' },
  gi_bleeding: { code: 'K92.2', display: 'Gastrointestinal haemorrhage, unspecified' },
  deep_wound: { code: 'T14.8XXA', display: 'Other injury of unspecified body region, initial' },
  severe_dehydration_vulnerable: { code: 'E86.0', display: 'Dehydration' },
  eye_emergency: { code: 'H57.9', display: 'Unspecified disorder of eye and adnexa' },
  testicular_torsion: { code: 'N44.00', display: 'Torsion of testis, unspecified' },
  // Safety nets
  green_safety_net: { code: 'R69', display: 'Illness, unspecified' },
  yellow_safety_net: { code: 'R69', display: 'Illness, unspecified' },
};

function applyClinicalRules(text, triage) {
  const lower = (text || '').toLowerCase();
  const has = (...terms) => terms.some(t => lower.includes(t));

  // ── RED DISCRIMINATORS ──
  const red = (rule) => ({
    triage_level: 'RED', confidence: 100, rule_override: rule,
    icd10: DCSL_ICD10_MAP[rule] || null,
  });

  // ════════════════════════════════════════════════════════════════
  // RED 1: RESPIRATORY / CARDIAC ARREST — not breathing, heart stopped
  // ════════════════════════════════════════════════════════════════
  if (has(...DCSL_KEYWORDS.respiratory_cardiac_arrest_kw))
    return red('respiratory_cardiac_arrest');
  if (has(...DCSL_KEYWORDS.respiratory_cardiac_arrest_zu_kw))
    return red('respiratory_cardiac_arrest_zu');
  if (has(...DCSL_KEYWORDS.respiratory_cardiac_arrest_xh_kw))
    return red('respiratory_cardiac_arrest_xh');
  if (has(...DCSL_KEYWORDS.respiratory_cardiac_arrest_af_kw))
    return red('respiratory_cardiac_arrest_af');
  if (has(...DCSL_KEYWORDS.respiratory_cardiac_arrest_nso_kw))
    return red('respiratory_cardiac_arrest_nso');
  if (has(...DCSL_KEYWORDS.respiratory_cardiac_arrest_nso_kw))
    return red('respiratory_cardiac_arrest_tn');
  if (has(...DCSL_KEYWORDS.respiratory_cardiac_arrest_st_kw))
    return red('respiratory_cardiac_arrest_st');
  if (has(...DCSL_KEYWORDS.respiratory_cardiac_arrest_ts_kw))
    return red('respiratory_cardiac_arrest_ts');
  if (has(...DCSL_KEYWORDS.respiratory_cardiac_arrest_ss_kw))
    return red('respiratory_cardiac_arrest_ss');
  if (has(...DCSL_KEYWORDS.respiratory_cardiac_arrest_ve_kw))
    return red('respiratory_cardiac_arrest_ve');
  if (has(...DCSL_KEYWORDS.respiratory_cardiac_arrest_nr_kw))
    return red('respiratory_cardiac_arrest_nr');

  // ════════════════════════════════════════════════════════════════
  // RED 2: UNCONSCIOUS — unresponsive, not waking, collapsed
  // ════════════════════════════════════════════════════════════════
  if (has(...DCSL_KEYWORDS.unconscious_kw))
    return red('unconscious');
  if (has(...DCSL_KEYWORDS.unconscious_zu_kw))
    return red('unconscious_zu');
  if (has(...DCSL_KEYWORDS.unconscious_xh_kw))
    return red('unconscious_xh');
  if (has(...DCSL_KEYWORDS.unconscious_af_kw))
    return red('unconscious_af');
  if (has(...DCSL_KEYWORDS.unconscious_nso_kw))
    return red('unconscious_nso');
  if (has(...DCSL_KEYWORDS.unconscious_tn_kw))
    return red('unconscious_tn');
  if (has(...DCSL_KEYWORDS.unconscious_st_kw))
    return red('unconscious_st');
  if (has(...DCSL_KEYWORDS.unconscious_ts_kw))
    return red('unconscious_ts');
  if (has(...DCSL_KEYWORDS.unconscious_ss_kw))
    return red('unconscious_ss');
  if (has(...DCSL_KEYWORDS.unconscious_ve_kw))
    return red('unconscious_ve');
  if (has(...DCSL_KEYWORDS.unconscious_nr_kw))
    return red('unconscious_nr');

  // ════════════════════════════════════════════════════════════════
  // RED 3: ACTIVE SEIZURE — currently fitting, convulsing
  // ════════════════════════════════════════════════════════════════
  if (has(...DCSL_KEYWORDS.active_seizure_kw))
    return red('active_seizure');
  if (has(...DCSL_KEYWORDS.active_seizure_zu_kw))
    return red('active_seizure_zu');
  if (has(...DCSL_KEYWORDS.active_seizure_xh_kw))
    return red('active_seizure_xh');
  if (has(...DCSL_KEYWORDS.active_seizure_af_kw))
    return red('active_seizure_af');
  if (has(...DCSL_KEYWORDS.active_seizure_nso_kw))
    return red('active_seizure_nso');
  if (has(...DCSL_KEYWORDS.active_seizure_tn_kw))
    return red('active_seizure_tn');
  if (has(...DCSL_KEYWORDS.active_seizure_st_kw))
    return red('active_seizure_st');
  if (has(...DCSL_KEYWORDS.active_seizure_ts_kw))
    return red('active_seizure_ts');
  if (has(...DCSL_KEYWORDS.active_seizure_ss_kw))
    return red('active_seizure_ss');
  if (has(...DCSL_KEYWORDS.active_seizure_ve_kw))
    return red('active_seizure_ve');
  if (has(...DCSL_KEYWORDS.active_seizure_nr_kw))
    return red('active_seizure_nr');

  // ════════════════════════════════════════════════════════════════
  // RED 4: CARDIAC EMERGENCY — chest pain + breathing difficulty
  // ════════════════════════════════════════════════════════════════
  if (has(...DCSL_KEYWORDS.cardiac_emergency_kw) && has(...DCSL_KEYWORDS.cardiac_emergency_kw_2))
    return red('cardiac_emergency');

  // RED 4b: CARDIAC ACS VARIANT — chest pain + (arm radiation OR jaw pain OR diaphoresis) → RED
  // Complements the chest+breathing rule above. Surfaced by eval P01: chest + arm
  // heaviness + sweating had no deterministic net; LLM caught it at 95% confidence
  // but no fallback existed. Extended to all 11 languages (nso/tn/st/ts/ss/ve/nr
  // pending native-speaker review).
  if (has(...DCSL_KEYWORDS.cardiac_emergency_radiation_kw) &&                                         // nr
      has(...DCSL_KEYWORDS.cardiac_emergency_radiation_kw_2))                            // nr
    return red('cardiac_emergency_radiation');
  if (has(...DCSL_KEYWORDS.cardiac_emergency_zu_kw) && has(...DCSL_KEYWORDS.cardiac_emergency_zu_kw_2))
    return red('cardiac_emergency_zu');
  if (has(...DCSL_KEYWORDS.cardiac_emergency_zu_kw) && has(...DCSL_KEYWORDS.cardiac_emergency_xh_kw))
    return red('cardiac_emergency_xh');
  if (has(...DCSL_KEYWORDS.cardiac_emergency_af_kw) && has(...DCSL_KEYWORDS.cardiac_emergency_af_kw_2))
    return red('cardiac_emergency_af');
  if (has(...DCSL_KEYWORDS.cardiac_emergency_nso_kw) && has(...DCSL_KEYWORDS.cardiac_emergency_nso_kw_2))
    return red('cardiac_emergency_nso');
  if (has(...DCSL_KEYWORDS.cardiac_emergency_nso_kw) && has(...DCSL_KEYWORDS.cardiac_emergency_nso_kw_2))
    return red('cardiac_emergency_tn');
  if (has(...DCSL_KEYWORDS.cardiac_emergency_st_kw) && has(...DCSL_KEYWORDS.cardiac_emergency_st_kw_2))
    return red('cardiac_emergency_st');
  if (has(...DCSL_KEYWORDS.cardiac_emergency_ts_kw) && has(...DCSL_KEYWORDS.cardiac_emergency_ts_kw_2))
    return red('cardiac_emergency_ts');
  if (has(...DCSL_KEYWORDS.cardiac_emergency_ss_kw) && has(...DCSL_KEYWORDS.cardiac_emergency_ss_kw_2))
    return red('cardiac_emergency_ss');
  if (has(...DCSL_KEYWORDS.cardiac_emergency_ve_kw) && has(...DCSL_KEYWORDS.cardiac_emergency_ve_kw_2))
    return red('cardiac_emergency_ve');
  if (has(...DCSL_KEYWORDS.cardiac_emergency_zu_kw) && has(...DCSL_KEYWORDS.cardiac_emergency_nr_kw))
    return red('cardiac_emergency_nr');

  // ════════════════════════════════════════════════════════════════
  // RED 5: ACS RADIATION — chest pain + arm/jaw pain + sweating
  // Extended to all 11 languages (nso/tn/st/ts/ss/ve/nr pending native-speaker review)
  // ════════════════════════════════════════════════════════════════
  if (has(...DCSL_KEYWORDS.acs_radiation_kw) &&                               // nr
      has(...DCSL_KEYWORDS.acs_radiation_kw_2))                                 // nr
    return red('acs_radiation');

  // ════════════════════════════════════════════════════════════════
  // RED 6: OBSTETRIC HAEMORRHAGE — pregnant + bleeding
  // ════════════════════════════════════════════════════════════════
  if ((has(...DCSL_KEYWORDS.obstetric_haemorrhage_kw)) &&
      has(...DCSL_KEYWORDS.obstetric_haemorrhage_kw_2))
    return red('obstetric_haemorrhage');

  // ════════════════════════════════════════════════════════════════
  // RED 7: OBSTETRIC CORD / FETAL EMERGENCY
  // ════════════════════════════════════════════════════════════════
  if (has(...DCSL_KEYWORDS.obstetric_cord_or_fetal_kw))                                       // nr
    return red('obstetric_cord_or_fetal');

  // ════════════════════════════════════════════════════════════════
  // RED 8: SNAKE BITE — all 11 languages
  // ════════════════════════════════════════════════════════════════
  if (has(...DCSL_KEYWORDS.envenomation_kw))
    return red('envenomation');

  // ════════════════════════════════════════════════════════════════
  // RED 9: SEVERE BURNS
  // ════════════════════════════════════════════════════════════════
  if (has(...DCSL_KEYWORDS.severe_burns_kw))
    return red('severe_burns');
  if (has(...DCSL_KEYWORDS.severe_burns_zu_kw))
    return red('severe_burns_zu');
  if (has(...DCSL_KEYWORDS.severe_burns_xh_kw))
    return red('severe_burns_xh');
  if (has(...DCSL_KEYWORDS.severe_burns_af_kw))
    return red('severe_burns_af');
  if (has(...DCSL_KEYWORDS.severe_burns_context_kw) &&                                     // nr
      has(...DCSL_KEYWORDS.severe_burns_context_kw_2))                 // nr
    return red('severe_burns_context');
  if (has(...DCSL_KEYWORDS.severe_burns_nso_kw))
    return red('severe_burns_nso');
  if (has(...DCSL_KEYWORDS.severe_burns_tn_kw))
    return red('severe_burns_tn');
  if (has(...DCSL_KEYWORDS.severe_burns_st_kw))
    return red('severe_burns_st');
  if (has(...DCSL_KEYWORDS.severe_burns_ts_kw))
    return red('severe_burns_ts');
  if (has(...DCSL_KEYWORDS.severe_burns_ss_kw))
    return red('severe_burns_ss');
  if (has(...DCSL_KEYWORDS.severe_burns_ve_kw))
    return red('severe_burns_ve');
  if (has(...DCSL_KEYWORDS.severe_burns_nr_kw))
    return red('severe_burns_nr');

  // ════════════════════════════════════════════════════════════════
  // RED 10: NEONATAL APNOEA / PAEDIATRIC UNCONSCIOUS
  // ════════════════════════════════════════════════════════════════
  if (has(...DCSL_KEYWORDS.neonatal_apnoea_kw))                                                         // nr
    return red('neonatal_apnoea');
  if (has(...DCSL_KEYWORDS.paediatric_unconscious_kw))                                                              // nr
    return red('paediatric_unconscious');

  // ════════════════════════════════════════════════════════════════
  // RED 11: MENINGOCOCCAL RASH — purple/non-blanching
  // Extended to all 11 languages (nso/tn/st/ts/ve/nr pending native-speaker review)
  // ════════════════════════════════════════════════════════════════
  if (has(...DCSL_KEYWORDS.meningococcal_rash_kw))                                       // nr
    return red('meningococcal_rash');

  // ════════════════════════════════════════════════════════════════
  // RED 12: ANAPHYLAXIS — throat/face swelling after sting/food
  // ════════════════════════════════════════════════════════════════
  if ((has(...DCSL_KEYWORDS.anaphylaxis_kw)) &&
      has(...DCSL_KEYWORDS.anaphylaxis_kw_2))
    return red('anaphylaxis');

  // ════════════════════════════════════════════════════════════════
  // RED 13: TRAUMATIC HAEMORRHAGE — uncontrollable bleeding
  // ════════════════════════════════════════════════════════════════
  if (has(...DCSL_KEYWORDS.traumatic_haemorrhage_kw))
    return red('traumatic_haemorrhage');

  // ── ORANGE DISCRIMINATORS ──
  const orange = (rule) => ({
    triage_level: 'ORANGE', confidence: 95, rule_override: rule,
    icd10: DCSL_ICD10_MAP[rule] || null,
  });

  // STROKE — facial droop, arm weakness, speech (FAST signs) — all 11 languages
  if (has(...DCSL_KEYWORDS.stroke_facial_droop_kw))
    return orange('stroke_facial_droop');
  if (has(...DCSL_KEYWORDS.stroke_arm_weakness_kw))
    return orange('stroke_arm_weakness');
  if (has(...DCSL_KEYWORDS.stroke_speech_kw))
    return orange('stroke_speech');
  if (has(...DCSL_KEYWORDS.thunderclap_headache_kw))
    return orange('thunderclap_headache');

  // POST-ICTAL — had a fit, now confused/drowsy — all 11 languages
  if ((has(...DCSL_KEYWORDS.post_ictal_kw)) &&
      has(...DCSL_KEYWORDS.post_ictal_kw_2))
    return orange('post_ictal');
  if (has(...DCSL_KEYWORDS.post_ictal_zu_kw) && has(...DCSL_KEYWORDS.post_ictal_zu_kw_2))
    return orange('post_ictal_zu');
  if ((has(...DCSL_KEYWORDS.post_ictal_nso_kw)) && has(...DCSL_KEYWORDS.post_ictal_nso_kw_2))
    return orange('post_ictal_nso');
  if ((has(...DCSL_KEYWORDS.post_ictal_tn_kw)) && has(...DCSL_KEYWORDS.post_ictal_tn_kw_2))
    return orange('post_ictal_tn');
  if ((has(...DCSL_KEYWORDS.post_ictal_st_kw)) && has(...DCSL_KEYWORDS.post_ictal_st_kw_2))
    return orange('post_ictal_st');
  if ((has(...DCSL_KEYWORDS.post_ictal_ts_kw)) && has(...DCSL_KEYWORDS.post_ictal_ts_kw_2))
    return orange('post_ictal_ts');
  if ((has(...DCSL_KEYWORDS.post_ictal_ss_kw)) && has(...DCSL_KEYWORDS.post_ictal_ss_kw_2))
    return orange('post_ictal_ss');
  if ((has(...DCSL_KEYWORDS.post_ictal_ve_kw)) && has(...DCSL_KEYWORDS.post_ictal_ve_kw_2))
    return orange('post_ictal_ve');
  if ((has(...DCSL_KEYWORDS.post_ictal_nr_kw)) && has(...DCSL_KEYWORDS.post_ictal_nr_kw_2))
    return orange('post_ictal_nr');

  // SEVERE ASTHMA — inhaler not working, can't speak
  if ((has(...DCSL_KEYWORDS.severe_asthma_kw)) ||
      has(...DCSL_KEYWORDS.severe_asthma_kw_2))
    if (has(...DCSL_KEYWORDS.severe_asthma_kw_3))
      return orange('severe_asthma');

  // PRE-ECLAMPSIA — pregnant + headache + swelling/vision (all 11 languages)
  if ((has(...DCSL_KEYWORDS.pre_eclampsia_kw)) &&
      has(...DCSL_KEYWORDS.pre_eclampsia_kw_2))
    return orange('pre_eclampsia');

  // ECTOPIC PREGNANCY — missed period + severe one-sided pain
  if (has(...DCSL_KEYWORDS.ectopic_pregnancy_kw) &&
      has(...DCSL_KEYWORDS.ectopic_pregnancy_kw_2))                                                              // nr
    return orange('ectopic_pregnancy');

  // FEBRILE SEIZURE — child + fit + fever (all 11 languages)
  if ((has(...DCSL_KEYWORDS.febrile_seizure_kw)) &&
      has(...DCSL_KEYWORDS.febrile_seizure_kw_2) &&
      has(...DCSL_KEYWORDS.febrile_seizure_kw_3))
    return orange('febrile_seizure');

  // ═══════════════════════════════════════════════════════════════════
  // INFANT SEPSIS SCREEN — infant + fever + (poor feeding OR lethargy) → ORANGE
  // ═══════════════════════════════════════════════════════════════════
  // Captures textbook serious-bacterial-infection / sepsis presentation in
  // infants. Surfaced by eval P09: 6-month-old with fever + won't eat + very
  // sleepy previously stayed YELLOW because paediatric up-weighting was only
  // in the prompt instruction (line 264), not deterministic code.
  //
  // Native-speaker review REQUIRED for non-English keyword sets before pilot.
  // Zulu/Xhosa/Afrikaans entries derived from existing multilingual patterns
  // (febrile_seizure, paediatric_unconscious); other languages need validation.
  {
    const isInfant = has(...DCSL_KEYWORDS.infant_sepsis_screen_kw);

    const infantHasFever = has(...DCSL_KEYWORDS.infant_sepsis_screen_kw_2);

    const infantPoorFeeding = has(...DCSL_KEYWORDS.infant_sepsis_screen_kw_3);

    const infantLethargy = has(...DCSL_KEYWORDS.infant_sepsis_screen_kw_4);

    if (isInfant && infantHasFever && (infantPoorFeeding || infantLethargy)) {
      logger.warn('[RULE] infant_sepsis_screen — infant + fever + (poor feeding OR lethargy)');
      return orange('infant_sepsis_screen');
    }
  }

  // ACUTE CONFUSION + CHRONIC DISEASE — all 11 languages
  if ((has(...DCSL_KEYWORDS.acute_confusion_chronic_kw)) &&
      (has(...DCSL_KEYWORDS.acute_confusion_chronic_kw_2)))
    return orange('acute_confusion_chronic');

  // HEAD TRAUMA + LOC — head injury + loss of consciousness or altered state. All 11 languages.
  if (has(...DCSL_KEYWORDS.head_trauma_loc_kw) &&                                                                   // nr
      has(...DCSL_KEYWORDS.head_trauma_loc_kw_2))                                                                          // nr
    return orange('head_trauma_loc');
  if ((has(...DCSL_KEYWORDS.head_trauma_loc_zu_kw)) && has(...DCSL_KEYWORDS.head_trauma_loc_zu_kw_2))
    return orange('head_trauma_loc_zu');

  // OPEN FRACTURE — bone visible through skin. All 11 languages.
  if (has(...DCSL_KEYWORDS.open_fracture_kw))                                                   // nr
    return orange('open_fracture');

  // HIGH-ENERGY MECHANISM — car / fall from height / crush. All 11 languages.
  if (has(...DCSL_KEYWORDS.high_energy_mechanism_kw))                                     // nr
    return orange('high_energy_mechanism');

  // BURNS SIGNIFICANT — burn + high-risk anatomy (face, airway, hands, large area). All 11 languages.
  if (has(...DCSL_KEYWORDS.burns_significant_kw) &&                                                                   // nr
      has(...DCSL_KEYWORDS.burns_significant_kw_2))                                 // nr
    return orange('burns_significant');
  if (has(...DCSL_KEYWORDS.burns_xh_kw) || (has(...DCSL_KEYWORDS.burns_xh_kw_2) && has(...DCSL_KEYWORDS.burns_xh_kw_3)))
    return orange('burns_xh');

  // ACUTE ABDOMEN — rigid/board-like abdomen, severe immovable pain. All 11 languages
  // (nso/tn/st/ts/ss/ve/nr pending native-speaker review).
  if (has(...DCSL_KEYWORDS.acute_abdomen_kw))                    // nr
    return orange('acute_abdomen');

  // PSYCHIATRIC EMERGENCY IMMINENT — active self-harm risk or attempt in progress. All 11 languages.
  if (has(...DCSL_KEYWORDS.psychiatric_emergency_imminent_kw))                                 // nr
    return orange('psychiatric_emergency_imminent');

  // SEVERE HYPOGLYCAEMIA — low sugar + altered consciousness/behaviour. All 11 languages.
  if ((has(...DCSL_KEYWORDS.severe_hypoglycaemia_kw)) &&                                                           // nr
      has(...DCSL_KEYWORDS.severe_hypoglycaemia_kw_2))                                                 // nr
    return orange('severe_hypoglycaemia');

  if ((has(...DCSL_KEYWORDS.preterm_labour_kw)) &&
      has(...DCSL_KEYWORDS.preterm_labour_kw_2) &&
      has(...DCSL_KEYWORDS.preterm_labour_kw_3))
    return orange('preterm_labour');

  // ── YELLOW DISCRIMINATORS ──
  const yellow = (rule) => ({
    triage_level: 'YELLOW', confidence: 85, rule_override: rule,
    icd10: DCSL_ICD10_MAP[rule] || null,
  });

  if (has(...DCSL_KEYWORDS.severe_pain_kw))                                       // nr
    return yellow('severe_pain');

  if (has(...DCSL_KEYWORDS.suicidal_ideation_kw))                                   // nr
    return yellow('suicidal_ideation');

  // GBV / Sexual assault — ORANGE (not YELLOW) for rape/sexual assault
  // Rape survivors need immediate care: PEP within 72h, emergency contraception within 120h
  if (has(...DCSL_KEYWORDS.abuse_assault_kw))
    return { triage_level: 'ORANGE', confidence: 100, rule_override: 'gbv_sexual_assault', icd10: DCSL_ICD10_MAP.gbv_sexual_assault };

  // GBV / domestic violence / assault — YELLOW
  if (has(...DCSL_KEYWORDS.abuse_assault_kw_2))
    return yellow('abuse_assault');

  if ((has(...DCSL_KEYWORDS.pyelonephritis_kw)) &&                                // nr
      has(...DCSL_KEYWORDS.pyelonephritis_kw_2))                                       // nr
    return yellow('pyelonephritis');

  if ((has(...DCSL_KEYWORDS.dka_kw)) &&                                            // nr
      has(...DCSL_KEYWORDS.dka_kw_2) &&                               // nr
      has(...DCSL_KEYWORDS.dka_kw_3))                                                   // nr
    return yellow('dka');

  if (has(...DCSL_KEYWORDS.tb_triad_kw) &&                                                                // ve
      has(...DCSL_KEYWORDS.tb_triad_kw_2) &&                                                           // nr
      has(...DCSL_KEYWORDS.tb_triad_kw_3))                                                            // nr
    return yellow('tb_triad');

  if ((has(...DCSL_KEYWORDS.possible_fracture_kw)) &&
      has(...DCSL_KEYWORDS.possible_fracture_kw_2))
    return yellow('possible_fracture');

  if ((has(...DCSL_KEYWORDS.hypertensive_urgency_kw)) &&                               // nr
      has(...DCSL_KEYWORDS.hypertensive_urgency_kw_2))                                                           // nr
    return yellow('hypertensive_urgency');
  if (has(...DCSL_KEYWORDS.hypertensive_urgency_reading_kw) && has(...DCSL_KEYWORDS.hypertensive_urgency_reading_kw_2))
    return yellow('hypertensive_urgency_reading');

  if (has(...DCSL_KEYWORDS.appendicitis_pattern_kw) &&
      has(...DCSL_KEYWORDS.appendicitis_pattern_kw_2))
    return yellow('appendicitis_pattern');

  if ((has(...DCSL_KEYWORDS.asthma_inhaler_failure_kw) || has(...DCSL_KEYWORDS.asthma_inhaler_failure_kw_2)) && has(...DCSL_KEYWORDS.asthma_inhaler_failure_kw_3))
    return yellow('asthma_inhaler_failure');

  // ═══════════════════════════════════════════════════════════════════
  // HIV + meningism = ORANGE (hiv_meningism)
  // ═══════════════════════════════════════════════════════════════════
  // Must fire BEFORE the YELLOW meningism rule below, so HIV+ patients with
  // meningism signs are escalated. Surfaced by eval P16 variance probe
  // (N=5): turn 3 returned YELLOW 4/5 times when patient had HIV + fever +
  // headache + mild neck stiffness — textbook HIV meningitis signal that
  // LLM only caught 20% of the time without a deterministic rule.
  // Keyword sets reuse the existing hiv_fever (line ~1483) and
  // meningism (line ~1467) sets. Non-English meningism keywords carried
  // forward from the YELLOW meningism rule and still need native-speaker
  // review (tracked under C4 remediation).
  // Detect HIV + fever + ANY meningism sign (neck stiffness/pain or photophobia
  // or classic meningism phrasing). Uses compositional "neck AND stiff/pain"
  // matching so natural phrases like "my neck feels a bit stiff" trigger.
  // Over-triage tolerant: meningism in HIV+ patient has high mortality cost
  // (TB meningitis, cryptococcal meningitis, bacterial meningitis). ORANGE
  // same-day review is the safety-correct default.
  {
    const hasHivSignal = has(...DCSL_KEYWORDS.hivSignal);
    const hasFeverSignal = has(...DCSL_KEYWORDS.feverSignal);
    const hasNeckTerm = has(...DCSL_KEYWORDS.neckTerm);
    const hasStiffOrPainTerm = has(...DCSL_KEYWORDS.stiffOrPainTerm);
    if (hasHivSignal && hasFeverSignal && hasNeckTerm && hasStiffOrPainTerm) {
      logger.warn('[RULE] hiv_meningism — HIV + fever + neck stiffness/pain → ORANGE');
      return orange('hiv_meningism');
    }
  }

  if (has(...DCSL_KEYWORDS.meningism_kw) &&
      has(...DCSL_KEYWORDS.meningism_kw_2))                                           // nr
    return yellow('meningism');

  // HIV + fever: risk-UPGRADE signal. Enforce YELLOW as a floor, preserve any
  // higher level the LLM already assigned (eval P16 caught this overwriting ORANGE).
  if ((has(...DCSL_KEYWORDS.hiv_fever_kw)) && has(...DCSL_KEYWORDS.hiv_fever_kw_2)) {
    const LEVEL_RANK = { GREEN: 0, YELLOW: 1, ORANGE: 2, RED: 3 };
    const currentRank = LEVEL_RANK[triage?.triage_level] ?? 0;
    if (currentRank >= LEVEL_RANK.YELLOW) {
      return {
        ...triage,
        rule_override: triage.rule_override || 'hiv_fever',
        icd10: triage.icd10 || DCSL_ICD10_MAP.hiv_fever || null,
      };
    }
    return yellow('hiv_fever');
  }

  if (has(...DCSL_KEYWORDS.lower_abdo_missed_period_kw) && has(...DCSL_KEYWORDS.lower_abdo_missed_period_kw_2))
    return yellow('lower_abdo_missed_period');

  if ((has(...DCSL_KEYWORDS.preterm_labour_kw)) &&
      has(...DCSL_KEYWORDS.pregnancy_complication_kw))
    return yellow('pregnancy_complication');

  if (has(...DCSL_KEYWORDS.gi_bleeding_kw))                                    // nr
    return yellow('gi_bleeding');

  if ((has(...DCSL_KEYWORDS.deep_wound_kw)) &&
      !has(...DCSL_KEYWORDS.deep_wound_kw_2))
    return yellow('deep_wound');

  if (has(...DCSL_KEYWORDS.severe_dehydration_vulnerable_kw) &&
      has(...DCSL_KEYWORDS.severe_dehydration_vulnerable_kw_2))
    return yellow('severe_dehydration_vulnerable');

  if ((has(...DCSL_KEYWORDS.eye_emergency_kw)) ||
      (has(...DCSL_KEYWORDS.eye_emergency_kw_2) && has(...DCSL_KEYWORDS.eye_emergency_kw_3)))
    return yellow('eye_emergency');

  if (has(...DCSL_KEYWORDS.testicular_torsion_kw) && has(...DCSL_KEYWORDS.testicular_torsion_kw_2))
    return yellow('testicular_torsion');

  // ── Afrikaans: confusion + diabetes (kept from original) ──
  if ((lower.includes('deurmekaar') || lower.includes('maak nie sin')) &&
      (lower.includes('suiker') || lower.includes('diabete')))
    return orange('acute_confusion_dm_af');

  // ── UNDER-TRIAGE SAFETY NETS ──
  // NOHARM study (Stanford/Harvard 2026): 77% of severe harm from AI failing to act, not from wrong action.
  // These safety nets catch under-triage that the DCSL discriminators above missed
  // because the patient used unexpected phrasing.

  // YELLOW → ORANGE safety net: catches ORANGE-level signals the AI classified as YELLOW
  if (triage.triage_level === 'YELLOW') {
    const orangeConcerns =
      // Stroke signs — any combination of face/arm/speech problems
      (has(...DCSL_KEYWORDS.kw) &&
       has(...DCSL_KEYWORDS.kw_2)) ||
      // Pregnant + severe headache + vision changes (pre-eclampsia)
      (has(...DCSL_KEYWORDS.kw_3) &&
       has(...DCSL_KEYWORDS.kw_4) &&
       has(...DCSL_KEYWORDS.kw_5)) ||
      // Child + seizure/fitting + fever (febrile seizure)
      (has(...DCSL_KEYWORDS.kw_6) &&
       has(...DCSL_KEYWORDS.kw_7) &&
       has(...DCSL_KEYWORDS.kw_8)) ||
      // Confusion + known chronic disease (DM/HTN/HIV)
      (has(...DCSL_KEYWORDS.kw_9) &&
       has(...DCSL_KEYWORDS.kw_10)) ||
      // Sudden worst-ever headache (thunderclap — may not have matched exact DCSL phrase)
      (has(...DCSL_KEYWORDS.kw_11));

    if (orangeConcerns) {
      logger.warn('[SAFETY-NET] YELLOW upgrade to ORANGE — ORANGE-level signals in YELLOW triage');
      return { triage_level: 'ORANGE', confidence: triage.confidence, rule_override: 'yellow_safety_net', icd10: DCSL_ICD10_MAP.yellow_safety_net };
    }
  }

  // GREEN → YELLOW safety net: catches concerning keywords the AI classified as GREEN
  if (triage.triage_level === 'GREEN') {
    const greenConcerns = has(...DCSL_KEYWORDS.kw_12) ||
      has(...DCSL_KEYWORDS.preterm_labour_kw) ||
      has(...DCSL_KEYWORDS.kw_13) ||
      has(...DCSL_KEYWORDS.kw_14) ||
      has(...DCSL_KEYWORDS.kw_15) ||
      has(...DCSL_KEYWORDS.kw_16) ||
      // C6: chest pain in any adult is YELLOW minimum, regardless of
      // severity modifier ("a little", "mild", "not that bad"). Surfaced
      // by eval P04 T1: "isifuba sibuhlungu kancane" returned GREEN in
      // 5/5 runs despite SATS guidance that any chest pain warrants
      // urgent assessment. Adult chest-pain minimisers are a well-known
      // under-triage failure mode in LMIC primary care.
      has(...DCSL_KEYWORDS.kw_17);                                                   // ve
    if (greenConcerns) {
      logger.warn('[SAFETY-NET] GREEN upgrade to YELLOW — concerning keywords in GREEN triage');
      return { triage_level: 'YELLOW', confidence: triage.confidence, rule_override: 'green_safety_net', icd10: DCSL_ICD10_MAP.green_safety_net };
    }
  }

  // ── No discriminator matched — return AI triage unchanged ──
  return triage;
}


// ================== VERIFICATION AGENT ==================
// NOHARM study (Stanford/Harvard): multi-agent configurations are 6x safer
// than single models. For RED/ORANGE results, run a fast independent check
// with Haiku. If the two models disagree, flag for nurse review.
// This does NOT change the triage level — it adds a verification flag.
async function verifyHighAcuityTriage(text, primaryResult) {
  // Only verify RED/ORANGE — GREEN/YELLOW don't warrant the extra API call
  if (primaryResult.triage_level !== 'RED' && primaryResult.triage_level !== 'ORANGE') {
    return { verified: true, verification_skipped: true };
  }

  // Skip verification if the result came from a deterministic rule override
  // (DCSL rules are already validated — no need for a second AI opinion)
  if (primaryResult.rule_override) {
    return { verified: true, verification_source: 'dcsl_rule', rule: primaryResult.rule_override };
  }

  try {
    const res = await anthropic.messages.create({
      model: FAST_MODEL,
      max_tokens: 100,
      temperature: 0.1,
      system: `You are a clinical triage safety verifier. A primary AI has classified this patient as ${primaryResult.triage_level}. Your job is to independently assess whether this classification is appropriate based on the symptoms described.

Reply ONLY with valid JSON: {"agree":true/false,"suggested_level":"RED|ORANGE|YELLOW|GREEN","reason":"≤20 words"}`,
      messages: [
        { role: 'user', content: text },
        { role: 'assistant', content: '{' }
      ]
    });

    const rawText = res.content[0]?.text || '';
    try {
      const parsed = JSON.parse('{' + rawText.replace(/```json|```/g, '').trim());
      const agrees = parsed.agree === true || parsed.suggested_level === primaryResult.triage_level;
      if (!agrees) {
        logger.warn({
          primary: primaryResult.triage_level,
          verifier: parsed.suggested_level,
          reason: parsed.reason,
        }, '[VERIFY] Verification agent disagrees with primary triage');
      }
      return {
        verified: agrees,
        verification_source: 'ai_verifier',
        verifier_level: parsed.suggested_level || null,
        verifier_reason: parsed.reason || null,
      };
    } catch {
      // Parse failure — treat as unverified (safe default)
      logger.warn('[VERIFY] Verification response parse failure — marking unverified');
      return { verified: false, verification_source: 'parse_failure' };
    }
  } catch (err) {
    // API failure — don't block the triage, just note verification was unavailable
    logger.error('[VERIFY] Verification agent API error:', err.message);
    return { verified: true, verification_source: 'api_unavailable' };
  }
}

module.exports = {
  init,
  TRIAGE_PROMPT_VERSION,
  getPatientHistory,
  detectClinicalPatterns,
  runTriage,
  applyClinicalRules,
  generateSelfCareAdvice,
  generateHealthEducation,
  verifyHighAcuityTriage,
};
