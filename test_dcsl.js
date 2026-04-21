#!/usr/bin/env node
// ============================================================
// BIZUSIZO — DCSL (Deterministic Clinical Safety Layer) Validation
// Tests the rules engine across all 11 SA official languages.
// No API calls needed — runs in <1 second, fully offline.
//
// Run: node test_dcsl.js
// Exit code 0 = all pass, 1 = failures (blocks CI/CD)
// ============================================================
'use strict';

const triage = require('./lib/triage');
const applyClinicalRules = triage.applyClinicalRules;

// Dummy AI result to test rule overrides against
const GREEN = { triage_level: 'GREEN', confidence: 50 };
const YELLOW = { triage_level: 'YELLOW', confidence: 50 };

// ── Test cases ─────────────────────────────────────────────────
// Format: [input_text, expected_level, language, discriminator_label]
// Every RED/ORANGE discriminator must have at least one test per language.
const tests = [

  // ════════════════════════════════════════════════════════════
  // RED 1: RESPIRATORY / CARDIAC ARREST
  // ════════════════════════════════════════════════════════════
  ['not breathing', 'RED', 'en', 'respiratory_arrest'],
  ['stopped breathing and heart stopped', 'RED', 'en', 'respiratory_arrest'],
  ['akaphefumuli', 'RED', 'zu', 'respiratory_arrest'],
  ['inhliziyo yama', 'RED', 'zu', 'respiratory_arrest'],
  ['aaphefumli', 'RED', 'xh', 'respiratory_arrest'],
  ['asem haal nie', 'RED', 'af', 'respiratory_arrest'],
  ['ga a heme', 'RED', 'nso', 'respiratory_arrest'],
  ['pelo e emile', 'RED', 'nso', 'respiratory_arrest'],
  // tn shares keywords with nso (ga a heme) — tested above
  ['ha a phefumolohe', 'RED', 'st', 'respiratory_arrest'],
  ['pelo e emile', 'RED', 'st', 'respiratory_arrest'],
  ['a a hefemuli', 'RED', 'ts', 'respiratory_arrest'],
  ['mbilu yi yimile', 'RED', 'ts', 'respiratory_arrest'],
  ['awaphefumuli', 'RED', 'ss', 'respiratory_arrest'],
  ['inhlitiyo yeme', 'RED', 'ss', 'respiratory_arrest'],
  ['ha a fembi', 'RED', 've', 'respiratory_arrest'],
  ['mbilu yo ima', 'RED', 've', 'respiratory_arrest'],
  ['ihliziyo yeme', 'RED', 'nr', 'respiratory_arrest'],

  // ════════════════════════════════════════════════════════════
  // RED 2: UNCONSCIOUS
  // ════════════════════════════════════════════════════════════
  ['unconscious', 'RED', 'en', 'unconscious'],
  ['passed out and not waking', 'RED', 'en', 'unconscious'],
  ['uqulekile', 'RED', 'zu', 'unconscious'],
  ['uwe phantsi', 'RED', 'xh', 'unconscious'],
  ['bewusteloos', 'RED', 'af', 'unconscious'],
  ['o idibetse', 'RED', 'nso', 'unconscious'],
  ['ga a tsoge', 'RED', 'nso', 'unconscious'],
  // tn shares o idibetse with nso
  ['o itshedisitse', 'RED', 'st', 'unconscious'],
  ['ha a tsohe', 'RED', 'st', 'unconscious'],
  ['u wisile', 'RED', 'ts', 'unconscious'],
  ['a a pfuki', 'RED', 'ts', 'unconscious'],
  ['udzakiwe', 'RED', 'ss', 'unconscious'],
  ['o ṱalala', 'RED', 've', 'unconscious'],
  ['ha a vuhi', 'RED', 've', 'unconscious'],
  ['uqulekile', 'RED', 'nr', 'unconscious'],

  // ════════════════════════════════════════════════════════════
  // RED 3: ACTIVE SEIZURE
  // ════════════════════════════════════════════════════════════
  ['fitting now', 'RED', 'en', 'active_seizure'],
  ['seizure now', 'RED', 'en', 'active_seizure'],
  ['uyabanjwa manje', 'RED', 'zu', 'active_seizure'],
  ['unyikinyeka ngoku', 'RED', 'xh', 'active_seizure'],
  ['stuiptrekkings nou', 'RED', 'af', 'active_seizure'],
  ['o a thothomela', 'RED', 'nso', 'active_seizure'],
  ['o swarwa ke sethuthuthu', 'RED', 'nso', 'active_seizure'],
  // tn shares o a thothomela
  ['o a ratha joale', 'RED', 'st', 'active_seizure'],
  ['u a rhurhumela', 'RED', 'ts', 'active_seizure'],
  ['uyabanjwa nyalo', 'RED', 'ss', 'active_seizure'],
  ['u a dzhendzela', 'RED', 've', 'active_seizure'],
  ['uyathuthumela', 'RED', 'nr', 'active_seizure'],

  // ════════════════════════════════════════════════════════════
  // RED 4: CARDIAC EMERGENCY (chest + breathing)
  // ════════════════════════════════════════════════════════════
  ['chest pain and difficulty breathing', 'RED', 'en', 'cardiac_emergency'],
  ['isifuba angiphefumuli', 'RED', 'zu', 'cardiac_emergency'],
  ['isifuba andiPhefumli', 'RED', 'xh', 'cardiac_emergency'],
  ['borspyn kan nie asem', 'RED', 'af', 'cardiac_emergency'],
  ['sehuba ga ke heme', 'RED', 'nso', 'cardiac_emergency'],
  ['sehuba ga ke heme', 'RED', 'tn', 'cardiac_emergency'],
  ['sefuba ha ke phefumolohe', 'RED', 'st', 'cardiac_emergency'],
  ['xifuva a ndzi hefemuli', 'RED', 'ts', 'cardiac_emergency'],
  ['sifuba angiphefumuli', 'RED', 'ss', 'cardiac_emergency'],
  ['tshifuva a thi fembi', 'RED', 've', 'cardiac_emergency'],
  ['isifuba angiphefumuli', 'RED', 'nr', 'cardiac_emergency'],

  // ════════════════════════════════════════════════════════════
  // RED 6: OBSTETRIC HAEMORRHAGE
  // ════════════════════════════════════════════════════════════
  ['pregnant and bleeding heavily', 'RED', 'en', 'obstetric_haemorrhage'],
  ['khulelwe opha igazi', 'RED', 'zu', 'obstetric_haemorrhage'],
  ['ke imile madi a tswa', 'RED', 'nso', 'obstetric_haemorrhage'],
  ['ndi imile malofha', 'RED', 've', 'obstetric_haemorrhage'],
  ['ndzi tikile ngati', 'RED', 'ts', 'obstetric_haemorrhage'],
  ['ngikhulelwe ingati', 'RED', 'ss', 'obstetric_haemorrhage'],

  // ════════════════════════════════════════════════════════════
  // RED 8: SNAKE BITE
  // ════════════════════════════════════════════════════════════
  ['snake bite', 'RED', 'en', 'snake_bite'],
  ['inyoka yamluma', 'RED', 'zu', 'snake_bite'],
  ['slangbyt', 'RED', 'af', 'snake_bite'],
  ['noga e mo lomile', 'RED', 'nso', 'snake_bite'],
  ['noha e mo lomile', 'RED', 'st', 'snake_bite'],
  ['nyoka yi n\'wi lumile', 'RED', 'ts', 'snake_bite'],
  ['ṋowa yo mu luma', 'RED', 've', 'snake_bite'],

  // ════════════════════════════════════════════════════════════
  // RED 9: SEVERE BURNS
  // ════════════════════════════════════════════════════════════
  ['severe burn body on fire', 'RED', 'en', 'severe_burns'],
  ['o tšhile', 'RED', 'nso', 'severe_burns'],
  ['o tšhile', 'RED', 'tn', 'severe_burns'],
  ['o chele', 'RED', 'st', 'severe_burns'],
  ['u hisiwe', 'RED', 'ts', 'severe_burns'],
  ['ushile', 'RED', 'ss', 'severe_burns'],
  ['o fhiswa', 'RED', 've', 'severe_burns'],
  ['utjhile', 'RED', 'nr', 'severe_burns'],

  // ════════════════════════════════════════════════════════════
  // RED 10: NEONATAL APNOEA
  // ════════════════════════════════════════════════════════════
  ['baby not breathing', 'RED', 'en', 'neonatal_apnoea'],
  ['usana aliphefumuli', 'RED', 'zu', 'neonatal_apnoea'],
  ['lesea ga le heme', 'RED', 'nso', 'neonatal_apnoea'],
  ['lesea ha le phefumolohe', 'RED', 'st', 'neonatal_apnoea'],
  ['nwana a a hefemuli', 'RED', 'ts', 'neonatal_apnoea'],
  ['umntfwana akaphefumuli', 'RED', 'ss', 'neonatal_apnoea'],
  ['ṅwana ha a fembi', 'RED', 've', 'neonatal_apnoea'],

  // ════════════════════════════════════════════════════════════
  // RED 13: TRAUMATIC HAEMORRHAGE
  // ════════════════════════════════════════════════════════════
  ['blood pouring everywhere stabbed', 'RED', 'en', 'traumatic_haemorrhage'],
  ['igazi liyampompoza ugwaziwe', 'RED', 'zu', 'traumatic_haemorrhage'],
  ['madi a a elela o hlabilwe', 'RED', 'nso', 'traumatic_haemorrhage'],
  ['madi a elela o hlabilwe', 'RED', 'st', 'traumatic_haemorrhage'],
  ['ngati yi humesa u tlhabiwe', 'RED', 'ts', 'traumatic_haemorrhage'],
  ['ingati iyampompoza ugwazwe', 'RED', 'ss', 'traumatic_haemorrhage'],
  ['malofha a khou elela', 'RED', 've', 'traumatic_haemorrhage'],

  // ════════════════════════════════════════════════════════════
  // ORANGE: STROKE (speech)
  // ════════════════════════════════════════════════════════════
  ['slurred speech talking funny', 'ORANGE', 'en', 'stroke_speech'],
  ['ukhuluma nzima', 'ORANGE', 'zu', 'stroke_speech'],
  ['uthetha nzima', 'ORANGE', 'xh', 'stroke_speech'],
  ['praat deurmekaar', 'ORANGE', 'af', 'stroke_speech'],
  ['o bolela nzima', 'ORANGE', 'nso', 'stroke_speech'],
  ['o bua thata', 'ORANGE', 'tn', 'stroke_speech'],
  ['o bolela nzima', 'ORANGE', 'st', 'stroke_speech'],
  ['u vulavula hi ku tika', 'ORANGE', 'ts', 'stroke_speech'],
  ['ukhuluma nzima', 'ORANGE', 'ss', 'stroke_speech'],
  ['u amba zwi a konḓa', 'ORANGE', 've', 'stroke_speech'],
  ['ukhuluma nzima', 'ORANGE', 'nr', 'stroke_speech'],

  // ════════════════════════════════════════════════════════════
  // ORANGE: STROKE (facial droop)
  // ════════════════════════════════════════════════════════════
  ['face drooping mouth twisted', 'ORANGE', 'en', 'stroke_face'],
  ['ubuso buyehla umlomo ugobile', 'ORANGE', 'zu', 'stroke_face'],
  ['gesig hang mond skeef', 'ORANGE', 'af', 'stroke_face'],
  ['sefahlego se theogetše', 'ORANGE', 'nso', 'stroke_face'],
  ['xikandza xi rhelerile', 'ORANGE', 'ts', 'stroke_face'],
  ['tshifhaṱuwo tsho thela', 'ORANGE', 've', 'stroke_face'],

  // ════════════════════════════════════════════════════════════
  // ORANGE: THUNDERCLAP HEADACHE
  // ════════════════════════════════════════════════════════════
  ['sudden severe headache worst headache of my life', 'ORANGE', 'en', 'thunderclap'],
  ['hlogo e bohloko kudu ka tšhoganetšo', 'ORANGE', 'nso', 'thunderclap'],
  ['rixaka leri buhasaka ngopfu hi ku hatla', 'ORANGE', 'ts', 'thunderclap'],
  ['ṱhoho i rema nga maanḓa nga u ṱavhanya', 'ORANGE', 've', 'thunderclap'],

  // ════════════════════════════════════════════════════════════
  // ORANGE: ACUTE CONFUSION + CHRONIC DISEASE
  // ════════════════════════════════════════════════════════════
  ['confused and has diabetes not making sense', 'ORANGE', 'en', 'acute_confusion'],
  ['udidekile ushukela', 'ORANGE', 'zu', 'acute_confusion'],
  ['deurmekaar suiker', 'ORANGE', 'af', 'acute_confusion'],
  ['o didimala bolwetši bja swikiri', 'ORANGE', 'nso', 'acute_confusion'],
  ['u didimele vuvabyi bya swikiri', 'ORANGE', 'ts', 'acute_confusion'],

  // ════════════════════════════════════════════════════════════
  // SETSWANA (tn) — expanded coverage for Tshwane pilot
  // ════════════════════════════════════════════════════════════
  // RED
  ['ga a heme mme pelo ya gagwe e emile', 'RED', 'tn', 'respiratory_arrest'],
  ['o idibetse ga a tsoge', 'RED', 'tn', 'unconscious'],
  ['o a thothomela o a rotha jaanong', 'RED', 'tn', 'active_seizure'],
  ['sehuba ga ke heme go hema go thata', 'RED', 'tn', 'cardiac_emergency'],
  ['noga e nkometse moleng', 'RED', 'tn', 'envenomation'],
  ['ke ipaakanyeditse mme ke ntsha madi mo tlase', 'RED', 'tn', 'obstetric_haemorrhage'],
  ['ngwana wa me ga a heme', 'RED', 'tn', 'neonatal_apnoea'],
  ['o tšhile metsi a a fisang', 'RED', 'tn', 'severe_burns'],
  ['ngwana o idibetse o wetse fa fatshe', 'RED', 'tn', 'paediatric_unconscious'],
  // ORANGE
  ['sefatlhego se theogetse molomo o kgopame', 'ORANGE', 'tn', 'stroke_facial_droop'],
  ['letsogo le bokoa letsogo ga le tshikinyege', 'ORANGE', 'tn', 'stroke_arm_weakness'],
  ['o bua thata mafoko ga a tswe sentle', 'ORANGE', 'tn', 'stroke_speech'],
  ['tlhogo e e bohloko thata ka tshoganyetso', 'ORANGE', 'tn', 'thunderclap_headache'],
  ['o kile a rotha go rotha go fedile o didimala', 'ORANGE', 'tn', 'post_ictal'],
  ['o didimala ga a itse bolwetse jwa sukiri', 'ORANGE', 'tn', 'acute_confusion_chronic'],
  // YELLOW
  ['botlhoko jo bogolo ke a lela ka botlhoko', 'YELLOW', 'tn', 'severe_pain'],
  ['ke batla go ipolaya ga ke sa batle go tshela', 'YELLOW', 'tn', 'suicidal_ideation'],
  ['ke otlilwe monna wa me o ntlhabile', 'YELLOW', 'tn', 'abuse_assault'],
  ['ke gohlola dibeke ke tswa marothodi bosigo ke latlhile boima', 'YELLOW', 'tn', 'tb_triad'],
  ['kgatelelo ya madi e kwa godimo madi a godileng tlhogo', 'YELLOW', 'tn', 'hypertensive_urgency'],
  ['madi a tswa ka ganong madi mo mantswing', 'YELLOW', 'tn', 'gi_bleeding'],
  ['mogote molala o thata molala o botlhoko', 'YELLOW', 'tn', 'meningism'],

  // ════════════════════════════════════════════════════════════
  // YELLOW — multilingual coverage (all 11 languages)
  // ════════════════════════════════════════════════════════════
  // TB triad
  ['ngiyakhohlela juluka ebusuku nciphile isisindo', 'YELLOW', 'zu', 'tb_triad'],
  ['ndikhohla khefuzela ebusuku phulukane nesixa', 'YELLOW', 'xh', 'tb_triad'],
  ['ek hoes nagsweet gewig verloor', 'YELLOW', 'af', 'tb_triad'],
  ['ke gohlola phwa bosigo lahlegetšwe ke boima', 'YELLOW', 'nso', 'tb_triad'],
  ['ke hehela tswa molapo bosiu lahlehetse boima', 'YELLOW', 'st', 'tb_triad'],
  ['ndzi hovelela xurha usiku khomokile ncilo', 'YELLOW', 'ts', 'tb_triad'],
  ['ngikhwehlela khuzama ebusuku ncokolele lisindo', 'YELLOW', 'ss', 'tb_triad'],
  ['ndi khalutshela mavhungo usiku laha vhuimo', 'YELLOW', 've', 'tb_triad'],
  ['ngiyakhohlela umjuluko ebusuku nciphile isisindo', 'YELLOW', 'nr', 'tb_triad'],
  // Severe pain
  ['bohloko bo bogolo ke a lla ka bohloko', 'YELLOW', 'nso', 'severe_pain'],
  ['bohloko bo boholo ke a lla ka bohloko', 'YELLOW', 'st', 'severe_pain'],
  ['vuhlungu lebyi kuleke ndzi le vuhlungwini lebyi kuleke', 'YELLOW', 'ts', 'severe_pain'],
  ['vuvha vuhulu ndi na vuvha vuhulu', 'YELLOW', 've', 'severe_pain'],
  // Suicidal ideation
  ['ke nyaka go ipolaya', 'YELLOW', 'nso', 'suicidal_ideation'],
  ['ke batla ho ipolaya', 'YELLOW', 'st', 'suicidal_ideation'],
  ['ndzi lava ku tirhisa a ndzi sa lavi ku hanya', 'YELLOW', 'ts', 'suicidal_ideation'],
  ['ngifuna kutibulala', 'YELLOW', 'ss', 'suicidal_ideation'],
  ['ndi ṱoḓa u ḓivhulaha', 'YELLOW', 've', 'suicidal_ideation'],
  ['ngifuna ukuzibulala angisafuni ukuphila', 'YELLOW', 'nr', 'suicidal_ideation'],
  // Meningism (fever + stiff neck)
  ['umkhuhlane umnqala ubuhlungu', 'YELLOW', 'zu', 'meningism'],
  ['koors stywe nek', 'YELLOW', 'af', 'meningism'],
  ['mogote molala o thata', 'YELLOW', 'nso', 'meningism'],
  ['fivha nkulo wu tiyile', 'YELLOW', 'ts', 'meningism'],

  // ════════════════════════════════════════════════════════════
  // YELLOW — UTI + back pain (pyelonephritis) multilingual
  // ════════════════════════════════════════════════════════════
  ['kusha emchamweni ubuhlungu emhlane fever', 'YELLOW', 'zu', 'pyelonephritis'],
  ['brand as ek urineer rugpyn koors', 'YELLOW', 'af', 'pyelonephritis'],
  ['go sha fa ke ntsha metsi mmogo o bohloko mogote', 'YELLOW', 'tn', 'pyelonephritis'],
  ['ho sha ha ke ntsha metsi mokokotlo o bohloko mocheso', 'YELLOW', 'st', 'pyelonephritis'],
  ['ku hisa loko ndzi sila manzi mhamba wo bohloko fivha', 'YELLOW', 'ts', 'pyelonephritis'],

  // ════════════════════════════════════════════════════════════
  // YELLOW — DKA / high blood sugar multilingual
  // ════════════════════════════════════════════════════════════
  ['ngineshukela ngiyahlanza ishukela liphezulu kakhulu', 'YELLOW', 'zu', 'dka'],
  ['suikersiekte braak suiker baie hoog', 'YELLOW', 'af', 'dka'],
  ['bolwetse jwa sukiri ke a tlhaka sukiri e kwa godimo thata', 'YELLOW', 'tn', 'dka'],
  ['bolwetsi ba tsoekere ke a hlantsa tsoekere e phagameng haholo', 'YELLOW', 'st', 'dka'],
  ['vuvabyi bya swikiri ndzi a hlanza swikiri yi tlakukile ngopfu', 'YELLOW', 'ts', 'dka'],

  // ════════════════════════════════════════════════════════════
  // YELLOW SAFETY NET — YELLOW → ORANGE upgrade
  // These test that ORANGE-level signals in YELLOW-classified
  // text get caught by the safety net.
  // Input AI result is YELLOW (not GREEN).
  // ════════════════════════════════════════════════════════════
  // Stroke signs in YELLOW
  ['face drooping and arm weak and speech slurred', 'ORANGE', 'en', 'yellow_safety_net_stroke', YELLOW],
  ['ubuso buyehla ingalo ibuthaka ukhuluma nzima', 'ORANGE', 'zu', 'yellow_safety_net_stroke', YELLOW],
  // Pre-eclampsia in YELLOW
  ['pregnant severe headache blurred vision swollen hands', 'ORANGE', 'en', 'yellow_safety_net_preeclampsia', YELLOW],
  ['ke ipaakanyeditse tlhogo matlho a fifala', 'ORANGE', 'tn', 'yellow_safety_net_preeclampsia', YELLOW],
  // Febrile seizure in YELLOW
  ['my child is fitting with high fever and shaking', 'ORANGE', 'en', 'yellow_safety_net_febrile_seizure', YELLOW],
  // Note: exact seizure keywords (rotha/thothomela) trigger RED before safety net — correct, safer
  // This test uses 'fitting' + 'kind' + 'koors' which are in the shared pools but not exact DCSL seizure rules
  ['kind is fitting with koors and shaking', 'ORANGE', 'af', 'yellow_safety_net_febrile_seizure', YELLOW],
  // Confusion + diabetes in YELLOW
  ['confused not making sense diabetic', 'ORANGE', 'en', 'yellow_safety_net_confusion_chronic', YELLOW],
  ['o didimala sukiri', 'ORANGE', 'tn', 'yellow_safety_net_confusion_chronic', YELLOW],
  // Thunderclap headache in YELLOW
  ['worst headache of my life never had headache this bad', 'ORANGE', 'en', 'yellow_safety_net_thunderclap', YELLOW],

  // ════════════════════════════════════════════════════════════
  // NEGATIVE TESTS — should NOT trigger DCSL
  // ════════════════════════════════════════════════════════════
  ['mild headache for two days', 'GREEN', 'en', 'no_match'],
  ['i have a runny nose and sore throat', 'GREEN', 'en', 'no_match'],
  ['ngidinga amaphilisi ami', 'GREEN', 'zu', 'no_match (medication collection)'],
  ['ek voel bietjie naar', 'GREEN', 'af', 'no_match (mild nausea)'],
  ['ke nyaka dihlare tsa ka', 'GREEN', 'nso', 'no_match (medication)'],
  ['ke batla dimelemo tsa me', 'GREEN', 'tn', 'no_match (medication)'],
];

// ── Run tests ──────────────────────────────────────────────────
let passed = 0;
let failed = 0;
const failures = [];

console.log('╔══════════════════════════════════════════════════════════╗');
console.log('║  BIZUSIZO DCSL Validation — 11 Official SA Languages    ║');
console.log('╚══════════════════════════════════════════════════════════╝\n');

for (const test of tests) {
  const [text, expectedLevel, lang, label, aiInput] = test;
  const result = applyClinicalRules(text, aiInput || GREEN);
  const actual = result.triage_level;
  const ok = actual === expectedLevel;

  if (ok) {
    passed++;
  } else {
    failed++;
    failures.push({ text, expected: expectedLevel, actual, lang, label, rule: result.rule_override || 'none' });
    console.log(`  FAIL | ${lang.padEnd(3)} | ${label}`);
    console.log(`       | Input: "${text}"`);
    console.log(`       | Expected: ${expectedLevel}, Got: ${actual} (rule: ${result.rule_override || 'none'})\n`);
  }
}

// ── Summary ────────────────────────────────────────────────────
const langCoverage = {};
for (const test of tests) {
  const [, level, lang] = test;
  if (level === 'GREEN') continue; // skip negative tests
  if (!langCoverage[lang]) langCoverage[lang] = { red: 0, orange: 0 };
  if (level === 'RED') langCoverage[lang].red++;
  if (level === 'ORANGE') langCoverage[lang].orange++;
}

console.log('── Coverage by Language ──────────────────────────────────');
console.log('  Lang   | RED tests | ORANGE tests');
console.log('  -------|-----------|-------------');
for (const [lang, counts] of Object.entries(langCoverage).sort()) {
  console.log(`  ${lang.padEnd(6)} | ${String(counts.red).padStart(9)} | ${String(counts.orange).padStart(12)}`);
}

console.log(`\n── Result ───────────────────────────────────────────────`);
console.log(`  Total:  ${tests.length}`);
console.log(`  Passed: ${passed}`);
console.log(`  Failed: ${failed}`);
console.log(`  Rate:   ${((passed / tests.length) * 100).toFixed(1)}%`);

if (failed > 0) {
  console.log(`\n  ⚠️  ${failed} FAILURE(S) — DCSL coverage gap detected.`);
  console.log('  Fix the failing rules before deployment.\n');
  process.exit(1);
} else {
  console.log(`\n  ✅ ALL PASS — DCSL covers all 11 languages.\n`);
  process.exit(0);
}
