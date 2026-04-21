# Correction notice — BIZUSIZO Validation Document v2.0 (March 2026)

**Document affected:** *BIZUSIZO AI Triage Validation Results — 120-Vignette Preliminary Safety Assessment | Four South African Languages | March 2026 | Version 2.0* (file `BIZUSIZO_Vignette_Validation_Results .pdf`, mtime 31 March 2026 01:00).

**Status:** Correction identified 2026-04-20 during medRxiv resubmission preparation. Superseded by `docs/march2026_validation_correction.md`, which is the canonical in-repo record of the full data-provenance correction. This file is retained as a scoped corrigendum to the external PDF and cross-references the canonical note.

**Previous version of this file:** before 2026-04-20, this document incorrectly attributed the PDF's headline numbers (2.5% / 79.2% / κ=0.889) to an 8 April Haiku post-DCSL-fix re-run. That attribution was wrong. The correct provenance is documented below and in the canonical correction note.

---

## 1. What was wrong in the Validation Document v2.0 PDF

Section 4 (Safety Interpretation), under the *"Under-triage (2.5%, 3/120)"* heading, the PDF stated:

> *The three under-triage cases were: V041 (isiZulu — head trauma with LOC, classified YELLOW), V072 (isiXhosa — significant burns, **classified GREEN**), and V103 (Afrikaans — acute confusion with diabetes, classified YELLOW).*

Two errors in this narrative:

1. **V042 omitted from the under-triage list.** The preserved 30 March 2026 raw Haiku run (`vignette_results_Mar2026` / `vignette_export.json`) shows V041, V042, V103 as the three under-triage cases among the 115 successfully scored vignettes. V042 (isiZulu — hot water scald to hands, ORANGE classified YELLOW) was an under-triage case and is absent from the PDF's narrative.
2. **V072 identified and labelled incorrectly.** V072 was a parse error in the preserved 30 March raw run, not a classified case. The PDF's identification of V072 as an under-triage case "classified GREEN" cannot be reconciled to the preserved 30 March data. It is a write-up error in the PDF narrative, not a reflection of what the preserved data shows.

## 2. Provenance of the Validation Document v2.0 headline numbers

The PDF's headline totals (2.5% under-triage / 79.2% concordance / κ=0.889) were produced on 30–31 March 2026 by the author (BN) retrying the five parse-error cases (V050, V065, V070, V072, V073) after the 30 March 23:52 Haiku run, and combining those retry outputs with the 115 successfully scored cases to produce 95/22/3/0 totals. **The retry output was not saved to disk as a dated JSON file.** The PDF's totals therefore cannot be independently reproduced from any preserved data file.

The full data-provenance record is in `docs/march2026_validation_correction.md` (this repository; corresponds to Additional file 4 in the manuscript submission package). That note describes the retry, the arithmetic reconciliation, and the reason the manuscript now reports 1 April 2026 re-run numbers (`vignette_results_Apr2026.json`) rather than the 31 March PDF's figures.

## 3. What this means for the external Validation Document v2.0 PDF

The 31 March 2026 PDF should be treated as **a point-in-time development artefact** that predates the preserved 1 April Haiku re-run. It is not the source of the numbers now reported in the manuscript.

- **Do not re-issue the PDF as Version 2.1** with a minor transcription fix. The underlying data-provenance problem (unpreserved retry output) is more fundamental than a per-case label typo, and the cleanest path is to retire the PDF rather than incrementally patch it.
- **Superseded by:** `vignette_results_Apr2026.json` (1 April 2026 Haiku re-run, 120/120 scored, zero parse errors) as the preserved validation dataset, and `docs/march2026_validation_correction.md` as the provenance record.
- **If the PDF remains in circulation externally** (e.g., as an attachment to the 1 April 2026 EVAH submission), readers should be directed to the superseding records. An errata slip referencing `docs/march2026_validation_correction.md` can accompany any further circulation of the v2.0 PDF.

## 4. What this correction does NOT do

- Does not alter anything in the preserved 1 April Haiku re-run (`vignette_results_Apr2026.json`) or the manuscript's corrected headline numbers (3.3% under-triage, 80.0% concordance, κ=0.891) drawn from that file.
- Does not introduce Sonnet 4 numbers into the validation reporting. Sonnet 4 remains disclosed in the manuscript as the post-validation production classifier, not as an independently validated alternative to Haiku 4.5.
- Does not re-open scope on the vignette set, the gold-standard assignments, or the SP blinded ratings. Those remain as they were at validation time.

## 5. Cross-references

- Canonical correction note: [`docs/march2026_validation_correction.md`](./march2026_validation_correction.md) — primary in-repo data-provenance record; corresponds to Additional file 4 of the manuscript submission.
- Preserved 30 March raw run: `vignette_export.json` (in-repo) / `vignette_results_Mar2026` (in `Stress Testing/`) — 115/120 scored, 5 parse errors.
- Preserved 1 April re-run (primary validation dataset for the manuscript): `vignette_results_Apr2026.json`.
- Preserved 2 April Sonnet 4 post-validation configuration run: `vignette_results_Sonnet_Apr2026.json`.
- Supplementary Table S1 (rebuilt from 1 April Haiku re-run): `docs/supplementary_s1_vignettes.{csv,md}`.
