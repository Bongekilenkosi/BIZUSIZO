#!/usr/bin/env node
// ============================================================
// BIZUSIZO — Load Test
// Simulates concurrent patient messages to test system capacity.
// Does NOT call Anthropic API — tests Supabase + Express throughput.
// Run: node test_load.js [concurrent_patients] [messages_per_patient]
// Default: 20 patients, 3 messages each = 60 total requests
// ============================================================
'use strict';

const fetch = require('node-fetch');

const BASE_URL = process.env.BASE_URL || 'http://localhost:8080';
const CONCURRENT = parseInt(process.argv[2]) || 20;
const MESSAGES_PER = parseInt(process.argv[3]) || 3;
const TOTAL = CONCURRENT * MESSAGES_PER;

console.log(`\n╔══════════════════════════════════════════╗`);
console.log(`║  BIZUSIZO Load Test                      ║`);
console.log(`║  ${CONCURRENT} concurrent patients × ${MESSAGES_PER} messages = ${TOTAL} total ║`);
console.log(`║  Target: ${BASE_URL}          ║`);
console.log(`╚══════════════════════════════════════════╝\n`);

// Simulate a webhook POST (same format as Meta sends)
async function sendFakeWebhook(phone, text) {
  const body = {
    entry: [{
      changes: [{
        value: {
          messages: [{
            id: `test_${phone}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
            from: phone,
            type: 'text',
            text: { body: text },
            timestamp: Math.floor(Date.now() / 1000).toString(),
          }]
        }
      }]
    }]
  };

  const start = Date.now();
  try {
    const res = await fetch(`${BASE_URL}/webhook`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const elapsed = Date.now() - start;
    return { status: res.status, elapsed, ok: res.status === 200 };
  } catch (e) {
    return { status: 0, elapsed: Date.now() - start, ok: false, error: e.message };
  }
}

// Simulate health check
async function healthCheck() {
  try {
    const res = await fetch(`${BASE_URL}/`);
    const data = await res.json();
    console.log(`Health: ${data.status} | Governance: ${data.governance}\n`);
    return true;
  } catch (e) {
    console.log(`Health check FAILED: ${e.message}\n`);
    return false;
  }
}

async function run() {
  const healthy = await healthCheck();
  if (!healthy) {
    console.log('Server not reachable. Start with: node index.js');
    process.exit(1);
  }

  const results = [];
  const startTime = Date.now();

  // Generate fake phone numbers
  const phones = Array.from({ length: CONCURRENT }, (_, i) =>
    `2799${String(i).padStart(7, '0')}`
  );

  // Fire all patients concurrently
  console.log(`Sending ${TOTAL} messages...\n`);

  const promises = [];
  for (const phone of phones) {
    // Each patient sends a greeting, then a category, then a symptom
    const messages = ['hi', '5', 'I have a mild cough and runny nose'].slice(0, MESSAGES_PER);
    for (const msg of messages) {
      promises.push(
        sendFakeWebhook(phone, msg).then(r => {
          results.push(r);
          process.stdout.write(`\r  ${results.length}/${TOTAL} responses received...`);
        })
      );
      // Small stagger to avoid thundering herd
      await new Promise(r => setTimeout(r, 50));
    }
  }

  await Promise.all(promises);
  const totalTime = Date.now() - startTime;

  // Results
  const ok = results.filter(r => r.ok).length;
  const failed = results.filter(r => !r.ok).length;
  const times = results.map(r => r.elapsed);
  const avg = Math.round(times.reduce((a, b) => a + b, 0) / times.length);
  const p50 = times.sort((a, b) => a - b)[Math.floor(times.length * 0.5)];
  const p95 = times.sort((a, b) => a - b)[Math.floor(times.length * 0.95)];
  const p99 = times.sort((a, b) => a - b)[Math.floor(times.length * 0.99)];
  const max = Math.max(...times);
  const rps = Math.round(TOTAL / (totalTime / 1000) * 10) / 10;

  console.log(`\n\n── Results ──────────────────────────────────`);
  console.log(`  Total requests:  ${TOTAL}`);
  console.log(`  Successful:      ${ok} (${Math.round(ok / TOTAL * 100)}%)`);
  console.log(`  Failed:          ${failed}`);
  console.log(`  Total time:      ${(totalTime / 1000).toFixed(1)}s`);
  console.log(`  Throughput:      ${rps} req/s`);
  console.log(`  Avg response:    ${avg}ms`);
  console.log(`  p50:             ${p50}ms`);
  console.log(`  p95:             ${p95}ms`);
  console.log(`  p99:             ${p99}ms`);
  console.log(`  Max:             ${max}ms`);

  if (failed > 0) {
    const errors = results.filter(r => !r.ok);
    const statusCounts = {};
    errors.forEach(e => { statusCounts[e.status] = (statusCounts[e.status] || 0) + 1; });
    console.log(`\n  Failures by status:`);
    Object.entries(statusCounts).forEach(([s, c]) => console.log(`    ${s}: ${c}`));
  }

  console.log(`\n── Assessment ──────────────────────────────`);
  if (ok === TOTAL && avg < 500) {
    console.log(`  ✅ PASS — All requests succeeded, avg response under 500ms`);
  } else if (ok === TOTAL && avg < 2000) {
    console.log(`  ⚠️ SLOW — All succeeded but avg ${avg}ms. May need Railway scale-up.`);
  } else if (failed > 0) {
    console.log(`  ❌ FAILURES — ${failed} requests failed. Check server logs.`);
  }
  console.log('');
}

run().catch(e => console.error('Fatal:', e.message));
