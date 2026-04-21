#!/usr/bin/env node
// Computes all manuscript-relevant metrics from the 1 April 2026 Haiku re-run.
// Gold standards sourced from docs/supplementary_s1_vignettes.csv (bn_gold_standard column).
// No interpretation, no framing — raw numeric output.

const fs = require('fs');
const path = require('path');

// ── Load data ─────────────────────────────────────────────────────
const APR = path.join(__dirname, '..', 'vignette_results_Apr2026.json');
const CSV = path.join(__dirname, '..', 'docs', 'supplementary_s1_vignettes.csv');
const apr = JSON.parse(fs.readFileSync(APR, 'utf8'));
const csvText = fs.readFileSync(CSV, 'utf8');

// ── Parse CSV (CSV-aware: handles quoted commas) ─────────────────
function parseRow(line) {
  const out = []; let cur = ''; let inQ = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (inQ) {
      if (c === '"' && line[i+1] === '"') { cur += '"'; i++; }
      else if (c === '"') inQ = false;
      else cur += c;
    } else {
      if (c === ',') { out.push(cur); cur = ''; }
      else if (c === '"') inQ = true;
      else cur += c;
    }
  }
  out.push(cur);
  return out;
}
const lines = csvText.split(/\r?\n/).filter(Boolean);
const hdr = parseRow(lines[0]);
const iId = hdr.indexOf('id');
const iLang = hdr.indexOf('language');
const iGold = hdr.indexOf('bn_gold_standard');
const goldMap = {};
const langMap = {};
for (const l of lines.slice(1)) {
  const r = parseRow(l);
  goldMap[r[iId]] = r[iGold];
  langMap[r[iId]] = r[iLang];
}

// ── Confusion matrix and per-case outcomes ───────────────────────
const LEVELS = ['RED', 'ORANGE', 'YELLOW', 'GREEN'];
const LEV = { RED: 1, ORANGE: 2, YELLOW: 3, GREEN: 4 };  // 1=most acute

const rows = apr.results.map(r => ({
  id: r.id,
  lang: langMap[r.id],
  gold: goldMap[r.id],
  system: r.triage,
  confidence: r.confidence,
}));

let correct = 0, over = 0, under = 0, twoLevelOver = 0, twoLevelUnder = 0;
const underCases = [], overCases = [], twoOverCases = [];
const perLevel = {
  RED:    { n: 0, correct: 0, over: 0, under: 0 },
  ORANGE: { n: 0, correct: 0, over: 0, under: 0 },
  YELLOW: { n: 0, correct: 0, over: 0, under: 0 },
  GREEN:  { n: 0, correct: 0, over: 0, under: 0 },
};

for (const r of rows) {
  const g = LEV[r.gold], s = LEV[r.system];
  if (!g || !s) continue;
  perLevel[r.gold].n++;
  const diff = s - g;  // negative = system higher urgency than gold (over)
  if (diff === 0) { correct++; perLevel[r.gold].correct++; }
  else if (diff < 0) {
    over++; perLevel[r.gold].over++;
    overCases.push(`${r.id} (${r.lang}, gold=${r.gold} → ${r.system})`);
    if (Math.abs(diff) >= 2) {
      twoLevelOver++;
      twoOverCases.push(`${r.id} (${r.lang}, gold=${r.gold} → ${r.system})`);
    }
  } else {
    under++; perLevel[r.gold].under++;
    underCases.push(`${r.id} (${r.lang}, gold=${r.gold} → ${r.system})`);
    if (diff >= 2) twoLevelUnder++;
  }
}
const n = rows.length;
const within1 = rows.filter(r => {
  const g = LEV[r.gold], s = LEV[r.system];
  return g && s && Math.abs(s - g) <= 1;
}).length;

// ── Clopper-Pearson exact binomial CI ────────────────────────────
// For k successes in n trials at confidence level 1-α:
//   Lower = I^{-1}_Beta(α/2; k, n-k+1)
//   Upper = I^{-1}_Beta(1-α/2; k+1, n-k)
// Inverted via bisection on the binomial CDF.
function logGamma(x) {
  // Lanczos approximation
  const g = 7;
  const c = [
    0.99999999999980993, 676.5203681218851, -1259.1392167224028,
    771.32342877765313, -176.61502916214059, 12.507343278686905,
    -0.13857109526572012, 9.9843695780195716e-6, 1.5056327351493116e-7
  ];
  if (x < 0.5) return Math.log(Math.PI / Math.sin(Math.PI * x)) - logGamma(1 - x);
  x -= 1;
  let a = c[0];
  const t = x + g + 0.5;
  for (let i = 1; i < g + 2; i++) a += c[i] / (x + i);
  return 0.5 * Math.log(2 * Math.PI) + (x + 0.5) * Math.log(t) - t + Math.log(a);
}
function logBinomPmf(k, n, p) {
  if (p <= 0) return k === 0 ? 0 : -Infinity;
  if (p >= 1) return k === n ? 0 : -Infinity;
  return logGamma(n + 1) - logGamma(k + 1) - logGamma(n - k + 1)
    + k * Math.log(p) + (n - k) * Math.log(1 - p);
}
function logSumExp(a, b) {
  if (a === -Infinity) return b;
  if (b === -Infinity) return a;
  const m = Math.max(a, b);
  return m + Math.log(Math.exp(a - m) + Math.exp(b - m));
}
function binomCdf(k, n, p) {
  // P(X <= k) where X ~ Bin(n, p)
  if (p <= 0) return 1;
  if (p >= 1) return k >= n ? 1 : 0;
  let lp = -Infinity;
  for (let i = 0; i <= k; i++) lp = logSumExp(lp, logBinomPmf(i, n, p));
  return Math.exp(lp);
}
function clopperPearson(k, n, alpha = 0.05) {
  // Lower: find p such that P(X >= k | p) = α/2, i.e. 1 - P(X <= k-1 | p) = α/2
  // Upper: find p such that P(X <= k | p) = α/2
  let lo = 0, hi = 0;
  if (k > 0) {
    let a = 0, b = 1;
    for (let i = 0; i < 200; i++) {
      const m = (a + b) / 2;
      const tail = 1 - binomCdf(k - 1, n, m);
      if (tail < alpha / 2) a = m; else b = m;
    }
    lo = (a + b) / 2;
  }
  if (k < n) {
    let a = 0, b = 1;
    for (let i = 0; i < 200; i++) {
      const m = (a + b) / 2;
      const tail = binomCdf(k, n, m);
      if (tail > alpha / 2) a = m; else b = m;
    }
    hi = (a + b) / 2;
  } else hi = 1;
  return [lo, hi];
}

// ── Quadratic weighted Cohen's kappa ─────────────────────────────
function weightedKappa(pairs, categories) {
  // pairs: array of [gold, system]
  const k = categories.length;
  const idx = {}; categories.forEach((c, i) => idx[c] = i);
  const N = pairs.length;
  // Observed
  const O = Array.from({length: k}, () => Array(k).fill(0));
  for (const [g, s] of pairs) O[idx[g]][idx[s]]++;
  // Marginals
  const rowSum = O.map(r => r.reduce((a,b)=>a+b, 0));
  const colSum = Array(k).fill(0);
  for (let i = 0; i < k; i++) for (let j = 0; j < k; j++) colSum[j] += O[i][j];
  // Weights (quadratic)
  const W = Array.from({length: k}, (_, i) => Array.from({length: k}, (_, j) =>
    1 - Math.pow(i - j, 2) / Math.pow(k - 1, 2)
  ));
  // Observed agreement
  let Ao = 0;
  for (let i = 0; i < k; i++) for (let j = 0; j < k; j++) Ao += W[i][j] * O[i][j] / N;
  // Expected agreement
  let Ae = 0;
  for (let i = 0; i < k; i++) for (let j = 0; j < k; j++)
    Ae += W[i][j] * (rowSum[i] / N) * (colSum[j] / N);
  return (Ao - Ae) / (1 - Ae);
}

// Bootstrap CI for kappa
function bootstrapKappaCI(pairs, categories, reps = 2000, alpha = 0.05, seed = 42) {
  let s = seed;
  function rand() { s = (s * 1103515245 + 12345) % 2147483648; return s / 2147483648; }
  const n = pairs.length;
  const ks = [];
  for (let r = 0; r < reps; r++) {
    const samp = [];
    for (let i = 0; i < n; i++) samp.push(pairs[Math.floor(rand() * n)]);
    try { ks.push(weightedKappa(samp, categories)); } catch (e) {}
  }
  ks.sort((a, b) => a - b);
  return [ks[Math.floor(ks.length * alpha / 2)], ks[Math.floor(ks.length * (1 - alpha / 2))]];
}

const pairs = rows.filter(r => LEV[r.gold] && LEV[r.system]).map(r => [r.gold, r.system]);
const kappa = weightedKappa(pairs, LEVELS);
const [kappaLo, kappaHi] = bootstrapKappaCI(pairs, LEVELS);

// Per-language kappa
const perLangKappa = {};
for (const lang of ['English', 'isiZulu', 'isiXhosa', 'Afrikaans']) {
  const pl = pairs.filter((_, i) => {
    const r = rows[i];
    return r && r.lang === lang;
  });
  // actually need to use rows filtered consistently
}
// Simpler: build per-language pair arrays directly
const langPairs = { English: [], isiZulu: [], isiXhosa: [], Afrikaans: [] };
for (const r of rows) {
  if (!LEV[r.gold] || !LEV[r.system]) continue;
  if (langPairs[r.lang]) langPairs[r.lang].push([r.gold, r.system]);
}
for (const lang of Object.keys(langPairs)) {
  const p = langPairs[lang];
  if (p.length > 0) {
    try { perLangKappa[lang] = { n: p.length, kappa: weightedKappa(p, LEVELS) }; }
    catch (e) { perLangKappa[lang] = { n: p.length, kappa: 'n/a' }; }
  }
}

// AI confidence distribution
const highConf = rows.filter(r => r.confidence != null && r.confidence >= 0.75).length;
const lowConf = n - highConf;

// ── Print ─────────────────────────────────────────────────────────
const pct = x => (x * 100).toFixed(1) + '%';
const fmt = x => (x * 100).toFixed(1);

console.log('══════════════════════════════════════════════════════════════');
console.log('APRIL 1 2026 HAIKU RE-RUN — MANUSCRIPT METRICS');
console.log('Source: vignette_results_Apr2026.json');
console.log('Internal timestamp:', apr.timestamp);
console.log('Model:', apr.model || 'Haiku 4.5 (inferred from context)');
console.log('══════════════════════════════════════════════════════════════');
console.log();
console.log('N:', n);
console.log('Gold distribution:', LEVELS.map(l => `${l}=${perLevel[l].n}`).join(', '));
console.log('System distribution:', apr.counts);
console.log();

console.log('── HEADLINE METRICS ──');
const [uLo, uHi] = clopperPearson(under, n);
const [oLo, oHi] = clopperPearson(over, n);
console.log(`Under-triage:        ${under}/${n} = ${pct(under/n)}   (Clopper-Pearson 95% CI: ${pct(uLo)}–${pct(uHi)})`);
console.log(`Over-triage:         ${over}/${n} = ${pct(over/n)}   (Clopper-Pearson 95% CI: ${pct(oLo)}–${pct(oHi)})`);
console.log(`Exact concordance:   ${correct}/${n} = ${pct(correct/n)}`);
console.log(`Within 1 SATS level: ${within1}/${n} = ${pct(within1/n)}`);
console.log(`Two-level over:      ${twoLevelOver}/${n}`);
console.log(`Two-level under:     ${twoLevelUnder}/${n}`);
console.log(`Quadratic weighted kappa: ${kappa.toFixed(3)} (bootstrap 95% CI: ${kappaLo.toFixed(3)}–${kappaHi.toFixed(3)}, 2000 reps)`);
console.log();

console.log('── PER-LEVEL BREAKDOWN (Table 3) ──');
console.log('Gold    n    correct         over-triaged    under-triaged');
for (const l of LEVELS) {
  const t = perLevel[l];
  const cP = t.n > 0 ? `(${fmt(t.correct/t.n)}%)` : '';
  const oP = t.n > 0 ? `(${fmt(t.over/t.n)}%)` : '';
  const uP = t.n > 0 ? `(${fmt(t.under/t.n)}%)` : '';
  console.log(`${l.padEnd(7)} ${String(t.n).padEnd(4)} ${(t.correct + ' ' + cP).padEnd(16)} ${(t.over + ' ' + oP).padEnd(15)} ${t.under + ' ' + uP}`);
}
console.log();

console.log('── NAMED CASES ──');
console.log('Under-triage cases (' + underCases.length + '):');
underCases.forEach(c => console.log('  ' + c));
console.log('Two-level over-triage cases (' + twoOverCases.length + '):');
twoOverCases.forEach(c => console.log('  ' + c));
console.log();

console.log('── OVER-TRIAGE DIRECTIONS (ORANGE→RED, etc.) ──');
const dirs = {};
for (const r of rows) {
  const g = LEV[r.gold], s = LEV[r.system];
  if (g && s && s < g) {
    const k = `${r.gold}→${r.system}`;
    dirs[k] = (dirs[k] || 0) + 1;
  }
}
for (const [k, v] of Object.entries(dirs).sort()) console.log(`  ${k}: ${v}`);
console.log();

console.log('── AI CONFIDENCE ──');
console.log(`≥75% confidence: ${highConf}/${n} = ${pct(highConf/n)}`);
console.log(`<75% confidence: ${lowConf}/${n} = ${pct(lowConf/n)}`);
console.log();

console.log('── PER-LANGUAGE KAPPA ──');
for (const [lang, v] of Object.entries(perLangKappa)) {
  console.log(`${lang.padEnd(10)} n=${v.n}   kappa=${typeof v.kappa === 'number' ? v.kappa.toFixed(3) : v.kappa}`);
}
console.log();

// Per-language concordance + under-triage
console.log('── PER-LANGUAGE CONCORDANCE + UNDER-TRIAGE ──');
for (const lang of ['English', 'isiZulu', 'isiXhosa', 'Afrikaans']) {
  const lrows = rows.filter(r => r.lang === lang && LEV[r.gold] && LEV[r.system]);
  const lc = lrows.filter(r => r.gold === r.system).length;
  const lu = lrows.filter(r => LEV[r.system] > LEV[r.gold]).length;
  const lo = lrows.filter(r => LEV[r.system] < LEV[r.gold]).length;
  console.log(`${lang.padEnd(10)} n=${lrows.length}   correct=${lc}/${lrows.length} (${pct(lc/lrows.length)})   over=${lo}   under=${lu}`);
}
