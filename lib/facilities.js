'use strict';
const logger = require('../logger');

const FACILITY_CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes
const _facilityCache = { data: null, expiresAt: 0 };

// Dependencies injected at startup — avoids circular requires
let _supabase = null;
let _msg = null;
let _sendWhatsAppMessage = null;

function init(supabase, msg, sendWhatsAppMessage) {
  _supabase = supabase;
  _msg = msg;
  _sendWhatsAppMessage = sendWhatsAppMessage;
}

async function getFacilities() {
  if (_facilityCache.data && Date.now() < _facilityCache.expiresAt) {
    return _facilityCache.data;
  }
  const { data } = await _supabase.from('facilities').select('*');
  _facilityCache.data = data || [];
  _facilityCache.expiresAt = Date.now() + FACILITY_CACHE_TTL_MS;
  return _facilityCache.data;
}

function getDistance(lat1, lng1, lat2, lng2) {
  const R = 6371;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLng = (lng2 - lng1) * Math.PI / 180;
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
    Math.sin(dLng / 2) * Math.sin(dLng / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

async function findNearestFacilities(patientLocation, type, limit = 3) {
  if (!patientLocation) return [];
  const facilities = await getFacilities();
  const results = [];
  for (const facility of facilities) {
    if (type && facility.type !== type) continue;
    const dist = getDistance(
      patientLocation.latitude, patientLocation.longitude,
      facility.latitude, facility.longitude
    );
    results.push({ ...facility, distance: Math.round(dist * 10) / 10 });
  }
  results.sort((a, b) => a.distance - b.distance);
  return results.slice(0, limit);
}

function getFacilityHoursStr(facility) {
  // Use facility-specific hours if available (from opening_hours column)
  if (facility && facility.opening_hours) return facility.opening_hours;
  // Fallback to type-based defaults
  const type = (facility && facility.type) ? facility.type.toLowerCase() : '';
  if (type === 'hospital') return '24 hours';
  if (type === 'chc') return 'Mon–Fri 07:00–20:00';
  return 'Mon–Fri 07:00–16:00';
}

async function getQueueInfo(facilityName) {
  if (!_supabase || !facilityName) return null;
  try {
    // Count patients currently waiting at this facility
    const { data: waiting } = await _supabase
      .from('clinic_queue')
      .select('checked_in_at, triage_level')
      .eq('facility_name', facilityName)
      .eq('status', 'waiting');

    const waitingCount = (waiting || []).length;
    if (waitingCount === 0) return { waiting: 0, estimatedMinutes: 0 };

    // Calculate average wait from today's completed patients at this facility
    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);

    const { data: completed } = await _supabase
      .from('clinic_queue')
      .select('checked_in_at, called_at')
      .eq('facility_name', facilityName)
      .eq('status', 'completed')
      .gte('completed_at', todayStart.toISOString())
      .not('called_at', 'is', null);

    let avgMinutes = 30; // default fallback
    if (completed && completed.length >= 3) {
      const waits = completed
        .map(p => (new Date(p.called_at) - new Date(p.checked_in_at)) / 60000)
        .filter(w => w > 0 && w < 480); // exclude outliers
      if (waits.length > 0) {
        avgMinutes = Math.round(waits.reduce((a, b) => a + b, 0) / waits.length);
      }
    }

    // Estimate based on people ahead
    const estimatedMinutes = Math.round(avgMinutes * (waitingCount * 0.7)); // 0.7 factor: not everyone waits full avg

    return {
      waiting: waitingCount,
      estimatedMinutes: Math.min(estimatedMinutes, 300), // cap at 5 hours
      avgMinutes,
    };
  } catch (e) {
    logger.error('[QUEUE-INFO] Failed to get queue info:', e.message);
    return null;
  }
}

function formatQueueInfo(queueInfo, lang) {
  if (!queueInfo || queueInfo.waiting === 0) {
    const empty = {
      en: '👥 No queue — clinic is quiet right now',
      zu: '👥 Akekho olindile — umtholampilo uthule manje',
      xh: '👥 Akukho mngcelele — ikliniki ithule ngoku',
      af: '👥 Geen tou nie — kliniek is stil op die oomblik',
      nso: '👥 Ga go molokoloko — kliniki e hwetše bjale',
      tn: '👥 Ga go mola — kliniki e didimetse jaanong',
      st: '👥 Ha ho molokoloko — kliniki e kgutsitse hona joale',
      ts: '👥 A ku na mulongoti — kliniki yi rhurile sweswi',
      ss: '👥 Akekho umugca — umtfolamphilo uthulile nyalo',
      ve: '👥 A hu na mulayini — kiliniki yo dzika zwino',
      nr: '👥 Akekho umugqa — umtholampilo uthulile nje',
    };
    return empty[lang] || empty.en;
  }

  const w = queueInfo.waiting;
  const est = queueInfo.estimatedMinutes;
  const timeStr = est < 60 ? `~${est} min` : `~${Math.round(est / 60)}h ${est % 60}min`;

  const busy = {
    en: `👥 ${w} patient${w > 1 ? 's' : ''} waiting · Est. wait: *${timeStr}*`,
    zu: `👥 ${w} ${w > 1 ? 'iziguli zilindile' : 'isiguli silindile'} · Isikhathi sokulinda: *${timeStr}*`,
    xh: `👥 ${w} ${w > 1 ? 'izigulana zilindile' : 'isigulana silindile'} · Ixesha lokulinda: *${timeStr}*`,
    af: `👥 ${w} pasiënt${w > 1 ? 'e' : ''} wag · Geskatte wag: *${timeStr}*`,
    nso: `👥 ${w} ${w > 1 ? 'balwetši ba emetše' : 'molwetši o emetše'} · Nako ya go ema: *${timeStr}*`,
    tn: `👥 ${w} ${w > 1 ? 'balwetsi ba emetse' : 'molwetsi o emetse'} · Nako ya go ema: *${timeStr}*`,
    st: `👥 ${w} ${w > 1 ? 'bakudi ba emetseng' : 'mokudi o emetseng'} · Nako ya ho ema: *${timeStr}*`,
    ts: `👥 ${w} ${w > 1 ? 'vavabyi va rindzele' : 'muvabyi u rindzele'} · Nkarhi wo rindza: *${timeStr}*`,
    ss: `👥 ${w} ${w > 1 ? 'tigulane tilindile' : 'sigulane silindile'} · Sikhatsi sekulindza: *${timeStr}*`,
    ve: `👥 ${w} ${w > 1 ? 'vhalwadze vho lindela' : 'mulwadze o lindela'} · Tshifhinga tsha u lindela: *${timeStr}*`,
    nr: `👥 ${w} ${w > 1 ? 'abagulako balindile' : 'umgulako ulindile'} · Isikhathi sokulinda: *${timeStr}*`,
  };
  return busy[lang] || busy.en;
}

async function sendFacilitySuggest(from, lang, nearest, triageLevel) {
  const hoursStr = getFacilityHoursStr(nearest);
  const base = _msg('facility_suggest', lang, nearest.name, nearest.distance);

  // Suppress queue wait info for RED/ORANGE — urgency overrides convenience
  // A RED patient reading "Est. wait: ~45 min" might decide to wait at home
  const isUrgent = triageLevel === 'RED' || triageLevel === 'ORANGE';
  let queueLine = '';
  if (!isUrgent) {
    const queueInfo = await getQueueInfo(nearest.name);
    queueLine = '\n' + formatQueueInfo(queueInfo, lang);
  }

  const enhanced = base.replace('\n\n', `\n🕐 ${hoursStr}${queueLine}\n\n`);
  await _sendWhatsAppMessage(from, enhanced);
}

module.exports = { init, getFacilities, findNearestFacilities, getDistance, getFacilityHoursStr, sendFacilitySuggest };
