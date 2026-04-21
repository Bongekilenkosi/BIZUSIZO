'use strict';
// Syndromic outbreak surveillance — interval-driven, no conversation coupling.
// Monitors triage_logs for cluster signals (ILI, GI, meningitis etc) against
// NICD/DoH thresholds. Fires governance alerts when clusters are detected.
// setInterval/setTimeout calls stay in index.js.
const logger = require('../logger');
const { sendWhatsAppMessage } = require('./whatsapp');

let _supabase = null;
function init(supabase) { _supabase = supabase; }

const OUTBREAK_SYNDROMES = [
  {
    id: 'ILI',
    name: 'Influenza-Like Illness',
    nicd_programme: 'ILI-PHC Surveillance Programme',
    // BIZUSIZO category mapping: Fever/Flu/Cough (5), Breathing/Chest (1)
    trigger_categories: ['5', '1'],
    // Symptom keywords that confirm ILI (fever + cough / respiratory)
    confirm_keywords: [
      'fever', 'temperature', 'hot body', 'feverish', 'high temperature',
      'cough', 'coughing', 'flu', 'influenza', 'sore throat', 'runny nose',
      // isiZulu
      'umkhuhlane', 'ukukhwehlela', 'imfiva',
      // isiXhosa
      'umkhuhlane', 'ukukhohlela', 'umkhuhlane',
      // Afrikaans
      'koors', 'hoes', 'griep',
      // Sesotho/Setswana
      'mogote', 'mathamo', 'phoholo',
    ],
    // Minimum triage level to count as a case (GREEN excluded — too mild)
    min_triage_level: 'YELLOW',
    // Rolling window in hours
    window_hours: 72,
    // Count thresholds per facility
    thresholds: { WATCH: 3, WARNING: 5, ALERT: 8 },
    // Seasonal — April through October in South Africa
    seasonal_months: [4, 5, 6, 7, 8, 9, 10],
    nmc_category: null, // Not NMC — syndromic signal only
    nmc_immediate: false,
    rationale: 'NICD ILI-PHC threshold ≥3 cases/72h at PHC level',
  },
  {
    id: 'SRI',
    name: 'Severe Respiratory Illness',
    nicd_programme: 'Pneumonia Surveillance Programme',
    trigger_categories: ['1', '5'],
    confirm_keywords: [
      'difficulty breathing', 'shortness of breath', "can't breathe", 'struggling to breathe',
      'chest pain', 'wheezing', 'pneumonia', 'severe cough',
      // isiZulu
      'ukuphefumula', 'angiphefumuli', 'isifuba', 'ukugula',
      // isiXhosa
      'ukuphefumla', 'isifuba', 'andiPhefumli',
      // Afrikaans
      'asemnood', 'borspyn', 'kan nie asem',
    ],
    min_triage_level: 'ORANGE',
    window_hours: 48,
    thresholds: { WATCH: 2, WARNING: 3, ALERT: 5 },
    seasonal_months: [4, 5, 6, 7, 8, 9, 10],
    nmc_category: null,
    nmc_immediate: false,
    rationale: 'NICD PSP: ≥2 severe respiratory at PHC in 48h warrants review',
  },
  {
    id: 'AGE',
    name: 'Acute Gastroenteritis',
    nicd_programme: 'Diarrhoeal Diseases Syndromic Surveillance (DDSS)',
    trigger_categories: ['6'],
    confirm_keywords: [
      'diarrhoea', 'diarrhea', 'loose stool', 'running stomach', 'stomach running',
      'vomiting and diarrhoea', 'gastro', 'stomach cramps', 'nausea and diarrhoea',
      // isiZulu
      'isisu', 'ukuhlanza', 'uhudo', 'ukuphuma',
      // isiXhosa
      'isisu', 'ukuhlanza', 'ukugabha',
      // Afrikaans
      'diarree', 'maagloop', 'braking en diarree',
      // Sesotho/Setswana
      'mala', 'ho ruwa', 'go ruwa',
    ],
    min_triage_level: 'YELLOW',
    window_hours: 48,
    thresholds: { WATCH: 5, WARNING: 8, ALERT: 12 },
    // Paediatric sub-threshold: lower count triggers alert for children ≤5
    paediatric_threshold: 2,
    seasonal_months: null, // Year-round in SA
    nmc_category: null,
    nmc_immediate: false,
    rationale: 'NICD DDSS: ≥5 AGE cases/48h at PHC, or ≥2 in children ≤5',
  },
  {
    id: 'WATERY_DIARRHOEA',
    name: 'Watery Diarrhoea (Cholera exclusion)',
    nicd_programme: 'NMC Category 1 Notification',
    trigger_categories: ['6'],
    confirm_keywords: [
      'watery stool', 'watery diarrhoea', 'profuse diarrhoea', 'rice water stool',
      'cannot stop diarrhoea', 'severe dehydration and diarrhoea', 'collapsing with diarrhoea',
      // isiZulu
      'uhudo onamanzilethe', 'isisu esibi',
      // Afrikaans
      'waterige diarree', 'erge diarree en uitdroging',
    ],
    min_triage_level: 'ORANGE',
    window_hours: 24,
    thresholds: { WATCH: 1, WARNING: 1, ALERT: 2 }, // Any case warrants attention
    seasonal_months: null,
    nmc_category: 1,
    nmc_immediate: true,
    rationale: 'NMC Cat 1: ANY suspected cholera → immediate notification to NICD within 24h. National Health Act 61/2003.',
  },
  {
    id: 'MENINGITIS',
    name: 'Meningitis / Meningococcal Disease',
    nicd_programme: 'NMC Category 1 Notification',
    trigger_categories: ['2', '5'],
    confirm_keywords: [
      'stiff neck', 'neck stiffness', 'neck is stiff', 'meningitis', 'purpuric rash',
      'non-blanching rash', 'purple rash with fever', 'rash that does not fade',
      'rash and fever and stiff neck', 'photophobia and fever',
      // isiZulu
      'umnqala ubuhlungu', 'umnqala womelele', 'ikhanda numnqala',
      // Afrikaans
      'styfnek', 'nek pyn en koors',
    ],
    min_triage_level: 'ORANGE',
    window_hours: 24,
    thresholds: { WATCH: 1, WARNING: 1, ALERT: 1 }, // Single case is a signal
    seasonal_months: null,
    nmc_category: 1,
    nmc_immediate: true,
    rationale: 'NMC Cat 1: ANY suspected meningococcal disease → immediate notification. NICD CRDM.',
  },
  {
    id: 'MEASLES',
    name: 'Measles-Like Illness',
    nicd_programme: 'NMC Category 1 Notification',
    trigger_categories: ['5', '11'],
    confirm_keywords: [
      'rash and fever', 'fever and rash', 'measles', 'red eyes and rash',
      'rash spreading', 'maculopapular rash', 'koplik spots',
      'whole body rash with fever', 'generalised rash',
      // isiZulu
      'imfiva nolubu', 'isikhumba nokubalala',
      // Afrikaans
      'masels', 'uitslag en koors',
    ],
    min_triage_level: 'YELLOW',
    window_hours: 168, // 7 days — per WHO measles surveillance guideline
    thresholds: { WATCH: 1, WARNING: 2, ALERT: 2 },
    seasonal_months: null,
    nmc_category: 1,
    nmc_immediate: true,
    rationale: 'NMC Cat 1: ≥2 suspected measles in 7 days → notify. WHO measles surveillance; NICD NMC Annexure A 2022.',
  },
  {
    id: 'UNEXPLAINED_FEVER',
    name: 'Unexplained Fever Cluster',
    nicd_programme: 'NICD Event-Based Surveillance',
    trigger_categories: ['5', '1', '2'],
    confirm_keywords: [
      'fever', 'high temperature', 'temperature', 'very hot', 'burning up',
      'umkhuhlane', 'imfiva', 'mogote', 'fivha', 'koors',
    ],
    min_triage_level: 'ORANGE', // Only count high-acuity unexplained fevers
    window_hours: 48,
    thresholds: { WATCH: 5, WARNING: 8, ALERT: 12 },
    seasonal_months: null,
    nmc_category: null,
    nmc_immediate: false,
    rationale: 'NICD event-based surveillance: unusual fever cluster → escalate for investigation. WHO IHR 2005.',
  },
];

// ── Main surveillance agent ───────────────────────────────────────
async function runOutbreakSurveillanceAgent() {
  try {
    // Load active config overrides from DB (allows runtime threshold adjustments)
    const { data: configRows } = await _supabase
      .from('outbreak_config')
      .select('*')
      .eq('active', true);

    const configMap = {};
    if (configRows) {
      for (const row of configRows) {
        configMap[row.syndrome_id] = row;
      }
    }

    const now = new Date();

    for (const syndrome of OUTBREAK_SYNDROMES) {
      // Apply any DB config overrides for this syndrome
      const override = configMap[syndrome.id] || {};
      const windowHours = override.window_hours || syndrome.window_hours;
      let thresholds = override.thresholds || syndrome.thresholds;

      // Seasonal adjustment: raise ILI threshold during SA flu season (Apr–Oct)
      // to avoid constant false alarms from normal winter background activity.
      // NICD uses Moving Epidemic Method — raw counts are unreliable in-season.
      if (syndrome.id === 'ILI' && syndrome.seasonal_months) {
        const currentMonth = now.getMonth() + 1; // 1-indexed
        const inSeason = syndrome.seasonal_months.includes(currentMonth);
        if (inSeason) {
          // 2.5× multiplier during season — raises WATCH from 3→8, WARNING 5→13, ALERT 8→20
          thresholds = {
            WATCH:   Math.ceil(thresholds.WATCH   * 2.5),
            WARNING: Math.ceil(thresholds.WARNING * 2.5),
            ALERT:   Math.ceil(thresholds.ALERT   * 2.5),
          };
          logger.info(`[OUTBREAK] ILI in-season mode active (month ${currentMonth}) — adjusted thresholds: WATCH=${thresholds.WATCH}, WARNING=${thresholds.WARNING}, ALERT=${thresholds.ALERT}`);
        }
      }

      const windowStart = new Date(now.getTime() - windowHours * 60 * 60 * 1000);

      // Query triage_logs for presentations in this syndrome's category window
      const { data: logs } = await _supabase
        .from('triage_logs')
        .select('patient_id, triage_level, symptoms, pathway, created_at, location')
        .in('pathway', ['fast_path', 'category_selection', 'ai_triage', 'human_escalation_requested'])
        .gte('created_at', windowStart.toISOString())
        .order('created_at', { ascending: false });

      if (!logs || logs.length === 0) continue;

      // Filter to cases matching this syndrome's criteria
      const matchingCases = logs.filter(log => {
        // Must meet minimum triage level
        const levelOrder = { GREEN: 0, YELLOW: 1, ORANGE: 2, RED: 3 };
        const logLevel = levelOrder[log.triage_level] || 0;
        const minLevel = levelOrder[syndrome.min_triage_level] || 0;
        if (logLevel < minLevel) return false;

        // Must have symptom text matching the syndrome keywords
        const text = (log.symptoms || '').toLowerCase();
        if (!syndrome.confirm_keywords.some(kw => text.includes(kw.toLowerCase()))) return false;

        // SRI exclusion: skip stable chronic asthma patients collecting medication.
        if (syndrome.id === 'SRI') {
          const isStableChronic = [
            'chronic_bypass_stable',
            'chronic_bypass_pharmacy',
            'chronic_bypass_clinic',
            'chronic_bypass_external',
          ].includes(log.pathway);
          if (isStableChronic) return false;
        }

        return true;
      });

      if (matchingCases.length === 0) continue;

      // Group by facility (using location or pathway metadata)
      const byFacility = {};
      for (const log of matchingCases) {
        // Use location coords as facility key if available, fallback to 'unknown'
        const facilityKey = log.location
          ? `${Math.round((log.location.latitude || 0) * 100) / 100},${Math.round((log.location.longitude || 0) * 100) / 100}`
          : 'network_wide';
        if (!byFacility[facilityKey]) byFacility[facilityKey] = [];
        byFacility[facilityKey].push(log);
      }

      // For each facility group, check thresholds
      for (const [facilityKey, cases] of Object.entries(byFacility)) {
        const count = cases.length;

        // Paediatric sub-threshold for AGE (children ≤5 at higher risk)
        const paediatricCount = syndrome.paediatric_threshold
          ? cases.filter(c => {
              const text = (c.symptoms || '').toLowerCase();
              return text.includes('child') || text.includes('baby') ||
                     text.includes('ingane') || text.includes('ngwana') ||
                     text.includes('infant') || text.includes('toddler');
            }).length
          : 0;

        // Determine alert level
        let alertLevel = null;
        if (syndrome.nmc_immediate && count >= thresholds.WATCH) {
          alertLevel = 'IMMEDIATE';
        } else if (count >= thresholds.ALERT) {
          alertLevel = 'ALERT';
        } else if (count >= thresholds.WARNING) {
          alertLevel = 'WARNING';
        } else if (count >= thresholds.WATCH) {
          alertLevel = 'WATCH';
        } else if (syndrome.paediatric_threshold && paediatricCount >= syndrome.paediatric_threshold) {
          alertLevel = 'WATCH';
        }

        if (!alertLevel) continue;

        // Check if we already have an active unresolved alert for this syndrome+facility
        const { data: existing } = await _supabase
          .from('outbreak_alerts')
          .select('id, alert_level, case_count, updated_at')
          .eq('syndrome_id', syndrome.id)
          .eq('facility_key', facilityKey)
          .eq('resolved', false)
          .gte('window_start', windowStart.toISOString())
          .limit(1);

        // Triage distribution for this cluster
        const triageDistribution = cases.reduce((acc, c) => {
          acc[c.triage_level] = (acc[c.triage_level] || 0) + 1;
          return acc;
        }, {});

        const alertData = {
          syndrome_id: syndrome.id,
          syndrome_name: syndrome.name,
          nicd_programme: syndrome.nicd_programme,
          facility_key: facilityKey,
          alert_level: alertLevel,
          case_count: count,
          paediatric_count: paediatricCount,
          window_start: windowStart.toISOString(),
          window_end: now.toISOString(),
          window_hours: windowHours,
          triage_distribution: triageDistribution,
          nmc_category: syndrome.nmc_category,
          nmc_immediate: syndrome.nmc_immediate,
          threshold_used: thresholds,
          rationale: syndrome.rationale,
          resolved: false,
          updated_at: now.toISOString(),
        };

        if (existing && existing.length > 0) {
          // Update existing alert if count increased or level escalated
          const levelOrder = { WATCH: 1, WARNING: 2, ALERT: 3, IMMEDIATE: 4 };
          const existingLevelRank = levelOrder[existing[0].alert_level] || 0;
          const newLevelRank = levelOrder[alertLevel] || 0;

          if (count > existing[0].case_count || newLevelRank > existingLevelRank) {
            await _supabase
              .from('outbreak_alerts')
              .update(alertData)
              .eq('id', existing[0].id);

            logger.info(`[OUTBREAK] Updated ${syndrome.id} alert at ${facilityKey}: ${count} cases → ${alertLevel}`);
          }
        } else {
          // Create new alert — IMMEDIATE alerts get confirmation gate fields
          const insertData = {
            ...alertData,
            created_at: now.toISOString(),
          };

          if (alertLevel === 'IMMEDIATE') {
            insertData.nurse_confirmed         = false;
            insertData.nurse_confirmed_at      = null;
            insertData.nurse_confirmed_by      = null;
            insertData.nmc_notified            = false;
            insertData.nmc_notified_at         = null;
            insertData.nmc_notified_by         = null;
            insertData.nmc_notification_method = null;
            insertData.nmc_reference_number    = null;
            insertData.resolution_notes        = null;
          }

          await _supabase.from('outbreak_alerts').insert(insertData);

          logger.info(`[OUTBREAK] 🚨 NEW ${alertLevel} — ${syndrome.name} at ${facilityKey}: ${count} cases in ${windowHours}h`);

          // Log to governance_alerts for dashboard visibility
          await _supabase.from('governance_alerts').insert({
            alert_type: `outbreak_${syndrome.id.toLowerCase()}`,
            severity: alertLevel === 'IMMEDIATE' ? 'CRITICAL'
              : alertLevel === 'ALERT' ? 'HIGH'
              : alertLevel === 'WARNING' ? 'HIGH' : 'MEDIUM',
            pillar: 'syndromic_surveillance',
            message: alertLevel === 'IMMEDIATE'
              ? `⚠️ IMMEDIATE — ${syndrome.name}: ${count} case(s) in ${windowHours}h at ${facilityKey}. NMC Category ${syndrome.nmc_category} — NURSE CONFIRMATION REQUIRED before NICD notification. Do NOT notify NICD until you have examined the patient.`
              : `${alertLevel}: ${syndrome.name} cluster — ${count} cases in ${windowHours}h at ${facilityKey}.`,
            data: {
              syndrome_id: syndrome.id,
              case_count: count,
              alert_level: alertLevel,
              triage_distribution: triageDistribution,
              rationale: syndrome.rationale,
              nmc_immediate: syndrome.nmc_immediate,
            },
            resolved: false,
            assigned_to: syndrome.nmc_immediate ? 'facility_manager_and_district' : 'clinical_governance_lead',
            created_at: now.toISOString(),
          });
        }
      }
    }
  } catch (e) {
    logger.error('[OUTBREAK] Surveillance agent error:', e.message);
  }
}

// Also called after each triage to provide near-real-time detection
// (not just on the 1-hour interval)
async function checkOutbreakAfterTriage(patientId, triage, session) {
  // Only run for YELLOW and above — GREEN too low-acuity for syndromic signal
  const levelOrder = { GREEN: 0, YELLOW: 1, ORANGE: 2, RED: 3 };
  if ((levelOrder[triage.triage_level] || 0) < 1) return;

  // Run the agent — it's idempotent (won't create duplicate alerts)
  // Run async in background so it doesn't block the patient response
  setImmediate(() => runOutbreakSurveillanceAgent().catch(e =>
    logger.error('[OUTBREAK] Post-triage check failed:', e.message)
  ));
}

// Run surveillance agent hourly
setInterval(runOutbreakSurveillanceAgent, 60 * 60 * 1000);

module.exports = { init, runOutbreakSurveillanceAgent, checkOutbreakAfterTriage, OUTBREAK_SYNDROMES };
