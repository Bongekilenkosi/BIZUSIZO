// Quadratic weighted Cohen's kappa between AI classifications and BN
// reference standard (gold). Computes for both Haiku 4.5 and Sonnet 4
// on the same 120-vignette set. Reconstructs BN gold standards by
// position (same logic as build_vignette_supplement.js).
//
// Also reports per-language kappa for publication table.

const fs = require('fs');

const LEVELS = ['GREEN','YELLOW','ORANGE','RED']; // ordinal, 0..3
const RANK = Object.fromEntries(LEVELS.map((l,i)=>[l,i]));

function bnGoldForId(id) {
  const n = parseInt(id.replace(/^V0*/, ''), 10);
  const pos = ((n - 1) % 30) + 1;
  if (pos <= 5)  return 'RED';
  if (pos <= 13) return 'ORANGE';
  if (pos <= 24) return 'YELLOW';
  return 'GREEN';
}

function languageForId(id) {
  const n = parseInt(id.replace(/^V0*/, ''), 10);
  if (n <= 30)  return 'English';
  if (n <= 60)  return 'isiZulu';
  if (n <= 90)  return 'isiXhosa';
  return 'Afrikaans';
}

// Quadratic weighted kappa on 4 ordinal categories
function quadraticWeightedKappa(pairs) {
  // pairs: [[rater1, rater2], ...]  where values are indices 0..3
  const n = LEVELS.length;
  const N = pairs.length;
  if (N === 0) return null;

  // Observed frequency matrix O[i][j]
  const O = Array.from({length:n}, () => Array(n).fill(0));
  const r1 = Array(n).fill(0);
  const r2 = Array(n).fill(0);
  for (const [i,j] of pairs) {
    O[i][j]++;
    r1[i]++;
    r2[j]++;
  }

  // Expected frequency matrix E[i][j] = (r1[i] * r2[j]) / N
  const E = Array.from({length:n}, (_,i) =>
    Array.from({length:n}, (_,j) => (r1[i] * r2[j]) / N)
  );

  // Quadratic weights w[i][j] = ((i-j)/(n-1))^2
  const W = Array.from({length:n}, (_,i) =>
    Array.from({length:n}, (_,j) => Math.pow((i-j)/(n-1), 2))
  );

  let numer = 0, denom = 0;
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) {
      numer += W[i][j] * O[i][j];
      denom += W[i][j] * E[i][j];
    }
  }
  return denom === 0 ? null : 1 - numer/denom;
}

function perf(pairs) {
  let correct = 0, over = 0, under = 0, redMissed = 0;
  for (const [g, p] of pairs) {
    if (g === p) correct++;
    else if (p > g) over++;
    else { under++; if (LEVELS[g] === 'RED') redMissed++; }
  }
  return {N: pairs.length, correct, over, under, redMissed};
}

function report(label, haikuMap, sonnetMap, lang, referenceStandard) {
  // referenceStandard: 'BN' (default, uses bnGoldForId) or 'SP' (uses SP blinded ratings)
  const refFn = referenceStandard === 'SP' ? (id) => SP[id] : (id) => bnGoldForId(id);
  const haikuPairs = [];
  const sonnetPairs = [];
  for (let n = 1; n <= 120; n++) {
    const id = 'V' + String(n).padStart(3, '0');
    if (lang && languageForId(id) !== lang) continue;
    const ref = refFn(id);
    if (ref === undefined) continue;
    const g = RANK[ref];
    const h = RANK[haikuMap[id]];
    const s = RANK[sonnetMap[id]];
    if (h !== undefined) haikuPairs.push([g, h]);
    if (s !== undefined) sonnetPairs.push([g, s]);
  }
  const hKappa = quadraticWeightedKappa(haikuPairs);
  const sKappa = quadraticWeightedKappa(sonnetPairs);
  const hPerf = perf(haikuPairs);
  const sPerf = perf(sonnetPairs);
  console.log(label + (referenceStandard ? ' (vs ' + referenceStandard + ')' : ''));
  console.log('  Haiku 4.5 :  N=' + hPerf.N + '  correct=' + hPerf.correct + '/' + hPerf.N + ' (' + (100*hPerf.correct/hPerf.N).toFixed(1) + '%)  over=' + hPerf.over + '  under=' + hPerf.under + '  redMissed=' + hPerf.redMissed + '  κ=' + hKappa.toFixed(3));
  console.log('  Sonnet 4  :  N=' + sPerf.N + '  correct=' + sPerf.correct + '/' + sPerf.N + ' (' + (100*sPerf.correct/sPerf.N).toFixed(1) + '%)  over=' + sPerf.over + '  under=' + sPerf.under + '  redMissed=' + sPerf.redMissed + '  κ=' + sKappa.toFixed(3));
  console.log('');
}

const haiku = JSON.parse(fs.readFileSync('./vignette_results.json', 'utf8'));
const sonnet = JSON.parse(fs.readFileSync('./vignette_results_sonnet.json', 'utf8'));
const haikuMap = Object.fromEntries(haiku.results.map(r => [r.id, r.triage]));
const sonnetMap = Object.fromEntries(sonnet.results.map(r => [r.id, r.triage]));

// SP blinded ratings (hard-coded from Sheila response document 2026-04-20)
const SP = {
  V001:'RED',V002:'RED',V003:'RED',V004:'RED',V005:'RED',V006:'RED',V007:'YELLOW',V008:'RED',V009:'RED',V010:'RED',
  V011:'RED',V012:'RED',V013:'RED',V014:'YELLOW',V015:'YELLOW',V016:'RED',V017:'YELLOW',V018:'RED',V019:'ORANGE',V020:'ORANGE',
  V021:'RED',V022:'ORANGE',V023:'ORANGE',V024:'ORANGE',V025:'GREEN',V026:'GREEN',V027:'GREEN',V028:'GREEN',V029:'GREEN',V030:'GREEN',
  V031:'RED',V032:'RED',V033:'RED',V034:'RED',V035:'RED',V036:'RED',V037:'YELLOW',V038:'RED',V039:'RED',V040:'RED',
  V041:'ORANGE',V042:'RED',V043:'RED',V044:'YELLOW',V045:'YELLOW',V046:'RED',V047:'YELLOW',V048:'RED',V049:'ORANGE',V050:'RED',
  V051:'RED',V052:'ORANGE',V053:'ORANGE',V054:'ORANGE',V055:'GREEN',V056:'GREEN',V057:'GREEN',V058:'GREEN',V059:'GREEN',V060:'GREEN',
  V061:'RED',V062:'RED',V063:'RED',V064:'RED',V065:'RED',V066:'RED',V067:'ORANGE',V068:'RED',V069:'RED',V070:'RED',
  V071:'RED',V072:'RED',V073:'RED',V074:'YELLOW',V075:'YELLOW',V076:'RED',V077:'YELLOW',V078:'RED',V079:'ORANGE',V080:'RED',
  V081:'RED',V082:'YELLOW',V083:'RED',V084:'ORANGE',V085:'GREEN',V086:'GREEN',V087:'GREEN',V088:'GREEN',V089:'GREEN',V090:'GREEN',
  V091:'RED',V092:'RED',V093:'RED',V094:'RED',V095:'RED',V096:'RED',V097:'YELLOW',V098:'RED',V099:'RED',V100:'RED',
  V101:'RED',V102:'RED',V103:'RED',V104:'GREEN',V105:'GREEN',V106:'ORANGE',V107:'YELLOW',V108:'RED',V109:'YELLOW',V110:'ORANGE',
  V111:'RED',V112:'YELLOW',V113:'RED',V114:'ORANGE',V115:'GREEN',V116:'GREEN',V117:'GREEN',V118:'GREEN',V119:'GREEN',V120:'GREEN',
};

console.log('=== Quadratic weighted Cohen\'s kappa (AI vs BN developer reference) ===\n');
report('OVERALL', haikuMap, sonnetMap, null, 'BN');
for (const lang of ['English', 'isiZulu', 'isiXhosa', 'Afrikaans']) {
  report(lang, haikuMap, sonnetMap, lang, 'BN');
}

console.log('=== Quadratic weighted Cohen\'s kappa (AI vs SP blinded nurse rating) ===\n');
report('OVERALL', haikuMap, sonnetMap, null, 'SP');
for (const lang of ['English', 'isiZulu', 'isiXhosa', 'Afrikaans']) {
  report(lang, haikuMap, sonnetMap, lang, 'SP');
}

// BN vs SP inter-rater kappa (the manuscript reports 0.678)
console.log('=== BN vs SP inter-rater kappa (reported in manuscript: 0.678) ===\n');
const bnSpPairs = [];
for (let n = 1; n <= 120; n++) {
  const id = 'V' + String(n).padStart(3, '0');
  const g = RANK[bnGoldForId(id)];
  const s = RANK[SP[id]];
  if (g !== undefined && s !== undefined) bnSpPairs.push([g, s]);
}
const bnSpKappa = quadraticWeightedKappa(bnSpPairs);
console.log('BN vs SP  N=' + bnSpPairs.length + '  κ=' + bnSpKappa.toFixed(3));
console.log('');

// Also compute confidence intervals for under-triage proportion
// (Clopper-Pearson exact binomial) for both models
function clopperPearson(k, n, alpha) {
  alpha = alpha || 0.05;
  if (k === 0) {
    const upper = 1 - Math.pow(alpha/2, 1/n);
    return [0, upper];
  }
  if (k === n) {
    const lower = Math.pow(alpha/2, 1/n);
    return [lower, 1];
  }
  // Use beta quantile approximation via iterative search
  function betaQuantile(p, a, b) {
    let lo = 0, hi = 1, mid;
    for (let i = 0; i < 100; i++) {
      mid = (lo + hi) / 2;
      if (incompleteBeta(mid, a, b) < p) lo = mid;
      else hi = mid;
    }
    return mid;
  }
  function logBeta(a, b) {
    return lgamma(a) + lgamma(b) - lgamma(a+b);
  }
  function lgamma(x) {
    // Stirling's approximation
    const c = [0.99999999999980993, 676.5203681218851, -1259.1392167224028,
               771.32342877765313, -176.61502916214059, 12.507343278686905,
               -0.13857109526572012, 9.9843695780195716e-6, 1.5056327351493116e-7];
    if (x < 0.5) return Math.log(Math.PI / Math.sin(Math.PI * x)) - lgamma(1 - x);
    x -= 1;
    let a = c[0];
    const t = x + 7.5;
    for (let i = 1; i < 9; i++) a += c[i]/(x+i);
    return 0.5 * Math.log(2*Math.PI) + (x+0.5)*Math.log(t) - t + Math.log(a);
  }
  function incompleteBeta(x, a, b) {
    if (x <= 0) return 0;
    if (x >= 1) return 1;
    // Use continued fraction representation (Numerical Recipes approach, simplified)
    const bt = Math.exp(lgamma(a+b) - lgamma(a) - lgamma(b) + a*Math.log(x) + b*Math.log(1-x));
    if (x < (a+1)/(a+b+2)) return bt * betacf(x, a, b) / a;
    return 1 - bt * betacf(1-x, b, a) / b;
  }
  function betacf(x, a, b) {
    const MAXIT = 200, EPS = 3e-7, FPMIN = 1e-30;
    let qab = a+b, qap = a+1, qam = a-1;
    let c = 1, d = 1 - qab*x/qap;
    if (Math.abs(d) < FPMIN) d = FPMIN;
    d = 1/d;
    let h = d;
    for (let m = 1; m <= MAXIT; m++) {
      const m2 = 2*m;
      let aa = m*(b-m)*x/((qam+m2)*(a+m2));
      d = 1 + aa*d; if (Math.abs(d) < FPMIN) d = FPMIN;
      c = 1 + aa/c; if (Math.abs(c) < FPMIN) c = FPMIN;
      d = 1/d; h *= d*c;
      aa = -(a+m)*(qab+m)*x/((a+m2)*(qap+m2));
      d = 1 + aa*d; if (Math.abs(d) < FPMIN) d = FPMIN;
      c = 1 + aa/c; if (Math.abs(c) < FPMIN) c = FPMIN;
      d = 1/d; const del = d*c; h *= del;
      if (Math.abs(del - 1) < EPS) break;
    }
    return h;
  }
  const lower = betaQuantile(alpha/2, k, n-k+1);
  const upper = betaQuantile(1-alpha/2, k+1, n-k);
  return [lower, upper];
}

console.log('\n=== Under-triage 95% CI (Clopper-Pearson exact) ===');
for (const [label, pairs] of [['Haiku 4.5', Object.entries(haikuMap).map(([id,t])=>[RANK[bnGoldForId(id)], RANK[t]])], ['Sonnet 4', Object.entries(sonnetMap).map(([id,t])=>[RANK[bnGoldForId(id)], RANK[t]])]]) {
  const p = perf(pairs);
  const [lo, hi] = clopperPearson(p.under, p.N);
  console.log(label + ': under-triage ' + p.under + '/' + p.N + ' = ' + (100*p.under/p.N).toFixed(1) + '%  95% CI [' + (100*lo).toFixed(1) + '%, ' + (100*hi).toFixed(1) + '%]');
}
