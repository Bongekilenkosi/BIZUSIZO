# Security policy

BIZUSIZO is a clinical triage system serving real patients in primary healthcare settings. Security concerns are treated as clinical safety concerns.

## Reporting a vulnerability

**Do not open a public issue.** Email **bongekilenkosi@berkeley.edu** with:

- The class of vulnerability (de-escalation bypass, prompt injection, authentication, data exposure, other)
- A minimal reproduction (messages sent, expected vs observed classification, any test harness details)
- Your name / affiliation and whether you consent to attribution in a post-fix advisory

Acknowledgement target: 48 hours. Initial triage target: 5 working days. We will not pursue legal action against good-faith researchers who follow this process.

## Scope

**In scope:**

- Triage-classification correctness — inputs that produce clinically incorrect outputs (under-triage, over-triage, parse failures) that a reasonable clinician would judge unsafe
- Deterministic Clinical Safety Layer (DCSL) bypass — messages that describe life-threatening presentations but do not trigger RED/ORANGE discriminators
- Prompt-injection vulnerabilities affecting triage classification
- Authentication, session management, and role-based access control on the clinician dashboard
- Patient-identifying information (PII) leakage in logs, API responses, or model outputs
- POPIA compliance defects (consent trail, audit log completeness, cross-border data transfer)

**Out of scope:**

- Denial of service via flooding (use platform rate limits to reproduce)
- Attacks that require physical access to a clinic device
- Social engineering of clinic staff
- Vulnerabilities in unsupported third-party dependencies already flagged for upgrade
- The published methodology repository ([safe-eval-methodology](https://github.com/Bongekilenkosi/safe-eval-methodology)) — that is a reproducibility snapshot, not a deployment artefact; see [NOTICE](NOTICE)

## Known attack classes — documented for transparency

These attack classes are known to the maintainers and are mitigated by the DCSL + governance architecture. Reports demonstrating new instances within these classes are still welcome; reports demonstrating that the mitigations have failed are prioritised.

1. **Structured-output internal inconsistency.** An LLM can emit adjacent JSON fields that mutually contradict each other on valid-JSON runs. Documented in Nkosi-Mjadu & Plaatjie (2026). Mitigation: DCSL overrides the LLM classification when a discriminator fires; governance alerts on nurse-disagreement drift surface residual inconsistency; coherence audits run on a rolling sample of production outputs.

2. **DCSL keyword coverage gaps.** Rule-firing is sensitive to specific keyword phrasings. A hedged formulation (e.g., *"a bit stiff"* for neck stiffness) may not trigger a rule that fires on *"stiff neck"*. Mitigation: ongoing keyword expansion via monthly audits; native-speaker review programme for non-English keyword sets; pre-submission probe methodology (see the methodology paper).

3. **De-escalation by coercive third party.** A coercive partner or caregiver could craft messages that conceal emergency signals, routing a dependent patient to GREEN/self-care when ORANGE/RED is clinically warranted. Mitigation: the P06 (GBV disguised) persona in the evaluation harness tests for this class; the governance layer upgrades triage based on risk factors independently of patient self-report; nurse-review flags every YELLOW+ presentation for facility-level review.

4. **Parse-salvage fallback.** When the LLM returns malformed JSON, the harness extracts a triage level by string-matching RED/ORANGE/YELLOW tokens in the raw text. A classification produced this path is indistinguishable at the top line from a validated one. Mitigation: `reasoning` field audit pre-analysis; `parse_failure_default` and `text_parse_fallback` labels logged; governance alert fires on elevated fallback rate per model per cell.

5. **Prompt injection.** An attacker-crafted message could contain instructions that override the system prompt. Mitigation: the DCSL operates on raw patient text independently of any LLM; rule-specified triage levels override LLM output at pipeline output where rule coverage holds.

## Responsible disclosure and publication

We publish a post-fix advisory for accepted reports after deployment of the fix, including credit to the reporter (with permission). Fixes that constitute a clinical-safety material change are also reported to the clinical governance lead and, where applicable, to the Department of Health district lead for the affected pilot sites.

## Contact

bongekilenkosi@berkeley.edu

Principal maintainer: Bongekile Esther Nkosi-Mjadu
Clinical governance lead: Sheila Plaatjie RN BBA
