'use strict';
// Scheduled follow-up agents: 24h/72h patient check-ins, abandoned session recovery,
// Phase 2 identity follow-up for RED patients. All run on setInterval in index.js.
// setInterval calls stay in index.js — this module owns the logic, not the schedule.
const logger            = require('../logger');
const { sendWhatsAppMessage } = require('./whatsapp');
const { msg }           = require('./messages');
const { getSession, saveSession, getDueFollowUps } = require('./session');

let _supabase;
function init(supabase) { _supabase = supabase; }

// ── schedulePhase2FollowUp, HIGH_RISK constants, runAbandonedSessionAgent, getAbandonedResumeStep ──
function schedulePhase2FollowUp(patientId, phone, delayMinutes) {
  const scheduledAt = new Date(Date.now() + delayMinutes * 60000);
  return _supabase.from('follow_ups').insert({
    patient_id: patientId, phone,
    triage_level: 'RED',
    scheduled_at: scheduledAt,
    status: 'pending',
    type: 'phase2_after_red',
  }).catch(e => logger.error('[PHASE2] Schedule failed:', e.message));
}


// ── Abandoned session recovery ───────────────────────────────────
const HIGH_RISK_CATEGORIES = ['1', '2', '3', '4'];
const HIGH_RISK_CATEGORY_NAMES = {
  '1': 'Breathing / Chest pain', '2': 'Head injury / Headache',
  '3': 'Pregnancy', '4': 'Bleeding / Wound',
};

async function runAbandonedSessionAgent() {
  const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString();
  try {
    const { data: staleSessions } = await _supabase
      .from('sessions').select('patient_id, data, updated_at')
      .lt('updated_at', twoHoursAgo).limit(50);
    if (!staleSessions || staleSessions.length === 0) return;

    let recovered = 0, highRisk = 0;
    for (const row of staleSessions) {
      const session = row.data || {};
      const patientId = row.patient_id;
      if (!session.fastPathStarted) continue;
      if (session.triageCompleted) continue;
      if (session.abandonFollowUpSent) continue;
      if (!session.phone && !session.lastPhone) continue;

      const phone = session.phone || session.lastPhone;
      const lang = session.language || 'en';
      const isHighRisk = HIGH_RISK_CATEGORIES.includes(session.selectedCategory);

      session.abandonedAt = new Date().toISOString();
      session.abandonFollowUpSent = true;
      session.abandonResumeStep = getAbandonedResumeStep(session);
      await saveSession(patientId, session);
      await sendWhatsAppMessage(phone, buildAbandonedSessionMsg(lang, session.firstName || null, isHighRisk));
      recovered++;

      if (isHighRisk) {
        highRisk++;
        try {
          await _supabase.from('governance_alerts').insert({
            alert_type: 'abandoned_high_risk_session', severity: 'HIGH', pillar: 'patient_safety',
            message: `Patient ${patientId} started triage for category ${session.selectedCategory} (${HIGH_RISK_CATEGORY_NAMES[session.selectedCategory]}) but did not complete.`,
            data: { patient_id: patientId, category: session.selectedCategory, started_at: session.fastPathStartedAt },
            resolved: false,
          });
        } catch (e) { logger.error('[ABANDON] Governance alert failed:', e.message); }
      }
    }
    if (recovered > 0) logger.info(`[ABANDON] ${recovered} sessions recovered, ${highRisk} high-risk alerts`);
  } catch (e) {
    logger.error('[ABANDON] Agent error:', e.message);
  }
}

function getAbandonedResumeStep(session) {
  if (!session.fastPathCategoryDone) return 'category';
  if (!session.fastPathDone) return 'symptom';
  return 'category';
}


// ── buildAbandonedSessionMsg ──
function buildAbandonedSessionMsg(lang, firstName, isHighRisk) {
  const name = firstName ? ` ${firstName}` : '';
  const urgencyLine = isHighRisk
    ? { en: 'You described a concern that may need attention soon.',
        zu: 'Ukhulume ngenkinga engadinga ukunakelwa maduze.',
        xh: 'Uthethe ngengxaki enokufuna ukhuthazo.',
        af: 'Jy het \'n kommerwekkende simptoom beskryf.' }
    : { en: 'We hope you\'re feeling better.',
        zu: 'Sethemba ukuthi uzizwa ngcono.',
        xh: 'Sithemba ukuba uziva ngcono.',
        af: 'Ons hoop jy voel beter.' };
  const uLine = urgencyLine[lang] || urgencyLine['en'];
  const msgs = {
    en: `👋 Hi${name}, you started a health consultation with BIZUSIZO but we didn't finish. ${uLine}\n\n1 — Continue where I left off\n2 — I'm fine, no longer need help`,
    zu: `👋 Sawubona${name}, uqale ukuxoxa nezempilo ne-BIZUSIZO kodwa asiqedanga. ${uLine}\n\n1 — Qhubeka lapho ngamisa khona\n2 — Ngiyaphila, angisadinga usizo`,
    xh: `👋 Molo${name}, uqalile inkqubo yezempilo ne-BIZUSIZO kodwa asigqibanga. ${uLine}\n\n1 — Qhubeka apho ndimisile khona\n2 — Ndiphilile, andinalo usizo`,
    af: `👋 Hallo${name}, jy het 'n gesondheidskonsultasie met BIZUSIZO begin maar ons het nie klaargekry nie. ${uLine}\n\n1 — Gaan voort waar ek opgehou het\n2 — Ek is reg, het nie meer hulp nodig nie`,
    nso: `👋 Thobela${name}, o thomile go buišana le BIZUSIZO eupša ga re ya mafelelong. ${uLine}\n\n1 — Tšwela pele mo ke emišitšego\n2 — Ke gona gabotse, ga ke sa nyaka thušo`,
    tn: `👋 Dumela${name}, o simolotse puisano ya maphelo le BIZUSIZO mme ga re a feleletsa. ${uLine}\n\n1 — Tswelela kwa ke emileng\n2 — Ke gona sentle, ga ke sa tlhoka thuso`,
    st: `👋 Lumela${name}, o qadile puisano ya bophelo le BIZUSIZO empa ha ra fela. ${uLine}\n\n1 — Tswela pele moo ke emang\n2 — Ke gona hantle, ha ke sa hloka thuso`,
    ts: `👋 Xewani${name}, u sungule mbulavurisano wa rihanyo na BIZUSIZO kambe a hi ya emahelweni. ${uLine}\n\n1 — Yisa emahlweni laha ndima\n2 — Ndiri kahle, a ndzi sa lavi pfuno`,
    ss: `👋 Sawubona${name}, uqale ingcoco yempilo ne-BIZUSIZO kodwa asiqedelanga. ${uLine}\n\n1 — Chubeka lapho ngamisa\n2 — Ngiphilile, angisadinga lusito`,
    ve: `👋 Aa${name}, no thoma nyambedzano ya mutakalo na BIZUSIZO fhedzi a ro fhedza. ${uLine}\n\n1 — Bveledzani fhethu hei ndo ima\n2 — Ndi zwavhuḓi, a tsha ṱoḓi thuso`,
    nr: `👋 Lotjha${name}, uqale ukuxhumana nezempilo ne-BIZUSIZO kodwa asiqedelanga. ${uLine}\n\n1 — Qhubeka lapho ngamisa\n2 — Ngiyaphila, angisadinga lusizo`,
  };
  return msgs[lang] || msgs['en'];
}


// ── runFollowUpAgent ──
async function runFollowUpAgent() {
  const due = await getDueFollowUps();

  for (const item of due) {
    const patientId = item.patient_id;
    const session = await getSession(patientId);
    const lang = session.language || 'en';

    // Different handling for next-visit reminders vs 48hr follow-ups
    if (item.type === 'doctor_appointment_reminder') {
      // Day-before reminder for nurse-to-doctor referral return visit
      // Asks patient to CONFIRM attendance — prevents ghost bookings
      let reminderData = {};
      try { reminderData = JSON.parse(item.data || '{}'); } catch (e) {}
      const facilityName = reminderData.facility_name || 'your clinic';
      const doctorName = reminderData.doctor_name || 'the doctor';
      const appointmentDate = reminderData.appointment_date || 'tomorrow';
      const assignedSlot = reminderData.assigned_slot || '';
      const reason = reminderData.clinical_reason || '';

      const reminderMsg = {
        en: `👨‍⚕️ *Doctor Appointment — Please Confirm*\n\nYou have an appointment with ${doctorName} tomorrow at *${facilityName}*${assignedSlot ? ' at *' + assignedSlot + '*' : ''}.\n\n📋 Reason: ${reason}\n\n📋 Please bring: ID document, clinic card, and any medication you are currently taking.\n\nWill you be able to attend?\n\n1 — Yes, I will be there\n2 — No, I cannot make it (reschedule)`,
        zu: `👨‍⚕️ *Isikhathi Sikadokotela — Sicela Uqinisekise*\n\nUne-appointment no-${doctorName} kusasa e-*${facilityName}*${assignedSlot ? ' ngo-*' + assignedSlot + '*' : ''}.\n\n📋 Isizathu: ${reason}\n\n📋 Sicela ulethe: Incwadi yesazisi, ikhadi lasemtholampilo, nemithi oyidlayo.\n\nUzokwazi ukufika?\n\n1 — Yebo, ngizobe ngikhona\n2 — Cha, angikwazi (hlela kabusha)`,
        xh: `👨‍⚕️ *Idinga Lokubona Ugqirha — Nceda Uqinisekise*\n\nUnedinga no-${doctorName} ngomso e-*${facilityName}*${assignedSlot ? ' ngo-*' + assignedSlot + '*' : ''}.\n\n📋 Isizathu: ${reason}\n\n📋 Nceda uzise: Isazisi, ikhadi lasekliniki, namayeza owathathayo.\n\nUza kukwazi ukufika?\n\n1 — Ewe, ndiza kuba khona\n2 — Hayi, andikwazi (hlela ngokutsha)`,
        af: `👨‍⚕️ *Dokter Afspraak — Bevestig Asseblief*\n\nJy het 'n afspraak met ${doctorName} môre by *${facilityName}*${assignedSlot ? ' om *' + assignedSlot + '*' : ''}.\n\n📋 Rede: ${reason}\n\n📋 Bring asseblief: ID-dokument, kliniekkaart, en medikasie.\n\nSal jy kan bywoon?\n\n1 — Ja, ek sal daar wees\n2 — Nee, ek kan nie (herskeduleer)`,
      };
      await sendWhatsAppMessage(item.phone, reminderMsg[lang] || reminderMsg['en']);
      await _supabase.from('follow_ups').update({ status: 'sent' }).eq('id', item.id);

      // Set session flag to capture confirmation response
      session.awaitingAppointmentConfirmation = true;
      session.appointmentReminderData = reminderData;
      session.appointmentFollowUpId = item.id;
      await saveSession(patientId, session);

    } else if (item.type === 'next_visit_reminder') {
      // SARS-inspired: day-before reminder with "what to bring" + slot offer
      const facilityName = session.confirmedFacility?.name || session.suggestedFacility?.name || 'your clinic';

      // Determine what to bring based on patient's queue type / category
      const category = session.selectedCategory;
      let bringList = 'ID document, clinic card';
      if (category === '8') bringList = 'ID document, clinic card, chronic medication card';
      else if (category === '3') bringList = 'ID document, maternity case record (antenatal card)';
      else if (category === '14') bringList = 'ID document, clinic card';
      else if (category === '15') bringList = 'ID document (fasting from 10pm if glucose test)';

      const reminderMsg = {
        en: `📅 *Appointment Reminder*\n\nYou have a clinic visit tomorrow at *${facilityName}*.\n\n📋 Please bring: ${bringList}\n\nWhen would you like to come?\n1 — 🌅 Morning (08:00–10:00)\n2 — ☀️ Mid-morning (10:00–12:00)\n3 — 🌤️ Afternoon (12:00–14:00)`,
        zu: `📅 *Isikhumbuzo Sokuvakatjhela*\n\nUnokuvakatjhela emtholampilo kusasa e-*${facilityName}*.\n\n📋 Letha: ${bringList}\n\nUfuna ukufika nini?\n1 — 🌅 Ekuseni (08:00–10:00)\n2 — ☀️ Phakathi nosuku (10:00–12:00)\n3 — 🌤️ Ntambama (12:00–14:00)`,
        xh: `📅 *Isikhumbuzo Sotyelelo*\n\nUnokuya ekliniki ngomso e-*${facilityName}*.\n\n📋 Zisa: ${bringList}\n\nUfuna ukufika nini?\n1 — 🌅 Kusasa (08:00–10:00)\n2 — ☀️ Emini (10:00–12:00)\n3 — 🌤️ Emva kwemini (12:00–14:00)`,
        af: `📅 *Afspraak Herinnering*\n\nJy het \'n kliniekbesoek môre by *${facilityName}*.\n\n📋 Bring saam: ${bringList}\n\nWanneer wil jy kom?\n1 — 🌅 Oggend (08:00–10:00)\n2 — ☀️ Middag (10:00–12:00)\n3 — 🌤️ Namiddag (12:00–14:00)`,
        nso: `📅 *Kgopotšo ya Ketelo*\n\nO na le ketelo ya kliniki gosasa go *${facilityName}*.\n\n📋 Tliša: ${bringList}\n\nO nyaka go tla neng?\n1 — 🌅 Mosong (08:00–10:00)\n2 — ☀️ Gare ga letšatši (10:00–12:00)\n3 — 🌤️ Mathapama (12:00–14:00)`,
        tn: `📅 *Kgopotso ya Ketelo*\n\nO na le ketelo ya kliniki kamoso kwa *${facilityName}*.\n\n📋 Tlisa: ${bringList}\n\nO batla go tla leng?\n1 — 🌅 Moso (08:00–10:00)\n2 — ☀️ Motshegare (10:00–12:00)\n3 — 🌤️ Motshegare wa boraro (12:00–14:00)`,
        st: `📅 *Kgopotso ya Ketelo*\n\nO na le ketelo ya kliniki hosane ho *${facilityName}*.\n\n📋 Tlisa: ${bringList}\n\nO batla ho tla neng?\n1 — 🌅 Hoseng (08:00–10:00)\n2 — ☀️ Motsheare (10:00–12:00)\n3 — 🌤️ Motsheare oa boraro (12:00–14:00)`,
        ts: `📅 *Xikombiso xa Ku Endzela*\n\nU na ni ku endzela ka kliniki mundzuku eka *${facilityName}*.\n\n📋 Tisa: ${bringList}\n\nU lava ku ta rini?\n1 — 🌅 Mixo (08:00–10:00)\n2 — ☀️ Nhlekanhi (10:00–12:00)\n3 — 🌤️ Madyambu (12:00–14:00)`,
        ss: `📅 *Sikhumbuto Sekuvakashela*\n\nUnekuvakashela kwakho emtfolamphilo kusasa ku-*${facilityName}*.\n\n📋 Letsa: ${bringList}\n\nUfuna kufika nini?\n1 — 🌅 Ekuseni (08:00–10:00)\n2 — ☀️ Emini (10:00–12:00)\n3 — 🌤️ Ntambama (12:00–14:00)`,
        ve: `📅 *Tshikombiso tsha Ndaela*\n\nNi na ndaela ya kiliniki matshelo kha *${facilityName}*.\n\n📋 Ḓisani: ${bringList}\n\nNi ṱoḓa u ḓa lini?\n1 — 🌅 Matsheloni (08:00–10:00)\n2 — ☀️ Masiari (10:00–12:00)\n3 — 🌤️ Madekwana (12:00–14:00)`,
        nr: `📅 *Isikhumbuto Sokuvakatjhela*\n\nUnokuvakatjhela ekliniki kusasa ku-*${facilityName}*.\n\n📋 Letha: ${bringList}\n\nUfuna ukufika nini?\n1 — 🌅 Ekuseni (08:00–10:00)\n2 — ☀️ Emini (10:00–12:00)\n3 — 🌤️ Ntambama (12:00–14:00)`,
      };
      await sendWhatsAppMessage(item.phone, reminderMsg[lang] || reminderMsg['en']);

      // Set session flag to capture slot choice
      session.awaitingSlotChoice = true;
      session.appointmentDate = item.scheduled_at; // The actual visit date (day after reminder)
      session.appointmentFacility = facilityName;
      await saveSession(patientId, session);

      await _supabase.from('follow_ups').update({ status: 'sent' }).eq('id', item.id);

    } else if (item.type === 'check_in') {
      // 24h check-in — lightweight "did you make it to the clinic?"
      const checkInMsg = {
        en: `👋 Hi, you used BIZUSIZO yesterday. Did you make it to the clinic?\n\n1 — Yes, I went ✅\n2 — Not yet ⏳`,
        zu: `👋 Sawubona, usebenzise i-BIZUSIZO izolo. Ukwazile ukuya emtholampilo?\n\n1 — Yebo, ngiye ✅\n2 — Akukasho ⏳`,
        xh: `👋 Molo, usebenzise i-BIZUSIZO izolo. Ukwazile ukuya ekliniki?\n\n1 — Ewe, ndiye ✅\n2 — Hayi okwangoku ⏳`,
        af: `👋 Hallo, jy het gister BIZUSIZO gebruik. Het jy dit na die kliniek gemaak?\n\n1 — Ja, ek het gegaan ✅\n2 — Nog nie ⏳`,
        nso: `👋 Thobela, o šomišitše BIZUSIZO maabane. Na o kgontšhe go ya kiliniki?\n\n1 — Ee, ke ile ✅\n2 — Ga ke eso ye ⏳`,
        tn: `👋 Dumela, o dirisitse BIZUSIZO maabane. A o kgonnye go ya kliniki?\n\n1 — Ee, ke ile ✅\n2 — Ga ke eso ye ⏳`,
        st: `👋 Lumela, o sebedisitse BIZUSIZO maobane. Na o kgonnye ho ya kliniki?\n\n1 — E, ke ile ✅\n2 — Ga ke eso ye ⏳`,
        ts: `👋 Xewani, u tirhisile BIZUSIZO wa ti-malembe. Na u kote ku ya ekliniki?\n\n1 — Ina, ndile ✅\n2 — A ndzi anga ⏳`,
        ss: `👋 Sawubona, usebentise i-BIZUSIZO itolo. Wakwata kuyekliniki?\n\n1 — Yebo, ngiye ✅\n2 — Akukasho ⏳`,
        ve: `👋 Aa, no shumisa BIZUSIZO maḓuvha a u fhaho. Na no kona u ya kha kiliniki?\n\n1 — Ee, ndo ya ✅\n2 — A tho ngo ⏳`,
        nr: `👋 Lotjha, usebenzise i-BIZUSIZO izolo. Ukwazile ukuya ekliniki?\n\n1 — Iye, ngiye ✅\n2 — Akakasho ⏳`,
      };
      await sendWhatsAppMessage(item.phone, checkInMsg[lang] || checkInMsg['en']);
      await _supabase.from('follow_ups').update({ status: 'sent' }).eq('id', item.id);

    } else if (item.type === 'gbv_pep_check_3d') {
      // 3 days after sexual assault — PEP adherence + emotional welfare
      // Tone: gentle, supportive, non-judgmental. Never reference the assault directly.
      const pepMsg3 = {
        en: `💙 *Checking in with you*\n\nWe hope you are being supported.\n\nIf you were given medication (PEP) at the hospital or TCC:\n\n1 — I am taking it every day\n2 — I stopped because of side effects\n3 — I did not receive medication\n4 — I do not want to talk about this\n\nYour answer is private. We are here to help, not to judge.`,
        zu: `💙 *Siyakubheka*\n\nSethemba uthola ukwesekwa.\n\nUma unikwe umuthi (PEP) esibhedlela noma e-TCC:\n\n1 — Ngiyawuthatha nsuku zonke\n2 — Ngiyekile ngenxa yemiphumela emibi\n3 — Angizange ngithole umuthi\n4 — Angifuni ukukhuluma ngalokhu\n\nImpendulo yakho iyimfihlo. Silapha ukusiza, hhayi ukwahlulela.`,
        xh: `💙 *Siyakuhlola*\n\nSithemba ufumana inkxaso.\n\nUkuba unikwe amayeza (PEP) esibhedlele okanye eTCC:\n\n1 — Ndiyawathatha yonke imihla\n2 — Ndiyekile ngenxa yeziphumo ezimbi\n3 — Andizange ndifumane amayeza\n4 — Andifuni ukuthetha ngale nto\n\nImpendulo yakho yimfihlo. Sikho ukunceda, hayi ukugweba.`,
        af: `💙 *Ons dink aan jou*\n\nOns hoop jy word ondersteun.\n\nAs jy medikasie (PEP) by die hospitaal of TCC ontvang het:\n\n1 — Ek neem dit elke dag\n2 — Ek het opgehou weens newe-effekte\n3 — Ek het nie medikasie ontvang nie\n4 — Ek wil nie hieroor praat nie\n\nJou antwoord is privaat. Ons is hier om te help, nie om te oordeel nie.`,
        nso: `💙 *Re a go hlokomela*\n\nRe holofela gore o hwetša thekgo.\n\nGe o filwe dihlare (PEP) sepetlele goba TCC:\n\n1 — Ke a di nwa letšatši le lengwe le le lengwe\n2 — Ke tlogeletše ka lebaka la ditlamorago\n3 — Ga se ka hwetša dihlare\n4 — Ga ke nyake go bolela ka se\n\nKarabo ya gago ke sephiri. Re mo go go thuša, e sego go go ahlola.`,
        tn: `💙 *Re a go tlhokomela*\n\nRe solofela gore o bona thuso.\n\nFa o neilwe melemo (PEP) kwa bookelong kgotsa TCC:\n\n1 — Ke a e nwa letsatsi le letsatsi\n2 — Ke tlogetse ka ntlha ya ditlamorago\n3 — Ga ke a amogela melemo\n4 — Ga ke batle go bua ka se\n\nKarabo ya gago ke sephiri. Re fa go go thusa, e seng go go sekisa.`,
        st: `💙 *Re a o hlokomela*\n\nRe tshepile hore o fumana tšehetso.\n\nHaeba o ile wa fuwa meriana (PEP) sepetlele kapa TCC:\n\n1 — Ke a e nwa letsatsi le leng le le leng\n2 — Ke tlohetse ka lebaka la ditlamorao\n3 — Ha ke a fumana meriana\n4 — Ha ke batle ho bua ka sena\n\nKarabo ya hao ke lekunutu. Re mona ho thusa, e seng ho ahlola.`,
        ts: `💙 *Hi ku hlokomela*\n\nHi tshemba u kuma mpfuno.\n\nLoko u nyikiwile murhi (PEP) exibedlhele kumbe TCC:\n\n1 — Ndza wu nwa siku rin'wana ni rin'wana\n2 — Ndzi tshikile hikwalaho ka switandzhaku\n3 — A ndzi kumanga murhi\n4 — A ndzi lavi ku vulavula hi mhaka leyi\n\nNhlamulo ya wena yi xihundla. Hi laha ku ku pfuna, ku nga ri ku ku avanyisa.`,
        ss: `💙 *Siyakubheka*\n\nSetsemba kutsi uyatfolakala lusito.\n\nNangabe unikwe umutsi (PEP) esibhedlela noma e-TCC:\n\n1 — Ngiyawunwa onkhe emalanga\n2 — Ngiyekile ngenca yemiphumela lemibi\n3 — Angizange ngitfole umutsi\n4 — Angifuni kukhuluma ngaloku\n\nImphendvulo yakho iyimfihlo. Silapha kusita, hhayi kwehlukanisa.`,
        ve: `💙 *Ri khou ni londa*\n\nRi fulufhela uri ni khou wana thikhedzo.\n\nArali no ṋewa mushonga (PEP) sibadela kana TCC:\n\n1 — Ndi khou u nwa ḓuvha ḽiṅwe na ḽiṅwe\n2 — Ndo litsha nga nṱhani ha mbilaelo\n3 — A tho ngo wana mushonga\n4 — A thi funi u amba nga ha izwi\n\nPhindulo yaṋu ndi tshiphiri. Ri fhano u thusa, a ri ṱhogomeli u haṱula.`,
        nr: `💙 *Siyakuhlola*\n\nSithemba ufumana isekelo.\n\nNangabe unikwe umuthi (PEP) esibhedlela noma e-TCC:\n\n1 — Ngiyawuthatha ilanga nelanga\n2 — Ngiyekile ngebanga lemiphumela emimbi\n3 — Akhenge ngifumane umuthi\n4 — Angifuni ukukhuluma ngalokhu\n\nIpendulo yakho iyifihlo. Silapha ukusiza, ingasi ukwahlulela.`,
      };
      await sendWhatsAppMessage(item.phone, pepMsg3[lang] || pepMsg3['en']);
      await _supabase.from('follow_ups').update({ status: 'sent' }).eq('id', item.id);
      session.awaitingGBVPepResponse = true;
      session.gbvFollowUpId = item.id;
      session.gbvFollowUpType = '3d';
      await saveSession(patientId, session);

    } else if (item.type === 'gbv_pep_check_7d') {
      // 7 days — PEP side effects are the #1 reason people stop
      const pepMsg7 = {
        en: `💙 *One week check-in*\n\nIf you are taking PEP medication:\n\nSide effects like nausea, tiredness, or headaches are common in the first week. They usually improve.\n\n*Please do not stop taking PEP* — the full 28 days protects you from HIV.\n\nAre you managing?\n\n1 — Yes, still taking PEP\n2 — I stopped or missed doses\n3 — I need to talk to someone\n\n📞 GBV helpline: *0800 428 428* (free, 24/7)`,
        zu: `💙 *Ukuhlola kweviki elilodwa*\n\nUma uthatha umuthi we-PEP:\n\nImiphumela emibi njengokuzizwa unesiyezi, ukukhathala, noma ikhanda elibuhlungu ivame evikini lokuqala. Ivame ukuba ngcono.\n\n*Sicela ungayeki ukuthatha i-PEP* — izinsuku ezi-28 ezigcwele zikuvikela ku-HIV.\n\nUyakwazi?\n\n1 — Yebo, ngisathatha i-PEP\n2 — Ngiyekile noma ngiphuthelwe\n3 — Ngidinga ukukhuluma nomuntu\n\n📞 Usizo lwe-GBV: *0800 428 428* (mahhala, 24/7)`,
        xh: `💙 *Ukuhlola kweveki enye*\n\nUkuba uthatha amayeza ePEP:\n\nIziphumo ezimbi ezinjengokuziva unesifo sesisu, ukukhathala, okanye iintlungu zentloko ziqhelekile kwiveki yokuqala. Zihlala ziphucula.\n\n*Nceda musa ukuyeka ukuthatha iPEP* — iintsuku ezi-28 ezipheleleyo ziyakukhusela kwiHIV.\n\nUyakwazi?\n\n1 — Ewe, ndisathatha iPEP\n2 — Ndiyekile okanye ndiphosile\n3 — Ndifuna ukuthetha nomntu\n\n📞 Uncedo lweGBV: *0800 428 428* (simahla, 24/7)`,
        af: `💙 *Een week opvolg*\n\nAs jy PEP medikasie neem:\n\nNewe-effekte soos naarheid, moegheid of hoofpyn is algemeen in die eerste week. Dit verbeter gewoonlik.\n\n*Moenie ophou om PEP te neem nie* — die volle 28 dae beskerm jou teen MIV.\n\nKom jy reg?\n\n1 — Ja, ek neem nog PEP\n2 — Ek het opgehou of dosisse gemis\n3 — Ek moet met iemand praat\n\n📞 GBV hulplyn: *0800 428 428* (gratis, 24/7)`,
        nso: `💙 *Tekolo ya beke ye tee*\n\nGe o nwa dihlare tša PEP:\n\nDitlamorago tše bjalo ka go hlatša, go lapišwa, goba hlogo e bohloko di tlwaelegile bekeng ya mathomo. Gantši di kaonafala.\n\n*Hle o se ke wa tlogela go nwa PEP* — matšatši a 28 ka botlalo a go šireletša go HIV.\n\nNa o kgona?\n\n1 — Ee, ke sa nwa PEP\n2 — Ke tlogeletše goba ke fošitše\n3 — Ke nyaka go bolela le motho\n\n📞 Mogala wa GBV: *0800 428 428* (mahala, 24/7)`,
        tn: `💙 *Tekolo ya beke e le nngwe*\n\nFa o nwa melemo ya PEP:\n\nDitlamorago tse di jaaka go tlhapogela, go lapa, kgotsa tlhogo e botlhoko di tlwaelegile mo bekeng ya ntlha. Gantsi di tokafala.\n\n*Tswee-tswee o se ka wa tlogela go nwa PEP* — malatsi a le 28 ka botlalo a go sireletsa mo go HIV.\n\nA o kgona?\n\n1 — Ee, ke sa ntse ke nwa PEP\n2 — Ke tlogetse kgotsa ke tlodile\n3 — Ke tlhoka go bua le mongwe\n\n📞 Mogala wa GBV: *0800 428 428* (mahala, 24/7)`,
        st: `💙 *Tekolo ya beke e le nngwe*\n\nHaeba o nwa meriana ya PEP:\n\nDitlamorao tse kang ho phallatsa, ho tepella, kapa hlooho e bohloko di tlwaelehile bekeng ya pele. Hangata di ntlafala.\n\n*Ka kopo o se ke wa tloha ho nwa PEP* — matsatsi a 28 ka botlalo a o sireletsa ho HIV.\n\nNa o kgona?\n\n1 — E, ke sa nwa PEP\n2 — Ke tlohetse kapa ke fošitše\n3 — Ke hloka ho bua le motho\n\n📞 Mohala wa GBV: *0800 428 428* (mahala, 24/7)`,
        ts: `💙 *Nhlolovo ya vhiki yin'we*\n\nLoko u nwa murhi wa PEP:\n\nSwitandzhaku swo fana ni ku hlanyanisiwa, ku karhateka, kumbe nhloko yo vava swa toloveleka evhikini yo sungula. Kambe swi antswisa.\n\n*U nga tshiki ku nwa PEP* — masiku ya 28 lawa hinkwawo ya ku sirhelela eka HIV.\n\nXana u kota?\n\n1 — Ina, ndza ha nwa PEP\n2 — Ndzi tshikile kumbe ndzi hundzile\n3 — Ndzi lava ku vulavula na munhu\n\n📞 Xitlhavelo xa GBV: *0800 428 428* (mahala, 24/7)`,
        ss: `💙 *Tekolo yelviki linye*\n\nNangabe unwa umutsi we-PEP:\n\nImiphumela lemibi njengekucanuka, kukhatsala, noma likhanda lelibuhlungu kuvamile evikini lekucala. Loku kuvamise kukwentela ncono.\n\n*Sicela ungayeki kunwa i-PEP* — emalanga la-28 aphelele akuvikela ku-HIV.\n\nUyakwati?\n\n1 — Yebo, ngisanwa i-PEP\n2 — Ngiyekile noma ngiphutsile\n3 — Ngifuna kukhuluma nemuntfu\n\n📞 Lusito lwe-GBV: *0800 428 428* (mahhala, 24/7)`,
        ve: `💙 *U londa ha beke nthihi*\n\nArali ni tshi nwa mushonga wa PEP:\n\nMbilaelo dzi ngaho ṱanzwa, u neta, kana u vhavha ha ṱhoho ndi zwithu zwi ḓoweleaho kha beke ya u thoma. Zwi anzela u khwiṋifhala.\n\n*Ni songo litsha u nwa PEP* — maḓuvha a 28 oṱhe a ni tsireledza kha HIV.\n\nNi a kona?\n\n1 — Ee, ndi kha ḓi nwa PEP\n2 — Ndo litsha kana ndo fhiriswa\n3 — Ndi ṱoḓa u amba na muthu\n\n📞 Luṱingo lwa GBV: *0800 428 428* (mahala, 24/7)`,
        nr: `💙 *Ukuhlola kweviki elilodwa*\n\nNangabe unwa umuthi we-PEP:\n\nImiphumela emimbi njengokucanuka, ukukhathala, noma ikhanda elibuhlungu kujayele evikini lokuthoma. Kuvame ukuba ngcono.\n\n*Ungayeki ukunwa i-PEP* — amalanga ama-28 aphelele akuvikela ku-HIV.\n\nUyakghona?\n\n1 — Iye, ngisanwa i-PEP\n2 — Ngiyekile noma ngiphuthe\n3 — Ngifuna ukukhuluma nomuntu\n\n📞 Umugqa we-GBV: *0800 428 428* (simahla, 24/7)`,
      };
      await sendWhatsAppMessage(item.phone, pepMsg7[lang] || pepMsg7['en']);
      await _supabase.from('follow_ups').update({ status: 'sent' }).eq('id', item.id);
      session.awaitingGBVPepResponse = true;
      session.gbvFollowUpId = item.id;
      session.gbvFollowUpType = '7d';
      await saveSession(patientId, session);

    } else if (item.type === 'gbv_pep_completion') {
      // 28 days — PEP course should be complete. Remind about follow-up tests.
      const pepMsg28 = {
        en: `💙 *28-Day Check-In*\n\nIf you completed your PEP medication — well done. That took strength.\n\nImportant next steps:\n• Visit your clinic for an *HIV test* (6 weeks and 3 months after)\n• If you have not had a *pregnancy test*, please do one\n• If you experience any unusual symptoms, see your clinic\n\nYou can also get ongoing counselling:\n📞 *0800 428 428* (GBV helpline, free, 24/7)\n📞 *0800 567 567* (SADAG, free, 24/7)\n\nYou do not have to carry this alone. 💙`,
        zu: `💙 *Ukuhlola Kwezinsuku Ezi-28*\n\nUma uqede umuthi wakho we-PEP — wenze kahle. Lokho kudinge amandla.\n\nIzinyathelo ezibalulekile ezilandelayo:\n• Vakashela umtholampilo wakho ukuhlolwa *kwe-HIV* (emva kwamaviki ama-6 nezinyanga ezi-3)\n• Uma ungakaze uhlolwe *ukukhulelwa*, sicela wenze\n• Uma unezimpawu ezingajwayelekile, bona umtholampilo wakho\n\nUngathola futhi ukwelulekwa okuqhubekayo:\n📞 *0800 428 428* (usizo lwe-GBV, mahhala, 24/7)\n📞 *0800 567 567* (SADAG, mahhala, 24/7)\n\nAwudingi ukuthwala lokhu wedwa. 💙`,
        xh: `💙 *Ukuhlola Kweentsuku Ezingama-28*\n\nUkuba ugqibe amayeza akho ePEP — wenze kakuhle. Oko kudinga amandla.\n\nAmanyathelo abalulekileyo alandelayo:\n• Tyelela ikliniki yakho ukuhlolwa *kweHIV* (emva kweeveki ezi-6 neenyanga ezi-3)\n• Ukuba awukaze uhlolwe *ukumitha*, nceda wenze\n• Ukuba unezimpawu ezingaqhelekanga, bona ikliniki yakho\n\nUngatata ingcebiso eqhubekayo:\n📞 *0800 428 428* (uncedo lweGBV, simahla, 24/7)\n📞 *0800 567 567* (SADAG, simahla, 24/7)\n\nAwudingi ukuthwala oku wedwa. 💙`,
        af: `💙 *28-Dag Opvolg*\n\nAs jy jou PEP medikasie voltooi het — goed gedoen. Dit het krag gevra.\n\nBelangrike volgende stappe:\n• Besoek jou kliniek vir \'n *MIV toets* (6 weke en 3 maande daarna)\n• As jy nog nie \'n *swangerskaptoets* gehad het nie, doen asseblief een\n• As jy ongewone simptome ervaar, sien jou kliniek\n\nJy kan ook deurlopende berading kry:\n📞 *0800 428 428* (GBV hulplyn, gratis, 24/7)\n📞 *0800 567 567* (SADAG, gratis, 24/7)\n\nJy hoef dit nie alleen te dra nie. 💙`,
        nso: `💙 *Tekolo ya Matšatši a 28*\n\nGe o feditše dihlare tša gago tša PEP — o dirile gabotse. Se se ile sa nyaka maatla.\n\nMagato a bohlokwa a a latelago:\n• Etela kliniki ya gago go hlolwa *HIV* (dibeke tše 6 le dikgwedi tše 3 ka morago)\n• Ge o sešo wa dira *teko ya moimana*, hle e dire\n• Ge o itemogela dika tše di sa tlwaelegang, bona kliniki ya gago\n\nO ka hwetša le thušo ya go eleletšwa:\n📞 *0800 428 428* (GBV, mahala, 24/7)\n📞 *0800 567 567* (SADAG, mahala, 24/7)\n\nGa o swanela go rwala se o le noši. 💙`,
        tn: `💙 *Tekolo ya Malatsi a le 28*\n\nFa o feditse melemo ya gago ya PEP — o dirile sentle. Se se ne sa tlhoka thata.\n\nDikgato tse di botlhokwa tse di latelang:\n• Etela kliniki ya gago go tlhatlhobiwa *HIV* (dibeke di le 6 le dikgwedi di le 3 morago)\n• Fa o ise o dire *teko ya go ima*, tswee-tswee e dire\n• Fa o itemogela matshwao a a sa tlwaelegang, bona kliniki ya gago\n\nO ka bona le kgakololo e e tswelelang:\n📞 *0800 428 428* (GBV, mahala, 24/7)\n📞 *0800 567 567* (SADAG, mahala, 24/7)\n\nGa o a tshwanela go rwala se o le nosi. 💙`,
        st: `💙 *Tekolo ya Matsatsi a 28*\n\nHaeba o qetile meriana ya hao ya PEP — o entse hantle. Sena se ile sa hloka matla.\n\nMehato e bohlokwa e latelang:\n• Etela kliniki ya hao bakeng sa *teko ya HIV* (dibeke tse 6 le dikgwedi tse 3 ka mora)\n• Haeba ha o eso etse *teko ya bokhachane*, ka kopo e etse\n• Haeba o fumana matšwao a sa tlwaelehang, bona kliniki ya hao\n\nO ka fumana le thuso ya dikeletso:\n📞 *0800 428 428* (GBV, mahala, 24/7)\n📞 *0800 567 567* (SADAG, mahala, 24/7)\n\nHa o hloke ho jara sena o le mong. 💙`,
        ts: `💙 *Nhlolovo ya Masiku ya 28*\n\nLoko u hetile murhi wa wena wa PEP — u endlile kahle. Leswi swi lavile matimba.\n\nMagoza ya nkoka lawa landzelaka:\n• Endzela kliniki ya wena ku hlolela *HIV* (tivhiki ta 6 na tinhweti ta 3 endzhaku)\n• Loko u nga si endla *ndzingo wa vukhongoloti*, hi kombela u wu endla\n• Loko u twanana ni swikombiso leswi nga tolovelekangiki, vona kliniki ya wena\n\nU nga kuma ni vukhongeri lebyi yaka mahlweni:\n📞 *0800 428 428* (GBV, mahala, 24/7)\n📞 *0800 567 567* (SADAG, mahala, 24/7)\n\nA wu fanelanga ku rhwala leswi u ri xiviri. 💙`,
        ss: `💙 *Tekolo Yemalanga la-28*\n\nNangabe uwucedzile umutsi wakho we-PEP — wente kahle. Loku bekudzinga emandla.\n\nTinyatselo letilandzelako letibalulekile:\n• Vakashela ikliniki yakho kutsi uhlolwe *i-HIV* (emaviki la-6 netinyanga teti-3 emvakwaloko)\n• Nangabe awukenti *siviwo sekukhulelwa*, sicela usente\n• Nangabe uva tibonakaliso letingakavami, bona ikliniki yakho\n\nUngafumana futsi lusito lwekwelulekwa lolurusako:\n📞 *0800 428 428* (GBV, mahhala, 24/7)\n📞 *0800 567 567* (SADAG, mahhala, 24/7)\n\nAwudzingi kutfwala loku wedvwa. 💙`,
        ve: `💙 *U londa ha Maḓuvha a 28*\n\nArali no fhedza mushonga waṋu wa PEP — no ita zwavhuḓi. Izwo zwo ṱoḓa nungo.\n\nMaga a ndeme a tevhelaho:\n• Dalani kha kiliniki yaṋu u itwa *tshiṱoṱo tsha HIV* (vhege dza 6 na ṅwedzi dza 3 nga murahu)\n• Arali ni sa athu ita *tshiṱoṱo tsha vhuimana*, ri humbela ni tshi ite\n• Arali ni tshi ḓipfa ni na zwiga zwi sa ḓoweleaho, vhonani na kiliniki yaṋu\n\nNi nga dovha na wana thikhedzo ya u eletshedza:\n📞 *0800 428 428* (GBV, mahala, 24/7)\n📞 *0800 567 567* (SADAG, mahala, 24/7)\n\nA ni ṱoḓi u hwala izwi noṱhe. 💙`,
        nr: `💙 *Ukuhlola Kwamalanga ama-28*\n\nNangabe uwuqedile umuthi wakho we-PEP — wenze kuhle. Lokho bekufuna amandla.\n\nAmagadango abalulekile alandelako:\n• Vakatjhela ikliniki yakho bona uhlolwe *i-HIV* (amaviki ama-6 neenyanga ezi-3 ngemva)\n• Nangabe awukahlolwa *ukukhulelwa*, sibawa wenze\n• Nangabe ulemuka iimbonakaliso ezingakajayeli, bona ikliniki yakho\n\nUngafumana godu isizo seluleko:\n📞 *0800 428 428* (GBV, simahla, 24/7)\n📞 *0800 567 567* (SADAG, simahla, 24/7)\n\nAwudingi ukuthwala lokhu wedwa. 💙`,
      };
      await sendWhatsAppMessage(item.phone, pepMsg28[lang] || pepMsg28['en']);
      await _supabase.from('follow_ups').update({ status: 'sent' }).eq('id', item.id);

    } else if (item.type === 'gbv_welfare_check') {
      // 7 days after domestic violence report — welfare check
      const welfareMsg = {
        en: `💙 *Checking in with you*\n\nWe hope you are safe.\n\nAre you okay?\n\n1 — I am safe\n2 — I am not safe\n3 — I need to talk to someone\n\n📞 GBV Command Centre: *0800 428 428* (free, 24/7)\n📞 SAPS: *10111*\n\nYou can message us anytime by typing *0*.`,
        zu: `💙 *Siyakubheka*\n\nSethemba uphephile.\n\nUphilile?\n\n1 — Ngiphephile\n2 — Angiphephile\n3 — Ngidinga ukukhuluma nomuntu\n\n📞 GBV: *0800 428 428* (mahhala, 24/7)\n📞 SAPS: *10111*\n\nUngasithumelela umyalezo noma nini ngokubhala *0*.`,
        xh: `💙 *Siyakuhlola*\n\nSithemba ukhuselekile.\n\nUlungile?\n\n1 — Ndikhuselekile\n2 — Andikhuselekanga\n3 — Ndifuna ukuthetha nomntu\n\n📞 GBV: *0800 428 428* (simahla, 24/7)\n📞 SAPS: *10111*\n\nUngasithumelela umyalezo nanini na ngokubhala *0*.`,
        af: `💙 *Ons dink aan jou*\n\nOns hoop jy is veilig.\n\nIs jy okay?\n\n1 — Ek is veilig\n2 — Ek is nie veilig nie\n3 — Ek moet met iemand praat\n\n📞 GBV: *0800 428 428* (gratis, 24/7)\n📞 SAPS: *10111*\n\nJy kan ons enige tyd \'n boodskap stuur deur *0* te tik.`,
        nso: `💙 *Re a go hlokomela*\n\nRe holofela gore o bolokegile.\n\nA o lokile?\n\n1 — Ke bolokegile\n2 — Ga ke bolokegile\n3 — Ke nyaka go bolela le motho\n\n📞 GBV: *0800 428 428* (mahala, 24/7)\n📞 SAPS: *10111*\n\nO ka re ngwalela nako efe goba efe ka go thaepa *0*.`,
        tn: `💙 *Re a go tlhokomela*\n\nRe solofela gore o babalesegile.\n\nA o siame?\n\n1 — Ke babalesegile\n2 — Ga ke a babalesega\n3 — Ke tlhoka go bua le mongwe\n\n📞 GBV: *0800 428 428* (mahala, 24/7)\n📞 SAPS: *10111*\n\nO ka re romelela molaetsa nako nngwe le nngwe ka go tshwaisa *0*.`,
        st: `💙 *Re a o hlokomela*\n\nRe tshepile hore o bolokehile.\n\nNa o ntse o lokile?\n\n1 — Ke bolokehile\n2 — Ha ke bolokehile\n3 — Ke hloka ho bua le motho\n\n📞 GBV: *0800 428 428* (mahala, 24/7)\n📞 SAPS: *10111*\n\nO ka re romella molaetsa nako efe kapa efe ka ho thaepa *0*.`,
        ts: `💙 *Hi ku hlokomela*\n\nHi tshemba u hlayisekile.\n\nXana u kahle?\n\n1 — Ndzi hlayisekile\n2 — A ndzi hlayisekanga\n3 — Ndzi lava ku vulavula na munhu\n\n📞 GBV: *0800 428 428* (mahala, 24/7)\n📞 SAPS: *10111*\n\nU nga hi tsalela nkarhi wun'wana ni wun'wana hi ku thayipa *0*.`,
        ss: `💙 *Siyakubheka*\n\nSetsemba kutsi uphephile.\n\nUsaphila?\n\n1 — Ngiphephile\n2 — Angikaphephi\n3 — Ngifuna kukhuluma nemuntfu\n\n📞 GBV: *0800 428 428* (mahhala, 24/7)\n📞 SAPS: *10111*\n\nUngasitfumelela umlayeto nganoma ngusiphi sikhatsi ngekubhala *0*.`,
        ve: `💙 *Ri khou ni londa*\n\nRi fulufhela uri ni tsireledzeha.\n\nNi vho ḓi vha hani?\n\n1 — Ndo tsireledzeha\n2 — A tho ngo tsireledzeha\n3 — Ndi ṱoḓa u amba na muthu\n\n📞 GBV: *0800 428 428* (mahala, 24/7)\n📞 SAPS: *10111*\n\nNi nga ri ṅwalela tshifhinga tshiṅwe na tshiṅwe nga u thaipha *0*.`,
        nr: `💙 *Siyakuhlola*\n\nSithemba uphephile.\n\nUlungile?\n\n1 — Ngiphephile\n2 — Angikaphephi\n3 — Ngifuna ukukhuluma nomuntu\n\n📞 GBV: *0800 428 428* (simahla, 24/7)\n📞 SAPS: *10111*\n\nUngasithumelela umlayezo nganoma kunini ngokubhala *0*.`,
      };
      await sendWhatsAppMessage(item.phone, welfareMsg[lang] || welfareMsg['en']);
      await _supabase.from('follow_ups').update({ status: 'sent' }).eq('id', item.id);
      session.awaitingGBVWelfareResponse = true;
      session.gbvFollowUpId = item.id;
      await saveSession(patientId, session);

    } else if (item.type === 'hospital_arrival_check') {
      // 4 hours after escalation — did the patient make it to hospital?
      let hospData = {};
      try { hospData = JSON.parse(item.data || '{}'); } catch (e) {}
      const destination = hospData.destination || 'the hospital';

      const arrivalMsg = {
        en: `🏥 *Hospital Check-In*\n\nYou were referred to ${destination} earlier today.\n\nDid you make it to the hospital?\n\n1 — Yes, I am at the hospital\n2 — Yes, I was seen and sent home\n3 — No, I could not get there\n4 — I decided not to go`,
        zu: `🏥 *Ukuhlola Esibhedlela*\n\nUthunyelwe e-${destination} namhlanje.\n\nUfikile esibhedlela?\n\n1 — Yebo, ngisesibhedlela\n2 — Yebo, ngiboniwe futhi ngithunyelwe ekhaya\n3 — Cha, angikwazanga ukufika\n4 — Nginqume ukungayi`,
        xh: `🏥 *Ukuhlola Esibhedlele*\n\nUthunyelwe e-${destination} namhlanje.\n\nUfike esibhedlele?\n\n1 — Ewe, ndisesibhedlele\n2 — Ewe, ndiboniwe ndathunyelwa ekhaya\n3 — Hayi, andikwazanga ukufika\n4 — Ndigqibe ukungayi`,
        af: `🏥 *Hospitaal Kontrole*\n\nJy is vroeër vandag na ${destination} verwys.\n\nHet jy by die hospitaal uitgekom?\n\n1 — Ja, ek is by die hospitaal\n2 — Ja, ek is gesien en huis toe gestuur\n3 — Nee, ek kon nie daar kom nie\n4 — Ek het besluit om nie te gaan nie`,
      };
      await sendWhatsAppMessage(item.phone, arrivalMsg[lang] || arrivalMsg['en']);
      await _supabase.from('follow_ups').update({ status: 'sent' }).eq('id', item.id);

      session.awaitingHospitalArrivalResponse = true;
      session.hospitalFollowUpId = item.id;
      session.hospitalReferralData = hospData;
      await saveSession(patientId, session);

    } else if (item.type === 'hospital_discharge_check') {
      // 5 days after escalation — still in hospital or discharged?
      // Most medical admissions resolve within 3-7 days.
      let hospData = {};
      try { hospData = JSON.parse(item.data || '{}'); } catch (e) {}
      const destination = hospData.destination || 'the hospital';

      const dischargeMsg = {
        en: `🏥 *Follow-Up After Hospital Visit*\n\nYou were referred to ${destination} a few days ago. We hope you are recovering well.\n\nHow are you doing?\n\n1 — Still in hospital\n2 — Discharged and feeling better\n3 — Discharged but still not well\n4 — I was not admitted / did not go`,
        zu: `🏥 *Ukulandelela Emva Kwesibhedlela*\n\nUthunyelwe e-${destination} ezinsukwini ezimbalwa ezedlule. Sethemba uyalulama.\n\nUnjani?\n\n1 — Ngisesibhedlela\n2 — Ngikhishiwe futhi ngizizwa ngcono\n3 — Ngikhishiwe kodwa angikaphili kahle\n4 — Angibhaliswanga / angiyanga`,
        xh: `🏥 *Ukulandelela Emva Kwesibhedlele*\n\nUthunyelwe e-${destination} kwiintsuku ezimbalwa ezidlulileyo. Sithemba uyaphila.\n\nUnjani?\n\n1 — Ndisesibhedlele\n2 — Ndikhutshiwe ndiziva ngcono\n3 — Ndikhutshiwe kodwa andikaphili kakuhle\n4 — Andibhaliswanga / andiyanga`,
        af: `🏥 *Opvolg Na Hospitaalbesoek*\n\nJy is \'n paar dae gelede na ${destination} verwys. Ons hoop jy herstel goed.\n\nHoe gaan dit?\n\n1 — Nog in die hospitaal\n2 — Ontslaan en voel beter\n3 — Ontslaan maar nog nie goed nie\n4 — Ek is nie opgeneem nie / het nie gegaan nie`,
      };
      await sendWhatsAppMessage(item.phone, dischargeMsg[lang] || dischargeMsg['en']);
      await _supabase.from('follow_ups').update({ status: 'sent' }).eq('id', item.id);

      session.awaitingHospitalDischargeResponse = true;
      session.hospitalDischargeFollowUpId = item.id;
      session.hospitalDischargeData = hospData;
      await saveSession(patientId, session);

    } else if (item.type === 'script_renewal_reminder') {
      // Script renewal reminder — 6-month prescription expiry
      const renewalMsg = {
        en: `📋 *Prescription Renewal Reminder*\n\nYour chronic medication script may be due for renewal. Scripts are valid for 6 months.\n\nPlease visit your clinic to see the doctor for a script review. Bring:\n• Clinic card\n• ID document\n• Current medication\n\nIf you cannot visit this week, type *0* for help.`,
        zu: `📋 *Isikhumbuzo Sokuvuselela Iresiphi*\n\nIresiphi yakho yomuthi wamahlalakhona ingase idinge ukuvuselelwa. Izikripthi zisebenza izinyanga ezi-6.\n\nSicela uvakashele umtholampilo wakho ukubona udokotela. Letha:\n• Ikhadi lasemtholampilo\n• Incwadi yesazisi\n• Umuthi owuthathayo\n\nUma ungakwazi ukuvakashela kuleli viki, bhala *0*.`,
        xh: `📋 *Isikhumbuzo Sokuhlaziya Iresiphi*\n\nIresiphi yakho yamayeza aqhelekileyo inokudinga ukuhlaziywa. Iiskripthi zisebenza iinyanga ezi-6.\n\nNceda utyelele ikliniki yakho ukubona ugqirha. Zisa:\n• Ikhadi lasekliniki\n• Isazisi\n• Amayeza owathathayo\n\nUkuba awukwazi ukutyelela kule veki, bhala *0*.`,
        af: `📋 *Voorskrif Hernuwing Herinnering*\n\nJou chroniese medikasie voorskrif mag hernuwing nodig hê. Voorskrifte is geldig vir 6 maande.\n\nBesoek asseblief jou kliniek om die dokter te sien. Bring:\n• Kliniekkaart\n• ID-dokument\n• Huidige medikasie\n\nAs jy nie hierdie week kan besoek nie, tik *0*.`,
      };
      await sendWhatsAppMessage(item.phone, renewalMsg[lang] || renewalMsg['en']);
      await _supabase.from('follow_ups').update({ status: 'sent' }).eq('id', item.id);

    } else if (item.type === 'treatment_adherence') {
      // Treatment adherence check — 48h post-visit medication compliance
      let adhData = {};
      try { adhData = JSON.parse(item.data || '{}'); } catch (e) {}
      const meds = (adhData.medications || []).join(', ') || 'your medication';

      const adhMsg = {
        en: `💊 *Medication Check-In*\n\nYou were given ${meds} 2 days ago. Are you taking it as prescribed?\n\n1 — Yes, taking it correctly ✅\n2 — I missed some doses ⚠️\n3 — I stopped taking it ❌\n4 — I had side effects 🤒`,
        zu: `💊 *Ukuhlola Umuthi*\n\nUnikezwe ${meds} izinsuku ezi-2 ezedlule. Uyawuthatha njengoba uwunikeziwe?\n\n1 — Yebo, ngiwuthatha kahle ✅\n2 — Ngiphuthelwe izikhathi ⚠️\n3 — Ngiyekile ukuwuthatha ❌\n4 — Ngibe nemiphumela emibi 🤒`,
        xh: `💊 *Ukuhlola Amayeza*\n\nUnikwe ${meds} kwiintsuku ezi-2 ezidlulileyo. Uyawathatha njengoko unikeziwe?\n\n1 — Ewe, ndiwathatha kakuhle ✅\n2 — Ndiphosile amaxesha ⚠️\n3 — Ndiyekile ukuwathatha ❌\n4 — Ndibe neziphumo ezimbi 🤒`,
        af: `💊 *Medikasie Kontrole*\n\nJy het ${meds} 2 dae gelede ontvang. Neem jy dit soos voorgeskryf?\n\n1 — Ja, neem dit korrek ✅\n2 — Ek het dosisse gemis ⚠️\n3 — Ek het opgehou ❌\n4 — Ek het newe-effekte gehad 🤒`,
        nso: `💊 *Go Hlahloba Dihlare*\n\nO filwe ${meds} mafelelong a matšatši a 2. Na o di nwa bjalo ka ge o laeditšwe?\n\n1 — Ee, ke di nwa gabotse ✅\n2 — Ke phuthetšwe dinako ⚠️\n3 — Ke tlogetše go di nwa ❌\n4 — Ke bile le ditlamorago tše mpe 🤒`,
        tn: `💊 *Go Tlhatlhoba Dimelemo*\n\nO filwe ${meds} malatsi a le 2 a a fetileng. A o a tsaya jaaka o laetswe?\n\n1 — Ee, ke a tsaya sentle ✅\n2 — Ke phuthetse dinako ⚠️\n3 — Ke tlogeletse go a tsaya ❌\n4 — Ke bile le ditlamorago tse di maswe 🤒`,
        st: `💊 *Ho Hlahloba Meriana*\n\nO filwe ${meds} matsatsi a 2 a fetileng. Na o e nwa joalo ka ha o laetswe?\n\n1 — E, ke e nwa hantle ✅\n2 — Ke phuthehile nako ⚠️\n3 — Ke tlohetse ho e nwa ❌\n4 — Ke bile le ditlamorago tse mpe 🤒`,
        ts: `💊 *Ku Kambela Mirhi*\n\nU nyikiwe ${meds} masiku ya 2 ya hundzeke. Xana u yi teka hilaha u laerisiweke?\n\n1 — Ina, ndzi yi teka kahle ✅\n2 — Ndzi hundzisile tikhawu ⚠️\n3 — Ndzi tshikile ku yi teka ❌\n4 — Ndzi vile na switandzhaku swo biha 🤒`,
        ss: `💊 *Kuhlola Imitsi*\n\nUnikwe ${meds} emalangeni la-2 edlulile. Uyayitfola njengoba unikwe?\n\n1 — Yebo, ngiyitfola kahle ✅\n2 — Ngigecile tikhatsi ⚠️\n3 — Ngiyekile kuyitfola ❌\n4 — Ngibe nemiphumela lemibi 🤒`,
        ve: `💊 *U Ṱolisisa Mushonga*\n\nNo ṋewa ${meds} maḓuvha a 2 o fhelaho. Naa ni a u nwa sa zwe na laedzwa?\n\n1 — Ee, ndi a u nwa zwavhuḓi ✅\n2 — Ndo xedza tshifhinga ⚠️\n3 — Ndo litsha u u nwa ❌\n4 — Ndo vha na mvelelo dzi si dzavhuḓi 🤒`,
        nr: `💊 *Ukuhlola Imitjhoga*\n\nUnikwe ${meds} emalangeni la-2 edlulile. Uyayithatha njengoba unikwe?\n\n1 — Iye, ngiyithatha kahle ✅\n2 — Ngigecile tikhatsi ⚠️\n3 — Ngiyekile kuyithatha ❌\n4 — Ngibe nemiphumela emibi 🤒`,
      };
      await sendWhatsAppMessage(item.phone, adhMsg[lang] || adhMsg['en']);
      await _supabase.from('follow_ups').update({ status: 'sent' }).eq('id', item.id);

      session.awaitingAdherenceResponse = true;
      session.adherenceFollowUpId = item.id;
      await saveSession(patientId, session);

    } else if (item.type === 'anc_visit_reminder') {
      // Antenatal visit reminder — SA DoH ANC schedule
      let ancData = {};
      try { ancData = JSON.parse(item.data || '{}'); } catch (e) {}
      const weeks = ancData.gestational_weeks_at_reminder || '';
      const trimester = ancData.trimester || '';

      const ancMsg = {
        en: `🤰 *Antenatal Visit Reminder*\n\nYou are due for your ${weeks ? weeks + '-week' : 'next'} antenatal check-up${trimester ? ' (trimester ' + trimester + ')' : ''}.\n\n📋 Please bring:\n• Maternity case record (antenatal card)\n• ID document\n• Urine sample (first morning urine)\n\nPlease visit your clinic this week.\n\nIf you have any concerns before your visit, type *0*.`,
        zu: `🤰 *Isikhumbuzo Sokuvakashela Kwabakhulelwe*\n\nSikufanele ukuvakashela kwakho ${weeks ? 'kwamaviki angu-' + weeks : 'okulandelayo'} kokukhulelwa${trimester ? ' (trimester ' + trimester + ')' : ''}.\n\n📋 Letha:\n• Ikhadi lomama\n• Incwadi yesazisi\n• Isampula yomchamo\n\nSicela uvakashele umtholampilo kuleli viki.\n\nUma unezinkinga ngaphambi kokuvakashela, bhala *0*.`,
        xh: `🤰 *Isikhumbuzo Sotyelelo Lwabakhulelweyo*\n\nUfanele utyelelo lwakho ${weeks ? 'lweeveki ezingu-' + weeks : 'olulandelayo'} lokukhulelwa${trimester ? ' (trimester ' + trimester + ')' : ''}.\n\n📋 Zisa:\n• Irekhodi yomama\n• Isazisi\n• Isampulu yomchamo\n\nNceda utyelele ikliniki yakho kule veki.\n\nUkuba unengxaki phambi kotyelelo, bhala *0*.`,
        af: `🤰 *Voorgeboorte Besoek Herinnering*\n\nJou ${weeks ? weeks + '-week' : 'volgende'} voorgeboorte ondersoek is verskuldig${trimester ? ' (trimester ' + trimester + ')' : ''}.\n\n📋 Bring:\n• Kraamgevalleboek\n• ID-dokument\n• Urienmonster\n\nBesoek asseblief jou kliniek hierdie week.\n\nAs jy enige bekommernisse het voor jou besoek, tik *0*.`,
      };
      await sendWhatsAppMessage(item.phone, ancMsg[lang] || ancMsg['en']);
      await _supabase.from('follow_ups').update({ status: 'sent' }).eq('id', item.id);

    } else if (item.type === 'satisfaction_survey') {
      // Patient satisfaction survey — DoH Exit Process
      let surveyData = {};
      try { surveyData = JSON.parse(item.data || '{}'); } catch (e) {}
      const facilityName = surveyData.facility_name || 'the clinic';

      const surveyMsg = {
        en: `📊 *Quick Survey*\n\nHow was your experience at ${facilityName} today?\n\n1 — ⭐ Very poor\n2 — ⭐⭐ Poor\n3 — ⭐⭐⭐ Average\n4 — ⭐⭐⭐⭐ Good\n5 — ⭐⭐⭐⭐⭐ Excellent\n\nYour feedback helps us improve.`,
        zu: `📊 *Umbono Omfushane*\n\nInjani indlela ophathwe ngayo e-${facilityName} namuhla?\n\n1 — ⭐ Kubi kakhulu\n2 — ⭐⭐ Kubi\n3 — ⭐⭐⭐ Kujwayelekile\n4 — ⭐⭐⭐⭐ Kuhle\n5 — ⭐⭐⭐⭐⭐ Kuhle kakhulu\n\nUmbono wakho uyasisiza sithuthuke.`,
        xh: `📊 *Uphando Olufutshane*\n\nInjani indlela ophathwe ngayo e-${facilityName} namhlanje?\n\n1 — ⭐ Imbi kakhulu\n2 — ⭐⭐ Imbi\n3 — ⭐⭐⭐ Iqhelekile\n4 — ⭐⭐⭐⭐ Intle\n5 — ⭐⭐⭐⭐⭐ Intle kakhulu\n\nImpendulo yakho iyasinceda siphuculwe.`,
        af: `📊 *Vinnige Opname*\n\nHoe was jou ervaring by ${facilityName} vandag?\n\n1 — ⭐ Baie swak\n2 — ⭐⭐ Swak\n3 — ⭐⭐⭐ Gemiddeld\n4 — ⭐⭐⭐⭐ Goed\n5 — ⭐⭐⭐⭐⭐ Uitstekend\n\nJou terugvoer help ons verbeter.`,
        nso: `📊 *Dinyakišišo tše Kopana*\n\nO ikwele bjang go ${facilityName} lehono?\n\n1 — ⭐ Go bobe kudu\n2 — ⭐⭐ Go bobe\n3 — ⭐⭐⭐ Go lekane\n4 — ⭐⭐⭐⭐ Go botse\n5 — ⭐⭐⭐⭐⭐ Go botse kudu\n\nKanego ya gago e re thuša go kaonafatša.`,
        tn: `📊 *Dipatlisiso tse Khutshwane*\n\nO ikutlwile jang kwa ${facilityName} gompieno?\n\n1 — ⭐ Go maswe thata\n2 — ⭐⭐ Go maswe\n3 — ⭐⭐⭐ Go lekane\n4 — ⭐⭐⭐⭐ Go siame\n5 — ⭐⭐⭐⭐⭐ Go siame thata\n\nMaikutlo a gago a re thusa go tokafatsa.`,
        st: `📊 *Dipatlisiso tse Kgutshwanyane*\n\nO ikutlwile joang ho ${facilityName} kajeno?\n\n1 — ⭐ Ho be haholo\n2 — ⭐⭐ Ho be\n3 — ⭐⭐⭐ Ho lekane\n4 — ⭐⭐⭐⭐ Ho hantle\n5 — ⭐⭐⭐⭐⭐ Ho hantle haholo\n\nMaikutlo a hao a re thusa ho ntlafatsa.`,
        ts: `📊 *Vulavisisi bya Ku Hatlisa*\n\nU tikwe njhani eka ${facilityName} namuntlha?\n\n1 — ⭐ Swo biha ngopfu\n2 — ⭐⭐ Swo biha\n3 — ⭐⭐⭐ Swi lekile\n4 — ⭐⭐⭐⭐ Swinene\n5 — ⭐⭐⭐⭐⭐ Swinene ngopfu\n\nMavonelo ya wena ya hi pfuna ku antswisa.`,
        ss: `📊 *Lucwaningo Lolufisha*\n\nInjani indlela lophatswe ngayo e-${facilityName} lamuhla?\n\n1 — ⭐ Kubi kakhulu\n2 — ⭐⭐ Kubi\n3 — ⭐⭐⭐ Kulingene\n4 — ⭐⭐⭐⭐ Kuhle\n5 — ⭐⭐⭐⭐⭐ Kuhle kakhulu\n\nUmbono wakho uyasita kutsi siphuculeke.`,
        ve: `📊 *Ṱhoḓisiso ya Zwifhinga*\n\nNo ḓipfa hani kha ${facilityName} ṋamusi?\n\n1 — ⭐ Zwi vhifha nga maanḓa\n2 — ⭐⭐ Zwi vhifha\n3 — ⭐⭐⭐ Zwi fhira\n4 — ⭐⭐⭐⭐ Zwavhuḓi\n5 — ⭐⭐⭐⭐⭐ Zwavhuḓi nga maanḓa\n\nMbuno dzaṋu dzi ri thusa u khwinisa.`,
        nr: `📊 *Ucwaningo Olufitjhani*\n\nInjani indlela ophathwe ngayo e-${facilityName} namuhla?\n\n1 — ⭐ Kumbi khulu\n2 — ⭐⭐ Kumbi\n3 — ⭐⭐⭐ Kujayelekile\n4 — ⭐⭐⭐⭐ Kuhle\n5 — ⭐⭐⭐⭐⭐ Kuhle khulu\n\nUmbono wakho usisiza kutsi siphuculeke.`,
      };
      await sendWhatsAppMessage(item.phone, surveyMsg[lang] || surveyMsg['en']);
      await _supabase.from('follow_ups').update({ status: 'sent' }).eq('id', item.id);

      // Set session flag to capture satisfaction response
      session.awaitingSatisfactionSurvey = true;
      session.satisfactionFollowUpId = item.id;
      session.satisfactionFacility = surveyData.facility_name || null;
      await saveSession(patientId, session);

    } else if (item.type === 'dispensing_confirmation') {
      // Dispensing confirmation — ask patient if they received their medication
      let dispData = {};
      try { dispData = JSON.parse(item.data || '{}'); } catch (e) {}
      const facilityName = dispData.facility_name || 'the clinic';
      const medLabels = { prescription: 'Prescription', chronic_meds: 'Chronic medication', otc: 'Over-the-counter medication' };
      const medList = (dispData.medications || []).map(m => medLabels[m] || m).join(', ') || 'your medication';

      const dispMsg = {
        en: `💊 *Medication Check*\n\nDid you receive your medication (${medList}) from ${facilityName}?\n\n1 — Yes, I received it ✅\n2 — No, I was told to come back ⏳\n3 — No, there was a stockout ❌\n4 — I haven't been to the pharmacy yet`,
        zu: `💊 *Ukuhlola Umuthi*\n\nUwutholile umuthi wakho (${medList}) e-${facilityName}?\n\n1 — Yebo, ngiwutholile ✅\n2 — Cha, bangitshele ukubuya ⏳\n3 — Cha, umuthi ubungekho ❌\n4 — Angikaze ngiye ekhemisi`,
        xh: `💊 *Ukuhlola Amayeza*\n\nUwafumene amayeza akho (${medList}) e-${facilityName}?\n\n1 — Ewe, ndiwafumene ✅\n2 — Hayi, banditshilo ukuba ndibuye ⏳\n3 — Hayi, ayephele ❌\n4 — Andikabikho ekemisti`,
        af: `💊 *Medikasie Kontrole*\n\nHet jy jou medikasie (${medList}) van ${facilityName} ontvang?\n\n1 — Ja, ek het dit ontvang ✅\n2 — Nee, ek moet terugkom ⏳\n3 — Nee, dit was uit voorraad ❌\n4 — Ek was nog nie by die apteek nie`,
        nso: `💊 *Go Hlahloba Dihlare*\n\nO amogetše dihlare tša gago (${medList}) go tšwa go ${facilityName}?\n\n1 — Ee, ke di amogetše ✅\n2 — Aowa, ba mpoditše go boa ⏳\n3 — Aowa, di fedile ❌\n4 — Ga ke eso ye khemisi`,
        tn: `💊 *Go Tlhatlhoba Dimelemo*\n\nA o amogetse dimelemo tsa gago (${medList}) go tswa go ${facilityName}?\n\n1 — Ee, ke di amogetse ✅\n2 — Nnyaa, ba mpoleletse go boa ⏳\n3 — Nnyaa, di fedile ❌\n4 — Ga ke eso ye kwa khemisi`,
        st: `💊 *Ho Hlahloba Meriana*\n\nO amohetse meriana ya hao (${medList}) ho tswa ho ${facilityName}?\n\n1 — E, ke e amohetse ✅\n2 — Tjhe, ba mpoleletse ho kgutla ⏳\n3 — Tjhe, e ne e fedile ❌\n4 — Ha ke eso ye khemisi`,
        ts: `💊 *Ku Kambela Mirhi*\n\nU amukerile mirhi ya wena (${medList}) eka ${facilityName}?\n\n1 — Ina, ndzi yi amukerile ✅\n2 — Ee-ee, va ndzi byerile ku vuya ⏳\n3 — Ee-ee, a yi va kona ❌\n4 — A ndzi ya ekhemisi`,
        ss: `💊 *Kuhlola Imitsi*\n\nUyitfolile imitsi yakho (${medList}) ku-${facilityName}?\n\n1 — Yebo, ngiyitfolile ✅\n2 — Cha, bangitjele kubuya ⏳\n3 — Cha, beyingekho ❌\n4 — Angikaze ngiye ekhemisi`,
        ve: `💊 *U Ṱolisisa Mushonga*\n\nNo wana mushonga waṋu (${medList}) kha ${facilityName}?\n\n1 — Ee, ndo u wana ✅\n2 — Hai, vho mmbofha uri ndi vhuye ⏳\n3 — Hai, wo fhela ❌\n4 — A thi athu ya kha khemisi`,
        nr: `💊 *Ukuhlola Imitjhoga*\n\nUyitholile imitjhoga yakho (${medList}) ku-${facilityName}?\n\n1 — Iye, ngiyitholile ✅\n2 — Awa, bangitjele ukubuya ⏳\n3 — Awa, beyingekho ❌\n4 — Angikaze ngiye ekhemisi`,
      };
      await sendWhatsAppMessage(item.phone, dispMsg[lang] || dispMsg['en']);
      await _supabase.from('follow_ups').update({ status: 'sent' }).eq('id', item.id);

      // Set session flag to capture dispensing response
      session.awaitingDispensingConfirmation = true;
      session.dispensingFollowUpId = item.id;
      await saveSession(patientId, session);

    } else {
      // 72h symptom check (type: 'symptom_check' or legacy null)
      // If the 24h check-in was sent but never responded to, flag as no_response
      const { data: unansweredCheckIn } = await _supabase.from('follow_ups')
        .select('id')
        .eq('patient_id', item.patient_id)
        .eq('type', 'check_in')
        .eq('status', 'sent')
        .limit(1);
      if (unansweredCheckIn && unansweredCheckIn.length > 0) {
        await _supabase.from('follow_ups')
          .update({ status: 'no_response' })
          .eq('id', unansweredCheckIn[0].id);
        logger.info(`[FOLLOW_UP] No response to 24h check-in for patient ${item.patient_id} — flagged`);
      }
      await sendWhatsAppMessage(item.phone, msg('follow_up', lang));
      await _supabase.from('follow_ups').update({ status: 'sent' }).eq('id', item.id);
    }
  }
}


module.exports = {
  init,
  schedulePhase2FollowUp,
  runAbandonedSessionAgent,
  runFollowUpAgent,
};
