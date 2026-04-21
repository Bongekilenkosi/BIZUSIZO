'use strict';
const fetch = require('node-fetch');
const logger = require('../logger');

const WHATSAPP_API_VERSION = 'v21.0'; // Keep updated — Meta deprecates old versions

// governance is optional — passed in after the governance module initialises
let _governance = null;
function setGovernance(gov) { _governance = gov; }

// ── Daily message quota tracking ───────────────────────────────
// Meta WhatsApp Business API has tier-based limits (1K/day on free tier).
// Track daily sends and alert when approaching the limit.
const DAILY_QUOTA_WARN = parseInt(process.env.WHATSAPP_DAILY_QUOTA) || 800; // Alert at 80% of 1000
const DAILY_QUOTA_HARD = parseInt(process.env.WHATSAPP_DAILY_HARD_LIMIT) || 950;
let _dailySends = { count: 0, date: new Date().toISOString().slice(0, 10) };

function trackDailySend() {
  const today = new Date().toISOString().slice(0, 10);
  if (_dailySends.date !== today) {
    _dailySends = { count: 0, date: today };
  }
  _dailySends.count++;

  if (_dailySends.count === DAILY_QUOTA_WARN) {
    logger.error(`[WA QUOTA] ⚠️ Approaching daily limit: ${_dailySends.count} messages sent today (warn threshold: ${DAILY_QUOTA_WARN})`);
    // Fire governance alert
    try {
      _governance?.queueEvent?.({
        type: 'whatsapp_quota_warning', table: 'governance_alerts',
        data: {
          alert_type: 'whatsapp_quota_warning', severity: 'HIGH', pillar: 'system_integrity',
          message: `WhatsApp daily send count reached ${_dailySends.count}. Limit: ~1000/day. Patients may stop receiving messages.`,
          assigned_to: 'devops_engineer',
          original_timestamp: new Date().toISOString(),
        }
      });
    } catch (e) { /* non-blocking */ }
  }

  if (_dailySends.count >= DAILY_QUOTA_HARD) {
    logger.error(`[WA QUOTA] 🔴 HARD LIMIT: ${_dailySends.count} messages today. Throttling sends.`);
    return false; // Signal to skip non-critical messages
  }
  return true;
}

function getDailyQuotaStatus() {
  const today = new Date().toISOString().slice(0, 10);
  if (_dailySends.date !== today) return { count: 0, date: today, warn: DAILY_QUOTA_WARN, hard: DAILY_QUOTA_HARD };
  return { ..._dailySends, warn: DAILY_QUOTA_WARN, hard: DAILY_QUOTA_HARD };
}

async function sendWhatsAppMessage(to, text) {
  trackDailySend();

  try {
    const res = await fetch(`https://graph.facebook.com/${WHATSAPP_API_VERSION}/${process.env.PHONE_NUMBER_ID}/messages`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${process.env.WHATSAPP_TOKEN}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        messaging_product: 'whatsapp',
        to,
        type: 'text',
        text: { body: text }
      })
    });

    if (!res.ok) {
      const errorBody = await res.text().catch(() => 'no body');
      logger.error(`[WA] Send failed: ${res.status} ${res.statusText} — ${errorBody}`);
      try { _governance?.systemIntegrity.recordWhatsAppSend(false); } catch (e) {}
      return false;
    }

    try { _governance?.systemIntegrity.recordWhatsAppSend(true); } catch (e) {}
    return true;
  } catch (e) {
    logger.error(`[WA] Send error: ${e.message}`);
    try { _governance?.systemIntegrity.recordWhatsAppSend(false); } catch (e2) {}
    return false;
  }
}

module.exports = { sendWhatsAppMessage, setGovernance, getDailyQuotaStatus, WHATSAPP_API_VERSION };
