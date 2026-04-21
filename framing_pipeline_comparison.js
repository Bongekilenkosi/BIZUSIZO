#!/usr/bin/env node
// ============================================================
// BIZUSIZO — Framing Pipeline Comparison
// Compares AI-only vs full pipeline (AI + DCSL) framing invariance
// using the same 110 vignettes from framing_sensitivity_test.js
//
// This script proves the DCSL's architectural claim:
//   AI-only:      framing-sensitive (empirically demonstrated)
//   AI + DCSL:    framing-immune for RED (deterministic keyword matching)
//
// Usage:
//   node framing_pipeline_comparison.js
//
// Requires:
//   - ANTHROPIC_API_KEY in environment
//   - framing_sensitivity_results.json from previous AI-only run
//   - triage.js accessible at ./lib/triage (production module)
//
// Output:
//   framing_pipeline_comparison.json — full results
//   Console summary with before/after table
// ============================================================
'use strict';

require('dotenv').config();
const fs = require('fs');
const path = require('path');

// Load production triage module — AI + DCSL
let triage;
try {
  triage = require(path.resolve(__dirname, './lib/triage'));
} catch (e) {
  console.error('Cannot load ./lib/triage.js:', e.message);
  console.error('Run this script from your repo root: node framing_pipeline_comparison.js');
  process.exit(1);
}

// Load vignette source texts (neutral + variant strings)
let vignetteTexts;
try {
  vignetteTexts = require(path.resolve(__dirname, './framing_sensitivity_test'));
  vignetteTexts = vignetteTexts.vignettes;
} catch (e) {
  console.error('Cannot import vignettes from framing_sensitivity_test.js:', e.message);
  process.exit(1);
}
// Index by id for fast lookup
const vignetteMap = {};
for (const v of vignetteTexts) vignetteMap[v.id] = v;

// Load AI-only results from previous run
let aiOnlyResults;
try {
  aiOnlyResults = JSON.parse(fs.readFileSync('framing_sensitivity_results.json', 'utf8'));
} catch (e) {
  console.error('Cannot load framing_sensitivity_results.json:', e.message);
  console.error('Run framing_sensitivity_test.js first to generate AI-only baseline.');
  process.exit(1);
}

const LEVEL_MAP = { RED: 3, ORANGE: 2, YELLOW: 1, GREEN: 0, ERROR: -1 };

// Run one vignette through the FULL pipeline (AI + DCSL)
// Mirrors production: runTriage() → applyClinicalRules()
async function runFullPipeline(text) {
  // sessionContext minimal — no patient history, no comorbidities
  // This isolates framing sensitivity from longitudinal upgrades
  const sessionContext = {
    patientId: null,      // skip rate limiter
    age: null,
    chronicConditions: [],
    isPregnant: false,
    priorHistory: null,
  };

  try {
    // Step 1: AI classification (same as production runTriage)
    const aiResult = await triage.runTriage(text, null, sessionContext);

    if (aiResult.rateLimited) {
      return { triage_level: 'ERROR', source: 'rate_limited' };
    }

    // Step 2: DCSL override (applyClinicalRules runs AFTER AI)
    const finalResult = triage.applyClinicalRules(text, aiResult);

    return {
      triage_level: finalResult.triage_level,
      confidence:   finalResult.confidence,
      rule_override: finalResult.rule_override || null,
      dcsl_fired:   finalResult.rule_override != null,
      ai_level:     aiResult.triage_level,
    };
  } catch (e) {
    return { triage_level: 'ERROR', source: e.message };
  }
}

async function run() {
  console.log('╔══════════════════════════════════════════════════════════╗');
  console.log('║  BIZUSIZO — Full Pipeline Framing Comparison             ║');
  console.log('║  AI-only vs AI + DCSL — framing invariance proof         ║');
  console.log('╚══════════════════════════════════════════════════════════╝\n');

  const vignettes = aiOnlyResults.results;
  const total = vignettes.length * 2; // neutral + variant for each
  let done = 0;

  console.log(`Running ${vignettes.length} vignettes × 2 texts = ${total} full pipeline calls...\n`);

  const pipelineResults = [];

  for (const v of vignettes) {
    // Look up source texts from imported vignette array
    const source = vignetteMap[v.id];
    if (!source) {
      console.warn(`\n  Warning: no source text found for ${v.id} — skipping`);
      continue;
    }

    const [neutral_pipeline, variant_pipeline] = await Promise.all([
      runFullPipeline(source.neutral),
      runFullPipeline(source.variant)
    ]);

    done += 2;
    process.stdout.write(`\r  ${done}/${total} pipeline calls complete...`);

    const ai_neutral  = v.neutral.triage;
    const ai_variant  = v.variant.triage;
    const pipe_neutral = neutral_pipeline.triage_level;
    const pipe_variant = variant_pipeline.triage_level;

    const ai_drifted   = ai_neutral !== ai_variant;
    const pipe_drifted = pipe_neutral !== pipe_variant;
    const dcsl_rescued = ai_drifted && !pipe_drifted;

    pipelineResults.push({
      id: v.id, gold: v.gold, lang: v.lang,
      category: v.category, framing_type: v.framing_type,
      native_review: v.native_review,

      // AI-only (from previous run)
      ai_only: {
        neutral: ai_neutral,
        variant: ai_variant,
        drifted: ai_drifted,
        direction: v.drift_direction,
      },

      // Full pipeline (this run)
      pipeline: {
        neutral: pipe_neutral,
        variant: pipe_variant,
        drifted: pipe_drifted,
        neutral_dcsl_fired: neutral_pipeline.dcsl_fired,
        variant_dcsl_fired: variant_pipeline.dcsl_fired,
        neutral_rule: neutral_pipeline.rule_override,
        variant_rule: variant_pipeline.rule_override,
      },

      // Key outcome: did DCSL rescue an AI drift?
      dcsl_rescued,
      remaining_drift: pipe_drifted,
    });
  }

  // ── Compute metrics ──────────────────────────────────────────
  const by_gold = (g) => pipelineResults.filter(r => r.gold === g);
  const primary  = pipelineResults.filter(r => !r.native_review);
  const infoOnly = pipelineResults.filter(r => r.native_review);

  function metrics(cases) {
    const ai_drifted   = cases.filter(r => r.ai_only.drifted).length;
    const pipe_drifted = cases.filter(r => r.pipeline.drifted).length;
    const rescued      = cases.filter(r => r.dcsl_rescued).length;
    const ai_inv_pct   = ((cases.length - ai_drifted)   / cases.length * 100).toFixed(1);
    const pipe_inv_pct = ((cases.length - pipe_drifted) / cases.length * 100).toFixed(1);
    return { n: cases.length, ai_drifted, pipe_drifted, rescued, ai_inv_pct, pipe_inv_pct };
  }

  const red_m    = metrics(by_gold('RED'));
  const orange_m = metrics(by_gold('ORANGE'));
  const yellow_m = metrics(by_gold('YELLOW'));
  const total_m  = metrics(pipelineResults);
  const primary_m = metrics(primary);

  // ── Print results ────────────────────────────────────────────
  console.log('\n\n── Before / After: Framing Invariance ─────────────────────');
  console.log('');
  console.log('  Level    Cases   AI-only invariance   Full pipeline invariance   DCSL rescued');
  console.log('  ──────   ─────   ──────────────────   ───────────────────────   ────────────');
  console.log(`  RED      ${String(red_m.n).padEnd(5)}   ${String(red_m.ai_inv_pct+'%').padEnd(18)}   ${String(pipe_inv_pct(red_m)+'%').padEnd(23)}   ${red_m.rescued}`);
  console.log(`  ORANGE   ${String(orange_m.n).padEnd(5)}   ${String(orange_m.ai_inv_pct+'%').padEnd(18)}   ${String(pipe_inv_pct(orange_m)+'%').padEnd(23)}   ${orange_m.rescued}`);
  console.log(`  YELLOW   ${String(yellow_m.n).padEnd(5)}   ${String(yellow_m.ai_inv_pct+'%').padEnd(18)}   ${String(pipe_inv_pct(yellow_m)+'%').padEnd(23)}   ${yellow_m.rescued} (informational)`);
  console.log(`  TOTAL    ${String(total_m.n).padEnd(5)}   ${String(total_m.ai_inv_pct+'%').padEnd(18)}   ${String(pipe_inv_pct(total_m)+'%').padEnd(23)}   ${total_m.rescued}`);

  // Cases where drift survived the full pipeline
  const surviving = pipelineResults.filter(r => r.remaining_drift);
  if (surviving.length > 0) {
    console.log('\n── Surviving drift (pipeline did not rescue) ───────────────');
    for (const r of surviving) {
      const nr = r.native_review ? ' [INFORMATIONAL]' : '';
      console.log(`  ${r.id} [${r.lang}/${r.gold}] AI: ${r.ai_only.neutral}→${r.ai_only.variant}  Pipeline: ${r.pipeline.neutral}→${r.pipeline.variant}${nr}`);
    }
  } else {
    console.log('\n── Surviving drift ──────────────────────────────────────────');
    console.log('  None — DCSL rescued all AI drift in validated languages.');
  }

  console.log('\n── Architecture summary ────────────────────────────────────');
  console.log(`  AI-only RED invariance:       ${red_m.ai_inv_pct}%`);
  console.log(`  Full pipeline RED invariance: ${pipe_inv_pct(red_m)}%`);
  const gap = (parseFloat(pipe_inv_pct(red_m)) - parseFloat(red_m.ai_inv_pct)).toFixed(1);
  console.log(`  DCSL contribution (RED):      +${gap}pp`);
  console.log('');
  console.log('  Interpretation: AI classification is framing-sensitive by');
  console.log('  design. DCSL keyword matching is framing-immune — it reads');
  console.log('  clinical signals, not patient tone. The gap between AI-only');
  console.log('  and full pipeline invariance quantifies the DCSL\'s load-bearing');
  console.log('  safety contribution under adversarial linguistic framing.');

  console.log('\n── Validated languages only (en/zu/xh/af) ─────────────────');
  console.log(`  AI-only invariance:       ${primary_m.ai_inv_pct}%`);
  console.log(`  Full pipeline invariance: ${pipe_inv_pct(primary_m)}%`);
  console.log(`  Cases rescued by DCSL:    ${primary_m.rescued} / ${primary_m.ai_drifted} AI drifts`);

  // ── Save ─────────────────────────────────────────────────────
  const output = {
    timestamp: new Date().toISOString(),
    summary: {
      red:    { n: red_m.n,    ai_invariance_pct: red_m.ai_inv_pct,    pipeline_invariance_pct: pipe_inv_pct(red_m),    dcsl_rescued: red_m.rescued },
      orange: { n: orange_m.n, ai_invariance_pct: orange_m.ai_inv_pct, pipeline_invariance_pct: pipe_inv_pct(orange_m), dcsl_rescued: orange_m.rescued },
      yellow: { n: yellow_m.n, ai_invariance_pct: yellow_m.ai_inv_pct, pipeline_invariance_pct: pipe_inv_pct(yellow_m), dcsl_rescued: yellow_m.rescued },
      total:  { n: total_m.n,  ai_invariance_pct: total_m.ai_inv_pct,  pipeline_invariance_pct: pipe_inv_pct(total_m),  dcsl_rescued: total_m.rescued },
    },
    architecture_note: 'AI-only results use simplified prompt. Full pipeline uses production system prompt (sats-v2.3) which is richer — production AI layer invariance may exceed AI-only baseline.',
    results: pipelineResults
  };

  fs.writeFileSync('framing_pipeline_comparison.json', JSON.stringify(output, null, 2));
  console.log('\n  Saved → framing_pipeline_comparison.json\n');
}

// Helper — avoids referencing stale variable in loop
function pipe_inv_pct(m) {
  return ((m.n - m.pipe_drifted) / m.n * 100).toFixed(1);
}

run().catch(e => { console.error('\nFatal:', e.message); process.exit(1); });
