'use strict';
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
  if (has('not breathing', 'stopped breathing', 'no breathing', 'cardiac arrest', 'heart stopped'))
    return red('respiratory_cardiac_arrest');
  if (has('akaphefumuli', 'awaphefumuli', 'inhliziyo yama'))
    return red('respiratory_cardiac_arrest_zu');
  if (has('aaphefumli', 'umzimba uwile', 'inhliziyo yema'))
    return red('respiratory_cardiac_arrest_xh');
  if (has('asem haal nie', 'nie asem', 'hartaanval'))
    return red('respiratory_cardiac_arrest_af');
  if (has('ga a heme', 'a a heme', 'go hema go emile', 'pelo e emile'))
    return red('respiratory_cardiac_arrest_nso');
  if (has('ga a heme', 'a a heme', 'go hema go emile', 'pelo e emile'))
    return red('respiratory_cardiac_arrest_tn');
  if (has('ha a phefumolohe', 'a a phefumolohe', 'pelo e emile', 'ho phefumoloha ho emile'))
    return red('respiratory_cardiac_arrest_st');
  if (has('a a hefemuli', 'ku hefemula ku yimile', 'mbilu yi yimile'))
    return red('respiratory_cardiac_arrest_ts');
  if (has('akaphefumuli', 'awaphefumuli', 'inhlitiyo yeme'))
    return red('respiratory_cardiac_arrest_ss');
  if (has('ha a fembi', 'a a khou femba', 'mbilu yo ima'))
    return red('respiratory_cardiac_arrest_ve');
  if (has('akaphefumuli', 'awaphefumuli', 'ihliziyo yeme'))
    return red('respiratory_cardiac_arrest_nr');

  // ════════════════════════════════════════════════════════════════
  // RED 2: UNCONSCIOUS — unresponsive, not waking, collapsed
  // ════════════════════════════════════════════════════════════════
  if (has('unconscious', 'unresponsive', 'not waking', 'passed out', 'collapsed and not moving', 'limp and not moving'))
    return red('unconscious');
  if (has('uqulekile', 'angaphaphami', 'alibeki', 'alawuli'))
    return red('unconscious_zu');
  if (has('uwe phantsi', 'abuyi', 'aziphaphami'))
    return red('unconscious_xh');
  if (has('bewusteloos', 'reageer nie', 'val om en beweeg nie'))
    return red('unconscious_af');
  if (has('o idibetse', 'ga a tsoge', 'o wele fase', 'ga a arabe'))
    return red('unconscious_nso');
  if (has('o idibetse', 'ga a tsoge', 'o wetse fa fatshe', 'ga a arabe'))
    return red('unconscious_tn');
  if (has('o itshedisitse', 'ha a tsohe', 'o oele fatshe', 'ha a arabe'))
    return red('unconscious_st');
  if (has('u wisile', 'a a pfuki', 'u etlele', 'a a hlamuli'))
    return red('unconscious_ts');
  if (has('udzakiwe', 'akaphaphami', 'uwele phansi'))
    return red('unconscious_ss');
  if (has('o ṱalala', 'ha a vuhi', 'o wa fhasi', 'ha a fhinduli'))
    return red('unconscious_ve');
  if (has('uqulekile', 'akaphaphami', 'uwele phasi'))
    return red('unconscious_nr');

  // ════════════════════════════════════════════════════════════════
  // RED 3: ACTIVE SEIZURE — currently fitting, convulsing
  // ════════════════════════════════════════════════════════════════
  if (has('fitting now', 'having a fit', 'currently fitting', 'seizure now', 'convulsing now', 'shaking and not stopping', 'body shaking uncontrolled'))
    return red('active_seizure');
  if (has('uyabanjwa manje', 'uyagijima umzimba', 'isidina manje'))
    return red('active_seizure_zu');
  if (has('unyikinyeka ngoku', 'unamaxhala ngoku'))
    return red('active_seizure_xh');
  if (has('stuiptrekkings nou', 'val nou', 'epilepsie aanval nou'))
    return red('active_seizure_af');
  if (has('o a thothomela', 'o swarwa ke sethuthuthu', 'o a rotha bjale'))
    return red('active_seizure_nso');
  if (has('o a thothomela', 'o a rotha jaanong', 'o tshwerwe ke bolwetse'))
    return red('active_seizure_tn');
  if (has('o a thothomela', 'o a ratha joale', 'o tshwerwe ke bolwetse'))
    return red('active_seizure_st');
  if (has('u a rhurhumela', 'u a tsekatseka', 'nhlanga sweswi'))
    return red('active_seizure_ts');
  if (has('uyabanjwa nyalo', 'uyatfutfumela', 'umtimba uyadzikita'))
    return red('active_seizure_ss');
  if (has('u a dzhendzela', 'u a thothomela zwino', 'u swiwa nga vhulwadze'))
    return red('active_seizure_ve');
  if (has('uyabanjwa nje', 'uyathuthumela', 'umzimba uyadzikiza'))
    return red('active_seizure_nr');

  // ════════════════════════════════════════════════════════════════
  // RED 4: CARDIAC EMERGENCY — chest pain + breathing difficulty
  // ════════════════════════════════════════════════════════════════
  if (has('chest pain') && has('short of breath', 'shortness of breath', "can't breathe", 'difficulty breathing', 'struggling to breathe'))
    return red('cardiac_emergency');

  // RED 4b: CARDIAC ACS VARIANT — chest pain + (arm radiation OR jaw pain OR diaphoresis) → RED
  // Complements the chest+breathing rule above. Surfaced by eval P01: chest + arm
  // heaviness + sweating had no deterministic net; LLM caught it at 95% confidence
  // but no fallback existed. Extended to all 11 languages (nso/tn/st/ts/ss/ve/nr
  // pending native-speaker review).
  if (has('chest pain', 'chest hurts', 'chest tight', 'chest tightness',
          'chest pressure', 'chest heaviness', 'chest is heavy', 'chest discomfort',
          'isifuba', 'isifuba sibuhlungu', 'isifuba sicinene', 'isifuba sisindwa',    // zu
          'isifuba sibuhlungu', 'isifuba sicinene',                                   // xh
          'borspyn', 'bors druk', 'bors swaar', 'pyn in bors',                        // af
          'sehuba se bohloko', 'sehuba se tšwaregile',                                 // nso
          'sehuba se bohloko', 'sehuba se gatelelwa',                                  // tn
          'sefuba se bohloko', 'sefuba se tshwarehile',                                // st
          'xifuva xi vava', 'xifuva xi tika',                                          // ts
          'sifuba sibuhlungu', 'sifuba sibanjiwe',                                      // ss
          'khana ḽi vhavha', 'khana ḽo lemala',                                          // ve
          'isifuba sibuhlungu ngokubambeka') &&                                         // nr
      has('my arm', 'left arm', 'right arm', 'arm heavy', 'arm feels heavy',
          'arm is heavy', 'arm numb', 'arm feels numb', 'arm is numb',
          'arm tingling', 'arm aching', 'in my arm',
          'jaw pain', 'jaw ache', 'jaw hurts', 'pain in jaw', 'pain in my jaw',
          'shoulder pain', 'left shoulder', 'pain to shoulder', 'pain down my shoulder',
          'sweating', 'sweaty', 'cold sweat', 'cold sweats', 'diaphoresis', 'clammy',
          'radiating', 'spreading to', 'spreads to',
          'ingalo isinda', 'ingalo ibuhlungu', 'umhlathi ubuhlungu', 'uyajuluka', 'umjuluko obandayo',   // zu
          'ingalo inzima', 'ingalo ibuhlungu', 'umhlathi ubuhlungu', 'uyabila',                           // xh
          'arm swaar', 'arm is dof', 'kakebeen pyn', 'koue sweet', 'sweet bars',                          // af
          'letsogo le boima', 'mohlakola o bohloko', 'o fufulela phefo e tonyago',                        // nso
          'letsogo le boima', 'mohlakola o bohloko', 'mofufutsho o tsididi',                              // tn
          'letsoho le boima', 'seledu se bohloko', 'o fufuleha mofufutsho o batang',                      // st
          'voko ri tika', 'muheme wu vava', 'muheme wa tsunda',                                            // ts
          'ingalo isinda', 'umhlatsi ubuhlungu', 'uyajuluka umjuluko lobandzako',                          // ss
          'tshanḓa tsho lemala', 'mohonga u vhavha', 'u suka ngoho',                                        // ve
          'ingalo isinda', 'umhlathi ubuhlungu', 'uyajuluka umjuluko obandako'))                            // nr
    return red('cardiac_emergency_radiation');
  if (has('isifuba') && has('ukuphefumula', 'phefumula', 'angiphefumuli'))
    return red('cardiac_emergency_zu');
  if (has('isifuba') && has('ukuphefumla', 'phefumla', 'andiphefumli'))
    return red('cardiac_emergency_xh');
  if (has('borspyn') && has('asem', 'asemhaling', 'kan nie asem'))
    return red('cardiac_emergency_af');
  if (has('sehuba') && has('go hema', 'ga ke heme', 'go hema go thata'))
    return red('cardiac_emergency_nso');
  if (has('sehuba') && has('go hema', 'ga ke heme', 'go hema go thata'))
    return red('cardiac_emergency_tn');
  if (has('sefuba') && has('ho phefumoloha', 'ha ke phefumolohe', 'ho hema ho thata'))
    return red('cardiac_emergency_st');
  if (has('xifuva') && has('ku hefemula', 'a ndzi hefemuli', 'ku hefemula ku tika'))
    return red('cardiac_emergency_ts');
  if (has('sifuba') && has('kuphefumula', 'angiphefumuli', 'kuphefumula kumatima'))
    return red('cardiac_emergency_ss');
  if (has('tshifuva') && has('u femba', 'a thi fembi', 'u femba hu a onda'))
    return red('cardiac_emergency_ve');
  if (has('isifuba') && has('ukuphefumula', 'angiphefumuli', 'ukuphefumula kubudisi'))
    return red('cardiac_emergency_nr');

  // ════════════════════════════════════════════════════════════════
  // RED 5: ACS RADIATION — chest pain + arm/jaw pain + sweating
  // Extended to all 11 languages (nso/tn/st/ts/ss/ve/nr pending native-speaker review)
  // ════════════════════════════════════════════════════════════════
  if (has('chest pain', 'chest hurts', 'chest tight',
          'isifuba', 'isifuba sibuhlungu', 'kubuhlungu esifubeni',        // zu
          'isifuba', 'isifuba sibuhlungu',                                  // xh
          'borspyn', 'pyn in bors',                                         // af
          'sehuba', 'sehuba se bohloko',                                    // nso
          'sehuba', 'sehuba se bohloko',                                    // tn
          'sefuba', 'sefuba se bohloko',                                    // st
          'xifuva', 'xifuva xi vava',                                       // ts
          'sifuba', 'sifuba sibuhlungu',                                    // ss
          'khana', 'khana ḽi vhavha',                                       // ve
          'isifuba', 'isifuba sibuhlungu') &&                               // nr
      has('arm pain', 'jaw pain', 'left arm', 'shoulder pain', 'sweating', 'feels like something sitting on my chest',
          'ingalo', 'ihlombe', 'uyajuluka', 'umjuluko',                     // zu: arm/shoulder/sweating
          'ingalo', 'iqatha', 'uyabila',                                     // xh
          'arm', 'skouer', 'sweet', 'sweetvogtig',                           // af
          'letsogo', 'legetla', 'o a fufulela', 'mofufutšo',                 // nso
          'letsogo', 'legetla', 'o a fufulela',                              // tn
          'letsoho', 'lehetla', 'o a fufuleha',                              // st
          'voko', 'rikatla', 'u a suza',                                     // ts
          'ingalo', 'lihlombe', 'uyajuluka',                                 // ss
          'tshanḓa', 'fhungo', 'u a suka',                                   // ve
          'ingalo', 'ihlombe', 'uyajuluka'))                                 // nr
    return red('acs_radiation');

  // ════════════════════════════════════════════════════════════════
  // RED 6: OBSTETRIC HAEMORRHAGE — pregnant + bleeding
  // ════════════════════════════════════════════════════════════════
  if ((has('pregnant', 'pregnancy', 'khulelwe', 'emita', 'swanger', 'swangari', 'zwigolo',
           'ke imile', 'o imile', 'ke ipaakanyeditse', 'ndi imile', 'ndzi tikile', 'ngikhulelwe', 'ngiimithi')) &&
      has('bleeding', 'blood', 'haemorrhage', 'hemorrhage', 'bleeding heavily',
          'opha', 'igazi', 'bloei', 'bloeding', 'bloed', 'massive bleeding',
          'madi', 'malofha', 'ngati', 'ingati'))
    return red('obstetric_haemorrhage');

  // ════════════════════════════════════════════════════════════════
  // RED 7: OBSTETRIC CORD / FETAL EMERGENCY
  // ════════════════════════════════════════════════════════════════
  if (has('cord is out', 'cord came out', 'prolapsed cord', 'baby not moving', 'no fetal movement', 'baby stopped moving',
          'ingane ayihambi', 'ingane ayinyakazi', 'inkaba iphumile',                    // zu
          'usana aluhambi', 'usana aluhambi esibelekweni', 'inkaba iphumile',            // xh
          'naelstring uit', 'naelstring gly uit', 'baba beweeg nie',                     // af
          'ngwana ga a šikinyege', 'mohara o tšwile',                                    // nso
          'ngwana ga a tshikinyege', 'mohara o tswile',                                   // tn
          'ngwana ha a tshikinyege', 'mohara o tsoile',                                   // st
          'nwana a a tshikinyeki', 'mhahla wu humile',                                    // ts
          'umntfwana akanyakazi', 'inkhaba yinyatseleka',                                 // ss
          'ṅwana ha a tshikinyegi', 'mohlola wo bva',                                     // ve
          'umntwana akanyakazi', 'inkaba iphumile'))                                       // nr
    return red('obstetric_cord_or_fetal');

  // ════════════════════════════════════════════════════════════════
  // RED 8: SNAKE BITE — all 11 languages
  // ════════════════════════════════════════════════════════════════
  if (has('snake bite', 'snakebite', 'snake bit', 'bitten by snake', 'bit by snake',
          'inyoka', 'inyoka yamluma', 'slangbyt', 'slang gebyt',
          'noga e mo lomile', 'noga e nkometse', 'noga e mo lomile',
          'noha e mo lomile',
          'nyoka yi n\'wi lumile', 'nyoka yi lumile',
          'inyoka imlumile',
          'ṋowa yo mu luma', 'ṋowa',
          'inyoka imlumile'))
    return red('envenomation');

  // ════════════════════════════════════════════════════════════════
  // RED 9: SEVERE BURNS
  // ════════════════════════════════════════════════════════════════
  if (has('burnt all over', 'burning all over', 'body on fire', 'severe burn', 'large burn', 'burns to face and hands', 'burn from explosion'))
    return red('severe_burns');
  if (has('umzimba uwonke ushisiwe', 'ushile umzimba wonke', 'ushiswe kakhulu', 'izandla nobuso kushisile'))
    return red('severe_burns_zu');
  if (has('umzimba wonke utshisiwe', 'utshiswe kakhulu', 'izandla nobuso zitshisiwe'))
    return red('severe_burns_xh');
  if (has('erg gebrand', 'hele liggaam gebrand', 'gesig en hande gebrand', 'vuur oor liggaam'))
    return red('severe_burns_af');
  if (has('boiling water on', 'amanzi abilayo phezu', 'amanzi abilayo e',     // en + zu
          'amanzi abilayo phezu',                                             // xh
          'kookwater op', 'warm water oor',                                   // af
          'meetse a go fisha godimo ga',                                      // nso
          'metsi a a fisang godimo ga',                                       // tn
          'metsi a chesang hodima',                                            // st
          'mati ya ku hisa ehenhla ka',                                        // ts
          'emanti lashisako etikwe',                                            // ss
          'maḓi a u fhisa ṋṱha ha',                                            // ve
          'amanzi atjhisako phezu kwe') &&                                     // nr
      has('chest', 'back', 'stomach', 'face', 'legs',
          'isifuba', 'umhlane', 'isisu', 'ubuso', 'imilenze',                 // zu
          'isifuba', 'umqolo', 'isisu', 'ubuso', 'imilenze',                  // xh
          'bors', 'rug', 'maag', 'gesig', 'bene',                             // af
          'sehuba', 'mokokotlo', 'mpa', 'sefahlego', 'maoto',                 // nso
          'sehuba', 'mokwatla', 'mpa', 'sefatlhego', 'maoto',                 // tn
          'sefuba', 'mokokotlo', 'mpa', 'sefahleho', 'maoto',                 // st
          'xifuva', 'nkolo', 'khwiri', 'xikandza', 'milenge',                 // ts
          'sifuba', 'ngalati', 'sisu', 'buso', 'imilente',                     // ss
          'khana', 'muṱana', 'lumbu', 'tshifhaṱuwo', 'milenzhe',               // ve
          'isifuba', 'umhlana', 'isisu', 'ubuso', 'imilenze'))                 // nr
    return red('severe_burns_context');
  if (has('o tšhutše', 'o tšhile', 'meetse a go fisha'))
    return red('severe_burns_nso');
  if (has('o tšhutse', 'o tšhile', 'metsi a a fisang'))
    return red('severe_burns_tn');
  if (has('o chele', 'o cheswe', 'metsi a chesang'))
    return red('severe_burns_st');
  if (has('u hisiwe', 'u pfile', 'mati ya ku hisa'))
    return red('severe_burns_ts');
  if (has('ushile', 'ushiselwe', 'emanti lashisako'))
    return red('severe_burns_ss');
  if (has('o fhiswa', 'o tshiwa', 'maḓi a u fhisa'))
    return red('severe_burns_ve');
  if (has('utjhile', 'utjhisiwe', 'amanzi atjhisako'))
    return red('severe_burns_nr');

  // ════════════════════════════════════════════════════════════════
  // RED 10: NEONATAL APNOEA / PAEDIATRIC UNCONSCIOUS
  // ════════════════════════════════════════════════════════════════
  if (has('baby not breathing', 'baby stopped breathing', 'infant not breathing', 'newborn not breathing',
          'ibhebhe aliphefumuli', 'usana aliphefumuli',                                   // zu
          'usana lwam aluphefumli', 'ibhabhu aliphefumli', 'usana aluphefumli',           // xh
          'baba haal nie asem nie', 'pasgebore asem nie', 'suigeling haal nie asem',      // af
          'lesea ga le heme', 'ngwana ga a heme',                                          // nso
          'lesea ga le heme', 'ngwana ga a heme',                                          // tn
          'lesea ha le phefumolohe',                                                       // st
          'nwana a a hefemuli', 'nwana lontsongo a nga hefemuli',                          // ts
          'umntfwana akaphefumuli',                                                        // ss
          'ṅwana ha a fembi',                                                              // ve
          'umntwana akaphefumuli'))                                                         // nr
    return red('neonatal_apnoea');
  if (has('child unconscious', 'baby unconscious', 'infant unconscious', 'toddler collapsed',
          'ingane iqulekile', 'umntwana oqulekile',                                       // zu (also shared with nr)
          'umntwana uqulekile', 'umntwana uwile akaphendulani',                            // xh (shared marker + clarifier)
          'kind bewusteloos', 'baba bewusteloos', 'kleuter val om en beweeg nie',          // af
          'ngwana o idibetse', 'ngwana o wetse',                                            // nso
          'ngwana o idibetse', 'ngwana o wetse fatshe',                                     // tn
          'ngwana o itshedisitse', 'ngwana o oele fatshe',                                  // st
          'nwana o itshedisitse', 'nwana a nga vuki',                                        // ts
          'umntfwana udzakiwe',                                                              // ss
          'ṅwana o ṱalala',                                                                   // ve
          'umntwana uqulekile'))                                                              // nr
    return red('paediatric_unconscious');

  // ════════════════════════════════════════════════════════════════
  // RED 11: MENINGOCOCCAL RASH — purple/non-blanching
  // Extended to all 11 languages (nso/tn/st/ts/ve/nr pending native-speaker review)
  // ════════════════════════════════════════════════════════════════
  if (has('purple rash', 'dark rash', "rash that doesn't fade", "rash won't disappear", 'rash pressing glass', 'non-blanching rash', 'blood rash',
          'amaqhubu aphuzi', 'amaqhubu amnyama', 'amaqhubu angaphumi',       // zu: rash/spots that don't fade
          'isikhumba esibomvu esingaphumi', 'amabala amnyama',                // zu
          'amabhatha amnyama', 'amabhatha angaphumi', 'amabala aphuzi',       // xh
          'pers uitslag', 'donker uitslag', 'uitslag wat nie verdwyn nie',    // af
          'rooi kolle', 'pers kolle onder die vel',                           // af
          'mafokodi a maso', 'mafokodi a sa fele',                            // nso
          'mafokodi a maso', 'mafokodi a sa fele',                            // tn
          'mafokoti a maso', 'mafokoti a sa fele',                            // st
          'swiphanga leswi dzwihaleke', 'swiphanga leswi nga hundzukiki',     // ts
          'emapethwane lamnyama', 'emapethwane langapheli',                   // ss
          'mapimbi o swifhalaho', 'mapimbi a sa fheli',                       // ve
          'amaqhubu amnyama angaphumi'))                                       // nr
    return red('meningococcal_rash');

  // ════════════════════════════════════════════════════════════════
  // RED 12: ANAPHYLAXIS — throat/face swelling after sting/food
  // ════════════════════════════════════════════════════════════════
  if ((has('throat closing', 'throat swelling', "can't swallow", 'face swelling', 'lips swelling',
           'umphimbo uvuvukile', 'umphimbo uyavimba', 'ubuso buyavuvuka',
           'keel swel', 'gesig swel', 'lippe swel',
           'mometso o rurugile', 'sefahlego se rurugile',
           'molomo o rurugile', 'sefahleho se rurugile',
           'nkulo wu pfulile', 'xikandza xi pfulile',
           'umphimbo uvuvukile', 'buso buyavuvuka',
           'muṱodzi wo ṱahela', 'tshifhaṱuwo tsho ṱahela',
           'umphimbo uvuvukile', 'ubuso buyavuvuka')) &&
      has('sting', 'bee', 'nut', 'food allergy', 'medication', 'injection',
          'nyosi', 'imbumba', 'ukudla', 'umjovo',
          'bye', 'nonyane', 'kos', 'inspuiting',
          'nose', 'dijo', 'moento',
          'mpfundla', 'swakudya',
          'ṋovhela', 'zwiliwa'))
    return red('anaphylaxis');

  // ════════════════════════════════════════════════════════════════
  // RED 13: TRAUMATIC HAEMORRHAGE — uncontrollable bleeding
  // ════════════════════════════════════════════════════════════════
  if (has('blood pouring', 'spurting blood', "can't stop bleeding", 'blood everywhere', 'stabbed and bleeding', 'shot and bleeding',
          'igazi liyampompoza', 'igazi alinqamuki', 'ugwaziwe', 'udutshulwe',
          'igazi liyampompoza', 'igazi alinameki', 'uhlabwe', 'udutyulwe',
          'bloed spuit', 'kan nie bloeding stop', 'gesteek en bloei', 'geskiet en bloei',
          'madi a a elela', 'madi ga a eme', 'o hlabilwe',
          'madi a elela', 'madi ha a eme', 'o hlabilwe',
          'ngati yi humesa', 'ngati a yi yimi', 'u tlhabiwe',
          'ingati iyampompoza', 'ingati ayinqamuki', 'ugwazwe',
          'malofha a khou elela', 'malofha ha a imi', 'o ṱhavhiwa',
          'igazi liyampompoza', 'igazi aliyimi', 'ugwazwe'))
    return red('traumatic_haemorrhage');

  // ── ORANGE DISCRIMINATORS ──
  const orange = (rule) => ({
    triage_level: 'ORANGE', confidence: 95, rule_override: rule,
    icd10: DCSL_ICD10_MAP[rule] || null,
  });

  // STROKE — facial droop, arm weakness, speech (FAST signs) — all 11 languages
  if (has('face drooping', 'face dropped', 'mouth twisted', 'one side face', 'facial droop', 'smile crooked', 'uneven face',
          'ubuso buyehla', 'umlomo ugobile', 'ubuso obunye buyehla',
          'ubuso buyehla', 'umlomo ugobe', 'ubuso obunye buyehla',
          'gesig hang', 'mond skeef',
          'sefahlego se theogetše', 'molomo o kgopiše',
          'sefatlhego se theogetse', 'molomo o kgopame',
          'sefahleho se theohile', 'molomo o kgopame',
          'xikandza xi rhelerile', 'nomo wu gombile',
          'buso buyehla', 'umlomo ugobile',
          'tshifhaṱuwo tsho thela', 'mulomo wo goba',
          'ubuso buyehla', 'umlomo ugobhile'))
    return orange('stroke_facial_droop');
  if (has('arm weakness', 'arm numb', 'one arm weak', "can't lift arm", 'arm dropping', 'hand weak', 'left side weak', 'right side weak', 'weakness one side',
          'ingalo ibuthaka', 'ingalo ayinyakazi',
          'ingalo ibuthathaka', 'ingalo ayishukumi',
          'arm is swak', 'kan nie arm oplig',
          'letsogo le fokola', 'letsogo ga le šikinyege',
          'letsogo le bokoa', 'letsogo ga le tshikinyege',
          'letsoho le fokola', 'letsoho ha le tshikinyehe',
          'voko ri hele matimba', 'voko a ri tshikinyeki',
          'ingalo ibhudlana', 'ingalo ayinyakazi',
          'tshanḓa tsho fa maanḓa', 'tshanḓa a tshi tshikinyei',
          'ingalo ibuthakathaka', 'ingalo ayinyakazi'))
    return orange('stroke_arm_weakness');
  if (has('slurred speech', 'speech slurred', 'talking funny', "can't speak properly", 'words wrong', "can't find words", 'confused talking',
          'ukhuluma nzima', 'amazwi awaphumi kahle',
          'uthetha nzima', 'amazwi akaphumi kakuhle',
          'praat deurmekaar', 'woorde kom nie uit',
          'o bolela nzima', 'mantšu ga a tswe gabotse',
          'o bua thata', 'mafoko ga a tswe sentle',
          'o bolela nzima', 'mantswe ha a tswe hantle',
          'u vulavula hi ku tika', 'marito a a humeli kahle',
          'ukhuluma nzima', 'emagama akaphumi kahle',
          'u amba zwi a konḓa', 'maipfi ha a ḓi bvi zwavhuḓi',
          'ukhuluma nzima', 'amezwi akaphumi kuhle'))
    return orange('stroke_speech');
  if (has('sudden severe headache', 'worst headache', 'thunderclap', 'headache like never before', 'explosive headache', 'worst headache of my life',
          'ikhanda elibuhlungu kakhulu ngokuzumayo',
          'intloko ebuhlungu kakhulu ngequbuliso',
          'skielike ergste hoofpyn',
          'hlogo e bohloko kudu ka tšhoganetšo',
          'tlhogo e e bohloko thata ka tshoganyetso',
          'hlogo e bohloko haholo ka tshohanyetso',
          'rixaka leri buhasaka ngopfu hi ku hatla',
          'ikhanda lelibuhlungu kakhulu ngesikhatsi sinye',
          'ṱhoho i rema nga maanḓa nga u ṱavhanya',
          'ikhanda elibuhlungu khulu ngokuzuma'))
    return orange('thunderclap_headache');

  // POST-ICTAL — had a fit, now confused/drowsy — all 11 languages
  if ((has('just had a fit', 'had a seizure', 'just fitted', 'finished fitting', 'fit stopped', 'seizure stopped', 'woke up after fit')) &&
      has('confused', 'drowsy', 'sleepy', 'not fully awake'))
    return orange('post_ictal');
  if (has('uyishayiwe', 'wabanjwa') && has('ulele', 'udidekile', 'uyozela'))
    return orange('post_ictal_zu');
  if ((has('o kile a rotha', 'o qetile go rotha', 'sethuthuthu se fedile')) && has('o didimala', 'o robetše', 'ga a tsoge'))
    return orange('post_ictal_nso');
  if ((has('o kile a rotha', 'go rotha go fedile')) && has('o didimala', 'o robetse', 'ga a tsoge'))
    return orange('post_ictal_tn');
  if ((has('o kile a ratha', 'ho ratha ho fedile')) && has('o didimala', 'o robetse', 'ha a tsohe'))
    return orange('post_ictal_st');
  if ((has('u rhurhumele', 'ku rhurhumela ku hele')) && has('u didimele', 'u etlele', 'a a pfuki'))
    return orange('post_ictal_ts');
  if ((has('ubanjwe', 'kutfutfumela kuphele')) && has('udzakiwe', 'ulele', 'akavuki'))
    return orange('post_ictal_ss');
  if ((has('o dzhendzhele', 'u dzhendzela ho fhela')) && has('o ḓidimala', 'o eḓela', 'ha a vuhi'))
    return orange('post_ictal_ve');
  if ((has('ubanjwe', 'ukuthuthumela kuphelile')) && has('udidekile', 'ulele', 'akavuki'))
    return orange('post_ictal_nr');

  // SEVERE ASTHMA — inhaler not working, can't speak
  if ((has('asthma', 'isifuba semoya', 'asma', 'sefuba sa moya', 'xifuva xa moya')) ||
      has('inhaler', 'pump', 'nebuliser', 'iphampu', 'pompi', 'pampu'))
    if (has('not working', 'not helping', "can't speak", "can't talk", "can't walk", 'getting worse', 'turning blue', 'lips blue', 'exhausted',
            'ayisebenzi', 'ayisizi', 'angikwazi ukukhuluma',
            'ayisebenzi', 'ayincedi', 'andikwazi ukuthetha',
            'werk nie', 'help nie', 'kan nie praat',
            'ga e šome', 'ga e thuše',
            'ga e bereke', 'ga e thuse',
            'ha e sebetse', 'ha e thuse',
            'a yi tirhi', 'a yi pfuni',
            'ayisebenzi', 'ayisiti',
            'a i shumi', 'a i thusi',
            'ayisebenzi', 'ayisizi'))
      return orange('severe_asthma');

  // PRE-ECLAMPSIA — pregnant + headache + swelling/vision (all 11 languages)
  if ((has('pregnant', 'khulelwe', 'emita', 'swanger', 'swangari',
           'ke imile', 'o imile', 'ndi imile', 'ndzi tikile', 'ngikhulelwe', 'ndo vhifha')) &&
      has('headache', 'blurred vision', 'seeing stars', 'face swollen', 'feet very swollen', 'hands swollen', 'no urine', 'pain under ribs',
          'ikhanda', 'amehlo ayaxobana', 'ubuso buyavuvuka', 'izinyawo zivuvukile',
          'intloko', 'amehlo ayaxobana', 'ubuso buyavuvuka',
          'hoofpyn', 'oë waas', 'gesig geswel',
          'hlogo', 'mahlo a fifala', 'sefahlego se rurugile',
          'tlhogo', 'matlho a fifala', 'sefatlhego se rurugile',
          'hloho', 'mahlo a fifala', 'sefahleho se rurugile',
          'rixaka', 'mahlo ya fifiala', 'xikandza xi pfulile',
          'ikhanda', 'emehlo ayafifiyala', 'buso buyavuvuka',
          'ṱhoho', 'maṱo a si tshi vhona', 'tshifhaṱuwo tsho ṱahela',
          'ikhanda', 'amehlo ayafifiala', 'ubuso buyavuvuka'))
    return orange('pre_eclampsia');

  // ECTOPIC PREGNANCY — missed period + severe one-sided pain
  if (has('missed period', 'period late', 'pregnancy test positive', 'could be pregnant',
          'isikhathi asifikanga', 'iperiod ilate',
          'ixesha alifiki', 'iperiod ilate',
          'periode is laat', 'swangerskap toets positief',
          'nako ga e fihla', 'kgwedi ga e fihla',
          'nako ga e tle', 'kgwedi ga e tle',
          'nako ha e fihle', 'kgwedi ha e fihle',
          'nkarhi a wu fiki', 'masiku a wu fiki',
          'sikhatsi asifikanga', 'iperiod ilate',
          'ṅwedzi a u ḓi', 'tshifhinga a tshi ḓi',
          'isikhathi asifikanga') &&
      has('severe pain one side', 'sharp pain left side', 'sharp pain right side', 'shoulder pain', 'tip of shoulder', 'shoulder tip pain', 'right side severe', 'left side severe',
          'ubuhlungu obukhulu ohlangothini olulodwa', 'ubuhlungu obubukhali ngakwesobunxele', 'ubuhlungu ehlombe',             // zu
          'iintlungu ezinkulu kwicala elinye', 'ngakwesobunxele ibuhlungu kakhulu', 'iqatha libuhlungu',                         // xh
          'erge pyn aan een kant', 'skerp pyn links', 'skerp pyn regs', 'skouer pyn',                                            // af
          'bohloko bjo bogolo ka lehlakoreng le tee', 'bohloko bja legetla',                                                       // nso
          'bohloko jo bogolo mo letlhakoreng le lengwe', 'bohloko jwa legetla',                                                    // tn
          'bohloko bo boholo ka lehlakoreng le le leng', 'bohloko ba lehetla',                                                     // st
          'ku vava ka matimba hi tlhelo rin\'we', 'rikatla ri vava',                                                                // ts
          'buhlungu lobukhulu ngelinye lihlangotsi', 'lihlombe libuhlungu',                                                          // ss
          'vhutungu vhuhulu tshipiḓa tshithihi', 'fhungo ḽi vhavha',                                                                   // ve
          'ubuhlungu obukhulu ohlangothini olunye', 'ihlombe libuhlungu'))                                                              // nr
    return orange('ectopic_pregnancy');

  // FEBRILE SEIZURE — child + fit + fever (all 11 languages)
  if ((has('child', 'baby', 'toddler', 'infant',
           'ingane', 'umntwana', 'ibhebhe',
           'umntwana', 'usana',
           'kind', 'baba', 'kleuter',
           'ngwana', 'lesea',
           'ngwana', 'lesea',
           'nwana', 'lesea',
           'nwana', 'nhanga',
           'umntfwana', 'lusana',
           'ṅwana', 'lutshetshe',
           'umntwana', 'usana')) &&
      has('fit', 'seizure', 'convulsion', 'fitting', 'shaking',
          'banjwa', 'thothomela', 'rotha', 'rhurhumela', 'dzhendzela', 'thuthumela') &&
      has('fever', 'temperature', 'hot',
          'umkhuhlane', 'umkhuhlane',
          'koors', 'temperatuur',
          'mohlabi', 'mogote', 'phoholo', 'fivha', 'umkhuhlane', 'muḓifhiso', 'umkhuhlane'))
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
    const isInfant = has(
      // English — narrow infant markers; "baby" alone excluded as too broad
      'newborn', 'my newborn', 'my baby', 'my infant',
      '1 month old', '2 month', '3 month', '4 month', '5 month', '6 month',
      '7 month', '8 month', '9 month', '10 month', '11 month', '12 month',
      '13 month', '14 month', '15 month', '16 month', '17 month',
      '18 month', '19 month', '20 month', '21 month', '22 month', '23 month',
      '1 week old', '2 week old', '3 week old', '4 week old',
      '5 week old', '6 week old', '7 week old', '8 week old',
      'few weeks old', 'few months old', 'couple of months',
      'under 1 year', 'under a year', 'under one year',
      // Multilingual infant / newborn markers
      'usana', 'insana', 'ibhebhe',                        // zu / ss / xh
      'lesea',                                              // st / nso / tn
      'lutshetshe',                                         // ve
      'ṅwana mutuku',                                       // ve
      'baba van', 'suigeling', 'pasgebore',                 // af
      'nwana lontsongo', 'xitsongwana',                     // ts
      'umntfwana lomncane', 'lusana',                       // ss
      'usana lwam'                                          // xh — "my baby"
    );

    const infantHasFever = has(
      'fever', 'high temperature', 'temperature', 'very hot', 'burning up',
      'umkhuhlane', 'ufudumele', 'ushisa',                  // zu
      'uyashisa',                                            // xh / ss
      'koors', 'baie warm',                                  // af
      'mogote', 'fisa',                                      // nso / tn
      'mocheso', 'ho fisa',                                  // st
      'fivha', 'ku hisa',                                    // ts
      'imfiva',                                              // ss
      'muḓifhiso', 'u fhisa'                                 // ve
    );

    const infantPoorFeeding = has(
      "won't eat", 'wont eat', 'not eating', 'refusing food', 'refusing milk',
      'not feeding', 'poor feeding', 'not drinking', 'not breastfeeding',
      "won't breastfeed", "won't drink", 'not latching', "won't latch",
      'akadli', 'akasancela', 'akasaphuzi',                  // zu
      'akafuni ukudla', 'akafuni ubisi', 'akafuni ukuncela', // xh / zu
      'wil nie eet nie', 'drink nie', 'wil nie drink nie',   // af
      'ga a je', 'ga a nwe',                                 // nso / tn
      'ha a je', 'ha a noe',                                 // st
      'a nga dyi', 'a nga nwi',                              // ts
      'akasadli',                                             // ss
      'ha a ḽi', 'ha a nwa'                                  // ve
    );

    const infantLethargy = has(
      'sleepy', 'very sleepy', 'lethargic', 'drowsy', 'hard to wake',
      'floppy', 'limp', 'not responsive', 'unresponsive',
      'not like him', 'not like her', 'not himself', 'not herself',
      'altered behavior', 'altered behaviour', 'just lying there',
      'ulele kakhulu', 'akaziphilile',                       // zu
      'akaziphilele',                                         // xh
      'baie slaperig', 'slap', 'nie soos homself nie',        // af
      'nie wakker te kry nie',                                // af
      'o robile thata', 'ga a tshwane le ena',                // nso
      'o robetse thata', 'ga a tshwane',                      // tn
      'o robetse haholo', 'ha a tshwane le eena',             // st
      'u etlela ngopfu', 'a nga fani na yena',                // ts
      'akasayena',                                             // ss
      'u eḓela vhukuma', 'ha fani na ene',                    // ve
      'ulele khulu'                                            // nr
    );

    if (isInfant && infantHasFever && (infantPoorFeeding || infantLethargy)) {
      logger.warn('[RULE] infant_sepsis_screen — infant + fever + (poor feeding OR lethargy)');
      return orange('infant_sepsis_screen');
    }
  }

  // ACUTE CONFUSION + CHRONIC DISEASE — all 11 languages
  if ((has('confused', 'deurmekaar', 'udidekile', "doesn't know", "doesn't recognise", 'not making sense', 'talking nonsense', 'maak nie sin',
           'o didimala', 'ga a tsebe', 'o didimala', 'ga a itse',
           'o didimala', 'ha a tsebe',
           'u didimele', 'a a tivi',
           'udzakiwe', 'akati',
           'o ḓidimala', 'ha a ḓivhi',
           'udidekile', 'akazi')) &&
      (has('diabetic', 'diabetes', 'sugar', 'high blood', 'hypertension', 'hiv', 'arv',
           'ushukela', 'igazi eliphakeme', 'iswekile',
           'suiker', 'hoë bloeddruk',
           'bolwetši bja swikiri', 'madi a godilego',
           'bolwetse jwa sukiri', 'madi a godileng',
           'bolwetsi ba tsoekere', 'madi a phahameng',
           'vuvabyi bya swikiri', 'ngati ya le henhla',
           'sifo seshugela', 'ingati lephakeme',
           'vhulwadze ha swigiri', 'malofha o ḓiimisela',
           'isifo sesiswigiri', 'igazi eliphezulu')))
    return orange('acute_confusion_chronic');

  // HEAD TRAUMA + LOC — head injury + loss of consciousness or altered state. All 11 languages.
  if (has('hit head', 'fell and hit head', 'head injury', 'knocked out', 'knocked head', 'head trauma', 'bump to head',
          'ngishaywe ekhanda', 'ngawa ngashaya ikhanda', 'ikhanda lishayiwe',                                       // zu
          'ndibethiwe entloko', 'ndiwile ndabetha intloko', 'intloko ibethiwe',                                       // xh
          'kop gestamp', 'geval en kop gestamp', 'kopbesering', 'kop geslaan',                                         // af
          'ke otlilwe ka hlogo', 'ke ngwele ka hlogo', 'kgobalo ya hlogo',                                              // nso
          'ke iteilwe mo tlhogong', 'ke ole ka tlhogo', 'kgobalo ya tlhogo',                                              // tn
          'ke otlilwe hlohong', 'ke oele hlohong', 'kotsi ya hlooho',                                                      // st
          'ndzi bile enhlokweni', 'ndzi wile ndzi dumba nhloko', 'ku vaviseka ka nhloko',                                   // ts
          'ngishaywe enhlokweni', 'ngiwile ngashaya inhloko',                                                                // ss
          'ndo rwiwa kha ṱhoho', 'ndo wa nda vhaisa ṱhoho',                                                                    // ve
          'ngibethwe ekhanda', 'ngiwile ngabetha ikhanda') &&                                                                   // nr
      has('unconscious', 'passed out', 'blacked out', 'confused after', 'lost consciousness', 'woke up confused', 'memory loss', 'vomiting after',
          'ngilale', 'ngashona', 'angisazi', 'uqulekile', 'ngiqukekile', 'ngididekile emva',                                     // zu
          'ndiquleke', 'ndiwe phantsi', 'ndidideke emva', 'andikhumbuli',                                                          // xh
          'bewusteloos geraak', 'deurmekaar na val', 'geheueverlies',                                                               // af
          'ke idibetse', 'ke didimetse morago', 'ga ke gopole',                                                                      // nso
          'ke idibetse', 'ke didimatse morago', 'ga ke gakologelwe',                                                                  // tn
          'ke itshedisitse', 'ke didimetse ka morao', 'ha ke hopole',                                                                  // st
          'ndzi wisile', 'ndzi didimele endzhaku', 'a ndzi tsundzuki',                                                                  // ts
          'ngiphele umoya', 'ngidzakiwe ngemuva',                                                                                        // ss
          'ndo ṱalala', 'ndo ḓidimala nga murahu', 'a thi humbuli',                                                                       // ve
          'ngiqulekile', 'ngiwile ngididekile',  'angikhumbuli'))                                                                          // nr
    return orange('head_trauma_loc');
  if ((has('ngawa', 'wawa')) && has('ngilale', 'ngashona', 'angisazi', 'ukufa', 'ukudangala'))
    return orange('head_trauma_loc_zu');

  // OPEN FRACTURE — bone visible through skin. All 11 languages.
  if (has('bone sticking out', 'bone through skin', 'can see bone', 'bone visible', 'open fracture',
          'ithambo liphuma esikhumbeni', 'ithambo liyabonakala', 'ithambo liphukile liphumele ngaphandle',      // zu
          'ithambo liphuma esikhumbeni', 'ithambo liyabonakala',                                                  // xh
          'been steek uit vel', 'been sigbaar', 'oop breuk', 'been uit vel',                                      // af
          'lerapo le tšwa ka letlalo', 'lerapo le a bonagala', 'lerapo le robegile le tšwa',                     // nso
          'lerapo le tswa mo letlalong', 'lerapo le a bonala', 'lerapo le robegile le tswa',                      // tn
          'lesapo le tsoa leroleng', 'lesapo le a bonahala', 'lesapo le robehile le tsoa',                        // st
          'rhambu ri huma eka ganga', 'rhambu ri voniwa', 'rhambu ri tshovekile ri huma',                         // ts
          'libhanti liphuma esikhumbeni', 'libhanti liyabonakala',                                                 // ss
          'ḽitambo ḽi bvaho kha luya', 'ḽitambo ḽa vhonala', 'ḽitambo ḽo ṱhukhukana ḽi bva',                        // ve
          'ithambo liphuma esikhumbeni', 'ithambo liyabonakala'))                                                   // nr
    return orange('open_fracture');

  // HIGH-ENERGY MECHANISM — car / fall from height / crush. All 11 languages.
  if (has('car accident', 'motor accident', 'mvc', 'hit by car', 'struck by vehicle', 'motorcycle accident', 'fell from roof', 'fell from ladder', 'fell from height', 'crush injury', 'industrial accident',
          'ingozi yemoto', 'ngishayiswe yimoto', 'ngiwe phezulu', 'ngiwe ophahleni', 'ngiwe elereni',             // zu
          'ingozi yemoto', 'ndibethwe yimoto', 'ndiwile phezulu', 'ndiwe eluphahleni',                             // xh
          'motorongeluk', 'raakgery deur motor', 'geval van dak', 'geval van leer', 'val van hoogte',              // af
          'kotsi ya koloi', 'ngopotswe ke koloi', 'ngwele go tšwa godimo', 'ngwele le lereng',                     // nso
          'kotsi ya koloi', 'ke kgotlilwe ke koloi', 'ke oele go tswa godimo', 'ke oele le lereng',                // tn
          'kotsi ya koloi', 'ke thuntswe ke koloi', 'ke wele ho tsoa hodimo', 'ke wele le lereng',                  // st
          'xihoko xa movha', 'ndzi bile hi movha', 'ndzi wile ehenhla', 'ndzi wile eka lere',                       // ts
          'ingozi yemoto', 'ngishaywe yimoto', 'ngiwe etulu', 'ngiwe elereni',                                       // ss
          'khombo ya goloi', 'ndo rwiwa nga goloi', 'ndo wa ntha', 'ndo wa kha lere',                                // ve
          'ingozi yemoto', 'ngibethwe yimoto', 'ngiwe phezulu', 'ngiwe elereni'))                                     // nr
    return orange('high_energy_mechanism');

  // BURNS SIGNIFICANT — burn + high-risk anatomy (face, airway, hands, large area). All 11 languages.
  if (has('burn', 'burnt', 'burned', 'scald',
          'ushile', 'ushisiwe', 'ushiswe',                                                       // zu
          'utshile', 'utshisiwe',                                                                 // xh
          'gebrand', 'brand', 'skroei',                                                           // af
          'o tšhutše', 'o tšhile', 'o fiswe',                                                      // nso
          'o tšhutse', 'o tšhile', 'o fisitswe',                                                   // tn
          'o chesitse', 'o chele', 'o tsholetsoe',                                                  // st
          'u hisiwe', 'u pfile', 'u hisile',                                                        // ts
          'ushile', 'ushiselwe',                                                                     // ss
          'o fhiswa', 'o tshiwa',                                                                     // ve
          'utjhile', 'utjhisiwe') &&                                                                   // nr
      has('face', 'around neck', 'airways', 'breathing problems', 'inhaled smoke', 'singed eyebrows', 'singed hair', 'hands and arms', 'large area',
          'ubuso', 'intamo', 'umphimbo', 'intsizi', 'izandla nezingalo', 'indawo enkulu',               // zu
          'ubuso', 'intamo', 'umqala', 'izandla neengalo',                                              // xh
          'gesig', 'om nek', 'asemweë', 'rook ingeasem', 'hande en arms', 'groot area',                 // af
          'sefahlego', 'molaleng', 'go hema', 'musi o hemelwago', 'diatla le matsogo', 'sebaka se segolo',  // nso
          'sefatlhego', 'molaleng', 'go hema', 'mosi o hemetsweng', 'diatla le matsogo', 'sebaka se segolo', // tn
          'sefahleho', 'molaleng', 'ho hema', 'mosi o hemetsweng', 'matsoho le maoto', 'sebaka se seholo',    // st
          'xikandza', 'nkolo', 'ku hefemula', 'musi lowu phungiweke', 'mavoko ni marhambu', 'ndhawu yo kula', // ts
          'buso', 'intsamo', 'umphimbo', 'tandla nemigalo', 'indzawo lenkhulu',                                // ss
          'tshifhaṱuwo', 'mukulo', 'u femba', 'vhunga ho funzeleaho', 'zwanda na zwanḓa', 'shango ḽihulu',      // ve
          'ubuso', 'intamo', 'umphimbo', 'izandla nezingalo', 'indawo enkhulu'))                                 // nr
    return orange('burns_significant');
  if (has('andilukuhla', 'ndilukuhliwe') || (has('amanzi ashisayo') && has('isikhumba', 'umzimba')))
    return orange('burns_xh');

  // ACUTE ABDOMEN — rigid/board-like abdomen, severe immovable pain. All 11 languages
  // (nso/tn/st/ts/ss/ve/nr pending native-speaker review).
  if (has('stomach hard as a board', 'rigid stomach', "can't touch stomach", 'severe stomach pain can\'t move', 'worst stomach pain ever',
          'isisu siqinile njengepulangwe', 'isisu asiphatheki', 'ubuhlungu besisu obungavumi ukunyakaza',    // zu
          'isisu siqinile', 'isisu asiphatheki', 'iintlungu zesisu ezinkulu', 'andikwazi ukunyakaza',          // xh
          'maag hard soos plank', 'maag styf', 'kan nie maag raak nie', 'ergste maagpyn ooit',                 // af
          'mpa e thata bjalo ka lepolanka', 'mpa e sa swarega', 'bohloko bja mpa ga bo fete',                   // nso
          'mpa e thata jaaka lepolanka', 'mpa ga e swarege', 'bohloko jwa mpa bo bogolo thata',                 // tn
          'mpa e thata jwaloka lepolanka', 'ha ke tshwarelle mpa', 'bohloko ba mpa bo boholo haholo',           // st
          'khwiri ri tiyile ku fana ni pulanga', 'khwiri a ri kombetelekiki', 'ku vava ka khwiri ku tele',     // ts
          'sisu sishibalala njengelibhodi', 'sisu asiphatseki', 'buhlungu besisu lobukhulu',                    // ss
          'lumbu ḽo khwaṱha sa lupulangu', 'lumbu ḽa sa fara', 'vhutungu ha lumbu ho kalulea',                   // ve
          'isisu siqinile njengepulangi', 'isisu asiphatheki', 'ubuhlungu besisu obukhulu'))                    // nr
    return orange('acute_abdomen');

  // PSYCHIATRIC EMERGENCY IMMINENT — active self-harm risk or attempt in progress. All 11 languages.
  if (has('about to hurt myself', 'going to kill myself', 'taking tablets now', 'overdosed', 'took pills to die', 'swallowed pills on purpose', 'tried to hang', 'tried to cut wrists',
          'ngiyazibulala manje', 'sengithathe amaphilisi', 'ngizifaka intambo', 'ngizisikile ezihlakeni',         // zu
          'ndiyazibulala ngoku', 'ndithathe amaphilisi', 'ndizikhokele intambo', 'ndizisikile ezihlakaleni',        // xh
          'gaan myself doodmaak', 'drink nou pille', 'te veel pille gedrink', 'probeer hang', 'gesny aan polse',    // af
          'ke ikgotlhomolla gona bjale', 'ke nwele dipilisi ka bontsi', 'ke ipofile ka thapo',                       // nso
          'ke itshwaya gona jaanong', 'ke nole dipilisi tse dintsi', 'ke ikgokile ka thapo',                          // tn
          'ke itima hona joale', 'ke nwele dipilisi tse ngata', 'ke ithekeletse ka thapo',                            // st
          'ndzi tidlaya sweswi', 'ndzi swarile dziphilisi to tala', 'ndzi tipfalile hi tintambo',                     // ts
          'ngitibulala nyalo', 'ngidle emaphilisi lamanyenti', 'ngitiphica ngelithambo',                              // ss
          'ndi a ḓivhulaha zwino', 'ndo nwa dziphilisi nnzhi', 'ndo ḓirwa nga thambo',                                 // ve
          'ngizibulala manje', 'sengidle amaphilisi amaningi', 'sengizifaka intambo'))                                 // nr
    return orange('psychiatric_emergency_imminent');

  // SEVERE HYPOGLYCAEMIA — low sugar + altered consciousness/behaviour. All 11 languages.
  if ((has('sugar very low', 'glucose very low', 'hypo', 'blood sugar crashed', 'sugar dropped',
           'ushukela uphansi kakhulu', 'ushukela uwile', 'iglucose iphansi',                                    // zu
           'iswekile iphantsi kakhulu', 'iswekile iwile',                                                        // xh
           'suiker baie laag', 'glukose baie laag', 'suiker het geval',                                          // af
           'swikiri se tlase kudu', 'bjalwa bja dipilisi bo wele',                                                // nso
           'sukiri e kwa tlase thata', 'tsoekere e wele',                                                          // tn
           'tsoekere e tlase haholo', 'tsoekere e wele',                                                           // st
           'swikiri swi le hansi ngopfu', 'swikiri swi wile',                                                      // ts
           'shukela iphantsi kakhulu', 'shukela iwile',                                                             // ss
           'swigiri tshi fhasi vhukuma', 'swigiri tsho wela',                                                        // ve
           'ushukela uphansi khulu', 'ushukela uwile')) &&                                                           // nr
      has('unconscious', 'fitting', 'not responding', 'collapsed', 'aggressive', 'confused',
          'uqulekile', 'uyabanjwa', 'akaphenduli', 'uwile phansi', 'udidekile',                                     // zu
          'uquleke', 'uyabanjwa', 'akaphenduli', 'uwile',                                                            // xh
          'bewusteloos', 'stuiptrekkings', 'reageer nie', 'val om', 'aggressief', 'deurmekaar',                      // af
          'o idibetse', 'o a rotha', 'ga a arabe', 'o wele', 'o didimala',                                            // nso
          'o idibetse', 'o a rotha', 'ga a arabe', 'o wele', 'o didimala',                                            // tn
          'o itshedisitse', 'o a ratha', 'ha a arabe', 'o wele', 'o didimala',                                         // st
          'u wisile', 'u a rhurhumela', 'a a pfuki', 'u wile', 'u didimele',                                            // ts
          'udzakiwe', 'uyabanjwa', 'akavuki', 'uwile',                                                                   // ss
          'o ṱalala', 'u a dzhendzela', 'ha a fhinduli', 'o wa', 'o ḓidimala',                                            // ve
          'uqulekile', 'uyabanjwa', 'akaphenduli', 'uwile', 'udidekile'))                                                 // nr
    return orange('severe_hypoglycaemia');

  if ((has('pregnant', 'khulelwe', 'emita', 'swanger', 'swangari')) &&
      has('contractions', 'labour', 'pains', 'waters broke', 'bag of water broke') &&
      has('7 months', '6 months', '5 months', 'early', 'too early', 'not due yet', '32 weeks', '30 weeks', '28 weeks', '34 weeks', 'premature'))
    return orange('preterm_labour');

  // ── YELLOW DISCRIMINATORS ──
  const yellow = (rule) => ({
    triage_level: 'YELLOW', confidence: 85, rule_override: rule,
    icd10: DCSL_ICD10_MAP[rule] || null,
  });

  if (has('severe pain', 'pain is 10', 'pain is 9', 'pain is 8', 'pain 10/10', 'pain 9/10', 'pain 8/10', 'worst pain', 'unbearable pain', 'excruciating', "can't stand the pain", 'pain too much', 'screaming in pain',
          'inhlungu ezibuhlungu kakhulu', 'ubuhlungu obukhulu', 'kubuhlungu kakhulu',     // zu
          'iintlungu ezimbi kakhulu', 'kubuhlungu kakhulu',                                // xh
          'baie pyn', 'seer baie', 'verskriklike pyn',                                     // af
          'bohloko bo bogolo', 'ke a lla ka bohloko',                                      // nso
          'botlhoko jo bogolo', 'ke a lela ka botlhoko',                                   // tn
          'bohloko bo boholo', 'ke a lla ka bohloko',                                      // st
          'vuhlungu lebyi kuleke', 'ndzi le vuhlungwini lebyi kuleke',                      // ts
          'ubuhlungu obukhulu', 'kubuhlungu kakhulu',                                      // ss
          'vuvha vuhulu', 'ndi na vuvha vuhulu',                                           // ve
          'ubuhlungu obukhulu', 'kubuhlungu khulu'))                                       // nr
    return yellow('severe_pain');

  if (has('want to kill myself', "don't want to live", 'no reason to live', 'thinking of ending', 'suicide', 'suicidal', 'self-harm', 'hurting myself', 'cutting myself',
          'ngifuna ukuzibulala', 'angisafuni ukuphila',                                    // zu
          'ndifuna ukuzibulala', 'andisafuni kuphila',                                     // xh
          'wil doodgaan', 'wil nie meer leef',                                             // af
          'ke nyaka go ipolaya', 'ga ke sa nyake go phela',                                // nso
          'ke batla go ipolaya', 'ga ke sa batle go tshela',                               // tn
          'ke batla ho ipolaya', 'ha ke sa batle ho phela',                                // st
          'ndzi lava ku tirhisa', 'a ndzi sa lavi ku hanya',                               // ts
          'ngifuna kutibulala', 'angisafuni kuphila',                                      // ss
          'ndi ṱoḓa u ḓivhulaha', 'a thi tsha ṱoḓa u tshila',                            // ve
          'ngifuna ukuzibulala', 'angisafuni ukuphila'))                                   // nr
    return yellow('suicidal_ideation');

  // GBV / Sexual assault — ORANGE (not YELLOW) for rape/sexual assault
  // Rape survivors need immediate care: PEP within 72h, emergency contraception within 120h
  if (has('raped', 'rape', 'sexually assaulted', 'sexual assault', 'someone forced themselves on me',
          'ngidlwengulwe', 'badlwengula', 'bangiphoqile',
          'ndidlwengulwe', 'bandidlwengula', 'bandinyanzela',
          'verkrag', 'aangerand', 'seksueel aangerand',
          'ke katilwe', 'ba mphetetše', 'ke gathilwe',
          'ke ile ka katwa', 'ba mphethetse',
          'ndzi dlayiwe', 'va ndzi sindzisile',
          'ngidlwengulwe', 'bangiphotjile',
          'ndo tshinyadzwa', 'vho nnyadzela',
          'ngidlwengulwe', 'bangiphoqile'))
    return { triage_level: 'ORANGE', confidence: 100, rule_override: 'gbv_sexual_assault', icd10: DCSL_ICD10_MAP.gbv_sexual_assault };

  // GBV / domestic violence / assault — YELLOW
  if (has('attacked', 'assaulted', 'beaten badly', 'domestic violence', 'husband beat me', 'partner hit me', 'child abuse', 'abused',
          'ngishaywe', 'umlenze wami ungishayile', 'indoda yami ingishayile',
          'ndibethiwe', 'indoda yam indibethile',
          'geslaan', 'my man het my geslaan', 'huishoudelike geweld',
          'ke betilwe', 'monna wa ka o ntlhabile',
          'ke otlilwe', 'monna wa me o ntlhabile',
          'ke otloilwe', 'monna wa ka o ntshabile',
          'ndzi bitiwe', 'nuna wa mina u ndzi bile',
          'ngishayiwe', 'indvodza yami ingishayile',
          'ndo rwiwa', 'munna wanga o nrwa',
          'ngitjhayiwe', 'indoda yami ingitjhayile'))
    return yellow('abuse_assault');

  if ((has('uti', 'urinary tract', 'pain when urinating', 'burning urine', 'frequency',
           'kusha emchamweni', 'ubuhlungu emchamweni', 'kushisa umchamo',                  // zu
           'ukuchama kusha', 'ukuchama kubuhlungu',                                        // xh
           'brand as ek urineer', 'pyn as ek urineer',                                    // af
           'go swela ge ke ntsha meetse', 'go sha ge ke ntsha meetse',                     // nso
           'go tshwara go bohloko loko ke ntsha meetse', 'go sha fa ke ntsha metsi',       // tn
           'ho sha ha ke ntsha metsi', 'ho bohloko ha ke ntsha metsi',                     // st
           'ku hisa loko ndzi sila manzi', 'ku bohloko loko ndzi sila',                    // ts
           'kushisa emchamweni', 'kubuhlungu nawuchama',                                   // ss
           'u fhisa hune ndi a china', 'u rema hune ndi a china',                          // ve
           'ukusha emchamweni', 'ubuhlungu emchamweni')) &&                                // nr
      has('back pain', 'loin pain', 'kidney pain', 'fever', 'temperature', 'chills', 'rigors', 'shivering', 'vomiting',
          'ubuhlungu emhlane', 'umhlane ubuhlungu',                                        // zu
          'umhlana ubuhlungu', 'ubuhlungu emhlana',                                        // xh
          'rugpyn', 'rug is seer',                                                         // af
          'mokokotlo o bohloko', 'bohloko mokokotlong',                                    // nso
          'mmogo o bohloko', 'bohloko mmogong',                                            // tn
          'mokokotlo o bohloko', 'bohloko mokokotlong',                                    // st
          'mhamba wo bohloko', 'bohloko emhamben',                                         // ts
          'umhlane ubuhlungu', 'ubuhlungu emhlane',                                        // ss
          'murahu u rema', 'muvhili wa murahu u rema',                                     // ve
          'umhlane ubuhlungu', 'ubuhlungu emhlane'))                                       // nr
    return yellow('pyelonephritis');

  if ((has('diabetic', 'diabetes', 'sugar', 'on insulin',
           'ushukela', 'iswekile', 'ngineshukela',                                         // zu
           'iswekile', 'ndinesifo seswekile',                                              // xh
           'suiker', 'suikersiekte', 'diabeet',                                            // af
           'bolwetši bja swikiri', 'swikiri',                                              // nso
           'bolwetse jwa sukiri', 'sukiri', 'tswekere',                                    // tn
           'bolwetsi ba tsoekere', 'tsoekere',                                             // st
           'vuvabyi bya swikiri', 'swikiri',                                               // ts
           'sifo seshugela', 'ishugela',                                                   // ss
           'vhulwadze ha swigiri', 'swigiri',                                              // ve
           'isifo sesiswigiri', 'ishukela')) &&                                            // nr
      has('vomiting', 'nauseous', 'stomach pain', 'abdominal pain',
          'ukuhlanza', 'ngiyahlanza', 'isisu sibuhlungu',                                  // zu
          'ukuhlanza', 'ndiyahlanza', 'isisu sibuhlungu',                                  // xh
          'braak', 'gooi op', 'maag pyn',                                                  // af
          'go hlanza', 'ke a hlanza', 'mpa e bohloko',                                    // nso
          'go tlhaka', 'ke a tlhaka', 'mpa e botlhoko',                                   // tn
          'ho hlantsa', 'ke a hlantsa', 'mpa e bohloko',                                  // st
          'ku hlanza', 'ndzi a hlanza', 'ndzayo wu vava',                                  // ts
          'kuhlanza', 'ngiyahlanza', 'sisu sibuhlungu',                                    // ss
          'u sema', 'ndi a sema', 'thumbu i na vuvha',                                    // ve
          'ukuhlanza', 'ngiyahlanza', 'isisu sibuhlungu') &&                               // nr
      has('breath smells sweet', 'fruity breath', 'ketone breath', 'blood sugar very high', 'glucose 20', 'glucose over 20', 'glucose over 15', 'sugar very high',
          'ishukela liphezulu kakhulu', 'ushukela uphezulu',                                // zu
          'iswekile liphezulu kakhulu',                                                    // xh
          'suiker baie hoog', 'bloedsuiker hoog',                                          // af
          'swikiri e phagameng kudu',                                                      // nso
          'sukiri e kwa godimo thata', 'tswekere e kwa godimo',                            // tn
          'tsoekere e phagameng haholo',                                                   // st
          'swikiri yi tlakukile ngopfu',                                                   // ts
          'ishugela liphakeme kakhulu',                                                    // ss
          'swigiri dzi ḓiimisela ngopfu',                                                  // ve
          'ishukela liphezulu kakhulu'))                                                   // nr
    return yellow('dka');

  if (has('cough', 'khohlela', 'khwehlela',                                                // zu/ss/nr
          'ukukhohlela', 'khohlela', 'ndikhohla', 'ndikhwehlela',                          // xh
          'hoes',                                                                           // af
          'gohlola',                                                                        // nso/tn
          'hehela',                                                                         // st
          'hovelela',                                                                       // ts
          'khalutshela') &&                                                                // ve
      has('night sweats', 'sweating at night', 'sweat at night',
          'juluka ebusuku', 'umjuluko ebusuku',                                            // zu
          'khefuzela ebusuku',                                                             // xh
          'sweet snags', 'nagsweet',                                                       // af
          'phwa bosigo', 'fufulelwa bosigo',                                               // nso
          'tswa marothodi bosigo', 'fufulelwa bosigo',                                     // tn
          'tswa molapo bosiu',                                                             // st
          'xurha usiku',                                                                   // ts
          'khuzama ebusuku',                                                               // ss
          'mavhungo usiku',                                                                // ve
          'umjuluko ebusuku') &&                                                           // nr
      has('weight loss', 'losing weight', 'lost weight',
          'nciphile isisindo', 'lahlekelwe isisindo',                                      // zu
          'phulukane nesixa', 'lahlekelwe sisixa',                                         // xh
          'gewig verloor',                                                                 // af
          'lahlegetšwe ke boima',                                                          // nso
          'latlhile boima',                                                                // tn
          'lahlehetse boima',                                                              // st
          'khomokile ncilo',                                                               // ts
          'ncokolele lisindo',                                                             // ss
          'laha vhuimo',                                                                   // ve
          'nciphile isisindo'))                                                            // nr
    return yellow('tb_triad');

  if ((has('fell', 'fell down', 'twisted', 'injury', 'trauma')) &&
      has("can't walk", "can't bear weight", "can't move it", 'deformed', 'swollen and painful', 'looks bent', 'crooked'))
    return yellow('possible_fracture');

  if ((has('blood pressure high', 'bp high', 'high blood', 'hypertension',
           'umfutho wegazi uphezulu', 'igazi eliphakeme',                                  // zu
           'uxinzelelo lwegazi luphezulu',                                                 // xh
           'bloeddruk hoog', 'hoë bloeddruk',                                              // af
           'kgatelelo ya madi e godimo', 'madi a godilego',                                // nso
           'kgatelelo ya madi e kwa godimo', 'madi a godileng',                            // tn
           'kgatello ya madi e phahameng', 'madi a phahameng',                             // st
           'nsinya wa ngati wu tlakukile', 'ngati ya le henhla',                           // ts
           'ingati lephakeme', 'umfutho wegazi uphakeme',                                  // ss
           'phuvhelo ya madi i phanda', 'malofha o ḓiimisela',                             // ve
           'igazi eliphezulu', 'umfutho wegazi uphezulu')) &&                               // nr
      has('headache', 'blurred vision', 'dizzy', 'nosebleed', 'confused',
          'ikhanda', 'isiyezi',                                                            // zu
          'intloko', 'isiyezi',                                                            // xh
          'hoofpyn', 'duiselig',                                                           // af
          'hlogo', 'o a tekateka',                                                         // nso
          'tlhogo', 'o a tekateka',                                                        // tn
          'hloho', 'o a tekateka',                                                         // st
          'rixaka', 'u a tekateka',                                                        // ts
          'ikhanda', 'uyesuka',                                                            // ss
          'ṱhoho', 'u a ṱavhanya',                                                        // ve
          'ikhanda', 'iyesuka'))                                                           // nr
    return yellow('hypertensive_urgency');
  if (has('bp 180', 'bp 190', 'bp 200', 'bp 170') && has('headache', 'dizzy', 'vision'))
    return yellow('hypertensive_urgency_reading');

  if (has('pain right side stomach', 'lower right pain', 'right lower quadrant', 'appendix pain', 'right abdo pain') &&
      has('fever', 'vomiting', 'worse when moving', "can't straighten up"))
    return yellow('appendicitis_pattern');

  if ((has('asthma') || has('inhaler', 'pump')) && has('not working', 'not helping', 'still struggling', 'need more puffs'))
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
    const hasHivSignal = has('hiv positive', 'hiv+', 'on arvs', 'arv', 'taking arvs', 'hiv disease');
    const hasFeverSignal = has(
      'fever', 'high temperature', 'temperature', 'hot', 'shivering',
      'umkhuhlane', 'ufudumele',                                                           // zu
      'uyashisa',                                                                          // xh / ss
      'koors',                                                                             // af
      'mogote', 'fisa',                                                                    // nso / tn
      'mocheso', 'ho fisa',                                                                // st
      'fivha',                                                                             // ts
      'imfiva',                                                                            // ss
      'muḓifhiso',                                                                         // ve
    );
    const hasNeckTerm = has(
      'neck',
      'umnqala',              // zu
      'intamo',               // xh / nr
      'nek',                  // af
      'molala',               // nso / tn / st
      'nkulo',                // ts
      'intsamo',              // ss
      'mulala',               // ve
    );
    const hasStiffOrPainTerm = has(
      'stiff', 'rigid', 'pain', 'ache', 'sore', 'hurts', "can't bend", "can't move",
      'cant bend', 'cant move', 'cannot bend',
      'qinile', 'ubuhlungu', 'womelele',                                                   // zu
      'eqinileyo', 'ibuhlungu',                                                            // xh
      'styf', 'stywe',                                                                     // af
      'thata', 'bohloko', 'botlhoko',                                                      // nso / tn / st
      'tiyile', 'vava',                                                                    // ts
      'icinile',                                                                           // ss
      'omela', 'vuvha',                                                                    // ve
    );
    if (hasHivSignal && hasFeverSignal && hasNeckTerm && hasStiffOrPainTerm) {
      logger.warn('[RULE] hiv_meningism — HIV + fever + neck stiffness/pain → ORANGE');
      return orange('hiv_meningism');
    }
  }

  if (has('fever', 'umkhuhlane', 'koors', 'mogote', 'mocheso', 'fivha', 'muḓifhiso') &&
      has('stiff neck', 'neck stiff', 'neck pain', "can't bend neck", 'neck is stiff',
          'umnqala ubuhlungu', 'umnqala womelele',                                         // zu
          'intamo eqinileyo', 'intamo ibuhlungu',                                          // xh
          'stywe nek', 'nek is styf',                                                      // af
          'molala o thata', 'molala o bohloko',                                            // nso
          'molala o thata', 'molala o botlhoko',                                           // tn
          'molala o thata', 'molala o bohloko',                                            // st
          'nkulo wu tiyile', 'nkulo wu vava',                                              // ts
          'intsamo icinile', 'intsamo ibuhlungu',                                          // ss
          'mulala wo omela', 'mulala u na vuvha',                                          // ve
          'intamo iqinile', 'intamo ibuhlungu'))                                           // nr
    return yellow('meningism');

  // HIV + fever: risk-UPGRADE signal. Enforce YELLOW as a floor, preserve any
  // higher level the LLM already assigned (eval P16 caught this overwriting ORANGE).
  if ((has('hiv positive', 'hiv+', 'on arvs', 'arv', 'taking arvs', 'positive')) && has('fever', 'high temperature', 'temperature', 'sick')) {
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

  if (has('lower abdominal pain', 'lower tummy pain', 'lower belly pain', 'pelvic pain') && has('missed period', 'late period', 'no period', 'period late'))
    return yellow('lower_abdo_missed_period');

  if ((has('pregnant', 'khulelwe', 'emita', 'swanger', 'swangari')) &&
      has('pain', 'bleeding', 'swelling', 'headache', 'vision', 'movement reduced', 'no movement', "baby hasn't moved"))
    return yellow('pregnancy_complication');

  if (has('vomiting blood', 'throwing up blood', 'blood in vomit', 'blood in stool', 'blood in poo', 'black tarry stool', 'bloody diarrhoea', 'rectal bleeding',
          'upha igazi', 'igazi esibileni', 'igazi emhlanzweni',                            // zu
          'igazi emphanzweni', 'igazi esisweni',                                           // xh
          'bloed opgooi', 'bloed in stoelgang',                                            // af
          'madi a tšwa ka ganong', 'madi mantšwing',                                       // nso
          'madi a tswa ka ganong', 'madi mo mantswing',                                    // tn
          'madi a tswa ka ganong', 'madi leetšong',                                        // st
          'ngati yi huma hi nomo', 'ngati enyangweni',                                     // ts
          'ingati iyaphumela ngemlomeni', 'ingati esitweni',                               // ss
          'malofha a bva nga mulomoni', 'malofha mutswoni',                                // ve
          'igazi liphuma ngomlomo', 'igazi esithweni'))                                    // nr
    return yellow('gi_bleeding');

  if ((has('deep cut', 'deep wound', 'puncture wound', 'stab wound', 'bite wound', 'animal bite', 'rusty nail', 'glass in wound')) &&
      !has('spurting', 'pouring', "can't stop"))
    return yellow('deep_wound');

  if (has('not passed urine', 'no urine for hours', 'mouth very dry', 'very dizzy', "can't keep fluids down", 'vomiting everything', 'diarrhoea and vomiting together') &&
      has('baby', 'child', 'infant', 'elderly', 'diabetic', 'hiv'))
    return yellow('severe_dehydration_vulnerable');

  if ((has('something in eye', 'chemical in eye', 'eye injury', 'hit in eye')) ||
      (has('vision', "can't see") && has('sudden', 'suddenly', 'went blind', 'blur suddenly')))
    return yellow('eye_emergency');

  if (has('testicular pain', 'testicle pain', 'scrotum pain', 'swollen testicle') && has('sudden', 'severe', "can't walk"))
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
      (has('face drooping', 'face dropped', 'mouth twisted', 'ubuso buyehla', 'gesig hang',
           'sefatlhego se theogetse', 'xikandza xi rhelerile', 'tshifhaṱuwo tsho thela') &&
       has('arm', 'weak', 'speech', 'talk', 'speak', 'ingalo', 'ukhuluma', 'letsogo')) ||
      // Pregnant + severe headache + vision changes (pre-eclampsia)
      (has('pregnant', 'khulelwe', 'swanger', 'ke imile', 'ke ipaakanyeditse', 'ndzi tikile') &&
       has('headache', 'ikhanda', 'hoofpyn', 'hlogo', 'tlhogo', 'rixaka', 'ṱhoho') &&
       has('vision', 'blur', 'swollen', 'swelling', 'amehlo', 'oë', 'matlho', 'mahlo')) ||
      // Child + seizure/fitting + fever (febrile seizure)
      (has('child', 'baby', 'ingane', 'umntwana', 'ngwana', 'nwana', 'umntfwana', 'ṅwana', 'kind') &&
       has('fit', 'seizure', 'shaking', 'fitting', 'banjwa', 'thothomela', 'rotha', 'rhurhumela', 'dzhendzela') &&
       has('fever', 'hot', 'temperature', 'umkhuhlane', 'koors', 'mogote', 'fivha', 'muḓifhiso')) ||
      // Confusion + known chronic disease (DM/HTN/HIV)
      (has('confused', 'confusion', 'not making sense', 'udidekile', 'deurmekaar',
           'o didimala', 'u didimele', 'udzakiwe', 'o ḓidimala') &&
       has('diabetic', 'diabetes', 'sugar', 'hypertension', 'high blood', 'hiv',
           'ushukela', 'suiker', 'swikiri', 'sukiri', 'tsoekere', 'ishugela', 'swigiri')) ||
      // Sudden worst-ever headache (thunderclap — may not have matched exact DCSL phrase)
      (has('worst headache', 'worst head pain', 'sudden severe headache', 'never had headache this bad',
           'thunderclap', 'explosive headache'));

    if (orangeConcerns) {
      logger.warn('[SAFETY-NET] YELLOW upgrade to ORANGE — ORANGE-level signals in YELLOW triage');
      return { triage_level: 'ORANGE', confidence: triage.confidence, rule_override: 'yellow_safety_net', icd10: DCSL_ICD10_MAP.yellow_safety_net };
    }
  }

  // GREEN → YELLOW safety net: catches concerning keywords the AI classified as GREEN
  if (triage.triage_level === 'GREEN') {
    const greenConcerns = has('fever', 'temperature', 'umkhuhlane', 'koors') ||
      has('pregnant', 'khulelwe', 'emita', 'swanger', 'swangari') ||
      has('blood', 'bleeding', 'igazi', 'bloei', 'opha') ||
      has('vomiting', 'diarrhoea', 'dehydrated') ||
      has('child', 'baby', 'infant', 'ingane', 'umntwana', 'ibhebhe') ||
      has('diabetic', 'diabetes', 'sugar', 'hiv', 'arv') ||
      // C6: chest pain in any adult is YELLOW minimum, regardless of
      // severity modifier ("a little", "mild", "not that bad"). Surfaced
      // by eval P04 T1: "isifuba sibuhlungu kancane" returned GREEN in
      // 5/5 runs despite SATS guidance that any chest pain warrants
      // urgent assessment. Adult chest-pain minimisers are a well-known
      // under-triage failure mode in LMIC primary care.
      has('chest pain', 'chest hurts', 'chest hurting', 'chest tight',
          'chest tightness', 'chest pressure', 'chest heaviness',
          'chest is tight', 'chest is hurting', 'chest discomfort',
          'isifuba',                                                     // zu / xh / nr
          'bors',                                                        // af
          'sehuba', 'sefuba',                                            // nso / tn / st
          'xifuva',                                                      // ts
          'sifuba',                                                      // ss
          'tshifuva');                                                   // ve
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
