# Bizusizo — Development Guidelines

## What this is
AI-powered clinical triage tool for South African primary healthcare clinics.
Runs on WhatsApp (via Meta Cloud API) + Node.js/Express + Supabase + Anthropic Claude.

## Compliance Rules (POPIA / SA AI Policy)
- NEVER log patient names, phone numbers, or ID numbers in plain text to console or external services
- ALWAYS strip PII before sending text to Anthropic API (use stripPII in lib/triage.js)
- Patient data stays in Supabase only — never write patient info to local files
- All triage decisions must be logged to triage_logs with audit trail (governance metadata)
- Do not store Anthropic API responses containing patient symptom text

## Clinical Safety Rules
- Under-triage is more dangerous than over-triage — when in doubt, upgrade one level
- RED triage must ALWAYS trigger immediate emergency messaging — never downgrade RED
- AI triage is a recommendation, not a diagnosis — messaging must reflect this
- The rules engine (applyClinicalRules) takes precedence over AI output
- Never remove or weaken discriminator rules without clinical review

## Architecture
- index.js: main server (routes, webhook handler, orchestration, dashboard)
- governance.js: Four-Pillar governance framework (invoked from every triage call via orchestrate; integrated with risk-upgrade, audit logging, rate limits)
- logger.js: Pino logging wrapper used across the codebase
- lib/triage.js: AI triage + SATS rules engine + self-care advice
- lib/facilities.js: facility routing
- lib/session.js: patient session management + triage logging
- lib/whatsapp.js: Meta WhatsApp API wrapper
- lib/messages.js: 11-language message templates
- lib/followup.js: post-triage follow-up system
- lib/outbreak.js: syndromic outbreak surveillance (NICD/NMC aligned)
- lib/sms.js: SMS gateway (Clickatell/Africa's Talking/BulkSMS) for offline health passport
- routes/governance.js: governance dashboard API endpoints
- routes/fhir.js: FHIR R4 endpoints + health passport
- routes/clinical.js: clinical API endpoints
- routes/reports.js: report exports (concordance, consent, referrals)
- routes/queue.js: clinic queue, kiosk, pre-arrival routes

## Standards
- Target HL7 FHIR compatibility for future interoperability
- Use WHO ICD-11 codes where applicable
- All 11 SA official languages must be supported in patient-facing messages
