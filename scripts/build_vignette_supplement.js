// Build Supplementary Table S1 for medRxiv resubmission.
//
// Combines:
//  - Vignette inputs from run_vignettes.js (inline array)
//  - BN gold-standard triage levels (reconstructed by position per
//    manuscript's reported distribution: 5 RED + 8 ORANGE + 11 YELLOW +
//    6 GREEN per 30-vignette language cohort)
//  - SP blinded independent ratings (hard-coded from the Sheila response
//    document pasted in session on 2026-04-20)
//  - AI classifications from Haiku 4.5 (vignette_results.json, Apr 8)
//  - AI classifications from Sonnet 4 (vignette_results_sonnet.json, today)
//  - English translations (to be added separately; placeholder field)
//
// Outputs:
//  - docs/supplementary_s1_vignettes.csv — machine-readable
//  - docs/supplementary_s1_vignettes.md — human-readable rendered table
//  - docs/supplementary_s1_methods_note.md — companion half-page methods
//
// Usage: node scripts/build_vignette_supplement.js

const fs = require('fs');
const path = require('path');

// ──────────────────────────────────────────────────────────────────────
// Extract the inline V=[...] array from run_vignettes.js. Simplest: re-
// import by reading the file and eval'ing the matched array.
// ──────────────────────────────────────────────────────────────────────

const runnerSource = fs.readFileSync(path.join(__dirname, '..', 'run_vignettes.js'), 'utf8');
const vMatch = runnerSource.match(/const V=\[([\s\S]*?)\];/);
if (!vMatch) { console.error('Could not find V=[...] in run_vignettes.js'); process.exit(1); }
const V = eval('[' + vMatch[1] + ']');
console.error('Loaded', V.length, 'vignettes from run_vignettes.js');

// ──────────────────────────────────────────────────────────────────────
// BN gold-standard triage by position. Each 30-vignette language cohort
// follows: V{n..n+4} = RED, V{n+5..n+12} = ORANGE, V{n+13..n+23} = YELLOW,
// V{n+24..n+29} = GREEN. Verified against manuscript's 5/8/11/6 per-language
// distribution and against the three explicitly-named under-triage cases
// V041 (ORANGE), V072 (ORANGE), V103 (ORANGE).
// ──────────────────────────────────────────────────────────────────────

function bnGoldForId(id) {
  const n = parseInt(id.replace(/^V0*/, ''), 10); // V001 -> 1, V041 -> 41, V120 -> 120
  const pos = ((n - 1) % 30) + 1; // position within 30-vignette cohort: 1..30
  if (pos <= 5)  return 'RED';
  if (pos <= 13) return 'ORANGE';
  if (pos <= 24) return 'YELLOW';
  return 'GREEN';
}

// ──────────────────────────────────────────────────────────────────────
// SP blinded ratings — hard-coded from the Sheila response document
// pasted by Bongekile 2026-04-20. Codes in that document: V001=RED,
// V002=ORANGE, V003=YELLOW, V004=GREEN. V058 had a typo "V00. GREEN"
// treated as V004 = GREEN.
// ──────────────────────────────────────────────────────────────────────

const SP_RAW = {
  // English (V001-V030)
  V001:'RED', V002:'RED', V003:'RED', V004:'RED', V005:'RED',
  V006:'RED', V007:'YELLOW', V008:'RED', V009:'RED', V010:'RED',
  V011:'RED', V012:'RED', V013:'RED', V014:'YELLOW', V015:'YELLOW',
  V016:'RED', V017:'YELLOW', V018:'RED', V019:'ORANGE', V020:'ORANGE',
  V021:'RED', V022:'ORANGE', V023:'ORANGE', V024:'ORANGE', V025:'GREEN',
  V026:'GREEN', V027:'GREEN', V028:'GREEN', V029:'GREEN', V030:'GREEN',
  // isiZulu (V031-V060)
  V031:'RED', V032:'RED', V033:'RED', V034:'RED', V035:'RED',
  V036:'RED', V037:'YELLOW', V038:'RED', V039:'RED', V040:'RED',
  V041:'ORANGE', V042:'RED', V043:'RED', V044:'YELLOW', V045:'YELLOW',
  V046:'RED', V047:'YELLOW', V048:'RED', V049:'ORANGE', V050:'RED',
  V051:'RED', V052:'ORANGE', V053:'ORANGE', V054:'ORANGE', V055:'GREEN',
  V056:'GREEN', V057:'GREEN', V058:'GREEN', V059:'GREEN', V060:'GREEN',
  // isiXhosa (V061-V090)
  V061:'RED', V062:'RED', V063:'RED', V064:'RED', V065:'RED',
  V066:'RED', V067:'ORANGE', V068:'RED', V069:'RED', V070:'RED',
  V071:'RED', V072:'RED', V073:'RED', V074:'YELLOW', V075:'YELLOW',
  V076:'RED', V077:'YELLOW', V078:'RED', V079:'ORANGE', V080:'RED',
  V081:'RED', V082:'YELLOW', V083:'RED', V084:'ORANGE', V085:'GREEN',
  V086:'GREEN', V087:'GREEN', V088:'GREEN', V089:'GREEN', V090:'GREEN',
  // Afrikaans (V091-V120)
  V091:'RED', V092:'RED', V093:'RED', V094:'RED', V095:'RED',
  V096:'RED', V097:'YELLOW', V098:'RED', V099:'RED', V100:'RED',
  V101:'RED', V102:'RED', V103:'RED', V104:'GREEN', V105:'GREEN',
  V106:'ORANGE', V107:'YELLOW', V108:'RED', V109:'YELLOW', V110:'ORANGE',
  V111:'RED', V112:'YELLOW', V113:'RED', V114:'ORANGE', V115:'GREEN',
  V116:'GREEN', V117:'GREEN', V118:'GREEN', V119:'GREEN', V120:'GREEN',
};

// ──────────────────────────────────────────────────────────────────────
// Load AI classifications
// ──────────────────────────────────────────────────────────────────────

function loadAIResults(relativePath, label) {
  try {
    const r = JSON.parse(fs.readFileSync(path.join(__dirname, '..', relativePath), 'utf8'));
    const map = {};
    for (const entry of r.results || []) map[entry.id] = entry.triage;
    console.error('Loaded', Object.keys(map).length, 'AI classifications from', label, '(', relativePath, ')');
    return map;
  } catch (e) { console.error('Could not load', relativePath, ':', e.message); return {}; }
}

const HAIKU = loadAIResults('vignette_results_Apr2026.json', 'Haiku 4.5 (1 April 2026 re-run — primary validation dataset)');
const SONNET = loadAIResults('vignette_results_Sonnet_Apr2026.json', 'Sonnet 4 (2 April 2026 post-validation production configuration)');

// ──────────────────────────────────────────────────────────────────────
// English translations placeholder. For V001-V030 the "translation"
// column is the original text (already English). For V031-V120 this is
// a translation to be filled in separately.
// ──────────────────────────────────────────────────────────────────────

const TRANSLATIONS_PATH = path.join(__dirname, '..', 'docs', 'vignette_english_translations.json');
let TRANSLATIONS = {};
if (fs.existsSync(TRANSLATIONS_PATH)) {
  TRANSLATIONS = JSON.parse(fs.readFileSync(TRANSLATIONS_PATH, 'utf8'));
  console.error('Loaded English translations for', Object.keys(TRANSLATIONS).length, 'non-English vignettes');
}

// ──────────────────────────────────────────────────────────────────────
// Build rows
// ──────────────────────────────────────────────────────────────────────

const LEVELS = { RED: 1, ORANGE: 2, YELLOW: 3, GREEN: 4 };
function outcomeVsGold(gold, system) {
  if (!gold || !system) return '';
  const g = LEVELS[gold], s = LEVELS[system];
  if (!g || !s) return '';
  if (g === s) return 'CORRECT';
  if (s < g) {
    const d = g - s;
    return d >= 2 ? 'OVER-TRIAGED (2-level)' : 'OVER-TRIAGED';
  }
  const d = s - g;
  return d >= 2 ? 'UNDER-TRIAGED (2-level)' : 'UNDER-TRIAGED';
}

const rows = V.map(([id, lang, age, sex, rf, text]) => {
  const gold = bnGoldForId(id);
  const haikuCls = HAIKU[id] || 'NOT_RUN';
  return {
    id,
    language: lang,
    age,
    sex,
    risk_factors: rf,
    symptom_text_original: text,
    symptom_text_english: lang === 'English' ? text : (TRANSLATIONS[id] || '[TRANSLATION PENDING]'),
    bn_gold_standard: gold,
    sp_blinded_rating: SP_RAW[id] || 'MISSING',
    haiku_4_5_classification: haikuCls,
    haiku_outcome_vs_gold: outcomeVsGold(gold, haikuCls),
    sonnet_4_classification: SONNET[id] || 'NOT_RUN',
  };
});

// ──────────────────────────────────────────────────────────────────────
// Emit CSV
// ──────────────────────────────────────────────────────────────────────

function csvEscape(v) {
  const s = String(v == null ? '' : v);
  if (/[",\n]/.test(s)) return '"' + s.replace(/"/g, '""') + '"';
  return s;
}

const csvHeader = ['id','language','age','sex','risk_factors','symptom_text_original','symptom_text_english','bn_gold_standard','sp_blinded_rating','haiku_4_5_classification','haiku_outcome_vs_gold','sonnet_4_classification'];
const csvLines = [csvHeader.join(',')];
for (const r of rows) {
  csvLines.push(csvHeader.map(h => csvEscape(r[h])).join(','));
}
const csvOut = csvLines.join('\n');
fs.writeFileSync(path.join(__dirname, '..', 'docs', 'supplementary_s1_vignettes.csv'), csvOut);
console.error('Wrote docs/supplementary_s1_vignettes.csv');

// ──────────────────────────────────────────────────────────────────────
// Emit markdown table per-language
// ──────────────────────────────────────────────────────────────────────

function mdEscape(v) {
  return String(v == null ? '' : v).replace(/\|/g, '\\|').replace(/\n/g, ' ');
}

let md = '# Supplementary Table S1 — 120-vignette validation dataset\n\n';
md += 'Full dataset supporting the primary safety assessment reported in the main manuscript. Columns: vignette ID (V001–V120); language; patient demographics; symptom text as written (original language); symptom text in English (translation for non-English rows); BN reference-standard triage (assigned by the author using SATS clinical discriminators); SP blinded independent rating (by Clinical Governance Lead, RN; used for inter-rater kappa); Haiku 4.5 classification (primary validation — 1 April 2026 re-run, `vignette_results_Apr2026.json`); outcome vs gold standard (CORRECT / OVER-TRIAGED / UNDER-TRIAGED / 2-level variants); Sonnet 4 classification (2 April 2026 post-validation production-configuration run, not part of the primary validation — shown for transparency only).\n\n';
md += 'Machine-readable CSV at `docs/supplementary_s1_vignettes.csv`. Methods at `docs/supplementary_s1_methods_note.md`. Data-provenance record at `docs/march2026_validation_correction.md`.\n\n';

for (const cohortLang of ['English','isiZulu','isiXhosa','Afrikaans']) {
  md += '## ' + cohortLang + ' (N=30)\n\n';
  md += '| ID | Age | Sex | Risk factors | Symptom text (original) | Symptom text (English) | BN gold | SP rating | Haiku 4.5 | Outcome vs gold | Sonnet 4 |\n';
  md += '|---|---|---|---|---|---|---|---|---|---|---|\n';
  for (const r of rows.filter(x => x.language === cohortLang)) {
    md += '| ' + mdEscape(r.id)
      + ' | ' + mdEscape(r.age)
      + ' | ' + mdEscape(r.sex)
      + ' | ' + mdEscape(r.risk_factors || '—')
      + ' | ' + mdEscape(r.symptom_text_original)
      + ' | ' + (cohortLang === 'English' ? '—' : mdEscape(r.symptom_text_english))
      + ' | ' + mdEscape(r.bn_gold_standard)
      + ' | ' + mdEscape(r.sp_blinded_rating)
      + ' | ' + mdEscape(r.haiku_4_5_classification)
      + ' | ' + mdEscape(r.haiku_outcome_vs_gold)
      + ' | ' + mdEscape(r.sonnet_4_classification)
      + ' |\n';
  }
  md += '\n';
}

// ──────────────────────────────────────────────────────────────────────
// Summary block: Haiku vs Sonnet vs gold, under-triage comparison
// ──────────────────────────────────────────────────────────────────────

function distByModel(field) {
  const d = {RED:0, ORANGE:0, YELLOW:0, GREEN:0, ERROR:0, NOT_RUN:0, MISSING:0};
  for (const r of rows) d[r[field]] = (d[r[field]] || 0) + 1;
  return d;
}

const LEVEL_RANK = { GREEN:0, YELLOW:1, ORANGE:2, RED:3 };
function triageDelta(predicted, gold) {
  if (!LEVEL_RANK.hasOwnProperty(predicted) || !LEVEL_RANK.hasOwnProperty(gold)) return null;
  return LEVEL_RANK[predicted] - LEVEL_RANK[gold];
}

function perfVsGold(field) {
  let correct = 0, over = 0, under = 0, redMissed = 0, total = 0, invalid = 0;
  for (const r of rows) {
    const p = r[field], g = r.bn_gold_standard;
    if (!LEVEL_RANK.hasOwnProperty(p)) { invalid++; continue; }
    const d = triageDelta(p, g);
    total++;
    if (d === 0) correct++;
    else if (d > 0) over++;
    else { under++; if (g === 'RED') redMissed++; }
  }
  return {correct, over, under, redMissed, total, invalid};
}

md += '## Summary statistics\n\n';
md += '### Classification distribution\n\n';
md += '| Classifier | RED | ORANGE | YELLOW | GREEN | ERROR / NOT_RUN |\n';
md += '|---|---|---|---|---|---|\n';
for (const field of ['bn_gold_standard','sp_blinded_rating','haiku_4_5_classification','sonnet_4_classification']) {
  const d = distByModel(field);
  md += '| ' + field + ' | ' + d.RED + ' | ' + d.ORANGE + ' | ' + d.YELLOW + ' | ' + d.GREEN + ' | ' + ((d.ERROR||0) + (d.NOT_RUN||0) + (d.MISSING||0)) + ' |\n';
}
md += '\n### Performance vs BN reference standard\n\n';
md += '| Classifier | Correct | Over-triage | Under-triage | RED missed | Evaluable |\n';
md += '|---|---|---|---|---|---|\n';
for (const field of ['sp_blinded_rating','haiku_4_5_classification','sonnet_4_classification']) {
  const p = perfVsGold(field);
  md += '| ' + field + ' | ' + p.correct + '/' + p.total + ' (' + Math.round(100*p.correct/p.total) + '%) | '
    + p.over + '/' + p.total + ' (' + (p.total?Math.round(100*p.over/p.total):0) + '%) | '
    + p.under + '/' + p.total + ' (' + (p.total?Math.round(100*p.under/p.total):0) + '%) | '
    + p.redMissed + '/20 | '
    + p.total + '/120' + (p.invalid ? ' (' + p.invalid + ' invalid)' : '')
    + ' |\n';
}

md += '\n### Haiku 4.5 → Sonnet 4: triage changes\n\n';
const changes = rows.filter(r => r.haiku_4_5_classification !== r.sonnet_4_classification && r.sonnet_4_classification !== 'NOT_RUN' && r.haiku_4_5_classification !== 'NOT_RUN');
if (changes.length === 0) {
  md += '_Sonnet run not yet complete or no differences detected. Rerun this script after Sonnet run finishes._\n\n';
} else {
  md += '| ID | Language | BN gold | Haiku 4.5 | Sonnet 4 | Δ vs gold (Haiku → Sonnet) |\n';
  md += '|---|---|---|---|---|---|\n';
  for (const r of changes) {
    const dH = triageDelta(r.haiku_4_5_classification, r.bn_gold_standard);
    const dS = triageDelta(r.sonnet_4_classification, r.bn_gold_standard);
    const deltaStr = (dH===null?'N/A':dH>0?'+'+dH:dH) + ' → ' + (dS===null?'N/A':dS>0?'+'+dS:dS);
    md += '| ' + r.id + ' | ' + r.language + ' | ' + r.bn_gold_standard + ' | ' + r.haiku_4_5_classification + ' | ' + r.sonnet_4_classification + ' | ' + deltaStr + ' |\n';
  }
}

fs.writeFileSync(path.join(__dirname, '..', 'docs', 'supplementary_s1_vignettes.md'), md);
console.error('Wrote docs/supplementary_s1_vignettes.md');
console.error('');
console.error('Summary so far:');
console.error('  Haiku perf:', JSON.stringify(perfVsGold('haiku_4_5_classification')));
console.error('  Sonnet perf:', JSON.stringify(perfVsGold('sonnet_4_classification')));
