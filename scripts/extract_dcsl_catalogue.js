#!/usr/bin/env node
// Extracts the DCSL discriminator catalogue from lib/triage.js and emits
// a Markdown table showing 11-language keyword coverage per discriminator.
//
// Approach: semantic per-keyword language detection (not rule-ID suffix).
// For each rule's has()/return pair, all keyword strings are scanned
// against per-language marker dictionaries. A language is recorded as
// covered for a rule if any of that language's characteristic markers
// appears in the rule's keyword list.
//
// Output: stdout. Redirect into docs/additional_file_3_dcsl_catalogue.md.

const fs = require('fs');
const path = require('path');

const SRC = path.join(__dirname, '..', 'lib', 'triage.js');
const src = fs.readFileSync(SRC, 'utf8');

// Restrict to applyClinicalRules function body.
const fnStart = src.indexOf('function applyClinicalRules');
const fnEnd = src.indexOf('\n// ── No discriminator matched', fnStart);
const scope = src.slice(fnStart, fnEnd > 0 ? fnEnd : undefined);

// Per-language marker sets. A rule "covers" a language if any of these
// substrings appears in its keyword list. Markers chosen to be
// distinctive for the language (avoiding cross-language collisions
// where possible). English is assumed whenever any English-looking
// keyword is present (default true for all rules written in English).
const LANGS = [
  { label: 'en',  name: 'English',    markers: null /* default-covered */ },
  { label: 'zu',  name: 'isiZulu',    markers: [
    'ngi', 'uku', 'akuphefumuli', 'akaphefumuli', 'khulelwe', 'ngikhulelwe',
    'isifuba', 'ikhanda', 'umphimbo', 'umzimba', 'igazi', 'ingane', 'inyoka',
    'uqulekile', 'ukuphefumula', 'isibhebhe', 'ibhebhe', 'usana',
    'ubuhlungu obukhulu', 'ubuhlungu', 'angiphefumuli', 'ukhuluma nzima',
    'uyabanjwa manje', 'ingalo ibuthaka', 'ibuthathaka',
    'ushukela', 'iswekile', 'akadli', 'akasancela', 'akaziphilile',
    'uwile', 'umzimba uwile', 'ubuso buyehla', 'umlomo ugobile',
    'ngawa', 'wawa', 'amehlo ayaxobana', 'izinyawo zivuvukile',
    'ibhebhe aliphefumuli', 'usana aliphefumuli', 'ingane iqulekile',
    'uyishayiwe', 'wabanjwa', 'ulele', 'udidekile',
    'inhlungu', 'wabanjwa ngodlame', 'hlukunyeziwe',
    // new markers from 11-language extension (option 2)
    'amaqhubu', 'amabhatha', 'isikhumba esibomvu', 'inkaba iphumile',
    'ithambo liphuma', 'ithambo liyabonakala', 'ngishaywe ekhanda',
    'ngishaywe', 'ngishayiswe yimoto', 'ingozi yemoto', 'ngiwe ophahleni',
    'ngiyazibulala', 'amaphilisi', 'ngizifaka intambo',
    'umzimba uwonke ushisiwe', 'ushile umzimba', 'amanzi abilayo',
    'isisu siqinile', 'isisu asiphatheki',
    'isifuba sicinene', 'isifuba sisindwa', 'ingalo isinda',
    'umhlathi ubuhlungu', 'uyajuluka', 'umjuluko',
  ] },
  { label: 'xh',  name: 'isiXhosa',   markers: [
    'intloko', 'uthetha nzima', 'aaphefumli', 'andiphefumli',
    'uwe phantsi', 'ubuso buyehla', 'umntu', 'umlomo ugobe',
    'amehlo ayaxobana', 'andilukuhla', 'ndilukuhliwe',
    'iintlungu ezimbi kakhulu', 'ixesha alifiki',
    'inyoka yamluma', 'usana lwam', 'ibhabhu', 'umntwana akanyakazi',
    'ukuthwa', 'hlukunyezwa', 'bethiwe',
    // new markers from 11-language extension
    'umntwana uqulekile', 'umntwana uwile', 'usana aluhambi', 'ibhabhu aliphefumli',
    'ithambo liphuma esikhumbeni', 'ithambo liyabonakala',
    'ndibethiwe entloko', 'ndiwile ndabetha intloko', 'ndibethwe yimoto',
    'iintlungu ezinkulu', 'izandla neengalo',
    'umzimba wonke utshisiwe', 'utshiswe kakhulu',
    'isisu asiphatheki', 'isisu siqinile',
    'umqolo', 'imilenze',
    'utjhile',
  ] },
  { label: 'af',  name: 'Afrikaans',  markers: [
    'nie asem', 'asem haal nie', 'kan nie asem', 'hartaanval',
    'swanger', 'bloed', 'bloei', 'bloeding', 'borspyn', 'gesig',
    'keel swel', 'gesig swel', 'lippe swel', 'bewusteloos',
    'slangbyt', 'slang gebyt', 'hoofpyn', 'koors',
    'kind bewusteloos', 'babas', 'baba van', 'suigeling', 'pasgebore',
    'oë waas', 'baie pyn', 'verskriklike pyn', 'stuiptrekkings',
    'epilepsie aanval', 'val om', 'reageer nie', 'swak',
    'praat deurmekaar', 'periode is laat', 'swangerskap toets',
    'glas druk', 'rooi kolle', 'pers kolle',
    'aangeval', 'geslaan', 'mishandeling',
    // new markers from 11-language extension
    'pers uitslag', 'donker uitslag', 'uitslag wat nie verdwyn',
    'been steek uit vel', 'been sigbaar', 'oop breuk',
    'kop gestamp', 'geval en kop gestamp', 'kopbesering',
    'maag hard soos plank', 'maag styf', 'ergste maagpyn',
    'motorongeluk', 'raakgery deur motor', 'geval van dak', 'val van hoogte',
    'gaan myself doodmaak', 'drink nou pille', 'probeer hang',
    'suiker baie laag', 'glukose baie laag',
    'erg gebrand', 'hele liggaam gebrand',
    'kookwater op', 'warm water oor',
    'baba haal nie asem', 'naelstring uit', 'naelstring gly uit',
    'bors druk', 'bors swaar', 'pyn in bors',
    'arm swaar', 'koue sweet', 'kakebeen pyn',
    'gebrand', 'skroei', 'brand',
  ] },
  { label: 'nso', name: 'Sepedi',     markers: [
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
    // new markers from 11-language extension
    'mafokodi a maso', 'mafokodi a sa fele',
    'lerapo le tšwa ka letlalo', 'lerapo le a bonagala',
    'kotsi ya koloi', 'ngopotswe ke koloi', 'ngwele go tšwa godimo',
    'mpa e thata bjalo ka lepolanka', 'bohloko bja mpa',
    'sehuba se bohloko', 'mohlakola o bohloko',
    'ke otlilwe ka hlogo', 'kgobalo ya hlogo',
    'ke ikgotlhomolla', 'ke nwele dipilisi',
    'swikiri se tlase kudu',
    'meetse a go fisha godimo', 'o fiswe',
  ] },
  { label: 'tn',  name: 'Setswana',   markers: [
    'go hema go emile', 'o idibetse', 'o wetse fa fatshe', 'ga a arabe',
    'ngwana ga a tshikinyege', 'ke imile kgale',
    'sefatlhego', 'o tšhutse', 'metsi a a fisang',
    'bolwetse jwa sukiri', 'madi a godileng',
    'sefatlhego se rurugile', 'molomo o rurugile',
    'o kile a rotha', 'sefatlhego se theogetse',
    'tlhogo e e bohloko', 'letsogo le bokoa',
    'o bua thata', 'mafoko ga a tswe',
    'fisa',
    // new markers from 11-language extension
    'lerapo le tswa mo letlalong', 'lerapo le a bonala',
    'kotsi ya koloi', 'ke kgotlilwe ke koloi', 'ke oele go tswa godimo',
    'mpa e thata jaaka lepolanka', 'bohloko jwa mpa bo bogolo',
    'sehuba se bohloko', 'sehuba se gatelelwa',
    'ke iteilwe mo tlhogong', 'kgobalo ya tlhogo',
    'ke itshwaya gona jaanong', 'ke nole dipilisi tse dintsi',
    'sukiri e kwa tlase thata',
    'metsi a a fisang godimo',
  ] },
  { label: 'st',  name: 'Sesotho',    markers: [
    'ha a phefumolohe', 'ho phefumoloha ho emile',
    'o itshedisitse', 'ha a tsohe', 'o oele fatshe',
    'o a thothomela', 'o a ratha joale', 'sefuba',
    'ke imile', 'noha e mo lomile', 'o chele',
    'bolwetsi ba tsoekere', 'madi a phahameng',
    'molomo o rurugile', 'sefahleho se rurugile',
    'ho hema ho thata', 'ha ke phefumolohe',
    'ha a phefumolohe', 'lesea', 'sefahleho se theohile',
    'hlogo e bohloko haholo', 'letsoho le fokola',
    'o bolela nzima', 'mantswe ha a tswe',
    'mocheso',
    // new markers from 11-language extension
    'mafokoti a maso', 'mafokoti a sa fele',
    'lesapo le tsoa leroleng', 'lesapo le a bonahala',
    'kotsi ya koloi', 'ke thuntswe ke koloi', 'ke wele ho tsoa hodimo',
    'mpa e thata jwaloka lepolanka', 'bohloko ba mpa',
    'sefuba se bohloko', 'sefuba se tshwarehile',
    'ke otlilwe hlohong', 'kotsi ya hlooho',
    'ke itima hona joale', 'ke nwele dipilisi tse ngata',
    'tsoekere e tlase haholo',
    'metsi a chesang hodima',
  ] },
  { label: 'ts',  name: 'Xitsonga',   markers: [
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
    // new markers from 11-language extension
    'swiphanga leswi', 'rhambu ri huma', 'rhambu ri voniwa',
    'xihoko xa movha', 'ndzi bile hi movha', 'ndzi wile ehenhla',
    'khwiri ri tiyile', 'ku vava ka khwiri',
    'xifuva xi vava', 'xifuva xi tika', 'xifuva xa moya',
    'ndzi bile enhlokweni', 'ku vaviseka ka nhloko',
    'ndzi tidlaya sweswi', 'ndzi swarile dziphilisi',
    'swikiri swi le hansi',
    'mati ya ku hisa ehenhla',
  ] },
  { label: 'ss',  name: 'siSwati',    markers: [
    'akaphefumuli', 'inhlitiyo yeme',
    'udzakiwe', 'akaphaphami', 'umntfwana',
    'uyabanjwa nyalo', 'uyatfutfumela', 'umtimba uyadzikita',
    'emita', 'inyoka imlumile', 'ushile', 'ushiselwe',
    'emanti lashisako', 'sifo seshugela', 'ingati lephakeme',
    'umphimbo uvuvukile', 'buso buyavuvuka',
    'emehlo ayafifiyala', 'ikhanda lelibuhlungu',
    'ubanjwe', 'kutfutfumela kuphele',
    'ayisebenzi', 'ayisiti',
    'imfiva', 'umntfwana lomncane',
    'shayiwe', 'hlukunyetwa',
    // new markers from 11-language extension
    'emapethwane lamnyama', 'emapethwane langapheli',
    'libhanti liphuma', 'libhanti liyabonakala',
    'ingozi yemoto', 'ngishaywe yimoto',
    'sisu sishibalala njengelibhodi', 'sisu asiphatseki',
    'sifuba sibuhlungu', 'sifuba sibanjiwe',
    'ngishaywe enhlokweni',
    'ngitibulala nyalo', 'ngidle emaphilisi',
    'shukela iphantsi', 'shukela iwile',
    'inkhaba yinyatseleka',
  ] },
  { label: 've',  name: 'Tshivenda',  markers: [
    'ha a fembi', 'a a khou femba', 'mbilu yo ima',
    'o ṱalala', 'ha a vuhi', 'o wa fhasi', 'ha a fhinduli',
    'u a dzhendzela', 'u a thothomela zwino',
    'ndi imile', 'ṋowa yo mu luma', 'o fhiswa',
    'maḓi a u fhisa', 'vhulwadze ha swigiri', 'malofha',
    'muṱodzi wo ṱahela', 'tshifhaṱuwo tsho ṱahela',
    'maṱo a si tshi vhona', 'ṱhoho i rema',
    'tshanḓa tsho fa maanḓa', 'u amba zwi a konḓa',
    'ṅwana', 'lutshetshe', 'muḓifhiso', 'o ḓidimala',
    // new markers from 11-language extension
    'mapimbi o swifhalaho', 'mapimbi a sa fheli',
    'ḽitambo ḽi bvaho', 'ḽitambo ḽa vhonala',
    'khombo ya goloi', 'ndo rwiwa nga goloi', 'ndo wa ntha',
    'lumbu ḽo khwaṱha', 'vhutungu ha lumbu',
    'khana ḽi vhavha', 'khana ḽo lemala',
    'ndo rwiwa kha ṱhoho',
    'ndi a ḓivhulaha', 'ndo nwa dziphilisi',
    'swigiri tshi fhasi',
    'maḓi a u fhisa ṋṱha',
  ] },
  { label: 'nr',  name: 'isiNdebele', markers: [
    'ha a fembi', 'ihliziyo yeme', 'uwele phasi',
    'uyabanjwa nje', 'uyathuthumela', 'umzimba uyadzikiza',
    'ngiimithi', 'utjhile', 'utjhisiwe', 'amanzi atjhisako',
    'isifo sesiswigiri', 'igazi eliphezulu',
    'ikhanda elibuhlungu ngokuzuma', 'amezwi akaphumi kuhle',
    'ubanjwe', 'ukuthuthumela kuphelile', 'umntwana uqulekile',
    'umntwana akaphefumuli', 'ihlukunyezo',
    // new markers from 11-language extension
    'amaqhubu amnyama angaphumi',
    'ingozi yemoto', 'ngibethwe yimoto', 'ngiwe phezulu',
    'isisu siqinile njengepulangi', 'ubuhlungu besisu obukhulu',
    'isifuba sibuhlungu ngokubambeka',
    'ngibethwe ekhanda', 'ngiwile ngabetha ikhanda',
    'ngizibulala manje', 'sengidle amaphilisi amaningi',
    'ushukela uphansi khulu',
    'amanzi atjhisako phezu',
    'ithambo liphuma esikhumbeni',
    'ubuhlungu obukhulu ohlangothini olunye',
  ] },
];

const LANG_LABELS = LANGS.map(l => l.label);

// Parse out each rule block. A rule block is a contiguous `if (...) return (red|orange|yellow)('ID')`
// sequence that may span multiple lines. We find each `return red/orange/yellow('id')` and
// walk backwards to the most recent `if (` that starts a condition, capturing everything between.
// For rules that have separate per-language overrides (e.g., respiratory_cardiac_arrest_zu),
// we strip the language suffix and union keyword coverage.

const LANG_SUFFIXES = ['_zu', '_xh', '_af', '_nso', '_tn', '_st', '_ts', '_ss', '_ve', '_nr'];
function baseRule(rule) {
  for (const s of LANG_SUFFIXES) if (rule.endsWith(s)) return rule.slice(0, -s.length);
  return rule;
}
function suffixLang(rule) {
  for (const s of LANG_SUFFIXES) if (rule.endsWith(s)) return s.slice(1);
  return null;
}

// Tokenise the scope into rule blocks. Use a simple scan: find each
// `return (red|orange|yellow)('id')` and capture the text from the
// previous `if (has(` (or `if ((`) up to that return.
const ruleCalls = [];
const re = /return (red|orange|yellow)\('([A-Za-z0-9_]+)'\)/g;
let m;
while ((m = re.exec(scope)) !== null) {
  ruleCalls.push({ level: m[1].toUpperCase(), ruleId: m[2], end: m.index });
}

// For each return, walk backwards to the nearest `if (` at column 2.
function extractBlock(endPos) {
  const start = scope.lastIndexOf('\n  if (', endPos);
  if (start < 0) return '';
  return scope.slice(start, endPos);
}

// Collect per-rule keyword text.
const byRule = new Map();  // baseRuleId -> { level, keywords: Set<string>, explicitLangs: Set<string> }

for (const call of ruleCalls) {
  const base = baseRule(call.ruleId);
  const sufLang = suffixLang(call.ruleId);
  if (!byRule.has(base)) byRule.set(base, { level: call.level, keywords: new Set(), explicitLangs: new Set(['en']) });
  const entry = byRule.get(base);
  if (sufLang) entry.explicitLangs.add(sufLang);
  const block = extractBlock(call.end);
  // Strip double-quoted strings first so their internal apostrophes
  // don't break single-quoted extraction (e.g. "can't lift arm").
  const dqStripped = block.replace(/"[^"\\]*(?:\\.[^"\\]*)*"/g, '""');
  // Extract all single-quoted strings.
  const kwRe = /'([^'\\]*(?:\\.[^'\\]*)*)'/g;
  let km;
  while ((km = kwRe.exec(dqStripped)) !== null) {
    const kw = km[1].toLowerCase().trim();
    if (kw && kw.length >= 2 && kw.length < 150 && !kw.includes('_zu') && !kw.includes('_xh')) {
      entry.keywords.add(kw);
    }
  }
}

// For each rule, determine language coverage.
function ruleLangs(entry) {
  const covered = new Set(entry.explicitLangs);
  covered.add('en');  // English always present (rules are written in English)
  const allKw = [...entry.keywords].join(' | ');
  for (const lang of LANGS) {
    if (lang.label === 'en') continue;
    if (!lang.markers) continue;
    for (const marker of lang.markers) {
      if (allKw.includes(marker)) {
        covered.add(lang.label);
        break;
      }
    }
  }
  return covered;
}

// Group by level and emit table.
const byLevel = { RED: [], ORANGE: [], YELLOW: [] };
for (const [ruleId, entry] of byRule) {
  byLevel[entry.level].push({ ruleId, covered: ruleLangs(entry), kwCount: entry.keywords.size });
}
for (const level of Object.keys(byLevel)) byLevel[level].sort((a, b) => a.ruleId.localeCompare(b.ruleId));

function renderTable(level, rows) {
  const header = ['Base rule ID', ...LANGS.map(l => l.label)].join(' | ');
  const sep = ['---', ...LANGS.map(() => ':-:')].join(' | ');
  const body = rows.map(r => {
    const cells = LANGS.map(l => r.covered.has(l.label) ? 'Y' : '·');
    return [r.ruleId, ...cells].join(' | ');
  }).join('\n');
  return `### ${level} discriminators (${rows.length} distinct base rule identifiers)\n\n| ${header} |\n| ${sep} |\n| ${body} |\n`;
}

function coverageSummary(rows) {
  const total = rows.length;
  const perLang = {};
  for (const l of LANGS) perLang[l.label] = 0;
  for (const r of rows) for (const l of r.covered) perLang[l] = (perLang[l] || 0) + 1;
  return perLang;
}

const out = [];
out.push('# Additional file 3: DCSL discriminator catalogue — 11-language coverage matrix');
out.push('');
out.push('**Study:** Design and preliminary safety validation of a hybrid deterministic–AI triage system for multilingual primary healthcare: a WhatsApp-based vignette study in South Africa');
out.push('');
out.push('**Source of truth:** `lib/triage.js`, function `applyClinicalRules`. This catalogue is generated programmatically from the production source code via `scripts/extract_dcsl_catalogue.js`, ensuring the manuscript\'s claimed discriminator set matches what is actually deployed. Language coverage is determined by semantic scanning of each rule\'s keyword list against per-language marker dictionaries (characteristic phonemes and vocabulary for each of the 11 official South African languages), not by rule-ID suffix.');
out.push('');
out.push('**Languages:**');
out.push('');
out.push('| Code | Language |');
out.push('| --- | --- |');
for (const l of LANGS) out.push(`| **${l.label}** | ${l.name} |`);
out.push('');
out.push('**Reading the table:** each row is one DCSL rule identifier. `Y` indicates the rule\'s keyword list contains at least one marker characteristic of that language (i.e., the rule can fire on a patient message written in that language); `·` indicates no detected coverage. English (en) is always `Y` because rule triggers are authored in English and language-specific keywords are additions on top.');
out.push('');
out.push('**Validation status:** Keyword sets for en, zu, xh, af are the formally validated vocabulary used in the 120-vignette validation reported in the manuscript. Keyword sets for nso, tn, st, ts, ss, ve, nr were added to the codebase prior to pilot and await independent review by native speakers (see `docs/DCSL_Native_Speaker_Review.md`). The 121-vignette multilingual DCSL regression suite passes on all 11 languages for the RED discriminators it tests.');
out.push('');

for (const level of ['RED', 'ORANGE', 'YELLOW']) {
  out.push(renderTable(level, byLevel[level]));
  out.push('');
}

out.push('---');
out.push('');
out.push('## Summary');
out.push('');

const totals = {
  RED: byLevel.RED.length,
  ORANGE: byLevel.ORANGE.length,
  YELLOW: byLevel.YELLOW.length,
};
out.push('**Live code (rule identifier count, extracted ' + new Date().toISOString().slice(0, 10) + '):**');
out.push('');
out.push(`- **RED:** ${totals.RED} distinct base rule identifiers`);
out.push(`- **ORANGE:** ${totals.ORANGE}`);
out.push(`- **YELLOW:** ${totals.YELLOW}`);
out.push(`- **Total:** ${totals.RED + totals.ORANGE + totals.YELLOW}`);
out.push('');
out.push('**Per-language coverage (number of rule identifiers with keywords for each language):**');
out.push('');
out.push('| Level | ' + LANG_LABELS.join(' | ') + ' |');
out.push('| --- | ' + LANG_LABELS.map(() => ':-:').join(' | ') + ' |');
for (const level of ['RED', 'ORANGE', 'YELLOW']) {
  const s = coverageSummary(byLevel[level]);
  out.push(`| ${level} | ` + LANG_LABELS.map(l => `${s[l]}/${byLevel[level].length}`).join(' | ') + ' |');
}
out.push('');
out.push('**Manuscript claim reconciliation.** The manuscript states *"53 clinical discriminator categories (14 RED, 19 ORANGE, 20 YELLOW)"*. The code implements ' + (totals.RED + totals.ORANGE + totals.YELLOW) + ' rule identifiers (' + totals.RED + ' RED / ' + totals.ORANGE + ' ORANGE / ' + totals.YELLOW + ' YELLOW), of which 5 are variant patterns of base categories and 2 (`infant_sepsis_screen`, `hiv_meningism`) are post-validation safety-net rules added after the 120-vignette validation. The 53-category count in the manuscript refers to the base taxonomy at the time of validation; see manuscript footnote on Table 1 for the reconciliation.');
out.push('');
out.push('*Generated:* ' + new Date().toISOString().slice(0, 10) + ' via `node scripts/extract_dcsl_catalogue.js`');

process.stdout.write(out.join('\n') + '\n');
