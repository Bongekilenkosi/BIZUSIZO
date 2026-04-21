'use strict';
// SMS Gateway — Multi-provider, Africa's Talking recommended for pilot
// Activated by setting SMS_PROVIDER in .env (africastalking | clickatell | bulksms)
//
// Supported providers:
//   africastalking — RECOMMENDED: cheapest for SA (~R0.18/SMS), instant API key,
//                    free sandbox, used by M-Pesa/Safaricom + African healthtech
//   clickatell     — SA-founded, NHI partnerships, gov integrations (~R0.25–0.40/SMS)
//   bulksms        — SA-based, reliable (~R0.22/SMS)
//
// Africa's Talking setup (5 minutes):
//   1. Sign up at africastalking.com → "I'm a Developer"
//   2. Settings → API Key (available immediately)
//   3. Free sandbox for testing before go-live
//
// Env vars for Africa's Talking:
//   SMS_PROVIDER=africastalking
//   AT_API_KEY=<your key from dashboard>
//   AT_USERNAME=<your username, or "sandbox" for testing>
//   AT_SENDER_ID=BIZUSIZO              (optional, requires AT approval)
//
// Env vars for Clickatell (alternative — NHI credibility):
//   SMS_PROVIDER=clickatell
//   CLICKATELL_API_KEY=<your key>
//   CLICKATELL_REVERSE_BILLING=true   (optional, default false)
//   CLICKATELL_SENDER_ID=BIZUSIZO     (optional)
//   CLICKATELL_CALLBACK_URL=<url>     (optional, for delivery receipts + inbound)
const logger = require('../logger');

const SMS_PROVIDER = process.env.SMS_PROVIDER || null; // null = disabled
const SMS_ENABLED = !!SMS_PROVIDER;

// ── Daily SMS quota tracking ──────────────────────────────────
const SMS_DAILY_LIMIT = parseInt(process.env.SMS_DAILY_LIMIT) || 200;
const _dailySms = { date: '', count: 0 };

function trackDailySms() {
  const today = new Date().toISOString().slice(0, 10);
  if (_dailySms.date !== today) { _dailySms.date = today; _dailySms.count = 0; }
  _dailySms.count++;
}

function getDailySmsStatus() {
  const today = new Date().toISOString().slice(0, 10);
  if (_dailySms.date !== today) return { count: 0, date: today, limit: SMS_DAILY_LIMIT, enabled: SMS_ENABLED };
  return { ..._dailySms, limit: SMS_DAILY_LIMIT, enabled: SMS_ENABLED };
}

// ── Provider: Clickatell (PREFERRED) ─────────────────────────
// SA-founded, existing NHI partnerships, government health system
// integrations. Preferred for public-sector pilot alignment.
// Uses Platform API v2: https://docs.clickatell.com/channels/sms-api-reference/
async function sendViaClickatell(to, text, options = {}) {
  const fetch = require('node-fetch');
  const apiKey = process.env.CLICKATELL_API_KEY;

  if (!apiKey) {
    logger.error('[SMS] Clickatell credentials missing (CLICKATELL_API_KEY)');
    return false;
  }

  const senderId = process.env.CLICKATELL_SENDER_ID || null;
  const reverseBilling = process.env.CLICKATELL_REVERSE_BILLING === 'true';
  const callbackUrl = process.env.CLICKATELL_CALLBACK_URL || null;

  // Detect if message contains non-GSM characters (isiZulu/isiXhosa/Tshivenda)
  // Unicode = 70 chars/segment vs GSM = 160 chars/segment
  const isUnicode = /[^\x20-\x7E\n\r]/.test(text);

  const messagePayload = {
    to,
    content: text,
  };

  // Clickatell message-level options
  if (isUnicode) messagePayload.charset = 'UTF-8';
  if (senderId) messagePayload.from = senderId;
  if (reverseBilling) messagePayload.binary = false; // reverse-billing flag

  const requestBody = {
    channel: 'sms',
    messages: [messagePayload],
  };

  // Callback URL for delivery receipts (audit trail)
  if (callbackUrl) requestBody.callback = callbackUrl;

  const res = await fetch('https://platform.clickatell.com/messages', {
    method: 'POST',
    headers: {
      Authorization: apiKey,
      'Content-Type': 'application/json',
      Accept: 'application/json',
    },
    body: JSON.stringify(requestBody),
  });

  if (!res.ok) {
    const body = await res.text().catch(() => 'no body');
    logger.error(`[SMS] Clickatell send failed: ${res.status} — ${body}`);
    return false;
  }

  const result = await res.json();
  const msg = result?.messages?.[0];
  if (msg?.accepted) {
    const segments = isUnicode ? Math.ceil(text.length / 70) : Math.ceil(text.length / 160);
    logger.info(`[SMS] Sent to ${to.slice(0, 6)}*** via Clickatell` +
      ` (id: ${msg.apiMessageId || '—'}, segments: ${segments}, unicode: ${isUnicode}` +
      `${reverseBilling ? ', reverse-billed' : ''})`);
    return true;
  }

  logger.error(`[SMS] Clickatell delivery issue: ${msg?.errorDescription || JSON.stringify(result)}`);
  return false;
}

// ── Provider: Africa's Talking ────────────────────────────────
async function sendViaAfricasTalking(to, text) {
  const fetch = require('node-fetch');
  const apiKey = process.env.AT_API_KEY;
  const username = process.env.AT_USERNAME;
  const senderId = process.env.AT_SENDER_ID || 'BIZUSIZO';

  if (!apiKey || !username) {
    logger.error('[SMS] Africa\'s Talking credentials missing (AT_API_KEY, AT_USERNAME)');
    return false;
  }

  const baseUrl = username === 'sandbox'
    ? 'https://api.sandbox.africastalking.com/version1/messaging'
    : 'https://api.africastalking.com/version1/messaging';

  const params = new URLSearchParams();
  params.append('username', username);
  params.append('to', to);
  params.append('message', text);
  // Sender ID not supported in sandbox — only use in production
  if (senderId && username !== 'sandbox') params.append('from', senderId);

  const res = await fetch(baseUrl, {
    method: 'POST',
    headers: {
      apiKey: apiKey,
      'Content-Type': 'application/x-www-form-urlencoded',
      Accept: 'application/json',
    },
    body: params.toString(),
  });

  if (!res.ok) {
    const body = await res.text().catch(() => 'no body');
    logger.error(`[SMS] Africa's Talking send failed: ${res.status} — ${body}`);
    return false;
  }

  const result = await res.json();
  const recipient = result?.SMSMessageData?.Recipients?.[0];
  if (recipient?.statusCode === 101) {
    logger.info(`[SMS] Sent to ${to.slice(0, 6)}*** via Africa's Talking (cost: ${recipient.cost})`);
    return true;
  }

  logger.error(`[SMS] Africa's Talking delivery issue: ${recipient?.status || JSON.stringify(result)}`);
  return false;
}

// ── Provider: BulkSMS ─────────────────────────────────────────
async function sendViaBulkSMS(to, text) {
  const fetch = require('node-fetch');
  const tokenId = process.env.BULKSMS_TOKEN_ID;
  const tokenSecret = process.env.BULKSMS_TOKEN_SECRET;

  if (!tokenId || !tokenSecret) {
    logger.error('[SMS] BulkSMS credentials missing (BULKSMS_TOKEN_ID, BULKSMS_TOKEN_SECRET)');
    return false;
  }

  const res = await fetch('https://api.bulksms.com/v1/messages', {
    method: 'POST',
    headers: {
      Authorization: 'Basic ' + Buffer.from(`${tokenId}:${tokenSecret}`).toString('base64'),
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ to, body: text }),
  });

  if (!res.ok) {
    const body = await res.text().catch(() => 'no body');
    logger.error(`[SMS] BulkSMS send failed: ${res.status} — ${body}`);
    return false;
  }

  logger.info(`[SMS] Sent to ${to.slice(0, 6)}*** via BulkSMS`);
  return true;
}

// ── Main send function ────────────────────────────────────────
async function sendSMS(to, text) {
  if (!SMS_ENABLED) {
    logger.warn('[SMS] SMS not enabled — set SMS_PROVIDER in .env');
    return false;
  }

  // Enforce daily limit
  if (_dailySms.date === new Date().toISOString().slice(0, 10) && _dailySms.count >= SMS_DAILY_LIMIT) {
    logger.warn(`[SMS] Daily limit reached (${SMS_DAILY_LIMIT})`);
    return false;
  }
  trackDailySms();

  // Multi-segment support: allow up to 3 GSM segments (480 chars) or ~3 Unicode segments (210 chars)
  // Clickatell handles multipart natively; truncate only as last resort
  const isUnicode = /[^\x20-\x7E\n\r]/.test(text);
  const maxLen = isUnicode ? 201 : 459; // 3 segments for each encoding
  const truncated = text.length > maxLen ? text.slice(0, maxLen - 3) + '...' : text;

  try {
    switch (SMS_PROVIDER) {
      case 'clickatell':     return await sendViaClickatell(to, truncated);
      case 'africastalking': return await sendViaAfricasTalking(to, truncated);
      case 'bulksms':        return await sendViaBulkSMS(to, truncated);
      default:
        logger.error(`[SMS] Unknown provider: ${SMS_PROVIDER}`);
        return false;
    }
  } catch (e) {
    logger.error(`[SMS] Send error: ${e.message}`);
    return false;
  }
}

// ── Inbound SMS handler (multi-provider two-way) ─────────────
// Handles inbound SMS callbacks from any configured provider.
// Register this route in index.js:
//   app.post('/api/sms/inbound', smsLib.handleInboundSMS)
//
// Patient texts their BZ code (e.g. "BZ-TM41") to the provider
// number and receives their health passport via SMS — no WhatsApp,
// no data, no smartphone needed.
//
// Callback formats:
//   Africa's Talking: { from, text }
//   Clickatell:       { fromNumber, text } or { moNumber, text }
let _supabase = null;
function init(supabase) { _supabase = supabase; }

async function handleInboundSMS(req, res) {
  try {
    // Normalise across provider callback formats
    const body = req.body;
    const phone = body.from || body.fromNumber || body.moNumber || null;
    const message = (body.text || '').trim().toUpperCase();

    if (!phone || !message) {
      return res.status(400).json({ error: 'Missing phone or message' });
    }

    logger.info(`[SMS-INBOUND] From ${phone.slice(0, 6)}***: "${message}"`);

    // Check if message looks like a BZ code
    const bzMatch = message.match(/^BZ-?([A-Z0-9]{4,6})$/i);
    if (!bzMatch) {
      // Not a BZ code — send help text
      await sendSMS(phone,
        'BIZUSIZO: Text your BZ code (e.g. BZ-TM41) to get your health summary. ' +
        'Find your code in your WhatsApp chat or ask at your clinic.'
      );
      return res.json({ handled: true });
    }

    if (!_supabase) {
      logger.error('[SMS-INBOUND] Supabase not initialised');
      await sendSMS(phone, 'BIZUSIZO: Service temporarily unavailable. Please try again later.');
      return res.json({ handled: false });
    }

    // Lookup patient by study code
    const codeInput = 'BZ-' + bzMatch[1].toUpperCase();
    const { data: codeRow } = await _supabase
      .from('study_codes')
      .select('patient_id')
      .eq('study_code', codeInput)
      .limit(1)
      .single();

    if (!codeRow) {
      await sendSMS(phone,
        'BIZUSIZO: Code not found. Check your BZ code and try again. ' +
        'Example: BZ-TM41'
      );
      return res.json({ handled: true });
    }

    const patientId = codeRow.patient_id;

    // Fetch session + recent triages
    const [sesRes, triRes] = await Promise.all([
      _supabase.from('sessions').select('data').eq('patient_id', patientId).single(),
      _supabase.from('triage_logs')
        .select('triage_level, symptoms, facility_name, created_at')
        .eq('patient_id', patientId)
        .order('created_at', { ascending: false })
        .limit(2),
    ]);

    const session = sesRes.data?.data || {};
    const triages = triRes.data || [];

    // Build and send compact SMS passport
    const smsText = buildPassportSMS(session, triages);
    const sent = await sendSMS(phone, smsText);

    if (sent) {
      // Log to audit
      await _supabase.from('passport_views').insert({
        patient_id: patientId,
        token: 'sms_inbound_' + codeInput,
        viewed_at: new Date().toISOString(),
        viewer_type: 'patient_sms',
        ip_address: req.headers['x-forwarded-for'] || req.socket?.remoteAddress || 'sms',
        user_agent: 'Clickatell-SMS-Inbound',
      }).catch(e => logger.error('[SMS-INBOUND] Audit log failed:', e.message));

      logger.info(`[SMS-INBOUND] Passport sent for ${codeInput} to ${phone.slice(0, 6)}***`);
    }

    res.json({ handled: true, sent });
  } catch (e) {
    logger.error('[SMS-INBOUND] Error:', e.message);
    res.status(500).json({ error: 'Server error' });
  }
}

// ── Build passport SMS (compact, fits 3 segments) ─────────────
// GSM: 3 × 153 = 459 chars (multipart headers reduce per-segment)
// Unicode: 3 × 67 = 201 chars (isiZulu/isiXhosa/Tshivenda)
function buildPassportSMS(session, recentTriages) {
  const name = [session.firstName, session.surname].filter(Boolean).join(' ') || '—';
  const dob = session.dob?.dob_string || '—';
  const bzCode = session.studyCode || '';
  const chronic = (session.chronicConditions || []).map(c => c.label_en || c.key).join(', ') || 'None';

  let visits = '';
  if (recentTriages && recentTriages.length > 0) {
    visits = recentTriages.slice(0, 2).map(t => {
      const d = new Date(t.created_at);
      const dateStr = `${d.getDate()}/${d.getMonth() + 1}/${d.getFullYear()}`;
      return `${dateStr} ${t.triage_level}${t.facility_name ? ' > ' + t.facility_name : ''}`;
    }).join(' | ');
  } else {
    visits = 'No visits';
  }

  return `BIZUSIZO HEALTH SUMMARY\n` +
    `${name} DOB:${dob}${bzCode ? ' Code:' + bzCode : ''}\n` +
    `Chronic:${chronic}\n` +
    `Visits:${visits}\n` +
    `AI triage summary - not a diagnosis`;
}

module.exports = {
  init,
  sendSMS,
  buildPassportSMS,
  getDailySmsStatus,
  handleInboundSMS,
  SMS_ENABLED,
};
