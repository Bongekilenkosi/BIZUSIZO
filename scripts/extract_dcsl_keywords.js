#!/usr/bin/env node
// ============================================================
// DCSL keyword-set extraction
// Reads lib/triage.js, extracts every has(...literals) argument list,
// deduplicates, writes config/dcsl_keywords.json, and emits
// lib/triage.refactored.js with has(...DCSL_KEYWORDS.name) references.
//
// Does NOT overwrite lib/triage.js directly; caller verifies via
// node test_dcsl.js before swapping.
//
// Usage:
//   node scripts/extract_dcsl_keywords.js
// ============================================================
'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const TRIAGE_PATH = path.join(ROOT, 'lib', 'triage.js');
const CONFIG_PATH = path.join(ROOT, 'config', 'dcsl_keywords.json');
const CONFIG_EXAMPLE_PATH = path.join(ROOT, 'config', 'dcsl_keywords.example.json');
const OUTPUT_TRIAGE_PATH = path.join(ROOT, 'lib', 'triage.refactored.js');

// ── Parser — find matching ')' respecting strings, comments, nesting ──
function findMatchingClose(text, openIdx) {
  let depth = 1;
  let i = openIdx + 1;
  let inStr = null;
  let inLineComment = false;
  let inBlockComment = false;

  while (i < text.length && depth > 0) {
    const c = text[i];
    const next = text[i + 1];

    if (inLineComment) {
      if (c === '\n') inLineComment = false;
      i++; continue;
    }
    if (inBlockComment) {
      if (c === '*' && next === '/') { inBlockComment = false; i += 2; continue; }
      i++; continue;
    }
    if (inStr) {
      if (c === '\\') { i += 2; continue; }
      if (c === inStr) inStr = null;
      i++; continue;
    }
    if (c === '/' && next === '/') { inLineComment = true; i += 2; continue; }
    if (c === '/' && next === '*') { inBlockComment = true; i += 2; continue; }
    if (c === "'" || c === '"' || c === '`') { inStr = c; i++; continue; }
    if (c === '(') depth++;
    else if (c === ')') {
      depth--;
      if (depth === 0) return i;
    }
    i++;
  }
  return -1;
}

// Find word-boundary `has(` calls (excludes .has(, thisHas(, etc.)
function findHasCalls(text) {
  const calls = [];
  const re = /(?:^|[^A-Za-z0-9_$.])has\(/g;
  let m;
  while ((m = re.exec(text)) !== null) {
    // Compute actual position of 'has(' — the match may include the preceding char
    const hasStart = m.index + (m[0].length - 4); // position of 'h'
    const openParenIdx = hasStart + 3;             // position of '('
    const closeIdx = findMatchingClose(text, openParenIdx);
    if (closeIdx === -1) continue;
    calls.push({
      hasStart,
      openParen: openParenIdx,
      close: closeIdx,
      argBlock: text.slice(openParenIdx + 1, closeIdx),
    });
  }
  return calls;
}

// Eval the arg block to get the actual array of strings
function evalArgBlock(argBlock) {
  const noBlock = argBlock.replace(/\/\*[\s\S]*?\*\//g, '');
  const noLine = noBlock.replace(/\/\/[^\n]*/g, '');
  try {
    // Safe eval: only string literals and commas are expected.
    // eslint-disable-next-line no-eval
    const arr = eval('(function(){return [' + noLine + '];})()');
    if (!Array.isArray(arr) || !arr.every(x => typeof x === 'string')) return null;
    return arr;
  } catch (e) {
    return null;
  }
}

// Backward-look for `const hasX = ` immediately before the call
function findVarName(text, callStart) {
  const window = text.slice(Math.max(0, callStart - 200), callStart);
  const m = window.match(/const\s+([a-zA-Z_$][a-zA-Z0-9_$]*)\s*=\s*$/);
  return m ? m[1] : null;
}

// Forward-look for nearest `return (red|orange|yellow|green)('rule_name')` within 5KB
function findRuleContext(text, callEnd) {
  const window = text.slice(callEnd, callEnd + 5000);
  const m = window.match(/return\s+(?:red|orange|yellow|green)\(\s*'([a-z_][a-z0-9_]*)'\s*\)/);
  return m ? m[1] : null;
}

function deriveName(call, src, taken) {
  const varName = findVarName(src, call.hasStart);
  let base;
  if (varName && varName.startsWith('has')) {
    const rest = varName.slice(3);
    base = rest.length ? rest[0].toLowerCase() + rest.slice(1) : 'has';
  } else {
    const ruleName = findRuleContext(src, call.close);
    base = ruleName ? ruleName + '_kw' : 'kw';
  }
  let name = base;
  let n = 2;
  while (taken.has(name)) {
    name = `${base}_${n}`;
    n++;
  }
  return name;
}

// ── Run ──────────────────────────────────────────────────────

const src = fs.readFileSync(TRIAGE_PATH, 'utf8');
const allCalls = findHasCalls(src);
console.log(`Found ${allCalls.length} has(...) calls total.`);

const applyRulesIdx = src.indexOf('function applyClinicalRules');
if (applyRulesIdx === -1) {
  console.error('ERROR: applyClinicalRules function not found in lib/triage.js');
  process.exit(1);
}
const rulesCalls = allCalls.filter(c => c.hasStart > applyRulesIdx);
console.log(`${rulesCalls.length} calls inside applyClinicalRules (target for extraction).`);

const keywordSets = {};  // name → array
const nameByKey = new Map();  // JSON(arr) → name
const taken = new Set();

let failed = 0;
for (const call of rulesCalls) {
  const arr = evalArgBlock(call.argBlock);
  if (arr === null) {
    console.warn(`WARN: could not eval args at offset ${call.hasStart}: ${call.argBlock.slice(0, 80).replace(/\s+/g, ' ')}...`);
    call.skip = true;
    failed++;
    continue;
  }
  call.args = arr;
  const key = JSON.stringify(arr);
  if (!nameByKey.has(key)) {
    const name = deriveName(call, src, taken);
    keywordSets[name] = arr;
    nameByKey.set(key, name);
    taken.add(name);
  }
  call.name = nameByKey.get(key);
}

if (failed > 0) {
  console.error(`\nERROR: ${failed} calls could not be parsed. Aborting to avoid silent data loss.`);
  process.exit(1);
}

console.log(`${Object.keys(keywordSets).length} unique keyword sets.`);

// Sanity — total keywords across all sets
const totalKeywords = Object.values(keywordSets).reduce((s, a) => s + a.length, 0);
console.log(`${totalKeywords} keywords total across all sets.`);

// ── Write config ──
fs.mkdirSync(path.dirname(CONFIG_PATH), { recursive: true });
const configPayload = {
  _description: 'DCSL (Deterministic Clinical Safety Layer) keyword sets — loaded at startup by lib/triage.js applyClinicalRules().',
  _warning: 'This file must NOT be committed to any public repository. Publishing these keyword sets materially enlarges the exploitation surface (see SECURITY.md known attack classes 2 and 3). gitignored in BIZUSIZO-Dev and BIZUSIZO public repos.',
  _version: new Date().toISOString().slice(0, 10),
  _total_sets: Object.keys(keywordSets).length,
  _total_keywords: totalKeywords,
  sets: keywordSets,
};
fs.writeFileSync(CONFIG_PATH, JSON.stringify(configPayload, null, 2));
console.log(`Wrote ${CONFIG_PATH}`);

// Also write an example file (safe to commit) with empty arrays
const examplePayload = {
  _description: configPayload._description,
  _warning: 'Real keyword sets must be populated in config/dcsl_keywords.json (gitignored). This file shows the required JSON shape only.',
  _version: configPayload._version,
  _total_sets: Object.keys(keywordSets).length,
  sets: Object.fromEntries(Object.keys(keywordSets).map(k => [k, []])),
};
fs.writeFileSync(CONFIG_EXAMPLE_PATH, JSON.stringify(examplePayload, null, 2));
console.log(`Wrote ${CONFIG_EXAMPLE_PATH}`);

// ── Rewrite triage.js ──
let newSrc = src;
// Replace in reverse offset order so offsets don't shift
rulesCalls
  .filter(c => !c.skip)
  .sort((a, b) => b.hasStart - a.hasStart)
  .forEach(call => {
    const before = newSrc.slice(0, call.openParen + 1);
    const after = newSrc.slice(call.close);
    newSrc = before + `...DCSL_KEYWORDS.${call.name}` + after;
  });

// Prepend DCSL loader after 'use strict'
const loader = `
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

`;

const useStrictIdx = newSrc.indexOf("'use strict';");
if (useStrictIdx === -1) {
  newSrc = loader + newSrc;
} else {
  const insertAt = newSrc.indexOf('\n', useStrictIdx) + 1;
  newSrc = newSrc.slice(0, insertAt) + loader + newSrc.slice(insertAt);
}

fs.writeFileSync(OUTPUT_TRIAGE_PATH, newSrc);
console.log(`Wrote ${OUTPUT_TRIAGE_PATH}`);

console.log('\n✓ Extraction complete. Next steps:');
console.log('  1. Inspect lib/triage.refactored.js and config/dcsl_keywords.json');
console.log('  2. Swap: mv lib/triage.js lib/triage.orig.js && mv lib/triage.refactored.js lib/triage.js');
console.log('  3. Run: node test_dcsl.js');
console.log('  4. If 186/186 pass, commit. If not, revert with mv lib/triage.orig.js lib/triage.js');
