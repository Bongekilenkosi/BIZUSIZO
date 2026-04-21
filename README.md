# BIZUSIZO

**Hybrid deterministic–AI triage system for South African primary healthcare, delivered via WhatsApp and aligned to the South African Triage Scale (SATS).**

This repository contains the code, validation data, and scientific artefacts supporting the preliminary safety validation of BIZUSIZO. It accompanies the preprint under revision at medRxiv (MS ID 349781) and is intended for reviewers, replicators, and researchers working on clinical AI for low- and middle-income country primary healthcare.

---

## What BIZUSIZO is

A WhatsApp-delivered pre-arrival triage tool that combines:

- **AI-assisted classification** (Anthropic Claude) for free-text symptom descriptions in any of South Africa's 11 official languages.
- **A Deterministic Clinical Safety Layer (DCSL)** — a rule-based engine that overrides AI output for 53 clinical discriminator categories (14 RED life-threatening, 19 ORANGE very-urgent, 20 YELLOW urgent). The DCSL runs independent of AI availability and catches coded emergency presentations even when the AI service is down.
- **Continuous integration as clinical safety infrastructure** — a 121-vignette multilingual regression test runs on every deployment and blocks release on any safety failure.

The design premise is that AI safety in resource-constrained primary healthcare is best treated as a systems-engineering problem (layered deterministic constraints, multi-agent verification, continuous monitoring) rather than a model-accuracy problem.

---

## Repository layout

### Paper artefacts (`docs/`)

| File | Description |
|---|---|
| [`docs/manuscript_complete_17apr2026.md`](docs/manuscript_complete_17apr2026.md) | Main manuscript |
| [`docs/supplementary_s1_vignettes.csv`](docs/supplementary_s1_vignettes.csv) / [`.md`](docs/supplementary_s1_vignettes.md) | Additional file 1 — 120-vignette validation dataset with per-row AI classifications and outcomes |
| [`docs/additional_file_2_decide_ai_checklist.md`](docs/additional_file_2_decide_ai_checklist.md) | Additional file 2 — DECIDE-AI reporting checklist (Vasey et al., BMJ 2022) |
| [`docs/additional_file_3_dcsl_catalogue.md`](docs/additional_file_3_dcsl_catalogue.md) | Additional file 3 — full DCSL 11-language coverage matrix, generated from source code |
| [`docs/march2026_validation_correction.md`](docs/march2026_validation_correction.md) | Additional file 4 — data-provenance correction record reconciling the 31 March 2026 validation document to the preserved 1 April Haiku re-run |
| [`docs/validation_document_v072_correction.md`](docs/validation_document_v072_correction.md) | Corrigendum to the 31 March 2026 external validation PDF |
| [`docs/vignette_english_translations.json`](docs/vignette_english_translations.json) | English translations for non-English vignettes (supports S1) |
| [`docs/review_packets/`](docs/review_packets) | Per-language native-speaker review packets (one per non-English language) |

### Primary validation data

| File | Description |
|---|---|
| [`vignette_export.json`](vignette_export.json) | Raw Claude Haiku 4.5 run, 30 March 2026 — 115/120 scored, 5 parse errors |
| [`vignette_results_Apr2026.json`](vignette_results_Apr2026.json) | **Primary validation dataset** — Haiku 4.5 re-run, 1 April 2026, 120/120 scored |
| [`vignette_results_Sonnet_Apr2026.json`](vignette_results_Sonnet_Apr2026.json) | Claude Sonnet 4 post-validation production run, 2 April 2026 — disclosed in manuscript as post-validation production configuration, not as independently validated |
| [`framing_sensitivity_results.json`](framing_sensitivity_results.json) / [`framing_pipeline_comparison.json`](framing_pipeline_comparison.json) | 220-call framing sensitivity evaluation (110 paired vignettes) — AI-only and full-pipeline conditions |

### Code

| Path | Description |
|---|---|
| `index.js` | Main Express server: WhatsApp webhook, orchestration, governance pillars |
| `lib/triage.js` | DCSL rules engine (`applyClinicalRules`) + SATS-aligned AI prompt + self-care advice |
| `lib/messages.js` | All 11-language patient-facing WhatsApp message templates |
| `lib/session.js` / `lib/followup.js` / `lib/outbreak.js` / `lib/facilities.js` / `lib/whatsapp.js` / `lib/sms.js` | Supporting modules (session state, 24/72h follow-up, NICD-aligned outbreak surveillance, facility routing, Meta WhatsApp API, SMS gateway) |
| `routes/` | REST endpoints (FHIR, clinic, governance, reports, queue) |
| `public/` | Clinic dashboard, kiosk, doctor-referral lookup |
| `governance.js` / `governance-dashboard.jsx` | Four-pillar governance framework + ops dashboard |
| `scripts/` | Build/analysis scripts: DCSL catalogue extractor, April-1 metrics computation, S1 builder, review-packet generator, kappa computation |
| `*.sql` | Supabase schema migrations |

### Tests

| File | Purpose |
|---|---|
| `test_dcsl.js` | DCSL regression suite — 186 test cases across 11 official SA languages. CI-pipeline deployment gate. Runs offline in <1 s. |
| `test_load.js` | Load test — verifies server handles concurrent requests. |
| `framing_sensitivity_test.js` / `framing_pipeline_comparison.js` | 220-call framing sensitivity evaluation harness (requires Anthropic API key). |
| `run_vignettes.js` / `run_vignettes_sonnet.js` | 120-vignette validation run (Haiku / Sonnet). Requires Anthropic API key. |

---

## Reproducing the validation

### Prerequisites

```bash
npm install
cp env.example .env
# Add your ANTHROPIC_API_KEY, Supabase keys, WhatsApp tokens
```

### Run the offline DCSL regression suite (<1 s, no API calls)

```bash
node test_dcsl.js
# Expected: 186/186 passing across en, zu, xh, af, nso, tn, st, ts, ss, ve, nr
```

### Regenerate the 120-vignette validation (requires Anthropic API key, ~$0.50)

```bash
node run_vignettes.js
# Outputs vignette_results.json
# Expected Haiku 4.5 outcomes match docs/supplementary_s1_vignettes.csv
```

### Regenerate validation metrics (under-triage, over-triage, concordance, weighted κ)

```bash
node scripts/compute_apr1_metrics.js
# Reads vignette_results_Apr2026.json
# Prints headline numbers, Clopper-Pearson CIs, per-level breakdown, per-language κ
```

### Regenerate the DCSL catalogue (Additional file 3) from source

```bash
node scripts/extract_dcsl_catalogue.js > docs/additional_file_3_dcsl_catalogue.md
# Pulls every rule from lib/triage.js and emits 11-language coverage matrix
```

---

## Native-speaker review (in progress)

A live per-language review is open for linguistic review of patient-facing messages and DCSL keywords in all 11 official South African languages:

**[bizusizolanguagereview.netlify.app](https://bizusizolanguagereview.netlify.app/)**

The same content (generated from this repository's source code) is also available as static packets in [`docs/review_packets/`](docs/review_packets) — one file per non-English language.

Native-speaker review for Sepedi, Setswana, Sesotho, Xitsonga, siSwati, Tshivenda, and isiNdebele is a named pre-pilot gate; corrections are applied to `lib/messages.js` and `lib/triage.js` as reviewer responses are returned.

---

## Citation

Once the medRxiv preprint posts:

> Nkosi-Mjadu BE. Design and preliminary safety validation of a hybrid deterministic–AI triage system for multilingual primary healthcare: a WhatsApp-based vignette study in South Africa. *medRxiv* 2026. MS ID 349781.

Until the DOI lands, cite as:

> Nkosi-Mjadu BE. BIZUSIZO. GitHub 2026. https://github.com/Bongekilenkosi/BIZUSIZO

---

## Ethics and data provenance

- The 120-vignette validation uses fictional clinical scenarios written in patient-register WhatsApp language across four South African languages; **no human participants and no identifiable patient data**. Under the South African Department of Health *Ethics in Health Research* guidelines (2015), vignette-only research of this kind falls outside mandatory Research Ethics Committee review.
- The planned prospective patient pilot at Eersterus Community Health Centre, Skinner Clinic, and Soshanguve Community Health Centre (Tshwane district) will be submitted to the University of the Witwatersrand Human Research Ethics Committee (Medical) before any patient data is collected. District-level operational approval was granted by Tshwane District Health Services on 15 April 2026.
- The data-provenance correction record at [`docs/march2026_validation_correction.md`](docs/march2026_validation_correction.md) explains the reconciliation between the initial 31 March 2026 validation document and the preserved 1 April Haiku re-run that is the primary validation dataset reported in the manuscript.

---

## Author

**Bongekile Esther Nkosi-Mjadu, MPH**
Founder and Lead Developer, BIZUSIZO
Independent Researcher, Johannesburg, South Africa
[bongekilenkosi@berkeley.edu](mailto:bongekilenkosi@berkeley.edu) · ORCID: [0009-0009-8567-551X](https://orcid.org/0009-0009-8567-551X) · [bizusizo.co.za](https://bizusizo.co.za)

---

## License

Apache License 2.0 — see [LICENSE](LICENSE). Permissive for code and documentation; any derivative deployment must preserve attribution and the clinical-safety caveats described in the manuscript.

---

## Acknowledgements

- **SP**, Clinical Governance Lead (registered nurse), for blinded independent gold-standard verification.
- Native-speaker reviewers in the 11 official South African languages (listed on publication once the review closes).
- The Tshwane District Health Services team who reviewed and approved the pilot implementation (M. Makhudu, R. Kanama, K. Moloto, L. Moru, Dr M. Shabangu).
