#!/usr/bin/env node
// Build per-language native-speaker review packets straight from
// lib/messages.js and lib/triage.js. Output: 10 markdown files in
// docs/review_packets/, one per non-English language, each containing:
//
//   Part 1: All patient-facing messages (English source + target-lang
//           translation, or [MISSING] if absent)
//   Part 2: All DCSL rules (English trigger phrases + target-lang
//           keywords extracted from has() calls)
//
// This supersedes the stale Native_Speaker_Message_Review.md and
// DCSL_Native_Speaker_Review.md, which predate 20 April code changes.

const fs = require('fs');
const path = require('path');

const { MESSAGES } = require(path.join(__dirname, '..', 'lib', 'messages.js'));
const extractIndexMessages = require(path.join(__dirname, '_index_extractor.js'));
const INDEX_MESSAGES = extractIndexMessages();  // { CCMDD_MESSAGES, VIRTUAL_CONSULT_MESSAGES, LAB_MESSAGES }

const LANG_CODES = ['zu', 'xh', 'af', 'nso', 'tn', 'st', 'ts', 'ss', 've', 'nr'];
const LANG_NAMES = {
  en: 'English (source)',
  zu: 'isiZulu', xh: 'isiXhosa', af: 'Afrikaans',
  nso: 'Sepedi', tn: 'Setswana', st: 'Sesotho',
  ts: 'Xitsonga', ss: 'siSwati', ve: 'Tshivenda', nr: 'isiNdebele'
};

// Language markers for semantic keyword attribution (reused / expanded
// from scripts/extract_dcsl_catalogue.js). A keyword is attributed to a
// language if any marker for that language appears as a substring.
const LANG_MARKERS = {
  zu: [
    'ngi', 'uku', 'akuphefumuli', 'akaphefumuli', 'khulelwe', 'ngikhulelwe',
    'isifuba', 'ikhanda', 'umphimbo', 'umzimba', 'igazi', 'ingane', 'inyoka',
    'uqulekile', 'ukuphefumula', 'isibhebhe', 'ibhebhe', 'usana',
    'ubuhlungu', 'angiphefumuli', 'ukhuluma nzima',
    'uyabanjwa manje', 'ingalo ibuthaka',
    'ushukela', 'iswekile', 'akadli', 'akasancela', 'akaziphilile',
    'uwile', 'umzimba uwile', 'ubuso buyehla', 'umlomo ugobile',
    'ngawa', 'wawa', 'amehlo ayaxobana', 'izinyawo zivuvukile',
    'ibhebhe aliphefumuli', 'usana aliphefumuli', 'ingane iqulekile',
    'uyishayiwe', 'wabanjwa', 'ulele', 'udidekile',
    'inhlungu', 'wabanjwa ngodlame', 'hlukunyeziwe',
    'amaqhubu', 'amabhatha', 'isikhumba esibomvu', 'inkaba iphumile',
    'ithambo liphuma', 'ithambo liyabonakala', 'ngishaywe ekhanda',
    'ngishaywe', 'ngishayiswe yimoto', 'ingozi yemoto', 'ngiwe ophahleni',
    'ngiyazibulala', 'amaphilisi', 'ngizifaka intambo',
    'umzimba uwonke ushisiwe', 'ushile umzimba', 'amanzi abilayo',
    'isisu siqinile', 'isisu asiphatheki',
    'isifuba sicinene', 'isifuba sisindwa', 'ingalo isinda',
    'umhlathi ubuhlungu', 'uyajuluka', 'umjuluko', 'ubuso', 'umlomo',
  ],
  xh: [
    'intloko', 'uthetha nzima', 'aaphefumli', 'andiphefumli',
    'uwe phantsi', 'umntu',
    'andilukuhla', 'ndilukuhliwe',
    'iintlungu ezimbi kakhulu', 'ixesha alifiki',
    'inyoka yamluma', 'usana lwam', 'ibhabhu', 'umntwana akanyakazi',
    'hlukunyezwa', 'bethiwe',
    'umntwana uqulekile', 'umntwana uwile', 'usana aluhambi',
    'ithambo liphuma esikhumbeni',
    'ndibethiwe entloko', 'ndiwile ndabetha intloko', 'ndibethwe yimoto',
    'iintlungu ezinkulu', 'izandla neengalo',
    'umzimba wonke utshisiwe', 'utshiswe kakhulu',
    'umqolo',
  ],
  af: [
    'nie asem', 'asem haal nie', 'kan nie asem', 'hartaanval',
    'swanger', 'bloed', 'bloei', 'bloeding', 'borspyn',
    'keel swel', 'gesig swel', 'lippe swel', 'bewusteloos',
    'slangbyt', 'slang gebyt', 'hoofpyn', 'koors',
    'kind bewusteloos', 'baba van', 'suigeling', 'pasgebore',
    'oë waas', 'baie pyn', 'verskriklike pyn', 'stuiptrekkings',
    'epilepsie aanval', 'val om', 'reageer nie',
    'praat deurmekaar', 'periode is laat', 'swangerskap toets',
    'glas druk', 'rooi kolle', 'pers kolle',
    'aangeval', 'geslaan', 'mishandeling',
    'pers uitslag', 'donker uitslag', 'uitslag wat nie verdwyn',
    'been steek uit vel', 'been sigbaar', 'oop breuk',
    'kop gestamp', 'kopbesering',
    'maag hard soos plank', 'maag styf', 'ergste maagpyn',
    'motorongeluk', 'geval van dak', 'val van hoogte',
    'gaan myself doodmaak', 'drink nou pille', 'probeer hang',
    'suiker baie laag', 'glukose baie laag',
    'erg gebrand', 'hele liggaam gebrand',
    'kookwater op', 'warm water oor',
    'baba haal nie asem', 'naelstring uit', 'naelstring gly uit',
    'bors druk', 'bors swaar', 'pyn in bors',
    'arm swaar', 'koue sweet', 'kakebeen pyn',
    'gebrand', 'skroei', 'brand',
  ],
  nso: [
    'ga a heme', 'a a heme', 'ga e heme', 'pelo e emile', 'go hema go emile',
    'o idibetse', 'sethuthuthu', 'o a rotha', 'o swarwa ke sethuthuthu',
    'sehuba', 'ngwana ga a heme', 'lesea ga le heme',
    'ke imile', 'noga e mo lomile', 'o tšhutše', 'o tšhile',
    'bolwetši bja swikiri', 'madi a godilego',
    'mometso o rurugile', 'sefahlego se rurugile',
    'o kile a rotha', 'sefahlego se theogetše', 'ngwana o idibetse',
    'hlogo e bohloko kudu', 'letsogo le fokola',
    'o bolela nzima', 'mantšu ga a tswe', 'o didimala',
    'mohlabi', 'mogote',
    'mafokodi a maso', 'mafokodi a sa fele',
    'lerapo le tšwa ka letlalo', 'lerapo le a bonagala',
    'kotsi ya koloi', 'ngopotswe ke koloi', 'ngwele go tšwa godimo',
    'mpa e thata bjalo ka lepolanka', 'bohloko bja mpa',
    'sehuba se bohloko', 'mohlakola o bohloko',
    'ke otlilwe ka hlogo', 'kgobalo ya hlogo',
    'ke ikgotlhomolla', 'ke nwele dipilisi',
    'swikiri se tlase kudu',
    'meetse a go fisha godimo', 'o fiswe',
  ],
  tn: [
    'go hema go emile', 'o idibetse', 'o wetse fa fatshe', 'ga a arabe',
    'ngwana ga a tshikinyege', 'ke imile kgale',
    'sefatlhego', 'o tšhutse', 'metsi a a fisang',
    'bolwetse jwa sukiri', 'madi a godileng',
    'sefatlhego se rurugile', 'molomo o rurugile',
    'o kile a rotha', 'sefatlhego se theogetse',
    'tlhogo e e bohloko', 'letsogo le bokoa',
    'o bua thata', 'mafoko ga a tswe',
    'lerapo le tswa mo letlalong', 'lerapo le a bonala',
    'kotsi ya koloi', 'ke kgotlilwe ke koloi', 'ke oele go tswa godimo',
    'mpa e thata jaaka lepolanka', 'bohloko jwa mpa bo bogolo',
    'sehuba se gatelelwa',
    'ke iteilwe mo tlhogong', 'kgobalo ya tlhogo',
    'ke itshwaya gona jaanong', 'ke nole dipilisi tse dintsi',
    'sukiri e kwa tlase thata',
    'metsi a a fisang godimo',
  ],
  st: [
    'ha a phefumolohe', 'ho phefumoloha ho emile',
    'o itshedisitse', 'ha a tsohe', 'o oele fatshe',
    'o a thothomela', 'o a ratha joale', 'sefuba',
    'noha e mo lomile', 'o chele',
    'bolwetsi ba tsoekere', 'madi a phahameng',
    'sefahleho se rurugile',
    'ho hema ho thata', 'ha ke phefumolohe',
    'ha a phefumolohe', 'lesea', 'sefahleho se theohile',
    'hlogo e bohloko haholo', 'letsoho le fokola',
    'o bolela nzima', 'mantswe ha a tswe',
    'mocheso',
    'mafokoti a maso', 'mafokoti a sa fele',
    'lesapo le tsoa leroleng', 'lesapo le a bonahala',
    'kotsi ya koloi', 'ke thuntswe ke koloi', 'ke wele ho tsoa hodimo',
    'mpa e thata jwaloka lepolanka', 'bohloko ba mpa',
    'sefuba se bohloko', 'sefuba se tshwarehile',
    'ke otlilwe hlohong', 'kotsi ya hlooho',
    'ke itima hona joale', 'ke nwele dipilisi tse ngata',
    'tsoekere e tlase haholo',
    'metsi a chesang hodima',
  ],
  ts: [
    'ku hefemula ku yimile', 'mbilu yi yimile',
    'u wisile', 'a a pfuki', 'u etlele',
    'u a rhurhumela', 'u a tsekatseka', 'nhlanga',
    'ndzi tikile', 'nyoka yi lumile', 'u hisiwe',
    'xifuva xa moya', 'xifuva', 'mati ya ku hisa',
    'vuvabyi bya swikiri', 'ngati ya le henhla',
    'nkulo wu pfulile', 'xikandza xi pfulile',
    'mahlo ya fifiala', 'voko ri hele matimba',
    'u vulavula hi ku tika', 'marito a a humeli',
    'u didimele', 'rixaka', 'fivha',
    'hlukunyezwa', 'baswa va xisati',
    'swiphanga leswi', 'rhambu ri huma', 'rhambu ri voniwa',
    'xihoko xa movha', 'ndzi bile hi movha', 'ndzi wile ehenhla',
    'khwiri ri tiyile', 'ku vava ka khwiri',
    'xifuva xi vava', 'xifuva xi tika',
    'ndzi bile enhlokweni', 'ku vaviseka ka nhloko',
    'ndzi tidlaya sweswi', 'ndzi swarile dziphilisi',
    'swikiri swi le hansi',
    'mati ya ku hisa ehenhla',
  ],
  ss: [
    'inhlitiyo yeme', 'udzakiwe', 'akaphaphami', 'umntfwana',
    'uyabanjwa nyalo', 'uyatfutfumela', 'umtimba uyadzikita',
    'emita', 'inyoka imlumile', 'ushile', 'ushiselwe',
    'emanti lashisako', 'sifo seshugela', 'ingati lephakeme',
    'umphimbo uvuvukile', 'buso buyavuvuka',
    'emehlo ayafifiyala', 'ikhanda lelibuhlungu',
    'ubanjwe', 'kutfutfumela kuphele',
    'ayisebenzi', 'ayisiti',
    'imfiva', 'umntfwana lomncane',
    'shayiwe', 'hlukunyetwa',
    'emapethwane lamnyama', 'emapethwane langapheli',
    'libhanti liphuma', 'libhanti liyabonakala',
    'ingozi yemoto', 'ngishaywe yimoto',
    'sisu sishibalala njengelibhodi', 'sisu asiphatseki',
    'sifuba sibuhlungu', 'sifuba sibanjiwe',
    'ngishaywe enhlokweni',
    'ngitibulala nyalo', 'ngidle emaphilisi',
    'shukela iphantsi', 'shukela iwile',
    'inkhaba yinyatseleka',
  ],
  ve: [
    'ha a fembi', 'a a khou femba', 'mbilu yo ima',
    'o ṱalala', 'ha a vuhi', 'o wa fhasi', 'ha a fhinduli',
    'u a dzhendzela', 'u a thothomela zwino',
    'ndi imile', 'ṋowa yo mu luma', 'o fhiswa',
    'maḓi a u fhisa', 'vhulwadze ha swigiri', 'malofha',
    'muṱodzi wo ṱahela', 'tshifhaṱuwo tsho ṱahela',
    'maṱo a si tshi vhona', 'ṱhoho i rema',
    'tshanḓa tsho fa maanḓa', 'u amba zwi a konḓa',
    'ṅwana', 'lutshetshe', 'muḓifhiso', 'o ḓidimala',
    'mapimbi o swifhalaho', 'mapimbi a sa fheli',
    'ḽitambo ḽi bvaho', 'ḽitambo ḽa vhonala',
    'khombo ya goloi', 'ndo rwiwa nga goloi', 'ndo wa ntha',
    'lumbu ḽo khwaṱha', 'vhutungu ha lumbu',
    'khana ḽi vhavha', 'khana ḽo lemala',
    'ndo rwiwa kha ṱhoho',
    'ndi a ḓivhulaha', 'ndo nwa dziphilisi',
    'swigiri tshi fhasi',
    'maḓi a u fhisa ṋṱha',
  ],
  nr: [
    'ihliziyo yeme', 'uwele phasi',
    'uyabanjwa nje', 'uyathuthumela', 'umzimba uyadzikiza',
    'ngiimithi', 'utjhile', 'utjhisiwe', 'amanzi atjhisako',
    'isifo sesiswigiri', 'igazi eliphezulu',
    'ikhanda elibuhlungu ngokuzuma', 'amezwi akaphumi kuhle',
    'ukuthuthumela kuphelile',
    'umntwana akaphefumuli', 'ihlukunyezo',
    'amaqhubu amnyama angaphumi',
    'ngibethwe yimoto', 'ngiwe phezulu',
    'isisu siqinile njengepulangi', 'ubuhlungu besisu obukhulu',
    'isifuba sibuhlungu ngokubambeka',
    'ngibethwe ekhanda', 'ngiwile ngabetha ikhanda',
    'ngizibulala manje', 'sengidle amaphilisi amaningi',
    'ushukela uphansi khulu',
    'amanzi atjhisako phezu',
    'ithambo liphuma esikhumbeni',
    'ubuhlungu obukhulu ohlangothini olunye',
  ],
};

// ──────────────────────────────────────────────────────────────────
// Extract DCSL rules with per-language keywords
// ──────────────────────────────────────────────────────────────────

const triageSrc = fs.readFileSync(path.join(__dirname, '..', 'lib', 'triage.js'), 'utf8');
const fnStart = triageSrc.indexOf('function applyClinicalRules');
const scope = triageSrc.slice(fnStart);

// Each rule block: optional comment header (// RULE DESCRIPTION),
// if (has(...)) or if (has(...) && has(...)), return red/orange/yellow('id')
// Walk through finding each `return red|orange|yellow('id')` and the
// preceding if-block.

const ruleBlocks = [];
const retRe = /return (red|orange|yellow)\('([A-Za-z0-9_]+)'\)/g;
let m;
while ((m = retRe.exec(scope)) !== null) {
  const level = m[1].toUpperCase();
  const ruleId = m[2];
  const end = m.index;
  const start = scope.lastIndexOf('\n  if (', end);
  if (start < 0) continue;
  // Find comment header immediately preceding the if-block
  const blockStart = scope.slice(0, start).lastIndexOf('\n  //');
  const block = scope.slice(start, end);
  // Extract keywords (single-quoted strings, double-quote-stripped)
  const dqStripped = block.replace(/"[^"\\]*(?:\\.[^"\\]*)*"/g, '""');
  const kwRe = /'([^'\\]*(?:\\.[^'\\]*)*)'/g;
  const kws = [];
  let km;
  while ((km = kwRe.exec(dqStripped)) !== null) {
    const kw = km[1].toLowerCase().trim();
    if (kw && kw.length >= 2 && kw.length < 150) kws.push(kw);
  }
  // Get last comment lines as header
  const preamble = scope.slice(Math.max(0, start - 600), start);
  const commentLines = preamble.split('\n').filter(l => /^\s*\/\/ /.test(l)).slice(-4);
  const header = commentLines.map(l => l.replace(/^\s*\/\/\s?/, '').trim()).filter(Boolean).join(' | ') || ruleId;

  ruleBlocks.push({ level, ruleId, header, keywords: kws });
}

// ──────────────────────────────────────────────────────────────────
// Classify keywords by language
// ──────────────────────────────────────────────────────────────────

function keywordLang(kw) {
  for (const [code, markers] of Object.entries(LANG_MARKERS)) {
    for (const marker of markers) {
      if (kw.includes(marker)) return code;
    }
  }
  return 'en'; // default/unclassified → treat as English
}

// Strip language-suffix from rule id for grouping
function baseRule(id) {
  for (const c of LANG_CODES) if (id.endsWith('_' + c)) return id.slice(0, -('_' + c).length);
  return id;
}

// Group rules by base id, aggregating keywords across per-language rule variants
const ruleMap = new Map();
for (const r of ruleBlocks) {
  const base = baseRule(r.ruleId);
  if (!ruleMap.has(base)) ruleMap.set(base, { level: r.level, header: r.header, byLang: {} });
  const entry = ruleMap.get(base);
  for (const kw of r.keywords) {
    const L = keywordLang(kw);
    if (!entry.byLang[L]) entry.byLang[L] = new Set();
    entry.byLang[L].add(kw);
  }
  if (!entry.header.includes('—') && r.header.length > entry.header.length) entry.header = r.header;
}

// ──────────────────────────────────────────────────────────────────
// Emit per-language review packets
// ──────────────────────────────────────────────────────────────────

const outDir = path.join(__dirname, '..', 'docs', 'review_packets');
if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });

const TODAY = new Date().toISOString().slice(0, 10);
const MSG_KEYS = Object.keys(MESSAGES);

for (const L of LANG_CODES) {
  const out = [];
  out.push(`# BIZUSIZO native-speaker review — ${LANG_NAMES[L]}`);
  out.push('');
  out.push(`**Language:** ${LANG_NAMES[L]} (code: \`${L}\`)`);
  out.push(`**Generated:** ${TODAY} (from live source code)`);
  out.push(`**Reviewer instructions:** For each entry below, please mark ✅ (correct and natural), ❌ (wrong — suggest fix), or ➕ (add missing phrasing). For any ❌ or ➕, please provide the correct/additional phrasing in the notes column.`);
  out.push('');
  out.push(`**What you are reviewing:** all ${LANG_NAMES[L]} content that a patient might read (Part 1 — WhatsApp messages) or that the system scans patient text for (Part 2 — clinical safety keywords).`);
  out.push('');
  out.push('---');
  out.push('');
  out.push(`## PART 1 — Patient-facing WhatsApp messages (${MSG_KEYS.length} entries)`);
  out.push('');
  out.push('Each row shows the English source text (for reference) and the current ' + LANG_NAMES[L] + ' translation. If ' + LANG_NAMES[L] + ' is marked **[MISSING — PLEASE TRANSLATE]**, the translation has not been written yet and we need you to provide it.');
  out.push('');

  let msgIdx = 1;

  function emitMessageEntry(sourceLabel, key, enText, tgtText, isAll) {
    out.push(`### 1.${msgIdx} \`${key}\` *(${sourceLabel})*`);
    out.push('');
    out.push('**English source:**');
    out.push('```');
    out.push(String(enText || '').replace(/```/g, '` ` `'));
    out.push('```');
    out.push('');
    out.push(`**${LANG_NAMES[L]}:**`);
    if (isAll) {
      out.push('*(Not language-specific — shown in all languages at once.)*');
    } else if (tgtText === undefined || tgtText === null) {
      out.push('```');
      out.push('⚠️ [MISSING — PLEASE TRANSLATE]');
      out.push('```');
    } else {
      out.push('```');
      out.push(String(tgtText).replace(/```/g, '` ` `'));
      out.push('```');
    }
    out.push('');
    out.push('**Status:** ☐ ✅ correct  ☐ ❌ wrong (fix below)  ☐ ➕ add (below)');
    out.push('');
    out.push('**Notes / corrections / additions:**');
    out.push('');
    out.push('---');
    out.push('');
    msgIdx++;
  }

  // Section 1A — lib/messages.js
  out.push('### 1A. Core messages (lib/messages.js)');
  out.push('');
  for (const key of MSG_KEYS) {
    const entry = MESSAGES[key];
    emitMessageEntry('lib/messages.js', key, entry.en || entry._all, entry[L], !!entry._all);
  }

  // Section 1B — CCMDD_MESSAGES (index.js)
  out.push('### 1B. Chronic medication (CCMDD) messages (index.js)');
  out.push('');
  for (const [sk, values] of Object.entries(INDEX_MESSAGES.CCMDD_MESSAGES || {})) {
    emitMessageEntry('index.js → CCMDD_MESSAGES', sk, values.en, values[L], false);
  }

  // Section 1C — VIRTUAL_CONSULT_MESSAGES (index.js)
  out.push('### 1C. Virtual consult messages (index.js)');
  out.push('');
  for (const [sk, values] of Object.entries(INDEX_MESSAGES.VIRTUAL_CONSULT_MESSAGES || {})) {
    emitMessageEntry('index.js → VIRTUAL_CONSULT_MESSAGES', sk, values.en, values[L], false);
  }

  // Section 1D — LAB_MESSAGES (index.js)
  out.push('### 1D. Lab result messages (index.js)');
  out.push('');
  for (const [sk, values] of Object.entries(INDEX_MESSAGES.LAB_MESSAGES || {})) {
    emitMessageEntry('index.js → LAB_MESSAGES', sk, values.en, values[L], false);
  }

  out.push('');
  out.push(`## PART 2 — Clinical safety keywords (${ruleMap.size} rules)`);
  out.push('');
  out.push('The system scans patient text for keyword combinations and assigns a triage level (RED = emergency, ORANGE = very urgent, YELLOW = urgent) **independent of the AI**. Each rule below shows the English trigger phrases (so you know what the rule is for) and the current ' + LANG_NAMES[L] + ' keywords the system recognises. These are natural patient phrasings, not clinical terminology.');
  out.push('');
  out.push('**For each rule, please:**');
  out.push('1. Confirm the listed ' + LANG_NAMES[L] + ' keywords are correct and natural for how a patient would type on WhatsApp.');
  out.push('2. Add any common phrasings a patient might use for this symptom that are **not** currently listed.');
  out.push('3. Flag any keyword that sounds unnatural, overly formal, or potentially misleading.');
  out.push('');
  out.push('**Priority:** ✨ high (RED rules, life-threatening) · important (ORANGE) · ⚪ lower priority (YELLOW)');
  out.push('');

  // Group rules by level
  for (const level of ['RED', 'ORANGE', 'YELLOW']) {
    out.push(`### ${level} discriminators`);
    out.push('');
    const rulesAtLevel = [...ruleMap.entries()].filter(([, v]) => v.level === level);
    let ruleIdx = 1;
    for (const [ruleId, info] of rulesAtLevel) {
      const enKws = [...(info.byLang.en || [])].sort();
      const tgtKws = [...(info.byLang[L] || [])].sort();
      out.push(`#### ${level} ${ruleIdx}. \`${ruleId}\``);
      if (info.header) out.push(`*${info.header}*`);
      out.push('');
      out.push('**English trigger phrases** (what the rule looks for in English):');
      if (enKws.length === 0) out.push('- *(no English triggers — this rule is language-conditional)*');
      else for (const k of enKws) out.push(`- \`${k}\``);
      out.push('');
      out.push(`**Current ${LANG_NAMES[L]} keywords** (what the rule recognises in ${LANG_NAMES[L]}):`);
      if (tgtKws.length === 0) {
        out.push('- **⚠️ NONE — please provide keywords for this symptom in ' + LANG_NAMES[L] + '**');
      } else {
        for (const k of tgtKws) out.push(`- \`${k}\``);
      }
      out.push('');
      out.push('**Status:** ☐ ✅ correct  ☐ ❌ wrong (fix below)  ☐ ➕ missing phrases to add');
      out.push('');
      out.push('**Notes / corrections / additions:**');
      out.push('');
      out.push('---');
      out.push('');
      ruleIdx++;
    }
  }

  out.push('');
  out.push('## Reviewer sign-off');
  out.push('');
  out.push('**Reviewer name:** ________________________________');
  out.push('');
  out.push('**Reviewer qualifications** (native speaker / clinical background / both):');
  out.push('');
  out.push('**Date completed:** ________________');
  out.push('');
  out.push('**Overall assessment** (tick one):');
  out.push('- ☐ All content is correct and natural. No changes needed.');
  out.push('- ☐ Most content is correct. Specific corrections/additions noted above.');
  out.push('- ☐ Substantial corrections needed. See notes above.');
  out.push('');
  out.push('**Signature / confirmation:** ________________________________');
  out.push('');

  const outPath = path.join(outDir, `review_${L}_${LANG_NAMES[L].replace(/\s/g, '_')}.md`);
  fs.writeFileSync(outPath, out.join('\n'));
  console.log('Wrote', outPath);
}

console.log('\nDone. 10 per-language review packets in docs/review_packets/');
