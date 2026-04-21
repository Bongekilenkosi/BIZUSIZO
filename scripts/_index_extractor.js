#!/usr/bin/env node
// Extract CCMDD_MESSAGES, VIRTUAL_CONSULT_MESSAGES, LAB_MESSAGES from
// index.js by per-sub-key regex + matching-brace extraction. Handles
// template literals, arrow functions, nested expressions.

const fs = require('fs');
const src = fs.readFileSync('index.js', 'utf8');

// State-machine that advances one token-equivalent at a time,
// returning the new index. Tracks string/template/comment state.
function advance(text, i) {
  // Returns [nextIndex, depthDelta] where depthDelta is +1 for '{', -1 for '}', 0 otherwise.
  const c = text[i];
  if (c === undefined) return [i + 1, 0];
  // Line comment
  if (c === '/' && text[i+1] === '/') {
    let j = i + 2;
    while (j < text.length && text[j] !== '\n') j++;
    return [j + 1, 0];
  }
  // Block comment
  if (c === '/' && text[i+1] === '*') {
    let j = i + 2;
    while (j < text.length - 1 && !(text[j] === '*' && text[j+1] === '/')) j++;
    return [j + 2, 0];
  }
  // Single-quote string
  if (c === "'") {
    let j = i + 1;
    while (j < text.length && text[j] !== "'") {
      if (text[j] === '\\') j += 2;
      else j++;
    }
    return [j + 1, 0];
  }
  // Double-quote string
  if (c === '"') {
    let j = i + 1;
    while (j < text.length && text[j] !== '"') {
      if (text[j] === '\\') j += 2;
      else j++;
    }
    return [j + 1, 0];
  }
  // Template literal — can contain ${...} expressions
  if (c === '`') {
    let j = i + 1;
    while (j < text.length && text[j] !== '`') {
      if (text[j] === '\\') { j += 2; continue; }
      if (text[j] === '$' && text[j+1] === '{') {
        // balanced-skip template expression
        let d = 1; j += 2;
        while (j < text.length && d > 0) {
          const [nj, dd] = advance(text, j);
          d += dd;
          j = nj;
          if (d === 0) break;
        }
        continue;
      }
      j++;
    }
    return [j + 1, 0];
  }
  // Braces
  if (c === '{') return [i + 1, 1];
  if (c === '}') return [i + 1, -1];
  return [i + 1, 0];
}

function extractLiteralBlock(src, startRe) {
  const m = src.match(startRe);
  if (!m) return null;
  const openIdx = m.index + m[0].length - 1; // the opening {
  let i = openIdx + 1;
  let depth = 1;
  while (i < src.length && depth > 0) {
    const [nj, dd] = advance(src, i);
    depth += dd;
    i = nj;
  }
  return src.slice(m.index, i);
}

// Extract each sub-key block from a dictionary literal.
function extractSubKeys(literal) {
  // Skip the leading `const NAME = {` and find each `  sub_key: {`
  const inner = literal.slice(literal.indexOf('{') + 1, literal.lastIndexOf('}'));
  const subKeys = {};
  const subRe = /\n  ([a-z_][a-z0-9_]*)\s*:\s*\{/g;
  let mm;
  while ((mm = subRe.exec(inner)) !== null) {
    const name = mm[1];
    const openIdx = mm.index + mm[0].length - 1;
    let i = openIdx + 1, depth = 1;
    while (i < inner.length && depth > 0) {
      const [nj, dd] = advance(inner, i);
      depth += dd;
      i = nj;
    }
    subKeys[name] = inner.slice(openIdx, i);
  }
  return subKeys;
}

// From a sub-key's brace-enclosed block, extract per-language values.
// Each value may be a template literal, a regular string, or an arrow
// function whose body is a template literal (we capture the template
// body in that case).
function extractLangValues(subBlock) {
  const values = {};
  const inner = subBlock.slice(subBlock.indexOf('{') + 1, subBlock.lastIndexOf('}'));
  const langRe = /(\b(?:en|zu|xh|af|nso|tn|st|ts|ss|ve|nr)):\s*/g;
  let mm;
  while ((mm = langRe.exec(inner)) !== null) {
    const lang = mm[1];
    let j = mm.index + mm[0].length;
    // Skip optional arrow-function prefix
    if (inner.slice(j).startsWith('(')) {
      // skip (arg) =>
      while (j < inner.length && inner[j] !== ')') j++;
      j++;
      while (j < inner.length && inner[j] === ' ') j++;
      if (inner.slice(j).startsWith('=>')) j += 2;
      while (j < inner.length && inner[j] === ' ') j++;
    }
    // Now expect a string literal
    let raw = null;
    if (inner[j] === '`') {
      let k = j + 1;
      while (k < inner.length && inner[k] !== '`') {
        if (inner[k] === '\\') { k += 2; continue; }
        if (inner[k] === '$' && inner[k+1] === '{') {
          let d = 1; k += 2;
          while (k < inner.length && d > 0) {
            const [nj, dd] = advance(inner, k);
            d += dd;
            k = nj;
            if (d === 0) break;
          }
          continue;
        }
        k++;
      }
      raw = inner.slice(j + 1, k);
    } else if (inner[j] === "'" || inner[j] === '"') {
      const q = inner[j];
      let k = j + 1;
      while (k < inner.length && inner[k] !== q) {
        if (inner[k] === '\\') k += 2; else k++;
      }
      raw = inner.slice(j + 1, k);
    }
    if (raw !== null) values[lang] = raw;
  }
  return values;
}

module.exports = function extractIndexMessages() {
  const result = {};
  for (const name of ['CCMDD_MESSAGES', 'VIRTUAL_CONSULT_MESSAGES', 'LAB_MESSAGES']) {
    const re = new RegExp('const\\s+' + name + '\\s*=\\s*\\{');
    const lit = extractLiteralBlock(src, re);
    if (!lit) { result[name] = null; continue; }
    const subs = extractSubKeys(lit);
    const parsed = {};
    for (const [sk, body] of Object.entries(subs)) {
      parsed[sk] = extractLangValues(body);
    }
    result[name] = parsed;
  }
  return result;
};

// If run directly, print summary
if (require.main === module) {
  const r = module.exports();
  for (const [name, dict] of Object.entries(r)) {
    if (!dict) { console.log(name, 'NOT FOUND'); continue; }
    console.log('──', name, '—', Object.keys(dict).length, 'sub-keys');
    for (const [sk, values] of Object.entries(dict)) {
      const langs = Object.keys(values);
      console.log('  ' + sk + ': ' + langs.length + ' langs (' + langs.join(',') + ')');
    }
  }
}
