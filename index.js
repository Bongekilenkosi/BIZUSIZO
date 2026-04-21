// ============================================================
// BIZUSIZO — PRODUCTION READY v2.3
// + Hardcoded 11-language messages
// + Smart facility routing with patient confirmation
// + Four-Pillar Governance Framework (Stanford-adapted)
// + Patient identity capture (name, surname, DOB, sex)
// + Pre-arrival file preparation system
// + Clinic queue management API
// + Returning vs new patient detection
// + Bug fixes
// Railway + Meta WhatsApp + Supabase + Anthropic
// March 2026
// ============================================================

require('dotenv').config();
const express = require('express');
const crypto = require('crypto');
const fetch = require('node-fetch');
const fs = require('fs');
const path = require('path');
const logger = require('./logger');
const { MESSAGES, msg } = require('./lib/messages');
const { sendWhatsAppMessage, setGovernance: _setWAGovernance, WHATSAPP_API_VERSION } = require('./lib/whatsapp');
const facilitiesLib = require('./lib/facilities');
const triageLib     = require('./lib/triage');
const sessionLib    = require('./lib/session');
const followup      = require('./lib/followup');
const outbreak      = require('./lib/outbreak');
const smsLib        = require('./lib/sms');
// smsLib.init() called after supabase is created (see below)
const { createClient } = require('@supabase/supabase-js');
const Anthropic = require('@anthropic-ai/sdk');
const bcrypt = require('bcryptjs');

const app = express();
app.use(express.json());

// ================================================================
// CORS — Secure cross-origin configuration
// Allows dashboard access from any origin (needed for Netlify-hosted
// website, future mobile app, and cross-domain API access).
// Credentials enabled for session-based auth.
// ================================================================
app.use((req, res, next) => {
  const allowedOrigins = [
    'https://bizusizo.co.za',
    'https://www.bizusizo.co.za',
    'https://bizusizo.up.railway.app',
    process.env.CORS_ORIGIN, // Custom origin from env
  ].filter(Boolean);

  const origin = req.headers.origin;
  if (allowedOrigins.includes(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Access-Control-Allow-Credentials', 'true');
  }
  // Same-origin requests (no origin header) are allowed through without CORS headers —
  // browsers only send the Origin header on cross-origin requests, so omitting
  // Access-Control-Allow-Origin for same-origin is correct and safe.

  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, x-dashboard-password, x-dashboard-user, x-session-token');
  res.setHeader('Access-Control-Max-Age', '86400'); // Cache preflight for 24hrs

  if (req.method === 'OPTIONS') {
    return res.status(204).end();
  }
  next();
});

// ================================================================
// COOKIE PARSER (lightweight — no dependency needed)
// ================================================================
function parseCookies(req) {
  const cookies = {};
  (req.headers.cookie || '').split(';').forEach(c => {
    const [k, v] = c.trim().split('=');
    if (k) cookies[k] = v;
  });
  return cookies;
}

// ================================================================
// SESSION-BASED AUTHENTICATION SYSTEM
// ================================================================
const SESSION_DURATION_HOURS = 8; // Nursing shift length

function generateSessionToken() {
  return crypto.randomBytes(32).toString('hex');
}

function getSessionToken(req) {
  const cookies = parseCookies(req);
  if (cookies.bz_session) return cookies.bz_session;
  const auth = req.headers.authorization || '';
  if (auth.startsWith('Bearer ')) return auth.substring(7);
  return null;
}

// Validate session and attach req.user
async function validateSession(req) {
  const token = getSessionToken(req);
  if (!token) return false;
  try {
    const { data: session, error } = await supabase
      .from('user_sessions')
      .select('*')
      .eq('token', token)
      .eq('is_active', true)
      .gt('expires_at', new Date().toISOString())
      .single();
    if (error || !session) return false;
    // Look up full user details from facility_users (session may have minimal columns)
    let userDetails = {};
    if (session.user_id) {
      const { data: fu } = await supabase.from('facility_users')
        .select('id, facility_id, role, display_name, district_name')
        .eq('id', session.user_id).single();
      if (fu) userDetails = fu;
    }
    // Get facility name
    let facName = session.facility_name || null;
    if (!facName && (session.facility_id || userDetails.facility_id)) {
      const { data: fac } = await supabase.from('facilities')
        .select('name').eq('id', session.facility_id || userDetails.facility_id).single();
      facName = fac?.name || null;
    }
    req.user = {
      id: session.user_id,
      facility_id: session.facility_id || userDetails.facility_id || null,
      facility_name: facName,
      role: session.role || userDetails.role || 'nurse',
      display_name: session.display_name || userDetails.display_name || 'Staff',
      district_name: session.district_name || userDetails.district_name || null,
      district_facilities: session.district_facilities || [],
    };
    return true;
  } catch (e) {
    return false;
  }
}

// Audit logging — async, never blocks
async function logAudit(req, action, targetId, metadata) {
  try {
    await supabase.from('audit_log').insert({
      user_id: req.user ? req.user.id : null,
      facility_id: req.user ? req.user.facility_id : null,
      user_name: req.user ? req.user.display_name : null,
      action,
      target_id: targetId || null,
      metadata: metadata || {},
      ip_address: req.headers['x-forwarded-for'] || req.socket.remoteAddress
    });
  } catch (e) { logger.error('[AUDIT] Log error:', e.message); }
}

// Build facility-filtered query
// Roles:
//   admin        — sees ALL facilities (BIZUSIZO team only)
//   district     — sees ALL facilities in their district_name
//   nurse / reception / manager — sees ONLY their own facility
function facilityFilter(req, query, facilityColumn) {
  const col = facilityColumn || 'facility_name';

  // admin: sees everything, optional manual filter via query param
  if (req.user && req.user.role === 'admin') {
    const f = req.query.facility_filter || req.headers['x-facility-filter'];
    if (f && f !== 'all') return query.eq(col, f);
    return query;
  }

  // district: sees all facilities in their district
  if (req.user && req.user.role === 'district') {
    // Allow optional drill-down to a single facility
    const f = req.query.facility_filter || req.headers['x-facility-filter'];
    if (f && f !== 'all') return query.eq(col, f);
    // Otherwise scope to district — requires facility_name to be in district's facility list
    if (req.user.district_facilities && req.user.district_facilities.length > 0) {
      return query.in(col, req.user.district_facilities);
    }
    // Fallback: no facility list loaded — return unfiltered for district (safer than empty)
    return query;
  }

  // clinic roles: strict facility scope
  if (req.user && req.user.facility_name) {
    return query.eq(col, req.user.facility_name);
  }

  return query;
}

// ================================================================
// AUTH API ROUTES
// ================================================================

// POST /api/auth/login
app.post('/api/auth/login', async (req, res) => {
  try {
    const { username, password } = req.body;
    if (!username || !password) {
      return res.status(400).json({ error: 'Username and password required' });
    }
    const { data: user, error } = await supabase
      .from('facility_users')
      .select('*')
      .eq('username', username.toLowerCase().trim())
      .eq('is_active', true)
      .single();
    if (error || !user) {
      return res.status(401).json({ error: 'Invalid username or password' });
    }
    const match = await bcrypt.compare(password, user.password_hash);
    if (!match) {
      return res.status(401).json({ error: 'Invalid username or password' });
    }
    // Get facility name
    let facilityName = null;
    if (user.facility_id) {
      const { data: fac } = await supabase
        .from('facilities')
        .select('name')
        .eq('id', user.facility_id)
        .single();
      facilityName = fac?.name || null;
    }

    // For district users: load all facility names in their district
    let districtName = user.district_name || null;
    let districtFacilities = [];
    if (user.role === 'district' && districtName) {
      const { data: distFacilities } = await supabase
        .from('facilities')
        .select('name')
        .eq('district', districtName);
      districtFacilities = distFacilities ? distFacilities.map(f => f.name) : [];
    }

    const token = generateSessionToken();
    const expiresAt = new Date(Date.now() + SESSION_DURATION_HOURS * 60 * 60 * 1000);
    // Insert only core columns — extra columns may not exist if migration is outdated
    const sessionRow = {
      user_id: user.id,
      token,
      is_active: true,
      expires_at: expiresAt.toISOString(),
    };
    // Attempt to add optional columns — Supabase ignores unknown ones with .select()
    // but INSERT fails on missing columns, so we try progressively
    const optionalCols = {
      facility_id: user.facility_id,
      facility_name: facilityName,
      role: user.role,
      display_name: user.display_name,
      district_name: districtName,
    };
    for (const [col, val] of Object.entries(optionalCols)) {
      if (val !== null && val !== undefined) sessionRow[col] = val;
    }
    let { error: sessionErr } = await supabase.from('user_sessions').insert(sessionRow);
    if (sessionErr && sessionErr.code === 'PGRST204') {
      // Column doesn't exist — retry with minimal columns only
      logger.error(`[AUTH] Session insert failed (missing column): ${sessionErr.message}`);
      logger.info('[AUTH] Retrying with minimal columns: user_id, token, is_active, expires_at');
      const minimalRow = { user_id: user.id, token, role: user.role || 'nurse', is_active: true, expires_at: expiresAt.toISOString() };
      const { error: retryErr } = await supabase.from('user_sessions').insert(minimalRow);
      if (retryErr) {
        logger.error(`[AUTH] Minimal session insert also failed: ${retryErr.message}`);
        return res.status(500).json({ error: 'Failed to create session. Contact admin.' });
      }
      sessionErr = null;
    } else if (sessionErr) {
      logger.error(`[AUTH] Session insert error: ${sessionErr.message} | Code: ${sessionErr.code}`);
      return res.status(500).json({ error: 'Failed to create session. Contact admin.' });
    }

    // Verify session was actually created (diagnose Supabase issues)
    const { data: verifySession, error: verifyErr } = await supabase
      .from('user_sessions')
      .select('id, token, is_active, expires_at')
      .eq('token', token)
      .single();
    if (verifyErr || !verifySession) {
      logger.error('[AUTH] Session verification failed after insert:', verifyErr?.message || 'not found');
      logger.error('[AUTH] Token prefix:', token.slice(0, 8) + '...');
    } else {
      logger.info(`[AUTH] Session verified: id=${verifySession.id} is_active=${verifySession.is_active}`);
    }

    await supabase.from('facility_users').update({ last_login: new Date().toISOString() }).eq('id', user.id);

    const { error: auditErr } = await supabase.from('audit_log').insert({
      user_id: user.id,
      facility_id: user.facility_id,
      user_name: user.display_name,
      action: 'LOGIN',
      ip_address: req.headers['x-forwarded-for'] || req.socket.remoteAddress,
      metadata: { username: user.username, display_name: user.display_name, facility_name: facilityName }
    });
    if (auditErr) logger.error('[AUTH] Audit insert error:', auditErr.message);
    logger.info(`[AUTH] Login: ${user.display_name} (${user.role}) at ${districtName ? 'district:' + districtName : facilityName || 'admin'}`);
    res.json({
      success: true,
      token,
      user: {
        display_name: user.display_name,
        role: user.role,
        facility_id: user.facility_id,
        facility_name: facilityName,
        district_name: districtName,
        district_facilities: districtFacilities,
      }
    });
  } catch (e) {
    logger.error('[AUTH] Login error:', e.message);
    res.status(500).json({ error: 'Server error' });
  }
});

// POST /api/auth/logout
app.post('/api/auth/logout', async (req, res) => {
  const token = getSessionToken(req);
  if (token) {
    await supabase.from('user_sessions').update({ is_active: false }).eq('token', token);
    if (req.user) await logAudit(req, 'LOGOUT');
  }
  res.json({ success: true });
});

// GET /api/auth/me
app.get('/api/auth/me', async (req, res) => {
  const valid = await validateSession(req);
  if (!valid) return res.status(401).json({ error: 'Not authenticated' });
  res.json({
    display_name: req.user.display_name,
    role: req.user.role,
    facility_id: req.user.facility_id,
    facility_name: req.user.facility_name,
    district_name: req.user.district_name || null,
    district_facilities: req.user.district_facilities || [],
  });
});

// POST /api/auth/change-password — Authenticated staff change their own password
app.post('/api/auth/change-password', async (req, res) => {
  try {
    const valid = await validateSession(req);
    if (!valid) return res.status(401).json({ error: 'Not authenticated' });

    const { current_password, new_password } = req.body;
    if (!current_password || !new_password)
      return res.status(400).json({ error: 'current_password and new_password are required' });
    if (new_password.length < 8)
      return res.status(400).json({ error: 'New password must be at least 8 characters' });
    if (new_password === current_password)
      return res.status(400).json({ error: 'New password must be different from current password' });

    // Fetch current hash
    const { data: user, error: fetchErr } = await supabase
      .from('facility_users')
      .select('id, password_hash, username')
      .eq('id', req.user.id)
      .single();
    if (fetchErr || !user) return res.status(404).json({ error: 'User not found' });

    // Verify current password
    const match = await bcrypt.compare(current_password, user.password_hash);
    if (!match) return res.status(401).json({ error: 'Current password is incorrect' });

    // Hash and save new password
    const newHash = await bcrypt.hash(new_password, 12);
    const { error: updateErr } = await supabase
      .from('facility_users')
      .update({ password_hash: newHash })
      .eq('id', req.user.id);
    if (updateErr) throw updateErr;

    // Invalidate all existing sessions for this user (force re-login everywhere)
    await supabase.from('user_sessions')
      .update({ is_active: false })
      .eq('user_id', req.user.id);

    // Audit log
    await supabase.from('audit_log').insert({
      user_id: req.user.id,
      facility_id: req.user.facility_id || null,
      action: 'PASSWORD_CHANGE',
      ip_address: req.ip,
      metadata: { username: user.username },
      created_at: new Date().toISOString(),
    }).catch(() => {});

    logger.info(`[AUTH] Password changed for user ${user.username}`);
    res.json({ success: true, message: 'Password changed successfully' });
  } catch (e) {
    logger.error('[AUTH] Change password error:', e.message);
    res.status(500).json({ error: 'Failed to change password' });
  }
});

// GET /clinical/login — Serve login page
app.get('/clinical/login', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'login.html'));
});

// GET /referral — Serve referral lookup page
app.get('/referral', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'referral-lookup.html'));
});

// POST /api/referral/lookup — Public referral lookup by REF number
// Auth: requireDashboardAuth (receiving hospital uses same credentials,
// or the REF number itself can be treated as the access token — see design notes)
app.post('/api/referral/lookup', requireDashboardAuth, async (req, res) => {
  try {
    const { ref_number } = req.body;
    if (!ref_number) return res.status(400).json({ error: 'Referral number required' });
    const cleanRef = ref_number.trim().toUpperCase();
    const { data: referral, error } = await supabase
      .from('referrals')
      .select('*')
      .eq('ref_number', cleanRef)
      .single();
    if (error || !referral) {
      return res.status(404).json({ error: 'Referral not found. Please check the REF number.' });
    }
    if (!referral.looked_up_at) {
      await supabase.from('referrals').update({
        looked_up_at: new Date().toISOString(),
        looked_up_by: req.headers['x-forwarded-for'] || req.socket.remoteAddress,
        status: 'accepted'
      }).eq('id', referral.id);
    }
    await supabase.from('audit_log').insert({
      action: 'VIEW_REFERRAL',
      target_id: referral.id,
      ip_address: req.headers['x-forwarded-for'] || req.socket.remoteAddress,
      metadata: { ref_number: cleanRef }
    });
    res.json({
      ref_number: referral.ref_number,
      patient_name: referral.patient_name,
      patient_surname: referral.patient_surname,
      patient_age: referral.patient_age,
      patient_sex: referral.patient_sex,
      triage_colour: referral.triage_colour,
      triage_category: referral.triage_category,
      symptom_summary: referral.symptom_summary,
      risk_factors: referral.risk_factors,
      referral_reason: referral.referral_reason,
      transport_method: referral.transport_method,
      originating_facility_name: referral.originating_facility_name,
      status: referral.status,
      created_at: referral.created_at
    });
  } catch (e) {
    logger.error('[REFERRAL] Lookup error:', e.message);
    res.status(500).json({ error: 'Server error' });
  }
});

// Website chatbot endpoint moved to line ~10048 (single definition, no duplicate)

// GET /api/audit — Dashboard audit log query (admin sees all, district sees their facilities, clinic sees their own)
app.get('/api/audit', requireDashboardAuth, async (req, res) => {
  try {
    const { action, date_from, date_to, limit: lim } = req.query;
    let query = supabase.from('audit_log').select('*').order('created_at', { ascending: false }).limit(Math.min(parseInt(lim) || 200, 1000));
    if (action) query = query.ilike('action', action);
    if (date_from) query = query.gte('created_at', new Date(date_from).toISOString());
    if (date_to) {
      const end = new Date(date_to);
      end.setDate(end.getDate() + 1); // include the full end date
      query = query.lt('created_at', end.toISOString());
    }
    // Scope by role
    query = facilityFilter(req, query, 'facility_id');
    const { data, error } = await query;
    if (error) throw error;
    res.json(data || []);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Seed passwords endpoint REMOVED — was a setup utility with hardcoded default password.
// Staff passwords are now managed via Supabase admin panel or /api/auth/change-password.

// Serve governance dashboard as a static file
app.use('/public', express.static(path.join(__dirname, 'public')));

// ================================================================
// GOVERNANCE DASHBOARD — Inline HTML (no external file dependency)
// Vanilla JS — no React, no Babel, no CDN. Maximum reliability.
// ================================================================
app.get('/dashboard', (req, res) => {
  res.setHeader('Content-Type', 'text/html');
  res.send(`<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>BIZUSIZO Governance Dashboard</title>
<script src="https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js"></script>
<style>
*{margin:0;padding:0;box-sizing:border-box}
body{background:#0a0e17;color:#e2e8f0;font-family:-apple-system,sans-serif;padding:20px}
.header{display:flex;justify-content:space-between;align-items:center;margin-bottom:24px;padding-bottom:16px;border-bottom:1px solid #1e293b}
.header h1{font-size:20px;color:#e2e8f0}
.header .status{padding:4px 12px;border-radius:99px;font-size:12px;font-weight:600}
.nominal{background:rgba(16,185,129,.15);color:#10b981;border:1px solid rgba(16,185,129,.3)}
.degraded{background:rgba(234,179,8,.15);color:#eab308;border:1px solid rgba(234,179,8,.3)}
.critical{background:rgba(239,68,68,.15);color:#ef4444;border:1px solid rgba(239,68,68,.3)}
.tabs{display:flex;gap:8px;margin-bottom:24px}
.tab{padding:8px 16px;border-radius:6px;border:1px solid #1e293b;background:#111827;color:#64748b;cursor:pointer;font-size:13px}
.tab.active{background:#1e293b;color:#e2e8f0;border-color:#3b82f6}
.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:16px;margin-bottom:24px}
.card{background:#111827;border:1px solid #1e293b;border-radius:10px;padding:16px}
.card .label{font-size:11px;color:#64748b;text-transform:uppercase;letter-spacing:.05em}
.card .value{font-size:28px;font-weight:700;margin-top:4px}
.card .sub{font-size:12px;color:#64748b;margin-top:4px}
.pillar-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(280px,1fr));gap:16px;margin-bottom:24px}
.pillar{background:#111827;border:1px solid #1e293b;border-radius:10px;padding:16px;border-left:3px solid}
.pillar h3{font-size:14px;margin-bottom:8px}
.pillar .detail{font-size:12px;color:#64748b;line-height:1.6}
table{width:100%;border-collapse:collapse;font-size:13px}
th{text-align:left;padding:8px 12px;background:#111827;color:#64748b;font-size:11px;text-transform:uppercase;letter-spacing:.05em;border-bottom:1px solid #1e293b}
td{padding:8px 12px;border-bottom:1px solid #1e293b}
.badge{display:inline-block;padding:2px 8px;border-radius:99px;font-size:11px;font-weight:600}
.badge-critical{color:#ef4444;border:1px solid rgba(239,68,68,.3)}
.badge-high{color:#f97316;border:1px solid rgba(249,115,22,.3)}
.badge-medium{color:#eab308;border:1px solid rgba(234,179,8,.3)}
.badge-low{color:#22c55e;border:1px solid rgba(34,197,94,.3)}
.empty{text-align:center;padding:40px;color:#475569}
.login{position:fixed;inset:0;background:#0a0e17;display:flex;align-items:center;justify-content:center;z-index:99}
.login-box{background:#111827;border:1px solid #1e293b;border-radius:10px;padding:32px;width:320px;text-align:center}
.login-box h2{margin-bottom:16px;font-size:18px}
.login-box input{width:100%;padding:10px;border-radius:6px;border:1px solid #1e293b;background:#0d1321;color:#e2e8f0;margin-bottom:12px;font-size:14px}
.login-box button{width:100%;padding:10px;border-radius:6px;border:none;background:#3b82f6;color:white;font-size:14px;cursor:pointer}
.login-box button:hover{background:#2563eb}
.refresh-info{font-size:11px;color:#475569;text-align:right;margin-bottom:8px}
</style>
</head>
<body>

<div id="login" class="login">
  <div class="login-box">
    <h2>BIZUSIZO Governance</h2>
    <p style="color:#64748b;font-size:13px;margin-bottom:16px">Sign in to access the dashboard</p>
    <input type="text" id="uname" placeholder="Your name (e.g. Bongekile)" style="width:100%;padding:10px;border-radius:6px;border:1px solid #1e293b;background:#0d1321;color:#e2e8f0;margin-bottom:8px;font-size:14px">
    <input type="password" id="pwd" placeholder="Password" onkeyup="if(event.key==='Enter')doLogin()">
    <button onclick="doLogin()">Sign in</button>
    <p id="login-err" style="color:#ef4444;font-size:12px;margin-top:8px"></p>
  </div>
</div>

<div id="app" style="display:none">
  <div class="header">
    <h1>BIZUSIZO Governance Dashboard</h1>
    <div>
      <a href="/clinic" style="color:#3b82f6;font-size:11px;margin-right:16px;text-decoration:none;border:1px solid rgba(59,130,246,.3);padding:3px 10px;border-radius:4px">→ Clinic Dashboard</a>
      <span id="sys-status" class="status nominal">LOADING...</span>
      <span style="color:#475569;font-size:11px;margin-left:12px" id="logged-in-as"></span>
      <span style="color:#475569;font-size:11px;margin-left:12px" id="last-refresh"></span>
    </div>
  </div>

  <div class="tabs">
    <div class="tab active" onclick="showTab('overview',this)">Overview</div>
    <div class="tab" onclick="showTab('alerts',this)">Alerts</div>
    <div class="tab" onclick="showTab('incidents',this)">Incidents</div>
    <div class="tab" onclick="showTab('metrics',this)">Metrics</div>
    <div class="tab" onclick="showTab('reports',this)">Reports</div>
    <div class="tab" onclick="showTab('audit',this)">Audit Log</div>
    <div class="tab" onclick="showTab('rules',this)">🔍 Rule Review</div>
    <div class="tab" onclick="showTab('regression',this)">🧪 Regression</div>
    <div class="tab" onclick="showTab('staff',this)">👥 Staff</div>
<div class="tab" onclick="showTab('outbreak',this)">🦠 Outbreak</div>
  </div>

  <div id="tab-overview">
    <div class="grid" id="stat-cards"></div>
    <h3 style="margin-bottom:12px;font-size:14px;color:#64748b">Four-Pillar Status</h3>
    <div class="pillar-grid" id="pillars"></div>
  </div>

  <div id="tab-alerts" style="display:none">
    <div class="card"><table><thead><tr><th>Time</th><th>Severity</th><th>Pillar</th><th>Message</th></tr></thead><tbody id="alerts-body"></tbody></table></div>
  </div>

  <div id="tab-incidents" style="display:none">
    <div class="card"><table><thead><tr><th>Time</th><th>Level</th><th>Description</th><th>Status</th></tr></thead><tbody id="incidents-body"></tbody></table></div>
  </div>

  <div id="tab-metrics" style="display:none">
    <div class="card"><table><thead><tr><th>Time</th><th>Type</th><th>Requests</th><th>Errors</th><th>Error Rate</th></tr></thead><tbody id="metrics-body"></tbody></table></div>
  </div>

  <div id="tab-reports" style="display:none">
    <div style="display:flex;gap:12px;margin-bottom:16px;align-items:center;flex-wrap:wrap">
      <div style="font-size:11px;color:#64748b">Date range:</div>
      <input type="date" id="report-start" style="padding:6px 10px;border-radius:6px;border:1px solid #1e293b;background:#0d1321;color:#e2e8f0;font-size:12px">
      <span style="color:#475569">to</span>
      <input type="date" id="report-end" style="padding:6px 10px;border-radius:6px;border:1px solid #1e293b;background:#0d1321;color:#e2e8f0;font-size:12px">
      <button onclick="loadReports()" style="padding:6px 16px;border-radius:6px;border:1px solid #3b82f6;background:rgba(59,130,246,.15);color:#3b82f6;cursor:pointer;font-size:12px">Load Report</button>
      <button onclick="exportCSV()" style="padding:6px 16px;border-radius:6px;border:1px solid #22c55e;background:rgba(34,197,94,.1);color:#22c55e;cursor:pointer;font-size:12px">📥 Triage Data</button>
      <button onclick="exportConcordanceCSV()" style="padding:6px 16px;border-radius:6px;border:1px solid #a855f7;background:rgba(168,85,247,.1);color:#a855f7;cursor:pointer;font-size:12px">📥 Concordance</button>
      <button onclick="exportConsentCSV()" style="padding:6px 16px;border-radius:6px;border:1px solid #f59e0b;background:rgba(245,158,11,.1);color:#f59e0b;cursor:pointer;font-size:12px">📥 Consent Log</button>
      <button onclick="exportReferralCSV()" style="padding:6px 16px;border-radius:6px;border:1px solid #06b6d4;background:rgba(6,182,212,.1);color:#06b6d4;cursor:pointer;font-size:12px">📥 Referrals</button>
      <button onclick="exportPassportCSV()" style="padding:6px 16px;border-radius:6px;border:1px solid #ec4899;background:rgba(236,72,153,.1);color:#ec4899;cursor:pointer;font-size:12px">📥 Passport Views</button>
    </div>
    <div style="font-size:11px;color:#475569;margin-bottom:12px">
      <strong style="color:#94a3b8">Concordance</strong> = AI triage vs nurse triage (primary EVAH outcome) &nbsp;|&nbsp;
      <strong style="color:#94a3b8">Consent Log</strong> = POPIA audit record &nbsp;|&nbsp;
      <strong style="color:#94a3b8">Referrals</strong> = all hospital escalations
    </div>
    <div class="grid" id="report-stats"></div>
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:16px;margin-top:16px">
      <div class="card"><h3 style="font-size:13px;color:#64748b;margin-bottom:12px">Triage Distribution</h3><div id="report-triage-dist"></div></div>
      <div class="card"><h3 style="font-size:13px;color:#64748b;margin-bottom:12px">Queue Stream Breakdown</h3><div id="report-queue-dist"></div></div>
    </div>
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:16px;margin-top:16px">
      <div class="card"><h3 style="font-size:13px;color:#64748b;margin-bottom:12px">Nurse Feedback (Agree/Disagree)</h3><div id="report-nurse-feedback"></div></div>
      <div class="card"><h3 style="font-size:13px;color:#64748b;margin-bottom:12px">Queue Stream Breakdown</h3><div id="report-queue-dist-2"></div></div>
    </div>
    <div class="card" style="margin-top:16px">
      <h3 style="font-size:13px;color:#64748b;margin-bottom:16px">Follow-up Rate Card <span style="font-size:10px;color:#475569;font-weight:400">— primary impact metric · national lost-to-follow-up baseline: 28%</span></h3>
      <div id="report-followup"></div>
      <div id="report-access-failures" style="margin-top:16px;padding-top:16px;border-top:1px solid #1e293b"></div>
    </div>
    <div class="card" style="margin-top:16px"><h3 style="font-size:13px;color:#64748b;margin-bottom:12px">Daily Patient Volume</h3><div id="report-daily-volume"></div></div>
  </div>

  <div id="tab-audit" style="display:none">
    <div style="display:flex;gap:12px;margin-bottom:16px;align-items:center;flex-wrap:wrap">
      <div style="font-size:11px;color:#64748b">Date range:</div>
      <input type="date" id="audit-start" style="padding:6px 10px;border-radius:6px;border:1px solid #1e293b;background:#0d1321;color:#e2e8f0;font-size:12px">
      <span style="color:#475569">to</span>
      <input type="date" id="audit-end" style="padding:6px 10px;border-radius:6px;border:1px solid #1e293b;background:#0d1321;color:#e2e8f0;font-size:12px">
      <input type="text" id="audit-filter" placeholder="Filter by action (e.g. CALL, ESCALATE, LOGIN)" style="padding:6px 10px;border-radius:6px;border:1px solid #1e293b;background:#0d1321;color:#e2e8f0;font-size:12px;width:260px">
      <button onclick="loadAudit()" style="padding:6px 16px;border-radius:6px;border:1px solid #3b82f6;background:rgba(59,130,246,.15);color:#3b82f6;cursor:pointer;font-size:12px">Search</button>
      <button onclick="exportAuditCSV()" style="padding:6px 16px;border-radius:6px;border:1px solid #22c55e;background:rgba(34,197,94,.1);color:#22c55e;cursor:pointer;font-size:12px">📥 Export Excel</button>
    </div>
    <div class="card"><table><thead><tr><th>Time</th><th>User</th><th>Action</th><th>Patient</th><th>Details</th></tr></thead><tbody id="audit-body"></tbody></table></div>
  </div>

  <div id="tab-rules" style="display:none">
    <div style="display:flex;gap:12px;margin-bottom:16px;align-items:center;flex-wrap:wrap">
      <div style="font-size:13px;font-weight:600;color:#e2e8f0">Monthly Disagreement Review</div>
      <input type="month" id="review-month" style="padding:6px 10px;border-radius:6px;border:1px solid #1e293b;background:#0d1321;color:#e2e8f0;font-size:12px">
      <button onclick="loadRuleReview()" style="padding:6px 16px;border-radius:6px;border:1px solid #3b82f6;background:rgba(59,130,246,.15);color:#3b82f6;cursor:pointer;font-size:12px">Load Report</button>
    </div>
    <div id="rule-review-summary" style="margin-bottom:16px"></div>
    <div id="rule-review-body"></div>
  </div>

  <div id="tab-regression" style="display:none">
    <div style="display:flex;gap:12px;margin-bottom:16px;align-items:center">
      <div style="font-size:13px;font-weight:600;color:#e2e8f0">Regression Test Results</div>
      <button onclick="loadRegression()" style="padding:6px 16px;border-radius:6px;border:1px solid #3b82f6;background:rgba(59,130,246,.15);color:#3b82f6;cursor:pointer;font-size:12px">Refresh</button>
    </div>
    <div id="regression-body"><div style="color:#475569;font-size:12px">Click Refresh to load latest test run results.</div></div>
  </div>

  <div id="tab-outbreak" style="display:none">
  <div style="display:flex;gap:12px;margin-bottom:16px;align-items:center;flex-wrap:wrap">
    <div style="font-size:13px;font-weight:600;color:#e2e8f0">Syndromic Surveillance</div>
    <button onclick="loadOutbreak()" style="padding:6px 16px;border-radius:6px;border:1px solid #3b82f6;background:rgba(59,130,246,.15);color:#3b82f6;cursor:pointer;font-size:12px">Refresh</button>
  </div>

  <!-- Summary cards -->
  <div id="outbreak-summary" style="display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:12px;margin-bottom:20px"></div>

  <!-- IMMEDIATE alerts — nurse action required -->
  <div id="outbreak-immediate-section" style="display:none;margin-bottom:20px">
    <div style="background:rgba(239,68,68,.1);border:1px solid rgba(239,68,68,.3);border-radius:10px;padding:16px">
      <div style="color:#ef4444;font-weight:700;font-size:14px;margin-bottom:12px">
        🚨 IMMEDIATE ALERTS — Nurse Action Required
      </div>
      <div style="font-size:11px;color:#94a3b8;margin-bottom:12px">
        These are NMC Category 1 conditions. Examine the patient first, then confirm or dismiss.
        Do NOT notify NICD until you have confirmed the alert below.
      </div>
      <div id="outbreak-immediate-body"></div>
    </div>
  </div>

  <!-- Active alerts table -->
  <div class="card" style="margin-bottom:16px">
    <div style="font-size:12px;font-weight:600;color:#64748b;margin-bottom:12px">Active Alerts</div>
    <table>
      <thead>
        <tr>
          <th>Time</th>
          <th>Syndrome</th>
          <th>Level</th>
          <th>Cases</th>
          <th>Window</th>
          <th>NMC</th>
          <th>Status</th>
        </tr>
      </thead>
      <tbody id="outbreak-active-body">
        <tr><td colspan="7" class="empty">Click Refresh to load alerts</td></tr>
      </tbody>
    </table>
  </div>

  <!-- Resolved alerts -->
  <div class="card">
    <div style="font-size:12px;font-weight:600;color:#64748b;margin-bottom:12px">Recently Resolved</div>
    <table>
      <thead>
        <tr>
          <th>Time</th>
          <th>Syndrome</th>
          <th>Level</th>
          <th>Cases</th>
          <th>Resolved By</th>
          <th>Notes</th>
        </tr>
      </thead>
      <tbody id="outbreak-resolved-body">
        <tr><td colspan="6" class="empty">No recently resolved alerts</td></tr>
      </tbody>
    </table>
  </div>
</div>
  <div id="tab-staff" style="display:none">
    <div style="display:flex;gap:12px;margin-bottom:16px;align-items:center">
      <div style="font-size:13px;font-weight:600;color:#e2e8f0">Staff Management</div>
      <button onclick="loadStaff()" style="padding:6px 16px;border-radius:6px;border:1px solid #3b82f6;background:rgba(59,130,246,.15);color:#3b82f6;cursor:pointer;font-size:12px">Refresh</button>
      <button onclick="showAddStaff()" style="padding:6px 16px;border-radius:6px;border:1px solid #22c55e;background:rgba(34,197,94,.1);color:#22c55e;cursor:pointer;font-size:12px">+ Add Staff</button>
    </div>
    <div id="staff-form" style="display:none;margin-bottom:16px" class="card">
      <h3 style="font-size:14px;color:#e2e8f0;margin-bottom:12px" id="staff-form-title">Add New Staff</h3>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px">
        <div><div style="font-size:11px;color:#64748b;margin-bottom:4px">Display Name *</div><input id="sf-name" placeholder="e.g. Thabo Molefe" style="width:100%;padding:8px;border-radius:6px;border:1px solid #1e293b;background:#0d1321;color:#e2e8f0;font-size:13px"></div>
        <div><div style="font-size:11px;color:#64748b;margin-bottom:4px">Username *</div><input id="sf-username" placeholder="e.g. thabo.molefe" style="width:100%;padding:8px;border-radius:6px;border:1px solid #1e293b;background:#0d1321;color:#e2e8f0;font-size:13px"></div>
        <div><div style="font-size:11px;color:#64748b;margin-bottom:4px">Password *</div><input id="sf-password" type="password" placeholder="Min 8 characters" style="width:100%;padding:8px;border-radius:6px;border:1px solid #1e293b;background:#0d1321;color:#e2e8f0;font-size:13px"></div>
        <div><div style="font-size:11px;color:#64748b;margin-bottom:4px">Role *</div><select id="sf-role" style="width:100%;padding:8px;border-radius:6px;border:1px solid #1e293b;background:#0d1321;color:#e2e8f0;font-size:13px"><option value="">Select role...</option><option value="nurse">Nurse</option><option value="reception">Reception</option><option value="manager">Facility Manager</option><option value="district">District Manager</option><option value="admin">Admin</option></select></div>
        <div><div style="font-size:11px;color:#64748b;margin-bottom:4px">Facility</div><select id="sf-facility" style="width:100%;padding:8px;border-radius:6px;border:1px solid #1e293b;background:#0d1321;color:#e2e8f0;font-size:13px"><option value="">No facility (admin/district)</option></select></div>
        <div><div style="font-size:11px;color:#64748b;margin-bottom:4px">District (for district role)</div><input id="sf-district" placeholder="e.g. Tshwane" style="width:100%;padding:8px;border-radius:6px;border:1px solid #1e293b;background:#0d1321;color:#e2e8f0;font-size:13px"></div>
      </div>
      <div style="display:flex;gap:8px;margin-top:12px">
        <button onclick="submitStaff()" style="padding:8px 20px;border-radius:6px;border:none;background:#3b82f6;color:white;cursor:pointer;font-size:13px">Save</button>
        <button onclick="hideStaffForm()" style="padding:8px 20px;border-radius:6px;border:1px solid #1e293b;background:transparent;color:#64748b;cursor:pointer;font-size:13px">Cancel</button>
      </div>
      <div id="sf-error" style="color:#ef4444;font-size:12px;margin-top:8px"></div>
      <div id="sf-success" style="color:#22c55e;font-size:12px;margin-top:8px"></div>
    </div>
    <div id="staff-reset-form" style="display:none;margin-bottom:16px" class="card">
      <h3 style="font-size:14px;color:#e2e8f0;margin-bottom:12px">Reset Password for <span id="sr-name"></span></h3>
      <div style="display:flex;gap:10px;align-items:flex-end">
        <div style="flex:1"><div style="font-size:11px;color:#64748b;margin-bottom:4px">New Password</div><input id="sr-password" type="password" placeholder="Min 8 characters" style="width:100%;padding:8px;border-radius:6px;border:1px solid #1e293b;background:#0d1321;color:#e2e8f0;font-size:13px"></div>
        <button onclick="submitResetPassword()" style="padding:8px 20px;border-radius:6px;border:none;background:#f59e0b;color:#000;cursor:pointer;font-size:13px;font-weight:600">Reset</button>
        <button onclick="hideResetForm()" style="padding:8px 20px;border-radius:6px;border:1px solid #1e293b;background:transparent;color:#64748b;cursor:pointer;font-size:13px">Cancel</button>
      </div>
      <div id="sr-error" style="color:#ef4444;font-size:12px;margin-top:8px"></div>
    </div>
    <div class="card" style="padding:0;overflow:auto">
      <table><thead><tr><th>Name</th><th>Username</th><th>Role</th><th>Facility</th><th>Status</th><th>Last Login</th><th>Actions</th></tr></thead><tbody id="staff-body"><tr><td colspan="7" class="empty">Click Refresh to load staff list</td></tr></tbody></table>
    </div>
  </div>

  <div style="margin-top:32px;padding-top:16px;border-top:1px solid #1e293b;font-size:10px;color:#475569;display:flex;justify-content:space-between;align-items:center">
    <span>BIZUSIZO Governance Framework v1.0 · Stanford-adapted four-pillar monitoring</span>
    <span style="display:flex;gap:16px;align-items:center">
      <a href="https://www.notion.so/335ed314b32c815c9825d805e4a1c31c" target="_blank" style="color:#3b82f6;text-decoration:none;border:1px solid rgba(59,130,246,.3);padding:4px 12px;border-radius:4px;font-size:10px">DPIA/POPIA v2.2</a>
      <span>Auto-refresh every 30s</span>
    </span>
  </div>
</div>

<script>
let PWD='';
let UNAME='';
const API='';

async function api(path){
  try{
    const r=await fetch(API+path,{headers:{'x-dashboard-password':PWD,'x-dashboard-user':UNAME}});
    if(!r.ok)throw new Error(r.status);
    return await r.json();
  }catch(e){console.error(path,e);return null;}
}

function doLogin(){
  UNAME=document.getElementById('uname').value.trim();
  PWD=document.getElementById('pwd').value;
  if(!UNAME){document.getElementById('login-err').textContent='Please enter your name';return;}
  api('/api/governance/status').then(d=>{
    if(d){
      document.getElementById('login').style.display='none';
      document.getElementById('app').style.display='block';
      document.getElementById('logged-in-as').textContent='Signed in as: '+UNAME;
      refresh();
    }
    else{document.getElementById('login-err').textContent='Invalid password or server error';}
  });
}

function showTab(name,el){
  document.querySelectorAll('[id^=tab-]').forEach(t=>t.style.display='none');
  document.getElementById('tab-'+name).style.display='block';
  document.querySelectorAll('.tab').forEach(t=>t.classList.remove('active'));
  el.classList.add('active');
}

function esc(t){return (t||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');}

function badge(sev){
  const s=esc((sev||'').toUpperCase());
  const cls=s==='CRITICAL'?'badge-critical':s==='HIGH'?'badge-high':s==='MEDIUM'?'badge-medium':'badge-low';
  return '<span class="badge '+cls+'">'+s+'</span>';
}

function timeAgo(d){
  if(!d)return '-';
  const s=Math.floor((Date.now()-new Date(d))/1000);
  if(s<60)return s+'s ago';if(s<3600)return Math.floor(s/60)+'m ago';
  if(s<86400)return Math.floor(s/3600)+'h ago';return Math.floor(s/86400)+'d ago';
}

async function refresh(){
  const status=await api('/api/governance/status');
  if(!status)return;

  document.getElementById('last-refresh').textContent='Updated '+new Date().toLocaleTimeString();

  // System status badge
  const el=document.getElementById('sys-status');
  const si=status.system_integrity||{};
  if(si.failsafe_active){el.textContent='FAILSAFE';el.className='status critical';}
  else{el.textContent='NOMINAL';el.className='status nominal';}

  // Stat cards
  const w=si.current_window||{};
  document.getElementById('stat-cards').innerHTML=[
    {label:'Total Requests',value:w.total_requests||0,sub:'Current 15-min window'},
    {label:'AI Triage Calls',value:w.api_calls||0,sub:'Failures: '+(w.api_failures||0)},
    {label:'Error Rate',value:w.api_calls>0?((w.api_failures/w.api_calls)*100).toFixed(1)+'%':'0%',sub:'Threshold: 20%'},
    {label:'WhatsApp Sent',value:w.whatsapp_sent||0,sub:'Failed: '+(w.whatsapp_failed||0)},
    {label:'Failsafe Mode',value:si.failsafe_active?'ACTIVE':'Inactive',sub:'Consecutive failures: '+(si.consecutive_api_failures||0)},
    {label:'Triage Fallbacks',value:w.triage_fallbacks||0,sub:'Deterministic classifier'},
  ].map(c=>'<div class="card"><div class="label">'+c.label+'</div><div class="value">'+c.value+'</div><div class="sub">'+c.sub+'</div></div>').join('');

  // Pillars
  const cp=status.clinical_performance||{};
  const sl=status.strategic_lifecycle||{};
  document.getElementById('pillars').innerHTML=[
    {name:'System Integrity',color:'#06b6d4',details:'API failures: '+(w.api_failures||0)+' · Timeouts: '+(w.api_timeouts||0)+' · Failsafe: '+(si.failsafe_active?'ACTIVE':'Off')},
    {name:'Clinical Performance',color:'#8b5cf6',details:'Buffer size: '+(cp.buffer_size||0)+' · Confidence threshold: '+(cp.confidence_threshold||75)+'%'},
    {name:'Strategic Lifecycle',color:'#f59e0b',details:'Next review: '+(sl.next_90_day_review||'Not scheduled')+' · Annual: '+(sl.next_annual_review||'Not scheduled')},
    {name:'Incident Management',color:'#ef4444',details:'Open incidents tracked via governance_incidents table'},
  ].map(p=>'<div class="pillar" style="border-left-color:'+p.color+'"><h3 style="color:'+p.color+'">'+p.name+'</h3><div class="detail">'+p.details+'</div></div>').join('');

  // Alerts
  const alerts=await api('/api/governance/alerts?limit=50');
  const ab=document.getElementById('alerts-body');
  if(alerts&&alerts.length>0){
    ab.innerHTML=alerts.map(a=>'<tr><td>'+timeAgo(a.created_at)+'</td><td>'+badge(a.severity)+'</td><td>'+esc(a.pillar||'-')+'</td><td>'+esc(a.message||'-')+'</td></tr>').join('');
  }else{ab.innerHTML='<tr><td colspan="4" class="empty">No alerts — system operating normally</td></tr>';}

  // Incidents
  const incidents=await api('/api/governance/incidents?limit=50');
  const ib=document.getElementById('incidents-body');
  if(incidents&&incidents.length>0){
    ib.innerHTML=incidents.map(i=>'<tr><td>'+timeAgo(i.created_at)+'</td><td>'+badge('L'+(i.severity_level||'?'))+'</td><td>'+esc(i.description||'-')+'</td><td>'+esc(i.status||'-')+'</td></tr>').join('');
  }else{ib.innerHTML='<tr><td colspan="4" class="empty">No incidents reported</td></tr>';}

  // Metrics
  const metricsResp=await api('/api/governance/metrics?days=30');
  const metrics=metricsResp&&metricsResp.metrics ? metricsResp.metrics : [];
  const mb=document.getElementById('metrics-body');
  if(metrics&&metrics.length>0){
    mb.innerHTML=metrics.map(m=>{
      const d=m.data||{};
      return '<tr><td>'+timeAgo(m.created_at)+'</td><td>'+(m.metric_type||'-')+'</td><td>'+(d.total_requests||d.batch_size||'-')+'</td><td>'+(d.api_failures||d.low_confidence_count||'-')+'</td><td>'+(d.error_rate!==undefined?(d.error_rate*100).toFixed(1)+'%':(d.low_confidence_rate||'-'))+'</td></tr>';
    }).join('');
  }else{mb.innerHTML='<tr><td colspan="5" class="empty">No metrics recorded yet</td></tr>';}
}

let _reportData=[];

async function loadReports(){
  const start=document.getElementById('report-start').value;
  const end=document.getElementById('report-end').value;
  if(!start||!end)return;

  // Fetch triage logs for the date range
  const data=await api('/api/governance/reports?start='+start+'&end='+end);
  if(!data)return;
  _reportData=data;

  // Summary stats
  document.getElementById('report-stats').innerHTML=[
    {l:'Total Patients',v:data.total_patients||0,c:'#e2e8f0'},
    {l:'Avg Confidence',v:(data.avg_confidence||0)+'%',c:'#3b82f6'},
    {l:'Follow-up Sent',v:data.followup_sent||0,c:'#8b5cf6'},
    {l:'Follow-up Responded',v:data.followup_responded||0,c:data.followup_responded>0?'#22c55e':'#64748b'},
    {l:'Response Rate',v:data.followup_sent>0?Math.round(data.followup_responded/data.followup_sent*100)+'%':'—',c:'#eab308'},
    {l:'Nurse Agreements',v:data.nurse_agree||0,c:'#22c55e'},
    {l:'Nurse Disagreements',v:data.nurse_disagree||0,c:data.nurse_disagree>0?'#f97316':'#64748b'},
    {l:'Agree Rate',v:(data.nurse_agree+data.nurse_disagree)>0?Math.round(data.nurse_agree/(data.nurse_agree+data.nurse_disagree)*100)+'%':'—',c:'#22c55e'},
  ].map(c=>'<div class="card"><div class="label">'+c.l+'</div><div class="value" style="color:'+c.c+'">'+c.v+'</div></div>').join('');

  // Triage distribution bar chart
  const td=data.triage_distribution||{};
  const triageTotal=Object.values(td).reduce((a,b)=>a+b,0)||1;
  const triageColors={RED:'#ef4444',ORANGE:'#f97316',YELLOW:'#eab308',GREEN:'#22c55e'};
  document.getElementById('report-triage-dist').innerHTML=Object.entries(td).filter(([,v])=>v>0).map(([k,v])=>{
    const pct=Math.round(v/triageTotal*100);
    return '<div style="display:flex;align-items:center;gap:8px;margin-bottom:8px"><span style="width:60px;font-size:12px;font-weight:600;color:'+(triageColors[k]||'#64748b')+'">'+k+'</span><div style="flex:1;height:20px;background:rgba(255,255,255,.05);border-radius:4px;overflow:hidden"><div style="width:'+pct+'%;height:100%;background:'+(triageColors[k]||'#64748b')+'33;border-left:3px solid '+(triageColors[k]||'#64748b')+'"></div></div><span style="width:60px;text-align:right;font-size:12px;color:#94a3b8">'+v+' ('+pct+'%)</span></div>';
  }).join('')||'<div class="empty">No data</div>';

  // Queue stream breakdown
  const qd=data.queue_distribution||{};
  const queueTotal=Object.values(qd).reduce((a,b)=>a+b,0)||1;
  const queueColors={emergency:'#ef4444',acute:'#f97316',maternal:'#a855f7',chronic:'#3b82f6',general:'#64748b',preventative:'#22c55e',walk_in:'#94a3b8'};
  document.getElementById('report-queue-dist').innerHTML=Object.entries(qd).filter(([,v])=>v>0).map(([k,v])=>{
    const pct=Math.round(v/queueTotal*100);
    return '<div style="display:flex;align-items:center;gap:8px;margin-bottom:8px"><span style="width:80px;font-size:11px;color:'+(queueColors[k]||'#64748b')+'">'+k+'</span><div style="flex:1;height:20px;background:rgba(255,255,255,.05);border-radius:4px;overflow:hidden"><div style="width:'+pct+'%;height:100%;background:'+(queueColors[k]||'#64748b')+'33;border-left:3px solid '+(queueColors[k]||'#64748b')+'"></div></div><span style="width:60px;text-align:right;font-size:12px;color:#94a3b8">'+v+'</span></div>';
  }).join('')||'<div class="empty">No data</div>';

  // Nurse feedback
  const na=data.nurse_agree||0,nd=data.nurse_disagree||0;
  const nTotal=na+nd||1;
  document.getElementById('report-nurse-feedback').innerHTML=na+nd>0?
    '<div style="display:flex;height:28px;border-radius:6px;overflow:hidden;margin-bottom:8px"><div style="width:'+Math.round(na/nTotal*100)+'%;background:rgba(34,197,94,.3);display:flex;align-items:center;justify-content:center;font-size:11px;color:#22c55e;font-weight:600">Agree '+na+'</div><div style="width:'+Math.round(nd/nTotal*100)+'%;background:rgba(249,115,22,.3);display:flex;align-items:center;justify-content:center;font-size:11px;color:#f97316;font-weight:600">Disagree '+nd+'</div></div><div style="font-size:11px;color:#64748b">Agreement rate: <b>'+Math.round(na/nTotal*100)+'%</b> across '+(na+nd)+' reviews</div>':
    '<div class="empty">No nurse feedback yet</div>';

  // Follow-up rate card
  (function(){
    var fs=data.followup_sent||0, fr=data.followup_responded||0;
    var fnr=data.followup_no_response||0, lostRate=data.followup_lost_rate;
    var el=document.getElementById('report-followup');
    var NATIONAL_LOST=28; // 28% lost-to-follow-up national baseline (Gauteng study)
    if(fs===0){el.innerHTML='<div class="empty">No follow-ups sent in this period</div>';return;}
    var responseRate=Math.round(fr/fs*100);
    var noRespRate=Math.round(fnr/fs*100);
    var otherRate=100-responseRate-noRespRate;
    var lostColor=lostRate!==null&&lostRate<NATIONAL_LOST?'#22c55e':'#f97316';
    var lostLabel=lostRate!==null?(lostRate<NATIONAL_LOST?'▲ Better than national':'▼ Above national'):null;
    el.innerHTML=
      '<div style="display:flex;gap:32px;align-items:flex-start;margin-bottom:16px">'+
        '<div>'+
          '<div style="font-size:11px;color:#64748b;text-transform:uppercase;letter-spacing:.05em">Response Rate</div>'+
          '<div style="font-size:40px;font-weight:700;color:'+(responseRate>=72?'#22c55e':'#eab308')+'">'+responseRate+'%</div>'+
          '<div style="font-size:11px;color:#64748b">'+fr+' of '+fs+' follow-ups answered</div>'+
        '</div>'+
        (lostRate!==null?
        '<div style="border-left:1px solid #1e293b;padding-left:32px">'+
          '<div style="font-size:11px;color:#64748b;text-transform:uppercase;letter-spacing:.05em">Lost-to-Follow-Up</div>'+
          '<div style="font-size:40px;font-weight:700;color:'+lostColor+'">'+lostRate+'%</div>'+
          '<div style="font-size:11px;color:'+lostColor+'">'+lostLabel+' baseline ('+NATIONAL_LOST+'%)</div>'+
        '</div>':'')+
      '</div>'+
      '<div style="display:flex;height:24px;border-radius:6px;overflow:hidden;margin-bottom:8px">'+
        '<div style="width:'+responseRate+'%;background:rgba(34,197,94,.3);display:flex;align-items:center;justify-content:center;font-size:10px;color:#22c55e;font-weight:600;white-space:nowrap;overflow:hidden">Responded '+fr+'</div>'+
        '<div style="width:'+noRespRate+'%;background:rgba(239,68,68,.25);display:flex;align-items:center;justify-content:center;font-size:10px;color:#ef4444;font-weight:600;white-space:nowrap;overflow:hidden">Lost '+fnr+'</div>'+
        (otherRate>0?'<div style="width:'+otherRate+'%;background:rgba(100,116,139,.15);display:flex;align-items:center;justify-content:center;font-size:10px;color:#64748b;font-weight:600;white-space:nowrap;overflow:hidden">Pending '+(fs-fr-fnr)+'</div>':'')+
      '</div>'+
      '<div style="display:flex;gap:16px;font-size:11px;color:#64748b;margin-top:4px">'+
        '<span style="color:#22c55e">■ Responded: '+responseRate+'%</span>'+
        '<span style="color:#ef4444">■ Lost-to-follow-up: '+noRespRate+'%</span>'+
        (otherRate>0?'<span style="color:#64748b">■ Pending: '+otherRate+'%</span>':'')+
        '<span style="margin-left:auto;color:#475569">National benchmark: '+NATIONAL_LOST+'% lost (Gauteng study)</span>'+
      '</div>';

    // Access failures section
    var af=data.access_failures||{};
    var afEl=document.getElementById('report-access-failures');
    var afTotal=(af.stockout||0)+(af.turned_away||0);
    if(afTotal===0){afEl.innerHTML='<div style="font-size:12px;color:#475569">No access failures reported in this period ✅</div>';return;}
    var byFac=af.by_facility||{};
    var facRows=Object.entries(byFac).map(function(e){
      return '<tr><td style="padding:4px 8px;font-size:12px;color:#94a3b8">'+e[0]+'</td>'+
        '<td style="padding:4px 8px;font-size:12px;color:#f97316">'+(e[1].stockout||0)+' stockout</td>'+
        '<td style="padding:4px 8px;font-size:12px;color:#ef4444">'+(e[1].turned_away||0)+' turned away</td></tr>';
    }).join('');
    afEl.innerHTML=
      '<div style="font-size:12px;color:#94a3b8;font-weight:600;margin-bottom:10px">⚠ Access Failures — '+afTotal+' reported this period</div>'+
      '<div style="display:flex;gap:24px;margin-bottom:12px">'+
        '<div><span style="font-size:24px;font-weight:700;color:#f97316">'+(af.stockout||0)+'</span><div style="font-size:11px;color:#64748b">stockout (no medicine)</div></div>'+
        '<div><span style="font-size:24px;font-weight:700;color:#ef4444">'+(af.turned_away||0)+'</span><div style="font-size:11px;color:#64748b">turned away</div></div>'+
      '</div>'+
      (facRows?'<table style="width:100%;border-collapse:collapse"><thead><tr><th style="padding:4px 8px;font-size:11px;color:#475569;text-align:left">Facility</th><th style="padding:4px 8px;font-size:11px;color:#475569;text-align:left">Stockout</th><th style="padding:4px 8px;font-size:11px;color:#475569;text-align:left">Turned Away</th></tr></thead><tbody>'+facRows+'</tbody></table>':'');
  })();

  // Daily volume
  const dv=data.daily_volume||{};
  const maxVol=Math.max(...Object.values(dv),1);
  document.getElementById('report-daily-volume').innerHTML=Object.entries(dv).length>0?
    '<div style="display:flex;align-items:flex-end;gap:4px;height:120px;padding-bottom:20px;position:relative">'+
    Object.entries(dv).map(([date,count])=>{
      const h=Math.max(Math.round(count/maxVol*100),4);
      const d=new Date(date);const dayLabel=(d.getDate())+'/'+(d.getMonth()+1);
      return '<div style="flex:1;display:flex;flex-direction:column;align-items:center;gap:2px"><div style="width:100%;height:'+h+'px;background:rgba(59,130,246,.4);border-radius:3px 3px 0 0;min-width:16px"></div><span style="font-size:8px;color:#475569;transform:rotate(-45deg);white-space:nowrap">'+dayLabel+'</span></div>';
    }).join('')+
    '</div>':
    '<div class="empty">No data for this period</div>';
}

// ── Shared xlsx helper ───────────────────────────────────────────
// Applies teal header row styling and auto column widths to a sheet.
function styleSheet(ws, headers) {
  const teal = { fgColor: { rgb: '0F766E' } };
  const white = { rgb: 'FFFFFF' };
  const headerFont = { bold: true, color: white, name: 'Arial', sz: 11 };
  const bodyFont   = { name: 'Arial', sz: 10 };
  const colWidths  = headers.map(h => ({ wch: Math.max(h.length + 4, 14) }));
  ws['!cols'] = colWidths;
  // Style header row (row 1)
  headers.forEach((h, i) => {
    const cell = XLSX.utils.encode_cell({ r: 0, c: i });
    if (!ws[cell]) return;
    ws[cell].s = { fill: teal, font: headerFont, alignment: { horizontal: 'center' } };
  });
  // Style body rows
  const range = XLSX.utils.decode_range(ws['!ref'] || 'A1');
  for (let r = 1; r <= range.e.r; r++) {
    for (let c = 0; c <= range.e.c; c++) {
      const cell = XLSX.utils.encode_cell({ r, c });
      if (!ws[cell]) continue;
      ws[cell].s = {
        font: bodyFont,
        fill: { fgColor: { rgb: r % 2 === 0 ? 'F8FAFC' : 'FFFFFF' } },
        border: { bottom: { style: 'thin', color: { rgb: 'E2E8F0' } } },
      };
    }
  }
}

function downloadXlsx(wb, filename) {
  const wbout = XLSX.write(wb, { bookType: 'xlsx', type: 'array', cellStyles: true });
  const blob = new Blob([wbout], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a'); a.href = url; a.download = filename;
  a.click(); URL.revokeObjectURL(url);
}

function summarySheet(rows) {
  const ws = XLSX.utils.aoa_to_sheet(rows);
  ws['!cols'] = [{ wch: 36 }, { wch: 16 }];
  return ws;
}

// ── Export: Triage Data ──────────────────────────────────────────
let _auditData = [];

async function loadAudit(){
  const filter = document.getElementById('audit-filter').value.trim().toUpperCase();
  const start  = document.getElementById('audit-start').value;
  const end    = document.getElementById('audit-end').value;
  let url = '/api/audit?limit=500';
  if (filter) url += '&action=' + encodeURIComponent(filter);
  if (start)  url += '&date_from=' + encodeURIComponent(start);
  if (end)    url += '&date_to='   + encodeURIComponent(end);
  const data = await api(url);
  _auditData = data || [];
  const ab = document.getElementById('audit-body');
  if (_auditData.length > 0) {
    ab.innerHTML = _auditData.slice(0, 200).map(a =>
      '<tr>' +
      '<td style="white-space:nowrap">' + timeAgo(a.created_at) + '</td>' +
      '<td>' + esc(a.user_name || '-') + '</td>' +
      '<td><span class="badge" style="color:#3b82f6;border:1px solid rgba(59,130,246,.3)">' + esc(a.action || '-') + '</span></td>' +
      '<td>' + esc(a.patient_id || '-') + '</td>' +
      '<td style="font-size:11px;color:#64748b;max-width:200px;overflow:hidden;text-overflow:ellipsis">' + esc(JSON.stringify(a.details || {}).slice(0, 120)) + '</td>' +
      '</tr>'
    ).join('');
    if (_auditData.length > 200) {
      ab.innerHTML += '<tr><td colspan="5" style="color:#64748b;font-size:11px;text-align:center">Showing 200 of ' + _auditData.length + ' — export to see all</td></tr>';
    }
  } else {
    ab.innerHTML = '<tr><td colspan="5" class="empty">No audit records found' + (filter ? ' for "' + filter + '"' : '') + '</td></tr>';
  }
}
// ── Regression Test Results ──────────────────────────────────────
async function loadRegression() {
  const el = document.getElementById('regression-body');
  el.innerHTML = '<div style="color:#475569;font-size:12px">Loading...</div>';
  const d = await api('/api/governance/regression');
  if (!d) { el.innerHTML = '<div style="color:#ef4444">Failed to load</div>'; return; }

  const r = d.latest_run;
  if (!r) { el.innerHTML = '<div style="color:#475569;font-size:12px">No test runs recorded yet. Run full_regression_test.js to generate data.</div>'; return; }

  const safeIcon = r.under_triage === 0 && r.critical_drift === 0 ? '✅' : '🚨';
  const pct = r.accuracy_pct || Math.round((r.passed||0)/(r.total_tests||1)*100);

  const statCards = [
    ['Accuracy', pct+'%', pct>=95?'#22c55e':pct>=90?'#f59e0b':'#ef4444'],
    ['Under-triage', r.under_triage||0, (r.under_triage||0)===0?'#22c55e':'#ef4444'],
    ['Over-triage', r.over_triage||0, '#64748b'],
    ['Language drift', r.language_drift||0, (r.language_drift||0)===0?'#22c55e':'#f59e0b'],
    ['Critical drift', r.critical_drift||0, (r.critical_drift||0)===0?'#22c55e':'#ef4444'],
    ['Parse errors', r.parse_errors||0, (r.parse_errors||0)===0?'#22c55e':'#f59e0b'],
  ].map(function(s){return '<div class="card"><div class="label">'+s[0]+'</div><div class="value" style="font-size:22px;color:'+s[2]+'">'+s[1]+'</div></div>';}).join('');
  let html = '<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(130px,1fr));gap:10px;margin-bottom:16px">'+statCards+'</div>';
  html += '<div style="font-size:11px;color:#475569;margin-bottom:16px">Last run: '+new Date(r.run_at).toLocaleString()+' \xb7 Model: '+r.model+' \xb7 '+(r.total_tests||0)+' vignettes</div>';

  if (d.failures && d.failures.length > 0) {
    html += '<div style="background:rgba(239,68,68,.1);border:1px solid rgba(239,68,68,.3);border-radius:8px;padding:12px;margin-bottom:12px"><div style="color:#ef4444;font-weight:700;margin-bottom:8px">🚨 Under-triage Failures</div>';
    html += d.failures.map(f=>'<div style="font-size:11px;color:#fca5a5;margin-bottom:4px">['+f.test_id+'] '+f.language+' — Got '+f.actual+', expected '+f.expected+' | '+f.reasoning+'</div>').join('');
    html += '</div>';
  } else {
    html += '<div style="background:rgba(34,197,94,.08);border:1px solid rgba(34,197,94,.2);border-radius:8px;padding:10px;margin-bottom:12px;color:#4ade80;font-size:12px">✅ Zero under-triage failures</div>';
  }

  // Language breakdown
  if (d.by_language && Object.keys(d.by_language).length > 0) {
    const langRows = Object.entries(d.by_language).map(([lang, c]) => {
      const tot = c.pass + c.fail;
      const pct = Math.round(c.pass/tot*100);
      const bar = pct === 100 ? '✅' : pct >= 80 ? '⚠️' : '❌';
      return '<tr><td style="color:#e2e8f0;font-size:12px">'+lang+'</td><td style="color:#94a3b8;font-size:12px">'+c.pass+'/'+tot+' ('+pct+'%)</td><td>'+(c.under>0?'<span style="color:#ef4444">🚨 '+c.under+' under</span>':bar)+'</td></tr>';
    }).join('');
    html += '<div class="card" style="padding:0;overflow:auto"><table><thead><tr><th>Language</th><th>Pass rate</th><th>Status</th></tr></thead><tbody>'+langRows+'</tbody></table></div>';
  }

  // History
  if (d.history && d.history.length > 1) {
    html += '<div style="margin-top:16px;font-size:12px;font-weight:600;color:#64748b;margin-bottom:8px">Run history</div>';
    html += '<div class="card" style="padding:0;overflow:auto"><table><thead><tr><th>Date</th><th>Score</th><th>Under-triage</th><th>Drift</th></tr></thead><tbody>';
    html += d.history.map(run => {
      const p = run.accuracy_pct || Math.round((run.passed||0)/(run.total_tests||1)*100);
      return '<tr><td style="color:#94a3b8;font-size:11px">'+new Date(run.run_at).toLocaleDateString()+'</td><td style="color:'+( p>=95?'#22c55e':p>=90?'#f59e0b':'#ef4444')+'">'+p+'%</td><td style="color:'+(run.under_triage===0?'#22c55e':'#ef4444')+'">'+run.under_triage+'</td><td style="color:'+(run.language_drift===0?'#22c55e':'#f59e0b')+'">'+run.language_drift+'</td></tr>';
    }).join('');
    html += '</tbody></table></div>';
  }

  el.innerHTML = html;
}

// ── Rule Review ─────────────────────────────────────────────────
async function loadRuleReview() {
  const month = document.getElementById('review-month').value ||
    new Date().toISOString().slice(0,7);
  const d = await api('/api/governance/disagreement-report?month='+month);
  if (!d) return;

  const summaryEl = document.getElementById('rule-review-summary');
  const bodyEl    = document.getElementById('rule-review-body');

  // Summary bar
  const missedRedAlert = d.missed_red_count > 0
    ? '<div style="background:rgba(239,68,68,.15);border:1px solid rgba(239,68,68,.3);border-radius:8px;padding:12px 16px;margin-bottom:12px;color:#f87171"><strong>⚠️ '+d.missed_red_count+' case(s) where AI missed RED — nurse upgraded to RED</strong><br><span style="font-size:11px;color:#94a3b8">These are the most critical disagreements — AI under-triaged a life-threatening case.</span></div>'
    : '<div style="background:rgba(34,197,94,.1);border:1px solid rgba(34,197,94,.2);border-radius:8px;padding:10px 16px;margin-bottom:12px;color:#4ade80;font-size:12px">✅ No missed RED cases this month</div>';

  summaryEl.innerHTML = missedRedAlert +
    '<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(140px,1fr));gap:12px;margin-bottom:16px">' +
    [['Total feedback',d.total_feedback],['Agreed',d.total_agree],['Disagreed',d.total_disagree],['Disagree rate',d.disagree_rate]].map(([l,v])=>
      '<div class="card"><div class="label">'+l+'</div><div class="value" style="font-size:22px">'+v+'</div></div>'
    ).join('') + '</div>';

  if (!d.top_rules || d.top_rules.length === 0) {
    bodyEl.innerHTML = '<div class="card" style="text-align:center;color:#475569;padding:32px">No disagreements recorded for '+month+'</div>';
    return;
  }

  // Rule table
  const cols = ['Rule / Trigger','Disagreements','Upgrades ↑','Downgrades ↓','Action needed'];
  const rows = d.top_rules.map(r => {
    const needsAction = r.disagree_count >= 3;
    const actionText  = r.upgrades > r.downgrades
      ? 'AI under-triaging — review rule sensitivity'
      : r.downgrades > r.upgrades
        ? 'AI over-triaging — review rule specificity'
        : 'Mixed — review case examples';
    return '<tr style="'+(needsAction?'background:rgba(249,115,22,.05)':'')+'">' +
      '<td style="font-family:monospace;font-size:11px;color:#94a3b8">'+(r.rule||'AI model (no rule)')+'</td>' +
      '<td style="font-weight:700;color:'+(r.disagree_count>=5?'#ef4444':r.disagree_count>=3?'#f97316':'#e2e8f0')+'">'+r.disagree_count+'</td>' +
      '<td style="color:#22c55e">'+r.upgrades+'</td>' +
      '<td style="color:#f97316">'+r.downgrades+'</td>' +
      '<td style="font-size:11px;color:'+(needsAction?'#f97316':'#475569')+'">'+(needsAction?'⚠️ '+actionText:'Monitor')+'</td>' +
      '</tr>';
  }).join('');

  bodyEl.innerHTML =
    '<div style="font-size:12px;color:#64748b;margin-bottom:8px">Rules with 3+ disagreements require review at the next clinical meeting. Discuss with Sheila.</div>' +
    '<div class="card" style="padding:0;overflow:auto"><table><thead><tr>'+cols.map(c=>'<th>'+c+'</th>').join('')+'</tr></thead><tbody>'+rows+'</tbody></table></div>' +
    (d.review_required && d.review_required.length > 0
      ? '<div style="margin-top:16px;padding:12px 16px;background:rgba(249,115,22,.08);border:1px solid rgba(249,115,22,.2);border-radius:8px;font-size:12px;color:#f97316">📋 <strong>'+d.review_required.length+' rule(s) require clinical review this month.</strong> Add to the next governance meeting agenda.</div>'
      : '<div style="margin-top:16px;padding:10px 16px;background:rgba(34,197,94,.08);border:1px solid rgba(34,197,94,.2);border-radius:8px;font-size:12px;color:#4ade80">✅ No rules require immediate review this month.</div>');
}

// ── Export: Triage Data ──────────────────────────────────────────
function exportCSV() {
  if (!_reportData || !_reportData.raw_triages) return alert('Load a report first');
  const start = document.getElementById('report-start').value;
  const end   = document.getElementById('report-end').value;
  const headers = ['Date', 'Patient ID', 'Triage Level', 'Confidence (%)', 'Pathway', 'Facility', 'Symptoms'];
  const rows = (_reportData.raw_triages || []).map(t => [
    t.created_at, t.patient_id, t.triage_level,
    t.confidence, t.pathway || '', t.facility_name || '',
    (t.symptoms || '').slice(0, 200),
  ]);
  const dist = _reportData.triage_distribution || {};
  const summaryRows = [
    ['BIZUSIZO Triage Data Export'],
    ['Period', start + ' to ' + end],
    ['Generated', new Date().toLocaleString('en-ZA')],
    [],
    ['SUMMARY'],
    ['Total patients', _reportData.total_patients || 0],
    ['Average AI confidence', (_reportData.avg_confidence || 0).toFixed(1) + '%'],
    ['RED', dist.RED || 0],
    ['ORANGE', dist.ORANGE || 0],
    ['YELLOW', dist.YELLOW || 0],
    ['GREEN', dist.GREEN || 0],
    ['Nurse agreed', _reportData.nurse_agree || 0],
    ['Nurse disagreed', _reportData.nurse_disagree || 0],
  ];
  const wb = XLSX.utils.book_new();
  const wsData = XLSX.utils.aoa_to_sheet([headers, ...rows]);
  styleSheet(wsData, headers);
  const wsSummary = summarySheet(summaryRows);
  XLSX.utils.book_append_sheet(wb, wsData, 'Triage Data');
  XLSX.utils.book_append_sheet(wb, wsSummary, 'Summary');
  downloadXlsx(wb, 'bizusizo-triage-' + start + '-to-' + end + '.xlsx');
}

// ── Export: Audit Log ────────────────────────────────────────────
function exportAuditCSV() {
  if (!_auditData || _auditData.length === 0) return alert('Load audit records first — click Search, then Export.');
  const start = document.getElementById('audit-start').value || 'all';
  const end   = document.getElementById('audit-end').value   || 'dates';
  const headers = ['Timestamp', 'User', 'Action', 'Patient ID', 'Facility ID', 'IP Address', 'Details'];
  const rows = _auditData.map(a => [
    a.created_at, a.user_name || '', a.action || '',
    a.patient_id || '', a.facility_id || '', a.ip_address || '',
    JSON.stringify(a.details || {}),
  ]);
  const actionCounts = _auditData.reduce((acc, a) => { acc[a.action] = (acc[a.action]||0)+1; return acc; }, {});
  const summaryRows = [
    ['BIZUSIZO Audit Log Export'],
    ['Period', start + ' to ' + end],
    ['Generated', new Date().toLocaleString('en-ZA')],
    [],
    ['SUMMARY'],
    ['Total records', _auditData.length],
    [],
    ['ACTION', 'COUNT'],
    ...Object.entries(actionCounts).sort((a,b) => b[1]-a[1]),
  ];
  const wb = XLSX.utils.book_new();
  const wsData = XLSX.utils.aoa_to_sheet([headers, ...rows]);
  styleSheet(wsData, headers);
  const wsSummary = summarySheet(summaryRows);
  XLSX.utils.book_append_sheet(wb, wsData, 'Audit Log');
  XLSX.utils.book_append_sheet(wb, wsSummary, 'Summary');
  downloadXlsx(wb, 'bizusizo-audit-log-' + start + '-to-' + end + '.xlsx');
}

// ── Export: Triage Concordance (EVAH primary outcome) ────────────
async function exportConcordanceCSV() {
  const start = document.getElementById('report-start').value;
  const end   = document.getElementById('report-end').value;
  if (!start || !end) return alert('Select a date range first, then click Concordance.');
  const data = await api('/api/reports/concordance?start=' + start + '&end=' + end);
  if (!data || !data.records) return alert('No concordance data for this period.');
  const headers = ['Date', 'Patient ID', 'Facility', 'AI Triage', 'AI Confidence (%)', 'Nurse Triage', 'Verdict', 'Concordant', 'Category', 'Symptoms'];
  const rows = data.records.map(r => {
    const concordant = r.ai_triage === r.nurse_triage ? 'YES' : (r.nurse_triage ? 'NO' : 'NO_FEEDBACK');
    return [
      r.created_at, r.patient_id, r.facility_name || '',
      r.ai_triage, r.ai_confidence, r.nurse_triage || '',
      r.verdict || '', concordant, r.category || '',
      (r.symptoms || '').slice(0, 200),
    ];
  });
  const total      = data.records.length;
  const concordant = data.records.filter(r => r.ai_triage === r.nurse_triage && r.nurse_triage).length;
  const upgraded   = data.records.filter(r => r.verdict==='disagree' && ['RED','ORANGE'].includes(r.nurse_triage) && !['RED','ORANGE'].includes(r.ai_triage)).length;
  const downgraded = data.records.filter(r => r.verdict==='disagree' && ['GREEN','YELLOW'].includes(r.nurse_triage) && ['RED','ORANGE'].includes(r.ai_triage)).length;
  const noFeedback = data.records.filter(r => !r.nurse_triage).length;
  const underTriage= data.records.filter(r => r.verdict==='disagree' && ['RED','ORANGE'].includes(r.nurse_triage) && ['YELLOW','GREEN'].includes(r.ai_triage)).length;
  const concordanceRate = total > 0 ? ((concordant / (total - noFeedback)) * 100).toFixed(1) + '%' : 'N/A';
  const summaryRows = [
    ['BIZUSIZO Triage Concordance — EVAH Primary Outcome'],
    ['Period', start + ' to ' + end],
    ['Generated', new Date().toLocaleString('en-ZA')],
    [],
    ['METRIC', 'VALUE', 'NOTES'],
    ['Total triage records', total, ''],
    ['Nurse feedback received', total - noFeedback, ''],
    ['No nurse feedback yet', noFeedback, 'Not yet seen by nurse'],
    ['Concordant (AI = Nurse)', concordant, ''],
    ['Concordance rate', concordanceRate, 'Excludes no-feedback'],
    ['Nurse upgraded triage', upgraded, 'Nurse found more urgent than AI'],
    ['Nurse downgraded triage', downgraded, 'Nurse found less urgent than AI'],
    ['⚠️ Under-triage (AI missed urgent)', underTriage, 'AI said YELLOW/GREEN, nurse said RED/ORANGE'],
  ];
  const wb = XLSX.utils.book_new();
  const wsData = XLSX.utils.aoa_to_sheet([headers, ...rows]);
  styleSheet(wsData, headers);
  const wsSummary = summarySheet(summaryRows);
  XLSX.utils.book_append_sheet(wb, wsData, 'Concordance Data');
  XLSX.utils.book_append_sheet(wb, wsSummary, 'Summary');
  downloadXlsx(wb, 'bizusizo-concordance-' + start + '-to-' + end + '.xlsx');
}

// ── Export: Consent Log (POPIA audit) ────────────────────────────
async function exportConsentCSV() {
  const start = document.getElementById('report-start').value;
  const end   = document.getElementById('report-end').value;
  if (!start || !end) return alert('Select a date range first, then click Consent Log.');
  const data = await api('/api/reports/consent-log?start=' + start + '&end=' + end);
  if (!data || !data.records) return alert('No consent records for this period.');
  const headers = ['Timestamp', 'Patient ID', 'Event Type', 'Language', 'Consent Version', 'Channel', 'Study Code'];
  const rows = data.records.map(r => [
    r.logged_at, r.patient_id, r.event_type, r.language || '',
    r.consent_version || '', r.channel || 'whatsapp',
    (r.metadata && r.metadata.study_code) ? r.metadata.study_code : '',
  ]);
  const recs = data.records;
  const summaryRows = [
    ['BIZUSIZO Consent Log — POPIA Audit Record'],
    ['Period', start + ' to ' + end],
    ['Generated', new Date().toLocaleString('en-ZA')],
    ['Consent version', recs[0]?.consent_version || 'v2.0-2026-04-01'],
    [],
    ['EVENT TYPE', 'COUNT'],
    ['Service consent given',     recs.filter(r=>r.event_type==='service_consent_given').length],
    ['Service consent declined',  recs.filter(r=>r.event_type==='service_consent_declined').length],
    ['Study consent given',       recs.filter(r=>r.event_type==='study_consent_given').length],
    ['Study consent declined',    recs.filter(r=>r.event_type==='study_consent_declined').length],
    ['Consent withdrawn (STOP)',  recs.filter(r=>r.event_type==='service_consent_withdrawn').length],
    [],
    ['TOTAL EVENTS', recs.length],
  ];
  const wb = XLSX.utils.book_new();
  const wsData = XLSX.utils.aoa_to_sheet([headers, ...rows]);
  styleSheet(wsData, headers);
  const wsSummary = summarySheet(summaryRows);
  XLSX.utils.book_append_sheet(wb, wsData, 'Consent Log');
  XLSX.utils.book_append_sheet(wb, wsSummary, 'Summary');
  downloadXlsx(wb, 'bizusizo-consent-log-' + start + '-to-' + end + '.xlsx');
}

// ── Export: Referral Log ─────────────────────────────────────────
async function exportReferralCSV() {
  const start = document.getElementById('report-start').value;
  const end   = document.getElementById('report-end').value;
  if (!start || !end) return alert('Select a date range first, then click Referrals.');
  const data = await api('/api/reports/referrals?start=' + start + '&end=' + end);
  if (!data || !data.records) return alert('No referrals for this period.');
  const headers = ['Timestamp', 'REF Number', 'Originating Facility', 'Receiving Facility', 'Triage Level', 'Transport', 'Referral Reason', 'Status', 'Looked Up At'];
  const rows = data.records.map(r => [
    r.created_at, r.ref_number || '', r.originating_facility_name || '',
    r.receiving_facility_name || '', r.triage_level || '',
    r.transport_method || '', r.referral_reason || '',
    r.status || '', r.looked_up_at || '',
  ]);
  const recs = data.records;
  const summaryRows = [
    ['BIZUSIZO Referral Log'],
    ['Period', start + ' to ' + end],
    ['Generated', new Date().toLocaleString('en-ZA')],
    [],
    ['METRIC', 'COUNT'],
    ['Total referrals',              recs.length],
    ['Ambulance',                    recs.filter(r=>r.transport_method==='ambulance').length],
    ['Self-transport',               recs.filter(r=>r.transport_method==='self').length],
    ['Accepted by hospital',         recs.filter(r=>r.status==='accepted').length],
    ['Pending (not yet looked up)',  recs.filter(r=>r.status==='pending'||!r.status).length],
  ];
  const wb = XLSX.utils.book_new();
  const wsData = XLSX.utils.aoa_to_sheet([headers, ...rows]);
  styleSheet(wsData, headers);
  const wsSummary = summarySheet(summaryRows);
  XLSX.utils.book_append_sheet(wb, wsData, 'Referrals');
  XLSX.utils.book_append_sheet(wb, wsSummary, 'Summary');
  downloadXlsx(wb, 'bizusizo-referrals-' + start + '-to-' + end + '.xlsx');
}

// ── Export: Passport Views ───────────────────────────────────────
async function exportPassportCSV() {
  const start = document.getElementById('report-start').value;
  const end   = document.getElementById('report-end').value;
  if (!start || !end) return alert('Select a date range first, then click Passport Views.');
  const data = await api('/api/reports/passport-views?start=' + start + '&end=' + end);
  if (!data || !data.records) return alert('No passport views for this period.');
  const headers = ['Timestamp', 'Patient ID', 'Viewer Type', 'Token', 'IP Address', 'User Agent'];
  const rows = data.records.map(r => [
    r.viewed_at, r.patient_id, r.viewer_type || 'unknown', (r.token || '').slice(0, 12) + '…',
    r.ip_address || '', (r.user_agent || '').slice(0, 100),
  ]);
  const recs = data.records;
  const uniquePatients = [...new Set(recs.map(r => r.patient_id))].length;
  const uniqueIPs = [...new Set(recs.map(r => r.ip_address).filter(Boolean))].length;
  // Feedback data
  const feedback = data.feedback || [];
  const yesCount = feedback.filter(f => f.rating === 'yes').length;
  const noCount = feedback.filter(f => f.rating === 'no').length;
  const fbTotal = feedback.length;
  const satisfactionRate = fbTotal > 0 ? Math.round(yesCount / fbTotal * 100) + '%' : 'N/A';

  const summaryRows = [
    ['BIZUSIZO Health Passport — Views & Feedback'],
    ['Period', start + ' to ' + end],
    ['Generated', new Date().toLocaleString('en-ZA')],
    [],
    ['VIEWS'],
    ['Total views', recs.length],
    ['Unique patients viewed', uniquePatients],
    ['Unique IP addresses (approx. unique viewers)', uniqueIPs],
    [],
    ['VIEWS BY TYPE'],
    ['Patient views', recs.filter(r=>r.viewer_type==='patient').length],
    ['Doctor views', recs.filter(r=>r.viewer_type==='doctor').length],
    ['Pharmacist views', recs.filter(r=>r.viewer_type==='pharmacist').length],
    ['Unknown', recs.filter(r=>!r.viewer_type||r.viewer_type==='unknown').length],
    [],
    ['DOCTOR FEEDBACK'],
    ['Total feedback received', fbTotal],
    ['👍 Useful (Yes)', yesCount],
    ['👎 Not useful (No)', noCount],
    ['Satisfaction rate', satisfactionRate],
  ];

  // Feedback rows
  const fbHeaders = ['Timestamp', 'Patient ID', 'Rating', 'Comment', 'IP Address'];
  const fbRows = feedback.map(f => [
    f.created_at, f.patient_id || '', f.rating, f.comment || '', f.ip_address || '',
  ]);

  const wb = XLSX.utils.book_new();
  const wsData = XLSX.utils.aoa_to_sheet([headers, ...rows]);
  styleSheet(wsData, headers);
  const wsFeedback = XLSX.utils.aoa_to_sheet([fbHeaders, ...fbRows]);
  styleSheet(wsFeedback, fbHeaders);
  const wsSummary = summarySheet(summaryRows);
  XLSX.utils.book_append_sheet(wb, wsData, 'Passport Views');
  XLSX.utils.book_append_sheet(wb, wsFeedback, 'Doctor Feedback');
  XLSX.utils.book_append_sheet(wb, wsSummary, 'Summary');
  downloadXlsx(wb, 'bizusizo-passport-views-' + start + '-to-' + end + '.xlsx');
}

// Set default date range to last 7 days
(function(){
  const end=new Date();const start=new Date();start.setDate(start.getDate()-7);
  const fmt=d=>d.toISOString().split('T')[0];
  document.getElementById('report-start').value=fmt(start);
  document.getElementById('report-end').value=fmt(end);
  document.getElementById('audit-start').value=fmt(start);
  document.getElementById('audit-end').value=fmt(end);
})();

setInterval(refresh,30000);

// ── Staff Management ─────────────────────────────────────────
let _staffList=[];
let _facilityList=[];
let _editingStaffId=null;
let _resetStaffId=null;

// ── Outbreak Surveillance ─────────────────────────────────────────
let _outbreakData = [];

async function loadOutbreak() {
  const active   = await api('/api/outbreak/alerts?resolved=false&limit=50');
  const resolved = await api('/api/outbreak/alerts?resolved=true&limit=10');
  _outbreakData  = active || [];

  // Summary cards
  const immediate = (_outbreakData).filter(a => a.alert_level === 'IMMEDIATE' && !a.nurse_confirmed);
  const alerts    = (_outbreakData).filter(a => a.alert_level === 'ALERT');
  const warnings  = (_outbreakData).filter(a => a.alert_level === 'WARNING');
  const watches   = (_outbreakData).filter(a => a.alert_level === 'WATCH');

  document.getElementById('outbreak-summary').innerHTML = [
    { label: 'IMMEDIATE',        value: immediate.length, color: immediate.length > 0 ? '#ef4444' : '#22c55e' },
    { label: 'ALERT',            value: alerts.length,    color: alerts.length    > 0 ? '#f97316' : '#64748b' },
    { label: 'WARNING',          value: warnings.length,  color: warnings.length  > 0 ? '#eab308' : '#64748b' },
    { label: 'WATCH',            value: watches.length,   color: '#3b82f6'                                    },
    { label: 'Total Active',     value: _outbreakData.length, color: '#e2e8f0'                                },
  ].map(c =>
    '<div class="card">' +
      '<div class="label">' + c.label + '</div>' +
      '<div class="value" style="font-size:26px;color:' + c.color + '">' + c.value + '</div>' +
    '</div>'
  ).join('');

  // IMMEDIATE section
  const immediateSection = document.getElementById('outbreak-immediate-section');
  const immediateBody    = document.getElementById('outbreak-immediate-body');
  if (immediate.length > 0) {
    immediateSection.style.display = 'block';
    immediateBody.innerHTML = immediate.map(a =>
      '<div style="background:rgba(0,0,0,.2);border-radius:8px;padding:14px;margin-bottom:10px">' +
        '<div style="display:flex;justify-content:space-between;align-items:flex-start;flex-wrap:wrap;gap:8px">' +
          '<div>' +
            '<div style="font-weight:700;color:#f87171;font-size:13px">' + esc(a.syndrome_name||a.syndrome_id) + '</div>' +
            '<div style="font-size:12px;color:#94a3b8;margin-top:2px">' +
              a.case_count + ' case(s) in ' + a.window_hours + 'h · ' + timeAgo(a.created_at) +
            '</div>' +
            '<div style="font-size:11px;color:#64748b;margin-top:4px">' +
              'NMC Category ' + (a.nmc_category || '1') + ' · ' + esc(a.rationale||'') +
            '</div>' +
          '</div>' +
          '<div style="display:flex;gap:8px;flex-wrap:wrap">' +
            '<button onclick="confirmOutbreakAlert(\'' + a.id + '\', true)"' +
              ' style="padding:6px 14px;border-radius:6px;border:none;background:#ef4444;' +
              'color:white;cursor:pointer;font-size:12px;font-weight:600">' +
              '✅ Confirm — patient examined' +
            '</button>' +
            '<button onclick="confirmOutbreakAlert(\'' + a.id + '\', false)"' +
              ' style="padding:6px 14px;border-radius:6px;border:1px solid #475569;' +
              'background:transparent;color:#94a3b8;cursor:pointer;font-size:12px">' +
              '✗ Dismiss' +
            '</button>' +
          '</div>' +
        '</div>' +
        '<div style="margin-top:10px;padding:10px;background:rgba(239,68,68,.08);border-radius:6px;font-size:11px;color:#fca5a5">' +
          '⚠️ Do NOT contact NICD until you have physically examined the patient and confirmed this alert.' +
        '</div>' +
      '</div>'
    ).join('');
  } else {
    immediateSection.style.display = 'none';
  }

  // Active alerts table
  const ab = document.getElementById('outbreak-active-body');
  if (_outbreakData.length > 0) {
    ab.innerHTML = _outbreakData.map(a => {
      const levelColors = {
        IMMEDIATE: '#ef4444', ALERT: '#f97316', WARNING: '#eab308', WATCH: '#3b82f6'
      };
      const col = levelColors[a.alert_level] || '#64748b';
      var nmcBadge = a.nmc_immediate
        ? '<span style="color:#ef4444;font-size:10px;font-weight:600">CAT ' + a.nmc_category + '</span>'
        : '<span style="color:#475569;font-size:10px">—</span>';
      var statusText = a.alert_level === 'IMMEDIATE'
        ? (a.nurse_confirmed
            ? (a.nmc_notified
                ? '<span style="color:#22c55e;font-size:11px">✅ NICD notified</span>'
                : '<span style="color:#eab308;font-size:11px">⏳ Awaiting NICD notification</span>')
            : '<span style="color:#ef4444;font-size:11px">⚠️ Awaiting nurse review</span>')
        : '<span style="color:#64748b;font-size:11px">Monitoring</span>';
      var nmcBtn = (a.alert_level === 'IMMEDIATE' && a.nurse_confirmed && !a.nmc_notified)
        ? '<button onclick="markNMCNotified(\'' + a.id + '\')"' +
            ' style="margin-left:8px;padding:3px 8px;border-radius:4px;border:1px solid #22c55e;' +
            'background:transparent;color:#22c55e;cursor:pointer;font-size:10px">' +
            'Mark NICD notified</button>'
        : '';
      return '<tr>' +
        '<td style="font-size:11px;color:#94a3b8;white-space:nowrap">' + timeAgo(a.created_at) + '</td>' +
        '<td style="font-size:12px;font-weight:600">' + esc(a.syndrome_name||a.syndrome_id) + '</td>' +
        '<td><span style="color:' + col + ';font-weight:700;font-size:12px">' + a.alert_level + '</span></td>' +
        '<td style="font-size:12px">' + a.case_count + '</td>' +
        '<td style="font-size:11px;color:#94a3b8">' + a.window_hours + 'h</td>' +
        '<td>' + nmcBadge + '</td>' +
        '<td>' + statusText + nmcBtn + '</td>' +
      '</tr>';
    }).join('');
  } else {
    ab.innerHTML = '<tr><td colspan="7" class="empty">No active outbreak alerts</td></tr>';
  }

  // Resolved alerts table
  const rb = document.getElementById('outbreak-resolved-body');
  if (resolved && resolved.length > 0) {
    rb.innerHTML = resolved.map(a =>
      '<tr>' +
        '<td style="font-size:11px;color:#94a3b8">' + timeAgo(a.created_at) + '</td>' +
        '<td style="font-size:12px">' + esc(a.syndrome_name||a.syndrome_id) + '</td>' +
        '<td style="font-size:12px;color:#64748b">' + a.alert_level + '</td>' +
        '<td style="font-size:12px">' + a.case_count + '</td>' +
        '<td style="font-size:12px;color:#94a3b8">' + esc(a.resolved_by||'—') + '</td>' +
        '<td style="font-size:11px;color:#64748b;max-width:200px;overflow:hidden;' +
          'text-overflow:ellipsis">' + esc(a.resolution_notes||'—') + '</td>' +
      '</tr>'
    ).join('');
  } else {
    rb.innerHTML = '<tr><td colspan="6" class="empty">No recently resolved alerts</td></tr>';
  }
}

async function confirmOutbreakAlert(id, confirmed) {
  if (!confirmed) {
    const reason = prompt('Why are you dismissing this alert?\n(Required — e.g. "Patient examined, normal presentation, not consistent with cholera")');
    if (!reason) return;
    const r = await fetch('/api/outbreak/alerts/' + id + '/confirm', {
      method: 'POST',
      headers: { 'x-dashboard-password': PWD, 'x-dashboard-user': UNAME, 'Content-Type': 'application/json' },
      body: JSON.stringify({ confirmed: false, dismiss_reason: reason }),
    });
    const d = await r.json();
    if (d.success) loadOutbreak();
    return;
  }

  // Confirmed — show NICD contact details
  const r = await fetch('/api/outbreak/alerts/' + id + '/confirm', {
    method: 'POST',
    headers: { 'x-dashboard-password': PWD, 'x-dashboard-user': UNAME, 'Content-Type': 'application/json' },
    body: JSON.stringify({ confirmed: true }),
  });
  const d = await r.json();
  if (d.success) {
    alert(
      'Alert confirmed. Now notify NICD:\n\n' +
      '📧 Email: NMCsurveillanceReport@nicd.ac.za\n' +
      '📱 WhatsApp/SMS: 072 621 3805\n' +
      '☎️  Hotline: 0800-212-552\n' +
      '🌐 Portal: https://nmc.nicd.ac.za/\n\n' +
      'After notifying, click "Mark NICD notified" on the alert row.'
    );
    loadOutbreak();
  }
}

async function markNMCNotified(id) {
  const method = prompt('How did you notify NICD?\n(e.g. email, WhatsApp, hotline, portal)');
  if (!method) return;
  const ref = prompt('Reference number or confirmation received? (type "none" if not given)');
  const r = await fetch('/api/outbreak/alerts/' + id + '/mark-notified', {
    method: 'POST',
    headers: { 'x-dashboard-password': PWD, 'x-dashboard-user': UNAME, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      notification_method: method,
      reference_number: (ref && ref.toLowerCase() !== 'none') ? ref : null,
    }),
  });
  const d = await r.json();
  if (d.success) loadOutbreak();
}
async function loadStaff(){
  var d=await api('/api/staff');
  if(!d||!d.staff)return;
  _staffList=d.staff;
  var f=await api('/api/staff/facilities');
  if(f&&f.facilities){
    _facilityList=f.facilities;
    var sel=document.getElementById('sf-facility');
    sel.innerHTML='<option value="">No facility (admin/district)</option>'+f.facilities.map(function(fac){return '<option value="'+fac.id+'">'+esc(fac.name)+'</option>';}).join('');
  }
  renderStaffTable();
}

function renderStaffTable(){
  var sb=document.getElementById('staff-body');
  if(_staffList.length===0){sb.innerHTML='<tr><td colspan="7" class="empty">No staff members found</td></tr>';return;}
  sb.innerHTML=_staffList.map(function(u){
    var roleColor={admin:'#a855f7',nurse:'#22c55e',reception:'#3b82f6',manager:'#f59e0b',district:'#06b6d4'};
    var statusColor=u.is_active?'#22c55e':'#ef4444';
    var statusText=u.is_active?'Active':'Inactive';
    return '<tr>'+
      '<td style="font-weight:600">'+esc(u.display_name)+'</td>'+
      '<td style="font-family:monospace;font-size:12px;color:#94a3b8">'+esc(u.username)+'</td>'+
      '<td><span class="badge" style="color:'+(roleColor[u.role]||'#64748b')+';border:1px solid '+(roleColor[u.role]||'#64748b')+'33">'+esc(u.role)+'</span></td>'+
      '<td style="font-size:12px;color:#94a3b8">'+esc(u.facility_name||u.district_name||'—')+'</td>'+
      '<td><span style="color:'+statusColor+';font-size:12px;font-weight:600">'+statusText+'</span></td>'+
      '<td style="font-size:11px;color:#475569">'+( u.last_login?timeAgo(u.last_login):'Never')+'</td>'+
      '<td style="white-space:nowrap">'+
        '<button onclick="editStaff('+u.id+')" style="padding:3px 8px;border-radius:4px;border:1px solid #3b82f6;background:transparent;color:#3b82f6;cursor:pointer;font-size:11px;margin-right:4px">Edit</button>'+
        '<button onclick="showResetPassword('+u.id+',\\''+esc(u.display_name)+'\\')" style="padding:3px 8px;border-radius:4px;border:1px solid #f59e0b;background:transparent;color:#f59e0b;cursor:pointer;font-size:11px;margin-right:4px">Reset PW</button>'+
        (u.is_active?'<button onclick="toggleStaff('+u.id+',false)" style="padding:3px 8px;border-radius:4px;border:1px solid #ef4444;background:transparent;color:#ef4444;cursor:pointer;font-size:11px">Deactivate</button>':'<button onclick="toggleStaff('+u.id+',true)" style="padding:3px 8px;border-radius:4px;border:1px solid #22c55e;background:transparent;color:#22c55e;cursor:pointer;font-size:11px">Activate</button>')+
      '</td></tr>';
  }).join('');
}

function showAddStaff(){
  _editingStaffId=null;
  document.getElementById('staff-form-title').textContent='Add New Staff';
  document.getElementById('sf-name').value='';
  document.getElementById('sf-username').value='';
  document.getElementById('sf-password').value='';
  document.getElementById('sf-password').placeholder='Min 8 characters';
  document.getElementById('sf-role').value='';
  document.getElementById('sf-facility').value='';
  document.getElementById('sf-district').value='';
  document.getElementById('sf-error').textContent='';
  document.getElementById('sf-success').textContent='';
  document.getElementById('staff-form').style.display='block';
  document.getElementById('staff-reset-form').style.display='none';
}

function editStaff(id){
  var u=_staffList.find(function(s){return s.id===id;});
  if(!u)return;
  _editingStaffId=id;
  document.getElementById('staff-form-title').textContent='Edit: '+u.display_name;
  document.getElementById('sf-name').value=u.display_name;
  document.getElementById('sf-username').value=u.username;
  document.getElementById('sf-password').value='';
  document.getElementById('sf-password').placeholder='Leave blank to keep current';
  document.getElementById('sf-role').value=u.role;
  document.getElementById('sf-facility').value=u.facility_id||'';
  document.getElementById('sf-district').value=u.district_name||'';
  document.getElementById('sf-error').textContent='';
  document.getElementById('sf-success').textContent='';
  document.getElementById('staff-form').style.display='block';
  document.getElementById('staff-reset-form').style.display='none';
}

function hideStaffForm(){document.getElementById('staff-form').style.display='none';_editingStaffId=null;}
function hideResetForm(){document.getElementById('staff-reset-form').style.display='none';_resetStaffId=null;}

async function submitStaff(){
  var name=document.getElementById('sf-name').value.trim();
  var username=document.getElementById('sf-username').value.trim();
  var password=document.getElementById('sf-password').value;
  var role=document.getElementById('sf-role').value;
  var facility=document.getElementById('sf-facility').value;
  var district=document.getElementById('sf-district').value.trim();
  document.getElementById('sf-error').textContent='';
  document.getElementById('sf-success').textContent='';
  if(!name||!role){document.getElementById('sf-error').textContent='Name and role are required';return;}
  if(_editingStaffId){
    var body={display_name:name,role:role,facility_id:facility||null,district_name:district||null};
    var r=await fetch(API+'/api/staff/'+_editingStaffId,{method:'PUT',headers:{'x-dashboard-password':PWD,'x-dashboard-user':UNAME,'Content-Type':'application/json'},body:JSON.stringify(body)});
    var d=await r.json();
    if(d.success){document.getElementById('sf-success').textContent='Updated successfully';loadStaff();}
    else{document.getElementById('sf-error').textContent=d.error||'Update failed';}
  }else{
    if(!username||!password){document.getElementById('sf-error').textContent='Username and password required for new staff';return;}
    if(password.length<8){document.getElementById('sf-error').textContent='Password must be at least 8 characters';return;}
    var body={display_name:name,username:username.toLowerCase(),password:password,role:role,facility_id:facility||null,district_name:district||null};
    var r=await fetch(API+'/api/staff',{method:'POST',headers:{'x-dashboard-password':PWD,'x-dashboard-user':UNAME,'Content-Type':'application/json'},body:JSON.stringify(body)});
    var d=await r.json();
    if(d.success){document.getElementById('sf-success').textContent='Staff member created: '+d.user.username;document.getElementById('sf-username').value='';document.getElementById('sf-password').value='';document.getElementById('sf-name').value='';loadStaff();}
    else{document.getElementById('sf-error').textContent=d.error||'Creation failed';}
  }
}

function showResetPassword(id,name){
  _resetStaffId=id;
  document.getElementById('sr-name').textContent=name;
  document.getElementById('sr-password').value='';
  document.getElementById('sr-error').textContent='';
  document.getElementById('staff-reset-form').style.display='block';
  document.getElementById('staff-form').style.display='none';
}

async function submitResetPassword(){
  var pw=document.getElementById('sr-password').value;
  if(!pw||pw.length<8){document.getElementById('sr-error').textContent='Password must be at least 8 characters';return;}
  var r=await fetch(API+'/api/staff/'+_resetStaffId+'/reset-password',{method:'POST',headers:{'x-dashboard-password':PWD,'x-dashboard-user':UNAME,'Content-Type':'application/json'},body:JSON.stringify({new_password:pw})});
  var d=await r.json();
  if(d.success){hideResetForm();alert('Password reset successfully. User must log in again.');}
  else{document.getElementById('sr-error').textContent=d.error||'Reset failed';}
}

async function toggleStaff(id,activate){
  if(!confirm(activate?'Activate this staff member?':'Deactivate this staff member? They will be logged out immediately.'))return;
  var r=await fetch(API+'/api/staff/'+id,{method:'PUT',headers:{'x-dashboard-password':PWD,'x-dashboard-user':UNAME,'Content-Type':'application/json'},body:JSON.stringify({is_active:activate})});
  var d=await r.json();
  if(d.success)loadStaff();
}
</script>
</body>
</html>`);
});

// ================================================================
// CLINIC QUEUE DASHBOARD — Session-protected, served from file
// ================================================================
app.get('/clinic', (req, res) => {
  // Check for session cookie — redirect to login if not present
  const cookies = parseCookies(req);
  if (!cookies.bz_session) {
    return res.redirect('/clinical/login');
  }
  res.sendFile(path.join(__dirname, 'public', 'clinic.html'));
});



// ================== CONFIG ==================
const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

// ================== GOVERNANCE FRAMEWORK ==================
const { GovernanceOrchestrator, deterministicRedClassifier } = require('./governance');


const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);
triageLib.init(supabase);
sessionLib.init(supabase);
followup.init(supabase);
outbreak.init(supabase);
smsLib.init(supabase);


const CONFIDENCE_THRESHOLD = 75;

// ================== GOVERNANCE ORCHESTRATOR ==================
// Initialized after helpers section below (needs queueEvent to be defined first)
let governance;

// ================== FEATURE FLAGS ==================
// Set these to true when partnerships/integrations are ready
const FEATURES = {
  STUDY_MODE: true,              // Enable during pilot — shows study consent in Phase 2. Disable for production scale.
  CCMDD_ROUTING: false,          // Enable when CCMDD partnership agreements signed
  VIRTUAL_CONSULTS: false,       // Enable when telemedicine provider integrated
  LAB_RESULTS: true,             // Lab results module — manual entry active by default
  NHLS_API_INTEGRATION: false,   // Enable when NHLS API/LabTrack integration available
  EMS_DISPATCH: false,           // Enable when provincial EMS dispatch API integration available
  CCMDD_API_URL: process.env.CCMDD_API_URL || null,
  VIRTUAL_CONSULT_URL: process.env.VIRTUAL_CONSULT_URL || null,
  VIRTUAL_CONSULT_PHONE: process.env.VIRTUAL_CONSULT_PHONE || null,
  NHLS_API_URL: process.env.NHLS_API_URL || null,        // Future: NHLS LabTrack API endpoint
  NHLS_API_KEY: process.env.NHLS_API_KEY || null,         // Future: NHLS API credentials
  EMS_DISPATCH_URL: process.env.EMS_DISPATCH_URL || null,  // Future: Provincial EMS dispatch endpoint
  EMS_DISPATCH_KEY: process.env.EMS_DISPATCH_KEY || null,  // Future: EMS API credentials
};

// ================== HELPERS ==================

// ================================================================
// RESILIENT EVENT LOG
// ================================================================
// During outages (load shedding, Supabase downtime), governance events
// that can't be written to the database are queued in a local JSON file.
// A flush agent runs every 2 minutes and pushes queued events to Supabase
// when connectivity returns. This ensures no governance data is lost
// even during extended outages.
// ================================================================
// ── Event queue — Supabase-backed, file fallback for DB outages ──
// Primary: insert to `event_queue` table (multi-instance safe).
// Fallback: local file when Supabase itself is unreachable.
const EVENT_LOG_PATH = path.join(__dirname, '.bizusizo_event_queue.json');

function _fileQueueRead() {
  try {
    if (fs.existsSync(EVENT_LOG_PATH)) return JSON.parse(fs.readFileSync(EVENT_LOG_PATH, 'utf8'));
  } catch (e) { logger.error('[EVENT_LOG] File read error:', e.message); }
  return [];
}
function _fileQueueWrite(events) {
  try { fs.writeFileSync(EVENT_LOG_PATH, JSON.stringify(events, null, 2)); }
  catch (e) { logger.error('[EVENT_LOG] File write error:', e.message); }
}

function queueEvent(event) {
  // Try Supabase first (async, fire-and-forget with file fallback)
  supabase.from('event_queue').insert({
    event_type:   event.type,
    target_table: event.table,
    payload:      event.data || {},
  }).then(({ error }) => {
    if (error) {
      // Supabase unreachable — fall back to file
      const q = _fileQueueRead();
      q.push({ ...event, queued_at: new Date().toISOString(), flushed: false });
      _fileQueueWrite(q);
      logger.info(`[EVENT_LOG] Supabase unavailable — queued locally (${q.length} pending): ${event.type}`);
    } else {
      logger.info(`[EVENT_LOG] Queued to Supabase: ${event.type}`);
    }
  }).catch(() => {
    const q = _fileQueueRead();
    q.push({ ...event, queued_at: new Date().toISOString(), flushed: false });
    _fileQueueWrite(q);
  });
}

async function _applyQueuedEvent(event) {
  const data = event.data || event.payload || {};
  const table = event.table || event.target_table;
  if (table === 'governance_alerts') {
    await supabase.from('governance_alerts').insert({
      alert_type:  data.alert_type,
      severity:    data.severity,
      pillar:      data.pillar,
      message:     data.message,
      data:        data.extra || null,
      created_at:  data.original_timestamp || event.queued_at,
      resolved:    false,
      assigned_to: data.assigned_to || null,
    });
  } else if (table === 'governance_metrics') {
    await supabase.from('governance_metrics').insert({
      metric_type: data.metric_type,
      data:        data.metric_data || {},
      created_at:  data.original_timestamp || event.queued_at,
    });
  }
}

async function flushEventQueue() {
  // 1. Flush Supabase event_queue rows
  try {
    const { data: pending } = await supabase
      .from('event_queue')
      .select('*')
      .eq('flushed', false)
      .order('queued_at', { ascending: true })
      .limit(50);

    if (pending && pending.length > 0) {
      let flushed = 0;
      for (const row of pending) {
        try {
          await _applyQueuedEvent(row);
          await supabase.from('event_queue').update({ flushed: true, flushed_at: new Date().toISOString() }).eq('id', row.id);
          flushed++;
        } catch (e) {
          logger.info(`[EVENT_LOG] Supabase flush failed for row ${row.id}: ${e.message}`);
          break; // DB still unreachable — stop and retry next cycle
        }
      }
      if (flushed > 0) logger.info(`[EVENT_LOG] ✅ Flushed ${flushed} events from Supabase queue`);
    }
  } catch (e) {
    logger.info('[EVENT_LOG] Supabase queue read failed — trying local file');
  }

  // 2. Flush local file fallback (handles events written during DB outage)
  const fileQueue = _fileQueueRead();
  const unflushed = fileQueue.filter(e => !e.flushed);
  if (unflushed.length === 0) {
    if (fileQueue.length > 0) _fileQueueWrite([]);
    return;
  }

  let fileFlushed = 0;
  for (const event of unflushed) {
    try {
      await _applyQueuedEvent(event);
      event.flushed = true;
      fileFlushed++;
    } catch (e) {
      logger.info(`[EVENT_LOG] File flush failed — DB still unreachable, ${unflushed.length - fileFlushed} remain`);
      _fileQueueWrite(fileQueue);
      return;
    }
  }
  _fileQueueWrite([]);
  logger.info(`[EVENT_LOG] ✅ Flushed ${fileFlushed} events from local file queue`);
}

// Flush agent: every 2 minutes, try to push queued events to Supabase
setInterval(flushEventQueue, 2 * 60 * 1000);
// Also flush on startup in case events were queued before a restart
setTimeout(flushEventQueue, 10000);

// ================== GOVERNANCE ORCHESTRATOR INIT ==================
// Now that queueEvent is defined, we can initialize governance with
// the local event queue for load shedding resilience.
governance = new GovernanceOrchestrator(supabase, {
  alertCallback: async (alert) => {
    logger.info(`[GOV ALERT] [${alert.severity}] [${alert.pillar}] ${alert.message}`);

    // Send CRITICAL and HIGH alerts to all alert phone numbers
    // ALERT_PHONE_NUMBER supports comma-separated numbers: 27821234567,27831234567
    const alertPhones = (process.env.ALERT_PHONE_NUMBER || '').split(',').map(p => p.trim()).filter(Boolean);
    if (alertPhones.length > 0 && (alert.severity === 'CRITICAL' || alert.severity === 'HIGH')) {
      const alertMsg = `🚨 *BIZUSIZO ALERT*\n\n*${alert.severity}* — ${alert.pillar}\n\n${alert.message}\n\n⏱️ ${new Date().toLocaleString('en-ZA', { timeZone: 'Africa/Johannesburg' })}`;
      for (const phone of alertPhones) {
        try {
          await sendWhatsAppMessage(phone, alertMsg);
        } catch (e) {
          logger.error(`[ALERT] Failed to send WhatsApp alert to ${phone}:`, e.message);
        }
      }
    }
  },
  queueEvent: queueEvent,
});

// Wire lib modules that need runtime dependencies
_setWAGovernance(governance);
facilitiesLib.init(supabase, msg, sendWhatsAppMessage);
const { getFacilities, findNearestFacilities, getDistance, getFacilityHoursStr, sendFacilitySuggest } = facilitiesLib;

// Register extracted route modules
require('./routes/reports')(app, { supabase, requireDashboardAuth, facilityFilter, logger });
require('./routes/clinical')(app, { supabase, requireDashboardAuth });
require('./routes/governance')(app, { supabase, requireDashboardAuth, facilityFilter, governance, outbreak });
require('./routes/fhir')(app, { supabase, requireDashboardAuth });

// Levenshtein distance for fuzzy text matching (typo correction)
// Used in chronic clinic name search to handle patient spelling errors
// levenshtein, hashPhone, parseDOB/validateDOB, capitalizeName,
// generateStudyCode, lookupStudyCode, getSession, saveSession,
// logTriage, scheduleFollowUp, getDueFollowUps, markFollowUpDone → lib/session.js

// ================================================================
// HARDCODED MESSAGES — ALL 11 OFFICIAL SA LANGUAGES
// ================================================================
// NOTE TO TEAM: These should be reviewed by native speakers.
// Flag any unnatural phrasing to hello@healthbridgesa.co.za
// Priority review: isiZulu, isiXhosa, Sesotho, Sepedi, Setswana
// ================================================================

const LANG_CODES = ['en', 'zu', 'xh', 'af', 'nso', 'tn', 'st', 'ts', 'ss', 've', 'nr'];

// MESSAGES and msg() extracted to lib/messages.js


// ================================================================
// IMPROVED AI TRANSLATION — for dynamic/non-hardcoded content
// ================================================================
async function translateWithClaude(text, targetLang) {
  const langNames = {
    en:'English', zu:'isiZulu', xh:'isiXhosa', af:'Afrikaans',
    nso:'Sepedi', tn:'Setswana', st:'Sesotho', ts:'Xitsonga',
    ss:'siSwati', ve:'Tshivenda', nr:'isiNdebele'
  };

  const res = await anthropic.messages.create({
    model: 'claude-haiku-4-5-20251001', // Haiku — translation is straightforward, speed priority
    max_tokens: 400,
    system: `You are a South African language translator specialising in healthcare communication.

RULES:
- Translate into ${langNames[targetLang]} as spoken in everyday South African communities
- Use the way people ACTUALLY talk, not textbook/formal language
- For isiZulu: use Gauteng urban isiZulu, not deep rural KZN
- For isiXhosa: use everyday isiXhosa, not academic isiXhosa
- Medical terms: use the commonly understood term, not the clinical one
  - e.g. "sugar disease" not "diabetes mellitus" in African languages
  - e.g. "high blood" not "hypertension"
- Keep it warm and conversational — this is WhatsApp, not a medical textbook
- If a word has no good translation, keep it in English (e.g. "clinic", "ambulance")
- Return ONLY the translation, nothing else`,
    messages: [{ role: 'user', content: text }]
  });

  return res.content[0].text.trim();
}

// ================== TRIAGE (AI) ==================
// ================== TRIAGE (AI) — SA SATS v2 ==================
// Rebuilt to align with SATS clinical logic:
//   Step 1 — Discriminators (override everything)
//   Step 2 — TEWS vital-sign proxies
//   Step 3 — Severity self-report (tiebreaker only)
//   Step 4 — Comorbidity upgrades (HIV, DM, epilepsy, pregnancy)
//   Step 5 — When in doubt, UPGRADE
// Paediatric and pregnancy contexts get specialised prompts.
// getPatientHistory, runTriage, applyClinicalRules, generateSelfCareAdvice → lib/triage.js

// getFacilities, findNearestFacilities, getDistance extracted to lib/facilities.js

// ================== ROUTING ==================
// ================================================================
// AUTO-QUEUE: Add patient to clinic queue after facility confirmation
// ================================================================
// Maps triage level to queue type:
//   RED/ORANGE → fast_track
//   YELLOW → routine
//   GREEN → routine
//   UNKNOWN → walk_in

// DoH-aligned patient streams:
// emergency    = RED triage (stabilise + transfer)
// acute        = ORANGE/YELLOW acute care (infections, injuries, asthma)
// chronic      = Medication/Chronic category (unstable — needs clinician)
// pharmacy     = Stable chronic patient — bypass consultation, go directly to pharmacy for script dispensing (DoH Fast Track)
// maternal     = Pregnancy category (priority even if stable)
// child        = Child illness category (priority, fast-track to reduce exposure)
// preventative = Screening walk-ins (HIV test, BP, diabetes — bypass consult if normal)
// general      = Everything else in routine queue
function triageToQueueType(triageLevel, category, session) {
  // RED always goes to emergency fast-track
  if (triageLevel === 'RED') return 'emergency';

  // Category-based streaming (DoH PHC clinic flow)
  if (category === '3') {
    // Maternal: supplements-only → pharmacy fast-track; all others → maternal consultation
    if (session && session.lastPathway === 'anc_supplements_only') {
      return 'pharmacy'; // Supplements collection — bypass consultation to pharmacy
    }
    return 'maternal'; // Routine ANC, new concerns, emergencies → maternal queue
  }
  if (category === '7') return 'child';           // Child illness
  if (category === '14') {
    // Women's health: check if supplements/contraception only vs consultation needed
    if (session && session.lastPathway === 'womens_health_meds_only') {
      return 'pharmacy'; // Contraception/supplements collection — bypass consultation
    }
    return 'maternal';
  }
  if (category === '15') return 'preventative';   // Health screening → fast-track preventative

  // Chronic: routing depends on CCMDD registration and stability
  // CCMDD registered + stable → pharmacy (fast-track collection, no nurse)
  // Not CCMDD + stable + clinic collection → chronic (nurse does vitals + script renewal)
  // Unstable → chronic (clinician review regardless of CCMDD status)
  if (category === '8') {
    if (session && session.lastPathway === 'chronic_bypass_ccmdd') {
      return 'pharmacy'; // CCMDD fast-track — no nurse needed
    }
    if (session && session.lastPathway === 'chronic_bypass_stable') {
      // Stable but not CCMDD-confirmed — needs nurse for vitals + script
      return session.isCcmddRegistered ? 'pharmacy' : 'chronic';
    }
    return 'chronic'; // Unstable or unknown — clinician review
  }

  // Urgency-based for remaining categories
  if (triageLevel === 'ORANGE') return 'acute';
  if (triageLevel === 'YELLOW') return 'general';
  if (triageLevel === 'GREEN') return 'general';

  return 'general';
}

async function autoAddToQueue(patientId, from, session) {
  const triageLevel = session.lastTriage?.triage_level || 'UNKNOWN';
  const category = session.selectedCategory || null;
  const queueType = triageToQueueType(triageLevel, category, session);
  const facility = session.confirmedFacility;
  const lang = session.language || 'en';

  try {
    // Check if already in queue today
    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);
    const { data: existing } = await supabase
      .from('clinic_queue')
      .select('id')
      .eq('patient_id', patientId)
      .gte('checked_in_at', todayStart.toISOString())
      .in('status', ['waiting', 'in_consultation'])
      .limit(1);

    if (existing && existing.length > 0) {
      // Already in queue — don't add again
      return;
    }

    // Get next position in this queue
    const { data: lastInQueue } = await supabase
      .from('clinic_queue')
      .select('position')
      .eq('queue_type', queueType)
      .eq('status', 'waiting')
      .order('position', { ascending: false })
      .limit(1);

    const position = (lastInQueue && lastInQueue.length > 0)
      ? lastInQueue[0].position + 1
      : 1;

    // Build patient name from session
    const patientName = (session.firstName && session.surname)
      ? `${session.firstName} ${session.surname}`
      : null;

    // Add to queue
    const lowConfFlag = session.lastTriage?.low_confidence_flag || false;
    await supabase.from('clinic_queue').insert({
      patient_id: patientId,
      patient_phone: from,
      patient_name: patientName,
      triage_level: triageLevel,
      triage_confidence: session.lastTriage?.confidence || null,
      low_confidence_flag: lowConfFlag,
      symptoms_summary: session.lastSymptoms ? session.lastSymptoms.slice(0, 200) : null,
      queue_type: queueType,
      status: 'waiting',
      checked_in_at: new Date(),
      position,
      study_code: session.studyCode || null,
      facility_name: facility ? facility.name : null,
      notes: lowConfFlag
        ? `⚠️ Low confidence — nurse review recommended${facility ? ' | Facility: ' + facility.name : ''}`
        : (facility ? `Facility: ${facility.name}` : null),
      created_at: new Date(),
    });

    // Calculate estimated wait time
    const patientsAhead = position - 1;
    let estMinutes = null;

    // Get average wait from today's completed patients in same queue type
    const { data: completed } = await supabase
      .from('clinic_queue')
      .select('checked_in_at, called_at')
      .eq('queue_type', queueType)
      .eq('status', 'completed')
      .gte('checked_in_at', todayStart.toISOString())
      .not('called_at', 'is', null);

    if (completed && completed.length >= 2) {
      const waits = completed.map(p => {
        return (new Date(p.called_at) - new Date(p.checked_in_at)) / 60000;
      }).filter(w => w > 0 && w < 480); // Exclude outliers

      if (waits.length > 0) {
        const avgWait = Math.round(waits.reduce((a, b) => a + b, 0) / waits.length);
        estMinutes = patientsAhead * avgWait;
      }
    }

    // Fallback estimates if no data yet
    if (estMinutes === null) {
      const fallbackMinutes = { fast_track: 10, routine: 30, walk_in: 45, pharmacy: 15 };
      estMinutes = patientsAhead * (fallbackMinutes[queueType] || 30);
    }

    // Send WhatsApp queue notification
    const queueNames = {
      emergency: { en: 'Emergency', zu: 'Esiphuthumayo', xh: 'Engxamisekileyo', af: 'Noodgeval', nso: 'Tšhoganetšo', tn: 'Tshoganyetso', st: 'Tshohanyetso', ts: 'Xihatla', ss: 'Lokusheshisako', ve: 'Tshoganetso', nr: 'Lokusheshisako' },
      acute: { en: 'Acute', zu: 'Okubukhali', xh: 'Ebukhali', af: 'Akuut', nso: 'E Bogale', tn: 'E Bogale', st: 'E Bohale', ts: 'Xo Hatlisa', ss: 'Lokubukhali', ve: 'Ya U Ṱavhanya', nr: 'Lokubukhali' },
      maternal: { en: 'Maternal / Child', zu: 'Abazithweleyo / Izingane', xh: 'Abakhulelweyo / Abantwana', af: 'Moeder / Kind', nso: 'Bomme / Bana', tn: 'Bomme / Bana', st: 'Bomme / Bana', ts: 'Vamanana / Vana', ss: 'Bomake / Bantfwana', ve: 'Vhomme / Vhana', nr: 'Abomma / Abantwana' },
      child: { en: 'Child', zu: 'Izingane', xh: 'Abantwana', af: 'Kind', nso: 'Bana', tn: 'Bana', st: 'Bana', ts: 'Vana', ss: 'Bantfwana', ve: 'Vhana', nr: 'Abantwana' },
      chronic: { en: 'Chronic Medication', zu: 'Umuthi Wamahlalakhona', xh: 'Amayeza Aqhelekileyo', af: 'Chroniese Medikasie', nso: 'Dihlare tša go Dulela', tn: 'Dimelemo tsa go Nnela ruri', st: 'Meriana ya Mahlale', ts: 'Mirhi ya Vurhongo', ss: 'Imitsi Yesikhashana', ve: 'Mushonga wa Vhulwadze', nr: 'Imitjhoga Yesikhathi Eside' },
      general: { en: 'General', zu: 'Okujwayelekile', xh: 'Jikelele', af: 'Algemeen', nso: 'Kakaretšo', tn: 'Kakaretso', st: 'Kakaretso', ts: 'Hinkwaswo', ss: 'Konkhe', ve: 'Zwothe', nr: 'Zoke' },
      fast_track: { en: 'Fast-Track (urgent)', zu: 'Esheshayo (kuphuthuma)', xh: 'Ekhawulezayo (kungxamisekile)', af: 'Spoedlyn (dringend)', nso: 'Ka Pela (tšhoganetšo)', tn: 'Ka Bonako (tshoganyetso)', st: 'Ka Potlako (tshohanyetso)', ts: 'Hi Ku Hatlisa (xihatla)', ss: 'Ngekushesha (lokusheshisako)', ve: 'Nga U Ṱavhanya (tshoganetso)', nr: 'Ngokurhabha (lokusheshisako)' },
      routine: { en: 'Routine', zu: 'Ejwayelekile', xh: 'Eqhelekileyo', af: 'Roetine', nso: 'Tlwaelo', tn: 'Tlwaelo', st: 'Tlwaelo', ts: 'Ntolovelo', ss: 'Lokuhlala kwentiwa', ve: 'Zwa Ḓuvha na Ḓuvha', nr: 'Lokuhlala kwenziwa' },
      walk_in: { en: 'Walk-In', zu: 'Ungena nje', xh: 'Ungena nje', af: 'Instap', nso: 'Go Tsena', tn: 'Go Tsena', st: 'Ho Kena', ts: 'Ku Nghena', ss: 'Lokungena', ve: 'U Dzhena', nr: 'Ukungena' },
      preventative: { en: 'Preventative', zu: 'Ukuvikela', xh: 'Ukukhusela', af: 'Voorkomend', nso: 'Thibelo', tn: 'Thibelo', st: 'Thibelo', ts: 'Ku Sivela', ss: 'Kuvikela', ve: 'U Thivhela', nr: 'Ukuvikela' },
      pharmacy: { en: 'Pharmacy (Meds Only)', zu: 'Ekhemisi (Umuthi Kuphela)', xh: 'Ekemisti (Amayeza Kuphela)', af: 'Apteek (Slegs Medikasie)', nso: 'Khemisi (Dihlare Fela)', tn: 'Khemisi (Dimelemo Fela)', st: 'Khemisi (Meriana Feela)', ts: 'Ekhemisi (Mirhi Ntsena)', ss: 'Ekhemisi (Imitsi Kuphela)', ve: 'Kha Khemisi (Mushonga Fhedzi)', nr: 'Ekhemisi (Imitjhoga Kwaphela)' },
    };

    const queueLabel = queueNames[queueType]?.[lang] || queueNames[queueType]?.['en'] || queueType;

    // Convert exact estimate to arrival window (30-min blocks) — don't promise exact times
    // because a RED walk-in, nurse lunch, or load-shedding can shift everything
    let arrivalWindow = '';
    if (estMinutes > 0) {
      const now = new Date();
      const sast = new Date(now.getTime() + (2 * 60 * 60 * 1000)); // UTC+2
      const arriveByMinutes = sast.getUTCHours() * 60 + sast.getUTCMinutes() + estMinutes;
      // Round down to nearest 30-min block for start, up for end
      const windowStartMin = Math.floor(arriveByMinutes / 30) * 30;
      const windowEndMin = windowStartMin + 30;
      const startH = String(Math.floor(windowStartMin / 60)).padStart(2, '0');
      const startM = String(windowStartMin % 60).padStart(2, '0');
      const endH = String(Math.floor(windowEndMin / 60)).padStart(2, '0');
      const endM = String(windowEndMin % 60).padStart(2, '0');
      // Only show window if it's within clinic hours (07:00-16:00)
      if (windowStartMin >= 420 && windowStartMin < 960) {
        arrivalWindow = `${startH}:${startM}–${endH}:${endM}`;
      }
    }

    const bzCode = session.studyCode || null;
    const arrivalLine = arrivalWindow
      ? { en: `\n⏱️ Suggested arrival: *${arrivalWindow}*`, zu: `\n⏱️ Isikhathi sokufika: *${arrivalWindow}*`, xh: `\n⏱️ Ixesha lokufika: *${arrivalWindow}*`, af: `\n⏱️ Voorgestelde aankoms: *${arrivalWindow}*` }
      : { en: '', zu: '', xh: '', af: '' };

    const waitMsg = {
      en: `📋 You have been added to the clinic queue.\n\n🏥 *${facility?.name || 'Clinic'}*\n📊 Queue: *${queueLabel}*\n👥 Position: *#${position}*${(arrivalLine.en)}${bzCode ? '\n🔢 Your code: *' + bzCode + '*' : ''}\n\nWhen you arrive, tell reception your name${bzCode ? ' and code *' + bzCode + '*' : ''}.\n\nType *arrived* when you get to the clinic.`,
      zu: `📋 Usufakwe emugqeni wasemtholampilo.\n\n🏥 *${facility?.name || 'Umtholampilo'}*\n📊 Umugqa: *${queueLabel}*\n👥 Isikhundla: *#${position}*${(arrivalLine.zu)}${bzCode ? '\n🔢 Ikhodi yakho: *' + bzCode + '*' : ''}\n\nUma ufika, tshela i-reception igama lakho${bzCode ? ' nekhodi *' + bzCode + '*' : ''}.\n\nBhala *arrived* uma ufika emtholampilo.`,
      xh: `📋 Ufakiwe kumgca wekliniki.\n\n🏥 *${facility?.name || 'Ikliniki'}*\n📊 Umgca: *${queueLabel}*\n👥 Indawo: *#${position}*${(arrivalLine.xh)}${bzCode ? '\n🔢 Ikhowudi yakho: *' + bzCode + '*' : ''}\n\nXa ufika, xelela i-reception igama lakho${bzCode ? ' nekhowudi *' + bzCode + '*' : ''}.\n\nBhala *arrived* xa ufika ekliniki.`,
      af: `📋 Jy is by die kliniek se tou gevoeg.\n\n🏥 *${facility?.name || 'Kliniek'}*\n📊 Tou: *${queueLabel}*\n👥 Posisie: *#${position}*${(arrivalLine.af)}${bzCode ? '\n🔢 Jou kode: *' + bzCode + '*' : ''}\n\nAs jy aankom, sê vir ontvangs jou naam${bzCode ? ' en kode *' + bzCode + '*' : ''}.\n\nTik *arrived* wanneer jy by die kliniek aankom.`,
      nso: `📋 O okeditšwe moleleng wa kliniki.\n\n🏥 *${facility?.name || 'Kliniki'}*\n📊 Molelo: *${queueLabel}*\n👥 Boemo: *#${position}*${arrivalWindow ? '\n⏱️ Nako ya go fihla: *' + arrivalWindow + '*' : ''}${bzCode ? '\n🔢 Khouthu ya gago: *' + bzCode + '*' : ''}\n\nGe o fihla, botša reception leina la gago${bzCode ? ' le khouthu *' + bzCode + '*' : ''}.\n\nNgwala *arrived* ge o fihla kliniki.`,
      tn: `📋 O okeditšwe molelwaneng wa kliniki.\n\n🏥 *${facility?.name || 'Kliniki'}*\n📊 Molelwane: *${queueLabel}*\n👥 Boemo: *#${position}*${arrivalWindow ? '\n⏱️ Nako ya go goroga: *' + arrivalWindow + '*' : ''}${bzCode ? '\n🔢 Khoutu ya gago: *' + bzCode + '*' : ''}\n\nFa o goroga, bolelela reception leina la gago${bzCode ? ' le khoutu *' + bzCode + '*' : ''}.\n\nKwala *arrived* fa o goroga kliniki.`,
      st: `📋 O kentswe moleleng wa kliniki.\n\n🏥 *${facility?.name || 'Kliniki'}*\n📊 Molelo: *${queueLabel}*\n👥 Boemo: *#${position}*${arrivalWindow ? '\n⏱️ Nako ya ho fihla: *' + arrivalWindow + '*' : ''}${bzCode ? '\n🔢 Khouthu ya hao: *' + bzCode + '*' : ''}\n\nHa o fihla, bolella reception lebitso la hao${bzCode ? ' le khouthu *' + bzCode + '*' : ''}.\n\nNgola *arrived* ha o fihla kliniki.`,
      ts: `📋 U engeteleriwe emulayinini wa kliniki.\n\n🏥 *${facility?.name || 'Kliniki'}*\n📊 Mulayini: *${queueLabel}*\n👥 Xiyimo: *#${position}*${arrivalWindow ? '\n⏱️ Nkarhi wa ku fika: *' + arrivalWindow + '*' : ''}${bzCode ? '\n🔢 Khodi ya wena: *' + bzCode + '*' : ''}\n\nLoko u fika, byela reception vito ra wena${bzCode ? ' na khodi *' + bzCode + '*' : ''}.\n\nTsala *arrived* loko u fika ekliniki.`,
      ss: `📋 Sewufakiwe emugceni wemtfolamphilo.\n\n🏥 *${facility?.name || 'Umtfolamphilo'}*\n📊 Umugca: *${queueLabel}*\n👥 Sikhundla: *#${position}*${arrivalWindow ? '\n⏱️ Sikhatsi sekufika: *' + arrivalWindow + '*' : ''}${bzCode ? '\n🔢 Ikhodi yakho: *' + bzCode + '*' : ''}\n\nNawufika, tjela reception libito lakho${bzCode ? ' nekhodi *' + bzCode + '*' : ''}.\n\nBhala *arrived* nawufika emtfolamphilo.`,
      ve: `📋 No engedzelwa mulayinini wa kiliniki.\n\n🏥 *${facility?.name || 'Kiliniki'}*\n📊 Mulayini: *${queueLabel}*\n👥 Vhuimo: *#${position}*${arrivalWindow ? '\n⏱️ Tshifhinga tsha u swika: *' + arrivalWindow + '*' : ''}${bzCode ? '\n🔢 Khodi yaṋu: *' + bzCode + '*' : ''}\n\nMusi ni tshi swika, vhudzani reception dzina laṋu${bzCode ? ' na khodi *' + bzCode + '*' : ''}.\n\nṄwalani *arrived* musi ni tshi swika kha kiliniki.`,
      nr: `📋 Usufakiwe emugceni wekliniki.\n\n🏥 *${facility?.name || 'Ikliniki'}*\n📊 Umugca: *${queueLabel}*\n👥 Isikhundla: *#${position}*${arrivalWindow ? '\n⏱️ Isikhathi sokufika: *' + arrivalWindow + '*' : ''}${bzCode ? '\n🔢 Ikhodi yakho: *' + bzCode + '*' : ''}\n\nNawufika, tjela reception ibizo lakho${bzCode ? ' nekhodi *' + bzCode + '*' : ''}.\n\nTlola *arrived* nawufika ekliniki.`,
    };

    await sendWhatsAppMessage(from, waitMsg[lang] || waitMsg['en']);

    logger.info(`[AUTO-QUEUE] Patient ${patientId} added to ${queueType} queue at position ${position} (est. ${estMinutes} min)`);

  } catch (e) {
    logger.error('[AUTO-QUEUE] Failed to add patient to queue:', e.message);
    // Don't fail the flow — queue is a nice-to-have, not critical
  }
}

// ================== EMS DISPATCH INTEGRATION ==================
// STATUS: Architecture ready. Activate via FEATURES.EMS_DISPATCH
// Two-way integration with provincial EMS dispatch systems:
//
// INBOUND: POST /api/ems/dispatch-notification
//   - Receives EMS dispatch notifications (patient en route to facility)
//   - Creates pre-arrival alert on clinic dashboard
//   - Triggered by EMS dispatch system when ambulance is assigned
//
// OUTBOUND: notifyEMSDispatch()
//   - Called when Bizusizo triages a RED patient who needs transport
//   - Sends patient location + triage data to EMS dispatch API
//   - Requires FEATURES.EMS_DISPATCH = true + EMS_DISPATCH_URL configured

// Inbound: EMS dispatch notification webhook
app.post('/api/ems/dispatch-notification', async (req, res) => {
  if (!FEATURES.EMS_DISPATCH) {
    return res.status(503).json({ error: 'EMS dispatch integration not enabled' });
  }

  // Validate API key
  const apiKey = req.headers['x-ems-api-key'];
  if (!apiKey || apiKey !== FEATURES.EMS_DISPATCH_KEY) {
    return res.status(401).json({ error: 'Invalid API key' });
  }

  try {
    const { incident_id, patient_name, triage_level, eta_minutes,
            ems_provider, crew_id, chief_complaint, destination_facility,
            patient_age, patient_sex } = req.body;

    // Create pre-arrival alert for the receiving facility
    const alertData = {
      patient_id: 'ems_dispatch_' + (incident_id || Date.now()),
      patient_name: patient_name || 'EMS Patient',
      triage_level: triage_level || 'ORANGE',
      priority: triage_level === 'RED' ? 'URGENT' : 'SOON',
      facility_name: destination_facility,
      symptoms: chief_complaint || 'EMS dispatch — details pending',
      estimated_arrival_at: eta_minutes
        ? new Date(Date.now() + eta_minutes * 60 * 1000).toISOString()
        : null,
      is_new_patient: true,
      resolved: false,
      source: 'ems_dispatch',
      ems_provider: ems_provider || null,
      ems_crew_id: crew_id || null,
    };

    await supabase.from('pre_arrival_alerts').insert(alertData);

    logger.info(`[EMS-DISPATCH] Inbound notification: ${ems_provider || 'EMS'} ${crew_id || ''} → ${destination_facility}, ETA ${eta_minutes || '?'} min, ${triage_level}`);
    res.json({ success: true, message: 'Pre-arrival alert created' });
  } catch (e) {
    logger.error('[EMS-DISPATCH] Inbound error:', e.message);
    res.status(500).json({ error: 'Server error' });
  }
});

// Outbound: Notify EMS dispatch when a RED patient needs transport
async function notifyEMSDispatch(patientId, session, triageLevel) {
  if (!FEATURES.EMS_DISPATCH || !FEATURES.EMS_DISPATCH_URL) return null;
  if (triageLevel !== 'RED') return null;

  try {
    const payload = {
      source: 'bizusizo',
      patient_id: patientId,
      triage_level: triageLevel,
      symptoms: (session.lastSymptoms || '').slice(0, 300),
      patient_age: session.dob?.age || session.patientAge || null,
      patient_sex: session.sex || null,
      location: session.location || null,
      facility_name: session.confirmedFacility?.name || session.suggestedFacility?.name || null,
      timestamp: new Date().toISOString(),
    };

    const response = await fetch(FEATURES.EMS_DISPATCH_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-API-Key': FEATURES.EMS_DISPATCH_KEY || '',
      },
      body: JSON.stringify(payload),
      timeout: 10000,
    });

    if (response.ok) {
      const data = await response.json();
      logger.info(`[EMS-DISPATCH] Outbound notification sent for patient ${patientId}: ${data.incident_id || 'OK'}`);
      return data;
    } else {
      logger.error(`[EMS-DISPATCH] Outbound failed: ${response.status}`);
      return null;
    }
  } catch (e) {
    logger.error('[EMS-DISPATCH] Outbound error:', e.message);
    return null; // Non-critical — don't block triage flow
  }
}

// ================== CLINIC HOURS HELPER ==================
// Most SA PHC clinics operate 07:00–16:00 weekdays
// Some extend to 16:30 or 17:00, but 07–16 is the safe window
function isClinicOpen() {
  const now = new Date();
  // Convert to SAST (UTC+2)
  const sast = new Date(now.getTime() + (2 * 60 * 60 * 1000));
  const hour = sast.getUTCHours();
  const day = sast.getUTCDay(); // 0=Sun, 6=Sat
  // Weekdays 07:00–16:00
  if (day >= 1 && day <= 5 && hour >= 7 && hour < 16) {
    return true;
  }
  return false;
}

// Returns the next clinic working day (Mon–Fri) with a readable label and
// the UTC timestamp for 06:30 SAST that morning (used for reminder scheduling).
// Handles Friday-evening, Saturday and Sunday correctly — never schedules for a weekend.
function getNextClinicDay() {
  const now = new Date();
  const sast = new Date(now.getTime() + (2 * 60 * 60 * 1000));
  const day = sast.getUTCDay(); // 0=Sun,1=Mon,...,5=Fri,6=Sat
  const daysAhead = day === 5 ? 3 : day === 6 ? 2 : day === 0 ? 1 : 1; // Fri→Mon, Sat→Mon, Sun→Mon, else tomorrow
  const nextOpen = new Date(sast);
  nextOpen.setUTCDate(nextOpen.getUTCDate() + daysAhead);
  const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const label = `${DAYS[nextOpen.getUTCDay()]} ${nextOpen.getUTCDate()} ${MONTHS[nextOpen.getUTCMonth()]}`;
  const scheduledAt = new Date(nextOpen);
  scheduledAt.setUTCHours(4, 30, 0, 0); // 04:30 UTC = 06:30 SAST
  return { scheduledAt, label, daysAhead };
}

function getTriagePathway(triageLevel) {
  switch (triageLevel) {
    case 'RED': return { pathway: 'ambulance', facilityType: 'hospital' };
    case 'ORANGE':
      // Time-aware: during clinic hours → clinic fast-track; after hours → hospital
      if (isClinicOpen()) {
        return { pathway: 'clinic_fast_track', facilityType: 'clinic' };
      }
      return { pathway: 'emergency_unit', facilityType: 'hospital' };
    case 'YELLOW': return { pathway: 'clinic_visit', facilityType: 'clinic' };
    default: return { pathway: 'self_care', facilityType: null };
  }
}

// ================================================================
// CCMDD MODULE — Chronic Medication Distribution & Dispensing
// STATUS: Architecture ready. Activate via FEATURES.CCMDD_ROUTING
// ================================================================
// INFORMED BY: Moeng M. (2025) "Patterns and Factors Associated with
// Deactivation of Adult Patients on CCMDD in North-West Province"
// Wits MPH — Key findings integrated:
//   - 96.6% deactivation rate in NMM District (16,266 patients)
//   - Top modifiable cause: patient defaulting (198/1070 documented)
//   - 67.8% HIV, 43.8% hypertension, 17% angina — multimorbidity common
//   - Rural geography compounds collection barriers
// ================================================================
// When active, this module:
// 1. Detects chronic medication patients (category 8: Medication/Chronic)
// 2. Identifies specific chronic conditions for tailored messaging
// 3. Checks if patient is stable (not acute symptoms on top of chronic)
// 4. Routes to nearest CCMDD pickup point instead of clinic
// 5. Runs escalating reminder chain (24h, 48h, 72h) to prevent defaulting
// 6. Captures reason for missed collection to build evidence base
// 7. Flags at-risk patients (multimorbid, elderly) for priority follow-up
// 8. Re-engages defaulted patients proactively
// ================================================================

// Supabase tables needed:
// ccmdd_pickup_points: id, name, type, latitude, longitude, operating_hours, address, province
// ccmdd_collections: id, patient_id, pickup_point_id, medication_type, scheduled_date,
//                    collected_at, status (scheduled/reminded/collected/missed/defaulted),
//                    missed_reason, reminder_count
// ccmdd_patient_profiles: patient_id, conditions (jsonb), risk_level, last_collection_date,
//                         consecutive_misses, total_collections, total_misses

const CCMDD_MESSAGES = {
  chronic_check: {
    en: `Are you here for a chronic medication refill?\n1 — Yes, I need my regular medication\n2 — No, I have new or worsening symptoms`,
    zu: `Ingabe ulapha ukuthola umuthi wakho wamahlalakhona?\n1 — Yebo, ngidinga umuthi wami wejwayelekile\n2 — Cha, nginezimpawu ezintsha noma ezimbi kakhulu`,
    xh: `Ingaba ulapha ukuza kuthatha amayeza akho aqhelekileyo?\n1 — Ewe, ndifuna amayeza am aqhelekileyo\n2 — Hayi, ndineempawu ezintsha okanye ezimbi ngakumbi`,
    af: `Is jy hier vir 'n chroniese medikasie hervulling?\n1 — Ja, ek het my gereelde medikasie nodig\n2 — Nee, ek het nuwe of erger simptome`,
    nso: `Na o mo bakeng sa go tlatša dihlare tša go dulela?\n1 — Ee, ke nyaka dihlare tša ka tša ka mehla\n2 — Aowa, ke na le dika tše mpsha goba tše mpe`,
    tn: `A o fano bakeng sa go tlatsa dimelemo tsa go nnela ruri?\n1 — Ee, ke tlhoka dimelemo tsa me tsa ka metlha\n2 — Nnyaa, ke na le matshwao a masha kgotsa a maswe`,
    st: `Na o mona bakeng sa ho tlatsa meriana ya mahlale?\n1 — E, ke hloka meriana ya ka ya ka mehla\n2 — Tjhe, ke na le matshwao a matjha kapa a mabe`,
    ts: `Xana u laha ku ta teka mirhi ya vurhongo?\n1 — Ina, ndzi lava mirhi ya mina ya ntolovelo\n2 — Ee-ee, ndzi na swikombiso swa ntshwa kumbe swo biha`,
    ss: `Ulapha kutawutfola imitsi yakho yesikhashana?\n1 — Yebo, ngidzinga imitsi yami yejwayelekile\n2 — Cha, nginetimphawu letinsha noma letimbi`,
    ve: `Naa ni fhano u ḓa u dzhia mushonga wa vhulwadze?\n1 — Ee, ndi ṱoḓa mushonga wanga wa ḓuvha na ḓuvha\n2 — Hai, ndi na zwiga zwiswa kana zwi vhifhaho`,
    nr: `Ulapha ukuzokuthatha imitjhoga yakho yesikhathi eside?\n1 — Iye, ngidzinga imitjhoga yami yejayelekileko\n2 — Awa, ngineemphawu ezintsha noma ezimbi`,
  },

  // Condition identification — ask what they're collecting for
  condition_check: {
    en: `What medication do you collect? (Select all that apply)
1 — ARVs (HIV)
2 — Blood pressure / Hypertension
3 — Diabetes (sugar)
4 — Heart / Angina
5 — Asthma / Lung
6 — Epilepsy
7 — Other chronic medication`,
    zu: `Umuthi wani owuthathayo? (Khetha konke okufanele)
1 — Ama-ARV (HIV)
2 — Umuthi wegazi eliphakeme
3 — Ushukela (Diabetes)
4 — Inhliziyo / I-Angina
5 — Isifuba / Iphaphu
6 — Isifo sokuwa (Epilepsy)
7 — Omunye umuthi wamahlalakhona`,
    xh: `Yiyiphi imiyalelo oyithatayo? (Khetha konke okufanelekileyo)
1 — Ii-ARV (HIV)
2 — Uxinzelelo lwegazi
3 — Iswekile (Diabetes)
4 — Intliziyo / I-Angina
5 — Isifuba / Imiphunga
6 — Isifo sokuwa (Epilepsy)
7 — Esinye isigulo esinganyangekiyo`,
    af: `Watter medikasie haal jy af? (Kies alles wat van toepassing is)\n1 — ARV's (MIV)\n2 — Bloeddruk / Hipertensie\n3 — Diabetes (suiker)\n4 — Hart / Angina\n5 — Asma / Long\n6 — Epilepsie\n7 — Ander chroniese medikasie`,
    nso: `O tšea dihlare dife? (Kgetha tšohle tšeo di amanago)\n1 — Di-ARV (HIV)\n2 — Madi a godimo\n3 — Swikiri (Diabetes)\n4 — Pelo / Angina\n5 — Sefuba / Mafahla\n6 — Isifo sa go wa (Epilepsy)\n7 — Dihlare tše dingwe tša go dulela`,
    tn: `O tsaya dimelemo dife? (Kgetha tsotlhe tse di amanang)\n1 — Di-ARV (HIV)\n2 — Madi a kwa godimo\n3 — Sukiri (Diabetes)\n4 — Pelo / Angina\n5 — Sehuba / Mafahla\n6 — Bolwetse jwa go wa (Epilepsy)\n7 — Dimelemo tse dingwe tsa go nnela ruri`,
    st: `O nka meriana efe? (Khetha tsohle tse amanang)\n1 — Di-ARV (HIV)\n2 — Madi a phahameng\n3 — Tsoekere (Diabetes)\n4 — Pelo / Angina\n5 — Sefuba / Mafahla\n6 — Bolwetse ba ho wa (Epilepsy)\n7 — Meriana e meng ya mahlale`,
    ts: `U teka mirhi yihi? (Hlawula hinkwayo leyi yi amanaka)\n1 — Ti-ARV (HIV)\n2 — Ngati ya le henhla\n3 — Swikiri (Diabetes)\n4 — Mbilu / Angina\n5 — Xifuva / Mafahla\n6 — Vuvabyi bya ku wa (Epilepsy)\n7 — Mirhi yin'wana ya vurhongo`,
    ss: `Uphuza imitsi yini? (Khetsa konkhe lokufanele)\n1 — Ema-ARV (HIV)\n2 — Ingati lephakeme\n3 — Shukela (Diabetes)\n4 — Inhlitiyo / Angina\n5 — Sifuba / Emaphaphu\n6 — Sifo sekuwa (Epilepsy)\n7 — Imitsi lenye yesikhashana`,
    ve: `Ni dzhia mushonga ufhio? (Khethani zwoṱhe zwi elanaho)\n1 — Dzi-ARV (HIV)\n2 — Malofha a nṱha\n3 — Swigiri (Diabetes)\n4 — Mbilu / Angina\n5 — Tshifuva / Mafahla\n6 — Vhulwadze ha u wa (Epilepsy)\n7 — Mushonga muṅwe wa vhulwadze`,
    nr: `Uthatha imitjhoga yini? (Khetha konkhe okufanele)\n1 — Ama-ARV (HIV)\n2 — Igazi eliphakeme\n3 — Iswigiri (Diabetes)\n4 — Inhliziyo / Angina\n5 — Isifuba / Amaphaphu\n6 — Isifo sokuwa (Epilepsy)\n7 — Imitjhoga eminye yesikhathi eside`,
  },

  ccmdd_route: {
    en: (name, dist) => `💊 Your nearest medication pickup point is:\n*${name}* (${dist} km)\n\nYou can collect your chronic medication there without queuing at a clinic.\n\nCan you get there?\n1 — Yes\n2 — No, show alternatives`,
    zu: (name, dist) => `💊 Indawo yakho eseduze yokuthola umuthi:\n*${name}* (${dist} km)\n\nUngathola umuthi wakho wamahlalakhona lapho ngaphandle kokulinda emtholampilo.\n\nUngafika?\n1 — Yebo\n2 — Cha, ngikhombise ezinye`,
    xh: (name, dist) => `💊 Indawo yakho ekufutshane yokuthatha amayeza:\n*${name}* (${dist} km)\n\nUngathatha amayeza akho aqhelekileyo apho ngaphandle kokulinda ekliniki.\n\nUngafikelela?\n1 — Ewe\n2 — Hayi, ndibonise ezinye`,
    af: (name, dist) => `💊 Jou naaste medikasie-afhaal punt is:\n*${name}* (${dist} km)\n\nJy kan jou chroniese medikasie daar afhaal sonder om by 'n kliniek tou te staan.\n\nKan jy daar uitkom?\n1 — Ja\n2 — Nee, wys my ander`,
    nso: (name, dist) => `💊 Lefelo la gago la kgauswi la go tšea dihlare ke:\n*${name}* (${dist} km)\n\nO ka tšea dihlare tša gago tša go dulela gona ntle le go ema moleleng kliniki.\n\nO ka fihla?\n1 — Ee\n2 — Aowa, mpontšhe tše dingwe`,
    tn: (name, dist) => `💊 Lefelo la gago la gaufi la go tsaya dimelemo ke:\n*${name}* (${dist} km)\n\nO ka tsaya dimelemo tsa gago tsa go nnela ruri gone go sa eme molelwaneng kwa kliniki.\n\nA o ka fitlha?\n1 — Ee\n2 — Nnyaa, mpontsha tse dingwe`,
    st: (name, dist) => `💊 Sebaka sa hao sa haufi sa ho nka meriana ke:\n*${name}* (${dist} km)\n\nO ka nka meriana ya hao ya mahlale mona ntle le ho ema moleleng kliniki.\n\nO ka fihla?\n1 — E\n2 — Tjhe, mpontsha tse ding`,
    ts: (name, dist) => `💊 Ndhawu ya wena ya kusuhi ya ku teka mirhi i:\n*${name}* (${dist} km)\n\nU nga teka mirhi ya wena ya vurhongo kona ku si yimi emulayinini ekliniki.\n\nU nga fika?\n1 — Ina\n2 — Ee-ee, ndzi kombela tin'wana`,
    ss: (name, dist) => `💊 Indzawo yakho yaseduze yekutfola imitsi itsi:\n*${name}* (${dist} km)\n\nUngatfola imitsi yakho yesikhashana khona ngaphandle kokulindza emtfolamphilo.\n\nUngafika?\n1 — Yebo\n2 — Cha, ngikhombise letinye`,
    ve: (name, dist) => `💊 Fhethu haṋu ha tsini ha u dzhia mushonga ndi:\n*${name}* (${dist} km)\n\nNi nga dzhia mushonga waṋu wa vhulwadze henefho hu si na u lindela mulayinini kha kiliniki.\n\nNi nga swika?\n1 — Ee\n2 — Hai, nsumbedzeni zwiṅwe`,
    nr: (name, dist) => `💊 Indawo yakho eseduze yokuthatha imitjhoga ithi:\n*${name}* (${dist} km)\n\nUngatfola imitjhoga yakho yesikhathi eside khona ngaphandle kokulinda emgceni ekliniki.\n\nUngafika?\n1 — Iye\n2 — Awa, ngikhombise ezinye`,
  },

  ccmdd_confirmed: {
    en: (name) => `✅ Go to *${name}* to collect your medication.\n\nRemember to bring your ID and prescription/clinic card.\n\nWe will remind you when your next collection is due.`,
    zu: (name) => `✅ Yana ku-*${name}* ukuthola umuthi wakho.\n\nKhumbula ukuletha i-ID yakho nekhadi lakho lasemtholampilo.\n\nSizokukhumbuza uma isikhathi sokuthatha umuthi olandelayo sesifikile.`,
    xh: (name) => `✅ Yiya ku-*${name}* ukuthatha amayeza akho.\n\nKhumbula ukuzisa i-ID yakho nekhadi lakho lasekliniki.\n\nSiza kukukhumbuza xa ixesha lokuthatha okulandelayo lifikile.`,
    af: (name) => `✅ Gaan na *${name}* om jou medikasie af te haal.\n\nOnthou om jou ID en voorskrif/kliniekkaart saam te bring.\n\nOns sal jou herinner wanneer jou volgende afhaal nodig is.`,
    nso: (name) => `✅ Eya go *${name}* go tšea dihlare tša gago.\n\nGopola go tliša ID ya gago le karata ya kliniki.\n\nRe tla go gopotša ge nako ya go tšea ye e latelago e fihlile.`,
    tn: (name) => `✅ Ya kwa go *${name}* go tsaya dimelemo tsa gago.\n\nGopola go tlisa ID ya gago le karata ya kliniki.\n\nRe tla go gopotsa fa nako ya go tsaya e e latelang e fitlhile.`,
    st: (name) => `✅ Eya ho *${name}* ho nka meriana ya hao.\n\nHopola ho tlisa ID ya hao le karata ya kliniki.\n\nRe tla o hopotsa ha nako ya ho nka e latelang e fihlile.`,
    ts: (name) => `✅ Yana eka *${name}* ku teka mirhi ya wena.\n\nTsundza ku tisa ID ya wena na karata ya kliniki.\n\nHi ta ku tsundzuxa loko nkarhi wa ku teka wo landza wu fika.`,
    ss: (name) => `✅ Hamba uye ku-*${name}* kutawutfola imitsi yakho.\n\nKhumbula kuletsa i-ID yakho nelikhadi lemtfolamphilo.\n\nSitakukhumbuza uma sikhatsi sekutfola lesilandzelako sesifikile.`,
    ve: (name) => `✅ Iyani kha *${name}* u dzhia mushonga waṋu.\n\nHumbulani u ḓisa ID yaṋu na khadzi ya kiliniki.\n\nRi ḓo ni humbudza musi tshifhinga tsha u dzhia tshi tevhelaho tshi tshi swika.`,
    nr: (name) => `✅ Khamba uye ku-*${name}* ukuthatha imitjhoga yakho.\n\nKhumbula ukuletha i-ID yakho nelikhadi lekliniki.\n\nSizakukukhumbuza nawusikhathi sekuthatha esilandelako sesifikile.`,
  },

  ccmdd_not_available: {
    en: '💊 CCMDD pickup is not yet available in your area. Please visit your nearest clinic for your medication refill.',
    zu: '💊 Indawo yokuthola umuthi ayikakafinyeleleki endaweni yakho okwamanje. Sicela uvakashele umtholampilo oseduze.',
    xh: '💊 Indawo yokuthatha amayeza ayikafumaneki kwindawo yakho okwangoku. Nceda utyelele ikliniki ekufutshane.',
    af: '💊 CCMDD-afhaal is nog nie in jou area beskikbaar nie. Besoek asseblief jou naaste kliniek.',
    nso: '💊 Go tšea dihlare ga go eso be gona lefelong la gago. Hle etela kliniki ya kgauswi go tlatša dihlare.',
    tn: '💊 Go tsaya dimelemo ga go eso nne gone mo lefelong la gago. Etela kliniki e e gaufi go tlatsa dimelemo.',
    st: '💊 Ho nka meriana ha ho eso be teng sebakeng sa hao. Etela kliniki e haufi ho tlatsa meriana.',
    ts: '💊 Ku teka mirhi a ku si va kona endhawini ya wena. Hi kombela u endzela kliniki ya kusuhi ku teka mirhi.',
    ss: '💊 Kutfola imitsi akukabi khona endzaweni yakho. Sicela uvakashele emtfolamphilo loseduze kutawutfola imitsi.',
    ve: '💊 U dzhia mushonga a zwi athu vha hone fhethu haṋu. Ri humbela ni dalele kiliniki i re tsini u dzhia mushonga.',
    nr: '💊 Ukuthatha imitjhoga akukabi khona endaweni yakho. Sibawa uvakatjhele ikliniki eseduze ukuthatha imitjhoga.',
  },

  // ============ ESCALATING REMINDER CHAIN ============
  // Based on NMM data: defaulting is the #1 modifiable deactivation cause
  reminder_24h: {
    en: (name) => `💊 Reminder: Your medication is ready for collection at *${name}*.\n\nPlease collect today if possible. Your health depends on taking your medication consistently.`,
    zu: (name) => `💊 Isikhumbuzo: Umuthi wakho ulungele ukuthathwa ku-*${name}*.\n\nSicela uwuthathe namuhla uma kungenzeka. Impilo yakho incike ekuthatheni umuthi ngokuqhubekayo.`,
    xh: (name) => `💊 Isikhumbuzo: Amayeza akho alungile ukuthathwa ku-*${name}*.\n\nNceda uwathathe namhlanje ukuba kunokwenzeka. Impilo yakho ixhomekeke ekuthatheni amayeza rhoqo.`,
    af: (name) => `💊 Herinnering: Jou medikasie is gereed vir afhaal by *${name}*.\n\nHaal dit asseblief vandag af indien moontlik. Jou gesondheid hang af van konsekwente medikasie-gebruik.`,
    nso: (name) => `💊 Kgopotšo: Dihlare tša gago di loketše go tšewa go *${name}*.\n\nHle di tšee lehono ge go kgonega. Maphelo a gago a ithekgile go nwa dihlare ka go ya go ile.`,
    tn: (name) => `💊 Kgopotso: Dimelemo tsa gago di lokile go tsewa kwa *${name}*.\n\nDi tseye gompieno fa go kgonagala. Boitekanelo jwa gago bo ikaegile ka go nwa dimelemo ka metlha.`,
    st: (name) => `💊 Kgopotso: Meriana ya hao e lokile ho nkuwa ho *${name}*.\n\nE nke kajeno haeba ho kgonahala. Bophelo ba hao bo ithekgile ho nwa meriana ka ho ya ho ile.`,
    ts: (name) => `💊 Xitsundzuxo: Mirhi ya wena yi lunghile ku tekiwa eka *${name}*.\n\nHi kombela u yi teke namuntlha loko swi koteka. Rihanyo ra wena ri titshege hi ku teka mirhi hi ku ya emahlweni.`,
    ss: (name) => `💊 Sikhumbuto: Imitsi yakho ilungele kutfotjwa ku-*${name}*.\n\nSicela uyitfole lamuhla nawukwenta. Imphilo yakho incike ekutfoleni imitsi njalo.`,
    ve: (name) => `💊 Tshikombiso: Mushonga waṋu wo lugiwa u dzhiiwa kha *${name}*.\n\nRi humbela ni u dzhie ṋamusi arali zwi tshi konadzea. Mutakalo waṋu u ḓitika nga u nwa mushonga nga u tevhekana.`,
    nr: (name) => `💊 Isikhumbuto: Imitjhoga yakho ilungele ukuthatjwa ku-*${name}*.\n\nSibawa uyithathe namhlanje nawukwenza. Ipilo yakho incike ekutholeni imitjhoga njalo.`,
  },

  reminder_48h: {
    en: (name) => `⚠️ Your medication at *${name}* has not been collected yet.\n\nMissing your medication can cause your condition to worsen. Please collect as soon as possible.\n\nHaving trouble getting there?\n1 — I will collect today\n2 — I cannot get to this location\n3 — I have a problem (tell us)`,
    zu: (name) => `⚠️ Umuthi wakho ku-*${name}* awukathathwa.\n\nUkungathathi umuthi kungabangela isimo sakho sibe sibi. Sicela uwuthathe ngokushesha.\n\nUnenkinga yokufika?\n1 — Ngizowuthatha namuhla\n2 — Angikwazi ukufika kule ndawo\n3 — Nginenkinga (sitshele)`,
    xh: (name) => `⚠️ Amayeza akho ku-*${name}* awakathathwa.\n\nUkungawathathi amayeza kunokubangela imeko yakho ibe mbi. Nceda uwathathe ngokukhawuleza.\n\nUnengxaki yokufika?\n1 — Ndiza kuwathatha namhlanje\n2 — Andikwazi ukufikelela kule ndawo\n3 — Ndinengxaki (sixelele)`,
    af: (name) => `⚠️ Jou medikasie by *${name}* is nog nie afgehaal nie.\n\nAs jy jou medikasie mis kan dit jou toestand vererger. Haal dit asseblief so gou moontlik af.\n\nSukkel jy om daar te kom?\n1 — Ek sal vandag afhaal\n2 — Ek kan nie by hierdie plek uitkom nie\n3 — Ek het 'n probleem (vertel ons)`,
    nso: (name) => `⚠️ Dihlare tša gago go *${name}* ga di eso tšewe.\n\nGo palelwa ke go tšea dihlare go ka dira maemo a gago a be a mabe. Hle di tšee ka pela.\n\nO na le bothata bja go fihla?\n1 — Ke tla di tšea lehono\n2 — Nka se kgone go fihla lefelong le\n3 — Ke na le bothata (re botše)`,
    tn: (name) => `⚠️ Dimelemo tsa gago kwa *${name}* ga di eso tsewa.\n\nGo palelwa ke go tsaya dimelemo go ka dira maemo a gago a nne maswe. Di tseye ka bonako.\n\nA o na le bothata jwa go fitlha?\n1 — Ke tla di tsaya gompieno\n2 — Ga ke kgone go fitlha lefelong le\n3 — Ke na le bothata (re bolelele)`,
    st: (name) => `⚠️ Meriana ya hao ho *${name}* ha e eso nkuwe.\n\nHo palelwa ke ho nka meriana ho ka etsa maemo a hao a be a mabe. E nke ka potlako.\n\nO na le bothata ba ho fihla?\n1 — Ke tla e nka kajeno\n2 — Nka se kgone ho fihla sebakeng seo\n3 — Ke na le bothata (re bolelle)`,
    ts: (name) => `⚠️ Mirhi ya wena eka *${name}* a yi si tekiwa.\n\nKu palelwa hi ku teka mirhi swi nga endla xiyimo xa wena xi biha. Hi kombela u yi teke hi ku hatlisa.\n\nU na xiphiqo xo fika?\n1 — Ndzi ta yi teka namuntlha\n2 — A ndzi koti ku fika ndhawini leyi\n3 — Ndzi na xiphiqo (hi byele)`,
    ss: (name) => `⚠️ Imitsi yakho ku-*${name}* ayikatsatfwa.\n\nKungayitfoli imitsi kungenta simo sakho sibe sibi. Sicela uyitfole ngekushesha.\n\nUnenkinga yekufika?\n1 — Ngitayitfola lamuhla\n2 — Angikwati kufika endzaweni le\n3 — Nginenkinga (sitjele)`,
    ve: (name) => `⚠️ Mushonga waṋu kha *${name}* a u athu dzhiiwa.\n\nU kundelwa u dzhia mushonga zwi nga ita vhuimo haṋu vhu vhifhe. Ri humbela ni u dzhie nga u ṱavhanya.\n\nNi na thaidzo ya u swika?\n1 — Ndi ḓo u dzhia ṋamusi\n2 — A thi koni u swika fhethu afho\n3 — Ndi na thaidzo (ri vhudzeni)`,
    nr: (name) => `⚠️ Imitjhoga yakho ku-*${name}* ayikathathwa.\n\nUkungayithathi imitjhoga kungenta isimo sakho sibe sibi. Sibawa uyithathe ngokurhabha.\n\nUnenkinga yokufika?\n1 — Ngizayithatha namhlanje\n2 — Angikwazi ukufika endaweni le\n3 — Nginenkinga (sitjele)`,
  },

  reminder_72h_escalation: {
    en: `🔴 You have not collected your medication for 3 days.\n\nMissing medication puts your health at serious risk. A healthcare worker has been notified.\n\nPlease tell us what is preventing you from collecting:\n1 — Transport / distance problem\n2 — Cannot take time off work\n3 — Pickup point was closed when I went\n4 — Medication was not available\n5 — Side effects — I stopped taking medication\n6 — Other reason`,
    zu: `🔴 Awukathathi umuthi wakho izinsuku ezi-3.\n\nUkungathathi umuthi kubeka impilo yakho engozini enkulu. Isisebenzi sezempilo sazisiwe.\n\nSicela usitshele okukuvimbelayo:\n1 — Inkinga yezokuhamba / ibanga\n2 — Angikwazi ukuthola isikhathi emsebenzini\n3 — Indawo yokuthatha ivaliwe ngesikhathi ngifika\n4 — Umuthi ubungekho\n5 — Imiphumela emibi — ngiyekile ukuthatha umuthi\n6 — Esinye isizathu`,
    xh: `🔴 Awukawathathi amayeza akho iintsuku ezi-3.\n\nUkungawathathi amayeza kubeka impilo yakho emngciphekweni omkhulu. Umsebenzi wezempilo wazisiwe.\n\nNceda usixelele okukuthintelayo:\n1 — Ingxaki yothutho / umgama\n2 — Andikwazi ukufumana ixesha emsebenzini\n3 — Indawo yokuthatha ibivaliwe xa ndifika\n4 — Amayeza ebengatholakalanga\n5 — Imiphumo emibi — ndiyekile ukuthatha amayeza\n6 — Esinye isizathu`,
    af: `🔴 Jy het nie jou medikasie vir 3 dae afgehaal nie.\n\nOntbrekende medikasie plaas jou gesondheid in ernstige gevaar. 'n Gesondheidswerker is in kennis gestel.\n\nVertel ons asseblief wat jou verhinder:\n1 — Vervoer / afstand probleem\n2 — Kan nie tyd van werk af kry nie\n3 — Afhaal punt was toe toe ek gekom het\n4 — Medikasie was nie beskikbaar nie\n5 — Newe-effekte — ek het opgehou medikasie gebruik\n6 — Ander rede`,
  },

  // Response to missed-collection reasons
  missed_transport: {
    en: 'We understand. Let us find a closer pickup point for your next collection. Please share your location.',
    zu: 'Siyaqonda. Ake sithole indawo eseduze kakhulu yokuthatha umuthi wakho olandelayo. Sicela uthumele indawo yakho.',
    xh: 'Siyaqonda. Masifumane indawo ekufutshane ngakumbi yokuthatha amayeza akho alandelayo. Nceda uthumele indawo yakho.',
    af: 'Ons verstaan. Laat ons \'n nader afhaal punt vind vir jou volgende afhaal. Deel asseblief jou ligging.',
  },

  missed_work: {
    en: 'We understand. We are working on extended collection hours and weekend options. For now, you can ask someone you trust to collect on your behalf with your ID and clinic card.',
    zu: 'Siyaqonda. Sisebenza ngamahora engeziwe okuthatha nangezimpelasonto. Okwamanje, ungacela umuntu omethembayo ukuthi akuthathele ngokusebenzisa i-ID yakho nekhadi lakho.',
    xh: 'Siyaqonda. Sisebenza ngeeyure ezongezelelweyo zokuthatha nangempelaveki. Okwangoku, ungacela umntu omthembayo ukuba akuthathele nge-ID yakho nekhadi lakho.',
    af: 'Ons verstaan. Ons werk aan verlengde afhaal-ure en naweek-opsies. Vir nou kan jy iemand vertrou om namens jou af te haal met jou ID en kliniekkaart.',
  },

  missed_closed: {
    en: 'Thank you for telling us. We have logged this issue and will follow up with the pickup point. Please try again tomorrow, or we can suggest an alternative location.',
    zu: 'Siyabonga ngokusitshela. Siqophe le nkinga futhi sizokulandela nendawo yokuthatha. Sicela uzame futhi kusasa, noma singaphakamisa enye indawo.',
    xh: 'Enkosi ngokusixelela. Sibhale le ngxaki kwaye siza kulandela nendawo yokuthatha. Nceda uzame kwakhona ngomso, okanye sinokuphakamisa enye indawo.',
    af: 'Dankie dat jy ons laat weet. Ons het hierdie probleem aangeteken en sal opvolg. Probeer asseblief weer môre, of ons kan \'n alternatiewe plek voorstel.',
  },

  missed_no_stock: {
    en: 'Thank you for telling us. We have reported this stock issue. We will notify you as soon as your medication is available. We are sorry for the inconvenience.',
    zu: 'Siyabonga ngokusitshela. Sibike le nkinga yesitoko. Sizokwazisa uma umuthi wakho utholakalile. Siyaxolisa ngokuphazamisa.',
    xh: 'Enkosi ngokusixelela. Siyixele le ngxaki yesitoko. Siza kukwazisa xa amayeza akho efumaneka. Siyaxolisa ngokuphazamisa.',
    af: 'Dankie dat jy ons laat weet. Ons het hierdie voorraad probleem gerapporteer. Ons sal jou in kennis stel sodra jou medikasie beskikbaar is. Ons vra om verskoning.',
  },

  missed_side_effects: {
    en: '⚠️ Please do not stop taking your medication without speaking to a healthcare worker first. Stopping suddenly can be dangerous.\n\nA nurse has been notified and will contact you to discuss your side effects and explore alternatives.\n\nIf you feel very unwell, call *10177* or visit your nearest clinic.',
    zu: '⚠️ Sicela ungayeki ukuthatha umuthi wakho ngaphandle kokukhuluma nesisebenzi sezempilo kuqala. Ukuyeka kungazumeki kungaba yingozi.\n\nUnesi wazisiwe futhi uzokuxhumana nawe ukuxoxa ngemiphumela emibi nokuhlola ezinye izindlela.\n\nUma uzizwa ungaphilile kakhulu, shaya *10177* noma uvakashele umtholampilo oseduze.',
    xh: '⚠️ Nceda musa ukuyeka ukuthatha amayeza akho ngaphandle kokuthetha nomsebenzi wezempilo kuqala. Ukuyeka ngequbuliso kunobungozi.\n\nUmongikazi wazisiwe kwaye uya kuqhagamshelana nawe ukuxoxa ngemiphumo emibi nokuphonononga ezinye iindlela.\n\nUkuba uziva ungaphilanga kakhulu, tsalela *10177* okanye utyelele ikliniki ekufutshane.',
    af: '⚠️ Moet asseblief nie ophou met jou medikasie sonder om eers met \'n gesondheidswerker te praat nie. Skielike staking kan gevaarlik wees.\n\n\'n Verpleegster is in kennis gestel en sal jou kontak om newe-effekte te bespreek en alternatiewe te ondersoek.\n\nAs jy baie sleg voel, bel *10177* of besoek jou naaste kliniek.',
  },

  // Re-engagement for previously defaulted patients
  reengagement: {
    en: `Hello from BIZUSIZO 💊\n\nWe noticed you haven't collected your chronic medication recently. We know life gets busy and collecting can be difficult.\n\nWe want to help you get back on track. Your health matters.\n\nWould you like help finding a convenient pickup point?\n1 — Yes, help me collect my medication\n2 — I am collecting elsewhere now\n3 — I need to speak to someone`,
    zu: `Sawubona kusuka ku-BIZUSIZO 💊\n\nSibonile ukuthi awukathathi umuthi wakho wamahlalakhona muva nje. Siyazi ukuthi impilo iba matasa futhi ukuthatha kungaba nzima.\n\nSifuna ukukusiza ubuyele emgudwini. Impilo yakho ibalulekile.\n\nUngathanda usizo lokuthola indawo elula yokuthatha?\n1 — Yebo, ngisize ngithole umuthi\n2 — Sengithatha kwenye indawo\n3 — Ngidinga ukukhuluma nomuntu`,
    xh: `Molo ukusuka ku-BIZUSIZO 💊\n\nSiqaphele ukuba awukawathathanga amayeza akho aqhelekileyo kutshanje. Siyazi ukuba ubomi buxakekile kwaye ukuthatha kunokuba nzima.\n\nSifuna ukukunceda ubuyele endleleni. Impilo yakho ibalulekile.\n\nUngathanda uncedo lokufumana indawo elula yokuthatha?\n1 — Ewe, ndincede ndifumane amayeza\n2 — Ndithatha kwenye indawo ngoku\n3 — Ndifuna ukuthetha nomntu`,
    af: `Hallo van BIZUSIZO 💊\n\nOns het opgemerk dat jy nie onlangs jou chroniese medikasie afgehaal het nie. Ons weet die lewe raak besig en afhaal kan moeilik wees.\n\nOns wil jou help om weer op koers te kom. Jou gesondheid is belangrik.\n\nWil jy hulp hê om 'n gerieflike afhaal punt te vind?\n1 — Ja, help my om my medikasie te kry\n2 — Ek haal nou elders af\n3 — Ek moet met iemand praat`,
  },

  // Multimorbidity warning
  multimorbidity_warning: {
    en: (conditions) => `⚠️ Important: You collect medication for *${conditions}*. Missing your medication affects ALL of these conditions. Please collect as soon as possible.`,
    zu: (conditions) => `⚠️ Okubalulekile: Uthatha umuthi we-*${conditions}*. Ukungathathi umuthi kuthinta ZONKE lezi zifo. Sicela uwuthathe ngokushesha.`,
    xh: (conditions) => `⚠️ Okubalulekileyo: Uthatha amayeza e-*${conditions}*. Ukungawathathi amayeza kuchaphazela ZONKE ezi zifo. Nceda uwathathe ngokukhawuleza.`,
    af: (conditions) => `⚠️ Belangrik: Jy haal medikasie af vir *${conditions}*. Ontbrekende medikasie affekteer AL hierdie toestande. Haal asseblief so gou moontlik af.`,
  },
};

// ============ CONDITION MAPPING ============
const CONDITION_MAP = {
  '1': { key: 'hiv', label_en: 'HIV/ARVs', label_zu: 'HIV/Ama-ARV', db_field: 'adultshivaids' },
  '2': { key: 'hypertension', label_en: 'Hypertension', label_zu: 'Igazi eliphakeme', db_field: 'hypertensioninadults' },
  '3': { key: 'diabetes', label_en: 'Diabetes', label_zu: 'Ushukela', db_field: 'type2diabetesmellitusadult' },
  '4': { key: 'angina', label_en: 'Heart/Angina', label_zu: 'Inhliziyo', db_field: 'anginapectorisstable' },
  '5': { key: 'asthma', label_en: 'Asthma/Lung', label_zu: 'Isifuba', db_field: 'chronicasthma' },
  '6': { key: 'epilepsy', label_en: 'Epilepsy', label_zu: 'Isifo sokuwa', db_field: 'epilepsy' },
  '7': { key: 'mental_health', label_en: 'Depression / Mental health', label_zu: 'Ukukhathazeka / Ingqondo', db_field: 'mental_health' },
  '8': { key: 'other', label_en: 'Other chronic', label_zu: 'Okunye', db_field: 'other_chronic' },
};

// ============ RISK SCORING ============
// Based on NMM data: older adults (65+) and multimorbid patients most at risk
function calculateCCMDDRisk(session) {
  let riskScore = 0;
  const conditions = session.ccmddConditions || [];

  // Multimorbidity: 2+ conditions
  if (conditions.length >= 2) riskScore += 2;
  if (conditions.length >= 3) riskScore += 1;

  // HIV patients — highest volume, highest consequence of defaulting
  if (conditions.some(c => c.key === 'hiv')) riskScore += 1;

  // Age risk (from session if available)
  const age = session.patientAge;
  if (age && age >= 60) riskScore += 1;
  if (age && age >= 75) riskScore += 1;

  // Previous misses
  const consecutiveMisses = session.consecutiveMisses || 0;
  if (consecutiveMisses >= 1) riskScore += 2;
  if (consecutiveMisses >= 3) riskScore += 3;

  // Risk levels: LOW (0-1), MEDIUM (2-3), HIGH (4+)
  if (riskScore >= 4) return 'HIGH';
  if (riskScore >= 2) return 'MEDIUM';
  return 'LOW';
}

// ============ DATABASE FUNCTIONS ============
async function getCCMDDPickupPoints(patientLocation, limit = 3) {
  if (!FEATURES.CCMDD_ROUTING || !patientLocation) return [];

  const { data } = await supabase
    .from('ccmdd_pickup_points')
    .select('*');

  if (!data || data.length === 0) return [];

  const results = data.map(point => ({
    ...point,
    distance: Math.round(getDistance(
      patientLocation.latitude, patientLocation.longitude,
      point.latitude, point.longitude
    ) * 10) / 10
  }));

  results.sort((a, b) => a.distance - b.distance);
  return results.slice(0, limit);
}

async function logCCMDDCollection(entry) {
  try {
    await supabase.from('ccmdd_collections').insert(entry);
  } catch (e) {
    logger.error('Failed to log CCMDD collection:', e);
  }
}

async function updateCCMDDProfile(patientId, updates) {
  try {
    await supabase.from('ccmdd_patient_profiles').upsert({
      patient_id: patientId,
      ...updates,
      updated_at: new Date()
    });
  } catch (e) {
    logger.error('Failed to update CCMDD profile:', e);
  }
}

async function getDefaultedPatients(daysSinceLastCollection = 30) {
  try {
    const cutoff = new Date(Date.now() - daysSinceLastCollection * 24 * 60 * 60 * 1000);
    const { data } = await supabase
      .from('ccmdd_patient_profiles')
      .select('*')
      .lt('last_collection_date', cutoff.toISOString())
      .gt('total_collections', 0); // Only patients who collected at least once
    return data || [];
  } catch (e) {
    return [];
  }
}

// ============ DETECT CHRONIC MED REQUEST ============
function isChronicMedRequest(message, categoryChoice) {
  if (categoryChoice === '8') return true;
  const lower = (message || '').toLowerCase();
  const chronicKeywords = [
    'medication', 'refill', 'chronic', 'pills', 'prescription', 'collect',
    'umuthi', 'amapilisi', 'ipilisi',       // isiZulu/isiXhosa
    'medikasie', 'pille',                     // Afrikaans
    'dihlare', 'dipilisi',                    // Sepedi/Setswana
    'meriana', 'dipilisi',                    // Sesotho
    'murhi', 'tipilisi',                      // Xitsonga
    'umutsi', 'emapilisi',                    // siSwati
    'mushonga',                               // Tshivenda
    'sugar', 'high blood', 'arvs', 'arv', 'hiv pills',
    'bp tablets', 'blood pressure', 'diabetes',
    'dablapmeds', 'dablap',                   // CCMDD brand name
    'collect my meds', 'fetch my pills', 'pickup my medication',
    'thatha umuthi', 'thatha amayeza',        // isiZulu/isiXhosa: "take/fetch medication"
  ];
  return chronicKeywords.some(kw => lower.includes(kw));
}

// ============ HANDLE CCMDD CONVERSATION FLOW ============
async function handleCCMDD(patientId, from, message, session) {
  const lang = session.language || 'en';

  // Step 1: Confirm it's a chronic med request (not acute on chronic)
  if (session.ccmddStep === 'confirm_chronic') {
    if (message === '1') {
      // Ask what conditions they have
      session.ccmddStep = 'identify_conditions';
      await sessionLib.saveSession(patientId, session);
      const condMsg = CCMDD_MESSAGES.condition_check[lang] || CCMDD_MESSAGES.condition_check['en'];
      await sendWhatsAppMessage(from, condMsg);
      return true;
    }
    if (message === '2') {
      session.ccmddStep = null;
      await sessionLib.saveSession(patientId, session);
      return false; // Proceed to normal triage
    }
  }

  // Step 2: Capture conditions
  if (session.ccmddStep === 'identify_conditions') {
    // Parse comma-separated or single number responses: "1", "1,2", "1 2", "1, 3"
    const choices = message.replace(/[, ]+/g, ',').split(',').filter(c => CONDITION_MAP[c.trim()]);
    if (choices.length > 0) {
      session.ccmddConditions = choices.map(c => CONDITION_MAP[c.trim()]);
      const riskLevel = calculateCCMDDRisk(session);
      session.ccmddRiskLevel = riskLevel;

      // Update patient profile
      await updateCCMDDProfile(patientId, {
        conditions: session.ccmddConditions.map(c => c.key),
        risk_level: riskLevel
      });

      // Route to pickup
      if (!session.location) {
        session.ccmddStep = 'awaiting_location';
        await sessionLib.saveSession(patientId, session);
        await sendWhatsAppMessage(from, msg('request_location', lang));
        return true;
      }
      return await routeToCCMDD(patientId, from, session, lang);
    }
  }

  // Step 3: Got location, now route
  if (session.ccmddStep === 'awaiting_location' && session.location) {
    return await routeToCCMDD(patientId, from, session, lang);
  }

  // Step 4: Confirm pickup point
  if (session.ccmddStep === 'confirm_pickup') {
    if (message === '1') {
      const point = session.suggestedPickup;
      session.ccmddStep = null;
      session.confirmedPickup = point;
      await sessionLib.saveSession(patientId, session);
      const confirmMsg = (CCMDD_MESSAGES.ccmdd_confirmed[lang] || CCMDD_MESSAGES.ccmdd_confirmed['en'])(point.name);
      await sendWhatsAppMessage(from, confirmMsg);

      const conditionLabels = (session.ccmddConditions || []).map(c => c.label_en).join(', ');
      await sessionLib.logTriage({
        patient_id: patientId,
        triage_level: 'GREEN',
        confidence: 100,
        escalation: false,
        pathway: 'ccmdd_pickup',
        facility_name: point.name,
        location: session.location,
        symptoms: `chronic_medication_refill: ${conditionLabels}`
      });

      await logCCMDDCollection({
        patient_id: patientId,
        pickup_point_name: point.name,
        medication_type: conditionLabels,
        status: 'scheduled',
        scheduled_date: new Date(),
        risk_level: session.ccmddRiskLevel || 'LOW'
      });

      await updateCCMDDProfile(patientId, {
        last_collection_date: new Date(),
        consecutive_misses: 0
      });

      // Schedule collection reminder (24h)
      await scheduleCollectionReminder(patientId, from, point, 24);
      return true;
    }
    if (message === '2') {
      const alternatives = session.alternativePickups || [];
      if (alternatives.length > 0) {
        const listStr = alternatives.map((f, i) => `${i + 1}. *${f.name}* (${f.distance} km)`).join('\n');
        session.ccmddStep = 'choose_alternative_pickup';
        await sessionLib.saveSession(patientId, session);
        const altMsg = (MESSAGES.facility_alternatives[lang] || MESSAGES.facility_alternatives['en'])(listStr);
        await sendWhatsAppMessage(from, altMsg);
      } else {
        const naMsg = CCMDD_MESSAGES.ccmdd_not_available[lang] || CCMDD_MESSAGES.ccmdd_not_available['en'];
        await sendWhatsAppMessage(from, naMsg);
        session.ccmddStep = null;
        await sessionLib.saveSession(patientId, session);
      }
      return true;
    }
  }

  // Step 5: Choose alternative pickup
  if (session.ccmddStep === 'choose_alternative_pickup') {
    const alternatives = session.alternativePickups || [];
    const choice = parseInt(message) - 1;
    if (choice >= 0 && choice < alternatives.length) {
      const point = alternatives[choice];
      session.ccmddStep = null;
      session.confirmedPickup = point;
      await sessionLib.saveSession(patientId, session);
      const confirmMsg = (CCMDD_MESSAGES.ccmdd_confirmed[lang] || CCMDD_MESSAGES.ccmdd_confirmed['en'])(point.name);
      await sendWhatsAppMessage(from, confirmMsg);

      const conditionLabels = (session.ccmddConditions || []).map(c => c.label_en).join(', ');
      await sessionLib.logTriage({
        patient_id: patientId,
        triage_level: 'GREEN',
        confidence: 100,
        escalation: false,
        pathway: 'ccmdd_pickup',
        facility_name: point.name,
        location: session.location,
        symptoms: `chronic_medication_refill: ${conditionLabels}`
      });

      await logCCMDDCollection({
        patient_id: patientId,
        pickup_point_name: point.name,
        medication_type: conditionLabels,
        status: 'scheduled',
        scheduled_date: new Date(),
        risk_level: session.ccmddRiskLevel || 'LOW'
      });

      await updateCCMDDProfile(patientId, {
        last_collection_date: new Date(),
        consecutive_misses: 0
      });

      await scheduleCollectionReminder(patientId, from, point, 24);
      return true;
    }
  }

  // Step 6: Handle missed-collection reason responses (from 72h escalation)
  if (session.ccmddStep === 'missed_reason') {
    const reasons = {
      '1': { reason: 'transport_distance', response: 'missed_transport' },
      '2': { reason: 'work_schedule', response: 'missed_work' },
      '3': { reason: 'pup_closed', response: 'missed_closed' },
      '4': { reason: 'no_stock', response: 'missed_no_stock' },
      '5': { reason: 'side_effects', response: 'missed_side_effects' },
      '6': { reason: 'other', response: null },
    };

    const selected = reasons[message];
    if (selected) {
      // Log the reason
      await logCCMDDCollection({
        patient_id: patientId,
        status: 'missed',
        missed_reason: selected.reason,
        scheduled_date: new Date()
      });

      // Update consecutive misses
      const currentMisses = (session.consecutiveMisses || 0) + 1;
      session.consecutiveMisses = currentMisses;
      session.ccmddStep = null;
      await sessionLib.saveSession(patientId, session);

      await updateCCMDDProfile(patientId, {
        consecutive_misses: currentMisses,
        last_missed_reason: selected.reason
      });

      // Send appropriate response
      if (selected.response) {
        const responseMsg = CCMDD_MESSAGES[selected.response][lang] || CCMDD_MESSAGES[selected.response]['en'];
        await sendWhatsAppMessage(from, responseMsg);
      } else {
        await sendWhatsAppMessage(from, msg('consent_yes', lang)); // Generic acknowledgement
      }

      // If transport issue, trigger re-routing
      if (selected.reason === 'transport_distance') {
        session.ccmddStep = 'awaiting_location';
        await sessionLib.saveSession(patientId, session);
        await sendWhatsAppMessage(from, msg('request_location', lang));
      }

      // Side effects — critical escalation
      if (selected.reason === 'side_effects') {
        await sessionLib.logTriage({
          patient_id: patientId,
          triage_level: 'YELLOW',
          confidence: 100,
          escalation: true,
          pathway: 'ccmdd_side_effect_escalation',
          symptoms: 'Patient stopped medication due to side effects'
        });
      }

      return true;
    }
  }

  // Step 7: Re-engagement response
  if (session.ccmddStep === 'reengagement') {
    if (message === '1') {
      // Wants help collecting — restart CCMDD flow
      session.ccmddStep = 'identify_conditions';
      await sessionLib.saveSession(patientId, session);
      const condMsg = CCMDD_MESSAGES.condition_check[lang] || CCMDD_MESSAGES.condition_check['en'];
      await sendWhatsAppMessage(from, condMsg);
      return true;
    }
    if (message === '2') {
      // Collecting elsewhere — log and close
      session.ccmddStep = null;
      await sessionLib.saveSession(patientId, session);
      await updateCCMDDProfile(patientId, { status: 'collecting_elsewhere' });
      const ackMsg = lang === 'en'
        ? '✅ Good to hear you are still collecting your medication. Stay well!'
        : '✅ Kuhle ukuzwa ukuthi usathatha umuthi wakho. Hlala kahle!';
      await sendWhatsAppMessage(from, ackMsg);
      return true;
    }
    if (message === '3') {
      // Needs to speak to someone — escalate
      session.ccmddStep = null;
      await sessionLib.saveSession(patientId, session);
      await sessionLib.logTriage({
        patient_id: patientId,
        triage_level: 'YELLOW',
        confidence: 100,
        escalation: true,
        pathway: 'ccmdd_reengagement_escalation',
        symptoms: 'Defaulted patient requesting human contact'
      });
      const escMsg = lang === 'en'
        ? '👤 A healthcare worker will contact you shortly. If urgent, call your nearest clinic or *10177*.'
        : '👤 Isisebenzi sezempilo sizokuxhumana nawe maduze. Uma kuphuthuma, shaya umtholampilo oseduze noma *10177*.';
      await sendWhatsAppMessage(from, escMsg);
      return true;
    }
  }

  return false;
}

async function routeToCCMDD(patientId, from, session, lang) {
  const pickupPoints = await getCCMDDPickupPoints(session.location);

  if (pickupPoints.length === 0) {
    const naMsg = CCMDD_MESSAGES.ccmdd_not_available[lang] || CCMDD_MESSAGES.ccmdd_not_available['en'];
    await sendWhatsAppMessage(from, naMsg);
    session.ccmddStep = null;
    await sessionLib.saveSession(patientId, session);
    return true;
  }

  const nearest = pickupPoints[0];
  session.suggestedPickup = nearest;
  session.alternativePickups = pickupPoints.slice(1);
  session.ccmddStep = 'confirm_pickup';
  await sessionLib.saveSession(patientId, session);

  const routeMsg = (CCMDD_MESSAGES.ccmdd_route[lang] || CCMDD_MESSAGES.ccmdd_route['en'])(nearest.name, nearest.distance);
  await sendWhatsAppMessage(from, routeMsg);
  return true;
}

// ============ COLLECTION REMINDER SCHEDULER ============
async function scheduleCollectionReminder(patientId, phone, pickupPoint, hoursFromNow) {
  const reminderTime = new Date(Date.now() + hoursFromNow * 60 * 60 * 1000);
  try {
    await supabase.from('ccmdd_collections').upsert({
      patient_id: patientId,
      pickup_point_name: pickupPoint.name,
      next_reminder_at: reminderTime,
      reminder_count: 0,
      status: 'scheduled'
    });
  } catch (e) {
    logger.error('Failed to schedule reminder:', e);
  }
}

// ============ REMINDER AGENT (runs on interval) ============
async function runCCMDDReminderAgent() {
  if (!FEATURES.CCMDD_ROUTING) return;

  try {
    const now = new Date();
    const { data: dueReminders } = await supabase
      .from('ccmdd_collections')
      .select('*')
      .lte('next_reminder_at', now.toISOString())
      .in('status', ['scheduled', 'reminded']);

    if (!dueReminders || dueReminders.length === 0) return;

    for (const reminder of dueReminders) {
      const patientId = reminder.patient_id;
      const session = await sessionLib.getSession(patientId);
      const lang = session.language || 'en';

      // Find patient phone from follow_ups table (we have it there)
      const { data: followUps } = await supabase
        .from('follow_ups')
        .select('phone')
        .eq('patient_id', patientId)
        .limit(1);

      if (!followUps || followUps.length === 0) continue;
      const phone = followUps[0].phone;

      const count = reminder.reminder_count || 0;
      const pointName = reminder.pickup_point_name || 'your pickup point';

      if (count === 0) {
        // 24h reminder — gentle
        const reminderMsg = (CCMDD_MESSAGES.reminder_24h[lang] || CCMDD_MESSAGES.reminder_24h['en'])(pointName);
        await sendWhatsAppMessage(phone, reminderMsg);

        await supabase.from('ccmdd_collections').update({
          reminder_count: 1,
          status: 'reminded',
          next_reminder_at: new Date(Date.now() + 24 * 60 * 60 * 1000) // Next in 24h
        }).eq('id', reminder.id);

      } else if (count === 1) {
        // 48h reminder — concerned, ask if there's a problem
        const reminderMsg = (CCMDD_MESSAGES.reminder_48h[lang] || CCMDD_MESSAGES.reminder_48h['en'])(pointName);
        await sendWhatsAppMessage(phone, reminderMsg);

        // Set session to await response
        session.ccmddStep = 'missed_48h_response';
        await sessionLib.saveSession(patientId, session);

        await supabase.from('ccmdd_collections').update({
          reminder_count: 2,
          next_reminder_at: new Date(Date.now() + 24 * 60 * 60 * 1000) // Next in 24h
        }).eq('id', reminder.id);

      } else if (count >= 2) {
        // 72h+ escalation — send reason capture, notify healthcare worker
        const escMsg = CCMDD_MESSAGES.reminder_72h_escalation[lang] || CCMDD_MESSAGES.reminder_72h_escalation['en'];
        await sendWhatsAppMessage(phone, escMsg);

        // Multimorbidity warning if applicable
        const conditions = session.ccmddConditions || [];
        if (conditions.length >= 2) {
          const condLabels = conditions.map(c => c.label_en).join(', ');
          const multiMsg = (CCMDD_MESSAGES.multimorbidity_warning[lang] || CCMDD_MESSAGES.multimorbidity_warning['en'])(condLabels);
          await sendWhatsAppMessage(phone, multiMsg);
        }

        session.ccmddStep = 'missed_reason';
        await sessionLib.saveSession(patientId, session);

        await supabase.from('ccmdd_collections').update({
          reminder_count: count + 1,
          status: 'missed',
          next_reminder_at: null // Stop automated reminders, human takes over
        }).eq('id', reminder.id);

        // Log escalation
        await sessionLib.logTriage({
          patient_id: patientId,
          triage_level: 'YELLOW',
          confidence: 100,
          escalation: true,
          pathway: 'ccmdd_missed_escalation',
          symptoms: `Missed medication collection x${count + 1} days`
        });
      }
    }
  } catch (e) {
    logger.error('CCMDD reminder agent error:', e);
  }
}

// ============ RE-ENGAGEMENT AGENT (runs weekly) ============
async function runReengagementAgent() {
  if (!FEATURES.CCMDD_ROUTING) return;

  try {
    const defaulted = await getDefaultedPatients(30); // Not collected in 30 days

    for (const patient of defaulted) {
      const session = await sessionLib.getSession(patient.patient_id);
      const lang = session.language || 'en';

      // Find phone
      const { data: followUps } = await supabase
        .from('follow_ups')
        .select('phone')
        .eq('patient_id', patient.patient_id)
        .limit(1);

      if (!followUps || followUps.length === 0) continue;
      const phone = followUps[0].phone;

      const reengageMsg = CCMDD_MESSAGES.reengagement[lang] || CCMDD_MESSAGES.reengagement['en'];
      await sendWhatsAppMessage(phone, reengageMsg);

      session.ccmddStep = 'reengagement';
      await sessionLib.saveSession(patient.patient_id, session);
    }
  } catch (e) {
    logger.error('Re-engagement agent error:', e);
  }
}

// Schedule agents
// Collection reminders: every 30 minutes
setInterval(runCCMDDReminderAgent, 30 * 60 * 1000);
// Re-engagement: every 7 days
setInterval(runReengagementAgent, 7 * 24 * 60 * 60 * 1000);

// ================================================================
// VIRTUAL CONSULTS MODULE — Telemedicine Scheduling
// STATUS: Architecture ready. Activate via FEATURES.VIRTUAL_CONSULTS
// ================================================================
// When active, this module:
// 1. Offers virtual consult option for YELLOW triage cases
// 2. Presents it as an alternative to physical clinic visit
// 3. Either books via API or connects to a WhatsApp booking number
// 4. Logs the referral for tracking
// ================================================================

const VIRTUAL_CONSULT_MESSAGES = {
  offer: {
    en: `📱 A virtual consultation may be available for your condition.\n\nYou can speak to a healthcare worker by video call instead of travelling to a clinic.\n\nWould you like to:\n1 — Book a virtual consultation\n2 — No thanks, I'll visit a clinic in person`,
    zu: `📱 Ukubonisana nge-video kungaba khona ngesimo sakho.\n\nUngakhuluma nesisebenzi sezempilo nge-video call esikhundleni sokuya emtholampilo.\n\nUngathanda:\n1 — Bhukhela ukubonisana nge-video\n2 — Cha ngiyabonga, ngizoya emtholampilo`,
    xh: `📱 Ukubonisana nge-video kunokufumaneka ngemeko yakho.\n\nUngathetha nesisebenza sezempilo nge-video call endaweni yokuya ekliniki.\n\nUngathanda:\n1 — Bhukisha ukubonisana nge-video\n2 — Hayi enkosi, ndiza kundwendwela ikliniki`,
    af: `📱 \'n Virtuele konsultasie mag beskikbaar wees vir jou toestand.\n\nJy kan per videogesprek met \'n gesondheidswerker praat in plaas daarvan om na \'n kliniek te reis.\n\nWil jy:\n1 — \'n Virtuele konsultasie bespreek\n2 — Nee dankie, ek besoek liewer die kliniek`,
    nso: `📱 Go bonana ka video go ka ba gona bakeng sa maemo a gago.\n\nO ka bolela le mooki ka video call go na le go ya kliniki.\n\nO ka rata:\n1 — Go beya go bonana ka video\n2 — Aowa ke a leboga, ke tla etela kliniki`,
    tn: `📱 Go bonana ka video go ka nna gone bakeng sa maemo a gago.\n\nO ka bua le mooki ka video call go na le go ya kliniki.\n\nA o ka rata:\n1 — Go beya go bonana ka video\n2 — Nnyaa ke a leboga, ke tla etela kliniki`,
    st: `📱 Ho bonana ka video ho ka ba teng bakeng sa maemo a hao.\n\nO ka bua le mooki ka video call ho na le ho ya kliniki.\n\nO ka rata:\n1 — Ho beha ho bonana ka video\n2 — Tjhe ke a leboha, ke tla etela kliniki`,
    ts: `📱 Ku bonana hi video swi nga kumeka eka xiyimo xa wena.\n\nU nga vulavula na muongi hi video call ku ri na ku ya ekliniki.\n\nU ta lava:\n1 — Ku buka ku bonana hi video\n2 — Ee-ee ndza khensa, ndzi ta endzela kliniki`,
    ss: `📱 Kubonisana nge-video kungaba khona ngesimo sakho.\n\nUngakhuluma nenesi nge-video call esikhundleni sekuya emtfolamphilo.\n\nUngatsandza:\n1 — Kubhukhela kubonisana nge-video\n2 — Cha ngiyabonga, ngitawuya emtfolamphilo`,
    ve: `📱 U bonana nga video zwi nga vha hone kha vhuimo haṋu.\n\nNi nga amba na muongi nga video call hu si na u ya kha kiliniki.\n\nNi nga tama:\n1 — U buka u bonana nga video\n2 — Hai ri a livhuwa, ndi ḓo dalela kiliniki`,
    nr: `📱 Kubonisana nge-video kungaba khona ngesimo sakho.\n\nUngakhuluma nesisebenzi sezempilo nge-video call esikhundleni sokuya ekliniki.\n\nUngathanda:\n1 — Kubhukhela kubonisana nge-video\n2 — Awa ngiyathokoza, ngizokuya ekliniki`,
  },

  booking_api: {
    en: '✅ Your virtual consultation has been booked. You will receive a confirmation message with the date, time, and video link.',
    zu: '✅ Ukubonisana kwakho nge-video kubhukiwe. Uzothola umyalezo wokuqinisekisa onosuku, isikhathi, nelinki ye-video.',
    xh: '✅ Ukubonisana kwakho nge-video kubhukishiwe. Uya kufumana umyalezo wokuqinisekisa onosuku, ixesha, nelinki yevidiyo.',
    af: '✅ Jou virtuele konsultasie is bespreek. Jy sal \'n bevestigingsboodskap ontvang met die datum, tyd en videoskakel.',
    nso: '✅ Go bonana ga gago ka video go beakantšwe. O tla amogela molaetša wa go tiiša ka letšatši, nako, le linki ya video.',
    tn: '✅ Go bonana ga gago ka video go beilwe. O tla amogela molaetsa wa go tiisa ka letsatsi, nako, le linki ya video.',
    st: '✅ Ho bonana ha hao ka video ho beakantšwe. O tla fumana molaetsa wa ho tiisa ka letsatsi, nako, le linki ya video.',
    ts: '✅ Ku bonana ka wena hi video ku bukiwile. U ta amukela tsalwa ra ku tiyisisa hi siku, nkarhi, na linki ya video.',
    ss: '✅ Kubonisana kwakho nge-video kubhukiwe. Utawutfola umlayeto wekucinisekisa nelusuku, sikhatsi, nelinki ye-video.',
    ve: '✅ U bonana haṋu nga video ho bukiwa. Ni ḓo ṱanganedza muṅwalelo wa u khwaṱhisedza nga ḓuvha, tshifhinga, na linki ya video.',
    nr: '✅ Kubonisana kwakho nge-video kubhukiwe. Uzakuthola umlayezo wokuqinisekisa nelusuku, isikhathi, nelinki ye-video.',
  },

  booking_whatsapp: {
    en: (phone) => `📱 To book your virtual consultation, please message this number on WhatsApp:\n\n*${phone}*\n\nTell them BIZUSIZO referred you and describe your symptoms.`,
    zu: (phone) => `📱 Ukubhukhela ukubonisana kwakho nge-video, sicela uthumele umyalezo ku:\n\n*${phone}*\n\nBatshele ukuthi uthunywe yi-BIZUSIZO futhi uchaze izimpawu zakho.`,
    xh: (phone) => `📱 Ukubhukisha ukubonisana kwakho nge-video, nceda uthumele umyalezo ku:\n\n*${phone}*\n\nBaxelele ukuba uthunyelwe yi-BIZUSIZO kwaye uchaze iimpawu zakho.`,
    af: (phone) => `📱 Om jou virtuele konsultasie te bespreek, stuur asseblief \'n boodskap na hierdie nommer op WhatsApp:\n\n*${phone}*\n\nSê vir hulle BIZUSIZO het jou verwys en beskryf jou simptome.`,
    nso: (phone) => `📱 Go buka go bonana ga gago ka video, hle romela molaetša go nomoro ye ka WhatsApp:\n\n*${phone}*\n\nBa botše gore BIZUSIZO e go rometše gomme o hlalose dika tša gago.`,
    tn: (phone) => `📱 Go buka go bonana ga gago ka video, romela molaetsa go nomoro e ka WhatsApp:\n\n*${phone}*\n\nBa bolelele gore BIZUSIZO e go romeleng mme o tlhalose matshwao a gago.`,
    st: (phone) => `📱 Ho buka ho bonana ha hao ka video, romela molaetsa ho nomoro ena ka WhatsApp:\n\n*${phone}*\n\nBa bolelle hore BIZUSIZO e o romele mme o hlalosa matshwao a hao.`,
    ts: (phone) => `📱 Ku buka ku bonana ka wena hi video, hi kombela u rhumela tsalwa eka nomboro leyi hi WhatsApp:\n\n*${phone}*\n\nVa byela leswaku BIZUSIZO yi ku rhumele naswona u hlamusela swikombiso swa wena.`,
    ss: (phone) => `📱 Kubhukhela kubonisana kwakho nge-video, sicela utfumele umlayeto ku nomboro le nge-WhatsApp:\n\n*${phone}*\n\nBatjele kutsi BIZUSIZO ikurhumele futsi uchaze timphawu takho.`,
    ve: (phone) => `📱 U buka u bonana haṋu nga video, ri humbela ni rumele muṅwalelo kha nomboro iyi kha WhatsApp:\n\n*${phone}*\n\nVha vhudzeni uri BIZUSIZO yo ni rumela nahone ni ṱalutshedze zwiga zwaṋu.`,
    nr: (phone) => `📱 Kubhukhela kubonisana kwakho nge-video, sibawa uthumele umlayezo ku nomboro le nge-WhatsApp:\n\n*${phone}*\n\nBatjele kuthi BIZUSIZO ikurhumele futhi uchaze iimphawu zakho.`,
  },

  not_available: {
    en: '📱 Virtual consultations are not yet available in your area. Please visit your nearest clinic.',
    zu: '📱 Ukubonisana nge-video akukakafinyeleleki endaweni yakho okwamanje. Sicela uvakashele umtholampilo oseduze.',
    xh: '📱 Ukubonisana nge-video akukafumaneki kwindawo yakho okwangoku. Nceda utyelele ikliniki ekufutshane.',
    af: '📱 Virtuele konsultasies is nog nie in jou area beskikbaar nie. Besoek asseblief jou naaste kliniek.',
    nso: '📱 Go bonana ka video ga go eso be gona lefelong la gago. Hle etela kliniki ya kgauswi.',
    tn: '📱 Go bonana ka video ga go eso nne gone mo lefelong la gago. Etela kliniki e e gaufi.',
    st: '📱 Ho bonana ka video ha ho eso be teng sebakeng sa hao. Etela kliniki e haufi.',
    ts: '📱 Ku bonana hi video a ku si va kona endhawini ya wena. Hi kombela u endzela kliniki ya kusuhi.',
    ss: '📱 Kubonisana nge-video akukabi khona endzaweni yakho. Sicela uvakashele emtfolamphilo loseduze.',
    ve: '📱 U bonana nga video a zwi athu vha hone fhethu haṋu. Ri humbela ni dalele kiliniki i re tsini.',
    nr: '📱 Kubonisana nge-video akukabi khona endaweni yakho. Sibawa uvakatjhele ikliniki eseduze.',
  }
};

async function handleVirtualConsult(patientId, from, message, session) {
  const lang = session.language || 'en';

  if (!FEATURES.VIRTUAL_CONSULTS) return false;

  // Offer virtual consult
  if (session.virtualConsultStep === 'offered') {
    if (message === '1') {
      // Patient wants virtual consult
      session.virtualConsultStep = null;
      await sessionLib.saveSession(patientId, session);

      // Option A: Book via API
      if (FEATURES.VIRTUAL_CONSULT_URL) {
        try {
          const bookingResult = await fetch(FEATURES.VIRTUAL_CONSULT_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              patient_id: patientId,
              language: lang,
              triage_level: session.lastTriage?.triage_level,
              symptoms: session.lastSymptoms,
              timestamp: new Date().toISOString()
            })
          });

          if (bookingResult.ok) {
            const bookMsg = VIRTUAL_CONSULT_MESSAGES.booking_api[lang] || VIRTUAL_CONSULT_MESSAGES.booking_api['en'];
            await sendWhatsAppMessage(from, bookMsg);
          } else {
            throw new Error('Booking API failed');
          }
        } catch (e) {
          // Fallback to WhatsApp booking if API fails
          if (FEATURES.VIRTUAL_CONSULT_PHONE) {
            const wpMsg = (VIRTUAL_CONSULT_MESSAGES.booking_whatsapp[lang] || VIRTUAL_CONSULT_MESSAGES.booking_whatsapp['en'])(FEATURES.VIRTUAL_CONSULT_PHONE);
            await sendWhatsAppMessage(from, wpMsg);
          } else {
            const naMsg = VIRTUAL_CONSULT_MESSAGES.not_available[lang] || VIRTUAL_CONSULT_MESSAGES.not_available['en'];
            await sendWhatsAppMessage(from, naMsg);
          }
        }
      }
      // Option B: WhatsApp-based booking
      else if (FEATURES.VIRTUAL_CONSULT_PHONE) {
        const wpMsg = (VIRTUAL_CONSULT_MESSAGES.booking_whatsapp[lang] || VIRTUAL_CONSULT_MESSAGES.booking_whatsapp['en'])(FEATURES.VIRTUAL_CONSULT_PHONE);
        await sendWhatsAppMessage(from, wpMsg);
      }
      // Option C: Not available yet
      else {
        const naMsg = VIRTUAL_CONSULT_MESSAGES.not_available[lang] || VIRTUAL_CONSULT_MESSAGES.not_available['en'];
        await sendWhatsAppMessage(from, naMsg);
      }

      await sessionLib.logTriage({
        patient_id: patientId,
        triage_level: session.lastTriage?.triage_level || 'YELLOW',
        confidence: session.lastTriage?.confidence || 100,
        escalation: false,
        pathway: 'virtual_consult',
        facility_name: 'virtual',
        location: session.location || null,
        symptoms: session.lastSymptoms
      });

      await sessionLib.scheduleFollowUp(patientId, from, session.lastTriage?.triage_level || 'YELLOW');
      return true;
    }

    if (message === '2') {
      // Patient prefers in-person — proceed to facility routing
      session.virtualConsultStep = null;
      await sessionLib.saveSession(patientId, session);
      return false;
    }
  }

  return false;
}

// Offer virtual consult for eligible cases (YELLOW triage, not emergency)
async function offerVirtualConsult(patientId, from, session) {
  if (!FEATURES.VIRTUAL_CONSULTS) return false;

  // Only offer for YELLOW cases — ORANGE/RED need physical facility
  if (session.lastTriage?.triage_level !== 'YELLOW') return false;

  const lang = session.language || 'en';
  const offerMsg = VIRTUAL_CONSULT_MESSAGES.offer[lang] || VIRTUAL_CONSULT_MESSAGES.offer['en'];
  session.virtualConsultStep = 'offered';
  await sessionLib.saveSession(patientId, session);
  await sendWhatsAppMessage(from, offerMsg);
  return true;
}

// ================================================================
// LAB RESULTS MODULE — Healthcare Worker Dashboard + Patient Notifications
// STATUS: Manual entry ACTIVE. NHLS API integration DORMANT.
// ================================================================
// Informed by NMM District data: "Awaiting blood results" was the 4th
// most common deactivation reason (94 cases out of 1,070 documented).
//
// Current flow:
// 1. Healthcare worker enters lab results via dashboard (POST /api/lab-results)
// 2. System sends WhatsApp notification to patient in their language
// 3. Patient can ask about their lab results via WhatsApp (category 8 or keywords)
//
// Future flow (when NHLS API available):
// 1. System polls NHLS LabTrack/TrakCare for patient results
// 2. When new results detected, notifies healthcare worker on dashboard
// 3. Worker reviews and approves → automated WhatsApp to patient
// ================================================================

// Supabase table: lab_results
// id, patient_id, patient_phone, test_type, test_date, result_status,
// result_summary, result_detail, entered_by, reviewed_by, reviewed_at,
// patient_notified, patient_notified_at, nhls_reference, facility,
// created_at, updated_at

const LAB_MESSAGES = {
  result_ready: {
    en: (testType) => `📋 Your *${testType}* results are ready.\n\nPlease visit your clinic to discuss the results with your healthcare provider.\n\nIf you have been referred back to the clinic, this does NOT mean something is wrong — many results are routine check-ups.\n\nQuestions? Reply "results" or call your clinic.`,
    zu: (testType) => `📋 Imiphumela yakho ye-*${testType}* isilungile.\n\nSicela uvakashele umtholampilo wakho ukuxoxa ngemiphumela nesisebenzi sezempilo.\n\nUma ubuyelwe emtholampilo, lokhu AKUSHO ukuthi kukhona okungalungile — imiphumela eminingi ingeyokuhlolwa okujwayelekile.\n\nImibuzo? Phendula "imiphumela" noma ushayele umtholampilo wakho.`,
    xh: (testType) => `📋 Iziphumo zakho ze-*${testType}* zilungile.\n\nNceda utyelele ikliniki yakho ukuxoxa ngeziphumo nomsebenzi wezempilo.\n\nUkuba ubuyiselwe ekliniki, oku AKUTHETHI ukuba kukho into engalunganga — iziphumo ezininzi zezokuhlolwa okuqhelekileyo.\n\nImibuzo? Phendula "iziphumo" okanye utsalele ikliniki yakho.`,
    af: (testType) => `📋 Jou *${testType}* resultate is gereed.\n\nBesoek asseblief jou kliniek om die resultate met jou gesondheidswerker te bespreek.\n\nAs jy terugverwys is na die kliniek, beteken dit NIE iets is fout nie — baie resultate is roetine-ondersoeke.\n\nVrae? Antwoord "resultate" of bel jou kliniek.`,
    nso: (testType) => `📋 Diphetho tša gago tša *${testType}* di loketše.\n\nHle etela kliniki ya gago go boledišana le mooki ka diphetho.\n\nGe o rometšwe morago kliniki, se GA SE bolele gore go na le bothata — diphetho tše ntši ke tša go hlahloba ka tlwaelo.\n\nDipotšišo? Araba "diphetho" goba leletša kliniki ya gago.`,
    tn: (testType) => `📋 Dipholo tsa gago tsa *${testType}* di lokile.\n\nEtela kliniki ya gago go buisana le mooki ka dipholo.\n\nFa o buseditswe kliniki, se GA SE reye gore go na le bothata — dipholo tse dintsi ke tsa go tlhatlhoba ka tlwaelo.\n\nDipotso? Araba "dipholo" kgotsa leletsa kliniki ya gago.`,
    st: (testType) => `📋 Diphetho tsa hao tsa *${testType}* di lokile.\n\nEtela kliniki ya hao ho buisana le mooki ka diphetho.\n\nHaeba o rometswe morao kliniki, sena HA SE bolele hore ho na le bothata — diphetho tse ngata ke tsa ho hlahloba ka tlwaelo.\n\nDipotso? Araba "diphetho" kapa leletsa kliniki ya hao.`,
    ts: (testType) => `📋 Mbuyelo wa wena wa *${testType}* wu lunghile.\n\nHi kombela u endzela kliniki ya wena ku burisana na muongi hi mbuyelo.\n\nLoko u vuyiseriwile ekliniki, leswi A SWI vuli leswaku ku na xiphiqo — mimbuyelo yo tala i ya ku kamberiwa ka ntolovelo.\n\nSwivutiso? Hlamula "mimbuyelo" kumbe u rhingela kliniki ya wena.`,
    ss: (testType) => `📋 Imiphumela yakho ye-*${testType}* isilungile.\n\nSicela uvakashele emtfolamphilo wakho kutsi ucoca ngemiphumela nenesi.\n\nNangabe ubuyiselwe emtfolamphilo, loku AKUSHO kutsi kukhona lokungalungi — imiphumela leminyenti yekuhlolwa kwejwayelekile.\n\nImibuto? Phendvula "imiphumela" noma ushayele emtfolamphilo wakho.`,
    ve: (testType) => `📋 Mvelelo dzaṋu dza *${testType}* dzo lugiwa.\n\nRi humbela ni dalele kiliniki yaṋu u amba nga ha mvelelo na muongi.\n\nArali no vhuiswa kha kiliniki, izwi A LI ambi uri hu na thaidzo — mvelelo nnzhi ndi dza u ṱolisisa ha ḓuvha na ḓuvha.\n\nMbudziso? Fhindulani "mvelelo" kana ni founele kiliniki yaṋu.`,
    nr: (testType) => `📋 Imiphumela yakho ye-*${testType}* isilungile.\n\nSibawa uvakatjhele ikliniki yakho ukucoca ngemiphumela nesisebenzi sezempilo.\n\nNangabe ubuyiselwe ekliniki, lokhu AKUSHO ukuthi kukhona okungalungi — imiphumela eminengi ngeyokuhlolwa okujayelekileko.\n\nImibuto? Phendula "imiphumela" namkha ushayele ikliniki yakho.`,
  },

  result_action_required: {
    en: (testType) => `📋 Your *${testType}* results are ready and your healthcare provider would like to see you.\n\nPlease visit your clinic within the next 7 days. This is important for your ongoing care.\n\nIf you cannot get to the clinic, reply "help" and we will assist you.`,
    zu: (testType) => `📋 Imiphumela yakho ye-*${testType}* isilungile futhi isisebenzi sakho sezempilo sifuna ukukubona.\n\nSicela uvakashele umtholampilo wakho ezinsukwini ezi-7 ezizayo. Lokhu kubalulekile ekunakekelweni kwakho okuqhubekayo.\n\nUma ungakwazi ukufika emtholampilo, phendula "usizo" futhi sizokusiza.`,
    xh: (testType) => `📋 Iziphumo zakho ze-*${testType}* zilungile kwaye umsebenzi wakho wezempilo ufuna ukukubona.\n\nNceda utyelele ikliniki yakho kwiintsuku ezi-7 ezizayo. Oku kubalulekile kwinkathalelo yakho eqhubekayo.\n\nUkuba awukwazi ukufika ekliniki, phendula "uncedo" kwaye siza kukunceda.`,
    af: (testType) => `📋 Jou *${testType}* resultate is gereed en jou gesondheidswerker wil jou graag sien.\n\nBesoek asseblief jou kliniek binne die volgende 7 dae. Dit is belangrik vir jou voortgesette sorg.\n\nAs jy nie by die kliniek kan uitkom nie, antwoord "hulp" en ons sal jou help.`,
    nso: (testType) => `📋 Diphetho tša gago tša *${testType}* di loketše gomme mooki wa gago o nyaka go go bona.\n\nHle etela kliniki ya gago mo matšatšing a 7 a a tlago. Se se bohlokwa bakeng sa tlhokomelo ya gago.\n\nGe o sa kgone go fihla kliniki, araba "thušo" gomme re tla go thuša.`,
    tn: (testType) => `📋 Dipholo tsa gago tsa *${testType}* di lokile mme mooki wa gago o batla go go bona.\n\nEtela kliniki ya gago mo malatsing a 7 a a tlang. Se se botlhokwa bakeng sa tlhokomelo ya gago.\n\nFa o sa kgone go fitlha kliniki, araba "thuso" mme re tla go thusa.`,
    st: (testType) => `📋 Diphetho tsa hao tsa *${testType}* di lokile mme mooki wa hao o batla ho o bona.\n\nEtela kliniki ya hao matsatsing a 7 a tlang. Sena se bohlokwa bakeng sa tlhokomelo ya hao.\n\nHaeba o sa kgone ho fihla kliniki, araba "thuso" mme re tla o thusa.`,
    ts: (testType) => `📋 Mbuyelo wa wena wa *${testType}* wu lunghile naswona muongi wa wena u lava ku ku vona.\n\nHi kombela u endzela kliniki ya wena eka masiku ya 7 ya ha mambe. Leswi swi na nkoka eka vukorhokeri bya wena.\n\nLoko u nga koti ku fika ekliniki, hlamula "mpfuno" hi ta ku pfuna.`,
    ss: (testType) => `📋 Imiphumela yakho ye-*${testType}* isilungile futsi unesi wakho ufuna kukubona.\n\nSicela uvakashele emtfolamphilo wakho emalangeni la-7 latako. Loku kubalulekile ekunakekelweni kwakho.\n\nNawungakwati kufika emtfolamphilo, phendvula "lusito" futsi sitakusita.`,
    ve: (testType) => `📋 Mvelelo dzaṋu dza *${testType}* dzo lugiwa nahone muongi waṋu u ṱoḓa u ni vhona.\n\nRi humbela ni dalele kiliniki yaṋu maḓuvhani a 7 a ḓaho. Hezwi zwi ndeme kha tshumelo yaṋu.\n\nArali ni sa koni u swika kha kiliniki, fhindulani "thuso" ri ḓo ni thusa.`,
    nr: (testType) => `📋 Imiphumela yakho ye-*${testType}* isilungile futhi unesi wakho ufuna ukukubona.\n\nSibawa uvakatjhele ikliniki yakho emalangeni la-7 latako. Lokhu kubalulekile ekunakekelweni kwakho.\n\nNawungakwazi ukufika ekliniki, phendula "isizo" futhi sizakukusiza.`,
  },

  result_normal: {
    en: (testType) => `✅ Good news! Your *${testType}* results are back and everything looks normal.\n\nKeep taking your medication as prescribed. Your next check-up will be scheduled as usual.\n\nStay well! 💚`,
    zu: (testType) => `✅ Izindaba ezinhle! Imiphumela yakho ye-*${testType}* ibuyile futhi konke kubukeka kujwayelekile.\n\nQhubeka uthatha umuthi wakho njengoba unikeziwe. Ukuhlolwa kwakho okulandelayo kuzohlelelwa njengokujwayelekile.\n\nHlala kahle! 💚`,
    xh: (testType) => `✅ Iindaba ezimnandi! Iziphumo zakho ze-*${testType}* zibuyile kwaye yonke into ibonakala iqhelekile.\n\nQhubeka uthatha amayeza akho njengoko unikeziwe. Ukuhlolwa kwakho okulandelayo kuya kucwangciswa njengokuqhelekileyo.\n\nHlala kakuhle! 💚`,
    af: (testType) => `✅ Goeie nuus! Jou *${testType}* resultate is terug en alles lyk normaal.\n\nHou aan om jou medikasie soos voorgeskryf te neem. Jou volgende ondersoek sal soos gewoonlik geskeduleer word.\n\nBly gesond! 💚`,
    nso: (testType) => `✅ Ditaba tše di botse! Diphetho tša gago tša *${testType}* di boile gomme tšohle di bonagala di le kaone.\n\nTšwela pele go nwa dihlare tša gago bjalo ka ge o laeditšwe. Go hlahloba ga gago go go latelago go tla beakanywa ka tlwaelo.\n\nDula gabotse! 💚`,
    tn: (testType) => `✅ Dikgang tse di monate! Dipholo tsa gago tsa *${testType}* di boile mme tsotlhe di bonala di siame.\n\nTswela pele go nwa dimelemo tsa gago jaaka o laetswe. Go tlhatlhoba ga gago go go latelang go tla rulaganngwa ka tlwaelo.\n\nNna sentle! 💚`,
    st: (testType) => `✅ Ditaba tse ntle! Diphetho tsa hao tsa *${testType}* di boile mme tsohle di bonahala di le kaone.\n\nTswela pele ho nwa meriana ya hao joale ka ha o laetswe. Ho hlahloba ha hao ho ho latelang ho tla hlophiswa ka tlwaelo.\n\nPhela hantle! 💚`,
    ts: (testType) => `✅ Mahungu lamanene! Mbuyelo wa wena wa *${testType}* wu vuyile naswona hinkwaswo swi vonaka swi ri kahle.\n\nYisa emahlweni ku teka mirhi ya wena hilaha u laerisiweke. Ku kambelwa ka wena loku landzelaka ku ta hleriwa hi ntolovelo.\n\nTshama kahle! 💚`,
    ss: (testType) => `✅ Tindzaba letimnandzi! Imiphumela yakho ye-*${testType}* ibuyile futsi konkhe kubonakala kujwayelekile.\n\nChubeka utfola imitsi yakho njengoba unikwe. Kuhlolwa kwakho lokulandzelako kutawuhlelwa njengokwejwayelekile.\n\nHlala kahle! 💚`,
    ve: (testType) => `✅ Mafhungo avhuḓi! Mvelelo dzaṋu dza *${testType}* dzo vhuya nahone zwoṱhe zwi vhonala zwi zwavhuḓi.\n\nBveledzani u nwa mushonga waṋu sa zwe na laedzwa. U ṱolisisa haṋu hu tevhelaho hu ḓo dzudzanywa nga nḓila ya ḓuvha na ḓuvha.\n\nDzulani zwavhuḓi! 💚`,
    nr: (testType) => `✅ Iindaba ezimnandi! Imiphumela yakho ye-*${testType}* ibuyile futhi konkhe kubonakala kujayelekileko.\n\nRagela phambili uthatha imitjhoga yakho njengoba unikwe. Ukuhlolwa kwakho okulandelako kutawuhlelwa njengokujayelekileko.\n\nHlala kuhle! 💚`,
  },

  check_status: {
    en: 'Let me check your lab results. One moment please...',
    zu: 'Ake ngibheke imiphumela yakho yasekhemisti. Umzuzwana owodwa...',
    xh: 'Mandibheke iziphumo zakho zasekhemisti. Umzuzwana omnye nceda...',
    af: 'Laat ek jou laboratorium resultate nagaan. Een oomblik asseblief...',
    nso: 'A ke hlahlobe diphetho tša gago tša laborathori. Motsotswana o tee hle...',
    tn: 'A ke tlhatlhobe dipholo tsa gago tsa laborathori. Motsotswana o le mongwe...',
    st: 'Ha ke hlahlobe diphetho tsa hao tsa laborathori. Motsotswana o le mong...',
    ts: 'A ndzi kambela mbuyelo wa wena wa laborathori. Xinkarhana xin\'we hi kombela...',
    ss: 'Ase ngihlole imiphumela yakho yasekhemisi. Umzuzwana munye sicela...',
    ve: 'Kha ndi ṱole mvelelo dzaṋu dza laborathori. Tshikhathi tshithihi ri humbela...',
    nr: 'Ase ngihlole imiphumela yakho yasekhemisi. Umzuzwana owodwa...',
  },

  no_results: {
    en: 'We do not have any lab results on file for you at the moment. If you are expecting results, please check with your clinic.\n\nResults typically take 3-7 working days depending on the test type.',
    zu: 'Asinayo imiphumela yasekhemisi ngawe okwamanje. Uma ulindele imiphumela, sicela ubheke nomtholampilo wakho.\n\nImiphumela ngokuvamile ithatha izinsuku ezi-3 kuya kwezi-7 zomsebenzi kuya ngohlobo lokuhlolwa.',
    xh: 'Asina ziphumo zasekhemisti ngawe okwangoku. Ukuba ulindele iziphumo, nceda uhlole nekliniki yakho.\n\nIziphumo zihlala zithatha iintsuku ezi-3 ukuya kwezi-7 zomsebenzi ngokuxhomekeke kuhlobo lwesivavanyelo.',
    af: 'Ons het tans geen laboratorium resultate vir jou op lêer nie. As jy resultate verwag, gaan asseblief by jou kliniek na.\n\nResultate neem gewoonlik 3-7 werksdae afhangende van die toets tipe.',
    nso: 'Ga re na diphetho tša laborathori ka wena ga bjale. Ge o letetše diphetho, hle botšiša kliniki ya gago.\n\nDiphetho ka tlwaelo di tšea matšatši a 3-7 a mošomo go ya ka mohuta wa teko.',
    tn: 'Ga re na dipholo tsa laborathori ka wena ka nako e. Fa o letetse dipholo, botsa kliniki ya gago.\n\nDipholo ka tlwaelo di tsaya malatsi a 3-7 a tiro go ya ka mofuta wa teko.',
    st: 'Ha re na diphetho tsa laborathori ka wena ha jwale. Haeba o letetse diphetho, botsa kliniki ya hao.\n\nDiphetho ka tlwaelo di nka matsatsi a 3-7 a mosebetsi ho ya ka mofuta wa teko.',
    ts: 'A hi na mbuyelo wa laborathori hi wena sweswi. Loko u languterile mbuyelo, vutisa kliniki ya wena.\n\nMimbuyelo hi ntolovelo yi teka masiku ya 3-7 ya ntirho ku ya hi muxaka wa teko.',
    ss: 'Asina miphumela yasekhemisi ngawe kwanyalo. Nawulindze imiphumela, hlola nemtfolamphilo wakho.\n\nImiphumela ngekwejwayelekile itfatsa emalanga la-3 kuya ku la-7 emsebentini kuya ngeluhlobo lwekuhlolwa.',
    ve: 'A ri na mvelelo dza laborathori nga inwi zwino. Arali ni tshi lindela mvelelo, vhudzisani kha kiliniki yaṋu.\n\nMvelelo nga ḓuvha na ḓuvha dzi dzhia maḓuvha a 3-7 a mushumo u ya nga lushaka lwa ndingo.',
    nr: 'Asina miphumela yasekhemisi ngawe kwanje. Nawulindele imiphumela, hlola nekliniki yakho.\n\nImiphumela ngokwejwayelekile ithatha amalanga la-3 ukuya kwala-7 wemsebenzini kuya ngohlobo lokuhlolwa.',
  },

  pending_results: {
    en: (testType, testDate) => `Your *${testType}* test from *${testDate}* is still being processed. We will notify you on WhatsApp as soon as results are available.\n\nYou do not need to visit the clinic to check — we will come to you.`,
    zu: (testType, testDate) => `Ukuhlolwa kwakho kwe-*${testType}* kwe-*${testDate}* kusaqhutshwa. Sizokwazisa ku-WhatsApp uma imiphumela itholakalile.\n\nAwudingi ukuvakashela umtholampilo ukuhlola — sizofinyelela kuwe.`,
    xh: (testType, testDate) => `Uvavanyo lwakho lwe-*${testType}* lwe-*${testDate}* lusaqhutyelwa. Siza kukwazisa kuWhatsApp xa iziphumo zifumaneka.\n\nAwudingi ukutyelela ikliniki ukuhlola — siza kuza kuwe.`,
    af: (testType, testDate) => `Jou *${testType}* toets van *${testDate}* word nog verwerk. Ons sal jou op WhatsApp in kennis stel sodra resultate beskikbaar is.\n\nJy hoef nie die kliniek te besoek om na te gaan nie — ons kom na jou toe.`,
    nso: (testType, testDate) => `Teko ya gago ya *${testType}* ya *${testDate}* e sa šomwa. Re tla go tsebiša ka WhatsApp ge diphetho di hwetšagala.\n\nGa o nyake go etela kliniki go hlahloba — re tla tla go wena.`,
    tn: (testType, testDate) => `Teko ya gago ya *${testType}* ya *${testDate}* e sa ntse e dirwa. Re tla go itsise ka WhatsApp fa dipholo di le teng.\n\nGa o tlhoke go etela kliniki go tlhatlhoba — re tla tla go wena.`,
    st: (testType, testDate) => `Teko ya hao ya *${testType}* ya *${testDate}* e ntse e etswa. Re tla o tsebisa ka WhatsApp ha diphetho di fumanehang.\n\nHa o hloke ho etela kliniki ho hlahloba — re tla tla ho wena.`,
    ts: (testType, testDate) => `Teko ya wena ya *${testType}* ya *${testDate}* yi ha yi endliwa. Hi ta ku tivisa hi WhatsApp loko mbuyelo wu kumeka.\n\nA wu lavi ku endzela kliniki ku kambela — hi ta ta eka wena.`,
    ss: (testType, testDate) => `Kuhlolwa kwakho kwe-*${testType}* kwe-*${testDate}* kusentiwa. Sitakwatisa ku-WhatsApp uma imiphumela itfolakala.\n\nAwudzingi kuvakashela emtfolamphilo kuhlola — siteta kuwe.`,
    ve: (testType, testDate) => `Ndingo yaṋu ya *${testType}* ya *${testDate}* i kha ḓi itwa. Ri ḓo ni ḓivhadza kha WhatsApp musi mvelelo dzi tshi wanala.\n\nA ni ṱoḓi u dalela kiliniki u ṱola — ri ḓo ḓa kha inwi.`,
    nr: (testType, testDate) => `Ukuhlolwa kwakho kwe-*${testType}* kwe-*${testDate}* kusentiwa. Sizakwazisa ku-WhatsApp ngemiphumela nayitholakala.\n\nAwudzingi ukuvakatjhela ikliniki ukuhlola — sizakuza kuwe.`,
  },
};

// Common test types for the dashboard dropdown
const LAB_TEST_TYPES = [
  'CD4 Count', 'Viral Load', 'Full Blood Count', 'HbA1c (Diabetes)',
  'Creatinine/eGFR (Kidney)', 'Liver Function', 'Lipid Panel (Cholesterol)',
  'TB GeneXpert', 'Pap Smear', 'Blood Glucose', 'Urinalysis',
  'Pregnancy Test', 'STI Screening', 'Other'
];

// Result categories that determine notification type
const RESULT_CATEGORIES = {
  normal: 'result_normal',           // All good — positive reinforcement
  ready: 'result_ready',            // Ready for discussion — neutral
  action_required: 'result_action_required'  // Needs clinic visit — urgent but not alarming
};

// ============ LAB RESULTS DATABASE FUNCTIONS ============
async function getPatientLabResults(patientId) {
  try {
    const { data } = await supabase
      .from('lab_results')
      .select('*')
      .eq('patient_id', patientId)
      .order('created_at', { ascending: false })
      .limit(5);
    return data || [];
  } catch (e) {
    return [];
  }
}

async function createLabResult(entry) {
  try {
    const { data } = await supabase
      .from('lab_results')
      .insert(entry)
      .select()
      .single();
    return data;
  } catch (e) {
    logger.error('Failed to create lab result:', e);
    return null;
  }
}

async function updateLabResult(id, updates) {
  try {
    await supabase
      .from('lab_results')
      .update({ ...updates, updated_at: new Date() })
      .eq('id', id);
  } catch (e) {
    logger.error('Failed to update lab result:', e);
  }
}

// ============ NOTIFY PATIENT OF LAB RESULTS ============
async function notifyPatientOfResults(labResult) {
  if (!labResult.patient_phone) return;

  // Get patient session for language preference
  const patientId = labResult.patient_id;
  const session = await sessionLib.getSession(patientId);
  const lang = session.language || 'en';

  const testType = labResult.test_type || 'lab test';
  const category = labResult.result_category || 'ready';
  const messageKey = RESULT_CATEGORIES[category] || 'result_ready';

  const msgTemplate = LAB_MESSAGES[messageKey][lang] || LAB_MESSAGES[messageKey]['en'];
  const notification = typeof msgTemplate === 'function' ? msgTemplate(testType) : msgTemplate;

  await sendWhatsAppMessage(labResult.patient_phone, notification);

  // Log notification
  await updateLabResult(labResult.id, {
    patient_notified: true,
    patient_notified_at: new Date()
  });
}

// ============ PATIENT WHATSAPP: CHECK LAB RESULTS ============
function isLabResultsQuery(message) {
  const lower = (message || '').toLowerCase();
  const keywords = [
    'results', 'lab', 'blood test', 'test results', 'my results',
    'imiphumela', 'ikhemisi',                    // isiZulu
    'iziphumo', 'ikhemisti',                     // isiXhosa
    'resultate', 'laboratorium',                  // Afrikaans
    'cd4', 'viral load', 'blood count',
    'sugar test', 'kidney test', 'liver test',
  ];
  return keywords.some(kw => lower.includes(kw));
}

async function handleLabResultsQuery(patientId, from, session) {
  const lang = session.language || 'en';

  // Send "checking" message
  const checkMsg = LAB_MESSAGES.check_status[lang] || LAB_MESSAGES.check_status['en'];
  await sendWhatsAppMessage(from, checkMsg);

  const results = await getPatientLabResults(patientId);

  if (results.length === 0) {
    const noMsg = LAB_MESSAGES.no_results[lang] || LAB_MESSAGES.no_results['en'];
    await sendWhatsAppMessage(from, noMsg);
    return;
  }

  // Show most recent result
  const latest = results[0];

  if (latest.result_status === 'pending') {
    const testDate = new Date(latest.test_date).toLocaleDateString('en-ZA');
    const pendingMsg = (LAB_MESSAGES.pending_results[lang] || LAB_MESSAGES.pending_results['en'])(latest.test_type, testDate);
    await sendWhatsAppMessage(from, pendingMsg);
  } else if (latest.result_status === 'ready' && latest.patient_notified) {
    // Already notified — resend the result notification
    await notifyPatientOfResults(latest);
  } else if (latest.result_status === 'ready') {
    await notifyPatientOfResults(latest);
  }
}

// ============ DORMANT: NHLS API INTEGRATION ============
// When NHLS provides an API or we gain LabTrack integration access,
// this function will poll for new results and create entries automatically.
async function pollNHLSResults() {
  if (!FEATURES.NHLS_API_INTEGRATION || !FEATURES.NHLS_API_URL) return;

  try {
    // Future: poll NHLS LabTrack/TrakCare API for new results
    // The expected flow:
    // 1. Query NHLS API with facility codes and date range
    // 2. For each new result, match to patient_id via NHLS reference number
    // 3. Create lab_results entry with status 'pending_review'
    // 4. Notify healthcare worker on dashboard for review
    // 5. Once reviewed and approved, notify patient via WhatsApp
    //
    // Expected NHLS API response structure (speculative):
    // {
    //   nhls_reference: "LAB-2026-XXXXXX",
    //   patient_identifier: "...",
    //   test_type: "CD4 Count",
    //   test_date: "2026-03-20",
    //   result: { value: 450, unit: "cells/uL", reference_range: "500-1500" },
    //   status: "final",
    //   facility: "Benoni Clinic",
    //   ordering_provider: "Dr. ..."
    // }
    //
    // const response = await fetch(FEATURES.NHLS_API_URL + '/results', {
    //   headers: { 'Authorization': `Bearer ${FEATURES.NHLS_API_KEY}` }
    // });
    // const results = await response.json();
    // for (const result of results) { ... }

    logger.info('NHLS API polling: not yet implemented — awaiting API access');
  } catch (e) {
    logger.error('NHLS API poll error:', e);
  }
}

// Poll NHLS every 15 minutes (when enabled)
setInterval(pollNHLSResults, 15 * 60 * 1000);

// ================================================================
// LAB RESULTS DASHBOARD — API ENDPOINTS
// ================================================================
// These endpoints power the healthcare worker dashboard for lab results.
// Protected by dashboard password (same as existing dashboard auth).
// ================================================================

// Middleware: simple auth check
// ================================================================
// DASHBOARD AUTH WITH ACCESS LOGGING
// ================================================================
// Every dashboard API call is logged with:
// - WHO (user name from x-dashboard-user header)
// - WHAT (API endpoint accessed)
// - WHEN (timestamp)
// This creates a full audit trail for governance accountability.
// ================================================================
function requireDashboardAuth(req, res, next) {
  // Try session-based auth first (new system)
  const token = getSessionToken(req);
  if (token) {
    validateSession(req).then(valid => {
      if (valid) {
        // Log to audit_log (new system)
        logAudit(req, 'API_CALL', null, { endpoint: req.method + ' ' + req.path });
        return next();
      }
      // Session invalid — try password fallback
      return tryPasswordAuth(req, res, next);
    }).catch(() => tryPasswordAuth(req, res, next));
    return;
  }
  // No session — try password auth (backward compat for governance dashboard)
  tryPasswordAuth(req, res, next);
}

// ── Dashboard password brute-force protection ──
const _passwordAttempts = new Map(); // ip → { count, firstAttempt, lockedUntil }
const PASSWORD_MAX_ATTEMPTS = 5;
const PASSWORD_WINDOW_MS = 15 * 60 * 1000;  // 15-minute window
const PASSWORD_LOCKOUT_MS = 15 * 60 * 1000; // 15-minute lockout after max attempts

function tryPasswordAuth(req, res, next) {
  const ip = req.headers['x-forwarded-for'] || req.socket.remoteAddress || 'unknown';
  const now = Date.now();
  const record = _passwordAttempts.get(ip) || { count: 0, firstAttempt: now, lockedUntil: 0 };

  // Check lockout
  if (record.lockedUntil > now) {
    const remainMin = Math.ceil((record.lockedUntil - now) / 60000);
    logger.warn(`[AUTH] IP ${ip} locked out — ${remainMin} min remaining`);
    return res.status(429).json({ error: `Too many failed attempts. Try again in ${remainMin} minutes.` });
  }

  const password = req.headers['x-dashboard-password'] || req.query.password;
  if (password !== process.env.DASHBOARD_PASSWORD) {
    // Reset window if expired
    if (now - record.firstAttempt > PASSWORD_WINDOW_MS) {
      record.count = 1;
      record.firstAttempt = now;
    } else {
      record.count++;
    }
    // Trigger lockout if max attempts reached
    if (record.count >= PASSWORD_MAX_ATTEMPTS) {
      record.lockedUntil = now + PASSWORD_LOCKOUT_MS;
      logger.warn(`[AUTH] IP ${ip} locked out after ${PASSWORD_MAX_ATTEMPTS} failed password attempts`);
    }
    _passwordAttempts.set(ip, record);
    return res.status(401).json({ error: 'Unauthorized' });
  }

  // Successful auth — clear attempts
  _passwordAttempts.delete(ip);
  // Legacy auth — set a minimal req.user for compatibility
  if (!req.user) {
    req.user = {
      id: null,
      facility_id: null,
      facility_name: null,
      role: 'admin', // Password auth = admin access (sees all)
      display_name: req.headers['x-dashboard-user'] || 'unknown'
    };
  }
  // Log access (legacy table + new audit_log)
  const userName = req.headers['x-dashboard-user'] || 'unknown';
  const endpoint = req.method + ' ' + req.path;
  supabase.from('dashboard_access_logs').insert({
    user_name: userName, endpoint, ip_address: ip, accessed_at: new Date(),
  }).then(() => {}).catch(e => {
    logger.error('[ACCESS_LOG] Failed to log:', e.message);
    if (typeof queueEvent === 'function') {
      queueEvent({ type: 'dashboard_access', table: 'dashboard_access_logs', data: { user_name: userName, endpoint, ip_address: ip, original_timestamp: new Date().toISOString() } });
    }
  });
  logAudit(req, 'API_CALL', null, { endpoint, auth_method: 'password' });
  next();
}

// ================================================================
// STAFF MANAGEMENT API — Admin only
// ================================================================

// GET /api/staff — List all staff
app.get('/api/staff', requireDashboardAuth, async (req, res) => {
  try {
    if (req.user.role !== 'admin') return res.status(403).json({ error: 'Admin only' });
    const { data, error } = await supabase
      .from('facility_users')
      .select('id, username, display_name, role, is_active, facility_id, district_name, last_login')
      .order('display_name');
    if (error) throw error;
    // Attach facility names
    const { data: facilities } = await supabase.from('facilities').select('id, name');
    const facMap = {};
    (facilities || []).forEach(f => { facMap[f.id] = f.name; });
    const users = (data || []).map(u => ({
      ...u,
      facility_name: u.facility_id ? (facMap[u.facility_id] || 'Unknown') : null,
    }));
    res.json({ staff: users });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// GET /api/facility/governance-lead — Get clinical governance lead for a facility
app.get('/api/facility/governance-lead', requireDashboardAuth, async (req, res) => {
  try {
    const facilityName = req.query.facility || req.user?.facility_name;
    if (!facilityName) return res.status(400).json({ error: 'facility required' });

    const { data, error } = await supabase
      .from('facilities')
      .select('clinical_governance_lead, clinical_governance_lead_contact, clinical_governance_lead_title, governance_lead_updated_at')
      .eq('name', facilityName)
      .single();

    if (error) throw error;
    res.json({
      facility: facilityName,
      governance_lead: data?.clinical_governance_lead || null,
      contact: data?.clinical_governance_lead_contact || null,
      title: data?.clinical_governance_lead_title || null,
      updated_at: data?.governance_lead_updated_at || null,
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// PUT /api/facility/governance-lead — Set clinical governance lead for a facility
// Only admin or manager can set this. This is the named individual accountable
// for AI tool outcomes (Amos Q2: "Name the person").
app.put('/api/facility/governance-lead', requireDashboardAuth, async (req, res) => {
  try {
    if (!['admin', 'manager'].includes(req.user?.role)) {
      return res.status(403).json({ error: 'Admin or facility manager only' });
    }
    const { facility_name, lead_name, lead_contact, lead_title } = req.body;
    const target = facility_name || req.user?.facility_name;
    if (!target || !lead_name) {
      return res.status(400).json({ error: 'facility_name and lead_name required' });
    }

    const { error } = await supabase
      .from('facilities')
      .update({
        clinical_governance_lead: lead_name.trim(),
        clinical_governance_lead_contact: lead_contact || null,
        clinical_governance_lead_title: lead_title || null,
        governance_lead_updated_at: new Date().toISOString(),
      })
      .eq('name', target);

    if (error) throw error;

    await logAudit(req, 'SET_GOVERNANCE_LEAD', null, {
      facility: target, lead_name, lead_title, set_by: req.user?.display_name,
    });

    logger.info(`[GOVERNANCE] Clinical governance lead set for ${target}: ${lead_name} (${lead_title || 'no title'})`);
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// GET /api/staff/facilities — List facilities for dropdown
app.get('/api/staff/facilities', requireDashboardAuth, async (req, res) => {
  try {
    if (req.user.role !== 'admin') return res.status(403).json({ error: 'Admin only' });
    const { data } = await supabase.from('facilities').select('id, name, type, district').order('name');
    res.json({ facilities: data || [] });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// POST /api/staff — Create new staff member
app.post('/api/staff', requireDashboardAuth, async (req, res) => {
  try {
    if (req.user.role !== 'admin') return res.status(403).json({ error: 'Admin only' });
    const { username, display_name, password, role, facility_id, district_name } = req.body;
    if (!username || !display_name || !password || !role) {
      return res.status(400).json({ error: 'username, display_name, password, and role are required' });
    }
    if (password.length < 8) return res.status(400).json({ error: 'Password must be at least 8 characters' });
    const validRoles = ['admin', 'nurse', 'reception', 'manager', 'district'];
    if (!validRoles.includes(role)) {
      return res.status(400).json({ error: 'Invalid role. Must be: ' + validRoles.join(', ') });
    }
    // Check if username taken
    const { data: existing } = await supabase
      .from('facility_users')
      .select('id')
      .eq('username', username.toLowerCase().trim())
      .limit(1);
    if (existing && existing.length > 0) {
      return res.status(409).json({ error: 'Username already taken' });
    }
    const hash = await bcrypt.hash(password, 12);
    const row = {
      username: username.toLowerCase().trim(),
      display_name: display_name.trim(),
      password_hash: hash,
      role,
      is_active: true,
    };
    if (facility_id) row.facility_id = parseInt(facility_id);
    if (district_name) row.district_name = district_name;
    const { data, error } = await supabase.from('facility_users').insert(row).select().single();
    if (error) throw error;
    await logAudit(req, 'CREATE_STAFF', data.id, { username: row.username, role, display_name: row.display_name });
    res.json({ success: true, user: { id: data.id, username: row.username, display_name: row.display_name, role } });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// PUT /api/staff/:id — Update staff member
app.put('/api/staff/:id', requireDashboardAuth, async (req, res) => {
  try {
    if (req.user.role !== 'admin') return res.status(403).json({ error: 'Admin only' });
    const { id } = req.params;
    const { display_name, role, facility_id, district_name, is_active } = req.body;
    const updates = {};
    if (display_name !== undefined) updates.display_name = display_name.trim();
    if (role !== undefined) updates.role = role;
    if (facility_id !== undefined) updates.facility_id = facility_id ? parseInt(facility_id) : null;
    if (district_name !== undefined) updates.district_name = district_name || null;
    if (is_active !== undefined) updates.is_active = is_active;
    const { error } = await supabase.from('facility_users').update(updates).eq('id', id);
    if (error) throw error;
    // If deactivated, kill their sessions
    if (is_active === false) {
      await supabase.from('user_sessions').update({ is_active: false }).eq('user_id', id);
    }
    await logAudit(req, 'UPDATE_STAFF', id, updates);
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// POST /api/staff/:id/reset-password — Reset a staff member's password
app.post('/api/staff/:id/reset-password', requireDashboardAuth, async (req, res) => {
  try {
    if (req.user.role !== 'admin') return res.status(403).json({ error: 'Admin only' });
    const { id } = req.params;
    const { new_password } = req.body;
    if (!new_password || new_password.length < 8) {
      return res.status(400).json({ error: 'Password must be at least 8 characters' });
    }
    const hash = await bcrypt.hash(new_password, 12);
    const { error } = await supabase.from('facility_users').update({ password_hash: hash }).eq('id', id);
    if (error) throw error;
    // Invalidate their sessions
    await supabase.from('user_sessions').update({ is_active: false }).eq('user_id', id);
    await logAudit(req, 'RESET_PASSWORD', id, {});
    res.json({ success: true, message: 'Password reset. User must log in again.' });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// GET /api/access-logs — View dashboard access history
app.get('/api/access-logs', requireDashboardAuth, async (req, res) => {
  try {
    const limit = parseInt(req.query.limit) || 100;
    const { data } = await supabase
      .from('dashboard_access_logs')
      .select('*')
      .order('accessed_at', { ascending: false })
      .limit(limit);
    res.json(data || []);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// GET /api/access-logs/summary — Daily summary of who accessed what
app.get('/api/access-logs/summary', requireDashboardAuth, async (req, res) => {
  try {
    const { data } = await supabase
      .from('dashboard_access_logs')
      .select('user_name, endpoint, accessed_at')
      .order('accessed_at', { ascending: false })
      .limit(500);

    if (!data) return res.json({ users: [], daily: [] });

    // Group by user
    const userSummary = {};
    const dailySummary = {};
    data.forEach(row => {
      const user = row.user_name || 'unknown';
      const day = new Date(row.accessed_at).toISOString().split('T')[0];

      if (!userSummary[user]) userSummary[user] = { total: 0, last_access: row.accessed_at, endpoints: {} };
      userSummary[user].total++;
      userSummary[user].endpoints[row.endpoint] = (userSummary[user].endpoints[row.endpoint] || 0) + 1;

      if (!dailySummary[day]) dailySummary[day] = { total: 0, users: new Set() };
      dailySummary[day].total++;
      dailySummary[day].users.add(user);
    });

    // Convert sets to arrays for JSON
    Object.values(dailySummary).forEach(d => { d.users = [...d.users]; });

    res.json({ users: userSummary, daily: dailySummary });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// GET /api/lab-results — List results (filterable)
app.get('/api/lab-results', requireDashboardAuth, async (req, res) => {
  try {
    let query = supabase
      .from('lab_results')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(parseInt(req.query.limit) || 50);

    if (req.query.status) query = query.eq('result_status', req.query.status);
    if (req.query.facility) query = query.eq('facility', req.query.facility);
    if (req.query.test_type) query = query.eq('test_type', req.query.test_type);
    if (req.query.patient_id) query = query.eq('patient_id', req.query.patient_id);

    const { data, error } = await query;
    if (error) throw error;

    res.json({ results: data, test_types: LAB_TEST_TYPES });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// POST /api/lab-results — Create new lab result (manual entry by healthcare worker)
app.post('/api/lab-results', requireDashboardAuth, async (req, res) => {
  try {
    const { patient_id, patient_phone, test_type, test_date, result_status,
            result_summary, result_detail, result_category, entered_by,
            nhls_reference, facility } = req.body;

    if (!patient_id || !test_type) {
      return res.status(400).json({ error: 'patient_id and test_type are required' });
    }

    const entry = {
      patient_id,
      patient_phone: patient_phone || null,
      test_type,
      test_date: test_date || new Date(),
      result_status: result_status || 'pending',
      result_summary: result_summary || null,
      result_detail: result_detail || null,
      result_category: result_category || 'ready',
      entered_by: entered_by || 'dashboard',
      nhls_reference: nhls_reference || null,
      facility: facility || null,
      patient_notified: false,
      created_at: new Date()
    };

    const result = await createLabResult(entry);
    if (!result) throw new Error('Failed to create entry');

    res.json({ success: true, result });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// PUT /api/lab-results/:id — Update result (mark as ready, add details)
app.put('/api/lab-results/:id', requireDashboardAuth, async (req, res) => {
  try {
    const { id } = req.params;
    const updates = req.body;

    await updateLabResult(id, {
      ...updates,
      reviewed_at: new Date(),
      reviewed_by: updates.reviewed_by || 'dashboard'
    });

    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// POST /api/lab-results/:id/notify — Send WhatsApp notification to patient
app.post('/api/lab-results/:id/notify', requireDashboardAuth, async (req, res) => {
  try {
    const { id } = req.params;
    const { data: labResult } = await supabase
      .from('lab_results')
      .select('*')
      .eq('id', id)
      .single();

    if (!labResult) return res.status(404).json({ error: 'Result not found' });
    if (!labResult.patient_phone) return res.status(400).json({ error: 'No patient phone number' });

    await notifyPatientOfResults(labResult);
    res.json({ success: true, message: 'Patient notified via WhatsApp' });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// POST /api/lab-results/:id/mark-ready — Mark as ready, optionally attach prescription, notify patient
app.post('/api/lab-results/:id/mark-ready', requireDashboardAuth, async (req, res) => {
  try {
    const { id } = req.params;
    const { result_category, result_summary, reviewed_by,
            prescription_medication, prescription_dosage, prescription_duration,
            prescription_quantity, prescription_notes } = req.body;

    await updateLabResult(id, {
      result_status: 'ready',
      result_category: result_category || 'ready',
      result_summary: result_summary || null,
      reviewed_by: reviewed_by || 'dashboard',
      reviewed_at: new Date()
    });

    // Fetch updated record
    const { data: labResult } = await supabase
      .from('lab_results')
      .select('*')
      .eq('id', id)
      .single();

    // If nurse attached a prescription, create it
    let prescriptionCreated = false;
    if (prescription_medication && labResult) {
      await supabase.from('prescriptions').insert({
        patient_id: labResult.patient_id,
        medication: prescription_medication.trim(),
        dosage: prescription_dosage || null,
        duration: prescription_duration || null,
        quantity: prescription_quantity || null,
        prescribed_by: req.user?.display_name || reviewed_by || 'staff',
        facility_name: req.user?.facility_name || null,
        notes: prescription_notes || `Based on ${labResult.test_type} results`,
        status: 'active',
        prescribed_at: new Date().toISOString(),
        created_at: new Date().toISOString(),
      });
      prescriptionCreated = true;

      await logAudit(req, 'ADD_PRESCRIPTION', labResult.patient_id, {
        medication: prescription_medication,
        linked_to_lab: labResult.test_type,
        lab_result_id: id,
      });
    }

    // Notify patient — include prescription info if attached
    if (labResult && labResult.patient_phone) {
      await notifyPatientOfResults(labResult);

      // If prescription was attached, send a separate message about it
      if (prescriptionCreated) {
        const session = await sessionLib.getSession(labResult.patient_id);
        const lang = session.language || 'en';
        const rxMsg = {
          en: `💊 *Prescription*\n\nBased on your ${labResult.test_type} results, you have been prescribed:\n\n*${prescription_medication}*${prescription_dosage ? '\n' + prescription_dosage : ''}${prescription_duration ? ' · ' + prescription_duration : ''}${prescription_quantity ? '\nQuantity: ' + prescription_quantity : ''}\n\nYou can collect this at:\n• Your clinic pharmacy (free)\n• Any private pharmacy (at your cost)\n\nType *passport* to get a link you can show the pharmacist.\n\n${prescription_notes || ''}`,
          zu: `💊 *Umuthi Onikwe Wona*\n\nNgokususelwa emiphumeleni yakho ye-${labResult.test_type}, unikwe:\n\n*${prescription_medication}*${prescription_dosage ? '\n' + prescription_dosage : ''}${prescription_duration ? ' · ' + prescription_duration : ''}${prescription_quantity ? '\nUbuningi: ' + prescription_quantity : ''}\n\nUngawuthola:\n• Ekhemisi yomtholampilo (mahhala)\n• Kunoma iyiphi ikhemisi yangasese (ngezindleko zakho)\n\nBhala *passport* ukuthola ilinki ongayikhombisa ekhemisi.`,
          xh: `💊 *Amayeza Omiselwe Wona*\n\nNgokusekwe kwiziphumo zakho ze-${labResult.test_type}, umiselwe:\n\n*${prescription_medication}*${prescription_dosage ? '\n' + prescription_dosage : ''}${prescription_duration ? ' · ' + prescription_duration : ''}${prescription_quantity ? '\nUbuninzi: ' + prescription_quantity : ''}\n\nUngawathatha:\n• Kwikemisti yekliniki (simahla)\n• Nakweyiphi na ikemisti yangasese (ngendleko zakho)\n\nBhala *passport* ukufumana ilinki onokuyibonisa ekemisti.`,
          af: `💊 *Voorskrif*\n\nGebaseer op jou ${labResult.test_type} resultate is jy voorgeskryf:\n\n*${prescription_medication}*${prescription_dosage ? '\n' + prescription_dosage : ''}${prescription_duration ? ' · ' + prescription_duration : ''}${prescription_quantity ? '\nHoeveelheid: ' + prescription_quantity : ''}\n\nJy kan dit afhaal by:\n• Jou kliniek apteek (gratis)\n• Enige privaat apteek (op jou koste)\n\nTik *passport* vir 'n skakel om aan die apteker te wys.`,
        };
        await sendWhatsAppMessage(labResult.patient_phone, rxMsg[lang] || rxMsg['en']);

        // CCMDD bridging message — if patient is on CCMDD and prescription involves a chronic condition change
        const ccmddConditions = session.ccmddConditions || session.chronicConditions || [];
        if (ccmddConditions.length > 0) {
          const medLower = prescription_medication.toLowerCase();
          const isChronic = medLower.includes('arv') || medLower.includes('antiretroviral') ||
            medLower.includes('amlodipine') || medLower.includes('enalapril') || medLower.includes('hydrochlorothiazide') ||
            medLower.includes('metformin') || medLower.includes('glimepiride') || medLower.includes('insulin') ||
            medLower.includes('atenolol') || medLower.includes('simvastatin') || medLower.includes('aspirin') ||
            medLower.includes('carbamazepine') || medLower.includes('valproate') || medLower.includes('phenytoin') ||
            medLower.includes('salbutamol') || medLower.includes('beclomethasone') || medLower.includes('fluticasone') ||
            (prescription_duration && (prescription_duration.toLowerCase().includes('ongoing') || prescription_duration.toLowerCase().includes('chronic') || prescription_duration.toLowerCase().includes('indefinite')));

          if (isChronic) {
            const ccmddMsg = {
              en: `⚠️ *Important — CCMDD / Dablapmeds*\n\nYour chronic medication has been changed. Please note:\n\n1. Your *next CCMDD parcel may still contain your old medication*. Collect it anyway — do not stop taking your meds.\n2. Show this message to the pharmacist at your pickup point so they can note the change.\n3. Your clinic will submit the updated script to CCMDD. The new medication will be in your *following* parcel.\n\nIf you have questions, visit your clinic or type *0* to start a new consultation.`,
              zu: `⚠️ *Okubalulekile — CCMDD / Dablapmeds*\n\nUmuthi wakho wamahlalakhona ushintshiwe. Sicela wazi:\n\n1. *Iphakethe lakho elilandelayo le-CCMDD lingase libe nomuthi omdala*. Liwuthathe noma kunjalo — ungayeki ukuthatha umuthi.\n2. Khombisa lo myalezo ekhemisi endaweni yakho yokuthatha ukuze baqaphele ushintsho.\n3. Umtholampilo wakho uzothumela iskripthi esibuyekeziwe ku-CCMDD. Umuthi omusha uzoba *ephaketheni elilandelayo*.\n\nUma unemibuzo, vakashela umtholampilo wakho noma ubhale *0*.`,
              xh: `⚠️ *Okubalulekileyo — CCMDD / Dablapmeds*\n\nAmayeza akho aqhelekileyo atshintshiwe. Nceda wazi:\n\n1. *Ipasile yakho elandelayo ye-CCMDD inokuba isamayeza amadala*. Yithathe noko — musa ukuyeka ukuthatha amayeza.\n2. Bonisa lo myalezo kwikemisti kwindawo yakho yokuthatha ukuze baqaphele utshintsho.\n3. Ikliniki yakho iza kuthumela iskripthi esibuyekeziweyo ku-CCMDD. Amayeza amatsha aza kuba *kwipasile elandelayo*.\n\nUkuba unemibuzo, tyelela ikliniki yakho okanye ubhale *0*.`,
              af: `⚠️ *Belangrik — CCMDD / Dablapmeds*\n\nJou chroniese medikasie is verander. Let asseblief:\n\n1. Jou *volgende CCMDD-pakkie mag nog die ou medikasie bevat*. Haal dit steeds af — moenie ophou met jou medikasie nie.\n2. Wys hierdie boodskap aan die apteker by jou afhaal punt sodat hulle die verandering kan aanteken.\n3. Jou kliniek sal die opgedateerde voorskrif aan CCMDD stuur. Die nuwe medikasie sal in jou *volgende pakkie* wees.\n\nAs jy vrae het, besoek jou kliniek of tik *0*.`,
            };
            await sendWhatsAppMessage(labResult.patient_phone, ccmddMsg[lang] || ccmddMsg['en']);
          }
        }
      }

      res.json({
        success: true,
        message: prescriptionCreated
          ? 'Results ready + prescription sent to patient. They can show it at any pharmacy.'
          : 'Marked as ready and patient notified.',
        prescription_created: prescriptionCreated,
      });
    } else {
      res.json({
        success: true,
        message: 'Marked as ready.' + (prescriptionCreated ? ' Prescription saved.' : '') + ' No phone number — patient not notified.',
        prescription_created: prescriptionCreated,
      });
    }
  } catch (e) {
    logger.error('[LAB-READY] Error:', e.message);
    res.status(500).json({ error: 'Server error' });
  }
});

// GET /api/lab-results/stats — Dashboard statistics
app.get('/api/lab-results/stats', requireDashboardAuth, async (req, res) => {
  try {
    const { data: all } = await supabase.from('lab_results').select('result_status, patient_notified');

    const stats = {
      total: all ? all.length : 0,
      pending: all ? all.filter(r => r.result_status === 'pending').length : 0,
      ready: all ? all.filter(r => r.result_status === 'ready').length : 0,
      notified: all ? all.filter(r => r.patient_notified === true).length : 0,
      not_notified: all ? all.filter(r => r.result_status === 'ready' && !r.patient_notified).length : 0,
    };

    res.json(stats);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ================================================================
// PRESCRIPTIONS — Recorded by nurse/doctor, displayed on passport
// The tool does NOT prescribe. It records what a licensed human prescribed.
// ================================================================

// GET /api/prescriptions — List prescriptions for a patient
app.get('/api/prescriptions', requireDashboardAuth, async (req, res) => {
  try {
    const { patient_id, status } = req.query;
    if (!patient_id) return res.status(400).json({ error: 'patient_id required' });
    let q = supabase.from('prescriptions').select('*')
      .eq('patient_id', patient_id)
      .order('prescribed_at', { ascending: false }).limit(20);
    if (status) q = q.eq('status', status);
    const { data, error } = await q;
    if (error) throw error;
    res.json({ prescriptions: data || [] });
  } catch (e) {
    res.status(500).json({ error: 'Server error' });
  }
});

// POST /api/prescriptions — Nurse/doctor records a prescription
app.post('/api/prescriptions', requireDashboardAuth, async (req, res) => {
  try {
    const { patient_id, medication, dosage, duration, quantity, notes } = req.body;
    if (!patient_id || !medication) {
      return res.status(400).json({ error: 'patient_id and medication are required' });
    }

    const entry = {
      patient_id,
      medication: medication.trim(),
      dosage: dosage || null,
      duration: duration || null,
      quantity: quantity || null,
      prescribed_by: req.user?.display_name || 'staff',
      facility_name: req.user?.facility_name || null,
      notes: notes || null,
      status: 'active',
      prescribed_at: new Date().toISOString(),
      created_at: new Date().toISOString(),
    };

    const { data, error } = await supabase.from('prescriptions').insert(entry).select().single();
    if (error) throw error;

    await logAudit(req, 'ADD_PRESCRIPTION', patient_id, {
      medication: entry.medication,
      dosage: entry.dosage,
      prescribed_by: entry.prescribed_by,
    });

    res.json({ success: true, prescription: data });
  } catch (e) {
    logger.error('[PRESCRIPTION] Create error:', e.message);
    res.status(500).json({ error: 'Server error' });
  }
});

// PUT /api/prescriptions/:id — Update status (complete, cancel)
app.put('/api/prescriptions/:id', requireDashboardAuth, async (req, res) => {
  try {
    const { status, notes } = req.body;
    await supabase.from('prescriptions')
      .update({ status: status || 'active', notes: notes || undefined })
      .eq('id', req.params.id);
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ error: 'Server error' });
  }
});

// ================================================================
// FAST-PATH ORCHESTRATION + SA CONTEXT ROUTER
// ================================================================
// buildFastPathGreeting — combined category picker shown after consent.
// Replaces the old 13-step onboarding for new patients.
function buildFastPathGreeting(lang) {
  const msgs = {
    en: `🏥 *BIZUSIZO*\n\nWhat is your main problem today?\n\n1 — Breathing / Chest pain\n2 — Head / Headache\n3 — Pregnancy\n4 — Bleeding / Wound\n5 — Fever / Flu / Cough\n6 — Stomach / Vomiting\n7 — Child illness\n8 — Chronic medication\n9 — Bone / Joint / Back\n10 — Mental health\n11 — Rash / Skin\n12 — Other`,
    zu: `🏥 *BIZUSIZO*\n\nNgubani inkinga yakho eyinhloko namuhla?\n\n1 — Ukuphefumula / Isifuba\n2 — Ikhanda / Ikhanda elihlungu\n3 — Ukukhulelwa\n4 — Ukuphuma igazi / Isilosha\n5 — Umkhuhlane / Umkhuhlane wezibhobo\n6 — Isisu / Ukuhlanza\n7 — Isifo sengane\n8 — Umuthi wamahlalakhona\n9 — Amathambo / Amalunga / Umhlane\n10 — Impilo yengqondo\n11 — Ulubu / Isikhumba\n12 — Okunye`,
    xh: `🏥 *BIZUSIZO*\n\nYintoni ingxaki yakho ephambili namhlanje?\n\n1 — Ukuphefumla / Isifuba\n2 — Intloko / Intloko ebuhlungu\n3 — Ukukhulelwa\n4 — Ukuphuma igazi / Inxeba\n5 — Umkhuhlane / Umkhuhlane omncane\n6 — Isisu / Ukuhlanza\n7 — Isifo somntwana\n8 — Amayeza aqhelekileyo\n9 — Amathambo / Amalungu / Umqolo\n10 — Impilo yengqondo\n11 — Isifo sesikhumba\n12 — Okunye`,
    af: `🏥 *BIZUSIZO*\n\nWat is jou hoofprobleem vandag?\n\n1 — Asem / Borspyn\n2 — Kop / Hoofpyn\n3 — Swangerskap\n4 — Bloeding / Wond\n5 — Koors / Griep / Hoes\n6 — Maag / Braking\n7 — Kindsiekte\n8 — Chroniese medikasie\n9 — Been / Gewrig / Rug\n10 — Geestesgesondheid\n11 — Uitslag / Vel\n12 — Ander`,
    nso: `🏥 *BIZUSIZO*\n\nGo bohlokwa ke eng lehono?\n\n1 — Go phefola / Sehuba\n2 — Hlogo / Hlogo e bohloko\n3 — Go ima\n4 — Go šea madi / Ntšhapelo\n5 — Mohlabi / Mokgathala\n6 — Mala / Go hlanza\n7 — Bolwetši bja ngwana\n8 — Dihlare tša go dulela\n9 — Maokolwana / Maoto / Mokolo\n10 — Bophelo bja monagano\n11 — Letlalo\n12 — Tše dingwe`,
    tn: `🏥 *BIZUSIZO*\n\nGo botlhokwa ke eng gompieno?\n\n1 — Go phema / Sehuba\n2 — Tlhogo / Tlhogo e e bohloko\n3 — Go ima\n4 — Go tshologa madi / Ntshwao\n5 — Mogote / Mathamo\n6 — Mala / Go ruwa\n7 — Bolwetsi jwa ngwana\n8 — Dimelemo tsa go nnela ruri\n9 — Marapo / Maoto / Mhaka\n10 — Bophelo jwa mogopolo\n11 — Letlalo\n12 — Tse dingwe`,
    st: `🏥 *BIZUSIZO*\n\nHo bohlokwa ke eng kajeno?\n\n1 — Ho phefumoloha / Sehuba\n2 — Hlogo / Hlogo e bohloko\n3 — Ho ima\n4 — Ho tsholola madi / Ntshapelo\n5 — Phoholo / Mathamo\n6 — Mala / Ho ruwa\n7 — Bolwetsi ba ngwana\n8 — Meriana ya mahlale\n9 — Marapo / Maoto / Mhaka\n10 — Bophelo ba monnahano\n11 — Letlalo\n12 — Tse ling`,
    ts: `🏥 *BIZUSIZO*\n\nNtirho lowu wa nkoka sweswi i wuhi?\n\n1 — Ku hema / Sifuba\n2 — Rixaka / Rixaka leri buhasaka\n3 — Ku taka\n4 — Ku phuma ngati / Ntshapeto\n5 — Fivha / Mathamo\n6 — Mimba / Ku hlanza\n7 — Vuvabyi bya nwana\n8 — Mirhi ya vurhongo\n9 — Maboko / Milenge / Mhaka\n10 — Rihanyo ra miehleketo\n11 — Nhlambela\n12 — Swin\'wana`,
    ss: `🏥 *BIZUSIZO*\n\nKuyini inkinga yakho lebalulekile namuhla?\n\n1 — Ukuphefumula / Isifuba\n2 — Ikhanda / Ikhanda lelihlungu\n3 — Ukukhulelwa\n4 — Kuphuma igazi / Lilondze\n5 — Umkhuhlane / Umkhuhlane\n6 — Isisu / Kukhuphuka\n7 — Sifo sengane\n8 — Imitsi yesikhashana\n9 — Ematsanjeni / Tinyawo / Umhlane\n10 — Impilo yengcondvo\n11 — Ulubu / Sikhumba\n12 — Okunye`,
    ve: `🏥 *BIZUSIZO*\n\nTshikhala tshi re ndi tshipenekelo tshine tsha u ḓivhadzea ndi tshifhio namusi?\n\n1 — U hema / Sifuba\n2 — Ṱhoho / Ṱhoho ye i khou rema\n3 — U vhiwa\n4 — Madi u bva / Ntshavhelo\n5 — Fivha / Tshikhukhuma\n6 — Thumbu / U vhumba\n7 — Vhulwadze ha mwana\n8 — Mishonga ya vhulwadze\n9 — Mahunzi / Milenzhe / Muvhele\n10 — Mutakalo wa muhumbulo\n11 — Ṱhoho ya muvhili\n12 — Zwiṅwe`,
    nr: `🏥 *BIZUSIZO*\n\nKuyini inkinga yakho ebalulekile namuhla?\n\n1 — Ukuphefumula / Isifuba\n2 — Ikhanda / Ikhanda elibuhlungu\n3 — Ukukhulelwa\n4 — Ukuphuma igazi / Lilondze\n5 — Umkhuhlane / Umkhuhlane\n6 — Isisu / Ukukhupuka\n7 — Isifo sengane\n8 — Imitjhoga yesikhathi eside\n9 — Amathambo / Amalunga / Umhlane\n10 — Impilo yengqondo\n11 — Ulubu / Isikhumba\n12 — Okunye`,
  };
  return msgs[lang] || msgs['en'];
}

// isClinicOpenNow — SA PHC hours: Mon–Fri 07:00–16:00 SAST
function isClinicOpenNow() {
  const now = new Date();
  const sast = new Date(now.getTime() + (2 * 60 * 60 * 1000));
  const hour = sast.getUTCHours();
  const day = sast.getUTCDay();
  return (day >= 1 && day <= 5 && hour >= 7 && hour < 16);
}

// saContextRouter — translates triage colour into a SA-appropriate action.
// Ambulance is the last resort, not the first instruction.
function saContextRouter(triage, session, nearbyFacilities) {
  const level = triage.triage_level;
  const clinicOpen = isClinicOpenNow();
  const nearestClinic = nearbyFacilities?.clinics?.[0] || null;
  const nearestCHC = nearbyFacilities?.chcs?.[0] || null;
  const nearestHospital = nearbyFacilities?.hospitals?.[0] || null;
  const nearestUrgent = nearestCHC || nearestHospital || nearestClinic;
  const isNearby = (nearestUrgent?.distance || 999) <= 15;
  const lang = session.language || 'en';

  if (level === 'RED') {
    const facility = nearestHospital;
    const hours = facility ? getFacilityHoursStr(facility) : '';
    const hoursLine = hours ? `\n🕐 ${hours}` : '';
    const dest = facility ? `*${facility.name}* (${facility.distance} km)${hoursLine}\n${facility.address || ''}` : 'the nearest hospital emergency unit';
    const msgs = {
      en: `🔴 *EMERGENCY — Act NOW*\n\n🏥 ${dest}\n\n*Go there immediately.* Ask someone to drive you. If no transport, call *10177* for an ambulance.\n\nDo NOT wait. Every minute counts.`,
      zu: `🔴 *IPHUTHUMAZELA — Yenza MANJE*\n\n🏥 ${dest}\n\n*Yiya khona manje.* Cela umuntu akushayele. Uma kungekho into yokushayela, shaya *10177*.\n\nUngalindi. Imizuzu ibalulekile.`,
      xh: `🔴 *INGXAKI YEZEMPILO — Yenza NGOKU*\n\n🏥 ${dest}\n\n*Yiya khona ngoku.* Cela umntu akuqhubele. Ukuba akukho nto yokuhamba, tsalela *10177*.\n\nMusa ukulinda. Imizuzu ibalulekile.`,
      af: `🔴 *NOODGEVAL — Tree NOU op*\n\n🏥 ${dest}\n\n*Gaan dadelik daarheen.* Vra iemand om jou te ry. As geen vervoer, bel *10177*.\n\nMoenie wag nie. Elke minuut tel.`,
    };
    return { action: 'red_emergency', logPathway: 'emergency_red', facilityType: 'hospital', immediateAction: msgs[lang] || msgs['en'] };
  }

  if (level === 'ORANGE') {
    const facility = nearestUrgent;
    const hours = facility ? getFacilityHoursStr(facility) : '';
    const hoursLine = hours ? `\n🕐 ${hours}` : '';
    const dest = facility ? `*${facility.name}* (${facility.distance} km)${hoursLine}` : 'the nearest clinic or hospital';
    const msgs = {
      en: `🟠 *VERY URGENT*\n\nYou need to be seen *today — within the next hour* if possible.\n\n🏥 Go to: ${dest}\n\nAsk a family member or neighbour for a lift, or take a taxi now. Do not wait until tomorrow.\n\n❗ If you feel too sick to travel or your symptoms get worse, call *10177*.`,
      zu: `🟠 *KUPHUTHUMA KAKHULU*\n\nUdinga ukuhlolwa *namuhla — ngaphakathi nehora* uma kunokwenzeka.\n\n🏥 Ya ku: ${dest}\n\nCela umuntu ekhaya noma umakhelwane akushayele, noma thatha itekisi manje. Ungalindi kuze kube kusasa.\n\n❗ Uma uzizwa ugula kakhulu ukuhamba noma izimpawu ziba zimbi, shaya *10177*.`,
      xh: `🟠 *KUNGXAMISEKILE KAKHULU*\n\nUfuna ukuhlolwa *namhlanje — ngaphakathi kweyure* ukuba kunokwenzeka.\n\n🏥 Yiya ku: ${dest}\n\nCela umfazi wasekhaya okanye ummelwane akuqhubele, okanye thatha itaxi ngoku. Musa ukulinda de kube ngomso.\n\n❗ Ukuba uziva ugula kakhulu ukuhamba okanye iimpawu ziba mbi, tsalela *10177*.`,
      af: `🟠 *BAIE DRINGEND*\n\nJy moet *vandag — binne die volgende uur* gesien word.\n\n🏥 Gaan na: ${dest}\n\nVra 'n familielid of buurman vir 'n skoenlapper, of vat nou 'n taxi. Moenie tot môre wag nie.\n\n❗ As jy te siek voel om te reis of simptome vererger, bel *10177*.`,
    };
    return { action: 'orange_urgent', logPathway: 'orange_go_to_facility', facilityType: nearestCHC ? 'chc' : 'hospital', immediateAction: msgs[lang] || msgs['en'], followUp: 'ask_transport_safety' };
  }

  if (level === 'YELLOW') {
    if (!clinicOpen && nearestCHC) {
      const chcHours = getFacilityHoursStr(nearestCHC);
      const dest = `*${nearestCHC.name}* (${nearestCHC.distance} km)\n🕐 ${chcHours}`;
      const msgs = {
        en: `🟡 *URGENT — Clinic is closed*\n\nYour symptoms need attention today.\n\n🏥 Go to: ${dest}\n\nTake a taxi or ask for a lift now. If symptoms get much worse, call *10177*.`,
        zu: `🟡 *IPHUTHUMAYO — Umtholampilo uvaliwe*\n\nIzimpawu zakho zidinga ukunakwa namuhla.\n\n🏥 Ya ku: ${dest}\n\nThatha itekisi noma ucele ukushayiwa manje. Uma izimpawu ziba zimbi kakhulu, shaya *10177*.`,
        xh: `🟡 *IYAPHUTHASWA — Ikliniki ivaliwe*\n\nIimpawu zakho zifuna ukunyangwa namhlanje.\n\n🏥 Yiya ku: ${dest}\n\nThatha itaxi okanye ucele ukuqhutywa ngoku. Ukuba iimpawu ziba mbi kakhulu, tsalela *10177*.`,
        af: `🟡 *DRINGEND — Kliniek is gesluit*\n\nJou simptome benodig aandag vandag.\n\n🏥 Gaan na: ${dest}\n\nNeem 'n taxi of vra vir 'n skoenlapper nou. As simptome baie erger word, bel *10177*.`,
      };
      return { action: 'yellow_after_hours_chc', logPathway: 'yellow_chc', facilityType: 'chc', immediateAction: msgs[lang] || msgs['en'] };
    }
    return { action: 'yellow_clinic_today', logPathway: 'yellow_clinic_today', facilityType: 'clinic', immediateAction: null };
  }

  return { action: 'green_self_care', logPathway: 'green', facilityType: 'clinic', immediateAction: null };
}

// ================================================================
// FAST-PATH ORCHESTRATION — FULL INTEGRATION
// ================================================================

// ── handleFastPath ──────────────────────────────────────────────
// Drives the 3-step triage flow for new/incomplete patients.
// Returns true if it handled the message, false to fall through.
async function handleFastPath(patientId, from, message, session, lang) {
  const needsFastPath = !session.identityDone || !session.consent;
  if (!needsFastPath) return false;

  // Phase 2 identity collection in progress (after triage done)
  if (session.fastPathDone && session.phase2Step) {
    await handlePhase2(patientId, from, message, session, lang);
    return true;
  }

  if (!session.language) return false;

  // STEP 1: Show category menu (already handled at consent, but
  // catch any edge-case where fastPathStarted is not yet set)
  if (!session.fastPathStarted) {
    session.fastPathStarted = true;
    session.fastPathStartedAt = new Date().toISOString();
    await sessionLib.saveSession(patientId, session);
    await sendWhatsAppMessage(from, buildFastPathGreeting(lang));
    return true;
  }

  // STEP 2: Category selection
  if (session.fastPathStarted && !session.fastPathCategoryDone) {
    const categoryMap = {
      '1': 'Breathing / Chest pain', '2': 'Head injury / Headache',
      '3': 'Pregnancy', '4': 'Bleeding / Wound', '5': 'Fever / Flu / Cough',
      '6': 'Stomach / Vomiting', '7': 'Child illness', '8': 'Chronic medication',
      '9': 'Bone / Joint / Back', '10': 'Mental health', '11': 'Rash / Skin',
      '12': 'Other',
    };

    if (!categoryMap[message]) {
      if (!session.fastPathCategoryRetry) {
        session.fastPathCategoryRetry = true;
        await sessionLib.saveSession(patientId, session);
        await sendWhatsAppMessage(from, buildFastPathGreeting(lang));
        return true;
      }
      // Second non-answer — treat as free-text symptom description
      session.fastPathCategoryDone = true;
      session.selectedCategory = '12';
      session.fastPathRawText = message;
      await sessionLib.saveSession(patientId, session);
      await conductFastPathTriage(patientId, from, message, session, lang);
      return true;
    }

    session.selectedCategory = message;
    session.fastPathCategoryDone = true;
    session.fastPathCategoryRetry = false;
    await sessionLib.saveSession(patientId, session);

    // Chronic medication: enrolment check → stable vs unwell check
    if (message === '8') {
      await sendWhatsAppMessage(from, buildFastPathChronicEnrolment(lang));
      session.fastPathAwaitingChronicEnrolment = true;
      await sessionLib.saveSession(patientId, session);
      return true;
    }

    // Antenatal visit tracking: gestational age + visit type for pregnancy patients
    if (message === '3') {
      await sendWhatsAppMessage(from, buildANCScreening(lang));
      session.fastPathAwaitingANC = true;
      await sessionLib.saveSession(patientId, session);
      return true;
    }

    // IMCI-aligned child assessment: structured danger sign screening for under-5s
    if (message === '7') {
      await sendWhatsAppMessage(from, buildIMCIDangerSignCheck(lang));
      session.fastPathAwaitingIMCI = true;
      await sessionLib.saveSession(patientId, session);
      return true;
    }

    // PHQ-2 depression screening for mental health (category 10)
    if (message === '10') {
      await sendWhatsAppMessage(from, buildPHQ2Screening(lang));
      session.fastPathAwaitingPHQ2 = true;
      await sessionLib.saveSession(patientId, session);
      return true;
    }

    await sendWhatsAppMessage(from, buildFastPathSymptomAsk(lang, categoryMap[message]));
    session.fastPathAwaitingSymptom = true;
    await sessionLib.saveSession(patientId, session);
    return true;
  }

  // Antenatal screening response
  if (session.fastPathAwaitingANC) {
    session.fastPathAwaitingANC = false;

    if (message === '1') {
      // Routine ANC visit — ask gestational age
      session.ancVisitType = 'routine';
      const gestMsg = {
        en: '🤰 How many *weeks* pregnant are you? (e.g. 16, 28, 36)\n\nIf you are not sure, type *unsure*.',
        zu: '🤰 Unamaviki amangaki *ukhulelwe*? (isb. 16, 28, 36)\n\nUma ungaqinisekile, bhala *unsure*.',
        xh: '🤰 Uneeveki ezingaphi *ukhulelwe*? (umz. 16, 28, 36)\n\nUkuba awuqinisekanga, bhala *unsure*.',
        af: '🤰 Hoeveel *weke* is jy swanger? (bv. 16, 28, 36)\n\nAs jy nie seker is nie, tik *unsure*.',
      };
      await sendWhatsAppMessage(from, gestMsg[lang] || gestMsg['en']);
      session.fastPathAwaitingGestAge = true;
      await sessionLib.saveSession(patientId, session);
      return true;
    } else if (message === '2') {
      // New concern — proceed to symptom description with pregnancy context
      session.ancVisitType = 'new_concern';
      await sendWhatsAppMessage(from, buildFastPathSymptomAsk(lang, 'Pregnancy — new concern'));
      session.fastPathAwaitingSymptom = true;
      await sessionLib.saveSession(patientId, session);
      return true;
    } else if (message === '4') {
      // Supplements only — route to pharmacy queue, bypass consultation
      session.ancVisitType = 'supplements_only';
      session.lastTriage = { triage_level: 'GREEN', confidence: 95, source: 'anc_supplements' };
      session.lastSymptoms = 'Antenatal supplements collection only — no consultation needed';
      session.lastPathway = 'anc_supplements_only';

      const suppMsg = {
        en: '💊 *Antenatal Supplements Collection*\n\nYou will be directed to the *pharmacy queue* — no need to wait for a consultation.\n\n📋 Please bring:\n• Maternity case record\n• ID document\n\nIf you have any new concerns, type *0* to start a new consultation.',
        zu: '💊 *Ukuthatha Ama-supplements Okukhulelwa*\n\nUzodluliselwa *emugceni wekhemisi* — akudingeki ulinde ukubonana.\n\n📋 Letha:\n• Ikhadi lomama\n• Incwadi yesazisi\n\nUma unezinkinga ezintsha, bhala *0*.',
        xh: '💊 *Ukuthatha Ii-supplements Zokukhulelwa*\n\nUza kuthunyelwa *kumgca wekemisti* — akukho mfuneko yokulinda ukubonana.\n\n📋 Zisa:\n• Irekhodi yomama\n• Isazisi\n\nUkuba unengxaki entsha, bhala *0*.',
        af: '💊 *Voorgeboorte Supplemente Afhaal*\n\nJy sal na die *apteektop* verwys word — nie nodig om vir konsultasie te wag nie.\n\n📋 Bring:\n• Kraamgevalleboek\n• ID-dokument\n\nAs jy nuwe bekommernisse het, tik *0*.',
      };
      await sendWhatsAppMessage(from, suppMsg[lang] || suppMsg['en']);

      await sessionLib.logTriage({
        patient_id: patientId,
        triage_level: 'GREEN',
        confidence: 95,
        escalation: false,
        pathway: 'anc_supplements_only',
        symptoms: 'Antenatal supplements collection — pharmacy fast-track',
      });

      // Proceed to facility routing
      session.pendingTriage = true;
      session.fastPathDone = true;
      await sessionLib.saveSession(patientId, session);

      if (session.location) {
        const nearestFacilities = await facilitiesLib.findNearestFacilities(session.location, 'clinic', 3);
        if (nearestFacilities.length > 0) {
          session.suggestedFacility = nearestFacilities[0];
          session.alternativeFacilities = nearestFacilities.slice(1);
          session.awaitingFacilityConfirm = true;
          session.pendingTriage = false;
          await sessionLib.saveSession(patientId, session);
          await sendFacilitySuggest(from, lang, nearestFacilities[0], 'GREEN');
          return true;
        }
      }
      await sendWhatsAppMessage(from, msg('request_location', lang));
      return true;
    } else if (message === '3') {
      // Emergency — inject pregnancy emergency context and triage immediately
      session.ancVisitType = 'emergency';
      const enriched = 'Category: Pregnancy. EMERGENCY: Patient reports pregnancy emergency — bleeding, severe pain, or reduced baby movement. Pregnancy emergencies must be triaged as ORANGE minimum.';
      await sessionLib.saveSession(patientId, session);
      await conductFastPathTriage(patientId, from, enriched, session, lang);
      return true;
    }
    // Invalid — default to symptom ask
    await sendWhatsAppMessage(from, buildFastPathSymptomAsk(lang, 'Pregnancy'));
    session.fastPathAwaitingSymptom = true;
    await sessionLib.saveSession(patientId, session);
    return true;
  }

  // Gestational age response
  if (session.fastPathAwaitingGestAge) {
    session.fastPathAwaitingGestAge = false;
    const weeks = parseInt(message);

    if (!isNaN(weeks) && weeks >= 1 && weeks <= 44) {
      session.gestationalWeeks = weeks;
      session.trimester = weeks <= 12 ? 1 : weeks <= 28 ? 2 : 3;
      session.estimatedDueDate = new Date(Date.now() + (40 - weeks) * 7 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
    } else {
      session.gestationalWeeks = null;
      session.trimester = null;
      session.estimatedDueDate = null;
    }

    // Determine next ANC visit based on SA DoH schedule
    // SA: booking visit, then 20w, 26-28w, 32-34w, 36w, 38w, 40w
    const ancSchedule = [14, 20, 26, 32, 36, 38, 40];
    let nextANCWeek = null;
    if (weeks) {
      nextANCWeek = ancSchedule.find(w => w > weeks) || 40;
    }

    // Route to facility for routine ANC
    session.lastTriage = { triage_level: 'GREEN', confidence: 95, source: 'anc_routine' };
    session.lastSymptoms = `Routine ANC visit — ${weeks ? weeks + ' weeks gestation (trimester ' + session.trimester + ')' : 'gestational age unknown'}`;
    session.lastPathway = 'anc_routine';

    const routineMsg = {
      en: `🤰 *Routine Antenatal Visit*\n\n${weeks ? `You are *${weeks} weeks* pregnant (trimester ${session.trimester}).` : 'Gestational age noted.'}\n\n📋 Please bring:\n• Maternity case record (antenatal card)\n• ID document\n• Urine sample (first morning urine)\n\n${nextANCWeek && weeks ? `📅 Your next scheduled ANC visit: around *${nextANCWeek} weeks*.` : ''}\n\nYou will be directed to the *maternal queue* — no need to wait in the general line.`,
      zu: `🤰 *Ukuvakashela Kwejwayelekile Kokukhulelwa*\n\n${weeks ? `Unkhulelwe amaviki angu-*${weeks}* (trimester ${session.trimester}).` : 'Amaviki okukhulelwa aqoshiwe.'}\n\n📋 Letha:\n• Ikhadi lomama (ikhadi lokukhulelwa)\n• Incwadi yesazisi\n• Isampula yomchamo (ekuseni)\n\n${nextANCWeek && weeks ? `📅 Ukuvakashela kwakho okulandelayo: amaviki angu-*${nextANCWeek}*.` : ''}\n\nUzodluliselwa *emugceni wabomama* — akudingeki ulinde emgceni ojwayelekile.`,
      xh: `🤰 *Utyelelo Oluqhelekileyo Lokukhulelwa*\n\n${weeks ? `Ukhulelwe iiveki ezingu-*${weeks}* (trimester ${session.trimester}).` : 'Iiveki zokukhulelwa zibhaliwe.'}\n\n📋 Zisa:\n• Irekhodi yomama (ikhadi lokukhulelwa)\n• Isazisi\n• Isampulu yomchamo (kusasa)\n\n${nextANCWeek && weeks ? `📅 Utyelelo lwakho olulandelayo: iiveki ezingu-*${nextANCWeek}*.` : ''}\n\nUza kuthunyelwa *kumgca wabomama* — akukho mfuneko yokulinda kumgca oqhelekileyo.`,
      af: `🤰 *Roetine Voorgeboorte Besoek*\n\n${weeks ? `Jy is *${weeks} weke* swanger (trimester ${session.trimester}).` : 'Swangerskap weke genoteer.'}\n\n📋 Bring saam:\n• Kraamgevalleboek (voorgeboortekaart)\n• ID-dokument\n• Urienmonster (eerste oggend)\n\n${nextANCWeek && weeks ? `📅 Jou volgende geskeduleerde besoek: omtrent *${nextANCWeek} weke*.` : ''}\n\nJy sal na die *moedertou* verwys word — nie nodig om in die algemene ry te wag nie.`,
    };
    await sendWhatsAppMessage(from, routineMsg[lang] || routineMsg['en']);

    // Schedule next ANC reminder if we know gestational age
    if (nextANCWeek && weeks && session.phone) {
      const weeksUntilNext = nextANCWeek - weeks;
      if (weeksUntilNext > 0 && weeksUntilNext <= 20) {
        const reminderDate = new Date(Date.now() + (weeksUntilNext - 1) * 7 * 24 * 60 * 60 * 1000);
        reminderDate.setHours(6, 30, 0, 0);
        await supabase.from('follow_ups').insert({
          patient_id: patientId,
          phone: from,
          triage_level: 'GREEN',
          scheduled_at: reminderDate,
          status: 'pending',
          type: 'anc_visit_reminder',
          data: JSON.stringify({
            gestational_weeks_at_reminder: nextANCWeek,
            trimester: nextANCWeek <= 12 ? 1 : nextANCWeek <= 28 ? 2 : 3,
          }),
        }).catch(e => logger.error('[ANC] Reminder schedule failed:', e.message));
      }
    }

    // Log triage and proceed to facility routing
    await sessionLib.logTriage({
      patient_id: patientId,
      triage_level: 'GREEN',
      confidence: 95,
      escalation: false,
      pathway: 'anc_routine',
      symptoms: session.lastSymptoms,
    });

    // Proceed to facility suggestion (same flow as chronic bypass)
    session.pendingTriage = true;
    session.fastPathDone = true;
    await sessionLib.saveSession(patientId, session);

    // If location is available, suggest facility
    if (session.location) {
      const nearestFacilities = await facilitiesLib.findNearestFacilities(session.location, 'clinic', 3);
      if (nearestFacilities.length > 0) {
        session.suggestedFacility = nearestFacilities[0];
        session.alternativeFacilities = nearestFacilities.slice(1);
        session.awaitingFacilityConfirm = true;
        session.pendingTriage = false;
        await sessionLib.saveSession(patientId, session);
        await sendFacilitySuggest(from, lang, nearestFacilities[0], 'GREEN');
        return true;
      }
    }
    await sendWhatsAppMessage(from, msg('request_location', lang));
    return true;
  }

  // IMCI danger sign response — structured child assessment
  if (session.fastPathAwaitingIMCI) {
    session.fastPathAwaitingIMCI = false;
    const imciDangerSigns = [];

    // Parse comma-separated or space-separated selections
    const selections = message.replace(/[, ]+/g, ',').split(',').map(s => s.trim());

    if (selections.includes('0') || message.toLowerCase() === 'none' || message === '0') {
      // No danger signs — proceed to symptom description
      session.imciDangerSigns = [];
      session.imciResult = 'no_danger_signs';
      await sendWhatsAppMessage(from, buildFastPathSymptomAsk(lang, 'Child illness'));
      session.fastPathAwaitingSymptom = true;
      await sessionLib.saveSession(patientId, session);
      return true;
    }

    const dangerSignMap = {
      '1': 'not_drinking_breastfeeding',
      '2': 'vomiting_everything',
      '3': 'convulsions',
      '4': 'lethargic_unconscious',
      '5': 'chest_indrawing',
      '6': 'stridor',
    };

    for (const s of selections) {
      if (dangerSignMap[s]) imciDangerSigns.push(dangerSignMap[s]);
    }

    session.imciDangerSigns = imciDangerSigns;

    if (imciDangerSigns.length > 0) {
      // IMCI danger signs present → immediate RED/ORANGE triage
      // Convulsions or lethargic/unconscious = RED; others = ORANGE minimum
      const isRed = imciDangerSigns.includes('convulsions') || imciDangerSigns.includes('lethargic_unconscious');
      const triageLevel = isRed ? 'RED' : 'ORANGE';
      session.imciResult = 'danger_signs_detected';

      // Build enriched symptom text for AI triage with IMCI context
      const dangerLabels = {
        not_drinking_breastfeeding: 'not able to drink or breastfeed',
        vomiting_everything: 'vomits everything',
        convulsions: 'has had convulsions',
        lethargic_unconscious: 'lethargic or unconscious',
        chest_indrawing: 'chest indrawing (severe pneumonia sign)',
        stridor: 'stridor when calm (airway obstruction sign)',
      };
      const dangerStr = imciDangerSigns.map(d => dangerLabels[d] || d).join(', ');
      const enriched = `Category: Child illness. IMCI DANGER SIGNS PRESENT: ${dangerStr}. Child requires URGENT referral. Minimum triage: ${triageLevel}.`;

      session.fastPathDone = false;
      await sessionLib.saveSession(patientId, session);
      await conductFastPathTriage(patientId, from, enriched, session, lang);
      return true;
    }

    // Invalid input — ask for symptom description
    session.imciDangerSigns = [];
    session.imciResult = 'no_danger_signs';
    await sendWhatsAppMessage(from, buildFastPathSymptomAsk(lang, 'Child illness'));
    session.fastPathAwaitingSymptom = true;
    await sessionLib.saveSession(patientId, session);
    return true;
  }

  // PHQ-2 depression screening response
  if (session.fastPathAwaitingPHQ2) {
    session.fastPathAwaitingPHQ2 = false;

    // PHQ-2 scoring: each question scored 0-3
    // Q1: feeling down (message first digit), Q2: lost interest (message second digit)
    // Total 0-2 = unlikely depression, 3-6 = possible depression → enrich triage context
    const parts = message.replace(/[, ]+/g, ',').split(',').map(s => parseInt(s.trim()));
    const q1 = parts[0];
    const q2 = parts.length > 1 ? parts[1] : null;

    let phq2Score = 0;
    let phq2Context = '';

    if (!isNaN(q1) && q1 >= 0 && q1 <= 3) {
      phq2Score += q1;
      if (q2 !== null && !isNaN(q2) && q2 >= 0 && q2 <= 3) {
        phq2Score += q2;
      }
    }

    session.phq2Score = phq2Score;

    if (phq2Score >= 3) {
      // PHQ-2 positive — likely depression, enrich triage context
      phq2Context = `PHQ-2 POSITIVE (score ${phq2Score}/6): Patient reports feeling down and/or loss of interest most days. Screen for depression — may need doctor referral for antidepressant initiation (fluoxetine/citalopram per SA STG).`;
      session.phq2Result = 'positive';
      session.needsDoctorForMeds = true; // Flag for doctor referral — nurses can't initiate antidepressants
    } else {
      phq2Context = `PHQ-2 negative (score ${phq2Score}/6): Low risk for depression based on screening. Proceed with symptom assessment.`;
      session.phq2Result = 'negative';
    }

    // Proceed to symptom description with PHQ-2 context enrichment
    await sendWhatsAppMessage(from, buildFastPathSymptomAsk(lang, 'Mental health'));
    session.fastPathAwaitingSymptom = true;
    session.phq2Context = phq2Context;
    await sessionLib.saveSession(patientId, session);
    return true;
  }

  // Chronic enrolment response — distinguishes known programme patient from new symptomatic patient
  if (session.fastPathAwaitingChronicEnrolment) {
    session.fastPathAwaitingChronicEnrolment = false;
    if (message === '1') {
      // Already enrolled — proceed to stable/unwell check
      session.chronicEnrolmentStatus = 'enrolled';
      await sendWhatsAppMessage(from, buildFastPathChronicCheck(lang));
      session.fastPathAwaitingChronicStatus = true;
      await sessionLib.saveSession(patientId, session);
      return true;
    } else if (message === '2') {
      // New symptoms suggestive of chronic condition — skip pharmacy fast-track,
      // go straight to symptom description → full AI triage → clinician review
      session.chronicEnrolmentStatus = 'new_symptoms';
      session.lastPathway = 'chronic_new_symptoms'; // Prevents pharmacy fast-track
      const newSymptomMsg = {
        en: '📋 *New Symptoms*\n\nYou are not yet on a chronic programme. We will assess your symptoms and guide you to the right care.\n\nPlease describe what you are experiencing:',
        zu: '📋 *Izimpawu Ezintsha*\n\nAwukabi ehlwini lohlelo lwesifo esingapheli. Sizokugula izimpawu zakho sikuqondise ekunakekelweni okufanele.\n\nSicela uchaze ukuthi uzizwa kanjani:',
        xh: '📋 *Iimpawu Ezintsha*\n\nAwukabi kwinkqubo yesifo esingapheliyo. Siza kuhlola iimpawu zakho sikukhokele kwindlela efanelekileyo.\n\nNceda uchaze ukuba uziva njani:',
        af: '📋 *Nuwe Simptome*\n\nJy is nog nie op \'n chroniese program nie. Ons sal jou simptome evalueer en jou na die regte sorg lei.\n\nBeskryf asseblief wat jy ervaar:',
        nso: '📋 *Dika tše Mpsha*\n\nGa o eso be lenaneo la bolwetši bjo bo sa folego. Re tla sekaseka dika tša gago re go laetše tlhokomelong ye e nepagetsego.\n\nHle hlaloša se o se ikwago:',
        tn: '📋 *Matshwao a Masha*\n\nGa o eso nne mo lenaneong la bolwetse jo bo sa foleng. Re tla sekaseka matshwao a gago re go kaele kwa tlhokomelong e e siameng.\n\nTlhalosa se o se utlwang:',
        st: '📋 *Matshwao a Matjha*\n\nHa o eso be lenaneong la bolwetse bo sa foleng. Re tla hlahloba matshwao a hao re o etele tlhokomelong e nepahetseng.\n\nHlalosa seo o se utlwang:',
        ts: '📋 *Swikombiso swa Ntshwa*\n\nA wu si va eka nongonoko wa vuvabyi byo bu nga heleko. Hi ta kambela swikombiso swa wena hi ku kongomisa eka vuhlayiseki byo fanela.\n\nHlamusela leswi u switwisaka:',
        ss: '📋 *Timphawu Letinsha*\n\nAwukabi ehlwini lohlelo lwesifo lesingezeleki. Sitawuhlola timphawu takho sikucondzise ekunakekeleni lokufanele.\n\nChaza kutsi utiva njani:',
        ve: '📋 *Zwiga Zwiswa*\n\nA ni athu vha kha mbekanyamushumo ya vhulwadze vhu sa folaho. Ri ḓo ṱolisisa zwiga zwaṋu ri ni livhisa kha vhulafhi vhu fanelaho.\n\nṬalutshedza zwe na zwi pfa:',
        nr: '📋 *Iimphawu Ezintsha*\n\nAwukabi ehlwini lohlelo lwesifo esingapheli. Sizokuhlola iimphawu zakho sikukhombise ekunakekeleni okufanele.\n\nChaza kutsi utiva njani:',
      };
      await sendWhatsAppMessage(from, newSymptomMsg[lang] || newSymptomMsg['en']);
      session.fastPathAwaitingSymptom = true;
      await sessionLib.saveSession(patientId, session);
      return true;
    }
    // Invalid input — treat as enrolled (safe default)
    session.chronicEnrolmentStatus = 'enrolled';
    await sendWhatsAppMessage(from, buildFastPathChronicCheck(lang));
    session.fastPathAwaitingChronicStatus = true;
    await sessionLib.saveSession(patientId, session);
    return true;
  }

  // Chronic status response (enrolled patient: stable vs unwell)
  if (session.fastPathAwaitingChronicStatus) {
    session.fastPathAwaitingChronicStatus = false;
    if (message === '1') {
      // Stable — bypass triage, route directly to medication collection question
      session.fastPathDone = true;
      session.lastTriage = { triage_level: 'GREEN', confidence: 95, source: 'chronic_bypass' };
      session.lastSymptoms = 'Stable chronic patient — medication collection (DoH fast-track bypass)';
      session.lastPathway = 'chronic_bypass_stable';
      session.awaitingChronicCollectionType = true;
      await sessionLib.saveSession(patientId, session);
      const chronicBypassMsg = {
        en: '💊 *Chronic Medication Collection*\n\nYou are stable.\n\nWhere do you collect your medication?\n1 — At a clinic\n2 — At a pharmacy\n3 — Other (community point, delivery)',
        zu: '💊 *Ukuthatha Umuthi Wamahlalakhona*\n\nUzinzile.\n\nUwuthatha kuphi umuthi wakho?\n1 — Emtholampilo\n2 — Ekhemisi\n3 — Kwenye indawo (umphakathi, ukulethwa)',
        xh: '💊 *Ukuthatha Amayeza Aqhelekileyo*\n\nUzinzile.\n\nUwathatha phi amayeza akho?\n1 — Ekliniki\n2 — Ekemisti\n3 — Kwenye indawo (umphakathi, ukunikezelwa)',
        af: '💊 *Chroniese Medikasie Afhaal*\n\nJy is stabiel.\n\nWaar haal jy jou medikasie af?\n1 — By \'n kliniek\n2 — By \'n apteek\n3 — Ander (gemeenskapspunt, aflewering)',
      };
      await sendWhatsAppMessage(from, chronicBypassMsg[lang] || chronicBypassMsg['en']);
      return true;
    }
    await sendWhatsAppMessage(from, buildFastPathSymptomAsk(lang, 'Chronic condition — not feeling well'));
    session.fastPathAwaitingSymptom = true;
    await sessionLib.saveSession(patientId, session);
    return true;
  }

  // STEP 3: Symptom description → run triage
  if (session.fastPathAwaitingSymptom) {
    session.fastPathAwaitingSymptom = false;
    await sessionLib.saveSession(patientId, session);
    const categoryName = CATEGORY_DESCRIPTIONS[session.selectedCategory] || 'Other';
    const phq2Info = session.phq2Context ? ` ${session.phq2Context}` : '';
    const enriched = `Category: ${categoryName}.${phq2Info} Patient says: ${message}`;
    await conductFastPathTriage(patientId, from, enriched, session, lang);
    return true;
  }

  return false;
}


// ── conductFastPathTriage ────────────────────────────────────────
// Runs triage, delivers result, fires pre-arrival alert, starts Phase 2.
async function conductFastPathTriage(patientId, from, symptomText, session, lang) {
  await sendWhatsAppMessage(from, msg('thinking', lang));

  const triageSessionCtx = {
    patientId,
    age: session.dob?.age || session.patientAge || null,
    chronicConditions: session.chronicConditions || [],
    isPregnant: session.selectedCategory === '3',
    priorHistory: await triageLib.getPatientHistory(patientId),
  };

  const govResult = await governance.runTriageWithGovernance(
    symptomText, lang, session,
    (text, l) => triageLib.runTriage(text, l, triageSessionCtx),
    triageLib.applyClinicalRules
  );
  const triage = govResult.triage;

  // Handle triage rate limit
  if (triage?.rateLimited) {
    await sendWhatsAppMessage(from, msg('rate_limited', lang));
    return;
  }

  session.lastTriage = triage;
  session.lastSymptoms = symptomText;
  session.triageCompleted = true;
  session.triageCompletedAt = new Date().toISOString();
  session.fastPathDone = true;
  await sessionLib.saveSession(patientId, session);

  // Resolve nearby facilities for routing
  let nearbyFacilities = { clinics: [], hospitals: [], chcs: [] };
  if (session.location) {
    const [clinics, hospitals, chcs] = await Promise.all([
      findNearestFacilities(session.location, 'clinic', 3).catch(() => []),
      findNearestFacilities(session.location, 'hospital', 2).catch(() => []),
      findNearestFacilities(session.location, 'chc', 2).catch(() => []),
    ]);
    nearbyFacilities = { clinics, hospitals, chcs };
  }

  const routing = saContextRouter(triage, session, nearbyFacilities);

  await deliverTriageResult(patientId, from, triage, routing, session, lang, symptomText);

  // Mental health: show SADAG helpline + flag PHQ-2 result for nurse review
  if (session.selectedCategory === '10') {
    // If PHQ-2 positive → flag on pre-arrival alert and queue notes for NURSE to see.
    // Nurse must assess clinically FIRST, then decide whether to refer to doctor.
    // We do NOT tell the patient they need a doctor — the nurse makes that call.
    if (session.phq2Result === 'positive') {
      const onMentalHealthMeds = (session.chronicConditions || []).some(c => c.key === 'mental_health');
      // Store the flag on session so it appears in pre-arrival alert and queue entry
      session.phq2DoctorFlag = !onMentalHealthMeds;
      session.lastSymptoms = (session.lastSymptoms || '') + ' [PHQ-2 POSITIVE: score ' + (session.phq2Score || '?') + '/6' + (!onMentalHealthMeds ? ' — NOT on antidepressants, may need doctor for initiation per STG' : ' — already on mental health medication') + ']';
      await sessionLib.saveSession(patientId, session);
    }
    const sadagMsg = {
      en: `📞 *Mental Health Support*\n\nYou are not alone. Free, confidential help is available 24/7:\n\n• *SADAG:* 0800 567 567 (free)\n• *Suicide Crisis Line:* 0800 567 567\n• *SMS:* 31393 (for callback)\n\nYou can also WhatsApp BIZUSIZO anytime by typing *0*.`,
      zu: `📞 *Usizo Lwengqondo*\n\nAwuwedwa. Usizo lwamahhala, oluyimfihlo lutholakala 24/7:\n\n• *SADAG:* 0800 567 567 (mahhala)\n• *Umugqa wokuzihlaba:* 0800 567 567\n• *SMS:* 31393 (ukuze ubuyiselwe)\n\nUngakhuluma ne-BIZUSIZO noma nini ngokubhala *0*.`,
      xh: `📞 *Uncedo Lwengqondo*\n\nAwuwedwa. Uncedo olungabhatalwayo, oluyimfihlo lufumaneka 24/7:\n\n• *SADAG:* 0800 567 567 (simahla)\n• *Umgca wokuzibulala:* 0800 567 567\n• *SMS:* 31393 (ufowunelwe)\n\nUngathetha ne-BIZUSIZO nanini na ngokubhala *0*.`,
      af: `📞 *Geestesgesondheid Ondersteuning*\n\nJy is nie alleen nie. Gratis, vertroulike hulp is 24/7 beskikbaar:\n\n• *SADAG:* 0800 567 567 (gratis)\n• *Selfdood Krisislyn:* 0800 567 567\n• *SMS:* 31393 (vir terugbel)\n\nJy kan enige tyd met BIZUSIZO gesels deur *0* te tik.`,
    };
    await sendWhatsAppMessage(from, sadagMsg[lang] || sadagMsg['en']);
  }

  await sessionLib.logTriage({
    patient_id: patientId,
    triage_level: triage.triage_level,
    confidence: triage.confidence,
    escalation: false,
    pathway: routing.logPathway || 'fast_path',
    facility_name: routing.facility?.name || null,
    location: session.location || null,
    symptoms: symptomText,
    governance: {
      rule_override: triage.rule_override || null,
      discriminator_matched: triage.discriminator_matched || null,
      icd10: triage.icd10 || null,
    }
  });

  // Fire pre-arrival alert to clinic dashboard
  await sendPreArrivalAlert(patientId, triage, routing, session, nearbyFacilities);

  // Syndromic surveillance — check for outbreak signals after every triage
  outbreak.checkOutbreakAfterTriage(patientId, triage, session);

  // Start Phase 2 identity collection (non-RED patients only)
  if (triage.triage_level !== 'RED') {
    await startPhase2(patientId, from, session, lang);
  } else {
    session.phase2Step = 'pending_after_red';
    await sessionLib.saveSession(patientId, session);
    await followup.schedulePhase2FollowUp(patientId, from, 30);
  }
}


// ── deliverTriageResult ──────────────────────────────────────────
// Sends the correct message sequence for each triage colour.
async function deliverTriageResult(patientId, from, triage, routing, session, lang, symptomText) {
  const level = triage.triage_level;

  if (level === 'RED') {
    // Split RED into two pathways based on the discriminator that fired:
    // IMMEDIATE (life-threat, cannot travel): call 10177 NOW, ambulance to patient
    // URGENT-FACILITY (serious but conscious/mobile): go to nearest facility, nurse confirms, nurse calls EMS if needed
    const immediateLifeThreat = [
      'respiratory_cardiac_arrest', 'unconscious', 'active_seizure',
      'neonatal_apnoea', 'anaphylaxis', 'traumatic_haemorrhage', 'severe_burns',
      'paediatric_unconscious',
    ];
    // Include language-variant rule names (e.g. respiratory_cardiac_arrest_zu)
    const ruleOverride = triage.rule_override || triage.discriminator_matched || '';
    const baseRule = ruleOverride.replace(/_[a-z]{2}$/, ''); // Strip language suffix
    const isImmediateLifeThreat = immediateLifeThreat.includes(baseRule)
      || immediateLifeThreat.some(r => ruleOverride.startsWith(r));

    if (isImmediateLifeThreat) {
      // ── IMMEDIATE: Patient cannot travel safely — call 10177, ambulance to their location ──
      await sendWhatsAppMessage(from, msg('triage_red', lang));
      if (routing.immediateAction) await sendWhatsAppMessage(from, routing.immediateAction);
    } else {
      // ── URGENT-FACILITY: Patient conscious/mobile — go to nearest facility for nurse assessment ──
      // Nurse confirms triage, stabilises, calls 10177 from clinic if ambulance transfer needed
      const urgentFacilityMsg = {
        en: `🔴 *URGENT — Go to your nearest clinic or hospital NOW*\n\nYour symptoms need urgent medical attention. Please go to the nearest clinic or hospital emergency unit *immediately*.\n\n🏥 Tell the nurse at reception: "I was triaged as RED by BIZUSIZO."\n\nThe nurse will assess you, confirm your urgency, and arrange further care or ambulance transfer if needed.\n\n📞 If you cannot get there safely, or if your condition gets worse while travelling, call *10177* for an ambulance.\n\n⚠️ Do NOT wait at home — go now.`,
        zu: `🔴 *KUPHUTHUMA — Yana emtholampilo noma esibhedlela esiseduze MANJE*\n\nIzimpawu zakho zidinga ukunakwa kwezempilo okuphuthumayo. Sicela uye emtholampilo noma ewodini yeziphuthumayo *ngokushesha*.\n\n🏥 Tshela unesi e-reception: "Ngihlolwe njenge-RED yi-BIZUSIZO."\n\nUnesi uzokuhlola, aqinisekise ukuphuthuma kwakho, ahlele ukunakekelwa noma ukudluliswa nge-ambulensi uma kudingeka.\n\n📞 Uma ungakwazi ukufika ngokuphepha, noma isimo sakho siba sibi endleleni, shaya *10177*.\n\n⚠️ UNGALINDI ekhaya — hamba manje.`,
        xh: `🔴 *KUNGXAMISEKILE — Yiya ekliniki okanye esibhedlele esikufutshane NGOKU*\n\nIimpawu zakho zidinga inyango engxamisekileyo. Nceda uye ekliniki okanye kwicandelo lezongxamiseko *ngokukhawuleza*.\n\n🏥 Xelela umongikazi kwi-reception: "Ndihlolwe njenge-RED yi-BIZUSIZO."\n\nUmongikazi uza kukuhlola, aqinisekise ukungxamiseka kwakho, ahlele unyango okanye ukuhanjiswa nge-ambulensi.\n\n📞 Ukuba awukwazi ukufika ngokukhuselekileyo, okanye imeko yakho iya isiba mbi, tsalela *10177*.\n\n⚠️ MUSA UKULINDA ekhaya — hamba ngoku.`,
        af: `🔴 *DRINGEND — Gaan na jou naaste kliniek of hospitaal NOU*\n\nJou simptome benodig dringende mediese aandag. Gaan asseblief na die naaste kliniek of hospitaal noodafdeling *dadelik*.\n\n🏥 Sê vir die verpleegster by ontvangs: "Ek is as ROOI getrieer deur BIZUSIZO."\n\nDie verpleegster sal jou assesseer, die dringendheid bevestig, en verdere sorg of ambulansvervoer reël indien nodig.\n\n📞 As jy nie veilig daar kan kom nie, of as jou toestand vererger, bel *10177*.\n\n⚠️ MOENIE tuis wag nie — gaan nou.`,
      };
      await sendWhatsAppMessage(from, urgentFacilityMsg[lang] || urgentFacilityMsg['en']);
      if (routing.immediateAction) await sendWhatsAppMessage(from, routing.immediateAction);

      // Route to nearest facility — these patients CAN travel
      if (routing.facility) {
        session.suggestedFacility = routing.facility;
        session.alternativeFacilities = routing.alternatives || [];
        session.awaitingFacilityConfirm = true;
        await sessionLib.saveSession(patientId, session);
        await sendFacilitySuggest(from, lang, routing.facility, 'RED');
      } else if (!session.location) {
        session.pendingTriage = true;
        await sessionLib.saveSession(patientId, session);
        await sendWhatsAppMessage(from, msg('request_location', lang));
      }
    }

    await sessionLib.scheduleFollowUp(patientId, from, 'RED');
    return;
  }

  if (level === 'ORANGE') {
    await sendWhatsAppMessage(from, msg('triage_orange', lang));
    if (routing.immediateAction) await sendWhatsAppMessage(from, routing.immediateAction);
    session.awaitingTransportSafety = true;
    session.lastTriage = triage;
    session.lastSymptoms = symptomText;
    await sessionLib.saveSession(patientId, session);
    await sendWhatsAppMessage(from, msg('ask_transport_safety', lang));
    return;
  }

  // ── GBV / Sexual Assault Pathway ──
  // Overrides standard ORANGE/YELLOW flow when abuse_assault or gbv_sexual_assault is detected
  if (triage.rule_override === 'gbv_sexual_assault' || triage.rule_override === 'abuse_assault') {
    const isRape = triage.rule_override === 'gbv_sexual_assault';

    const gbvMsg = {
      en: `🟠 *${isRape ? 'URGENT: SEXUAL ASSAULT SUPPORT' : 'SUPPORT AVAILABLE'}*\n\n` +
        `What happened to you is not your fault. Help is available right now.\n\n` +
        (isRape ? `⏰ *TIME-SENSITIVE — please act within 72 hours:*\n` +
          `• HIV prevention medication (PEP) must start within *72 hours*\n` +
          `• Emergency contraception is available within *120 hours (5 days)*\n` +
          `• A forensic examination can collect evidence to support your case\n\n` +
          `🚫 *Important — do NOT:*\n` +
          `• Wash or shower\n` +
          `• Change your clothes\n` +
          `• Eat, drink, or brush teeth (if oral assault)\n` +
          `These preserve evidence that can help you.\n\n` : '') +
        `🏥 *Where to go:*\n` +
        `Go to a *Thuthuzela Care Centre (TCC)* — these are safe, 24-hour centres at hospitals with trained staff, counsellors, and police officers in one place.\n\n` +
        `📞 *Get help now:*\n` +
        `• GBV Command Centre: *0800 428 428* (free, 24/7)\n` +
        `• Childline: *116* (if under 18)\n` +
        `• SAPS Emergency: *10111*\n` +
        `• Ambulance: *10177*\n\n` +
        `👮 *At the police station:*\n` +
        `• You have the right to open a case\n` +
        `• Ask for a *case number* — you will need it\n` +
        `• You can request a female officer\n` +
        `• The police must take you to a hospital or TCC for examination\n\n` +
        `You do not have to face this alone. Would you like help finding the nearest Thuthuzela Care Centre?\n` +
        `1 — Yes, find nearest TCC\n` +
        `2 — I will go on my own`,

      zu: `🟠 *${isRape ? 'OKUPHUTHUMAYO: USIZO LOKUHLUKUNYEZWA NGOKOCANSI' : 'USIZO LUYATHOLAKALA'}*\n\n` +
        `Okwenzekile akusona isiphosiso sakho. Usizo lukhona manje.\n\n` +
        (isRape ? `⏰ *KUNESIKHATHI — sicela wenze ngaphakathi kwamahora angu-72:*\n` +
          `• Umuthi wokuvimbela i-HIV (PEP) kumele uqale ngaphakathi *kwamahora angu-72*\n` +
          `• Umuthi wokuvimbela ukukhulelwa utholakala ngaphakathi *kwamahora angu-120 (izinsuku ezinhlanu)*\n` +
          `• Ukuhlolwa kwezomthetho kungatholela ubufakazi\n\n` +
          `🚫 *Okubalulekile — UNGAKWENZI:*\n` +
          `• Ukugeza noma ukushawa\n` +
          `• Ukushintsha izingubo\n` +
          `• Ukudla, ukuphuza, noma ukuxubha amazinyo\n` +
          `Lokhu kugcina ubufakazi obungakusiza.\n\n` : '') +
        `🏥 *Lapho okumelwe uye khona:*\n` +
        `Yana e-*Thuthuzela Care Centre (TCC)* — lezi yizindawo eziphephile, ezivulwe amahora angu-24 ezibhedlela ezinabasebenzi abaqeqeshiwe, abeluleki, namaphoyisa ndawonye.\n\n` +
        `📞 *Thola usizo manje:*\n` +
        `• GBV Command Centre: *0800 428 428* (mahhala, 24/7)\n` +
        `• Childline: *116* (uma ungaphansi kweminyaka engu-18)\n` +
        `• SAPS: *10111*\n` +
        `• Ambulensi: *10177*\n\n` +
        `Awudingi ukubhekana nalokhu wedwa. Ungathanda usizo lokuthola i-TCC eseduze?\n` +
        `1 — Yebo\n` +
        `2 — Ngizoya ngedwa`,

      xh: `🟠 *${isRape ? 'NGOKUKHAWULEZA: UNCEDO LOKUHLUKUNYEZWA NGOKWESONDO' : 'UNCEDO LUYAFUMANEKA'}*\n\n` +
        `Okwenzekileyo asikokuphosisa kwakho. Uncedo lukho ngoku.\n\n` +
        (isRape ? `⏰ *KUNEXESHA — nceda wenze ngaphakathi kweeyure ezingama-72:*\n` +
          `• Amayeza okuthintela i-HIV (PEP) kufuneka aqale ngaphakathi *kweeyure ezingama-72*\n` +
          `• Amayeza okuthintela ukukhulelwa afumaneka ngaphakathi *kweeyure ezili-120*\n\n` +
          `🚫 *Okubalulekileyo — MUSA:*\n` +
          `• Ukuhlamba okanye ukushawara\n` +
          `• Ukutshintsha iimpahla\n` +
          `• Ukutya, ukusela, okanye ukuxukuxa amazinyo\n\n` : '') +
        `🏥 *Apho kufuneka uye khona:*\n` +
        `Yiya kwi-*Thuthuzela Care Centre (TCC)*.\n\n` +
        `📞 *Fumana uncedo ngoku:*\n` +
        `• GBV Command Centre: *0800 428 428* (simahla, 24/7)\n` +
        `• Childline: *116*\n` +
        `• SAPS: *10111*\n` +
        `• Ambulensi: *10177*\n\n` +
        `Awudingi ukujongana noku wedwa. Ungathanda uncedo lokufumana i-TCC ekufutshane?\n` +
        `1 — Ewe\n` +
        `2 — Ndiza kuya ndedwa`,

      af: `🟠 *${isRape ? 'DRINGEND: ONDERSTEUNING VIR SEKSUELE AANRANDING' : 'ONDERSTEUNING BESKIKBAAR'}*\n\n` +
        `Wat met jou gebeur het, is nie jou skuld nie. Hulp is nou beskikbaar.\n\n` +
        (isRape ? `⏰ *TYDSENSITIEF — tree asseblief binne 72 uur op:*\n` +
          `• HIV-voorkomende medikasie (PEP) moet binne *72 uur* begin\n` +
          `• Noodvoorbehoeding is beskikbaar binne *120 uur (5 dae)*\n` +
          `• 'n Forensiese ondersoek kan bewyse versamel\n\n` +
          `🚫 *Belangrik — MOENIE:*\n` +
          `• Was of stort nie\n` +
          `• Klere verander nie\n` +
          `• Eet, drink of tande borsel nie\n` +
          `Dit bewaar bewyse wat jou kan help.\n\n` : '') +
        `🏥 *Waarheen om te gaan:*\n` +
        `Gaan na 'n *Thuthuzela Care Centre (TCC)* — dit is veilige, 24-uur sentrums by hospitale.\n\n` +
        `📞 *Kry nou hulp:*\n` +
        `• GBV Opdragsentrum: *0800 428 428* (gratis, 24/7)\n` +
        `• Childline: *116*\n` +
        `• SAPS: *10111*\n` +
        `• Ambulans: *10177*\n\n` +
        `Jy hoef dit nie alleen te hanteer nie. Wil jy hulp hê om die naaste TCC te vind?\n` +
        `1 — Ja\n` +
        `2 — Ek sal self gaan`,
    };

    await sendWhatsAppMessage(from, gbvMsg[lang] || gbvMsg.en);

    // Flag session for TCC routing if they choose "1"
    session.awaitingTCCChoice = true;
    session.gbvType = isRape ? 'sexual_assault' : 'domestic_violence';
    await sessionLib.saveSession(patientId, session);

    // Standard follow-up
    await sessionLib.scheduleFollowUp(patientId, from, isRape ? 'ORANGE' : 'YELLOW');

    // GBV-specific follow-ups — sensitive, PEP-aware, welfare-focused
    if (isRape) {
      try {
        // 3 days: PEP adherence + emotional welfare
        await supabase.from('follow_ups').insert({
          patient_id: patientId, phone: from, triage_level: 'ORANGE',
          scheduled_at: new Date(Date.now() + 3 * 24 * 60 * 60 * 1000),
          status: 'pending', type: 'gbv_pep_check_3d',
        });
        // 7 days: PEP side effects + still taking?
        await supabase.from('follow_ups').insert({
          patient_id: patientId, phone: from, triage_level: 'ORANGE',
          scheduled_at: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
          status: 'pending', type: 'gbv_pep_check_7d',
        });
        // 28 days: PEP course completion + STI/pregnancy follow-up reminder
        await supabase.from('follow_ups').insert({
          patient_id: patientId, phone: from, triage_level: 'ORANGE',
          scheduled_at: new Date(Date.now() + 28 * 24 * 60 * 60 * 1000),
          status: 'pending', type: 'gbv_pep_completion',
        });
      } catch (e) { logger.error('[GBV] Follow-up scheduling failed:', e.message); }
    } else {
      // Domestic violence: welfare check at 7 days
      try {
        await supabase.from('follow_ups').insert({
          patient_id: patientId, phone: from, triage_level: 'YELLOW',
          scheduled_at: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
          status: 'pending', type: 'gbv_welfare_check',
        });
      } catch (e) { /* non-critical */ }
    }
    return;
  }

  if (level === 'YELLOW') {
    await sendWhatsAppMessage(from, msg('triage_yellow', lang));
    if (routing.immediateAction) await sendWhatsAppMessage(from, routing.immediateAction);
    await sessionLib.scheduleFollowUp(patientId, from, 'YELLOW');

    // After-hours check — don't send YELLOW patients to a closed clinic
    if (!isClinicOpen()) {
      // Stagger morning slots to avoid everyone arriving at 07:00
      let slotTime = '07:00';
      try {
        const tmrw = new Date();
        tmrw.setDate(tmrw.getDate() + 1);
        tmrw.setHours(0, 0, 0, 0);
        const tmrwEnd = new Date(tmrw);
        tmrwEnd.setHours(23, 59, 59, 999);
        const { data: tmrwPats } = await supabase
          .from('follow_ups')
          .select('id')
          .eq('type', 'morning_reminder')
          .eq('status', 'pending')
          .gte('scheduled_at', tmrw.toISOString())
          .lte('scheduled_at', tmrwEnd.toISOString());
        const count = (tmrwPats || []).length;
        const slots = ['07:00', '08:00', '09:00', '10:00'];
        slotTime = slots[Math.min(Math.floor(count / 10), slots.length - 1)];
      } catch (e) { /* use default 07:00 */ }

      const nextDay = getNextClinicDay();
      const afterHoursMsg = {
        en: `⏰ Clinics are closed now.\n\n1. *If manageable* — rest at home, come to the clinic on *${nextDay.label}* at *${slotTime}*\n2. *If symptoms worsen* — go to hospital or call *10177*\n\nWe will send you a reminder on *${nextDay.label}* morning.`,
        zu: `⏰ Imitholampilo ivaliwe manje.\n\n1. *Uma kubekezeleka* — phumula ekhaya, woza emtholampilo ngo-*${nextDay.label}* ngo-*${slotTime}*\n2. *Uma izimpawu ziba zimbi* — yana esibhedlela noma ushaye *10177*\n\nSizokuthumelela isikhumbuzo ngo-*${nextDay.label}* ekuseni.`,
        xh: `⏰ Iikliniki zivaliwe ngoku.\n\n1. *Ukuba zinokumelana nazo* — phumla ekhaya, yiza ekliniki ngo-*${nextDay.label}* nge-*${slotTime}*\n2. *Ukuba iimpawu ziba mbi* — yiya esibhedlele okanye utsalele *10177*\n\nSiza kukuthumela isikhumbuzo ngo-*${nextDay.label}* ekuseni.`,
        af: `⏰ Klinieke is gesluit.\n\n1. *As hanteerbaar* — rus tuis, kom *${nextDay.label}* na die kliniek om *${slotTime}*\n2. *As simptome vererger* — gaan hospitaal toe of bel *10177*\n\nOns stuur *${nextDay.label}* 'n herinnering.`,
      };
      await sendWhatsAppMessage(from, afterHoursMsg[lang] || afterHoursMsg['en']);

      // Schedule morning reminder
      try {
        await supabase.from('follow_ups').insert({
          patient_id: patientId,
          phone: from,
          triage_level: 'YELLOW',
          scheduled_at: nextDay.scheduledAt,
          status: 'pending',
          type: 'morning_reminder',
        });
      } catch (e) { logger.error('[YELLOW_AFTER_HOURS] Morning reminder failed:', e.message); }

      return;
    }

    // During clinic hours — route to facility
    if (routing.facility) {
      session.suggestedFacility = routing.facility;
      session.alternativeFacilities = routing.alternatives || [];
      session.awaitingFacilityConfirm = true;
      await sessionLib.saveSession(patientId, session);
      await sendFacilitySuggest(from, lang, routing.facility, 'YELLOW');
    } else if (!session.location) {
      session.pendingTriage = true;
      await sessionLib.saveSession(patientId, session);
      await sendWhatsAppMessage(from, msg('request_location', lang));
    }
    return;
  }

  // GREEN
  await sendWhatsAppMessage(from, msg('triage_green', lang));
  try {
    const selfCareAdvice = await triageLib.generateSelfCareAdvice(symptomText, lang);
    if (selfCareAdvice) await sendWhatsAppMessage(from, selfCareAdvice);
  } catch (e) { /* non-blocking */ logger.error('[SILENT] Suppressed error in self-care advice:', e.message || 'unknown'); }
  await sessionLib.scheduleFollowUp(patientId, from, 'GREEN');

  // After-hours: auto-schedule morning reminder instead of routing to closed clinic
  if (!isClinicOpen()) {
    // Stagger morning slots — same logic as YELLOW after-hours
    let slotTime = '07:00';
    try {
      const tmrw = new Date();
      tmrw.setDate(tmrw.getDate() + 1);
      tmrw.setHours(0, 0, 0, 0);
      const tmrwEnd = new Date(tmrw);
      tmrwEnd.setHours(23, 59, 59, 999);
      const { data: tmrwPats } = await supabase
        .from('follow_ups')
        .select('id')
        .eq('type', 'morning_reminder')
        .eq('status', 'pending')
        .gte('scheduled_at', tmrw.toISOString())
        .lte('scheduled_at', tmrwEnd.toISOString());
      const count = (tmrwPats || []).length;
      const slots = ['07:00', '08:00', '09:00', '10:00'];
      slotTime = slots[Math.min(Math.floor(count / 10), slots.length - 1)];
    } catch (e) { /* use default 07:00 */ }

    const nextDay = getNextClinicDay();
    const greenAfterHoursMsg = {
      en: `⏰ Clinics are closed now. Your symptoms are not urgent — rest at home tonight.\n\nIf you'd like to visit the clinic, come on *${nextDay.label}* at *${slotTime}*.\n\nIf symptoms worsen, call *10177* or go to your nearest hospital emergency unit.`,
      zu: `⏰ Imitholampilo ivaliwe. Izimpawu zakho aziphuthumi — phumula ekhaya namhlanje ebusuku.\n\nUma ufuna ukuya emtholampilo, woza ngo-*${nextDay.label}* ngo-*${slotTime}*.\n\nUma izimpawu ziba zimbi, shaya *10177* noma yana esibhedlela.`,
      xh: `⏰ Iikliniki zivaliwe. Iimpawu zakho azingxamisekanga — phumla ekhaya ngobu busuku.\n\nUkuba ufuna ukuya ekliniki, yiza ngo-*${nextDay.label}* nge-*${slotTime}*.\n\nUkuba iimpawu ziba mbi, tsalela *10177* okanye uye esibhedlele.`,
      af: `⏰ Klinieke is gesluit. Jou simptome is nie dringend nie — rus tuis vanaand.\n\nAs jy die kliniek wil besoek, kom *${nextDay.label}* om *${slotTime}*.\n\nAs simptome vererger, bel *10177* of gaan na die hospitaal.`,
    };
    await sendWhatsAppMessage(from, greenAfterHoursMsg[lang] || greenAfterHoursMsg['en']);

    // Schedule morning reminder
    try {
      await supabase.from('follow_ups').insert({
        patient_id: patientId, phone: from, triage_level: 'GREEN',
        scheduled_at: nextDay.scheduledAt, status: 'pending', type: 'morning_reminder',
      });
    } catch (e) { /* non-critical */ }
    return;
  }

  // During clinic hours — offer clinic visit
  if (routing.facility) {
    session.suggestedFacility = routing.facility;
    session.alternativeFacilities = routing.alternatives || [];
    session.awaitingFacilityConfirm = true;
    await sessionLib.saveSession(patientId, session);
    await sendFacilitySuggest(from, lang, routing.facility, 'GREEN');
  } else if (!session.location) {
    session.pendingTriage = true;
    await sessionLib.saveSession(patientId, session);
    await sendWhatsAppMessage(from, msg('request_location', lang));
  }
}


// ── Phase 2: Identity collection after triage ────────────────────
// Phase 2 steps — study_consent only included when FEATURES.STUDY_MODE is on (pilot).
// When scaling to production, set STUDY_MODE = false — study consent step is skipped entirely.
const PHASE2_STEPS_WITH_STUDY = ['name', 'surname', 'dob', 'sex', 'chronic', 'study_consent', 'done'];
const PHASE2_STEPS_WITHOUT_STUDY = ['name', 'surname', 'dob', 'sex', 'chronic', 'done'];
const PHASE2_STEPS = FEATURES.STUDY_MODE ? PHASE2_STEPS_WITH_STUDY : PHASE2_STEPS_WITHOUT_STUDY;

async function startPhase2(patientId, from, session, lang) {
  if (session.phase2Step === 'done' || session.identityDone) return;
  session.phase2Step = 'name';
  await sessionLib.saveSession(patientId, session);
  await new Promise(r => setTimeout(r, 1500));
  await sendWhatsAppMessage(from, buildPhase2NameAsk(lang));
}

async function handlePhase2(patientId, from, message, session, lang) {
  const step = session.phase2Step;
  const skip = message.toLowerCase().trim() === 'skip';

  if (step === 'name') {
    if (!skip && message.trim().length >= 2)
      session.firstName = sessionLib.capitalizeName(message.trim().split(/\s+/)[0]);
    session.phase2Step = 'surname';
    await sessionLib.saveSession(patientId, session);
    await sendWhatsAppMessage(from, buildPhase2SurnameAsk(lang, session.firstName));
    return;
  }

  if (step === 'surname') {
    if (!skip && message.trim().length >= 2)
      session.surname = sessionLib.capitalizeName(message.trim().split(/\s+/)[0]);
    session.phase2Step = 'dob';
    await sessionLib.saveSession(patientId, session);
    await sendWhatsAppMessage(from, buildPhase2DobAsk(lang));
    return;
  }

  if (step === 'dob') {
    if (!skip) {
      const parsed = sessionLib.parseDOB(message);
      if (parsed.valid) { session.dob = parsed; session.patientAge = parsed.age; }
    }
    session.phase2Step = 'sex';
    await sessionLib.saveSession(patientId, session);
    await sendWhatsAppMessage(from, buildPhase2SexAsk(lang));
    return;
  }

  if (step === 'sex') {
    const sexMap = { '1': 'female', '2': 'male', 'm': 'male', 'f': 'female',
                     'male': 'male', 'female': 'female', 'woman': 'female', 'man': 'male' };
    if (!skip) session.sex = sexMap[message.toLowerCase().trim()] || null;
    session.phase2Step = 'chronic';
    await sessionLib.saveSession(patientId, session);
    await sendWhatsAppMessage(from, buildPhase2ChronicAsk(lang));
    return;
  }

  if (step === 'chronic') {
    if (!skip && message !== '0') {
      const choices = message.replace(/[, ]+/g, ',').split(',')
        .map(c => c.trim()).filter(c => CONDITION_MAP && CONDITION_MAP[c]);
      if (choices.length > 0) {
        session.chronicConditions = choices.map(c => CONDITION_MAP[c]);
        session.chronicScreeningDone = true;
      }
    } else {
      session.chronicScreeningDone = true;
    }

    if (FEATURES.STUDY_MODE) {
      // Pilot mode: ask about study participation before finishing
      session.phase2Step = 'study_consent';
      await sessionLib.saveSession(patientId, session);
      await sendWhatsAppMessage(from, buildPhase2StudyAsk(lang));
      return;
    }

    // Production mode: skip study consent, generate BZ code, finish
    if (!session.studyCode) {
      const code = await sessionLib.generateStudyCode(patientId);
      session.studyCode = code;
      await sendWhatsAppMessage(from, buildPhase2StudyCodeMsg(lang, code));
    }
    session.consent = true;
    session.identityDone = true;
    session.identity_verified = false;
    session.phase2Step = 'done';

    // Ask returning patient question (same as study_consent path)
    if (session.confirmedFacility || session.suggestedFacility) {
      session.awaitingReturningPatient = true;
      await sessionLib.saveSession(patientId, session);
      await sendWhatsAppMessage(from, buildReturningPatientAsk(lang));
      return;
    }
    await sessionLib.saveSession(patientId, session);
    return;
  }

  if (step === 'study_consent') {
    // STUDY_MODE only — ask if they want to participate in the research study.
    // This step never fires when STUDY_MODE is false.
    if (message === '1') {
      session.isStudyParticipant = true;
      await logConsent(patientId, 'study_consent_given', lang, CONSENT_VERSION,
        { study_code: session.studyCode || null });
    } else {
      session.isStudyParticipant = false;
      await logConsent(patientId, 'study_consent_declined', lang, CONSENT_VERSION);
    }
    // Generate reference code for ALL patients regardless of study consent
    if (!session.studyCode) {
      const code = await sessionLib.generateStudyCode(patientId);
      session.studyCode = code;
      await sendWhatsAppMessage(from, buildPhase2StudyCodeMsg(lang, code));
    }
    session.consent = true;
    session.identityDone = true;
    session.identity_verified = false;
    session.phase2Step = 'done';
    await sessionLib.saveSession(patientId, session);

    // Update pre-arrival alert with identity now available
    await refreshPreArrivalAlert(patientId, session);

    await sendWhatsAppMessage(from, buildReturningPatientAsk(lang));
    session.awaitingReturningPatient = true;
    await sessionLib.saveSession(patientId, session);
    return;
  }
}


// ================================================================
// PATIENT SUMMARY CARD
// Sent at end of triage flow — a portable WhatsApp message the patient
// can show at clinic reception. Addresses two documented SA failure points:
//   • 1,366 patients refused for lacking transfer letters (2023)
//   • 2,083 patients denied care for missing ID documents (2023)
// The card carries name, DOB, triage colour, study code, and facility.
// ================================================================
function buildPatientSummaryCard(lang, session) {
  const code = session.studyCode || null;
  if (!code) return null; // Identity not yet captured — skip silently

  const firstName = session.firstName || '';
  const surname   = session.surname   || '';
  const fullName  = [firstName, surname].filter(Boolean).join(' ') || null;
  const dob       = session.dob?.display || session.dob?.raw || null;
  const age       = session.dob?.age || session.patientAge || null;
  const sex       = session.sex || null;
  const facility  = session.confirmedFacility?.name || null;
  const triage    = session.lastTriage?.triage_level || null;

  const triageEmoji = { RED: '🔴', ORANGE: '🟠', YELLOW: '🟡', GREEN: '🟢' }[triage] || '⬜';
  const sexLabel = sex === 'male'   ? 'Male / Indoda'   :
                   sex === 'female' ? 'Female / Umfazi' : (sex || '');

  const showAtReception = {
    en:  'Show this to reception when you arrive.',
    zu:  'Khombisa i-reception lapho ufika.',
    xh:  'Bonisa i-reception xa ufika.',
    af:  'Wys dit vir ontvangs wanneer jy aankom.',
    nso: 'Bontšha reception ge o fihla.',
    tn:  'Bontsha reception fa o goroga.',
    st:  'Bontsha reception ha o fihla.',
    ts:  'Kombisa reception loko u fika.',
    ss:  'Khombisa reception nawufika.',
    ve:  'Sumbedza reception musi ni tshi swika.',
    nr:  'Khombisa reception nawufikako.',
  };

  const lines = ['📋 *Your BIZUSIZO Reference Card*', '━━━━━━━━━━━━━━━━━'];
  if (fullName)  lines.push(`👤 ${fullName}`);
  if (dob)       lines.push(`📅 ${dob}${age ? ` (age ${age})` : ''}`);
  if (sexLabel)  lines.push(`⚧ ${sexLabel}`);
  if (triage)    lines.push(`${triageEmoji} Triage: *${triage}*`);
  if (facility)  lines.push(`🏥 ${facility}`);
  lines.push(`🔑 Code: *${code}*`);
  lines.push('━━━━━━━━━━━━━━━━━');
  lines.push(showAtReception[lang] || showAtReception['en']);

  // SMS number added dynamically when AT production app is set up
  const smsNumber = process.env.SMS_SHORT_CODE || null;
  const passportTip = smsNumber ? {
    en:  '\n📱 Type *passport* for your full health summary.\nNo data? SMS *' + code + '* to *' + smsNumber + '* to get it free.',
    zu:  '\n📱 Bhala *passport* ukuthola ukufingqwa kwezempilo yakho.\nAwunayo idatha? Thumela *' + code + '* ku-*' + smsNumber + '* mahhala.',
    xh:  '\n📱 Bhala *passport* ukufumana isishwankathelo sakho sezempilo.\nAkunadatha? Thumela *' + code + '* ku-*' + smsNumber + '* simahla.',
    af:  '\n📱 Tik *passport* vir jou gesondheidsopsomming.\nGeen data? SMS *' + code + '* na *' + smsNumber + '* — dis gratis.',
    nso: '\n📱 Ngwala *passport* go hwetša kakaretšo ya maphelo a gago.\nGa o na data? Romela *' + code + '* go *' + smsNumber + '* mahala.',
    tn:  '\n📱 Kwala *passport* go bona kakaretso ya boitekanelo jwa gago.\nGa o na data? Romela *' + code + '* go *' + smsNumber + '* mahala.',
    st:  '\n📱 Ngola *passport* ho fumana kakaretso ya bophelo ba hao.\nHa o na data? Romela *' + code + '* ho *' + smsNumber + '* mahala.',
    ts:  '\n📱 Tsala *passport* ku kuma nkombiso wa rihanyo ra wena.\nA u na data? Rhumela *' + code + '* eka *' + smsNumber + '* mahala.',
    ss:  '\n📱 Bhala *passport* kutfola sifinyeto sempilo yakho.\nAwnayo idatha? Tfumela *' + code + '* ku-*' + smsNumber + '* mahhala.',
    ve:  '\n📱 Ṅwalani *passport* u wana tshoṱhe tsha mutakalo waṋu.\nA ni na data? Rumelani *' + code + '* kha *' + smsNumber + '* mahala.',
    nr:  '\n📱 Tlola *passport* ukuthola iqoqo lepilo yakho.\nAwunayo idatha? Thumela *' + code + '* ku-*' + smsNumber + '* mahala.',
  } : {
    en:  '\n📱 Type *passport* anytime to get your full health summary.',
    zu:  '\n📱 Bhala *passport* noma nini ukuthola ukufingqwa kwezempilo yakho.',
    xh:  '\n📱 Bhala *passport* nanini na ukufumana isishwankathelo sakho sezempilo.',
    af:  '\n📱 Tik *passport* enige tyd vir jou volle gesondheidsopsomming.',
    nso: '\n📱 Ngwala *passport* nako efe go hwetša kakaretšo ya maphelo a gago.',
    tn:  '\n📱 Kwala *passport* nako nngwe go bona kakaretso ya boitekanelo jwa gago.',
    st:  '\n📱 Ngola *passport* nako efe ho fumana kakaretso ya bophelo ba hao.',
    ts:  '\n📱 Tsala *passport* nkarhi wun\'wana ku kuma nkombiso wa rihanyo ra wena.',
    ss:  '\n📱 Bhala *passport* nanoma nini kutfola sifinyeto sempilo yakho.',
    ve:  '\n📱 Ṅwalani *passport* tshifhinga tshiṅwe u wana tshoṱhe tsha mutakalo waṋu.',
    nr:  '\n📱 Tlola *passport* nanoma nini ukuthola iqoqo lepilo yakho.',
  };
  lines.push(passportTip[lang] || passportTip['en']);

  return lines.join('\n');
}

async function sendPatientSummaryCard(from, lang, session) {
  const card = buildPatientSummaryCard(lang, session);
  if (!card) return;
  try {
    await sendWhatsAppMessage(from, card);
  } catch (e) {
    logger.error('[SUMMARY_CARD] Failed to send:', e.message);
  }
}

// ── Facility hours helper ─────────────────────────────────────────
// getFacilityHoursStr, sendFacilitySuggest extracted to lib/facilities.js

// ── Pre-arrival alert system ─────────────────────────────────────
async function sendPreArrivalAlert(patientId, triage, routing, session, nearbyFacilities) {
  if (session.preArrivalAlerted) return;

  const level = triage.triage_level;
  const facility = routing.facility ||
    nearbyFacilities?.clinics?.[0] ||
    nearbyFacilities?.chcs?.[0] ||
    nearbyFacilities?.hospitals?.[0];

  if (!facility) return;

  const distanceKm = facility.distance || 5;
  const estimatedMinutes = estimateArrivalMinutes(distanceKm, level);
  const estimatedArrivalAt = new Date(Date.now() + estimatedMinutes * 60000);
  session.estimatedArrivalAt = estimatedArrivalAt.toISOString();

  const { data: priorTriages } = await supabase
    .from('triage_logs').select('id').eq('patient_id', patientId).limit(2);
  const isNewPatient = !priorTriages || priorTriages.length <= 1;

  const alertPriority = (level === 'RED' || level === 'ORANGE') ? 'URGENT' :
    level === 'YELLOW' ? 'SOON' : 'ROUTINE';

  // Fetch allergies for the pre-arrival alert — nurse needs to know before patient arrives
  let allergyWarning = null;
  try {
    const { data: allergies } = await supabase
      .from('patient_allergies')
      .select('allergen, severity, reaction')
      .eq('patient_id', patientId)
      .eq('active', true);
    if (allergies && allergies.length > 0) {
      allergyWarning = allergies.map(a =>
        `${a.allergen}${a.severity === 'life_threatening' || a.severity === 'severe' ? ' (⚠️ ' + a.severity + ')' : ''}${a.reaction ? ' → ' + a.reaction : ''}`
      ).join('; ');
    }
  } catch (e) { /* non-critical */ }

  const alertData = {
    patient_id: patientId,
    alert_type: 'pre_arrival',
    priority: alertPriority,
    triage_level: level,
    triage_confidence: triage.confidence,
    rule_override: triage.rule_override || null,
    discriminator_matched: triage.discriminator_matched || null,
    facility_name: facility.name,
    estimated_arrival_at: estimatedArrivalAt.toISOString(),
    estimated_minutes: estimatedMinutes,
    is_new_patient: isNewPatient,
    patient_name: (session.firstName && session.surname)
      ? `${session.firstName} ${session.surname}`
      : (session.firstName || null),
    patient_age: session.dob?.age || session.patientAge || null,
    patient_sex: session.sex || null,
    chronic_conditions: (session.chronicConditions || []).map(c => c.label_en || c).join(', ') || null,
    allergies: allergyWarning,
    symptoms_summary: (session.lastSymptoms || '').slice(0, 300),
    study_code: session.studyCode || null,
    created_at: new Date().toISOString(),
    resolved: false,
  };

  try {
    await supabase.from('pre_arrival_alerts').insert(alertData);
    session.preArrivalAlerted = true;
    await sessionLib.saveSession(patientId, session);
    logger.info(`[PRE-ARRIVAL] ${alertPriority} alert fired for ${facility.name} — ${level} — est. ${estimatedMinutes} min`);
  } catch (e) {
    logger.error('[PRE-ARRIVAL] Alert insert failed:', e.message);
    try { queueEvent({ type: 'pre_arrival_alert', table: 'pre_arrival_alerts', data: alertData }); } catch (_) { logger.error('[SILENT] Suppressed error in queueEvent fallback:', _.message || 'unknown'); }
  }
}

async function refreshPreArrivalAlert(patientId, session) {
  try {
    const { data: existing } = await supabase
      .from('pre_arrival_alerts').select('id')
      .eq('patient_id', patientId).eq('resolved', false)
      .order('created_at', { ascending: false }).limit(1);
    if (!existing || existing.length === 0) return;
    await supabase.from('pre_arrival_alerts').update({
      patient_name: (session.firstName && session.surname)
        ? `${session.firstName} ${session.surname}`
        : (session.firstName || null),
      patient_age: session.dob?.age || session.patientAge || null,
      patient_sex: session.sex || null,
      chronic_conditions: (session.chronicConditions || []).map(c => c.label_en || c).join(', ') || null,
      study_code: session.studyCode || null,
      updated_at: new Date().toISOString(),
    }).eq('id', existing[0].id);
    logger.info(`[PRE-ARRIVAL] Alert updated with identity for patient ${patientId}`);
  } catch (e) {
    logger.error('[PRE-ARRIVAL] Alert refresh failed:', e.message);
  }
}

function estimateArrivalMinutes(distanceKm, triageLevel) {
  const speedMinPerKm = { RED: 3, ORANGE: 4, YELLOW: 7, GREEN: 10 };
  const base = distanceKm * (speedMinPerKm[triageLevel] || 7);
  const waiting = (triageLevel === 'YELLOW' || triageLevel === 'GREEN') ? 15 : 5;
  return Math.round(base + waiting);
}

// schedulePhase2FollowUp, runAbandonedSessionAgent, getAbandonedResumeStep → lib/followup.js

async function resumeAbandonedSession(patientId, from, session, lang) {
  const resumeStep = session.abandonResumeStep || 'category';
  if (resumeStep === 'symptom') {
    const categoryName = CATEGORY_DESCRIPTIONS[session.selectedCategory] || 'Other';
    session.fastPathAwaitingSymptom = true;
    await sessionLib.saveSession(patientId, session);
    await sendWhatsAppMessage(from, buildFastPathSymptomAsk(lang, categoryName));
    return;
  }
  session.fastPathCategoryDone = false;
  await sessionLib.saveSession(patientId, session);
  await sendWhatsAppMessage(from, buildFastPathGreeting(lang));
}

// Run abandoned session agent every 30 min; also 5 min after startup
setInterval(followup.runAbandonedSessionAgent, 30 * 60 * 1000);
setTimeout(followup.runAbandonedSessionAgent, 5 * 60 * 1000);


// ── Fast-path message builders ───────────────────────────────────
function buildFastPathSymptomAsk(lang, categoryName) {
  const msgs = {
    en: `You selected: *${categoryName}*\n\nIn a few words:\n• How bad is it? (mild / moderate / severe)\n• How long has it been happening?\n• Any other symptoms?\n\nOr just describe what you feel. Type *skip* to go straight to guidance.`,
    zu: `Ukhethe: *${categoryName}*\n\nNgamazwi ambalwa:\n• Kubi kangakanani? (kancane / phakathi / kakhulu)\n• Kuqale nini?\n• Nazo ezinye izimpawu?\n\nNoma chaza nje okuzwayo. Bhala *skip* ukuya ngokuqondile.`,
    xh: `Ukhethe: *${categoryName}*\n\nNgamazwi ambalwa:\n• Kubi kangakanani? (kancinci / phakathi / kakhulu)\n• Kuqale nini?\n• Ezinye iimpawu?\n\nOkanye chaza nje oko uzivayo. Bhala *skip*.`,
    af: `Jy het gekies: *${categoryName}*\n\nIn 'n paar woorde:\n• Hoe erg? (sag / matig / ernstig)\n• Hoe lank al?\n• Enige ander simptome?\n\nOf beskryf net wat jy voel. Tik *skip*.`,
    nso: `O kgethile: *${categoryName}*\n\nNgamantswe a mmalwa:\n• Go boima bjang? (go nyenyane / phakathi / go thata)\n• Go thomile neng?\n• Dika tše dingwe?\n\nGoba hlaloša fela se o ikwago. Ngwala *skip*.`,
    tn: `O tlhophile: *${categoryName}*\n\nNgamantswe a mannye:\n• Go boima jang? (go nyenyane / phakathi / thata)\n• Go simolotse neng?\n• Matshwao a mangwe?\n\nKgotsa tlhalosa fela se o ikwang. Kwala *skip*.`,
    st: `O khethile: *${categoryName}*\n\nNgamantswe a mmalwa:\n• Ho boima hakae? (ho nyane / phakathi / thata)\n• Ho qadile neng?\n• Matshwao a mang?\n\nKapa hlalosa fela se o ikwang. Ngola *skip*.`,
    ts: `U hlawule: *${categoryName}*\n\nHi mavoko ya malittle:\n• Swi boha njhani? (ku leswi ku nga bohi / phakathi / ku boha)\n• Swi sungule lini?\n• Swikombiso swin'wana?\n\nKumbe hlamusela fela loko u ikwang. Tsala *skip*.`,
    ss: `Ukhethe: *${categoryName}*\n\nNgamazwi lambalwa:\n• Kubi kangakanani? (kancane / phakathi / kakhulu)\n• Kuqale nini?\n• Timphawu letinye?\n\nNoma chaza nje lokuzwako. Bhala *skip*.`,
    ve: `No khetha: *${categoryName}*\n\nNga maipfi manzhi:\n• Ndi vhufhio? (vhu si vhukhali / phakathi / vhukali)\n• Ho thoma lini?\n• Zwiga zwingwe?\n\nKana ṱalutshedza fhedzi zwine na zwi zwia. Nwalani *skip*.`,
    nr: `Ukhethe: *${categoryName}*\n\nNgamazwi ambalwa:\n• Kubi kangakanani? (kancane / phakathi / kakhulu)\n• Kuqale nini?\n• Iimpawu ezenye?\n\nNamkha chaza nje okuzwayo. Bhala *skip*.`,
  };
  return msgs[lang] || msgs['en'];
}

// PHQ-2 Depression Screening — validated 2-question screen for depression
// WHO/SA STG: used at PHC level to identify patients who may need further assessment.
// Score >=3 = positive screen → needs full PHQ-9 or clinical assessment.
// Sensitivity ~83%, specificity ~92% for major depression.
function buildPHQ2Screening(lang) {
  const msgs = {
    en: `🧠 *Mental Health Check*\n\nOver the *past 2 weeks*, how often have you been bothered by:\n\n*Question 1:* Feeling down, depressed, or hopeless?\n0 — Not at all\n1 — Several days\n2 — More than half the days\n3 — Nearly every day\n\n*Question 2:* Little interest or pleasure in doing things?\n0 — Not at all\n1 — Several days\n2 — More than half the days\n3 — Nearly every day\n\nReply with both numbers (e.g. *2,1*)`,
    zu: `🧠 *Ukuhlola Ingqondo*\n\nEmavikini *amabili edlule*, kangakanani uphazanyiswe:\n\n*Umbuzo 1:* Ukuzizwa uphansi, ukhathazekile, noma ungenathemba?\n0 — Akukaze\n1 — Izinsuku ezimbalwa\n2 — Ngaphezulu kwezinsuku eziyisidluluzane\n3 — Cishe nsuku zonke\n\n*Umbuzo 2:* Ukungabi nandaba noma injabulo ekwenzeni izinto?\n0 — Akukaze\n1 — Izinsuku ezimbalwa\n2 — Ngaphezulu kwezinsuku eziyisidluluzane\n3 — Cishe nsuku zonke\n\nPhendula ngezinombolo zombili (isb. *2,1*)`,
    xh: `🧠 *Ukuhlola Ingqondo*\n\nKwiiveki *ezi-2 ezidlulileyo*, kangakanani uphazanyiswe:\n\n*Umbuzo 1:* Ukuziva uphantsi, ukhathazekile, okanye ungenathemba?\n0 — Akukaze\n1 — Iintsuku ezimbalwa\n2 — Ngaphezu kwesiqingatha seentsuku\n3 — Phantse yonke imihla\n\n*Umbuzo 2:* Ukunganaki okanye injabulo ekwenzeni izinto?\n0 — Akukaze\n1 — Iintsuku ezimbalwa\n2 — Ngaphezu kwesiqingatha seentsuku\n3 — Phantse yonke imihla\n\nPhendula ngeenombolo zombini (umz. *2,1*)`,
    af: `🧠 *Geestesgesondheid Toets*\n\nOor die *afgelope 2 weke*, hoe dikwels is jy gepla deur:\n\n*Vraag 1:* Om af, depressief, of hopeloos te voel?\n0 — Glad nie\n1 — Verskeie dae\n2 — Meer as die helfte van die dae\n3 — Byna elke dag\n\n*Vraag 2:* Min belangstelling of plesier om dinge te doen?\n0 — Glad nie\n1 — Verskeie dae\n2 — Meer as die helfte van die dae\n3 — Byna elke dag\n\nAntwoord met albei nommers (bv. *2,1*)`,
  };
  return msgs[lang] || msgs['en'];
}

// Antenatal screening — determines visit type for pregnant patients
// SA DoH ANC schedule: booking, 20w, 26-28w, 32-34w, 36w, 38w, 40w
function buildANCScreening(lang) {
  const msgs = {
    en: `🤰 *Pregnancy*\n\nWhat brings you today?\n\n1 — Routine antenatal visit (regular check-up)\n2 — New concern or symptom\n3 — Emergency (bleeding, severe pain, baby not moving)\n4 — Collecting antenatal supplements only`,
    zu: `🤰 *Ukukhulelwa*\n\nYini ekulethe namuhla?\n\n1 — Ukuvakashela kwejwayelekile kokukhulelwa\n2 — Inkinga entsha noma isimpawu\n3 — Iphuthuma (ukopha, ubuhlungu obukhulu, ingane ayinyakazi)\n4 — Ukuthatha ama-supplements okukhulelwa kuphela`,
    xh: `🤰 *Ukukhulelwa*\n\nYintoni ekuzise namhlanje?\n\n1 — Utyelelo oluqhelekileyo lokukhulelwa\n2 — Ingxaki entsha okanye iimpawu\n3 — Ingxakeko (ukophela, iintlungu eziqatha, usana alushukumi)\n4 — Ukuthatha ii-supplements zokukhulelwa kuphela`,
    af: `🤰 *Swangerskap*\n\nWat bring jou vandag?\n\n1 — Roetine voorgeboorte besoek (gewone kontrole)\n2 — Nuwe bekommernis of simptoom\n3 — Noodgeval (bloeding, ernstige pyn, baba beweeg nie)\n4 — Haal net voorgeboorte-aanvullings af`,
    nso: `🤰 *Boimana*\n\nKe eng se se go tlišitšego lehono?\n\n1 — Ketelo ya ka mehla ya boimana\n2 — Kgathatšo ye mpsha goba seka\n3 — Tšhoganetšo (go tšwa madi, bohloko bjo bogolo, lesea ga le šikinya)\n4 — Go tšea di-supplements tša boimana fela`,
    tn: `🤰 *Boimana*\n\nKe eng se se go tlisitseng gompieno?\n\n1 — Ketelo ya ka tlwaelo ya boimana\n2 — Kgathatso e ntšhwa kgotsa letshwao\n3 — Tshoganyetso (go tswa madi, botlhoko jo bogolo, lesea ga le tsamaye)\n4 — Go tsaya di-supplements tsa boimana fela`,
    st: `🤰 *Boimana*\n\nKe eng se se o tlisitseng kajeno?\n\n1 — Ketelo ya ka tloaelo ya boimana\n2 — Kgathatso e ntjha kapa letshwao\n3 — Tshohanyetso (ho tswa madi, bohloko bo boholo, lesea ha le tsamaye)\n4 — Ho nka di-supplements tsa boimana feela`,
    ts: `🤰 *Vukati*\n\nI yini leyi yi ku tisaka namuntlha?\n\n1 — Ku endzela ka ntolovelo ka vukati\n2 — Xikombiso xa ntshwa kumbe nkinga\n3 — Xihatla (ku huma ngati, ku vava ngopfu, n'wana a nga tshiki)\n4 — Ku teka ti-supplements ta vukati ntsena`,
    ss: `🤰 *Kukhulelwa*\n\nYini lekutsete lamuhla?\n\n1 — Kuvakashela kwejwayelekile kwekukhulelwa\n2 — Inkinga lensha noma simphawu\n3 — Lokusheshisako (kuphuma ingati, buhlungu lobukhulu, umntfwana akanyakati)\n4 — Kutfola ema-supplements ekukhulelwa kuphela`,
    ve: `🤰 *Vhuimana*\n\nNdi mini zwo ni ḓisaho ṋamusi?\n\n1 — U dalela ha tshifhinga tsha vhuimana\n2 — Tshiga tshiswa kana tshikombiso\n3 — Tshoganetso (u bva malofha, u vhavha nga maanḓa, ṅwana ha tshimbili)\n4 — U dzhia dzi-supplements dza vhuimana fhedzi`,
    nr: `🤰 *Ukukhulelwa*\n\nYini ekulethe namuhla?\n\n1 — Ukuvakatjhela kwejwayelekile kwokukhulelwa\n2 — Inkinga entsha noma isimphawu\n3 — Lokusheshisako (ukophela, ubuhlungu obukhulu, umntwana akanyakazi)\n4 — Ukuthatha ama-supplements wokukhulelwa kwaphela`,
  };
  return msgs[lang] || msgs['en'];
}

// IMCI (Integrated Management of Childhood Illness) danger sign screening
// WHO/SA IMCI protocol: check for general danger signs in ALL sick children under 5.
// Any danger sign = urgent referral (ORANGE/RED) regardless of other symptoms.
function buildIMCIDangerSignCheck(lang) {
  const msgs = {
    en: `👶 *Child Illness — Danger Sign Check*\n\nBefore we assess, does the child have ANY of these danger signs?\n\n1 — Not able to drink or breastfeed\n2 — Vomits everything\n3 — Has had convulsions (fits)\n4 — Lethargic or unconscious\n5 — Chest indrawing (ribs pull in when breathing)\n6 — Stridor (noisy breathing when calm)\n\n0 — None of these\n\nYou can type multiple numbers (e.g. 1,3).`,
    zu: `👶 *Ukugula Kwengane — Ukuhlola Izimpawu Eziyingozi*\n\nNgaphambi kokuba sihlole, ingabe ingane inezimpawu eziyingozi?\n\n1 — Ayikwazi ukuphuza noma ukuncelisa\n2 — Ihlanza konke\n3 — Ibe nezithuthwane (izinyathelo)\n4 — Ikhathele kakhulu noma ayiphaphami\n5 — Isifuba sidonseka (izimbambo zidonseka uma iphefumula)\n6 — Umsindo wokuphefumula (uma izolile)\n\n0 — Azikho kulezi\n\nUngabhala izinombolo eziningi (isb. 1,3).`,
    xh: `👶 *Ukugula Komntwana — Ukuhlola Iimpawu Eziyingozi*\n\nPhambi kokuba sihlole, ngaba umntwana unezimpawu eziyingozi?\n\n1 — Akakwazi ukusela okanye ukuncancisa\n2 — Ugabha yonke into\n3 — Ubenazo izikhwiniso (izithuthwane)\n4 — Udiniwe kakhulu okanye akavuki\n5 — Isifuba sidonseka (ubambo luthi lwakhe lusondela xa ephefumla)\n6 — Isandi sokuphefumla (xa ezolile)\n\n0 — Akukho kule\n\nUngabhala iinombolo ezininzi (umz. 1,3).`,
    af: `👶 *Kind Siekte — Gevaarteken Kontrole*\n\nVoordat ons evalueer, het die kind ENIGE van hierdie gevaartekens?\n\n1 — Kan nie drink of borsvoeding neem nie\n2 — Braak alles uit\n3 — Het stuipe (fitte) gehad\n4 — Lusteloos of bewusteloos\n5 — Borskas intrekking (ribbes trek in met asemhaling)\n6 — Stridor (raserige asemhaling wanneer kalm)\n\n0 — Geen van hierdie nie\n\nJy kan meervoudige nommers tik (bv. 1,3).`,
    nso: `👶 *Bolwetši bja Ngwana — Go Hlahloba Dika tša Kotsi*\n\nPele re hlahloba, na ngwana o na le tše dingwe tša dika tše tša kotsi?\n\n1 — A a kgone go nwa goba go nyantšha\n2 — O hlatša tšohle\n3 — O bile le go thothomela (fits)\n4 — O lapile kudu goba ga a tsoge\n5 — Sefuba se gogana (marapo a gogana ge a hema)\n6 — Modumo wa go hema (ge a iketlile)\n\n0 — Ga go na tše\n\nO ka ngwala dinomoro tše mmalwa (mohlala 1,3).`,
    tn: `👶 *Bolwetse jwa Ngwana — Go Tlhatlhoba Matshwao a Kotsi*\n\nPele re tlhatlhoba, a ngwana o na le mangwe a matshwao ano a kotsi?\n\n1 — Ga a kgone go nwa kgotsa go anyisa\n2 — O latsa tsotlhe\n3 — O nnile le dithothomelo (fits)\n4 — O lapile thata kgotsa ga a tsoge\n5 — Sehuba se gogana (marapo a gogana fa a hema)\n6 — Modumo wa go hema (fa a iketlile)\n\n0 — Ga go na sepe\n\nO ka kwala dinomoro di le mmalwa (sk. 1,3).`,
    st: `👶 *Bolwetse ba Ngwana — Ho Hlahloba Matshwao a Kotsi*\n\nPele re hlahloba, na ngwana o na le matshwao a kotsi a mang kapa a mang?\n\n1 — Ha a kgone ho nwa kapa ho anyesa\n2 — O hlatsa tsohle\n3 — O bile le ho thothomela (fits)\n4 — O kgathetse haholo kapa ha a tsoge\n5 — Sefuba se hodisa (marapo a hodisa ha a hema)\n6 — Modumo wa ho hema (ha a iketlile)\n\n0 — Ha ho letho\n\nO ka ngola dinomoro tse mmalwa (mohlala 1,3).`,
    ts: `👶 *Vuvabyi bya N'wana — Ku Kambela Swikombiso swa Khombo*\n\nKu nga si ku kambela, xana n'wana u na swikombiso swa khombo?\n\n1 — A nga koti ku nwa kumbe ku mamisa\n2 — U hlantsa hinkwaswo\n3 — U vile na ku rhurhumela (fits)\n4 — U vabya ngopfu kumbe a nga ha pfuki\n5 — Xifuva xi kokana (marhambu ya kokana loko a hefemula)\n6 — Mpfumawulo wa ku hefemula (loko a wisa)\n\n0 — Ku hava nchumu\n\nU nga tsala tinomboro to tala (xik. 1,3).`,
    ss: `👶 *Kugula Kwemntfwana — Kuhlola Timphawu Letiyingoti*\n\nNgaphambi kwekutsi sihlole, umntfwana unato yini letinye taletimphawu letiyingoti?\n\n1 — Akakwati kuphuza noma kuncelisa\n2 — Uhlanta konkhe\n3 — Ube netitfutfumane (fits)\n4 — Ukhatsele kakhulu noma akaphaphami\n5 — Sifuba sidonseka (ematsambo adonseka nawuphefumula)\n6 — Umsindvo wekuphefumula (nawuthulile)\n\n0 — Kute kuloku\n\nUngabhala tinombolo letinyenti (isb. 1,3).`,
    ve: `👶 *Vhulwadze ha Ṅwana — U Ṱolisisa Zwiga zwa Khombo*\n\nHu sa athu ṱolisisa, naa ṅwana u na zwiṅwe zwa zwiga izwi zwa khombo?\n\n1 — A koni u nwa kana u mamisa\n2 — U khotshedza zwoṱhe\n3 — U vhile na u ngalangala (fits)\n4 — U neta nga maanḓa kana ha vugi\n5 — Tshifuva tshi kokana (marhambo a kokana musi a tshi fhefhula)\n6 — Muṱavha wa u fhefhula (musi o dzika)\n\n0 — A hu na tshithu\n\nNi nga ṅwala nomboro nnzhi (tsumbo 1,3).`,
    nr: `👶 *Ukugula Komntwana — Ukuhlola Iimphawu Eziyingozi*\n\nNgaphambi kokuthi sihlole, umntfwana unazo yini iimphawu lezi eziyingozi?\n\n1 — Akakwazi kuphuza noma ukuncelisa\n2 — Uhlanza konkhe\n3 — Ube netithuthwane (fits)\n4 — Ukhathele khulu noma akaphaphami\n5 — Isifuba sidonseka (amathambo adonseka nawuphefumula)\n6 — Umsindo wokuphefumula (nawuthulile)\n\n0 — Akukho\n\nUngabhala tinombolo ezinengi (isb. 1,3).`,
  };
  return msgs[lang] || msgs['en'];
}

function buildFastPathChronicEnrolment(lang) {
  const msgs = {
    en: `💊 *Chronic Medication*\n\nAre you already on a chronic disease programme (e.g. collecting ARVs, blood pressure or diabetes medication regularly)?\n\n1 — Yes, I am already enrolled\n2 — No, I have new symptoms (e.g. always thirsty, high blood, losing weight)`,
    zu: `💊 *Umuthi Wamahlalakhona*\n\nUsuvele usehlwini lohlelo lwesifo esingapheli (isb. uthatha ama-ARV, umuthi wegazi eliphakeme noma ushukela njalo)?\n\n1 — Yebo, sengibhalisile\n2 — Cha, nginezimpawu ezintsha (isb. ngomile njalo, igazi eliphakeme, ngilahlekelwa isisindo)`,
    xh: `💊 *Amayeza Ahlalekileyo*\n\nUkwinkqubo yesifo esingapheliyo (umz. uthatha ama-ARV, amayeza egazi eliphezulu okanye eswekile rhoqo)?\n\n1 — Ewe, sendibhalisile\n2 — Hayi, ndinezimpawu ezintsha (umz. ndinxaniwe rhoqo, igazi eliphezulu, ndiyalahlekelwa)`,
    af: `💊 *Chroniese Medikasie*\n\nIs jy reeds op \'n chroniese siekteprogram (bv. haal gereeld ARV\'s, bloeddruk- of diabetesmedikasie)?\n\n1 — Ja, ek is reeds geregistreer\n2 — Nee, ek het nuwe simptome (bv. altyd dors, hoë bloed, gewig verloor)`,
    nso: `💊 *Dihlare tša go Dulela*\n\nNa o šetše o le lenaneong la bolwetši bjo bo sa folego (mohlala o tšea di-ARV, dihlare tša madi a godimo goba tša swikiri ka mehla)?\n\n1 — Ee, ke šetše ke ngwadišitšwe\n2 — Aowa, ke na le dika tše mpsha (mohlala ke nyorilwe ka mehla, madi a godimo, ke lahlegelwa ke mmele)`,
    tn: `💊 *Dimelemo tsa go Nnela Ruri*\n\nA o setse o le mo lenaneong la bolwetse jo bo sa foleng (sk. o tsaya di-ARV, dimelemo tsa madi a a kwa godimo kgotsa sukiri ka metlha)?\n\n1 — Ee, ke setse ke kwadisitswe\n2 — Nnyaa, ke na le matshwao a masha (sk. ke nyorilwe ka metlha, madi a a kwa godimo, ke latlhegelwa ke mmele)`,
    st: `💊 *Meriana ya Mahlale*\n\nNa o se o le lenaneong la bolwetse bo sa foleng (mohlala o nka di-ARV, meriana ya madi a hodimo kapa tsoekere ka mehla)?\n\n1 — E, ke se ke ngodisitswe\n2 — Tjhe, ke na le matshwao a matjha (mohlala ke nyorilwe ka mehla, madi a hodimo, ke lahlehelwa ke mmele)`,
    ts: `💊 *Mirhi ya Vurhongo*\n\nXana u le eka nongonoko wa vuvabyi byo bu nga heleko (xik. u teka ti-ARV, mirhi ya ngati ya le henhla kumbe swikiri hi masiku hinkwawo)?\n\n1 — Ina, ndzi swin'we ndzi tsariwile\n2 — Ee-ee, ndzi na ni swikombiso swa ntshwa (xik. ndzi na torha hi masiku hinkwawo, ngati ya le henhla, ndzi lahlekeriwa hi mirhi)`,
    ss: `💊 *Imitsi Yesikhashana*\n\nUsuvele ubhalisiwe ehlwini lohlelo lwesifo lesingezeleki (isb. utfola ema-ARV, imitsi yengati lephakeme noma yeshukela njalo)?\n\n1 — Yebo, sengibhalisiwe\n2 — Cha, nginetimphawu letinsha (isb. ngomile njalo, ingati lephakeme, ngilahlekelwa sisindvo)`,
    ve: `💊 *Mishonga ya Vhulwadze*\n\nNa no no vha kha mbekanyamushumo ya vhulwadze vhu sa folaho (tsumbo ni tshi dzhia dzi-ARV, mishonga ya malofha a nṱha kana swigiri nga ḓuvha ḽiṅwe na ḽiṅwe)?\n\n1 — Ee, ndo no ṅwalisiwa\n2 — Hai, ndi na zwiga zwiswa (tsumbo ndi ḓi pfa ndi na ḓora tshifhinga tshoṱhe, malofha a nṱha, ndi khou fhungudza)`,
    nr: `💊 *Imitjhoga Yesikhathi Eside*\n\nUsuvele ubhaliswe ehlwini lohlelo lwesifo esingapheli (isb. uthatha ama-ARV, imitjhoga yengazi ephakeme noma yesiswigiri njalo)?\n\n1 — Iye, sengibhaliswe\n2 — Awa, ngineemphawu ezintsha (isb. ngomile njalo, igazi eliphakeme, ngilahlekelwa sisindo)`,
  };
  return msgs[lang] || msgs['en'];
}

function buildFastPathChronicCheck(lang) {
  const msgs = {
    en: `💊 *Chronic Medication*\n\nAre you feeling well (just collecting medication) or unwell today?\n\n1 — Just collecting medication\n2 — I am sick / not feeling well`,
    zu: `💊 *Umuthi Wamahlalakhona*\n\nUzizwa kahle (uqoqa umuthi kuphela) noma awuzizwa kahle namuhla?\n\n1 — Ngizolanda umuthi kuphela\n2 — Ngiyagula / angizizwa kahle`,
    xh: `💊 *Amayeza Ahlalekileyo*\n\nUziva kakuhle (uhamba nje uyokuthatha amayeza) okanye awuzivi kakuhle namhlanje?\n\n1 — Ndiya kufumana amayeza kuphela\n2 — Ndiyagula / andizivi kakuhle`,
    af: `💊 *Chroniese Medikasie*\n\nVoel jy goed (haal net medikasie) of voel jy sleg vandag?\n\n1 — Haal net medikasie\n2 — Ek is siek / voel nie goed nie`,
    nso: `💊 *Dihlare tša go Dulela*\n\nA o ikwa gabotse (o kgobokela dihlare fela) goba ga o ikwe gabotse lehono?\n\n1 — Ke ya go kgobokela dihlare fela\n2 — Ke a lwala / ga ke ikwe gabotse`,
    tn: `💊 *Dimelemo tsa go Nnela Ruri*\n\nA o ikwa sentle (o kgobokela dimelemo fela) kgotsa ga o ikwe sentle gompieno?\n\n1 — Ke ya go kgobokela dimelemo fela\n2 — Ke a lwala / ga ke ikwe sentle`,
    st: `💊 *Meriana ya Mahlale*\n\nNa o ikwa hantle (o kgobokela meriana fela) kapa ha o ikwe hantle kajeno?\n\n1 — Ke ya ho kgobokela meriana fela\n2 — Ke a kula / ha ke ikwe hantle`,
    ts: `💊 *Mirhi ya Vurhongo*\n\nXana u tikwa kahle (u kuma mirhi fela) kumbe a wu tikwi kahle namuntlha?\n\n1 — Ndzi ya ku kuma mirhi fela\n2 — Ndzi vabya / a ndzi tikwi kahle`,
    ss: `💊 *Imitsi Yesikhashana*\n\nUzizwa kahle (utfola imitsi kuphela) noma awuzizwa kahle namuhla?\n\n1 — Ngitfola imitsi kuphela\n2 — Ngiyagula / angizizwa kahle`,
    ve: `💊 *Mishonga ya Vhulwadze*\n\nNo zwi zwi zwavhuḓi (no dzhia mishonga fhedzi) kana a no zwi zwi zwavhuḓi namusi?\n\n1 — Ndi tshi dzhia mishonga fhedzi\n2 — Ndi a lwala / a ndi zwi zwi zwavhuḓi`,
    nr: `💊 *Imitjhoga Yesikhathi Eside*\n\nUzizwa kahle (uthabatha imitjhoga kuphela) noma awuzizwa kahle namuhla?\n\n1 — Ngithabatha imitjhoga kuphela\n2 — Ngiyagula / angizizwa kahle`,
  };
  return msgs[lang] || msgs['en'];
}

function buildPhase2NameAsk(lang) {
  const msgs = {
    en: `One more thing before you go — what's your *first name*?\n(Or type *skip*)`,
    zu: `Into enye ngaphambi kokuthi uhambe — *igama lakho lokuqala* lithini?\n(Noma bhala *skip*)`,
    xh: `Enye into ngaphambi kokuhamba — *igama lakho lokuqala* lini?\n(Okanye bhala *skip*)`,
    af: `Nog een ding voordat jy gaan — wat is jou *voornaam*?\n(Of tik *skip*)`,
    nso: `Se se tee pele ga ge o tloga — *leina la gago la mathomo* ke mang?\n(Goba ngwala *skip*)`,
    tn: `Sengwe gape pele o tsamaya — *leina la gago la ntlha* ke mang?\n(Kgotsa kwala *skip*)`,
    st: `Ntho e 'ngoe pele o tsamaya — *lebitso la hao la pele* ke mang?\n(Kapa ngola *skip*)`,
    ts: `Xin'wana nakambe u nga si nghena — *vito ra wena ra mathomo* i nyinyi?\n(Kumbe tsala *skip*)`,
    ss: `Lento lenye ngaphambi kokutsi uhambe — *libito lakho lokuqala* nguliphi?\n(Noma bhala *skip*)`,
    ve: `Tshithu tshingwe hu sa athu u bva — *dzina lanu la u thoma* ndi nnyi?\n(Kana nwalani *skip*)`,
    nr: `Enye into ngaphambi kokuhamba — *ibizo lakho lokuqala* ngubani?\n(Namkha bhala *skip*)`,
  };
  return msgs[lang] || msgs['en'];
}

function buildPhase2SurnameAsk(lang, firstName) {
  const name = firstName ? `, ${firstName}` : '';
  const msgs = {
    en: `Thanks${name}. And your *surname*?\n(Or *skip*)`,
    zu: `Ngiyabonga${name}. Futhi *isibongo sakho*?\n(Noma *skip*)`,
    xh: `Enkosi${name}. Kwaye *ifani yakho*?\n(Okanye *skip*)`,
    af: `Dankie${name}. En jou *van*?\n(Of *skip*)`,
    nso: `Re a leboga${name}. Gomme *sefane sa gago*?\n(Goba *skip*)`,
    tn: `Re a leboga${name}. Mme *sefane sa gago*?\n(Kgotsa *skip*)`,
    st: `Re a leboha${name}. Le *fane ya hao*?\n(Kapa *skip*)`,
    ts: `Hi khensa${name}. Naswona *vito ra n'wana wa hina ra ndhawu*?\n(Kumbe *skip*)`,
    ss: `Siyabonga${name}. Futsi *lifani lakho*?\n(Noma *skip*)`,
    ve: `Ri a livhuwa${name}. Na *dzina lanu la lushaka*?\n(Kana *skip*)`,
    nr: `Siyathokoza${name}. Na *isibongo sakho*?\n(Namkha *skip*)`,
  };
  return msgs[lang] || msgs['en'];
}

function buildPhase2DobAsk(lang) {
  const msgs = {
    en: `And your *date of birth*? (e.g. 15 March 1985 or 15/03/1985)\n(Or *skip*)`,
    zu: `Futhi *usuku lwakho lokuzalwa*? (isib. 15 Mashi 1985 noma 15/03/1985)\n(Noma *skip*)`,
    xh: `Kwaye *umhla wakho wokuzalwa*? (umz. 15 Matshi 1985 okanye 15/03/1985)\n(Okanye *skip*)`,
    af: `En jou *geboortedatum*? (bv. 15 Maart 1985 of 15/03/1985)\n(Of *skip*)`,
    nso: `Gomme *letsatsi la gago la tswalo*? (mohlala 15 Matšhe 1985 goba 15/03/1985)\n(Goba *skip*)`,
    tn: `Mme *letsatsi la gago la tswalo*? (mohlala 15 Machi 1985 kgotsa 15/03/1985)\n(Kgotsa *skip*)`,
    st: `Le *letsatsi la hao la tswalo*? (mohlala 15 Hlakola 1985 kapa 15/03/1985)\n(Kapa *skip*)`,
    ts: `Naswona *siku ra wena ra ku talwa*? (xik. 15 Nyenyankulu 1985 kumbe 15/03/1985)\n(Kumbe *skip*)`,
    ss: `Futsi *lilanga lakho lokuzalwa*? (isib. 15 Inkhwenkhweti 1985 noma 15/03/1985)\n(Noma *skip*)`,
    ve: `Na *duvha lanu la u bebwa*? (ndi 15 Thafamuhwe 1985 kana 15/03/1985)\n(Kana *skip*)`,
    nr: `Na *ilanga lakho lokuzalwa*? (isb. 15 Matjhi 1985 namkha 15/03/1985)\n(Namkha *skip*)`,
  };
  return msgs[lang] || msgs['en'];
}

function buildPhase2SexAsk(lang) {
  const msgs = {
    en: `Are you *male or female*?\n1 — Female\n2 — Male\n(Or *skip*)`,
    zu: `*Ungumuntu wesifazane noma wesilisa*?\n1 — Wesifazane\n2 — Wesilisa\n(Noma *skip*)`,
    xh: `*Ungumfazi okanye indoda*?\n1 — Umfazi\n2 — Indoda\n(Okanye *skip*)`,
    af: `Is jy *vroulik of manlik*?\n1 — Vroulik\n2 — Manlik\n(Of *skip*)`,
    nso: `O *mosadi goba monna*?\n1 — Mosadi\n2 — Monna\n(Goba *skip*)`,
    tn: `O *mosadi kgotsa monna*?\n1 — Mosadi\n2 — Monna\n(Kgotsa *skip*)`,
    st: `O *mosali kapa monna*?\n1 — Mosali\n2 — Monna\n(Kapa *skip*)`,
    ts: `U *wanuna kumbe wanhwana*?\n1 — Wanhwana\n2 — Wanuna\n(Kumbe *skip*)`,
    ss: `Ungu *mfati noma indvodza*?\n1 — Mfati\n2 — Indvodza\n(Noma *skip*)`,
    ve: `No vha *musadzi kana murume*?\n1 — Musadzi\n2 — Murume\n(Kana *skip*)`,
    nr: `Ungumuntu we*sifazane noma wesilisa*?\n1 — Wesifazane\n2 — Wesilisa\n(Namkha *skip*)`,
  };
  return msgs[lang] || msgs['en'];
}

function buildPhase2ChronicAsk(lang) {
  const msgs = {
    en: `Do you take medication for any of these? Reply with numbers (e.g. 1,3) or *0* for none:\n\n0 — None\n1 — HIV / ARVs\n2 — High blood pressure\n3 — Diabetes (sugar)\n4 — Heart condition\n5 — Asthma / Lung\n6 — Epilepsy\n7 — Depression / Mental health\n8 — Other chronic`,
    zu: `Uthatha umuthi wazo yilezi? Phendula ngenombolo (isib. 1,3) noma *0*:\n\n0 — Lutho\n1 — HIV / Ama-ARV\n2 — Igazi eliphakeme\n3 — Ushukela\n4 — Inhliziyo\n5 — Isifuba / Amaphaphu\n6 — Isifo sokuwa\n7 — Ukukhathazeka / Ingqondo\n8 — Omunye umuthi`,
    xh: `Uthatha amayeza ezi? Phendula ngenombolo (umz. 1,3) okanye *0*:\n\n0 — Akukho\n1 — HIV / Ii-ARV\n2 — Uxinzelelo lwegazi\n3 — Iswekile\n4 — Intliziyo\n5 — Isifuba / Imiphepho\n6 — Isifo sokuwa\n7 — Uxinzelelo / Ingqondo\n8 — Esinye`,
    af: `Neem jy medikasie vir enige van hierdie? Antwoord met nommers (bv. 1,3) of *0*:\n\n0 — Geen\n1 — MIV / ARV's\n2 — Hoë bloeddruk\n3 — Diabetes\n4 — Hart\n5 — Asma / Long\n6 — Epilepsie\n7 — Depressie / Geestesgesondheid\n8 — Ander`,
    nso: `Na o nwa dihlare tša tše dingwe? Araba ka dinomoro (mohlala 1,3) goba *0*:\n\n0 — Ga go na\n1 — HIV / Di-ARV\n2 — Madi a godimo\n3 — Swikiri\n4 — Pelo\n5 — Sefuba / Mafahla\n6 — Isifo sa go wa\n7 — Go kwa bohloko / Monagano\n8 — Tše dingwe`,
    tn: `A o nwa dimelemo tsa dingwe? Araba ka dinomoro (mohlala 1,3) kgotsa *0*:\n\n0 — Sepe\n1 — HIV / Di-ARV\n2 — Madi a kwa godimo\n3 — Sukiri\n4 — Pelo\n5 — Sehuba / Mafahla\n6 — Bolwetse jwa go wa\n7 — Go utlwa botlhoko / Mogopolo\n8 — Tse dingwe`,
    st: `Na o nwa meriana ya tse ding? Araba ka dinomoro (mohlala 1,3) kapa *0*:\n\n0 — Ha ho na\n1 — HIV / Di-ARV\n2 — Madi a phahameng\n3 — Tsoekere\n4 — Pelo\n5 — Sefuba / Mafahla\n6 — Bolwetse ba ho wa\n7 — Ho kula ha maikutlo\n8 — E 'ngoe`,
    ts: `Xana u nwa mirhi ya leswi? Hlamula hi tinomboro (xik. 1,3) kumbe *0*:\n\n0 — Ku hava\n1 — HIV / Ti-ARV\n2 — Ngati ya le henhla\n3 — Swikiri\n4 — Mbilu\n5 — Xifuva / Mafahla\n6 — Vuvabyi bya ku wa\n7 — Ku vabya ka mianakanyo\n8 — Yin'wana`,
    ss: `Uphuza imitsi yaleti? Phendvula ngetinombolo (isb. 1,3) noma *0*:\n\n0 — Kute\n1 — HIV / Ema-ARV\n2 — Ingati lephakeme\n3 — Shukela\n4 — Inhlitiyo\n5 — Sifuba / Emaphaphu\n6 — Sifo sekuwa\n7 — Kudzabuka / Ingcondvo\n8 — Lenye`,
    ve: `Naa ni a nwa mushonga wa izwi? Fhindulani nga nomboro (tsumbo 1,3) kana *0*:\n\n0 — A hu na\n1 — HIV / Dzi-ARV\n2 — Malofha a nṱha\n3 — Swigiri\n4 — Mbilu\n5 — Tshifuva / Mafahla\n6 — Vhulwadze ha u wa\n7 — U ḓipfa u si zwavhuḓi / Muhumbulo\n8 — Zwiṅwe`,
    nr: `Uphuza imitjhoga yalezi? Phendula ngetinombolo (isb. 1,3) namkha *0*:\n\n0 — Akukho\n1 — HIV / Ama-ARV\n2 — Igazi eliphakeme\n3 — Iswigiri\n4 — Inhliziyo\n5 — Isifuba / Amaphaphu\n6 — Isifo sokuwa\n7 — Ukudabuka / Ingqondo\n8 — Omunye`,
  };
  return msgs[lang] || msgs['en'];
}

function buildPhase2StudyAsk(lang) {
  const msgs = {
    en: `📋 *Research (Optional)*\n\nBIZUSIZO is part of a health research study. Your anonymous data helps improve care.\n\nWould you like to join the study?\n\n1 — Yes\n2 — No thank you`,
    zu: `📋 *Ucwaningo (Ukukhethwa)*\n\nI-BIZUSIZO iyingxenye yocwaningo. Imininingwane yakho engaziwa izosiza.\n\nUngathanda ukujoyina ucwaningo?\n\n1 — Yebo\n2 — Cha, ngiyabonga`,
    xh: `📋 *Uphando (Ukukhetha)*\n\nI-BIZUSIZO iyinxenye yophando. Idatha yakho engaziwayo izonceda.\n\nNgaba ungathanda ukujoyina uphando?\n\n1 — Ewe\n2 — Hayi enkosi`,
    af: `📋 *Navorsing (Opsioneel)*\n\nBIZUSIZO is deel van 'n navorsingsstudie. Jou anonieme data help.\n\nWil jy deelneem aan die studie?\n\n1 — Ja\n2 — Nee dankie`,
    nso: `📋 *Dinyakišišo (Go Kgetha)*\n\nBIZUSIZO ke karolo ya dinyakišišo tša maphelo. Tshedimošo ya gago ye e sa tsebegego e thuša.\n\nO ka rata go joyina dinyakišišo?\n\n1 — Ee\n2 — Aowa, ke a leboga`,
    tn: `📋 *Dipatlisiso (Go Kgetha)*\n\nBIZUSIZO ke karolo ya dipatlisiso tsa boitekanelo. Tshedimosetso ya gago e e sa itsiweng e thusa.\n\nA o ka rata go joyina dipatlisiso?\n\n1 — Ee\n2 — Nnyaa, ke a leboga`,
    st: `📋 *Dipatlisiso (Ho Khetha)*\n\nBIZUSIZO ke karolo ya dipatlisiso tsa bophelo. Tlhahisoleseding ya hao e sa tsejweng e thusa.\n\nNa o ka rata ho joyina dipatlisiso?\n\n1 — E\n2 — Tjhe, ke a leboha`,
    ts: `📋 *Vulavisisi (Ku Hlawula)*\n\nBIZUSIZO i karhi ya vulavisisi bya rihanyo. Vuxokoxoko bya wena lebyi byi nga tivekiko byi pfuna.\n\nU ta lava ku joyina vulavisisi?\n\n1 — Ina\n2 — Ee-ee, ndza khensa`,
    ss: `📋 *Lucwaningo (Kukhetsa)*\n\nBIZUSIZO kuyincenye yalucwaningo lwemphilo. Lwati lwakho lolungatiwa lusita.\n\nUngatsandza kujoyina lucwaningo?\n\n1 — Yebo\n2 — Cha, ngiyabonga`,
    ve: `📋 *Ṱhoḓisiso (U Nanga)*\n\nBIZUSIZO ndi tshipiḓa tsha ṱhoḓisiso ya mutakalo. Mafhungo aṋu a sa ḓivhiwi a thusa.\n\nNi nga tama u joyina ṱhoḓisiso?\n\n1 — Ee\n2 — Hai, ri a livhuwa`,
    nr: `📋 *Ucwaningo (Ukukhetha)*\n\nBIZUSIZO kuyincenye yocwaningo lwepilo. Ilwazi lakho elingatiwa lisiza.\n\nUngathanda ukujoyina ucwaningo?\n\n1 — Iye\n2 — Awa, ngiyathokoza`,
  };
  return msgs[lang] || msgs['en'];
}

function buildPhase2StudyCodeMsg(lang, code) {
  const msgs = {
    en: `🔢 Your BIZUSIZO code is: *${code}*\n\nShow this at the clinic reception — your file will be ready.\n\nType *code* anytime to see it again.\nType *passport* to get a link to your health summary.`,
    zu: `🔢 Ikhodi yakho ye-BIZUSIZO ithi: *${code}*\n\nKhombisa lokhu e-reception. Ifayela lakho lizolungiswa.\n\nBhala *code* noma nini ukuyibona futhi.\nBhala *passport* ukuthola ilinki yomlando wakho wezempilo.`,
    xh: `🔢 Ikhowudi yakho ye-BIZUSIZO ithi: *${code}*\n\nBonisa le nto kwi-reception. Ifayile yakho iza kulungiswa.\n\nBhala *code* nanini na ukuyibona.\nBhala *passport* ukufumana ilinki yembali yakho yezempilo.`,
    af: `🔢 Jou BIZUSIZO-kode is: *${code}*\n\nWys dit by die kliniek se ontvangs — jou lêer sal gereed wees.\n\nTik *code* enige tyd om dit weer te sien.\nTik *passport* vir jou gesondheidsopsomming.`,
    nso: `🔢 Khouthu ya gago ya BIZUSIZO ke: *${code}*\n\nBontšha ye go reception ya kliniki — faele ya gago e tla ba e loketše.\n\nNgwala *code* nako efe go e bona gape.\nNgwala *passport* go hwetša kakaretšo ya maphelo a gago.`,
    tn: `🔢 Khoutu ya gago ya BIZUSIZO ke: *${code}*\n\nBontsha e kwa reception ya kliniki — faele ya gago e tla bo e lokile.\n\nKwala *code* nako nngwe go e bona gape.\nKwala *passport* go bona kakaretso ya boitekanelo jwa gago.`,
    st: `🔢 Khouthu ya hao ya BIZUSIZO ke: *${code}*\n\nBontsha se ho reception ya kliniki — faele ya hao e tla ba e lokile.\n\nNgola *code* nako efe ho e bona hape.\nNgola *passport* ho fumana kakaretso ya bophelo ba hao.`,
    ts: `🔢 Khodi ya wena ya BIZUSIZO i: *${code}*\n\nKombela leyi eka reception ya kliniki — fayili ya wena yi ta va yi lunghile.\n\nTsala *code* nkarhi wun'wana ku yi vona nakambe.\nTsala *passport* ku kuma nkombiso wa rihanyo ra wena.`,
    ss: `🔢 Ikhodi yakho ye-BIZUSIZO itsi: *${code}*\n\nKhombisa loku ku reception yemtfolamphilo — libhuku lakho litawube seliloketse.\n\nBhala *code* nanoma nini kuyibona futsi.\nBhala *passport* kutfola sifinyeto sempilo yakho.`,
    ve: `🔢 Khodi yaṋu ya BIZUSIZO ndi: *${code}*\n\nSumbedzani izwi kha reception ya kiliniki — fayili yaṋu i ḓo vha yo lugiwa.\n\nṄwalani *code* tshifhinga tshiṅwe u i vhona hafhu.\nṄwalani *passport* u wana tshoṱhe tsha mutakalo waṋu.`,
    nr: `🔢 Ikhodi yakho ye-BIZUSIZO ithi: *${code}*\n\nKhombisa lokhu ku reception yekliniki — ibhuku lakho litawube seliloketse.\n\nTlola *code* nanoma nini ukuyibona godu.\nTlola *passport* ukuthola iqoqo lepilo yakho.`,
  };
  return msgs[lang] || msgs['en'];
}

function buildReturningPatientAsk(lang) {
  const msgs = {
    en: `One last thing — have you visited this clinic before?\n\n1 — Yes, I have a file there\n2 — No, first visit\n3 — Not sure`,
    zu: `Into yokugcina — wake wavakatjhela lo mtholampilo ngaphambilini?\n\n1 — Yebo, nginefayela lapho\n2 — Cha, ukuvakasha kwokuqala\n3 — Angiqiniseki`,
    xh: `Into yokugqibela — ngaba wakhe wayityelela le kliniki?\n\n1 — Ewe, ndinefayile apho\n2 — Hayi, ukutyelela kwokuqala\n3 — Andiqinisekanga`,
    af: `Laaste ding — het jy hierdie kliniek al vroeër besoek?\n\n1 — Ja, ek het 'n lêer daar\n2 — Nee, eerste besoek\n3 — Nie seker nie`,
    nso: `Se sa mafelelo — o kile wa etela kliniki ye pele?\n\n1 — Ee, ke na le faele gona\n2 — Aowa, go etela ga mathomo\n3 — Ga ke tsebe`,
    tn: `Sengwe sa bofelo — a o kile wa etela kliniki e pele?\n\n1 — Ee, ke na le faele teng\n2 — Nnyaa, go etela ga ntlha\n3 — Ga ke itse`,
    st: `Ntho ya ho qetela — na o kile wa etela kliniki ena pele?\n\n1 — E, ke na le faele teng\n2 — Tjhe, ho etela ha pele\n3 — Ha ke tsebe`,
    ts: `Xin'wana xa nkama — xana wa kile wa nghena kliniki leyi?\n\n1 — Ina, ndzi na faele kona\n2 — Ee-ee, ku nghena ka ntlhanu\n3 — A ndzi tivi`,
    ss: `Lento yekugcina — ngabe wake wavakashela umtfolamphilo lo?\n\n1 — Yebo, nginelibhuku khona\n2 — Cha, kuvakasha kwekucala\n3 — Angiqiniseki`,
    ve: `Tshithu tsha u fhedzisa — ni kha di ya kiliniki iyi?\n\n1 — Ee, ndi na faele hone\n2 — Hai, u ya ha u thoma\n3 — A ndi tshi tshidi`,
    nr: `Enye into yokugcina — ngabe wake wavakashela ikliniki le?\n\n1 — Yebo, nginelithiyela lapho\n2 — Cha, ukuvakasha kwokuqala\n3 — Angiqiniseki`,
  };
  return msgs[lang] || msgs['en'];
}

// buildAbandonedSessionMsg → lib/followup.js


// ================================================================
// CONSENT AUDIT LOGGING
// ================================================================
// POPIA (Act 4 of 2013) requires that you can demonstrate:
//   1. That consent was obtained
//   2. When it was obtained
//   3. What the patient was shown (consent text version)
//   4. That withdrawal was honoured immediately
//
// This function writes an immutable record to consent_log for
// every consent event — service consent, study consent, and
// any withdrawal. session.consent is NOT sufficient for audit
// purposes because the sessions table is mutable (overwritten).
//
// Three event types:
//   service_consent_given     — patient replied 1 to POPIA consent
//   service_consent_declined  — patient replied 2 (no data collected)
//   study_consent_given       — patient agreed to research participation
//   study_consent_declined    — patient declined research (still gets BZ code)
//   service_consent_withdrawn — patient sent STOP
// ================================================================
async function logConsent(patientId, eventType, lang, consentVersion, metadata = {}) {
  try {
    await supabase.from('consent_log').insert({
      patient_id:       patientId,
      event_type:       eventType,
      language:         lang,
      consent_version:  consentVersion,  // e.g. 'v2.0-2026-04-01'
      channel:          'whatsapp',
      metadata:         metadata,        // e.g. { study_code, ip_hash }
      logged_at:        new Date().toISOString(),
    });
  } catch (e) {
    // Non-blocking — log to console and governance alert but don't break the flow
    logger.error('[CONSENT_LOG] Failed to write consent audit record:', e.message);
    try {
      await supabase.from('governance_alerts').insert({
        alert_type:  'consent_log_failure',
        severity:    'HIGH',
        pillar:      'patient_safety',
        message:     `Failed to write consent audit record for patient ${patientId}: ${e.message}`,
        data:        { event_type: eventType, patient_id: patientId },
        resolved:    false,
        assigned_to: 'clinical_governance_lead',
        created_at:  new Date().toISOString(),
      });
    } catch (_) { logger.error('[SILENT] Suppressed error in consent governance alert:', _.message || 'unknown'); }
  }
}

// Current consent text version — update this whenever the consent
// wording changes so audit records track exactly what was shown.
const CONSENT_VERSION = 'v2.1-2026-04-09';

// ================================================================
// SYNDROMIC SURVEILLANCE — OUTBREAK DETECTION MODULE
// ================================================================
//
// Clinical evidence base (NICD / WHO):
//
// SYNDROME 1 — Influenza-Like Illness (ILI)
//   Source: NICD ILI-PHC Surveillance Programme (est. 2012)
//   Case definition (NICD/WHO, updated Nov 2023):
//     Acute fever (≥38°C or self-reported) AND cough, onset ≤10 days
//   SA seasonality: April–October, peak May–July (winter)
//   PHC threshold: ≥3 ILI presentations at one facility within 72 hours
//   Ref: PHBSA 2023 Respiratory Pathogens Report; NICD ILI-PHC programme
//
// SYNDROME 2 — Severe Respiratory Illness (SRI) / Pneumonia
//   Source: NICD Pneumonia Surveillance Programme (hospital-based)
//   Case definition: ILI + difficulty breathing or hospitalisation required
//   PHC threshold: ≥2 severe respiratory cases in 48 hours at one facility
//   Ref: PHBSA 2023 Table 1; NICD PSP programme
//
// SYNDROME 3 — Acute Gastroenteritis / Diarrhoeal Disease
//   Source: NICD Diarrhoeal Diseases Syndromic Surveillance (DDSS, est. 2009)
//   Case definition: ≥3 loose stools in 24 hours, acute onset
//   Key pathogens in SA: rotavirus (children ≤5), Shigella, norovirus, adenovirus
//   PHC threshold: ≥5 cases in 48 hours at one facility, OR ≥2 cases in children ≤5
//   Ref: NICD DDSS 2022 Report (PHBSA); Johnstone et al. BMC ID 2022
//
// SYNDROME 4 — Watery Diarrhoea (Cholera exclusion)
//   Source: SA NMC Category 1 (immediate notification required)
//   Case definition: profuse watery diarrhoea, rapid dehydration
//   Regulatory basis: National Health Act 61 of 2003; NMC Regs 2017
//   PHC threshold: ANY 2 cases at one facility within 24 hours → immediate
//   Ref: NICD NMC Regulations Annexure A (2022); NMC SOP 2018
//
// SYNDROME 5 — Meningitis / Meningococcal Disease
//   Source: SA NMC Category 1 (immediate notification)
//   Case definition: fever + stiff neck + purpuric rash (classic triad)
//   PHC threshold: ANY 1 case → immediate NMC notification triggered
//   Ref: NICD NMC Category 1 list; NICD CRDM
//
// SYNDROME 6 — Measles-Like Illness
//   Source: SA NMC Category 1
//   Case definition: fever + generalised maculopapular rash + one of:
//     cough, runny nose, red eyes (WHO case definition)
//   PHC threshold: ≥2 cases in 7 days at one facility
//   Ref: NICD NMC Annexure A 2022; WHO measles surveillance guidelines
//
// SYNDROME 7 — Unexplained Fever Cluster
//   Source: NICD early warning / event-based surveillance
//   Case definition: HIGH or ORANGE triage with fever, no clear diagnosis
//   PHC threshold: ≥5 unexplained fever cases in 48 hours at one facility
//   Purpose: catch novel/emerging pathogens not yet in defined syndromes
//   Ref: NICD event-based surveillance framework; WHO IHR 2005
//
// ALERT LEVELS (adapted from WHO PISA / NICD threshold framework):
//   WATCH   — threshold breached, monitor closely
//   WARNING — 1.5× threshold, clinician review required
//   ALERT   — 2× threshold, notify district health office
//   IMMEDIATE — NMC Category 1 conditions, notify within 24h regardless
//
// NOTE: This module detects SIGNALS, not diagnoses. Every alert must be
// reviewed by a clinician before action. The system cannot confirm infection —
// it flags unusual presentation patterns for human follow-up.
// ================================================================

// ── NICD-validated syndrome definitions ──────────────────────────
// OUTBREAK_SYNDROMES, runOutbreakSurveillanceAgent, checkOutbreakAfterTriage → lib/outbreak.js
setInterval(outbreak.runOutbreakSurveillanceAgent, 60 * 60 * 1000);
// Also run 2 minutes after startup
setTimeout(outbreak.runOutbreakSurveillanceAgent, 2 * 60 * 1000);


// ── Supabase table schema (run once in SQL editor) ────────────────
/*
-- outbreak_alerts table (fill missing columns if table already exists)
ALTER TABLE outbreak_alerts
  ADD COLUMN IF NOT EXISTS syndrome_id       text NOT NULL DEFAULT 'UNKNOWN',
  ADD COLUMN IF NOT EXISTS syndrome_name     text,
  ADD COLUMN IF NOT EXISTS nicd_programme    text,
  ADD COLUMN IF NOT EXISTS facility_key      text,
  ADD COLUMN IF NOT EXISTS alert_level       text NOT NULL DEFAULT 'WATCH',
  ADD COLUMN IF NOT EXISTS case_count        int DEFAULT 0,
  ADD COLUMN IF NOT EXISTS paediatric_count  int DEFAULT 0,
  ADD COLUMN IF NOT EXISTS window_start      timestamptz,
  ADD COLUMN IF NOT EXISTS window_end        timestamptz,
  ADD COLUMN IF NOT EXISTS window_hours      int,
  ADD COLUMN IF NOT EXISTS triage_distribution jsonb DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS nmc_category      int,
  ADD COLUMN IF NOT EXISTS nmc_immediate     boolean DEFAULT false,
  ADD COLUMN IF NOT EXISTS threshold_used    jsonb,
  ADD COLUMN IF NOT EXISTS rationale         text,
  ADD COLUMN IF NOT EXISTS resolved          boolean DEFAULT false,
  ADD COLUMN IF NOT EXISTS resolved_at       timestamptz,
  ADD COLUMN IF NOT EXISTS resolved_by       text,
  ADD COLUMN IF NOT EXISTS created_at        timestamptz DEFAULT now(),
  ADD COLUMN IF NOT EXISTS updated_at        timestamptz;

CREATE INDEX IF NOT EXISTS idx_outbreak_alerts_syndrome
  ON outbreak_alerts(syndrome_id, resolved, window_start);
CREATE INDEX IF NOT EXISTS idx_outbreak_alerts_facility
  ON outbreak_alerts(facility_key, resolved);

-- outbreak_config table (fill missing columns)
ALTER TABLE outbreak_config
  ADD COLUMN IF NOT EXISTS syndrome_id    text NOT NULL DEFAULT 'UNKNOWN',
  ADD COLUMN IF NOT EXISTS window_hours   int,
  ADD COLUMN IF NOT EXISTS thresholds     jsonb,
  ADD COLUMN IF NOT EXISTS active         boolean DEFAULT true,
  ADD COLUMN IF NOT EXISTS updated_by     text,
  ADD COLUMN IF NOT EXISTS note           text,
  ADD COLUMN IF NOT EXISTS created_at     timestamptz DEFAULT now(),
  ADD COLUMN IF NOT EXISTS updated_at     timestamptz;

-- RLS
ALTER TABLE outbreak_alerts ENABLE ROW LEVEL SECURITY;
ALTER TABLE outbreak_config ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Service role" ON outbreak_alerts FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY "Service role" ON outbreak_config FOR ALL TO service_role USING (true) WITH CHECK (true);

-- Seed default configs (so thresholds can be adjusted at runtime without code changes)
INSERT INTO outbreak_config (syndrome_id, window_hours, thresholds, active, note)
VALUES
  ('ILI',              72, '{"WATCH":3,"WARNING":5,"ALERT":8}'::jsonb,  true, 'NICD ILI-PHC default'),
  ('SRI',              48, '{"WATCH":2,"WARNING":3,"ALERT":5}'::jsonb,  true, 'NICD PSP default'),
  ('AGE',              48, '{"WATCH":5,"WARNING":8,"ALERT":12}'::jsonb, true, 'NICD DDSS default'),
  ('WATERY_DIARRHOEA', 24, '{"WATCH":1,"WARNING":1,"ALERT":2}'::jsonb,  true, 'NMC Cat 1 default'),
  ('MENINGITIS',       24, '{"WATCH":1,"WARNING":1,"ALERT":1}'::jsonb,  true, 'NMC Cat 1 default'),
  ('MEASLES',         168, '{"WATCH":1,"WARNING":2,"ALERT":2}'::jsonb,  true, 'NMC Cat 1 default'),
  ('UNEXPLAINED_FEVER',48, '{"WATCH":5,"WARNING":8,"ALERT":12}'::jsonb, true, 'NICD event-based default')
ON CONFLICT (syndrome_id) DO NOTHING;
*/

// ================================================================
async function orchestrate(patientId, from, message, session, messageId = null) {
  // messageId — optional WhatsApp message ID from the inbound webhook
  // (msgObj.id). Threaded so every logTriage() call in this function
  // passes whatsapp_message_id for cross-restart retry dedup. See
  // triage_logs_idempotency_migration.sql and lib/session.js logTriage.
  // Check on next session: verify the 9 logTriage calls OUTSIDE this
  // function (ccmdd/dispensing/virtual-consult handlers etc.) and
  // decide whether those paths need dedup too. Low traffic on those
  // paths; probably not pre-pilot.
  const lang = session.language || 'en';

  // Track phone for abandoned session recovery
  if (!session.lastPhone) { session.lastPhone = from; }

  // ==================== STEP 0: LANGUAGE SELECTION ====================
  if (!session.language) {
    if (LANG_MAP[message]) {
      session.language = LANG_MAP[message];
      await sessionLib.saveSession(patientId, session);
      await sendWhatsAppMessage(from, msg('language_set', session.language));
      // Immediately show consent
      await sendWhatsAppMessage(from, msg('consent', session.language));
      return;
    }
    // Show language menu
    await sendWhatsAppMessage(from, MESSAGES.language_menu._all);
    return;
  }

  // ==================== STEP 1: CONSENT ====================
  if (!session.consent) {
    if (message === '1') {
      session.consent = true;
      session.fastPathStartedAt = new Date().toISOString();
      await sessionLib.saveSession(patientId, session);
      // POPIA audit: log service consent given
      await logConsent(patientId, 'service_consent_given', lang, CONSENT_VERSION);
      await sendWhatsAppMessage(from, msg('consent_yes', lang));

      // Ask if they've used BIZUSIZO before (new phone, existing patient)
      const returningUserMsg = {
        en: 'Have you used BIZUSIZO before on a different phone?\n\n1 — No, this is my first time\n2 — Yes, I have a BZ code',
        zu: 'Wake wasebenzisa i-BIZUSIZO phambilini ngefoni ehlukile?\n\n1 — Cha, yisikhathi sami sokuqala\n2 — Yebo, nginekodi ye-BZ',
        xh: 'Wakhe wayisebenzisa i-BIZUSIZO ngaphambili ngefowuni eyahlukileyo?\n\n1 — Hayi, lixesha lam lokuqala\n2 — Ewe, ndinekodi ye-BZ',
        af: 'Het jy BIZUSIZO al voorheen op \'n ander foon gebruik?\n\n1 — Nee, dis my eerste keer\n2 — Ja, ek het \'n BZ-kode',
      };
      session.awaitingReturningUserCheck = true;
      await sessionLib.saveSession(patientId, session);
      await sendWhatsAppMessage(from, returningUserMsg[lang] || returningUserMsg['en']);
      return;
    }
    if (message === '2') {
      session.consent = false;
      await sessionLib.saveSession(patientId, session);
      // POPIA audit: log consent declined — no data collected after this point
      await logConsent(patientId, 'service_consent_declined', lang, CONSENT_VERSION);
      await sendWhatsAppMessage(from, msg('consent_no', lang));
      return;
    }
    // Re-show consent
    await sendWhatsAppMessage(from, msg('consent', lang));
    return;
  }

  // ==================== STEP 1.15: RETURNING USER LINK (new phone, existing patient) ====================
  if (session.awaitingReturningUserCheck) {
    session.awaitingReturningUserCheck = false;

    if (message === '2') {
      // Patient says they have a BZ code — ask for it
      session.awaitingBZCodeLink = true;
      await sessionLib.saveSession(patientId, session);
      const askCodeMsg = {
        en: 'Please type your BZ code (e.g. BZ-TM41):',
        zu: 'Sicela ubhale ikhodi yakho ye-BZ (isib. BZ-TM41):',
        xh: 'Nceda ubhale ikhowudi yakho ye-BZ (umz. BZ-TM41):',
        af: 'Tik asseblief jou BZ-kode (bv. BZ-TM41):',
      };
      await sendWhatsAppMessage(from, askCodeMsg[lang] || askCodeMsg['en']);
      return;
    }

    // First time user (message === '1' or anything else) — proceed to fast-path
    session.fastPathStarted = true;
    await sessionLib.saveSession(patientId, session);
    await sendWhatsAppMessage(from, buildFastPathGreeting(lang));
    return;
  }

  // ==================== STEP 1.16: BZ CODE LINK — merge new phone to existing patient ====================
  if (session.awaitingBZCodeLink) {
    session.awaitingBZCodeLink = false;
    const codeInput = message.trim().toUpperCase();

    // Look up the BZ code
    const existingCode = await sessionLib.lookupStudyCode(codeInput);

    if (existingCode && existingCode.patient_id) {
      const existingPatientId = existingCode.patient_id;
      const existingSession = await sessionLib.getSession(existingPatientId);

      if (existingSession && existingSession.firstName) {
        // Verify identity — ask them to confirm their name
        session.pendingLinkPatientId = existingPatientId;
        session.pendingLinkName = existingSession.firstName;
        session.awaitingLinkConfirm = true;
        await sessionLib.saveSession(patientId, session);

        const confirmMsg = {
          en: `We found a record for *${existingSession.firstName}${existingSession.surname ? ' ' + existingSession.surname : ''}*. Is that you?\n\n1 — Yes, that's me\n2 — No, wrong person`,
          zu: `Sithole irekhodi lika-*${existingSession.firstName}${existingSession.surname ? ' ' + existingSession.surname : ''}*. Nguwena?\n\n1 — Yebo, yimina\n2 — Cha, umuntu ongalungile`,
          xh: `Sifumene irekhodi lika-*${existingSession.firstName}${existingSession.surname ? ' ' + existingSession.surname : ''}*. Nguwe?\n\n1 — Ewe, ndim\n2 — Hayi, umntu ongalunganga`,
          af: `Ons het 'n rekord gevind vir *${existingSession.firstName}${existingSession.surname ? ' ' + existingSession.surname : ''}*. Is dit jy?\n\n1 — Ja, dis ek\n2 — Nee, verkeerde persoon`,
        };
        await sendWhatsAppMessage(from, confirmMsg[lang] || confirmMsg['en']);
        return;
      }
    }

    // Code not found or no session — proceed as new user
    const notFoundMsg = {
      en: 'We couldn\'t find that code. No problem — we\'ll set you up as a new patient.',
      zu: 'Asiyitholanga leyo khodi. Kulungile — sizokumisa njengomguli omusha.',
      xh: 'Asiyifumananga le khowudi. Kulungile — siza kukumisa njengesigulana esitsha.',
      af: 'Ons kon nie daardie kode vind nie. Geen probleem — ons sal jou as nuwe pasiënt oprig.',
    };
    await sendWhatsAppMessage(from, notFoundMsg[lang] || notFoundMsg['en']);
    session.fastPathStarted = true;
    await sessionLib.saveSession(patientId, session);
    await sendWhatsAppMessage(from, buildFastPathGreeting(lang));
    return;
  }

  // ==================== STEP 1.17: CONFIRM LINK — verify identity before merging ====================
  if (session.awaitingLinkConfirm) {
    session.awaitingLinkConfirm = false;

    if (message === '1' && session.pendingLinkPatientId) {
      const existingPatientId = session.pendingLinkPatientId;
      const existingSession = await sessionLib.getSession(existingPatientId);

      // Link: point the base session to the existing patient ID
      const baseId = sessionLib.hashPhone(from);
      await sessionLib.saveSession(baseId, {
        _activeSubId: existingPatientId,
        _isSharedPhone: true,
        _linkedFrom: baseId,
        _linkedAt: new Date().toISOString(),
      });

      // Copy language and consent to existing session (they just consented on this phone)
      existingSession.language = session.language || existingSession.language;
      existingSession.consent = true;
      existingSession.lastPhone = from;
      await sessionLib.saveSession(existingPatientId, existingSession);

      const linkedMsg = {
        en: `✅ Welcome back, *${existingSession.firstName}*! Your history has been linked to this phone.\n\nYour BZ code: *${existingSession.studyCode || session.pendingLinkCode}*\n\nHow can we help you today?`,
        zu: `✅ Siyakwamukela futhi, *${existingSession.firstName}*! Umlando wakho uxhunywe naleli foni.\n\nIkhodi yakho ye-BZ: *${existingSession.studyCode || ''}*\n\nSingakusiza kanjani namuhla?`,
        xh: `✅ Wamkelekile kwakhona, *${existingSession.firstName}*! Imbali yakho ixhunywe kweli fowuni.\n\nIkhowudi yakho ye-BZ: *${existingSession.studyCode || ''}*\n\nSingakunceda njani namhlanje?`,
        af: `✅ Welkom terug, *${existingSession.firstName}*! Jou geskiedenis is aan hierdie foon gekoppel.\n\nJou BZ-kode: *${existingSession.studyCode || ''}*\n\nHoe kan ons jou vandag help?`,
      };
      await sendWhatsAppMessage(from, linkedMsg[lang] || linkedMsg['en']);
      await sendWhatsAppMessage(from, msg('category_menu', existingSession.language || lang));

      // Audit log
      logger.info(`[LINK] Patient ${existingPatientId} linked to new phone (base: ${baseId})`);
      return;
    }

    // Wrong person — proceed as new
    session.pendingLinkPatientId = null;
    session.pendingLinkName = null;
    session.fastPathStarted = true;
    await sessionLib.saveSession(patientId, session);
    await sendWhatsAppMessage(from, buildFastPathGreeting(lang));
    return;
  }

  // ==================== STEP 1.2: FAST-PATH + ABANDONED SESSION HANDLING ====================

  // Abandoned session recovery — patient replied to recovery message
  if (session.abandonFollowUpSent && !session.triageCompleted) {
    if (message === '1') {
      await resumeAbandonedSession(patientId, from, session, lang);
      return;
    }
    if (message === '2') {
      session.abandonFollowUpSent = false;
      session.fastPathStarted = false;
      await sessionLib.saveSession(patientId, session);
      const okMsg = {
        en: '✅ Glad you\'re feeling better. Send "Hi" anytime if you need help.',
        zu: '✅ Sijabule ukuzwa ukuthi uzizwa ngcono. Thumela "Hi" noma nini uma udinga usizo.',
        xh: '✅ Siyavuya ukuziva ukuba uziva ngcono. Thumela "Hi" nanini ukuba udinga uncedo.',
        af: '✅ Bly jy voel beter. Stuur "Hi" enige tyd as jy hulp nodig het.',
      };
      await sendWhatsAppMessage(from, okMsg[lang] || okMsg['en']);
      return;
    }
  }

  // Fast-path handler — intercepts new/incomplete patient sessions
  const fastPathHandled = await handleFastPath(patientId, from, message, session, lang);
  if (fastPathHandled) return;

  // ==================== STEP 1.3: IDENTITY CAPTURE (legacy path for returning patients) ====================
  // Runs for returning patients whose identity was not captured via Phase 2.
  // Four sequential steps: name → surname → DOB → sex
  if (session.consent && !session.identityDone) {

    // Step 1.2a: First name
    if (!session.identityStep || session.identityStep === 'ask_first_name') {
      if (session.identityStep === 'ask_first_name' && message.length >= 1) {
        const name = sessionLib.capitalizeName(message);
        if (name.length >= 1 && !/\d/.test(name)) {
          session.firstName = name;
          session.identityStep = 'ask_surname';
          await sessionLib.saveSession(patientId, session);
          await sendWhatsAppMessage(from, msg('ask_surname', lang, name));
          return;
        }
      }
      session.identityStep = 'ask_first_name';
      await sessionLib.saveSession(patientId, session);
      await sendWhatsAppMessage(from, msg('ask_first_name', lang));
      return;
    }

    // Step 1.2b: Surname
    if (session.identityStep === 'ask_surname') {
      const surname = sessionLib.capitalizeName(message);
      if (surname.length >= 1 && !/\d/.test(surname)) {
        session.surname = surname;
        session.identityStep = 'ask_dob';
        await sessionLib.saveSession(patientId, session);
        await sendWhatsAppMessage(from, msg('ask_dob', lang));
        return;
      }
      await sendWhatsAppMessage(from, msg('ask_surname', lang, session.firstName));
      return;
    }

    // Step 1.2c: Date of birth
    if (session.identityStep === 'ask_dob') {
      const dob = sessionLib.parseDOB(message);
      if (dob.valid) {
        session.dob = dob;
        session.patientAge = dob.age;
        session.identityStep = 'ask_sex';
        await sessionLib.saveSession(patientId, session);
        await sendWhatsAppMessage(from, msg('ask_sex', lang));
        return;
      }
      await sendWhatsAppMessage(from, msg('ask_dob', lang));
      return;
    }

    // Step 1.2d: Sex
    if (session.identityStep === 'ask_sex') {
      const SEX_MAP = { '1': 'male', '2': 'female', '3': 'intersex', '4': 'prefer_not_to_say' };
      if (SEX_MAP[message]) {
        session.sex = SEX_MAP[message];
        session.identityDone = true;
        session.identityStep = null;

        // Generate reference number for ALL patients (not just study participants)
        if (!session.studyCode) {
          const refCode = await sessionLib.generateStudyCode(patientId);
          session.studyCode = refCode;
        }

        await sessionLib.saveSession(patientId, session);
        await sendWhatsAppMessage(from, msg('identity_confirmed', lang, session.firstName, session.surname));

        // Send reference number
        const refMsg = {
          en: `🔢 Your reference number is: *${session.studyCode}*\n\nShow this number at reception when you arrive at the clinic.`,
          zu: `🔢 Inombolo yakho yereferensi ithi: *${session.studyCode}*\n\nKhombisa le nombolo e-reception uma ufika emtholampilo.`,
          xh: `🔢 Inombolo yakho yereferensi ithi: *${session.studyCode}*\n\nBonisa le nombolo e-reception xa ufika ekliniki.`,
          af: `🔢 Jou verwysingsnommer is: *${session.studyCode}*\n\nWys hierdie nommer by ontvangs wanneer jy by die kliniek aankom.`,
          nso: `🔢 Nomoro ya gago ya referense ke: *${session.studyCode}*\n\nBontšha nomoro ye kwa resepsheneng ge o fihla kliniki.`,
          tn: `🔢 Nomoro ya gago ya referense ke: *${session.studyCode}*\n\nBontsha nomoro e kwa resepsheneng fa o goroga kwa kliniki.`,
          st: `🔢 Nomoro ya hao ya referense ke: *${session.studyCode}*\n\nBontsha nomoro ena resepsheneng ha o fihla kliniki.`,
          ts: `🔢 Nomboro ya wena ya referense i le: *${session.studyCode}*\n\nKomba nomboro leyi eka resepsheni loko u fika ekliniki.`,
          ss: `🔢 Inombolo yakho yereferensi itsi: *${session.studyCode}*\n\nKhombisa lenombolo ku-reception nawufika emtfolamphilo.`,
          ve: `🔢 Nomboro yaṋu ya referense ndi: *${session.studyCode}*\n\nSumbedzani nomboro iyi kha resepsheni musi ni tshi swika kiliniki.`,
          nr: `🔢 Inomboro yakho yereferensi ithi: *${session.studyCode}*\n\nKhombisa inomboro le ku-reception nawufika ekliniki.`,
        };
        await sendWhatsAppMessage(from, refMsg[lang] || refMsg['en']);

        await sendWhatsAppMessage(from, msg('chronic_screening', lang));
        return;
      }
      await sendWhatsAppMessage(from, msg('ask_sex', lang));
      return;
    }
  }

  // ==================== STEP 1.5: CHRONIC CONDITION SCREENING ====================
  // Runs once after consent, before any triage. Captures chronic conditions
  // for ALL patients so the governance risk upgrade (Pillar 2) works universally.
  // This is a CLINICAL feature, not a research feature — benefits all users.
  if (session.consent && !session.chronicScreeningDone) {
    // Parse response: "0" = none, "1,3" = HIV + diabetes, "1 2" = HIV + hypertension
    if (message === '0') {
      session.chronicConditions = [];
      session.chronicScreeningDone = true;
      session.isStudyParticipant = true;
      if (!session.studyCode) {
        const studyCode = await sessionLib.generateStudyCode(patientId);
        session.studyCode = studyCode;
      }
      await sessionLib.saveSession(patientId, session);
      await sendWhatsAppMessage(from, msg('chronic_screening_saved', lang));
      await sendWhatsAppMessage(from, msg('category_menu', lang));
      return;
    }

    const choices = message.replace(/[, ]+/g, ',').split(',').filter(c => CONDITION_MAP[c.trim()]);
    if (choices.length > 0) {
      session.chronicConditions = choices.map(c => CONDITION_MAP[c.trim()]);
      session.ccmddConditions = session.chronicConditions;
      session.chronicScreeningDone = true;
      session.isStudyParticipant = true;
      if (!session.studyCode) {
        const studyCode = await sessionLib.generateStudyCode(patientId);
        session.studyCode = studyCode;
      }
      await sessionLib.saveSession(patientId, session);
      await sendWhatsAppMessage(from, msg('chronic_screening_saved', lang));
      await sendWhatsAppMessage(from, msg('category_menu', lang));
      return;
    }

    // Invalid input — re-show screening
    await sendWhatsAppMessage(from, msg('chronic_screening', lang));
    return;
  }

  // ==================== STEP 1.6: AUTO REFERENCE (replaces study participation question) ====================
  // Every patient gets a BZ-XXXX reference number automatically.
  // No study participation question needed — all patients are treated equally.
  if (session.chronicScreeningDone && session.isStudyParticipant === undefined) {
    session.isStudyParticipant = true; // All patients get references
    if (!session.studyCode) {
      const studyCode = await sessionLib.generateStudyCode(patientId);
      session.studyCode = studyCode;
    }
    await sessionLib.saveSession(patientId, session);
    await sendWhatsAppMessage(from, msg('category_menu', lang));
    return;
  }

  // ==================== STEP: CCMDD FLOW (if active) ====================
  if (session.ccmddStep) {
    const handled = await handleCCMDD(patientId, from, message, session);
    if (handled) return;
  }

  // ==================== STEP: VIRTUAL CONSULT FLOW (if active) ====================
  if (session.virtualConsultStep) {
    const handled = await handleVirtualConsult(patientId, from, message, session);
    if (handled) return;
    // If not handled (patient chose clinic), fall through to facility routing
  }

  // ==================== STEP: APPOINTMENT SLOT BOOKING (SARS-inspired) ====================
  // Patient received a next-visit reminder and is choosing a time slot
  if (session.awaitingSlotChoice) {
    session.awaitingSlotChoice = false;
    const lang = session.language || 'en';
    const slotMap = { '1': 'morning', '2': 'mid_morning', '3': 'afternoon' };
    const slotLabels = { morning: '08:00–10:00', mid_morning: '10:00–12:00', afternoon: '12:00–14:00' };
    const slotLabelsTrans = {
      en: { morning: 'Morning (08:00–10:00)', mid_morning: 'Mid-morning (10:00–12:00)', afternoon: 'Afternoon (12:00–14:00)' },
      zu: { morning: 'Ekuseni (08:00–10:00)', mid_morning: 'Phakathi nosuku (10:00–12:00)', afternoon: 'Ntambama (12:00–14:00)' },
      xh: { morning: 'Kusasa (08:00–10:00)', mid_morning: 'Emini (10:00–12:00)', afternoon: 'Emva kwemini (12:00–14:00)' },
      af: { morning: 'Oggend (08:00–10:00)', mid_morning: 'Middag (10:00–12:00)', afternoon: 'Namiddag (12:00–14:00)' },
      nso: { morning: 'Mosong (08:00–10:00)', mid_morning: 'Gare ga letšatši (10:00–12:00)', afternoon: 'Mathapama (12:00–14:00)' },
      tn: { morning: 'Moso (08:00–10:00)', mid_morning: 'Motshegare (10:00–12:00)', afternoon: 'Motshegare wa boraro (12:00–14:00)' },
      st: { morning: 'Hoseng (08:00–10:00)', mid_morning: 'Motsheare (10:00–12:00)', afternoon: 'Motsheare oa boraro (12:00–14:00)' },
      ts: { morning: 'Mixo (08:00–10:00)', mid_morning: 'Nhlekanhi (10:00–12:00)', afternoon: 'Madyambu (12:00–14:00)' },
      ss: { morning: 'Ekuseni (08:00–10:00)', mid_morning: 'Emini (10:00–12:00)', afternoon: 'Ntambama (12:00–14:00)' },
      ve: { morning: 'Matsheloni (08:00–10:00)', mid_morning: 'Masiari (10:00–12:00)', afternoon: 'Madekwana (12:00–14:00)' },
      nr: { morning: 'Ekuseni (08:00–10:00)', mid_morning: 'Emini (10:00–12:00)', afternoon: 'Ntambama (12:00–14:00)' },
    };

    const slot = slotMap[message.trim()];

    if (slot) {
      // Store the booked slot
      session.bookedSlot = slot;
      session.bookedSlotLabel = slotLabels[slot];

      // Calculate actual appointment time for the visit date
      const visitDate = new Date(session.appointmentDate);
      visitDate.setDate(visitDate.getDate() + 1); // Reminder was day before
      const slotHours = { morning: 8, mid_morning: 10, afternoon: 12 };
      visitDate.setHours(slotHours[slot], 0, 0, 0);

      session.appointmentTime = visitDate.toISOString();
      await sessionLib.saveSession(patientId, session);

      // Store appointment in appointments table (or triage_logs for Expected Patients)
      try {
        await supabase.from('triage_logs').insert({
          patient_id: patientId,
          triage_level: session.lastTriage?.triage_level || 'GREEN',
          confidence: 90,
          escalation: false,
          pathway: 'booked_appointment',
          facility_name: session.appointmentFacility || session.confirmedFacility?.name || null,
          symptoms: 'Booked appointment — ' + slot + ' slot',
          slot_time: slot,
          appointment_date: visitDate.toISOString().split('T')[0],
        });
      } catch (e) {
        logger.error('[SLOT] Failed to log appointment:', e.message);
      }

      const facilityName = session.appointmentFacility || 'your clinic';
      const dateStr = visitDate.toLocaleDateString('en-ZA', { weekday: 'long', day: 'numeric', month: 'long' });
      const slotLabel = (slotLabelsTrans[lang] || slotLabelsTrans['en'])[slot];

      const confirmSlotMsg = {
        en: `✅ *Appointment Booked*\n\n📍 ${facilityName}\n📅 ${dateStr}\n🕐 ${slotLabel}\n📋 Ref: ${session.studyCode || 'BZ-' + patientId.slice(0,4).toUpperCase()}\n\nPlease arrive on time. If you can't make it, type *cancel* to free your slot for someone else.`,
        zu: `✅ *Isithuba Sibhukiwe*\n\n📍 ${facilityName}\n📅 ${dateStr}\n🕐 ${slotLabel}\n📋 Ref: ${session.studyCode || 'BZ-' + patientId.slice(0,4).toUpperCase()}\n\nSicela ufike ngesikhathi. Uma ungakwazi, bhala *cancel* ukukhulula isithuba sakho.`,
        xh: `✅ *Idinga Libhukiwe*\n\n📍 ${facilityName}\n📅 ${dateStr}\n🕐 ${slotLabel}\n📋 Ref: ${session.studyCode || 'BZ-' + patientId.slice(0,4).toUpperCase()}\n\nNceda ufike ngexesha. Ukuba awukwazi, bhala *cancel* ukukhulula ixesha lakho.`,
        af: `✅ *Afspraak Geboek*\n\n📍 ${facilityName}\n📅 ${dateStr}\n🕐 ${slotLabel}\n📋 Ref: ${session.studyCode || 'BZ-' + patientId.slice(0,4).toUpperCase()}\n\nKom asseblief op tyd. As jy nie kan nie, tik *cancel* om jou gleuf vry te stel.`,
        nso: `✅ *Nako e Beilwe*\n\n📍 ${facilityName}\n📅 ${dateStr}\n🕐 ${slotLabel}\n📋 Ref: ${session.studyCode || 'BZ-' + patientId.slice(0,4).toUpperCase()}\n\nHle tla ka nako. Ge o sa kgone, ngwala *cancel* go lokolla nako ya gago.`,
        tn: `✅ *Nako e Beilwe*\n\n📍 ${facilityName}\n📅 ${dateStr}\n🕐 ${slotLabel}\n📋 Ref: ${session.studyCode || 'BZ-' + patientId.slice(0,4).toUpperCase()}\n\nTsweetswee tla ka nako. Fa o sa kgone, kwala *cancel* go golola nako ya gago.`,
        st: `✅ *Nako e Beilwe*\n\n📍 ${facilityName}\n📅 ${dateStr}\n🕐 ${slotLabel}\n📋 Ref: ${session.studyCode || 'BZ-' + patientId.slice(0,4).toUpperCase()}\n\nKa kopo tla ka nako. Haeba o sa kgone, ngola *cancel* ho lokolla nako ya hao.`,
        ts: `✅ *Nkarhi wu Buhikiwe*\n\n📍 ${facilityName}\n📅 ${dateStr}\n🕐 ${slotLabel}\n📋 Ref: ${session.studyCode || 'BZ-' + patientId.slice(0,4).toUpperCase()}\n\nHi kombela u ta hi nkarhi. Loko u sa koti, tsala *cancel* ku ntshunxa nkarhi wa wena.`,
        ss: `✅ *Sikhatsi Sibhukiwe*\n\n📍 ${facilityName}\n📅 ${dateStr}\n🕐 ${slotLabel}\n📋 Ref: ${session.studyCode || 'BZ-' + patientId.slice(0,4).toUpperCase()}\n\nSicela ufike ngesikhatsi. Uma ungakhoni, bhala *cancel* kukhulula sikhatsi sakho.`,
        ve: `✅ *Tshifhinga tsho Bukiwa*\n\n📍 ${facilityName}\n📅 ${dateStr}\n🕐 ${slotLabel}\n📋 Ref: ${session.studyCode || 'BZ-' + patientId.slice(0,4).toUpperCase()}\n\nRi humbela ni ḓe nga tshifhinga. Arali ni sa koni, ṅwalani *cancel* u bvisa tshifhinga tshaṋu.`,
        nr: `✅ *Isikhathi Sibhukiwe*\n\n📍 ${facilityName}\n📅 ${dateStr}\n🕐 ${slotLabel}\n📋 Ref: ${session.studyCode || 'BZ-' + patientId.slice(0,4).toUpperCase()}\n\nSibawa ufike ngesikhathi. Uma ungakhoni, tlola *cancel* ukukhulula isikhathi sakho.`,
      };
      await sendWhatsAppMessage(from, confirmSlotMsg[lang] || confirmSlotMsg['en']);
      return;

    } else {
      // Invalid — re-ask
      session.awaitingSlotChoice = true;
      await sessionLib.saveSession(patientId, session);
      const retrySlotMsg = {
        en: 'Please reply with:\n1 — Morning (08:00–10:00)\n2 — Mid-morning (10:00–12:00)\n3 — Afternoon (12:00–14:00)',
        zu: 'Sicela uphendule ngo:\n1 — Ekuseni\n2 — Phakathi nosuku\n3 — Ntambama',
        xh: 'Nceda uphendule ngo:\n1 — Kusasa\n2 — Emini\n3 — Emva kwemini',
        af: 'Antwoord asseblief met:\n1 — Oggend\n2 — Middag\n3 — Namiddag',
        nso: 'Hle araba ka:\n1 — Mosong\n2 — Gare ga letšatši\n3 — Mathapama',
        tn: 'Tsweetswee araba ka:\n1 — Moso\n2 — Motshegare\n3 — Motshegare wa boraro',
        st: 'Ka kopo araba ka:\n1 — Hoseng\n2 — Motsheare\n3 — Motsheare oa boraro',
        ts: 'Hi kombela u hlamula hi:\n1 — Mixo\n2 — Nhlekanhi\n3 — Madyambu',
        ss: 'Sicela uphendvule nge:\n1 — Ekuseni\n2 — Emini\n3 — Ntambama',
        ve: 'Ri humbela ni fhindule nga:\n1 — Matsheloni\n2 — Masiari\n3 — Madekwana',
        nr: 'Sibawa uphendule nge:\n1 — Ekuseni\n2 — Emini\n3 — Ntambama',
      };
      await sendWhatsAppMessage(from, retrySlotMsg[lang] || retrySlotMsg['en']);
      return;
    }
  }

  // ==================== STEP: CANCEL APPOINTMENT ====================
  if (message.trim().toLowerCase() === 'cancel' && session.bookedSlot) {
    session.bookedSlot = null;
    session.bookedSlotLabel = null;
    session.appointmentTime = null;
    const lang = session.language || 'en';
    await sessionLib.saveSession(patientId, session);

    const cancelMsg = {
      en: '❌ Your appointment has been cancelled. Your slot is now available for someone else.\n\nIf you still need to visit the clinic, type *0* to start again.',
      zu: '❌ Isithuba sakho sikhanselelwe. Sesitholakala komunye umuntu.\n\nUma usadinga ukuya emtholampilo, bhala *0* ukuqala kabusha.',
      xh: '❌ Idinga lakho licinyiwe. Ixesha lakho lisele likhululekile.\n\nUkuba usafuna ukuya ekliniki, bhala *0* ukuqala kwakhona.',
      af: '❌ Jou afspraak is gekanselleer. Jou gleuf is nou vry.\n\nAs jy nog die kliniek wil besoek, tik *0* om weer te begin.',
      nso: '❌ Nako ya gago e khanseletswe. Nako ya gago e lokolotšwe.\n\nGe o sa nyaka go ya kliniki, ngwala *0* go thoma lefsa.',
      tn: '❌ Nako ya gago e khanseletswe. E golotšwe go motho yo mongwe.\n\nFa o sa batla go ya kliniki, kwala *0* go simolola sešwa.',
      st: '❌ Nako ya hao e khanseletswe. E lokolotswe bakeng sa e mong.\n\nHaeba o sa batla ho ya kliniki, ngola *0* ho qala bocha.',
      ts: '❌ Nkarhi wa wena wu khanseleriwile. Wu ntshunxiwile.\n\nLoko u ha lava ku ya ekliniki, tsala *0* ku sungula hi vuntshwa.',
      ss: '❌ Sikhatsi sakho sikhanselelwe. Sikhululekile.\n\nNawusadzinga kuya emtfolamphilo, bhala *0* kucala kabusha.',
      ve: '❌ Tshifhinga tshaṋu tsho khansela. Tsho bviswa.\n\nArali ni tshi kha ḓi ṱoḓa u ya kiliniki, ṅwalani *0* u thoma hafhu.',
      nr: '❌ Isikhathi sakho sikhanselelwe. Sikhululekile.\n\nNawusadzinga ukuya ekliniki, tlola *0* ukuthoma kabutjha.',
    };
    await sendWhatsAppMessage(from, cancelMsg[lang] || cancelMsg['en']);
    return;
  }

  // ==================== STEP: GREEN CLINIC CHOICE ====================
  // GREEN patients get self-care advice then choose: visit clinic or manage at home
  // DoH flow: GREEN patients still go through General Sick Consultation if they come in
  if (session.awaitingGreenClinicChoice) {
    session.awaitingGreenClinicChoice = false;
    const lang = session.language || 'en';

    if (message === '1') {
      // YES — patient wants to visit a clinic → route through normal facility flow
      session.lastPathway = 'green_clinic_visit';
      await sessionLib.saveSession(patientId, session);

      // Use the existing facility routing logic (Step 5)
      if (!session.location) {
        session.pendingTriage = true;
        await sessionLib.saveSession(patientId, session);
        await sendWhatsAppMessage(from, msg('request_location', lang));
        return;
      }

      const nearestFacilities = await findNearestFacilities(session.location, 'clinic', 3);
      if (nearestFacilities.length > 0) {
        const nearest = nearestFacilities[0];
        session.suggestedFacility = nearest;
        session.alternativeFacilities = nearestFacilities.slice(1);
        session.awaitingFacilityConfirm = true;
        await sessionLib.saveSession(patientId, session);
        await sendFacilitySuggest(from, lang, nearest, session.lastTriage?.triage_level);
        return;
      }

      // No facilities found — give generic guidance
      await sessionLib.logTriage({
        patient_id: patientId,
        whatsapp_message_id: messageId,
        triage_level: 'GREEN',
        confidence: session.lastTriage?.confidence || 80,
        escalation: false,
        pathway: 'green_clinic_visit',
        facility_name: null,
        location: session.location || null,
        symptoms: session.lastSymptoms
      });
      await sessionLib.scheduleFollowUp(patientId, from, 'GREEN');
      await sendWhatsAppMessage(from, msg('tips', lang));
      await sessionLib.saveSession(patientId, session);
      return;

    } else if (message === '2') {
      // NO — patient will manage at home → self-care only + follow-up
      await sessionLib.logTriage({
        patient_id: patientId,
        whatsapp_message_id: messageId,
        triage_level: 'GREEN',
        confidence: session.lastTriage?.confidence || 80,
        escalation: false,
        pathway: 'self_care_home',
        facility_name: null,
        location: session.location || null,
        symptoms: session.lastSymptoms
      });
      await sessionLib.scheduleFollowUp(patientId, from, 'GREEN');
      await sendWhatsAppMessage(from, msg('tips', lang));
      await sessionLib.saveSession(patientId, session);
      return;

    } else {
      // Invalid — re-ask
      session.awaitingGreenClinicChoice = true;
      await sessionLib.saveSession(patientId, session);
      const retryGreenMsg = { en: 'Please reply with:\n1 — Yes, help me find a clinic\n2 — No, I will manage at home', zu: 'Sicela uphendule ngo:\n1 — Yebo, ngisizeni\n2 — Cha, ngizozinakekela', xh: 'Nceda uphendule ngo:\n1 — Ewe, ndincedeni\n2 — Hayi, ndiza kuzinakekela', af: 'Antwoord asseblief met:\n1 — Ja, help my\n2 — Nee, ek sal regkom', nso: 'Hle araba ka:\n1 — Ee, nthušeng\n2 — Aowa, ke tla itlhokomela', tn: 'Tsweetswee araba ka:\n1 — Ee, nthuseng\n2 — Nnyaa, ke tla ipabalela', st: 'Ka kopo araba ka:\n1 — E, nthuseng\n2 — Tjhe, ke tla ipaballa', ts: 'Hi kombela u hlamula hi:\n1 — Ina, ndzi pfuneni\n2 — Ee-ee, ndzi ta titlhokomela', ss: 'Sicela uphendvule nge:\n1 — Yebo, ngisiteni\n2 — Cha, ngitawutinakekela', ve: 'Ri humbela ni fhindule nga:\n1 — Ee, nthuseni\n2 — Hai, ndi ḓo ḓilondola', nr: 'Sibawa uphendule nge:\n1 — Iye, ngisizeni\n2 — Awa, ngizozinakekela' };
      await sendWhatsAppMessage(from, retryGreenMsg[lang] || retryGreenMsg['en']);
      return;
    }
  }

  // ==================== STEP: CHRONIC COLLECTION POINT TYPE ====================
  // Patient chose Category 8 + Mild (stable) and we asked WHERE they collect
  if (session.awaitingChronicCollectionType) {
    session.awaitingChronicCollectionType = false;
    const lang = session.language || 'en';

    if (message === '1') {
      // CLINIC COLLECTION
      // For chronic patients who haven't seen CCMDD awareness — show it first.
      // 41% of eligible patients were never told community pick-up exists (Thuli Zulu, 2026).
      // CCMDD covers HIV, hypertension, diabetes, epilepsy, asthma, and mental health.
      // No partnership needed — purely informational nudge.
      const hasCCMDDEligible = (session.chronicConditions || []).some(c =>
        ['hiv', 'hypertension', 'diabetes', 'epilepsy', 'asthma', 'mental_health'].includes(c.key));
      if (hasCCMDDEligible && !session.ccmddAwarenessShown) {
        session.ccmddAwarenessShown = true;
        session.awaitingCcmddAwareness = true;
        await sessionLib.saveSession(patientId, session);
        const ccmddAwarenessMsg = {
          en: '💊 *Quick question before we help you:*\n\nHave you been told you can collect your chronic medication at a *community pick-up point* near you — without queueing at the clinic?\n\n1 — Yes, I know about this\n2 — No, what is that?',
          zu: '💊 *Umbuzo omfushane:*\n\nUkwazisiwe ukuthi ungathatha umuthi wakho wamahlalakhona *endaweni yomphakathi eseduze nawe* — ngaphandle kokulinda emgceni emtholampilo?\n\n1 — Yebo, ngiyazi ngakho\n2 — Cha, yini leyo?',
          xh: '💊 *Umbuzo mfutshane:*\n\nUkwazisiwe ukuba ungathabatha amayeza akho aqhelekileyo *kwindawo yoluntu ekufutshane nawe* — ngaphandle kokulinda umgca ekliniki?\n\n1 — Ewe, ndiyazi ngako\n2 — Hayi, yintoni leyo?',
          af: '💊 *Vinnige vraag:*\n\nHet iemand jou vertel jy kan jou chroniese medikasie by \'n *gemeenskapspunt naby jou* afhaal — sonder om by die kliniek te wag?\n\n1 — Ja, ek weet daarvan\n2 — Nee, wat is dit?',
          nso: '💊 *Potšišo ya pela:*\n\nA go go boditšwe gore o ka tšea dihlare tša gago tša mahlalakhona *lefelong la setšhaba la kgauswi nawe* — ntle le go ema moleleng kliniki?\n\n1 — Ee, ke a tseba ka seo\n2 — Aowa, ke eng seo?',
          tn: '💊 *Potso ya ntlha:*\n\nA go go boleletswe gore o ka tsaya dimelemo tsa gago tsa sehalalahalalele *kwa lefelong la setlhogo la gaufi nawe* — go sa eme molelwaneng kwa kliniki?\n\n1 — Ee, ke itse ka seo\n2 — Nnyaa, ke eng seo?',
          st: '💊 *Potso ya pele:*\n\nNa o boleletswe hore o ka nka meriana ya hao ya nako e telele *sebakeng sa setjhaba se haufi nawe* — ntle le ho ema moleleng kliniki?\n\n1 — E, ke tseba ka seo\n2 — Tjhe, ke eng seo?',
          ts: '💊 *Xivutiso xa ntlhanu:*\n\nNa va ku byele leswaku u nga teka mirhi ya wena ya nkarhi wo leha *endhawini ya muganga ya kusuhi na wena* — ku si yimi emulayinini ekliniki?\n\n1 — Ina, ndzi tiva hi swona\n2 — Ee-ee, i yini leyo?',
          ss: '💊 *Umbuzo lomfisha:*\n\nUkwaziswa kutsi ungathatha imitsi yakho yesikhathi leside *endzaweni yemphakadzi liseduze nawe* — ngaphandle kokulinda emgceni emtfolamphilo?\n\n1 — Yebo, ngiyati ngako\n2 — Cha, yini leyo?',
          ve: '💊 *Mbudziso mufhufhu:*\n\nNa no vhudzwa uri ni nga dzhia mushonga waṋu wa tshifhinga tshilapfu *kha fhethu ha tshitshavha hu re tsini na inwi* — hu si na u lindela mulayinini kha kiliniki?\n\n1 — Ee, ndi ḓivha nga zwenezwo\n2 — Hai, ndi mini zwenezwo?',
          nr: '💊 *Umbuzo omfitjhani:*\n\nUkwaziswa ukuthi ungathatha imitjhoga yakho yesikhathi eside *endaweni yomphakathi eseduze nawe* — ngaphandle kokulinda emgceni ekliniki?\n\n1 — Iye, ngiyazi ngakho\n2 — Awa, yini leyo?',
        };
        await sendWhatsAppMessage(from, ccmddAwarenessMsg[lang] || ccmddAwarenessMsg['en']);
        return;
      }

      // Non-CCMDD-eligible patient — goes to clinic for nurse vitals + script renewal (not fast-track)
      session.isCcmddRegistered = false;
      session.lastPathway = 'chronic_clinic_nurse_review';
      session.awaitingClinicName = true;
      await sessionLib.saveSession(patientId, session);

      const askClinicMsg = {
        en: '🏥 Which clinic do you collect your medication from?\n\nType the *name* of your clinic.\n\nOr send your *location* 📍 (tap + → Location) and we will show clinics near you.',
        zu: '🏥 Uwuthatha kuphi umuthi wakho?\n\nBhala *igama* lomtholampilo wakho.\n\nNoma uthumele *indawo yakho* 📍 (cindezela + → Indawo) sizokukhombisa imitholampilo eseduze.',
        xh: '🏥 Uwathatha phi amayeza akho?\n\nBhala *igama* lekliniki yakho.\n\nOkanye thumela *indawo yakho* 📍 (cofa + → Indawo) siza kukubonisa iikliniki ezikufutshane.',
        af: '🏥 Waar haal jy jou medikasie af?\n\nTik die *naam* van jou kliniek.\n\nOf stuur jou *ligging* 📍 (tik + → Ligging) en ons sal klinieke naby jou wys.',
        nso: '🏥 O tšea dihlare tša gago kliniki efe?\n\nNgwala *leina* la kliniki ya gago.\n\nGoba romela *lefelo la gago* 📍 (thinta + → Lefelo) re tla go bontšha dikliniki tša kgauswi.',
        tn: '🏥 O tsaya dimelemo kwa kliniki efe?\n\nKwala *leina* la kliniki ya gago.\n\nKgotsa romela *lefelo la gago* 📍 (tobetsa + → Lefelo) re tla go bontsha dikliniki tsa gaufi.',
        st: '🏥 O nka meriana kliniki efe?\n\nNgola *lebitso* la kliniki ya hao.\n\nKapa romela *sebaka sa hao* 📍 (tobetsa + → Sebaka) re tla o bontsha dikliniki tse haufi.',
        ts: '🏥 U teka mirhi ekliniki yihi?\n\nTsala *vito* ra kliniki ya wena.\n\nKumbe rhumela *ndhawu ya wena* 📍 (thinta + → Ndhawu) hi ta ku kombela tikliniki ta kusuhi.',
        ss: '🏥 Uyitfola kuphi imitsi yakho?\n\nBhala *libito* lemtfolamphilo wakho.\n\nNoma tfumela *indzawo yakho* 📍 (cindzetsa + → Indzawo) sitakukhombisa imitfolamphilo yaseduze.',
        ve: '🏥 Ni dzhia mushonga kha kiliniki ifhio?\n\nṄwalani *dzina* la kiliniki yaṋu.\n\nKana rumelani *fhethu haṋu* 📍 (thintani + → Fhethu) ri ḓo ni sumbedza dzi kiliniki dzi re tsini.',
        nr: '🏥 Uyithatha kuphi imitjhoga yakho?\n\nTlola *ibizo* lekliniki yakho.\n\nNoma thumela *indawo yakho* 📍 (cindezela + → Indawo) sizakukhombisa amakliniki aseduze.',
      };
      await sendWhatsAppMessage(from, askClinicMsg[lang] || askClinicMsg['en']);
      return;

    } else if (message === '2' || message === '3') {
      // PHARMACY or OTHER COLLECTION
      // CCMDD works by assignment: patient's parcel goes to THEIR specific EDP.
      // We can't GPS-route to "nearest EDP" because their medication isn't there.
      // What we CAN do: confirm collection, remind what to bring, and ask if
      // they know their assigned pickup point.
      const isPharmacy = message === '2';

      const pharmacyMsg = {
        en: `✅ *No clinic visit needed.*\n\n` +
          `📋 When you collect, remember to bring:\n• Clinic card\n• ID document\n• Your chronic dispensing number\n\n` +
          (isPharmacy
            ? `If your medication is not ready at the pharmacy, contact your clinic — they can check the status of your parcel.\n\n`
            : `Do you know which pickup point your medication is sent to?\n\nIf not, ask your clinic nurse — your parcel is sent to a *specific point* and can only be collected there.\n\n`) +
          `If you feel unwell or your symptoms change, type *0* to start a new consultation.\n\nWe will check in with you in 48 hours.`,
        zu: `✅ *Akudingeki uye emtholampilo.*\n\n` +
          `📋 Uma uthatha umuthi, khumbula ukuletha:\n• Ikhadi lasemtholampilo\n• Incwadi yesazisi\n• Inombolo yakho ye-chronic\n\n` +
          (isPharmacy
            ? `Uma umuthi wakho ungakalungeli ekhemisi, thinta umtholampilo wakho — bangahlola isimo sephasela lakho.\n\n`
            : `Uyazi ukuthi iphasela lakho lithunyelwa kuphi?\n\nUma ungazi, buza unesi — umuthi wakho uthunyelwa *endaweni ethile* futhi ungathathwa kuphela lapho.\n\n`) +
          `Uma ungaphili kahle, bhala *0* ukuqala kabusha.\n\nSizokubuza emva kwamahora angu-48.`,
        xh: `✅ *Akudingeki uye ekliniki.*\n\n` +
          `📋 Xa uthatha amayeza, khumbula ukuzisa:\n• Ikhadi lasekliniki\n• Isazisi\n• Inombolo yakho ye-chronic\n\n` +
          (isPharmacy
            ? `Ukuba amayeza akho akalunganga ekemisti, qhagamshelana nekliniki yakho.\n\n`
            : `Uyazi ukuba iphaseli yakho ithunyelwa phi?\n\nUkuba awazi, buza umongikazi — amayeza akho athunyelwa *kwindawo ethile* kwaye angathathelwa kuphela apho.\n\n`) +
          `Ukuba uziva ungaphilanga, bhala *0* ukuqala ngokutsha.\n\nSiza kukubuza emva kweeyure ezingama-48.`,
        af: `✅ *Geen kliniekbesoek nodig nie.*\n\n` +
          `📋 Wanneer jy afhaal, onthou om te bring:\n• Kliniekkaart\n• ID-dokument\n• Jou chroniese uitdeelnommer\n\n` +
          (isPharmacy
            ? `As jou medikasie nie by die apteek gereed is nie, kontak jou kliniek — hulle kan die status van jou pakkie nagaan.\n\n`
            : `Weet jy na watter afhaalpunt jou medikasie gestuur word?\n\nAs jy nie weet nie, vra jou kliniekverpleegster — jou pakkie word na 'n *spesifieke punt* gestuur en kan net daar afgehaal word.\n\n`) +
          `As jy siek voel, tik *0* vir 'n nuwe konsultasie.\n\nOns sal oor 48 uur by jou inskakel.`,
      };
      await sendWhatsAppMessage(from, pharmacyMsg[lang] || pharmacyMsg.en);

      // Log triage
      await sessionLib.logTriage({
        patient_id: patientId,
        whatsapp_message_id: messageId,
        triage_level: 'GREEN',
        confidence: 95,
        escalation: false,
        pathway: isPharmacy ? 'chronic_bypass_pharmacy' : 'chronic_bypass_external',
        symptoms: 'Stable chronic patient — ' + (isPharmacy ? 'pharmacy' : 'external') + ' medication collection',
      });
      await sessionLib.scheduleFollowUp(patientId, from, 'GREEN');
      await sendWhatsAppMessage(from, msg('tips', lang));
      await sessionLib.saveSession(patientId, session);
      return;

    } else {
      // Invalid input — re-ask
      session.awaitingChronicCollectionType = true;
      await sessionLib.saveSession(patientId, session);
      const retryMsg = { en: 'Please reply with:\n1 — Clinic\n2 — Pharmacy\n3 — Other', zu: 'Sicela uphendule ngo:\n1 — Umtholampilo\n2 — Ikhemisi\n3 — Kwenye indawo', xh: 'Nceda uphendule ngo:\n1 — Ikliniki\n2 — Ikemisti\n3 — Kwenye indawo', af: 'Antwoord asseblief met:\n1 — Kliniek\n2 — Apteek\n3 — Ander', nso: 'Hle araba ka:\n1 — Kliniki\n2 — Khemisi\n3 — Lefelo le lengwe', tn: 'Tsweetswee araba ka:\n1 — Kliniki\n2 — Khemisi\n3 — Lefelo le sele', st: 'Ka kopo araba ka:\n1 — Kliniki\n2 — Khemisi\n3 — Sebaka se seng', ts: 'Hi kombela u hlamula hi:\n1 — Kliniki\n2 — Khemisi\n3 — Ndhawu yin\'wana', ss: 'Sicela uphendvule nge:\n1 — Umtfolamphilo\n2 — Ikhemisi\n3 — Endzaweni lenye', ve: 'Ri humbela ni fhindule nga:\n1 — Kiliniki\n2 — Khemisi\n3 — Huṅwe', nr: 'Sibawa uphendule nge:\n1 — Ikliniki\n2 — Ikhemisi\n3 — Kwenye indawo' };
      await sendWhatsAppMessage(from, retryMsg[lang] || retryMsg['en']);
      return;
    }
  }

  // ==================== STEP: CCMDD AWARENESS RESPONSE ====================
  // Patient responded to "have you been told about community pick-up points?"
  // Either answer → show info if needed, then proceed to clinic name input.
  if (session.awaitingCcmddAwareness) {
    session.awaitingCcmddAwareness = false;
    const lang = session.language || 'en';

    if (message === '2') {
      // Patient didn't know about CCMDD — share the key facts
      const ccmddInfoMsg = {
        en: `ℹ️ *Community Pick-Up Points (CCMDD)*\n\nIf you are stable on your chronic medication, you may be able to collect it at a *pharmacy, community hall, or pick-up point* near you — no clinic queue needed.\n\nThis is available for patients on ARVs, blood pressure medication, diabetes medication, epilepsy medication, and more.\n\n✅ Same medication. Same care.\n✅ Over 2 million SA patients already do this.\n✅ 91% satisfaction rate.\n\n*Ask your nurse or doctor to sign you up at your next clinic visit.*\n\nFor today, let us help you collect at your clinic. 💙`,
        zu: `ℹ️ *Izindawo Zomphakathi Zokukhipha Imithi (CCMDD)*\n\nUma uzinzile ema-ARV akho, ungakhona ukuwathatha *endaweni yomphakathi eseduze nawe* — ngaphandle kokulinda emgceni emtholampilo.\n\n✅ Umuthi ofanayo. Ukunakekelwa okufanayo.\n✅ Abaguli abangaphezulu kwezigidi ezimbili eNingizimu Afrika sebenza ngokunjalo.\n✅ Amazinga eneliseko angama-91%.\n\n*Cela unesi noma udokotela ukuthi akubhalisele esikhathini sakho esilandelayo semtholampilo.*\n\nKulamuhla, asisizeni ukuya emtholampilo wakho. 💙`,
        xh: `ℹ️ *Iindawo Zoluntu Zokuthatha Amayeza (CCMDD)*\n\nUkuba uzinzile kwii-ARV zakho, ungathabatha *kwindawo yoluntu ekufutshane nawe* — ngaphandle kokulinda umgca ekliniki.\n\n✅ Amayeza afanayo. Ukunyangwa okufanayo.\n✅ Abaguli abangaphezulu kwezigidi ezimbini eMzantsi Afrika benza njalo.\n✅ Inqanaba lokwaneliseka elingama-91%.\n\n*Cela umongikazi okanye ugqirha ukuba akubhalisele xa uza ekliniki okulandelayo.*\n\nNamhlanje, siza kukunceda ukuya ekliniki yakho. 💙`,
        af: `ℹ️ *Gemeenskapspunte vir Medikasie-afhaal (CCMDD)*\n\nAs jy stabiel is op jou ARV's, kan jy dit moontlik by \'n *winkel of gemeenskapspunt naby jou* afhaal — sonder die lang kliniektoue.\n\n✅ Dieselfde medikasie. Dieselfde sorg.\n✅ Meer as 2 miljoen SA-pasiënte doen dit reeds.\n✅ 91% tevredenheidsyfer.\n\n*Vra jou verpleegster of dokter om jou in te skryf tydens jou volgende kliniekbesoek.*\n\nVir vandag, help ons jou om by jou kliniek te kry. 💙`,
        nso: `ℹ️ *Mafelo a Setšhaba a go Tšea Dihlare (CCMDD)*\n\nGe o tsepame go dihlare tša ARV tša gago, o ka kgona go di tšea *lefelong la setšhaba la kgauswi nawe* — ntle le go ema moleleng kliniki.\n\n✅ Dihlare tša go swana. Tlhokomelo ya go swana.\n✅ Bagodi ba go feta dimillione tše pedi ba Afrika Borwa ba dira bjalo.\n✅ Pesentšhe ya go kgotsofala ya 91%.\n\n*Kgopela mooki goba ngaka go go ngwadiša ge o eta kliniki latelago.*\n\nLehono, re go thušeng go ya kliniki ya gago. 💙`,
        tn: `ℹ️ *Mafelo a Setlhogo a go Tsaya Dimelemo (CCMDD)*\n\nFa o tsepame mo dimelemo tsa ARV tsa gago, o ka kgona go di tsaya *kwa lefelong la setlhogo le gaufi nawe* — go sa eme molelwaneng kwa kliniki.\n\n✅ Dimelemo tse tshwanang. Tlhokomelo e tshwanang.\n✅ Bagodi ba go feta dimillione tse pedi ba Afrika Borwa ba dira jalo.\n✅ Peresente ya go kgotsofalelwa ya 91%.\n\n*Kopa mooki kgotsa ngaka go go kwadisa fa o ya kliniki latelang.*\n\nGompieno, re go thuseng ho ya kliniki ya gago. 💙`,
        st: `ℹ️ *Dibaka tsa Setjhaba tsa ho Nka Meriana (CCMDD)*\n\nHaeba o tsitsitse ho meriana ya ARV ya hao, o ka kgona ho e nka *sebakeng sa setjhaba se haufi nawe* — ntle le ho ema moleleng kliniki.\n\n✅ Meriana e tshwanang. Tlhokomelo e tshwanang.\n✅ Bakuluwa ba fetang dimilione tse pedi Afrika Borwa ba etsa jwalo.\n✅ Phesente ya ho kgotsofala ya 91%.\n\n*Kopa mooki kapa ngaka ho o ngodisa ha o ya kliniki latelang.*\n\nKajeno, a re o thuse ho ya kliniki ya hao. 💙`,
        ts: `ℹ️ *Tindhawu ta Muganga ta ku Teka Mirhi (CCMDD)*\n\nLoko u tiyile eka mirhi ya ARV ya wena, u nga kota ku yi teka *endhawini ya muganga ya kusuhi na wena* — ku si yimi emulayinini ekliniki.\n\n✅ Mirhi yo fanana. Vukorhokeri byo fanana.\n✅ Vakuluhi van\'wana ku hundza mamillioni ya mbirhi va Afrika Dzonga va endla tano.\n✅ Nkanyiso wa ku tsakelela wa 91%.\n\n*Kombela muongi kumbe nganga ku ku tsarisa loko u ya ekliniki lelandzelaka.*\n\nNamuntlha, a hi ku pfuni ku ya ekliniki ya wena. 💙`,
        ss: `ℹ️ *Tindzawo Temphakadzi Tekuthola Imitsi (CCMDD)*\n\nNangabe usimeme ema-ARV akho, ungakhona kuwathola *endzaweni yemphakadzi liseduze nawe* — ngaphandle kokulinda emgceni emtfolamphilo.\n\n✅ Imitsi lefanako. Ukunakekela lokufanako.\n✅ Tiguli letidlula timimillion letimbili Afrika Enyakatfo tenta njalo.\n✅ Inkhundla yekwaneliseka ya 91%.\n\n*Cela unesi noma udokotela kutsi akubhalisele esikhatsini sakho esilandzelako semtfolamphilo.*\n\nLamuhla, asikusite uye emtfolamphilo wakho. 💙`,
        ve: `ℹ️ *Zwifhethu zwa Tshitshavha zwa u Dzhia Mushonga (CCMDD)*\n\nArali no dzikama kha mushonga wa ARV waṋu, ni nga kona u u dzhia *kha fhethu ha tshitshavha hu re tsini na inwi* — hu si na u lindela mulayinini kha kiliniki.\n\n✅ Mushonga wa u fana. Tshumelo ya u fana.\n✅ Vhakulwi vha fhiraho miḽioni mbili Afrika Tshipembe vha ita zwenezwo.\n✅ Tshikalo tsha u fara vhufaro tsha 91%.\n\n*Humbela muongi kana nganga u ni ṅwalisa musi ni tshi ḓa kha kiliniki i ḓaho.*\n\nṋamusi, ri ḓo ni thusa u ya kha kiliniki yaṋu. 💙`,
        nr: `ℹ️ *Iindawo Zomphakathi Zokuthatha Imitjhoga (CCMDD)*\n\nNangabe uzinzile ema-ARV akho, ungakhona ukuwathatha *endaweni yomphakathi eseduze nawe* — ngaphandle kokulinda emgceni ekliniki.\n\n✅ Imitjhoga efanako. Ukunakwa okufanako.\n✅ Izikhulumi ezidlula iimiliyoni ezimbili eNingizimu Afrika zenza njalo.\n✅ Amazinga eneliseko angama-91%.\n\n*Cela unesi noma udokotela ukuthi akubhalisele esikhathini sakho esilandelako sekliniki.*\n\nNamhlanje, asikusize ukuya ekliniki yakho. 💙`,
      };
      await sendWhatsAppMessage(from, ccmddInfoMsg[lang] || ccmddInfoMsg['en']);
    }
    // Ask if they're registered on CCMDD — determines queue type at clinic
    session.awaitingCcmddRegistrationCheck = true;
    await sessionLib.saveSession(patientId, session);
    const ccmddRegMsg = {
      en: '💊 Are you registered on the *CCMDD programme* (community pick-up point or fast-track collection at clinic)?\n\n1 — Yes, I collect via CCMDD\n2 — No, I collect my medication the normal way\n3 — I\'m not sure',
      zu: '💊 Ubhaliswe ohlelweni lwe-*CCMDD* (indawo yomphakathi noma ukuthatha ngokushesha emtholampilo)?\n\n1 — Yebo, ngithatha nge-CCMDD\n2 — Cha, ngithatha umuthi ngendlela ejwayelekile\n3 — Angiqiniseki',
      xh: '💊 Ubhaliswe kwi-*CCMDD* (indawo yoluntu okanye ukuthatha ngokukhawuleza ekliniki)?\n\n1 — Ewe, ndithatha nge-CCMDD\n2 — Hayi, ndithatha amayeza am ngendlela eqhelekileyo\n3 — Andiqinisekanga',
      af: '💊 Is jy geregistreer op die *CCMDD-program* (gemeenskapspunt of vinnige afhaal by kliniek)?\n\n1 — Ja, ek haal via CCMDD af\n2 — Nee, ek haal my medikasie op die gewone manier af\n3 — Ek is nie seker nie',
    };
    await sendWhatsAppMessage(from, ccmddRegMsg[lang] || ccmddRegMsg['en']);
    return;
  }

  // ── CCMDD registration check response ──
  if (session.awaitingCcmddRegistrationCheck) {
    session.awaitingCcmddRegistrationCheck = false;
    const lang = session.language || 'en';

    if (message === '1') {
      // CCMDD registered — fast-track collection, no nurse needed
      session.isCcmddRegistered = true;
      session.lastPathway = 'chronic_bypass_ccmdd';
    } else {
      // Not CCMDD or unsure — nurse needs to check vitals and renew script
      session.isCcmddRegistered = false;
      session.lastPathway = 'chronic_clinic_nurse_review';
    }

    // Ask when their script was last renewed (for 6-month tracking)
    session.awaitingScriptRenewalDate = true;
    await sessionLib.saveSession(patientId, session);
    const scriptMsg = {
      en: '📋 When was your prescription (script) last renewed by a doctor?\n\n1 — Less than 3 months ago\n2 — 3-6 months ago\n3 — More than 6 months ago\n4 — I don\'t know',
      zu: '📋 Iresiphi yakho (iskripthi) yagcinwa nini ngokugcina udokotela?\n\n1 — Ezinyangeni ezi-3 ezedlule\n2 — Ezinyangeni ezi-3 kuya kwezi-6 ezedlule\n3 — Ngaphezu kwezinyanga ezi-6 ezedlule\n4 — Angazi',
      xh: '📋 Iresiphi yakho (iskripthi) yahlaziywa nini ngokugqibela ngugqirha?\n\n1 — Ngaphantsi kweenyanga ezi-3 ezidlulileyo\n2 — Iinyanga ezi-3 ukuya kwezi-6 ezidlulileyo\n3 — Ngaphezulu kweenyanga ezi-6 ezidlulileyo\n4 — Andazi',
      af: '📋 Wanneer is jou voorskrif laas deur \'n dokter hernu?\n\n1 — Minder as 3 maande gelede\n2 — 3-6 maande gelede\n3 — Meer as 6 maande gelede\n4 — Ek weet nie',
    };
    await sendWhatsAppMessage(from, scriptMsg[lang] || scriptMsg['en']);
    return;
  }

  // ── Script renewal date response ──
  if (session.awaitingScriptRenewalDate) {
    session.awaitingScriptRenewalDate = false;
    const lang = session.language || 'en';

    const renewalMap = {
      '1': 'recent',     // <3 months — no action needed
      '2': 'due_soon',   // 3-6 months — will need renewal soon
      '3': 'overdue',    // >6 months — script may have expired
      '4': 'unknown',    // Don't know
    };
    session.scriptRenewalStatus = renewalMap[message] || 'unknown';

    if (session.scriptRenewalStatus === 'overdue') {
      // Script likely expired — warn patient they'll need a doctor review
      const overdueMsg = {
        en: '⚠️ Your prescription may have expired (scripts are valid for 6 months). The nurse will check when you arrive and may refer you to the doctor for a renewal.\n\nPlease bring your old prescription and clinic card.',
        zu: '⚠️ Iresiphi yakho ingase iphelelwe yisikhathi (izikripthi zisebenza izinyanga ezi-6). Unesi uzohlola uma ufika futhi angakudlulisela kudokotela ukuze ivuselelwe.\n\nSicela ulethe iresiphi yakho endala nekhadi lasemtholampilo.',
        xh: '⚠️ Iresiphi yakho ingase iphelelwe lixesha (iiskripthi zisebenza iinyanga ezi-6). Umongikazi uya kuhlola xa ufika kwaye anokukudlulisela kugqirha ukuze ihlaziywe.\n\nNceda uzise iresiphi yakho endala nekhadi lasekliniki.',
        af: '⚠️ Jou voorskrif het moontlik verval (voorskrifte is geldig vir 6 maande). Die verpleegster sal nagaan wanneer jy aankom en mag jou na die dokter verwys vir hernuwing.\n\nBring asseblief jou ou voorskrif en kliniekkaart saam.',
      };
      await sendWhatsAppMessage(from, overdueMsg[lang] || overdueMsg['en']);

      // Override pathway — needs nurse review even if CCMDD registered
      session.lastPathway = 'chronic_clinic_nurse_review';
    } else if (session.scriptRenewalStatus === 'due_soon') {
      // Script valid but renewal approaching — schedule a reminder
      // Approximate: if 3-6 months ago, reminder in ~2 months
      try {
        await supabase.from('follow_ups').insert({
          patient_id: patientId,
          phone: from,
          triage_level: 'GREEN',
          scheduled_at: new Date(Date.now() + 60 * 24 * 60 * 60 * 1000), // ~2 months
          status: 'pending',
          type: 'script_renewal_reminder',
          data: JSON.stringify({ facility_name: session.confirmedFacility?.name }),
        });
      } catch (e) { /* non-critical */ }
    }

    // Proceed to ask which clinic
    session.awaitingClinicName = true;
    await sessionLib.saveSession(patientId, session);
    const proceedClinicMsg = {
      en: '🏥 Which clinic do you collect your medication from?\n\nType the *name* of your clinic.\n\nOr send your *location* 📍 (tap + → Location) and we will show clinics near you.',
      zu: '🏥 Uwuthatha kuphi umuthi wakho?\n\nBhala *igama* lomtholampilo wakho.\n\nNoma uthumele *indawo yakho* 📍 (cindezela + → Indawo) sizokukhombisa imitholampilo eseduze.',
      xh: '🏥 Uwathatha phi amayeza akho?\n\nBhala *igama* lekliniki yakho.\n\nOkanye thumela *indawo yakho* 📍 (cofa + → Indawo) siza kukubonisa iikliniki ezikufutshane.',
      af: '🏥 Waar haal jy jou medikasie af?\n\nTik die *naam* van jou kliniek.\n\nOf stuur jou *ligging* 📍 (tik + → Ligging) en ons sal klinieke naby jou wys.',
      nso: '🏥 O tšea dihlare tša gago kliniki efe?\n\nNgwala *leina* la kliniki ya gago.\n\nGoba romela *lefelo la gago* 📍 (thinta + → Lefelo) re tla go bontšha dikliniki tša kgauswi.',
      tn: '🏥 O tsaya dimelemo kwa kliniki efe?\n\nKwala *leina* la kliniki ya gago.\n\nKgotsa romela *lefelo la gago* 📍 (tobetsa + → Lefelo) re tla go bontsha dikliniki tsa gaufi.',
      st: '🏥 O nka meriana kliniki efe?\n\nNgola *lebitso* la kliniki ya hao.\n\nKapa romela *sebaka sa hao* 📍 (tobetsa + → Sebaka) re tla o bontsha dikliniki tse haufi.',
      ts: '🏥 U teka mirhi ekliniki yihi?\n\nTsala *vito* ra kliniki ya wena.\n\nKumbe rhumela *ndhawu ya wena* 📍 (thinta + → Ndhawu) hi ta ku kombela tikliniki ta kusuhi.',
      ss: '🏥 Uyitfola kuphi imitsi yakho?\n\nBhala *libito* lemtfolamphilo wakho.\n\nNoma tfumela *indzawo yakho* 📍 (cindzetsa + → Indzawo) sitakukhombisa imitfolamphilo yaseduze.',
      ve: '🏥 Ni dzhia mushonga kha kiliniki ifhio?\n\nṄwalani *dzina* la kiliniki yaṋu.\n\nKana rumelani *fhethu haṋu* 📍 (thintani + → Fhethu) ri ḓo ni sumbedza dzi kiliniki dzi re tsini.',
      nr: '🏥 Uyithatha kuphi imitjhoga yakho?\n\nTlola *ibizo* lekliniki yakho.\n\nNoma thumela *indawo yakho* 📍 (cindezela + → Indawo) sizakukhombisa amakliniki aseduze.',
    };
    await sendWhatsAppMessage(from, proceedClinicMsg[lang] || proceedClinicMsg['en']);
    return;
  }

  // ==================== STEP: CHRONIC CLINIC NAME INPUT ====================
  // Patient chose "1 — At a clinic" and we asked which clinic they collect from
  // They can type a name or send a location pin
  if (session.awaitingClinicName) {
    session.awaitingClinicName = false;
    const lang = session.language || 'en';

    // If a location was recently saved (from handleMessage location handler), use it
    if (session.location && session._locationJustReceived) {
      session._locationJustReceived = false;
      const nearestFacilities = await findNearestFacilities(session.location, 'clinic', 5);
      if (nearestFacilities.length > 0) {
        const listStr = nearestFacilities.map((f, i) =>
          `${i + 1}. *${f.name}* (${f.distance} km)`
        ).join('\n');
        session.chronicClinicOptions = nearestFacilities;
        session.awaitingChronicClinicChoice = true;
        await sessionLib.saveSession(patientId, session);

        const pickMsg = {
          en: `📍 Clinics near you:\n\n${listStr}\n\nReply with the *number* of your clinic.`,
          zu: `📍 Imitholampilo eseduze nawe:\n\n${listStr}\n\nPhendula nge-*nombolo* yomtholampilo wakho.`,
          xh: `📍 Iikliniki ezikufutshane nawe:\n\n${listStr}\n\nPhendula nge-*nombolo* yekliniki yakho.`,
          af: `📍 Klinieke naby jou:\n\n${listStr}\n\nAntwoord met die *nommer* van jou kliniek.`,
          nso: `📍 Dikliniki tša kgauswi le wena:\n\n${listStr}\n\nAraba ka *nomoro* ya kliniki ya gago.`,
          tn: `📍 Dikliniki tsa gaufi le wena:\n\n${listStr}\n\nAraba ka *nomoro* ya kliniki ya gago.`,
          st: `📍 Dikliniki tse haufi le wena:\n\n${listStr}\n\nAraba ka *nomoro* ya kliniki ya hao.`,
          ts: `📍 Tikliniki ta kusuhi na wena:\n\n${listStr}\n\nHlamula hi *nomboro* ya kliniki ya wena.`,
          ss: `📍 Tinkliniki letiseduze nawe:\n\n${listStr}\n\nPhendvula nge-*nombolo* yemtfolamphilo wakho.`,
          ve: `📍 Dzi kiliniki dzi re tsini na inwi:\n\n${listStr}\n\nFhindulani nga *nomboro* ya kiliniki yaṋu.`,
          nr: `📍 Amakliniki aseduze nawe:\n\n${listStr}\n\nPhendula nge-*nomboro* yekliniki yakho.`,
        };
        await sendWhatsAppMessage(from, pickMsg[lang] || pickMsg['en']);
        return;
      }
    }

    // They typed a clinic name — search for it in facilities using fuzzy matching
    {
      const typedName = message.trim();
      const facilities = await getFacilities();
      
      // Multi-layer matching: exact → contains → fuzzy (handles typos)
      // Layer 1: Exact substring match (case-insensitive)
      let matches = facilities.filter(f => 
        f.name && f.name.toLowerCase().includes(typedName.toLowerCase())
      );

      // Layer 2: Reverse contains (facility name contains in typed text, e.g. typed "Eersterust Clinic CHC" matches "Eersterust CHC")
      if (matches.length === 0) {
        matches = facilities.filter(f => {
          if (!f.name) return false;
          const words = f.name.toLowerCase().split(/\s+/);
          return words.some(w => w.length > 2 && typedName.toLowerCase().includes(w));
        });
      }

      // Layer 3: Fuzzy match using Levenshtein distance (handles typos like "Eerstrust" → "Eersterust")
      if (matches.length === 0 && typedName.length >= 3) {
        const scored = facilities.filter(f => f.name).map(f => {
          const fName = f.name.toLowerCase();
          const tName = typedName.toLowerCase();
          
          // Score each word in the facility name against the typed text
          const fWords = fName.split(/\s+/);
          const tWords = tName.split(/\s+/);
          
          let bestScore = Infinity;
          for (const fw of fWords) {
            if (fw.length < 3) continue; // Skip short words like "the", "of", "chc"
            for (const tw of tWords) {
              if (tw.length < 3) continue;
              const dist = sessionLib.levenshtein(fw, tw);
              const maxLen = Math.max(fw.length, tw.length);
              const similarity = 1 - (dist / maxLen);
              if (similarity > 0.6) { // 60%+ similarity threshold
                bestScore = Math.min(bestScore, dist);
              }
            }
            // Also check full typed name against each facility word
            const distFull = sessionLib.levenshtein(fw, tName);
            const maxLenFull = Math.max(fw.length, tName.length);
            if ((1 - distFull / maxLenFull) > 0.6) {
              bestScore = Math.min(bestScore, distFull);
            }
          }
          return { facility: f, score: bestScore };
        }).filter(s => s.score < Infinity)
          .sort((a, b) => a.score - b.score);

        matches = scored.slice(0, 5).map(s => s.facility);
      }

      // Layer 4: If still nothing, try matching just the first word (patients often type just "Mamelodi" for "Mamelodi Day Hospital")
      if (matches.length === 0 && typedName.length >= 3) {
        const firstWord = typedName.toLowerCase().split(/\s+/)[0];
        if (firstWord.length >= 3) {
          matches = facilities.filter(f => 
            f.name && f.name.toLowerCase().split(/\s+/).some(w => 
              w.startsWith(firstWord.slice(0, 3)) || firstWord.startsWith(w.slice(0, 3))
            )
          );
        }
      }

      if (matches.length === 1) {
        // Exact single match — confirm directly
        const facility = matches[0];
        session.suggestedFacility = facility;
        session.alternativeFacilities = [];
        session.awaitingFacilityConfirm = true;
        await sessionLib.saveSession(patientId, session);

        const confirmMsg = {
          en: `🏥 Did you mean: *${facility.name}*?\n\n1 — Yes, that's my clinic\n2 — No, let me try again`,
          zu: `🏥 Ubusho: *${facility.name}*?\n\n1 — Yebo, ngilo umtholampilo wami\n2 — Cha, ngizama futhi`,
          xh: `🏥 Ubuthetha: *${facility.name}*?\n\n1 — Ewe, yiyo ikliniki yam\n2 — Hayi, mandizame kwakhona`,
          af: `🏥 Bedoel jy: *${facility.name}*?\n\n1 — Ja, dis my kliniek\n2 — Nee, laat ek weer probeer`,
          nso: `🏥 O be o ra: *${facility.name}*?\n\n1 — Ee, ke kliniki ya ka\n2 — Aowa, ke leka gape`,
          tn: `🏥 A o ne o raya: *${facility.name}*?\n\n1 — Ee, ke kliniki ya me\n2 — Nnyaa, ke leka gape`,
          st: `🏥 Na o ne o bolela: *${facility.name}*?\n\n1 — E, ke kliniki ya ka\n2 — Tjhe, ke leka hape`,
          ts: `🏥 Xana u vula: *${facility.name}*?\n\n1 — Ina, i kliniki ya mina\n2 — Ee-ee, ndzi ringeta nakambe`,
          ss: `🏥 Bewusho: *${facility.name}*?\n\n1 — Yebo, yinkliniki yami\n2 — Cha, ngitama futsi`,
          ve: `🏥 No vha ni tshi amba: *${facility.name}*?\n\n1 — Ee, ndi kiliniki yanga\n2 — Hai, ndi linga hafhu`,
          nr: `🏥 Bewutjho: *${facility.name}*?\n\n1 — Iye, yikliniki yami\n2 — Awa, ngilinga godu`,
        };
        await sendWhatsAppMessage(from, confirmMsg[lang] || confirmMsg['en']);

        await sessionLib.logTriage({
          patient_id: patientId,
          whatsapp_message_id: messageId,
          triage_level: 'GREEN',
          confidence: 95,
          escalation: false,
          pathway: 'chronic_bypass_clinic',
          facility_name: facility.name,
          symptoms: 'Stable chronic patient — clinic medication collection',
        });
        return;

      } else if (matches.length > 1) {
        // Multiple matches — let patient pick
        const listStr = matches.slice(0, 5).map((f, i) =>
          `${i + 1}. *${f.name}*`
        ).join('\n');
        session.chronicClinicOptions = matches.slice(0, 5);
        session.awaitingChronicClinicChoice = true;
        await sessionLib.saveSession(patientId, session);

        const multiMsg = {
          en: `We found several clinics matching "${typedName}":\n\n${listStr}\n\nReply with the *number* of your clinic.`,
          zu: `Sithole imitholampilo eminingi efana no-"${typedName}":\n\n${listStr}\n\nPhendula nge-*nombolo* yomtholampilo wakho.`,
          xh: `Sifumene iikliniki ezininzi ezifana no-"${typedName}":\n\n${listStr}\n\nPhendula nge-*nombolo* yekliniki yakho.`,
          af: `Ons het verskeie klinieke gevind wat pas by "${typedName}":\n\n${listStr}\n\nAntwoord met die *nommer* van jou kliniek.`,
          nso: `Re hweditše dikliniki tše mmalwa tšeo di swanago le "${typedName}":\n\n${listStr}\n\nAraba ka *nomoro* ya kliniki ya gago.`,
          tn: `Re bone dikliniki di le mmalwa tse di tshwanang le "${typedName}":\n\n${listStr}\n\nAraba ka *nomoro* ya kliniki ya gago.`,
          st: `Re fumane dikliniki tse ngata tse tshwanang le "${typedName}":\n\n${listStr}\n\nAraba ka *nomoro* ya kliniki ya hao.`,
          ts: `Hi kumile tikliniki to tala leti fanaka na "${typedName}":\n\n${listStr}\n\nHlamula hi *nomboro* ya kliniki ya wena.`,
          ss: `Sitfole tinkliniki letinyenti letifana ne-"${typedName}":\n\n${listStr}\n\nPhendvula nge-*nombolo* yemtfolamphilo wakho.`,
          ve: `Ro wana dzi kiliniki nnzhi dzine dza fana na "${typedName}":\n\n${listStr}\n\nFhindulani nga *nomboro* ya kiliniki yaṋu.`,
          nr: `Sifumene amakliniki amanengi afana ne-"${typedName}":\n\n${listStr}\n\nPhendula nge-*nomboro* yekliniki yakho.`,
        };
        await sendWhatsAppMessage(from, multiMsg[lang] || multiMsg['en']);
        return;

      } else {
        // No match — ask them to try again or send location
        session.awaitingClinicName = true;
        await sessionLib.saveSession(patientId, session);

        const noMatchMsg = {
          en: `We couldn't find a clinic called "${typedName}".\n\nPlease try again — type the clinic name, or send your *location* 📍 so we can show clinics near you.`,
          zu: `Asiwutholanga umtholampilo obizwa ngokuthi "${typedName}".\n\nSicela uzame futhi — bhala igama lomtholampilo, noma uthumele *indawo yakho* 📍.`,
          xh: `Asiyifumananga ikliniki ebizwa ngokuba "${typedName}".\n\nNceda uzame kwakhona — bhala igama lekliniki, okanye thumela *indawo yakho* 📍.`,
          af: `Ons kon nie \'n kliniek genaamd "${typedName}" vind nie.\n\nProbeer asseblief weer — tik die klinieks naam, of stuur jou *ligging* 📍.`,
          nso: `Ga re a hwetša kliniki ye e bitšwago "${typedName}".\n\nHle leka gape — ngwala leina la kliniki, goba romela *lefelo la gago* 📍.`,
          tn: `Ga re a bona kliniki e e bidiwang "${typedName}".\n\nTsweetswee leka gape — kwala leina la kliniki, kgotsa romela *lefelo la gago* 📍.`,
          st: `Ha re a fumana kliniki e bitswang "${typedName}".\n\nKa kopo leka hape — ngola lebitso la kliniki, kapa romela *sebaka sa hao* 📍.`,
          ts: `A hi kumanga kliniki leyi vuriwaka "${typedName}".\n\nHi kombela u ringeta nakambe — tsala vito ra kliniki, kumbe rhumela *ndhawu ya wena* 📍.`,
          ss: `Asiyitfolanga inkliniki lebitwa ngekutsi "${typedName}".\n\nSicela utame futsi — bhala libito lenkliniki, noma tfumela *indzawo yakho* 📍.`,
          ve: `A ro ngo wana kiliniki ine ya vhidzwa "${typedName}".\n\nRi humbela ni linge hafhu — ṅwalani dzina la kiliniki, kana rumelani *fhethu haṋu* 📍.`,
          nr: `Asiyifumananga ikliniki ebizwa ngokuthi "${typedName}".\n\nSibawa ulinge godu — tlola ibizo lekliniki, noma thumela *indawo yakho* 📍.`,
        };
        await sendWhatsAppMessage(from, noMatchMsg[lang] || noMatchMsg['en']);
        return;
      }
    }

    // Other message types — re-ask
    session.awaitingClinicName = true;
    await sessionLib.saveSession(patientId, session);
    await sendWhatsAppMessage(from, msg('request_location', lang));
    return;
  }

  // ==================== STEP: CHRONIC CLINIC CHOICE (from list) ====================
  // Patient sent location or name matched multiple — they're picking from a numbered list
  if (session.awaitingChronicClinicChoice) {
    session.awaitingChronicClinicChoice = false;
    const lang = session.language || 'en';
    const options = session.chronicClinicOptions || [];
    const choice = parseInt(message);

    if (choice >= 1 && choice <= options.length) {
      const facility = options[choice - 1];
      session.suggestedFacility = facility;
      session.alternativeFacilities = options.filter((_, i) => i !== choice - 1);
      session.confirmedFacility = facility;
      session.chronicClinicOptions = null;
      await sessionLib.saveSession(patientId, session);

      // Confirm and add to queue
      await sendWhatsAppMessage(from, msg('facility_confirmed', lang, facility.name));

      await sessionLib.logTriage({
        patient_id: patientId,
        whatsapp_message_id: messageId,
        triage_level: 'GREEN',
        confidence: 95,
        escalation: false,
        pathway: 'chronic_bypass_clinic',
        facility_name: facility.name,
        location: session.location || null,
        symptoms: 'Stable chronic patient — clinic medication collection',
      });

      await autoAddToQueue(patientId, from, session);
      await sessionLib.scheduleFollowUp(patientId, from, 'GREEN');
      await sendWhatsAppMessage(from, msg('tips', lang));
      return;
    }

    // Invalid choice — re-show list
    session.awaitingChronicClinicChoice = true;
    await sessionLib.saveSession(patientId, session);
    const retryListMsg = { en: `Please reply with a number from the list (1-${options.length}).`, zu: `Sicela uphendule ngenombolo kuhlelo (1-${options.length}).`, xh: `Nceda uphendule ngenombolo kuluhlu (1-${options.length}).`, af: `Antwoord asseblief met 'n nommer van die lys (1-${options.length}).`, nso: `Hle araba ka nomoro go tšwa lenaneong (1-${options.length}).`, tn: `Tsweetswee araba ka nomoro go tswa lenaneong (1-${options.length}).`, st: `Ka kopo araba ka nomoro ho tswa lenaneong (1-${options.length}).`, ts: `Hi kombela u hlamula hi nomboro eka nxaxamelo (1-${options.length}).`, ss: `Sicela uphendvule ngenombolo kuloluhla (1-${options.length}).`, ve: `Ri humbela ni fhindule nga nomboro kha luṅwalo (1-${options.length}).`, nr: `Sibawa uphendule ngenomboro kuloluhlelo (1-${options.length}).` };
    await sendWhatsAppMessage(from, retryListMsg[lang] || retryListMsg['en']);
    return;
  }

  // ==================== STEP: TCC ROUTING (GBV pathway) ====================
  if (session.awaitingTCCChoice) {
    session.awaitingTCCChoice = false;
    await sessionLib.saveSession(patientId, session);

    if (message === '1' && session.location) {
      // Find nearest hospital (TCCs are at hospitals)
      const hospitals = await findNearestFacilities(session.location, 'hospital', 3).catch(() => []);
      if (hospitals.length > 0) {
        const nearest = hospitals[0];
        const tccMsg = {
          en: `🏥 The nearest hospital with a Thuthuzela Care Centre is:\n\n*${nearest.name}* (${nearest.distance} km)\n\n` +
            `📍 Go directly to the hospital and ask for the *Thuthuzela Care Centre* or the *Casualty/Emergency department*.\n\n` +
            `Tell them: "I need to see the Thuthuzela team."\n\n` +
            `They will help you with:\n• Medical examination\n• HIV PEP medication\n• Emergency contraception\n• Counselling\n• Opening a police case\n\n` +
            `Remember: *0800 428 428* (GBV helpline, free, 24/7)`,
          zu: `🏥 Isibhedlela esiseduze esine-Thuthuzela Care Centre:\n\n*${nearest.name}* (${nearest.distance} km)\n\n` +
            `📍 Yana ngqo esibhedlela ucele *i-Thuthuzela Care Centre* noma *i-Casualty*.\n\n` +
            `Batshele: "Ngidinga ukubona ithimba le-Thuthuzela."\n\n` +
            `Khumbula: *0800 428 428* (usizo lwe-GBV, mahhala, 24/7)`,
          xh: `🏥 Esibhedlele esikufutshane esine-Thuthuzela Care Centre:\n\n*${nearest.name}* (${nearest.distance} km)\n\n` +
            `📍 Yiya ngqo esibhedlele ucele *i-Thuthuzela Care Centre* okanye *i-Casualty*.\n\n` +
            `Baxelele: "Ndifuna ukubona iqela le-Thuthuzela."\n\n` +
            `Khumbula: *0800 428 428* (uncedo lwe-GBV, simahla, 24/7)`,
          af: `🏥 Die naaste hospitaal met 'n Thuthuzela Care Centre:\n\n*${nearest.name}* (${nearest.distance} km)\n\n` +
            `📍 Gaan direk na die hospitaal en vra vir die *Thuthuzela Care Centre* of die *Noodafdeling*.\n\n` +
            `Sê vir hulle: "Ek moet die Thuthuzela-span sien."\n\n` +
            `Onthou: *0800 428 428* (GBV-hulplyn, gratis, 24/7)`,
        };
        await sendWhatsAppMessage(from, tccMsg[lang] || tccMsg.en);

        // Send GPS pin
        if (nearest.latitude && nearest.longitude) {
          try {
            await sendWhatsAppMessage(from, {
              type: 'location',
              location: { latitude: nearest.latitude, longitude: nearest.longitude, name: nearest.name }
            });
          } catch (e) { /* GPS pin is non-critical */ }
        }
      } else {
        // No hospital found — give helpline
        const fallbackMsg = {
          en: `We couldn't find a nearby hospital. Please call the GBV helpline now: *0800 428 428* (free, 24/7). They will tell you where the nearest Thuthuzela Care Centre is.`,
          zu: `Asikwazanga ukuthola isibhedlela esiseduze. Sicela ushayele i-GBV helpline manje: *0800 428 428* (mahhala, 24/7).`,
          xh: `Asikwazanga ukufumana isibhedlele esikufutshane. Nceda utsalele i-GBV helpline ngoku: *0800 428 428* (simahla, 24/7).`,
          af: `Ons kon nie 'n nabye hospitaal vind nie. Bel asseblief die GBV-hulplyn nou: *0800 428 428* (gratis, 24/7).`,
        };
        await sendWhatsAppMessage(from, fallbackMsg[lang] || fallbackMsg.en);
      }
    } else {
      // Patient chose "2" or no location — give helpline reminder
      const selfMsg = {
        en: `Remember these numbers:\n• GBV helpline: *0800 428 428* (free, 24/7)\n• SAPS: *10111*\n• Ambulance: *10177*\n\nYou can message us again anytime.`,
        zu: `Khumbula lezi zinombolo:\n• GBV helpline: *0800 428 428* (mahhala, 24/7)\n• SAPS: *10111*\n• Ambulensi: *10177*\n\nUngasithinta futhi nganoma yisiphi isikhathi.`,
        xh: `Khumbula ezi nombolo:\n• GBV helpline: *0800 428 428* (simahla, 24/7)\n• SAPS: *10111*\n• Ambulensi: *10177*\n\nUngasithumela umyalezo kwakhona nangaliphi na ixesha.`,
        af: `Onthou hierdie nommers:\n• GBV-hulplyn: *0800 428 428* (gratis, 24/7)\n• SAPS: *10111*\n• Ambulans: *10177*\n\nJy kan ons weer enige tyd kontak.`,
      };
      await sendWhatsAppMessage(from, selfMsg[lang] || selfMsg.en);
    }
    return;
  }

  // ==================== STEP: FACILITY CONFIRMATION ====================
  if (session.awaitingFacilityConfirm) {
    if (message === '1') {
      // Patient accepts suggested facility
      const facility = session.suggestedFacility;
      session.awaitingFacilityConfirm = false;
      session.confirmedFacility = facility;
      await sessionLib.saveSession(patientId, session);
      await sendWhatsAppMessage(from, msg('facility_confirmed', lang, facility.name));

      // Log with confirmed facility
      await sessionLib.logTriage({
        patient_id: patientId,
        whatsapp_message_id: messageId,
        triage_level: session.lastTriage?.triage_level,
        confidence: session.lastTriage?.confidence,
        escalation: false,
        pathway: session.lastPathway,
        facility_name: facility.name,
        location: session.location || null,
        symptoms: session.lastSymptoms
      });

      // Ask returning vs new (only for YELLOW/GREEN — not emergencies)
      if (session.lastTriage?.triage_level === 'YELLOW' || session.lastTriage?.triage_level === 'GREEN') {
        session.awaitingReturningPatient = true;
        await sessionLib.saveSession(patientId, session);
        await sendWhatsAppMessage(from, msg('ask_returning', lang, facility.name));
        return;
      }

      // For RED/ORANGE — skip returning question, every second counts
      // Send summary card for ORANGE (not RED — every second counts there)
      if (session.lastTriage?.triage_level === 'ORANGE') {
        await sendPatientSummaryCard(from, lang, session);
      }
      await autoAddToQueue(patientId, from, session);
      await sessionLib.scheduleFollowUp(patientId, from, session.lastTriage?.triage_level);
      await sendWhatsAppMessage(from, msg('tips', lang));
      return;
    }

    if (message === '2') {
      // Patient wants alternatives
      const alternatives = session.alternativeFacilities || [];
      if (alternatives.length === 0) {
        // For chronic bypass patients: "No, let me try again" — go back to clinic name input
        if (session.lastPathway === 'chronic_bypass_stable' || session.lastPathway === 'chronic_bypass_clinic') {
          session.awaitingFacilityConfirm = false;
          session.awaitingClinicName = true;
          await sessionLib.saveSession(patientId, session);
          const retryClinicMsg = { en: 'No problem. Type the *name* of your clinic, or send your *location* 📍.', zu: 'Kulungile. Bhala *igama* lomtholampilo, noma uthumele *indawo yakho* 📍.', xh: 'Kulungile. Bhala *igama* lekliniki, okanye thumela *indawo yakho* 📍.', af: 'Geen probleem. Tik die *naam* van jou kliniek, of stuur jou *ligging* 📍.', nso: 'Go lokile. Ngwala *leina* la kliniki, goba romela *lefelo la gago* 📍.', tn: 'Go siame. Kwala *leina* la kliniki, kgotsa romela *lefelo la gago* 📍.', st: 'Ho lokile. Ngola *lebitso* la kliniki, kapa romela *sebaka sa hao* 📍.', ts: 'Ku lunghile. Tsala *vito* ra kliniki, kumbe rhumela *ndhawu ya wena* 📍.', ss: 'Kulungile. Bhala *libito* lenkliniki, noma tfumela *indzawo yakho* 📍.', ve: 'Zwi a luga. Ṅwalani *dzina* la kiliniki, kana rumelani *fhethu haṋu* 📍.', nr: 'Kulungile. Tlola *ibizo* lekliniki, noma thumela *indawo yakho* 📍.' };
          await sendWhatsAppMessage(from, retryClinicMsg[lang] || retryClinicMsg['en']);
          return;
        }
        // Non-chronic: no alternatives — confirm original facility and complete flow
        const facility = session.suggestedFacility;
        session.awaitingFacilityConfirm = false;
        session.confirmedFacility = facility;
        await sessionLib.saveSession(patientId, session);
        await sendWhatsAppMessage(from, msg('facility_confirmed', lang, facility.name));
        await autoAddToQueue(patientId, from, session);
        await sessionLib.scheduleFollowUp(patientId, from, session.lastTriage?.triage_level);
        await sendWhatsAppMessage(from, msg('tips', lang));
        return;
      }

      const listStr = alternatives.map((f, i) =>
        `${i + 1}. *${f.name}* (${f.distance} km)`
      ).join('\n');

      session.awaitingFacilityConfirm = false;
      session.awaitingAlternativeChoice = true;
      await sessionLib.saveSession(patientId, session);
      const firstFacilityName = session.suggestedFacility?.name || null;
      await sendWhatsAppMessage(from, msg('facility_alternatives', lang, listStr, firstFacilityName));
      return;
    }

    // Invalid input — re-ask (keep awaitingFacilityConfirm true since neither branch cleared it)
    const facilityName = session.suggestedFacility?.name || 'the clinic';
    const retryMsg = {
      en: `Please reply *1* to confirm *${facilityName}* or *2* to see other options.`,
      zu: `Sicela uphendule *1* ukuqinisekisa *${facilityName}* noma *2* ukubona ezinye izindawo.`,
    };
    session.awaitingFacilityConfirm = true;
    await sessionLib.saveSession(patientId, session);
    await sendWhatsAppMessage(from, retryMsg[lang] || retryMsg['en']);
    return;
  }

  // ==================== STEP: ALTERNATIVE FACILITY CHOICE ====================
  if (session.awaitingAlternativeChoice) {
    const alternatives = session.alternativeFacilities || [];

    // Option 0: go back to first suggestion
    if (message === '0' && session.suggestedFacility) {
      const facility = session.suggestedFacility;
      session.awaitingAlternativeChoice = false;
      session.confirmedFacility = facility;
      await sessionLib.saveSession(patientId, session);
      await sendWhatsAppMessage(from, msg('facility_confirmed', lang, facility.name));

      await sessionLib.logTriage({
        patient_id: patientId,
        whatsapp_message_id: messageId,
        triage_level: session.lastTriage?.triage_level,
        confidence: session.lastTriage?.confidence,
        escalation: false,
        pathway: session.lastPathway,
        facility_name: facility.name,
        location: session.location || null,
        symptoms: session.lastSymptoms
      });

      if (session.lastTriage?.triage_level === 'YELLOW' || session.lastTriage?.triage_level === 'GREEN') {
        session.awaitingReturningPatient = true;
        await sessionLib.saveSession(patientId, session);
        await sendWhatsAppMessage(from, msg('ask_returning', lang, facility.name));
        return;
      }

      await autoAddToQueue(patientId, from, session);
      await sessionLib.scheduleFollowUp(patientId, from, session.lastTriage?.triage_level);
      await sendWhatsAppMessage(from, msg('tips', lang));
      return;
    }

    const choice = parseInt(message) - 1;

    if (choice >= 0 && choice < alternatives.length) {
      const facility = alternatives[choice];
      session.awaitingAlternativeChoice = false;
      session.confirmedFacility = facility;
      await sessionLib.saveSession(patientId, session);
      await sendWhatsAppMessage(from, msg('facility_confirmed', lang, facility.name));

      await sessionLib.logTriage({
        patient_id: patientId,
        whatsapp_message_id: messageId,
        triage_level: session.lastTriage?.triage_level,
        confidence: session.lastTriage?.confidence,
        escalation: false,
        pathway: session.lastPathway,
        facility_name: facility.name,
        location: session.location || null,
        symptoms: session.lastSymptoms
      });

      // Ask returning vs new (YELLOW/GREEN only)
      if (session.lastTriage?.triage_level === 'YELLOW' || session.lastTriage?.triage_level === 'GREEN') {
        session.awaitingReturningPatient = true;
        await sessionLib.saveSession(patientId, session);
        await sendWhatsAppMessage(from, msg('ask_returning', lang, facility.name));
        return;
      }

      // RED/ORANGE — auto-queue immediately
      await autoAddToQueue(patientId, from, session);
      await sessionLib.scheduleFollowUp(patientId, from, session.lastTriage?.triage_level);
      await sendWhatsAppMessage(from, msg('tips', lang));
      return;
    }

    // Invalid input — re-ask
    session.awaitingAlternativeChoice = true;
    await sessionLib.saveSession(patientId, session);
    const listStr = alternatives.map((f, i) => `${i + 1}. *${f.name}* (${f.distance} km)`).join('\n');
    const retryMsg = {
      en: `Please reply with a number from the list:\n\n${listStr}\n\n0 — Go back to first suggestion`,
      zu: `Sicela uphendule ngenombolo ohlwini:\n\n${listStr}\n\n0 — Buyela esiphakamisweni sokuqala`,
    };
    await sendWhatsAppMessage(from, retryMsg[lang] || retryMsg['en']);
    return;
  }

  // ==================== STEP: CLARIFICATION RESPONSE ====================
  // Patient replied with more symptom detail after a low-confidence result.
  // Re-run triage on the combined original + clarification text.
  if (session.awaitingClarification) {
    session.awaitingClarification = false;
    const combinedSymptoms = `${session.lastSymptoms || ''} ${message}`.trim();
    session.lastSymptoms = combinedSymptoms;

    // Re-run triage with richer input using proper governance pipeline
    const triageSessionCtx = {
      patientId,
      age: session.dob?.age || session.patientAge || null,
      chronicConditions: session.chronicConditions || [],
      isPregnant: session.selectedCategory === '3',
      priorHistory: await triageLib.getPatientHistory(patientId),
    };

    await sendWhatsAppMessage(from, msg('thinking', lang));
    const govResult = await governance.runTriageWithGovernance(
      combinedSymptoms, lang, session,
      (text, l) => triageLib.runTriage(text, l, triageSessionCtx),
      triageLib.applyClinicalRules
    );
    const retriage = govResult.triage;
    const stillLowConfidence = retriage.confidence < CONFIDENCE_THRESHOLD && retriage.triage_level !== 'RED';
    if (stillLowConfidence) {
      retriage.low_confidence_flag = true;
      logger.info({ patientId, confidence: retriage.confidence, level: retriage.triage_level }, '[TRIAGE] Low confidence after clarification — flagging for nurse review');
    }
    session.lastTriage = retriage;
    await sessionLib.saveSession(patientId, session);

    if (retriage.triage_level === 'RED') {
      await sendWhatsAppMessage(from, msg('triage_red', lang));
      await sessionLib.scheduleFollowUp(patientId, from, 'RED');
      return;
    }

    // Route based on new triage level — facility routing for ORANGE/YELLOW/GREEN
    if (session.location) {
      const { facilityType } = getTriagePathway(retriage.triage_level);
      const nearestFacilities = await findNearestFacilities(session.location, facilityType, 3).catch(() => []);
      if (nearestFacilities.length > 0) {
        session.suggestedFacility = nearestFacilities[0];
        session.alternativeFacilities = nearestFacilities.slice(1);
        session.awaitingFacilityConfirm = true;
        await sessionLib.saveSession(patientId, session);
        await sendWhatsAppMessage(from, msg('triage_' + retriage.triage_level.toLowerCase(), lang));
        if (stillLowConfidence) await sendWhatsAppMessage(from, msg('low_confidence_safety', lang));
        await sendFacilitySuggest(from, lang, nearestFacilities[0], retriage.triage_level);
        return;
      }
    }

    // No location — send triage result and ask for location
    await sendWhatsAppMessage(from, msg('triage_' + retriage.triage_level.toLowerCase(), lang));
    if (stillLowConfidence) await sendWhatsAppMessage(from, msg('low_confidence_safety', lang));
    session.pendingTriage = true;
    await sessionLib.saveSession(patientId, session);
    await sendWhatsAppMessage(from, msg('request_location', lang));
    return;
  }

  // ==================== STEP: TRANSPORT SAFETY (ORANGE patients) ====================
  if (session.awaitingTransportSafety) {
    session.awaitingTransportSafety = false;

    if (message === '1') {
      // Can travel safely — route to facility
      await sendWhatsAppMessage(from, msg('transport_safe', lang));
      // Continue to facility routing (same as YELLOW/GREEN flow)
      const { pathway, facilityType } = getTriagePathway(session.lastTriage.triage_level);
      session.lastPathway = pathway;

      if (!session.location) {
        session.pendingTriage = true;
        await sessionLib.saveSession(patientId, session);
        await sendWhatsAppMessage(from, msg('request_location', lang));
        return;
      }

      const nearestFacilities = await findNearestFacilities(session.location, facilityType, 3);
      if (nearestFacilities.length > 0) {
        const nearest = nearestFacilities[0];
        const alternatives = nearestFacilities.slice(1);
        session.suggestedFacility = nearest;
        session.alternativeFacilities = alternatives;

        // During clinic hours: use the specific ORANGE clinic message
        if (isClinicOpen() && facilityType === 'clinic') {
          session.awaitingFacilityConfirm = true;
          await sessionLib.saveSession(patientId, session);
          await sendWhatsAppMessage(from, msg('triage_orange_clinic', lang, nearest.name, nearest.distance));
          return;
        }

        session.awaitingFacilityConfirm = true;
        await sessionLib.saveSession(patientId, session);
        await sendFacilitySuggest(from, lang, nearest, session.lastTriage?.triage_level);
      } else {
        await sessionLib.logTriage({
          patient_id: patientId,
          whatsapp_message_id: messageId,
          triage_level: session.lastTriage.triage_level,
          confidence: session.lastTriage.confidence,
          escalation: false,
          low_confidence_flag: session.lastTriage.low_confidence_flag || false,
          pathway,
          facility_name: null,
          location: session.location || null,
          symptoms: session.lastSymptoms
        });
        await sessionLib.scheduleFollowUp(patientId, from, session.lastTriage.triage_level);
        await sendWhatsAppMessage(from, msg('tips', lang));
      }
      await sessionLib.saveSession(patientId, session);
      return;

    } else if (message === '2') {
      // Too unwell to travel — advise ambulance
      await sendWhatsAppMessage(from, msg('transport_unsafe', lang));

      // Also give nearest hospital if we have location
      if (session.location) {
        const nearestHospitals = await findNearestFacilities(session.location, 'hospital', 1);
        if (nearestHospitals.length > 0) {
          const nearest = nearestHospitals[0];
          const hospitalMsg = {
            en: `🏥 If ambulance is delayed, your nearest hospital is:\n*${nearest.name}* (${nearest.distance} km)\n\nAsk someone to drive you there.`,
            zu: `🏥 Uma i-ambulensi iphuza, isibhedlela esiseduze:\n*${nearest.name}* (${nearest.distance} km)\n\nCela umuntu akushayele.`,
            xh: `🏥 Ukuba i-ambulensi ilibele, isibhedlele esikufutshane:\n*${nearest.name}* (${nearest.distance} km)\n\nCela umntu akuqhubele.`,
            af: `🏥 As die ambulans vertraag word, jou naaste hospitaal is:\n*${nearest.name}* (${nearest.distance} km)\n\nVra iemand om jou te ry.`,
            nso: `🏥 Ge ambulense e diegile, bookelo ya gago ya kgauswi ke:\n*${nearest.name}* (${nearest.distance} km)\n\nKopa motho a go iše ka koloi.`,
            tn: `🏥 Fa ambulense e diegile, bookelong ya gago ya gaufi ke:\n*${nearest.name}* (${nearest.distance} km)\n\nKopa mongwe a go iše ka koloi.`,
            st: `🏥 Haeba ambulense e diegile, sepetlele sa hao se haufi ke:\n*${nearest.name}* (${nearest.distance} km)\n\nKopa motho a o iše ka koloi.`,
            ts: `🏥 Loko ambulense yi hlwerisile, xibedlhele xa wena xa kusuhi i:\n*${nearest.name}* (${nearest.distance} km)\n\nKombela munhu a ku yisa hi movha.`,
            ss: `🏥 Nangabe i-ambulensi yephuzile, sibhedlela sakho lesisedvute ngu:\n*${nearest.name}* (${nearest.distance} km)\n\nCela umuntfu akushayele.`,
            ve: `🏥 Arali ambulensi yo ḓala, sibadela tsha haṋu tsini kudu ndi:\n*${nearest.name}* (${nearest.distance} km)\n\nHumbelani muthu a ni fhirise nga goloi.`,
            nr: `🏥 Nangabe i-ambulensi yephuze, isibhedlela sakho esiseduze ngu:\n*${nearest.name}* (${nearest.distance} km)\n\nBawa umuntu akushayele.`,
          };
          await sendWhatsAppMessage(from, hospitalMsg[lang] || hospitalMsg['en']);
        }
      }

      await sessionLib.logTriage({
        patient_id: patientId,
        whatsapp_message_id: messageId,
        triage_level: session.lastTriage?.triage_level || 'ORANGE',
        confidence: session.lastTriage?.confidence,
        escalation: true,
        pathway: 'ambulance_advised',
        facility_name: null,
        location: session.location || null,
        symptoms: session.lastSymptoms
      });
      await sessionLib.scheduleFollowUp(patientId, from, 'ORANGE');
      await sendWhatsAppMessage(from, msg('tips', lang));
      await sessionLib.saveSession(patientId, session);
      return;

    } else {
      // No transport — advise ambulance + alternatives
      await sendWhatsAppMessage(from, msg('transport_none', lang));

      await sessionLib.logTriage({
        patient_id: patientId,
        whatsapp_message_id: messageId,
        triage_level: session.lastTriage?.triage_level || 'ORANGE',
        confidence: session.lastTriage?.confidence,
        escalation: true,
        pathway: 'transport_barrier',
        facility_name: null,
        location: session.location || null,
        symptoms: session.lastSymptoms
      });
      await sessionLib.scheduleFollowUp(patientId, from, 'ORANGE');
      await sendWhatsAppMessage(from, msg('tips', lang));
      await sessionLib.saveSession(patientId, session);
      return;
    }
  }

  // ==================== STEP: RETURNING VS NEW PATIENT ====================
  if (session.awaitingReturningPatient) {
    session.awaitingReturningPatient = false;

    if (message === '1') {
      session.isReturningPatient = true;
      session.fileStatus = 'existing';
      await sessionLib.saveSession(patientId, session);
      await sendWhatsAppMessage(from, msg('returning_yes', lang));
    } else if (message === '2') {
      session.isReturningPatient = false;
      session.fileStatus = 'new';
      await sessionLib.saveSession(patientId, session);
      await sendWhatsAppMessage(from, msg('returning_new', lang));
    } else {
      session.isReturningPatient = null;
      session.fileStatus = 'unknown';
      await sessionLib.saveSession(patientId, session);
      await sendWhatsAppMessage(from, msg('returning_unsure', lang));
    }

    // Send reference card then auto-add to queue
    await sendPatientSummaryCard(from, lang, session);
    await autoAddToQueue(patientId, from, session);

    await sessionLib.scheduleFollowUp(patientId, from, session.lastTriage?.triage_level);
    await sendWhatsAppMessage(from, msg('tips', lang));
    return;
  }

  // ==================== SMART COMMAND DETECTOR ====================
  // Fuzzy-matches commands (language, code, help) with misspelling tolerance.
  // ONLY triggers when patient is NOT in an active input step — prevents
  // intercepting names, symptoms, or other free-text the patient is typing.
  const isInActiveInput = (
    session.identityStep ||
    session.awaitingSymptomDetail ||
    session.awaitingSymptomFollowUp ||
    session.awaitingFacilityConfirm ||
    session.awaitingAlternativeChoice ||
    session.awaitingTransportSafety ||
    session.awaitingReturningPatient ||
    session.pendingLanguageChange ||
    session.awaitingReturningUserCheck ||
    session.awaitingBZCodeLink ||
    session.awaitingLinkConfirm ||
    session.ccmddStep ||
    session.virtualConsultStep ||
    session.awaitingDoctorSlotChoice ||
    session.awaitingCcmddAwareness ||
    session.awaitingCcmddRegistrationCheck ||
    session.awaitingScriptRenewalDate ||
    session.awaitingClinicName ||
    session.awaitingChronicClinicChoice ||
    session.awaitingChronicCollectionType ||
    session.awaitingGreenClinicChoice ||
    session.awaitingTCCChoice ||
    session.awaitingSlotChoice ||
    session.awaitingClarification ||
    session.symptomCompletenessAsked ||
    session.awaitingAppointmentConfirmation ||
    session.awaitingRescheduleChoice ||
    session.awaitingHospitalArrivalResponse ||
    session.awaitingHospitalDischargeResponse ||
    session.awaitingPostHospitalFollowUp ||
    session.awaitingAdherenceResponse ||
    session.awaitingSatisfactionSurvey ||
    session.awaitingSatisfactionFeedback ||
    session.awaitingDispensingConfirmation ||
    session.fastPathAwaitingPHQ2 ||
    session.awaitingGBVPepResponse ||
    session.awaitingGBVWelfareResponse
  );

  if (!isInActiveInput) {
    // --- LANGUAGE CHANGE ---
    const LANG_WORDS = [
      'language','lang','langu','langua','languag','languages',
      'ulimi','ulim','ulwimi','ulwim',
      'taal','taa',
      'polelo','polel','puo',
      'ririmi','ririm',
      'lulwimi','lulwim',
      'luambo','luamb',
      'ilimi','ilim',
      'change language','change lang',
      'shintsha ulimi','tshintsha ulwimi',
      'verander taal','fetola puo',
    ];
    if (LANG_WORDS.includes(message) || (message.length <= 10 && (message.startsWith('lang') || message.startsWith('ulim') || message.startsWith('taa')))) {
      session.pendingLanguageChange = true;
      await sessionLib.saveSession(patientId, session);
      await sendWhatsAppMessage(from, MESSAGES.language_menu._all);
      return;
    }

    // --- REFERENCE CODE ---
    const CODE_WORDS = [
      'code','codes','cod','codr','cde','coed','codee',
      'ikhodi','ikodi','ikhod','ikkodi',
      'kode','kodes','koude',
      'khoutu','khoudu','khout','khouto',
      'khodi','khod','kodi',
      'reference','ref','reff',
      'number','my code','my number','my ref',
      'inombolo','nombolo','inomboro','nomboro',
    ];
    if (CODE_WORDS.includes(message) || (message.length <= 12 && (message.startsWith('cod') || message.startsWith('khod') || message.startsWith('kho') || message.startsWith('ref')))) {
      if (session.studyCode) {
        const codeMsg = {
          en: `🔢 Your reference number is: *${session.studyCode}*\n\nShow this number at reception when you arrive at the clinic.\n\nType "code" anytime to see it again.`,
          zu: `🔢 Inombolo yakho yereferensi ithi: *${session.studyCode}*\n\nKhombisa le nombolo e-reception uma ufika emtholampilo.\n\nBhala "code" noma nini ukuyibona futhi.`,
          xh: `🔢 Inombolo yakho yereferensi ithi: *${session.studyCode}*\n\nBonisa le nombolo e-reception xa ufika ekliniki.\n\nBhala "code" nanini na ukuyibona kwakhona.`,
          af: `🔢 Jou verwysingsnommer is: *${session.studyCode}*\n\nWys hierdie nommer by ontvangs wanneer jy by die kliniek aankom.\n\nTik "code" enige tyd om dit weer te sien.`,
          nso: `🔢 Nomoro ya gago ya referense ke: *${session.studyCode}*\n\nBontšha nomoro ye kwa resepsheneng ge o fihla kliniki.\n\nNgwala "code" nako efe go e bona gape.`,
          tn: `🔢 Nomoro ya gago ya referense ke: *${session.studyCode}*\n\nBontsha nomoro e kwa resepsheneng fa o goroga kliniki.\n\nKwala "code" nako epe go e bona gape.`,
          st: `🔢 Nomoro ya hao ya referense ke: *${session.studyCode}*\n\nBontsha nomoro ena resepsheneng ha o fihla kliniki.\n\nNgola "code" nako efe ho e bona hape.`,
          ts: `🔢 Nomboro ya wena ya referense i le: *${session.studyCode}*\n\nKomba nomboro leyi eka resepsheni loko u fika ekliniki.\n\nTsala "code" nkarhi wihi ku yi vona nakambe.`,
          ss: `🔢 Inombolo yakho yereferensi itsi: *${session.studyCode}*\n\nKhombisa lenombolo ku-reception nawufika emtfolamphilo.\n\nBhala "code" nobe nini kuyibona futsi.`,
          ve: `🔢 Nomboro yaṋu ya referense ndi: *${session.studyCode}*\n\nSumbedzani nomboro iyi kha resepsheni musi ni tshi swika kiliniki.\n\nṄwalani "code" tshifhinga tshifhio na tshifhio u i vhona hafhu.`,
          nr: `🔢 Inomboro yakho yereferensi ithi: *${session.studyCode}*\n\nKhombisa inomboro le ku-reception nawufika ekliniki.\n\nTlola "code" nobe nini kuyibona godu.`,
        };
        await sendWhatsAppMessage(from, codeMsg[lang] || codeMsg['en']);
      } else {
        const refCode = await sessionLib.generateStudyCode(patientId);
        session.studyCode = refCode;
        await sessionLib.saveSession(patientId, session);
        const codeMsg = {
          en: `🔢 Your reference number is: *${refCode}*\n\nShow this number at reception when you arrive at the clinic.`,
          zu: `🔢 Inombolo yakho yereferensi ithi: *${refCode}*\n\nKhombisa le nombolo e-reception uma ufika emtholampilo.`,
          xh: `🔢 Inombolo yakho yereferensi ithi: *${refCode}*\n\nBonisa le nombolo e-reception xa ufika ekliniki.`,
          af: `🔢 Jou verwysingsnommer is: *${refCode}*\n\nWys hierdie nommer by ontvangs wanneer jy by die kliniek aankom.`,
          nso: `🔢 Nomoro ya gago ya referense ke: *${refCode}*\n\nBontšha nomoro ye kwa resepsheneng ge o fihla kliniki.`,
          tn: `🔢 Nomoro ya gago ya referense ke: *${refCode}*\n\nBontsha nomoro e kwa resepsheneng fa o goroga kliniki.`,
          st: `🔢 Nomoro ya hao ya referense ke: *${refCode}*\n\nBontsha nomoro ena resepsheneng ha o fihla kliniki.`,
          ts: `🔢 Nomboro ya wena ya referense i le: *${refCode}*\n\nKomba nomboro leyi eka resepsheni loko u fika ekliniki.`,
          ss: `🔢 Inombolo yakho yereferensi itsi: *${refCode}*\n\nKhombisa lenombolo ku-reception nawufika emtfolamphilo.`,
          ve: `🔢 Nomboro yaṋu ya referense ndi: *${refCode}*\n\nSumbedzani nomboro iyi kha resepsheni musi ni tshi swika kiliniki.`,
          nr: `🔢 Inomboro yakho yereferensi ithi: *${refCode}*\n\nKhombisa inomboro le ku-reception nawufika ekliniki.`,
        };
        await sendWhatsAppMessage(from, codeMsg[lang] || codeMsg['en']);
      }
      return;
    }

    // --- HELP / MENU ---
    // --- HEALTH PASSPORT (SMS fallback for no-data patients) ---
    const PASSPORT_SMS_WORDS = ['passport sms','sms passport','iphasipoti sms','paspoort sms'];
    if (PASSPORT_SMS_WORDS.includes(message)) {
      if (!smsLib.SMS_ENABLED) {
        const noSmsMsg = {
          en: '📱 SMS passport is not available yet. Type *passport* to get your health summary via WhatsApp instead.',
          zu: '📱 Iphasipoti ye-SMS ayikatholakali okwamanje. Bhala *passport* ukuthola ukufingqwa kwakho nge-WhatsApp.',
          xh: '📱 Ipasipoti ye-SMS ayikafumaneki okwangoku. Bhala *passport* ukufumana isishwankathelo sakho nge-WhatsApp.',
          af: '📱 SMS-paspoort is nog nie beskikbaar nie. Tik *passport* om jou opsomming via WhatsApp te kry.',
        };
        await sendWhatsAppMessage(from, noSmsMsg[lang] || noSmsMsg['en']);
        return;
      }
      try {
        const { data: recentTriages } = await supabase
          .from('triage_logs')
          .select('triage_level, symptoms, facility_name, created_at')
          .eq('patient_id', patientId)
          .order('created_at', { ascending: false })
          .limit(2);
        const smsText = smsLib.buildPassportSMS(session, recentTriages);
        const sent = await smsLib.sendSMS(from, smsText);
        if (sent) {
          const okMsg = {
            en: '✅ Your health summary has been sent via SMS. You can show it to any doctor even without data.',
            zu: '✅ Ukufingqwa kwezempilo yakho kuthunyelwe nge-SMS. Ungakukhombisa kunoma yimuphi udokotela ngaphandle kwedatha.',
            xh: '✅ Isishwankathelo sakho sezempilo sithunyelwe nge-SMS. Unokusibonisa kuyo nayiphi na igqirha ngaphandle kwedatha.',
            af: '✅ Jou gesondheidsopsomming is per SMS gestuur. Jy kan dit aan enige dokter wys sonder data.',
          };
          await sendWhatsAppMessage(from, okMsg[lang] || okMsg['en']);
        } else {
          await sendWhatsAppMessage(from, lang === 'en'
            ? 'Sorry, SMS could not be sent right now. Type *passport* to get your summary via WhatsApp instead.'
            : 'Siyaxolisa, i-SMS ayithunyelwanga. Bhala *passport* ukuthola ukufingqwa kwakho nge-WhatsApp.');
        }
      } catch (e) {
        logger.error('[PASSPORT-SMS] Error:', e.message);
        await sendWhatsAppMessage(from, lang === 'en'
          ? 'Sorry, something went wrong. Type *passport* to get your summary via WhatsApp.'
          : 'Siyaxolisa, kunenkinga. Bhala *passport* ukuthola ukufingqwa kwakho nge-WhatsApp.');
      }
      return;
    }

    // --- HEALTH PASSPORT (WhatsApp + inline offline summary) ---
    const PASSPORT_WORDS = ['passport','health passport','my passport','ipassport','paspoort','phasipoti'];
    if (PASSPORT_WORDS.includes(message)) {
      try {
        const crypto = require('crypto');
        const token = crypto.randomBytes(24).toString('hex');
        const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000);
        await supabase.from('passport_tokens').upsert({
          patient_id: patientId,
          token,
          expires_at: expiresAt.toISOString(),
          created_at: new Date().toISOString(),
        }, { onConflict: 'patient_id' });
        const baseUrl = process.env.BASE_URL || 'https://bizusizo.up.railway.app';
        const url = `${baseUrl}/passport/${token}`;

        // ── Build offline-readable clinical summary ──────────────
        // This stays in the patient's WhatsApp chat permanently —
        // no data/link needed to show a doctor or nurse.
        const { data: recentTriages } = await supabase
          .from('triage_logs')
          .select('triage_level, symptoms, facility_name, pathway, created_at')
          .eq('patient_id', patientId)
          .order('created_at', { ascending: false })
          .limit(3);

        const bzCode = session.studyCode || null;
        const name = [session.firstName, session.surname].filter(Boolean).join(' ') || '—';
        const dob = session.dob?.dob_string || '—';
        const sex = session.sex || '—';
        const chronic = (session.chronicConditions || []).map(c => c.label_en || c.key).join(', ') || 'None reported';

        let summaryLines = '';
        if (recentTriages && recentTriages.length > 0) {
          summaryLines = recentTriages.map(t => {
            const d = new Date(t.created_at);
            const dateStr = d.toLocaleDateString('en-ZA', { day: '2-digit', month: 'short', year: 'numeric', timeZone: 'Africa/Johannesburg' });
            const sym = (t.symptoms || '').slice(0, 80);
            return `• ${dateStr} — *${t.triage_level}* ${t.facility_name ? '→ ' + t.facility_name : ''}\n  ${sym}`;
          }).join('\n');
        } else {
          summaryLines = '• No triage history yet';
        }

        const inlineSummary = {
          en: `📋 *HEALTH PASSPORT — OFFLINE SUMMARY*\n` +
            `━━━━━━━━━━━━━━━━━━━━━━━━━\n` +
            `👤 *Name:* ${name}\n` +
            `📅 *DOB:* ${dob} | *Sex:* ${sex}\n` +
            (bzCode ? `🔢 *Code:* ${bzCode}\n` : '') +
            `💊 *Chronic:* ${chronic}\n` +
            `━━━━━━━━━━━━━━━━━━━━━━━━━\n` +
            `📊 *Recent visits:*\n${summaryLines}\n` +
            `━━━━━━━━━━━━━━━━━━━━━━━━━\n` +
            `⚠️ This is an AI-assisted triage summary, not a diagnosis.\n` +
            `Generated: ${new Date().toLocaleDateString('en-ZA', { day: '2-digit', month: 'short', year: 'numeric', timeZone: 'Africa/Johannesburg' })}`,
          zu: `📋 *IPHASIPOTI YEZEMPILO — UKUFINGQWA*\n` +
            `━━━━━━━━━━━━━━━━━━━━━━━━━\n` +
            `👤 *Igama:* ${name}\n` +
            `📅 *Usuku lokuzalwa:* ${dob} | *Ubulili:* ${sex}\n` +
            (bzCode ? `🔢 *Ikhodi:* ${bzCode}\n` : '') +
            `💊 *Izifo ezihlala njalo:* ${chronic}\n` +
            `━━━━━━━━━━━━━━━━━━━━━━━━━\n` +
            `📊 *Ukuvakashela kwakamuva:*\n${summaryLines}\n` +
            `━━━━━━━━━━━━━━━━━━━━━━━━━\n` +
            `⚠️ Lolu ukufingqwa kwe-triage olisizwa yi-AI, akusona isigqibo.\n` +
            `Ikhiqiziwe: ${new Date().toLocaleDateString('en-ZA', { day: '2-digit', month: 'short', year: 'numeric', timeZone: 'Africa/Johannesburg' })}`,
          xh: `📋 *IPASIPOTI YEZEMPILO — ISISHWANKATHELO*\n` +
            `━━━━━━━━━━━━━━━━━━━━━━━━━\n` +
            `👤 *Igama:* ${name}\n` +
            `📅 *Umhla wokuzalwa:* ${dob} | *Isini:* ${sex}\n` +
            (bzCode ? `🔢 *Ikhowudi:* ${bzCode}\n` : '') +
            `💊 *Izifo ezingapheliyo:* ${chronic}\n` +
            `━━━━━━━━━━━━━━━━━━━━━━━━━\n` +
            `📊 *Utyelelo lwakutshanje:*\n${summaryLines}\n` +
            `━━━━━━━━━━━━━━━━━━━━━━━━━\n` +
            `⚠️ Esi sisishwankathelo se-triage esincediswa yi-AI, asiyongcaciso.\n` +
            `Yenziwe: ${new Date().toLocaleDateString('en-ZA', { day: '2-digit', month: 'short', year: 'numeric', timeZone: 'Africa/Johannesburg' })}`,
          af: `📋 *GESONDHEIDSPASPOORT — OPSOMMING*\n` +
            `━━━━━━━━━━━━━━━━━━━━━━━━━\n` +
            `👤 *Naam:* ${name}\n` +
            `📅 *Geboortedatum:* ${dob} | *Geslag:* ${sex}\n` +
            (bzCode ? `🔢 *Kode:* ${bzCode}\n` : '') +
            `💊 *Chronies:* ${chronic}\n` +
            `━━━━━━━━━━━━━━━━━━━━━━━━━\n` +
            `📊 *Onlangse besoeke:*\n${summaryLines}\n` +
            `━━━━━━━━━━━━━━━━━━━━━━━━━\n` +
            `⚠️ Hierdie is 'n AI-ondersteunde triage-opsomming, nie 'n diagnose nie.\n` +
            `Gegenereer: ${new Date().toLocaleDateString('en-ZA', { day: '2-digit', month: 'short', year: 'numeric', timeZone: 'Africa/Johannesburg' })}`,
        };

        // Send the offline summary first (stays in chat forever)
        await sendWhatsAppMessage(from, inlineSummary[lang] || inlineSummary['en']);

        // Then send the link for full interactive passport
        const linkMsg = {
          en: `🔗 *Full interactive passport:*\n${url}\n\n⏱️ Link expires in 24 hours.\n\nShow this page to any doctor, pharmacist, or hospital — even if they don't use BIZUSIZO.\n\nType *passport* anytime for a new link.`,
          zu: `🔗 *Iphasipoti ephelele:*\n${url}\n\n⏱️ Iphelelwa emva kwamahora angu-24.\n\nKhombisa le khasi kunoma yimuphi udokotela, ikhemisi, noma isibhedlela.\n\nBhala *passport* noma nini ukuthola ilinki entsha.`,
          xh: `🔗 *Ipasipoti epheleleyo:*\n${url}\n\n⏱️ Iphelelwa emva kweeyure ezingama-24.\n\nBonisa le phepha kuyo nayiphi na igqirha, ikemisti, okanye isibhedlele.\n\nBhala *passport* nanini na ukufumana ilinki entsha.`,
          af: `🔗 *Volle interaktiewe paspoort:*\n${url}\n\n⏱️ Skakel verval oor 24 uur.\n\nWys hierdie bladsy aan enige dokter, apteker, of hospitaal.\n\nTik *passport* enige tyd vir 'n nuwe skakel.`,
        };
        await sendWhatsAppMessage(from, linkMsg[lang] || linkMsg['en']);
      } catch (e) {
        logger.error('[PASSPORT] WhatsApp generate error:', e.message);
        await sendWhatsAppMessage(from, lang === 'en'
          ? 'Sorry, could not generate your health passport right now. Please try again.'
          : 'Siyaxolisa, asikwazanga ukukhiqiza iphasipoti yakho yezempilo. Sicela uzame futhi.');
      }
      return;
    }

    const HELP_WORDS = ['help','menu','start','hi','hello','hey','usizo','nceda','hulp','thusa','pfuna'];
    if (HELP_WORDS.includes(message)) {
      if (session.consent && session.identityDone && session.chronicScreeningDone && (!FEATURES.STUDY_MODE || session.isStudyParticipant !== undefined)) {
        await sendWhatsAppMessage(from, msg('category_menu', lang));
      } else {
        await sendWhatsAppMessage(from, MESSAGES.language_menu._all);
      }
      return;
    }

    // --- ARRIVAL CHECK-IN ---
    const ARRIVE_WORDS = ['arrived','here','im here',"i'm here",'checked in','check in',
      'ngifikile','sengifikile','ndifikile','ek is hier','ke fihlile','ke gorogile',
      'ke fihlile','ndzi fikile','sengifikile','ndo swika','ngifikile'];
    if (ARRIVE_WORDS.includes(message)) {
      try {
        await supabase.from('clinic_queue')
          .update({ notes: 'ARRIVED — confirmed via WhatsApp at ' + new Date().toLocaleTimeString('en-ZA') })
          .eq('patient_id', patientId)
          .eq('status', 'waiting');
      } catch (e) { logger.error('[ARRIVE] DB update failed:', e.message); }

      const arriveMsg = {
        en: `✅ *Welcome!* You have checked in.\n\nPlease take a seat. The nurse will call you when it's your turn.\n\nYour reference: *${session.studyCode || 'N/A'}*`,
        zu: `✅ *Siyakwemukela!* Usuzibhalisile.\n\nSicela uhlale phansi. Unesi uzokubiza uma kufika ithuba lakho.\n\nInombolo yakho: *${session.studyCode || 'N/A'}*`,
        xh: `✅ *Wamkelekile!* Ubhalise.\n\nNceda uhlale phantsi. Umongikazi uza kukubiza xa kufika ithuba lakho.\n\nInombolo yakho: *${session.studyCode || 'N/A'}*`,
        af: `✅ *Welkom!* Jy het ingeboek.\n\nNeem asseblief 'n sitplek. Die verpleegster sal jou roep wanneer jy aan die beurt is.\n\nJou verwysing: *${session.studyCode || 'N/A'}*`,
        nso: `✅ *O amogetšwe!* O ngwadišitšwe.\n\nHle dula fase. Mooki o tla go bitša ge nako ya gago e fihlile.\n\nNomoro ya gago: *${session.studyCode || 'N/A'}*`,
        tn: `✅ *O amogelwa!* O kwadisitswe.\n\nTsweetswee dula fa fatshe. Mooki o tla go bitsa fa nako ya gago e fitlhile.\n\nNomoro ya gago: *${session.studyCode || 'N/A'}*`,
        st: `✅ *O amohelwa!* O ngodisitswe.\n\nKa kopo dula fatshe. Mooki o tla o bitsa ha nako ya hao e fihlile.\n\nNomoro ya hao: *${session.studyCode || 'N/A'}*`,
        ts: `✅ *U amukeriwa!* U nghenisiwile.\n\nHi kombela u tshama ehansi. Muongi u ta ku vitana loko nkarhi wa wena wu fikile.\n\nNomboro ya wena: *${session.studyCode || 'N/A'}*`,
        ss: `✅ *Wemukelekile!* Sewubhalisile.\n\nSicela uhlale phansi. Unesi utawukubita nasikhatsi sakho sesifikile.\n\nInombolo yakho: *${session.studyCode || 'N/A'}*`,
        ve: `✅ *Ni a ṱanganedzwa!* No ṅwaliwa.\n\nRi humbela ni dzule fhasi. Muongi u ḓo ni vhidza musi tshifhinga tshaṋu tshi tshi swika.\n\nNomboro yaṋu: *${session.studyCode || 'N/A'}*`,
        nr: `✅ *Wamukelekile!* Sewutlolisile.\n\nSibawa uhlale phasi. Unesi utakubiza nesikhathi sakho sesifikile.\n\nInomboro yakho: *${session.studyCode || 'N/A'}*`,
      };
      await sendWhatsAppMessage(from, arriveMsg[lang] || arriveMsg['en']);
      return;
    }
  }

  // Handle language selection after "language" command
  if (session.pendingLanguageChange) {
    if (LANG_MAP[message]) {
      session.language = LANG_MAP[message];
      session.pendingLanguageChange = false;
      await sessionLib.saveSession(patientId, session);
      await sendWhatsAppMessage(from, msg('language_set', session.language));
      if (session.consent && session.identityDone && session.chronicScreeningDone && (!FEATURES.STUDY_MODE || session.isStudyParticipant !== undefined)) {
        await sendWhatsAppMessage(from, msg('category_menu', session.language));
      }
      return;
    }
    await sendWhatsAppMessage(from, MESSAGES.language_menu._all);
    return;
  }

  // ==================== STEP: LAB RESULTS QUERY ====================
  if (FEATURES.LAB_RESULTS && isLabResultsQuery(message)) {
    await handleLabResultsQuery(patientId, from, session);
    return;
  }

  // ==================== STEP: CCMDD CHECK (before triage) ====================
  if (FEATURES.CCMDD_ROUTING && isChronicMedRequest(message, message)) {
    const chronicMsg = CCMDD_MESSAGES.chronic_check[lang] || CCMDD_MESSAGES.chronic_check['en'];
    session.ccmddStep = 'confirm_chronic';
    await sessionLib.saveSession(patientId, session);
    await sendWhatsAppMessage(from, chronicMsg);
    return;
  }

  // ==================== STEP: CATEGORY SELECTION → ASK FOR DETAIL ====================
  // When a patient picks a category (1-13), we DON'T send "1" to the AI.
  // Instead we ask them to describe their symptoms, giving the AI real
  // clinical information to work with.
  if (CATEGORY_DESCRIPTIONS[message] && !session.awaitingSymptomDetail) {
    // Category 13: Voice note / speak to human — offer voice note first
    if (message === '13') {
      await sendWhatsAppMessage(from, msg('voice_note_prompt', lang));
      session.awaitingSymptomDetail = true;
      session.selectedCategory = '13';
      await sessionLib.saveSession(patientId, session);
      return;
    }

    // Category 12: "Other — type your symptoms" — go straight to detail
    if (message === '12') {
      const detailMsg = msg('category_detail_prompt', lang, 'Other');
      await sendWhatsAppMessage(from, detailMsg);
      session.awaitingSymptomDetail = true;
      session.selectedCategory = '12';
      await sessionLib.saveSession(patientId, session);
      return;
    }

    // Categories 1-11: Show what they selected and ask for detail
    const categoryName = CATEGORY_DESCRIPTIONS[message];
    await sendWhatsAppMessage(from, msg('category_detail_prompt', lang, categoryName));
    session.awaitingSymptomDetail = true;
    session.selectedCategory = message;
    await sessionLib.saveSession(patientId, session);
    return;
  }

  // ==================== STEP: SYMPTOM DETAIL RECEIVED → ENRICH & TRIAGE ====================
  if (session.awaitingSymptomDetail) {
    // Category 13 special handling: patient chose "speak to a human"
    // If they send text (not a voice note), treat it as a human escalation request.
    // Voice notes from cat 13 are handled in the audio handler above (they get transcribed + triaged).
    if (session.selectedCategory === '13') {
      session.awaitingSymptomDetail = false;
      session.selectedCategory = null;
      await sessionLib.saveSession(patientId, session);

      // Log the escalation
      await sessionLib.logTriage({
        patient_id: patientId,
        whatsapp_message_id: messageId,
        triage_level: 'YELLOW',
        confidence: 100,
        escalation: true,
        pathway: 'human_escalation_requested',
        facility_name: null,
        location: session.location || null,
        symptoms: `Patient requested human contact. Message: ${message}`
      });

      const humanMsg = {
        en: `👤 Thank you for your message. A healthcare worker will review your case.\n\nIf this is an emergency, please call *10177* or go to your nearest clinic or hospital immediately — do not wait.\n\nYou can also visit your nearest clinic during operating hours for in-person assistance.`,
        zu: `👤 Siyabonga ngomyalezo wakho. Isisebenzi sezempilo sizobheka udaba lwakho.\n\nUma kuphuthumile, sicela ushaye *10177* noma uye emtholampilo noma esibhedlela esiseduze MANJE — ungalindi.\n\nUngavakashela umtholampilo oseduze ngamahora okusebenza.`,
        xh: `👤 Enkosi ngomyalezo wakho. Umsebenzi wezempilo uza kuhlola udaba lwakho.\n\nUkuba yingxakeko, nceda utsalele *10177* okanye uye ekliniki okanye esibhedlele esikufutshane NGOKU — musa ukulinda.\n\nUngatyelela ikliniki yakho ekufutshane ngamaxesha okusebenza.`,
        af: `👤 Dankie vir jou boodskap. 'n Gesondheidswerker sal jou saak hersien.\n\nAs dit 'n noodgeval is, bel asseblief *10177* of gaan na jou naaste kliniek of hospitaal DADELIK — moenie wag nie.\n\nJy kan ook jou naaste kliniek besoek tydens werksure.`,
        nso: `👤 Re a leboga ka molaetša wa gago. Mošomi wa tša maphelo o tla sekaseka bolwetši bja gago.\n\nGe e le tšhoganetšo, hle letšetša *10177* goba o ye kliniki goba bookelong ya kgauswi BJALE — o se ke wa ema.\n\nO ka etela kliniki ya gago ya kgauswi ka dinako tša go šoma.`,
        tn: `👤 Re a leboga ka molaetsa wa gago. Mošomi wa tsa maphelo o tla sekaseka bolwetse jwa gago.\n\nFa e le tshoganyetso, tsweetswee leletsa *10177* kgotsa o ye kliniki kgotsa bookelong ya gaufi JAANONG — o se ka wa ema.\n\nO ka etela kliniki ya gago ya gaufi ka dinako tša go bereka.`,
        st: `👤 Re a leboha ka molaetsa wa hao. Mošebetsi wa bophelo o tla sekaseka bolwetsi ba hao.\n\nHaeba e le tshohanyetso, ka kopo letsetsa *10177* kapa o ye kliniki kapa sepetlele se haufi HONA JOALE — o se ke wa ema.\n\nO ka etela kliniki ya hao e haufi ka dinako tsa mosebetsi.`,
        ts: `👤 Hi khensa hi muvulavulo wa wena. Mušomi wa rihanyo u ta kambisisa vuvabyi bya wena.\n\nLoko ku ri xihatla, hi kombela u letela *10177* kumbe u ya ekliniki kumbe xibedlhele xa kusuhi SWESWI — u nga yimi.\n\nU nga endzela kliniki ya wena ya kusuhi hi tinkarhi ta ntirho.`,
        ss: `👤 Siyabonga ngemyalezo yakho. Sisebenti setemphilo sitawubuketa indaba yakho.\n\nNangabe kuphutfuma, sicela ushayele *10177* noma uye emtfolamphilo noma esibhedlela lesisedvute NYALO — ungalindzi.\n\nUngavakashela umtfolamphilo losedvute ngetikhathi tekusebenta.`,
        ve: `👤 Ri a livhuwa nga mulaedza waṋu. Mušumo wa mutakalo u ḓo sedzulusa mulwadze waṋu.\n\nArali hu tshoganetso, ri humbela ni fonele *10177* kana ni ye kha kiliniki kana sibadela tshi re tsini ZWINO — ni songo lindela.\n\nNi nga dalela kiliniki yaṋu ya tsini nga tshifhinga tsha mushumo.`,
        nr: `👤 Siyathokoza ngomyalezo wakho. Isisebenzi setemphilo sitawubuketa indaba yakho.\n\nNangabe kuphuthumile, sibawa ushayele *10177* noma uye ekliniki noma esibhedlela esiseduze ANJE — ungalindi.\n\nUngavakatjhela ikliniki yakho eseduze ngeenkhathi zokusebenza.`,
      };
      await sendWhatsAppMessage(from, humanMsg[lang] || humanMsg['en']);
      await sessionLib.scheduleFollowUp(patientId, from, 'YELLOW');
      return;
    }

    // Categories 1-12: Prepend category context and triage
    const categoryContext = CATEGORY_DESCRIPTIONS[session.selectedCategory] || '';

    // Parse severity options (1=mild, 2=moderate, 3=severe) or accept free text
    const SEVERITY_MAP = {
      '1': 'Severity: MILD — patient can do daily activities.',
      '2': 'Severity: MODERATE — affecting daily activities.',
      '3': 'Severity: SEVERE — patient can barely function.',
    };
    const severityText = SEVERITY_MAP[message.trim()];
    let enrichedMessage;

    // DoH CHRONIC BYPASS: Stable chronic patients (category 8 + mild) bypass full AI triage
    // Sick chronic patients (moderate/severe) fall through to normal AI triage below
    //
    // COLLECTION POINT LOGIC:
    // - Clinic collectors → facility routing → chronic queue → dashboard visibility
    // - Pharmacy/external collectors → confirmation + follow-up, no clinic queue needed
    // - Sick patients (mod/severe) → normal triage → nearest clinic/hospital
    if (session.selectedCategory === '8' && message.trim() === '1') {
      session.lastTriage = { triage_level: 'GREEN', confidence: 95, source: 'chronic_bypass' };
      session.lastSymptoms = 'Stable chronic patient — medication collection (DoH fast-track bypass)';
      session.lastPathway = 'chronic_bypass_stable';

      const chronicBypassMsg = {
        en: '💊 *Chronic Medication Collection*\n\nYou are stable.\n\nWhere do you collect your medication?\n1 — At a clinic\n2 — At a pharmacy\n3 — Other (community point, delivery)',
        zu: '💊 *Ukuthatha Umuthi Wamahlalakhona*\n\nUzinzile.\n\nUwuthatha kuphi umuthi wakho?\n1 — Emtholampilo\n2 — Ekhemisi\n3 — Kwenye indawo (umphakathi, ukulethwa)',
        xh: '💊 *Ukuthatha Amayeza Aqhelekileyo*\n\nUzinzile.\n\nUwathatha phi amayeza akho?\n1 — Ekliniki\n2 — Ekemisti\n3 — Kwenye indawo (umphakathi, ukunikezelwa)',
        af: '💊 *Chroniese Medikasie Afhaal*\n\nJy is stabiel.\n\nWaar haal jy jou medikasie af?\n1 — By \'n kliniek\n2 — By \'n apteek\n3 — Ander (gemeenskapspunt, aflewering)',
        nso: '💊 *Go Tšea Dihlare tša go Dulela*\n\nO tsepame.\n\nO tšea dihlare tša gago kae?\n1 — Kliniki\n2 — Khemisi\n3 — Lefelo le lengwe (setšhaba, go romela)',
        tn: '💊 *Go Tsaya Dimelemo tsa go Nnela ruri*\n\nO tsepame.\n\nO tsaya dimelemo tsa gago kae?\n1 — Kwa kliniki\n2 — Kwa khemisi\n3 — Lefelo le sele (setšhaba, go romela)',
        st: '💊 *Ho Nka Meriana ya Mahlale*\n\nO tsitsitse.\n\nO nka meriana ya hao hokae?\n1 — Kliniki\n2 — Khemisi\n3 — Sebaka se seng (setjhaba, ho romela)',
        ts: '💊 *Ku Teka Mirhi ya Vurhongo*\n\nU tiyile.\n\nU teka mirhi ya wena kwihi?\n1 — Ekliniki\n2 — Ekhemisi\n3 — Ndhawu yin\'wana (muganga, ku rhumela)',
        ss: '💊 *Kutfola Imitsi Yesikhashana*\n\nUsimeme.\n\nUyitfola kuphi imitsi yakho?\n1 — Emtfolamphilo\n2 — Ekhemisi\n3 — Endzaweni lenye (umphakadzi, kulethwa)',
        ve: '💊 *U Dzhia Mushonga wa Vhulwadze*\n\nNo dzikama.\n\nNi dzhia mushonga waṋu ngafhi?\n1 — Kha kiliniki\n2 — Kha khemisi\n3 — Huṅwe (tshitshavha, u rumela)',
        nr: '💊 *Ukuthatha Imitjhoga Yesikhathi Eside*\n\nUzinzile.\n\nUyithatha kuphi imitjhoga yakho?\n1 — Ekliniki\n2 — Ekhemisi\n3 — Kwenye indawo (umphakathi, ukulethwa)',
      };
      session.awaitingChronicCollectionType = true;
      await sessionLib.saveSession(patientId, session);
      await sendWhatsAppMessage(from, chronicBypassMsg[lang] || chronicBypassMsg['en']);
      return;
    }

    // DoH SCREENING BYPASS: Preventative care patients (category 15) skip full AI triage
    // They're healthy people coming for screening (HIV test, BP check, glucose test)
    // Route directly to preventative/fast-track desk — no severity question needed
    if (session.selectedCategory === '15') {
      session.lastTriage = { triage_level: 'GREEN', confidence: 95, source: 'screening_bypass' };
      session.lastSymptoms = 'Preventative screening — ' + (message.trim() || 'general health check');
      session.lastPathway = 'screening_fast_track';
      session.awaitingSymptomDetail = false;
      session.selectedCategory = '15';

      const screeningMsg = {
        en: '🔬 *Health Screening*\n\nYou will be directed to the *fast-track screening desk* — no need to wait in the general queue.\n\nBring your ID. If you are fasting for a glucose test, please let the nurse know when you arrive.',
        zu: '🔬 *Ukuhlolwa Kwempilo*\n\nUzodluliselwa *edeskini lokuhlola okusheshayo* — akudingeki ulinde emugqeni ojwayelekile.\n\nLetha i-ID yakho. Uma uzilile ukuhlolwa kukashukela, tshela unesi uma ufika.',
        xh: '🔬 *Ukuhlolwa Kwempilo*\n\nUza kuthunyelwa *kwideski yokuhlola ngokukhawuleza* — akukho mfuneko yokulinda kumgca oqhelekileyo.\n\nZisa i-ID yakho. Ukuba uzilile ukuhlolwa kweswekile, xelela umongikazi xa ufika.',
        af: '🔬 *Gesondheidstoetsing*\n\nJy sal na die *vinnige toetstafel* verwys word — nie nodig om in die algemene tou te wag nie.\n\nBring jou ID. As jy vas vir \'n glukosetoets, laat die verpleegster weet wanneer jy aankom.',
        nso: '🔬 *Diteko tša Maphelo*\n\nO tla romelwa go *deseke ya diteko tša ka pela* — ga go nyakege go ema moleleng wa kakaretšo.\n\nTliša ID ya gago. Ge o ikamile bakeng sa teko ya swikiri, botša mooki ge o fihla.',
        tn: '🔬 *Diteko tsa Boitekanelo*\n\nO tla romelwa kwa *desekeng ya diteko tsa ka bonako* — ga go tlhokege go ema molelwaneng wa kakaretso.\n\nTlisa ID ya gago. Fa o ikileng bakeng sa teko ya sukiri, bolelela mooki fa o goroga.',
        st: '🔬 *Diteko tsa Bophelo*\n\nO tla romelwa ho *deseke ya diteko tsa ka potlako* — ha ho hlokahale ho ema moleleng wa kakaretso.\n\nTlisa ID ya hao. Haeba o itimile bakeng sa teko ya tsoekere, bolella mooki ha o fihla.',
        ts: '🔬 *Mavonelo ya Rihanyo*\n\nU ta rhumeriwa eka *deseke ya mavonelo ya ku hatlisa* — a swi lavi ku yima emulayinini wa hinkwaswo.\n\nTisa ID ya wena. Loko u tikhomile ku ringanyeta swikiri, byela muongi loko u fika.',
        ss: '🔬 *Kuhlolwa Kwemphilo*\n\nUtawudluliselwa ku-*desiki yekuhlola ngekushesha* — akudzingeki ulindze emugceni lovamile.\n\nLetsa i-ID yakho. Nawuzilile kuhlolwa kweshukela, tjela unesi nawufika.',
        ve: '🔬 *Ndingo dza Mutakalo*\n\nNi ḓo rumelwa kha *deseke ya ndingo dza nga u ṱavhanya* — a hu ṱoḓei u lindela mulayinini wa zwoṱhe.\n\nḒisani ID yaṋu. Arali no ḓiḓima u lingwa ha swigiri, vhudzani muongi musi ni tshi swika.',
        nr: '🔬 *Ukuhlolwa Kwepilo*\n\nUtawudluliselwa ku-*desiki yokuhlola ngokurhabha* — akutlhogeki ulinde emugceni ojayelekileko.\n\nLetha i-ID yakho. Nawuzilile ukuhlolwa kwesiswigiri, tjela unesi nawufika.',
      };
      await sendWhatsAppMessage(from, screeningMsg[lang] || screeningMsg['en']);

      // Route to nearest clinic for screening
      if (session.location) {
        const nearestFacilities = await findNearestFacilities(session.location, 'clinic', 3);
        if (nearestFacilities.length > 0) {
          const nearest = nearestFacilities[0];
          session.suggestedFacility = nearest;
          session.alternativeFacilities = nearestFacilities.slice(1);
          session.awaitingFacilityConfirm = true;
          await sessionLib.saveSession(patientId, session);
          await sendFacilitySuggest(from, lang, nearest, session.lastTriage?.triage_level);

          await sessionLib.logTriage({
            patient_id: patientId,
            whatsapp_message_id: messageId,
            triage_level: 'GREEN',
            confidence: 95,
            escalation: false,
            pathway: 'screening_fast_track',
            facility_name: nearest.name,
            location: session.location,
            symptoms: 'Preventative screening — fast-track',
          });
          return;
        }
      }

      // No location — ask for it
      session.pendingTriage = true;
      await sessionLib.saveSession(patientId, session);
      await sendWhatsAppMessage(from, msg('request_location', lang));

      await sessionLib.logTriage({
        patient_id: patientId,
        whatsapp_message_id: messageId,
        triage_level: 'GREEN',
        confidence: 95,
        escalation: false,
        pathway: 'screening_fast_track',
        symptoms: 'Preventative screening — fast-track',
      });
      return;
    }

    if (severityText) {
      enrichedMessage = `Category: ${categoryContext}. ${severityText}`;
      // If they just picked a severity number, ask for a brief description too
      session.awaitingSymptomFollowUp = true;
      session.pendingSeverity = enrichedMessage;
      session.awaitingSymptomDetail = false;
      await sessionLib.saveSession(patientId, session);
      const followUpMsg = {
        en: 'Thank you. Can you briefly tell us:\n\n• When did it start?\n• Any other symptoms?\n\nOr type *skip* to proceed with triage.',
        zu: 'Siyabonga. Ungasitshela kafushane:\n\n• Kuqale nini?\n• Ezinye izimpawu?\n\nNoma bhala *skip* ukuqhubeka.',
        xh: 'Enkosi. Ungasixelela kafutshane:\n\n• Kuqale nini?\n• Ezinye iimpawu?\n\nOkanye bhala *skip* ukuqhubeka.',
        af: 'Dankie. Kan jy kortliks sê:\n\n• Wanneer het dit begin?\n• Enige ander simptome?\n\nOf tik *skip* om voort te gaan.',
        nso: 'Re a leboga. O ka re botša ka boripana:\n\n• E thomile neng?\n• Dika tše dingwe?\n\nGoba ngwala *skip* go tšwela pele.',
        tn: 'Re a leboga. A o ka re bolelela ka boripana:\n\n• E simolotse leng?\n• Matshwao a mangwe?\n\nKgotsa kwala *skip* go tswela pele.',
        st: 'Re a leboha. Na o ka re bolella ka bokhutshwane:\n\n• E qadile neng?\n• Matshwao a mang?\n\nKapa ngola *skip* ho tswela pele.',
        ts: 'Hi khensa. U nga hi byela hi ku koma:\n\n• Swi sungurile rini?\n• Swikombiso swin\'wana?\n\nKumbe tsala *skip* ku ya emahlweni.',
        ss: 'Siyabonga. Ungasitjela ngekufisha:\n\n• Kucale nini?\n• Letinye timphawu?\n\nNoma bhala *skip* kuchubeka.',
        ve: 'Ri a livhuwa. Ni nga ri vhudza nga u pfufhifhadza:\n\n• Zwo thoma lini?\n• Zwiga zwinwe?\n\nKana ngwalani *skip* u ya phanda.',
        nr: 'Siyathokoza. Ungasitjela ngokufitjhani:\n\n• Kuthome nini?\n• Ezinye iimphawu?\n\nNoma tlola *skip* ukuragela phambili.',
      };
      await sendWhatsAppMessage(from, followUpMsg[lang] || followUpMsg['en']);
      return;
    }

    enrichedMessage = categoryContext
      ? `Category: ${categoryContext}. Patient says: ${message}`
      : message;

    session.awaitingSymptomDetail = false;
    session.selectedCategory = null;
    await sessionLib.saveSession(patientId, session);

    message = enrichedMessage;
  }

  // ==================== STEP: SEVERITY FOLLOW-UP ====================
  if (session.awaitingSymptomFollowUp) {
    session.awaitingSymptomFollowUp = false;
    let enrichedMessage = session.pendingSeverity || '';

    if (message !== 'skip' && message.length > 1) {
      enrichedMessage += ' Patient adds: ' + message;
    }

    session.pendingSeverity = null;
    session.selectedCategory = null;
    await sessionLib.saveSession(patientId, session);
    message = enrichedMessage;
  }

  // ==================== STEP 1b: SYMPTOM COMPLETENESS CHECK ====================
  // Bean et al. (Nature Medicine, 2026): incomplete input is the #1 driver of real-world
  // triage failure — LLMs went from 94.9% to <34.5% accuracy with real users who provided
  // insufficient information. Ask one targeted follow-up if input is too vague.
  if (!session.symptomCompletenessAsked) {
    const words = message.trim().split(/\s+/).length;
    const hasSymptomDetail = /pain|hurt|sore|ache|bleed|vomit|cough|dizz|faint|burn|itch|swell|fever|nause|cramp|tir|weak|numb|throb|sting|rash|lump/i.test(message)
      || /buhlungu|ubuhlungu|gula|phefumul|umkhuhlane|hlobahloba|isisu|ukhwehlela|isifo|bohloko|opela|lwala|sefa|femba/i.test(message);
    if (words < 4 && !hasSymptomDetail) {
      session.symptomCompletenessAsked = true;
      session.pendingVagueSymptoms = message;
      await sessionLib.saveSession(patientId, session);
      const vaguePromptMsg = {
        en: 'To help assess you accurately, could you describe your symptoms in a bit more detail?\n\nFor example: *where* does it hurt, *when* did it start, and is it getting *worse*?',
        zu: 'Ukuze sikuhlole kahle, ungachaza izimpawu zakho kabanzi?\n\nIsibonelo: kubuhlungu *kuphi*, kuqale *nini*, futhi *kuyanda* yini?',
        xh: 'Ukuze sikuhlole kakuhle, ungachaza iimpawu zakho ngokunzulu?\n\nUmzekelo: kubuhlungu *phi*, kuqale *nini*, kwaye *kuyanda* na?',
        af: 'Om jou akkuraat te assesseer, kan jy jou simptome in meer detail beskryf?\n\nByvoorbeeld: *waar* is die pyn, *wanneer* het dit begin, en word dit *erger*?',
        nso: 'Go re thuša go go sekaseka gabotse, o ka hlaloša dika tša gago ka botlalo?\n\nMohlala: go opela *kae*, go thomile *neng*, le ge go *mpefala*?',
        tn: 'Go re thusa go go sekaseka sentle, o ka tlhalosa matshwao a gago ka botlalo?\n\nSekai: go botlhoko *kae*, go simolotse *leng*, le fa go *mpefala*?',
        st: 'Ho re thusa ho o sekaseka hantle, o ka hlalosa matshwao a hao ka botlalo?\n\nMohlala: ho bohloko *hokae*, ho qadile *neng*, le hore na ho *mpefala*?',
        ts: 'Ku hi pfuna ku ku kambela kahle, u nga hlamusela swikombiso swa wena hi vuxokoxoko?\n\nXikombiso: ku vava *kwihi*, swi sungurile *rini*, na loko swi *nyanya*?',
        ss: 'Kusisita kuhlola kahle, ungachaza timphawu takho ngekunengi?\n\nSibonelo: kubuhlungu *kuphi*, kucale *nini*, futsi *kuyandza* yini?',
        ve: 'U ri thusa u ni sedzulusa zwavhuḓi, ni nga hlamusela zwiga zwaṋu nga vhuḓalo?\n\nTsumbo: zwi vhavha *ngafhi*, zwo thoma *lini*, na arali zwi tshi *ṱavhanya*?',
        nr: 'Ukusisiza ukukuhlola kuhle, ungachaza iimpawu zakho ngokunabileko?\n\nIsibonelo: kubuhlungu *kuphi*, kuthome *nini*, begodu *kuyanda* na?',
      };
      await sendWhatsAppMessage(from, vaguePromptMsg[lang] || vaguePromptMsg['en']);
      return;
    }
  }

  // Handle response to vague symptom prompt
  if (session.symptomCompletenessAsked && session.pendingVagueSymptoms) {
    message = `${session.pendingVagueSymptoms} ${message}`.trim();
    session.pendingVagueSymptoms = null;
    session.symptomCompletenessAsked = false;
    await sessionLib.saveSession(patientId, session);
  }

  // ==================== STEP 2: TRIAGE (GOVERNANCE-INTEGRATED) ====================
  // Pillar 1: Failsafe mode (deterministic RED classifier) if API is down
  // Pillar 2: Risk factor upgrades + confidence threshold enforcement

  // Send thinking indicator so patient knows we're processing
  await sendWhatsAppMessage(from, msg('thinking', lang));

  // Build session context so runTriage can apply paediatric/comorbidity logic
  const triageSessionCtx = {
    patientId,
    age: session.dob?.age || session.patientAge || null,
    chronicConditions: session.chronicConditions || session.ccmddConditions || [],
    isPregnant: session.selectedCategory === '3',
    priorHistory: await triageLib.getPatientHistory(patientId),
  };

  const govResult = await governance.runTriageWithGovernance(
    message, lang, session,
    (text, l) => triageLib.runTriage(text, l, triageSessionCtx),
    triageLib.applyClinicalRules
  );
  let triage = govResult.triage;
  const govMeta = govResult.governance;

  // Handle triage rate limit
  if (triage?.rateLimited) {
    await sendWhatsAppMessage(from, msg('rate_limited', lang));
    return;
  }

  // Store for later logging
  session.lastTriage = triage;
  session.lastSymptoms = message;
  session.lastGovMeta = govMeta; // Governance audit trail

  // ==================== STEP 2b: VERIFICATION AGENT (RED/ORANGE only) ====================
  // NOHARM study: multi-agent configurations are 6x safer than single models.
  // Run a fast independent check with Haiku for high-acuity results.
  // If disagreement → flag for nurse review (does NOT change triage level).
  const verification = await triageLib.verifyHighAcuityTriage(message, triage);
  if (verification && !verification.verified && !verification.verification_skipped) {
    triage.verification_disagreement = true;
    triage.verifier_level = verification.verifier_level;
    triage.verifier_reason = verification.verifier_reason;
    session.lastTriage = triage;
  }

  // ==================== STEP 3: LOW CONFIDENCE → ASK FOR CLARIFICATION ====================
  // Must run BEFORE the RED check — low confidence on a non-RED case should never
  // trigger the emergency pathway. Ask the patient to describe symptoms more clearly.
  if (triage.confidence < CONFIDENCE_THRESHOLD && triage.triage_level !== 'RED') {
    session.awaitingClarification = true;
    session.lastTriage = triage;
    session.lastSymptoms = message;
    await sessionLib.saveSession(patientId, session);
    await sendWhatsAppMessage(from, msg('clarify_symptoms', lang));
    return;
  }

  // ==================== STEP 3b: RED → ESCALATE ====================
  if (triage.triage_level === 'RED') {
    // Send emergency message immediately — every second counts
    await sendWhatsAppMessage(from, msg('triage_red', lang));

    await sessionLib.logTriage({
      patient_id: patientId,
      whatsapp_message_id: messageId,
      triage_level: triage.triage_level,
      confidence: triage.confidence,
      escalation: triage.confidence < CONFIDENCE_THRESHOLD,
      pathway: 'emergency',
      facility_name: null,
      location: session.location || null,
      symptoms: message,
      reasoning: triage.reasoning || null,
      tews_score: triage.tews_score ?? null,
      verification: verification ? {
        verified: verification.verified,
        source: verification.verification_source,
        verifier_level: verification.verifier_level || null,
        verifier_reason: verification.verifier_reason || null,
      } : null,
      governance: {
        failsafe: govMeta.failsafe,
        risk_upgrade: triage.risk_upgrade || null,
        rule_override: triage.rule_override || null,
        issues: govMeta.issues.length,
      }
    });

    // ALSO route to nearest hospital emergency unit — ambulances are unreliable in SA.
    // The patient needs to know WHERE to go, not just to call 10177.
    if (session.location) {
      const nearestHospitals = await findNearestFacilities(session.location, 'hospital', 3);
      if (nearestHospitals.length > 0) {
        const nearest = nearestHospitals[0];
        const emergencyRouteMsg = {
          en: `🏥 Your nearest hospital emergency unit:\n*${nearest.name}* (${nearest.distance} km)\n${nearest.address || ''}\n\nGo there NOW if an ambulance is not coming quickly. Do not wait.`,
          zu: `🏥 Isibhedlela esiseduze nawe:\n*${nearest.name}* (${nearest.distance} km)\n${nearest.address || ''}\n\nYana khona MANJE uma i-ambulensi ingezi ngokushesha. Ungalindi.`,
          xh: `🏥 Isibhedlele esikufutshane nawe:\n*${nearest.name}* (${nearest.distance} km)\n${nearest.address || ''}\n\nYiya khona NGOKU ukuba i-ambulensi ayizi ngokukhawuleza. Musa ukulinda.`,
          af: `🏥 Jou naaste hospitaal noodafdeling:\n*${nearest.name}* (${nearest.distance} km)\n${nearest.address || ''}\n\nGaan soontoe NOU as die ambulans nie vinnig kom nie. Moenie wag nie.`,
          nso: `🏥 Bookelo ya gago ya kgauswi kudu:\n*${nearest.name}* (${nearest.distance} km)\n${nearest.address || ''}\n\nYa gona BJALE ge ambulense e sa tle ka pela. O se ke wa ema.`,
          tn: `🏥 Bookelong ya gago ya gaufi kudu:\n*${nearest.name}* (${nearest.distance} km)\n${nearest.address || ''}\n\nYa koo JAANONG fa ambulense e sa tle ka bonako. O se ka wa ema.`,
          st: `🏥 Sepetlele sa hao se haufi kudu:\n*${nearest.name}* (${nearest.distance} km)\n${nearest.address || ''}\n\nEya moo HONA JOALE haeba ambulense e sa tle kapele. O se ke wa ema.`,
          ts: `🏥 Xibedlhele xa wena xa kusuhi kudu:\n*${nearest.name}* (${nearest.distance} km)\n${nearest.address || ''}\n\nYa kona SWESWI loko ambulense yi nga ti hi ku hatlisa. U nga yimi.`,
          ss: `🏥 Sibhedlela lesinye sakho lesisedvute kakhulu:\n*${nearest.name}* (${nearest.distance} km)\n${nearest.address || ''}\n\nHamba khona NYALO nangabe i-ambulensi ingeti ngekushesha. Ungalindzi.`,
          ve: `🏥 Sibadela tsha haṋu tshi re tsini kudu:\n*${nearest.name}* (${nearest.distance} km)\n${nearest.address || ''}\n\nYani henefho ZWINO arali ambulensi i sa ḓi nga u ṱavhanya. Ni songo lindela.`,
          nr: `🏥 Isibhedlela sakho esiseduze khulu:\n*${nearest.name}* (${nearest.distance} km)\n${nearest.address || ''}\n\nYa khona ANJE nangabe i-ambulensi ingezi ngokurhabha. Ungalindi.`,
        };
        await sendWhatsAppMessage(from, emergencyRouteMsg[lang] || emergencyRouteMsg['en']);
      }
    } else {
      // No location — ask for it so we can route them
      const locationAskMsg = {
        en: '📍 Send us your location (tap the + button → Location) so we can tell you which hospital is nearest to you.',
        zu: '📍 Sithumelele indawo yakho (cindezela inkinobho ye-+ → Indawo) ukuze sikutshele ukuthi isiphi isibhedlela esiseduze nawe.',
        xh: '📍 Sithumelele indawo yakho (cofa iqhosha le-+ → Indawo) ukuze sikuxelele esiphi isibhedlele esikufutshane nawe.',
        af: '📍 Stuur ons jou ligging (tik die + knoppie → Ligging) sodat ons jou kan sê watter hospitaal die naaste aan jou is.',
        nso: '📍 Re romele lefelo la gago (thinta konopo ya + → Lefelo) gore re go botše sepetlele se se kgauswi le wena.',
        tn: '📍 Re romelele lefelo la gago (tobetsa konopo ya + → Lefelo) gore re go bolele bookelong ya gaufi le wena.',
        st: '📍 Re romelele sebaka sa hao (tobetsa konopo ya + → Sebaka) hore re ho bolelle sepetlele se haufi le wena.',
        ts: '📍 Hi rhumele ndhawu ya wena (thinta buto ya + → Ndhawu) leswaku hi ku byela xibedlhele lexi nga kusuhi na wena.',
        ss: '📍 Sitfumelele indzawo yakho (cindzetsa inkinobho ye-+ → Indzawo) kuze sikutjele kutsi ngusiphi sibhedlela lesisedvute nawe.',
        ve: '📍 Ri rumeleni fhethu haṋu (thintani bathane ya + → Fhethu) uri ri ni vhudze sibadela tshi re tsini na inwi.',
        nr: '📍 Sithumeleleni indawo yakho (cindezela ikinobho ye-+ → Indawo) bona kuthi ngisiphi isibhedlela esiseduze nawe.',
      };
      await sendWhatsAppMessage(from, locationAskMsg[lang] || locationAskMsg['en']);
      session.pendingTriage = true;
      session.lastTriage = triage;
    }

    await sessionLib.scheduleFollowUp(patientId, from, triage.triage_level);
    await sendWhatsAppMessage(from, msg('tips', lang));
    await sessionLib.saveSession(patientId, session);
    return;
  }

  // ==================== STEP 4: SEND TRIAGE RESULT ====================
  if (triage.triage_level === 'ORANGE') {
    await sendWhatsAppMessage(from, msg('triage_orange', lang));

    // Time-aware routing message
    if (!isClinicOpen()) {
      await sendWhatsAppMessage(from, msg('triage_orange_hospital', lang));
    }

    // Ask transport safety question — critical for ORANGE
    session.awaitingTransportSafety = true;
    session.lastTriage = triage;
    session.lastSymptoms = message;
    await sessionLib.saveSession(patientId, session);
    await sendWhatsAppMessage(from, msg('ask_transport_safety', lang));
    return;

  } else if (triage.triage_level === 'YELLOW') {
    await sendWhatsAppMessage(from, msg('triage_yellow', lang));

    // After-hours: tell patient to come tomorrow morning + schedule reminder
    if (!isClinicOpen()) {
      // Count how many patients already scheduled for tomorrow — stagger times (#8)
      let slotTime = '07:00';
      try {
        const tmrw = new Date();
        tmrw.setDate(tmrw.getDate() + 1);
        tmrw.setHours(0, 0, 0, 0);
        const tmrwEnd = new Date(tmrw);
        tmrwEnd.setHours(23, 59, 59, 999);
        const { data: tmrwPats } = await supabase
          .from('follow_ups')
          .select('id')
          .eq('type', 'morning_reminder')
          .eq('status', 'pending')
          .gte('scheduled_at', tmrw.toISOString())
          .lte('scheduled_at', tmrwEnd.toISOString());
        const count = (tmrwPats || []).length;
        const slots = ['07:00', '08:00', '09:00', '10:00'];
        slotTime = slots[Math.min(Math.floor(count / 10), slots.length - 1)];
      } catch (e) { /* use default 07:00 */ logger.error('[SILENT] Suppressed error in slot calculation:', e.message || 'unknown'); }

      session.appointmentSlot = slotTime;

      const nextDay = getNextClinicDay();
      const slotMsg = {
        en: `⏰ Clinics are closed now.\n\n1. *If manageable* — rest at home, come to the clinic on *${nextDay.label}* at *${slotTime}*\n2. *If symptoms worsen* — go to hospital or call *10177*\n\nWe will send you a reminder on *${nextDay.label}* morning.`,
        zu: `⏰ Imitholampilo ivaliwe manje.\n\n1. *Uma kubekezeleka* — phumula ekhaya, woza emtholampilo ngo-*${nextDay.label}* ngo-*${slotTime}*\n2. *Uma izimpawu ziba zimbi* — yana esibhedlela noma ushaye *10177*\n\nSizokuthumelela isikhumbuzo ngo-*${nextDay.label}* ekuseni.`,
        xh: `⏰ Iikliniki zivaliwe ngoku.\n\n1. *Ukuba zinokumelana nazo* — phumla ekhaya, yiza ekliniki ngo-*${nextDay.label}* nge-*${slotTime}*\n2. *Ukuba iimpawu ziba mbi* — yiya esibhedlele okanye utsalele *10177*\n\nSiza kukuthumela isikhumbuzo ngo-*${nextDay.label}* ekuseni.`,
        af: `⏰ Klinieke is gesluit.\n\n1. *As hanteerbaar* — rus tuis, kom *${nextDay.label}* na die kliniek om *${slotTime}*\n2. *As simptome vererger* — gaan hospitaal toe of bel *10177*\n\nOns stuur *${nextDay.label}* 'n herinnering.`,
        nso: `⏰ Dikliniki di tswaletšwe bjale.\n\n1. *Ge o kgona* — khutša gae, tla kliniki ka *${nextDay.label}* ka *${slotTime}*\n2. *Ge dika di mpefala* — ya bookelong goba letšetša *10177*\n\nRe tla go romela sekgopotšo ka *${nextDay.label}* ka mesa.`,
        tn: `⏰ Dikliniki di tswaletswe jaanong.\n\n1. *Fa o kgona* — ikhutse gae, tla kliniki ka *${nextDay.label}* ka *${slotTime}*\n2. *Fa matshwao a fetoga* — ya bookelong kgotsa leletsa *10177*\n\nRe tla go romela sekgopotso ka *${nextDay.label}* mo mosong.`,
        st: `⏰ Dikliniki di tswaletswe joale.\n\n1. *Haeba o kgona* — phomola lapeng, tla kliniki ka *${nextDay.label}* ka *${slotTime}*\n2. *Haeba matshwao a mpefala* — eya sepetleleng kapa letsetsa *10177*\n\nRe tla o romella sekgopotso ka *${nextDay.label}* ka mesong.`,
        ts: `⏰ Tikliniki ti pfariwile sweswi.\n\n1. *Loko u kota* — wisa ekaya, ta ekliniki ka *${nextDay.label}* hi *${slotTime}*\n2. *Loko swikombiso swi nyanya* — ya exibedlhele kumbe letela *10177*\n\nHi ta ku rhumela xikhumbutso ka *${nextDay.label}* nimixo.`,
        ss: `⏰ Tinkliniki tivalwe nyalo.\n\n1. *Nangabe uyakhona* — phumula ekhaya, wota emtfolamphilo ngo-*${nextDay.label}* nge-*${slotTime}*\n2. *Nangabe timphawu tiba timbi* — hamba esibhedlela noma shayela *10177*\n\nSitawukutfumelela sikhumbuto ngo-*${nextDay.label}* ekuseni.`,
        ve: `⏰ Dzi kiliniki dzo valwa zwino.\n\n1. *Arali ni kha ḓi kona* — awelani hayani, ḓani kha kiliniki nga *${nextDay.label}* nga *${slotTime}*\n2. *Arali zwiga zwi tshi ḓi vhifha* — yani sibadela kana fonelani *10177*\n\nRi ḓo ni rumela tsivhudzo nga *${nextDay.label}* nga matsheloni.`,
        nr: `⏰ Amakliniki avalwe nje.\n\n1. *Nangabe uyakhona* — phumula ekhaya, woza ekliniki ngo-*${nextDay.label}* nge-*${slotTime}*\n2. *Nangabe iimphawu ziba zimbi* — yiya esibhedlela noma ushayele *10177*\n\nSitakuthumelelela isikhumbuzo ngo-*${nextDay.label}* ekuseni.`,
      };
      await sendWhatsAppMessage(from, slotMsg[lang] || slotMsg['en']);

      // Schedule morning reminder for 06:30 SAST on the next clinic working day
      try {
        await supabase.from('follow_ups').insert({
          patient_id: patientId,
          phone: from,
          triage_level: 'YELLOW',
          scheduled_at: nextDay.scheduledAt,
          status: 'pending',
          type: 'morning_reminder'
        });
      } catch (e) {
        logger.error('[YELLOW_AFTER_HOURS] Failed to schedule morning reminder:', e.message);
      }

      await sessionLib.logTriage({
        patient_id: patientId,
        whatsapp_message_id: messageId,
        triage_level: 'YELLOW',
        confidence: triage.confidence,
        escalation: false,
        pathway: 'clinic_visit_tomorrow',
        facility_name: session.location ? (await findNearestFacilities(session.location, 'clinic', 1).catch(() => []))[0]?.name || null : null,
        location: session.location || null,
        symptoms: message,
        reasoning: triage.reasoning || null,
        tews_score: triage.tews_score ?? null,
      });
      await sendWhatsAppMessage(from, msg('tips', lang));
      await sessionLib.saveSession(patientId, session);
      return;
    }
  } else {
    await sendWhatsAppMessage(from, msg('triage_green', lang));

    // Generate symptom-specific self-care advice using AI
    try {
      const selfCareAdvice = await triageLib.generateSelfCareAdvice(message, lang);
      if (selfCareAdvice) {
        await sendWhatsAppMessage(from, selfCareAdvice);
      }
    } catch (e) {
      logger.error('[SELF-CARE] Advice generation failed:', e.message);
    }

    // DoH alignment: GREEN patients should still be offered a clinic visit.
    // After hours: clinic is closed — skip the offer, auto-schedule a morning reminder instead.
    if (!isClinicOpen()) {
      const nextDay = getNextClinicDay();
      const greenAfterHoursMsg = {
        en: `⏰ The clinic is currently closed.\n\nYour symptoms are non-urgent — rest at home and visit the clinic on *${nextDay.label}* when it opens at *07:00*.\n\nIf symptoms get worse overnight, go to your nearest hospital emergency or call *10177*.\n\nWe will send you a reminder on *${nextDay.label}* morning. 🔔`,
        zu: `⏰ Umtholampilo uvaliwe manje.\n\nIzimpawu zakho aziphuthumile — phumula ekhaya uvakashele umtholampilo ngo-*${nextDay.label}* nalapho uvula ngo-*07:00*.\n\nUma izimpawu ziba zimbi ebusuku, yana esibhedlela esiseduze noma ushaye *10177*.\n\nSizokuthumelela isikhumbuzo ngo-*${nextDay.label}* ekuseni. 🔔`,
        xh: `⏰ Ikliniki ivaliwe ngoku.\n\nIimpawu zakho azingxamisekanga — phumla ekhaya uye ekliniki ngo-*${nextDay.label}* xa ivulwa ngo-*07:00*.\n\nUkuba iimpawu ziba mbi ebusuku, yiya esibhedlele esikufutshane okanye utsalele *10177*.\n\nSiza kukuthumela isikhumbuzo ngo-*${nextDay.label}* ekuseni. 🔔`,
        af: `⏰ Die kliniek is tans gesluit.\n\nJou simptome is nie dringend nie — rus by die huis en besoek die kliniek op *${nextDay.label}* wanneer dit om *07:00* oopmaak.\n\nAs simptome vanaand vererger, gaan na die naaste hospitaal noodafdeling of bel *10177*.\n\nOns stuur jou *${nextDay.label}* 'n herinnering. 🔔`,
        nso: `⏰ Kiliniki e tswaletšwe bjale.\n\nDika tša gago ga se tšhoganetšo — khutša gae o ye kiliniki ka *${nextDay.label}* ge e bula ka *07:00*.\n\nGe dika di mpefala bošego, ya sepetleleng sa kgauswi goba o leletše *10177*.\n\nRe tla go romela sekgopotšo ka *${nextDay.label}* ka mesa. 🔔`,
        tn: `⏰ Kliniki e tswaletswe jaanong.\n\nMatshwao a gago ga se tshoganyetso — ikhutse gae o ye kliniki ka *${nextDay.label}* fa e bula ka *07:00*.\n\nFa matshwao a mpefala bosigo, ya bookelong jo bo gaufi kgotsa o leletse *10177*.\n\nRe tla go romela sekgopotso ka *${nextDay.label}* mo mosong. 🔔`,
        st: `⏰ Kliniki e koetswe joale.\n\nMatshwao a hao ha se tshohanyetso — phomola lapeng o ye kliniki ka *${nextDay.label}* ha e bula ka *07:00*.\n\nHaeba matshwao a mpefala bosiu, eya sepetlele se haufi kapa o letsetse *10177*.\n\nRe tla o romella sekgopotso ka *${nextDay.label}* ka mesong. 🔔`,
        ts: `⏰ Kliniki yi pfariwile sweswi.\n\nSwikombiso swa wena a si xihatla — wisa ekaya u ya ekliniki ka *${nextDay.label}* loko yi vula ka *07:00*.\n\nLoko swikombiso swi nyanya nivusiku, ya exibedlhele xa kusuhi kumbe u letela *10177*.\n\nHi ta ku rhumela xikhumbutso ka *${nextDay.label}* nimixo. 🔔`,
        ss: `⏰ Ikliniki ivalwe nyalo.\n\nTimphawu takho akuphutfumi — phumula ekhaya uye emtfolamphilo ngo-*${nextDay.label}* nawuvula ngo-*07:00*.\n\nNangabe timphawu tiba timbi ebusuku, hamba esibhedlela leseduze noma ushayele *10177*.\n\nSitawukutfumelela sikhumbuto ngo-*${nextDay.label}* ekuseni. 🔔`,
        ve: `⏰ Kiliniki yo valwa zwino.\n\nZwiga zwaṋu a si tshoganetso — awelani hayani ni ye kiliniki nga *${nextDay.label}* musi yo vhuliwa nga *07:00*.\n\nArali zwiga zwi tshi ḓi vhifha vhusiku, iyani sibadela tshi re tsini kana ni founele *10177*.\n\nRi ḓo ni rumela tsivhudzo nga *${nextDay.label}* nga matsheloni. 🔔`,
        nr: `⏰ Ikliniki ivalwe nje.\n\nIimpawu zakho aziphuthumisi — phumula ekhaya uye ekliniki ngo-*${nextDay.label}* nawuvula ngo-*07:00*.\n\nNangabe iimpawu ziba zimbi ebusuku, yiya esibhedlela esiseduze namkha uringele *10177*.\n\nSitakuthumelelela isikhumbuzo ngo-*${nextDay.label}* ekuseni. 🔔`,
      };
      await sendWhatsAppMessage(from, greenAfterHoursMsg[lang] || greenAfterHoursMsg['en']);

      // Auto-schedule morning reminder — no need to ask, GREEN patients benefit from the nudge
      try {
        await supabase.from('follow_ups').insert({
          patient_id: patientId,
          phone: from,
          triage_level: 'GREEN',
          scheduled_at: nextDay.scheduledAt,
          status: 'pending',
          type: 'morning_reminder'
        });
      } catch (e) {
        logger.error('[GREEN_AFTER_HOURS] Failed to schedule morning reminder:', e.message);
      }

      await sendWhatsAppMessage(from, msg('tips', lang));
      await sessionLib.saveSession(patientId, session);
      return;
    }

    // Clinic is open — give patient the choice to visit now or manage at home
    const greenClinicOfferMsg = {
      en: 'Would you still like to visit a clinic?\n\n1 — Yes, help me find a clinic\n2 — No, I will manage at home',
      zu: 'Usafuna ukuya emtholampilo?\n\n1 — Yebo, ngisizeni ngithole umtholampilo\n2 — Cha, ngizozinakekela ekhaya',
      xh: 'Usafuna ukuya ekliniki?\n\n1 — Ewe, ndincedeni ndifumane ikliniki\n2 — Hayi, ndiza kuzinakekela ekhaya',
      af: 'Wil jy nog steeds \'n kliniek besoek?\n\n1 — Ja, help my om \'n kliniek te vind\n2 — Nee, ek sal by die huis regkom',
      nso: 'O sa nyaka go ya kliniki?\n\n1 — Ee, nthušeng ke hwetše kliniki\n2 — Aowa, ke tla itlhokomela ka gae',
      tn: 'A o sa batla go ya kliniki?\n\n1 — Ee, nthuseng ke bone kliniki\n2 — Nnyaa, ke tla ipabalela kwa gae',
      st: 'O sa batla ho ya kliniki?\n\n1 — E, nthuseng ke fumane kliniki\n2 — Tjhe, ke tla ipaballa ka lapeng',
      ts: 'U ha lava ku ya ekliniki?\n\n1 — Ina, ndzi pfuneni ndzi kuma kliniki\n2 — Ee-ee, ndzi ta titlhokomela ekaya',
      ss: 'Usafuna kuya emtfolamphilo?\n\n1 — Yebo, ngisiteni ngitfole umtfolamphilo\n2 — Cha, ngitawutinakekela ekhaya',
      ve: 'Ni tshi kha ḓi ṱoḓa u ya kha kiliniki?\n\n1 — Ee, nthuseni ndi wane kiliniki\n2 — Hai, ndi ḓo ḓilondola hayani',
      nr: 'Usafuna ukuya ekliniki?\n\n1 — Iye, ngisizeni ngifumane ikliniki\n2 — Awa, ngizozinakekela ekhaya',
    };
    session.awaitingGreenClinicChoice = true;
    session.lastTriage = triage;
    session.lastSymptoms = message;
    await sessionLib.saveSession(patientId, session);
    await sendWhatsAppMessage(from, greenClinicOfferMsg[lang] || greenClinicOfferMsg['en']);
    return;
  }

  // ==================== STEP 4.5: OFFER VIRTUAL CONSULT (YELLOW only) ====================
  if (FEATURES.VIRTUAL_CONSULTS && triage.triage_level === 'YELLOW') {
    const offered = await offerVirtualConsult(patientId, from, session);
    if (offered) return; // Wait for patient response
  }

  // ==================== STEP 5: FACILITY ROUTING (ORANGE/YELLOW) ====================
  const { pathway, facilityType } = getTriagePathway(triage.triage_level);
  session.lastPathway = pathway;

  if (!session.location) {
    // Ask for location
    session.pendingTriage = true;
    await sessionLib.saveSession(patientId, session);
    await sendWhatsAppMessage(from, msg('request_location', lang));
    return;
  }

  // Find nearest + alternatives
  const nearestFacilities = await findNearestFacilities(session.location, facilityType, 3);

  if (nearestFacilities.length === 0) {
    // No facilities found — generic guidance
    const genericMsg = triage.triage_level === 'ORANGE'
      ? msg('triage_orange', lang)
      : msg('triage_yellow', lang);
    await sendWhatsAppMessage(from, genericMsg);
    await sessionLib.logTriage({
      patient_id: patientId,
      whatsapp_message_id: messageId,
      triage_level: triage.triage_level,
      confidence: triage.confidence,
      escalation: false,
      pathway,
      facility_name: null,
      location: session.location,
      symptoms: message,
      reasoning: triage.reasoning || null,
      tews_score: triage.tews_score ?? null,
    });
    await sessionLib.scheduleFollowUp(patientId, from, triage.triage_level);
    await sessionLib.saveSession(patientId, session);
    return;
  }

  // Suggest nearest, offer alternatives
  const nearest = nearestFacilities[0];
  const alternatives = nearestFacilities.slice(1);

  session.suggestedFacility = nearest;
  session.alternativeFacilities = alternatives;
  session.awaitingFacilityConfirm = true;
  await sessionLib.saveSession(patientId, session);

  await sendFacilitySuggest(from, lang, nearest, session.lastTriage?.triage_level);

  // ==================== FALLBACK: UNRECOGNIZED INPUT ====================
  // If we reach here, the patient sent text that didn't match any step.
  // This is unreachable in normal flow (facility_suggest is the last action),
  // but the fallback below catches cases where the orchestrate function
  // falls through without hitting any handler.
}

// Wrapper that adds a fallback to orchestrate for unrecognized input
const _originalOrchestrate = orchestrate;
async function orchestrateWithFallback(patientId, from, message, session, messageId = null) {
  const lang = session.language || 'en';

  // Track if orchestrate sent any message by wrapping sendWhatsAppMessage
  let messageSent = false;
  const originalSend = sendWhatsAppMessage;
  const trackingSend = async (to, text) => {
    messageSent = true;
    return originalSend(to, text);
  };

  // We can't easily wrap sendWhatsAppMessage globally, so instead
  // we detect the fallback case: if the patient has completed onboarding
  // and their message doesn't match a category number or known command,
  // show them the category menu.
  
  // Check if message would fall through all handlers
  const isOnboarded = session.consent && session.identityDone && 
    session.chronicScreeningDone && (!FEATURES.STUDY_MODE || session.isStudyParticipant !== undefined);
  const isActiveStep = session.identityStep || session.awaitingSymptomDetail ||
    session.awaitingSymptomFollowUp || session.awaitingFacilityConfirm ||
    session.awaitingAlternativeChoice || session.awaitingTransportSafety ||
    session.awaitingReturningPatient || session.pendingLanguageChange ||
    session.pendingTriage || session.ccmddStep || session.virtualConsultStep ||
    session.symptomCompletenessAsked;
  const isCategory = /^([1-9]|1[0-3])$/.test(message);
  const isReset = message === '0';

  // Run normal orchestration
  await _originalOrchestrate(patientId, from, message, session, messageId);

  // If the patient is onboarded, not in an active step, and didn't type
  // a category number or reset command, they probably typed something
  // unrecognized. After orchestrate runs, check if we should show help.
  // We detect this by checking if session state changed (crude but effective).
  if (isOnboarded && !isActiveStep && !isCategory && !isReset) {
    const updatedSession = await sessionLib.getSession(patientId);
    // If no step was activated, show the menu
    if (!updatedSession.awaitingSymptomDetail && !updatedSession.awaitingFacilityConfirm &&
        !updatedSession.awaitingAlternativeChoice && !updatedSession.awaitingTransportSafety &&
        !updatedSession.awaitingReturningPatient && !updatedSession.pendingLanguageChange &&
        !updatedSession.awaitingSymptomFollowUp && !updatedSession.pendingTriage) {
      // Check if this was already handled (triage was run, facility was suggested, etc.)
      // by seeing if lastTriage changed
      if (JSON.stringify(updatedSession.lastTriage) === JSON.stringify(session.lastTriage)) {
        const fallbackMsg = {
          en: 'I didn\'t understand that. Here\'s what you can do:\n\nChoose a number from the menu below, or type:\n*0* — new consultation\n*code* — your reference number\n*passport* — your health summary link\n*language* — change language\n*help* — show menu',
          zu: 'Angikuzwanga lokho. Nanti ongakwenza:\n\nKhetha inombolo kumenyu engezansi, noma bhala:\n*0* — ukuxoxa okusha\n*code* — inombolo yakho\n*ulimi* — shintsha ulimi\n*help* — khombisa imenyu',
          xh: 'Andikuqondanga oko. Nantsi into onokuyenza:\n\nKhetha inombolo kwimenyu engezantsi, okanye bhala:\n*0* — incoko entsha\n*code* — inombolo yakho\n*ulwimi* — tshintsha ulwimi\n*help* — bonisa imenyu',
          af: 'Ek het dit nie verstaan nie. Hier is wat jy kan doen:\n\nKies \'n nommer uit die spyskaart hieronder, of tik:\n*0* — nuwe konsultasie\n*code* — jou verwysingsnommer\n*taal* — verander taal\n*help* — wys spyskaart',
          nso: 'Ga ke kwešiše seo. Se o ka se dirang:\n\nKgetha nomoro go tšwa go menyu ye e lego ka fase, goba ngwala:\n*0* — poledišano ye mpsha\n*code* — nomoro ya gago\n*puo* — fetola puo\n*help* — bontšha menyu',
          tn: 'Ga ke a tlhaloganya seo. Se o ka se dirang:\n\nTlhopha nomoro go tswa mo menyu e e fa tlase, kgotsa kwala:\n*0* — puisano e ntšhwa\n*code* — nomoro ya gago\n*puo* — fetola puo\n*help* — bontsha menyu',
          st: 'Ha ke utlwisise seo. Sena o ka se etsang:\n\nKgetha nomoro ho tswa ho menyu e ka tlase, kapa ngola:\n*0* — puisano e ntjha\n*code* — nomoro ya hao\n*puo* — fetola puo\n*help* — bontsha menyu',
          ts: 'A ndzi twisisanga sweswo. Leswi u nga swi endlaka:\n\nHlawula nomboro eka menyu leyi nga ehansi, kumbe tsala:\n*0* — mbulavurisano leyintshwa\n*code* — nomboro ya wena\n*ririmi* — cinca ririmi\n*help* — komba menyu',
          ss: 'Angikuvisanga loko. Naku longakwenta:\n\nKhetsa inombolo kumenyu lengentansi, noma bhala:\n*0* — ingcoco lensha\n*code* — inombolo yakho\n*lulwimi* — gucula lulwimi\n*help* — khombisa imenyu',
          ve: 'A tho ngo pfesesa zwenezwo. Zwine na nga zwi ita:\n\nNangani nomboro kha menyu ye i re fhasi, kana ngwalani:\n*0* — nyambedzano ntswa\n*code* — nomboro yaṋu\n*luambo* — shanduka luambo\n*help* — sumbedza menyu',
          nr: 'Angikuzwisisanga loko. Naku ongakwenza:\n\nKhetha inomboro kumenyu engenzasi, noma tlola:\n*0* — ikulumiswano etja\n*code* — inomboro yakho\n*ilimi* — tjhintjha ilimi\n*help* — khombisa imenyu',
        };
        await sendWhatsAppMessage(from, fallbackMsg[lang] || fallbackMsg['en']);
        await sendWhatsAppMessage(from, msg('category_menu', lang));
      }
    }
  }
}

// ================== MESSAGE DEDUP ==================
// WhatsApp sometimes delivers the same message twice (network retries).
// Without dedup, the system would triage twice and send duplicate results.
// We track recent message IDs in memory with a 5-minute TTL.
const recentMessageIds = new Map(); // messageId → timestamp
const DEDUP_TTL_MS = 5 * 60 * 1000; // 5 minutes

// Clean old entries every minute
setInterval(() => {
  const now = Date.now();
  for (const [id, timestamp] of recentMessageIds) {
    if (now - timestamp > DEDUP_TTL_MS) recentMessageIds.delete(id);
  }
}, 60 * 1000);

// ================== RATE LIMITING ==================
// Prevents abuse and runaway API costs from message flooding.
// Max 10 messages per phone number per 60-second window.
// Legitimate patients rarely send more than 3-4 messages per minute.
const rateLimitMap = new Map(); // phone → { count, windowStart }
const RATE_LIMIT_MAX = 10;
const RATE_LIMIT_WINDOW_MS = 60 * 1000;

function isPhoneRateLimited(phone) {
  const now = Date.now();
  const entry = rateLimitMap.get(phone);

  if (!entry || (now - entry.windowStart) > RATE_LIMIT_WINDOW_MS) {
    rateLimitMap.set(phone, { count: 1, windowStart: now });
    return false;
  }

  entry.count++;
  if (entry.count > RATE_LIMIT_MAX) {
    return true;
  }
  return false;
}

// Clean rate limit map every 5 minutes
setInterval(() => {
  const now = Date.now();
  for (const [phone, entry] of rateLimitMap) {
    if (now - entry.windowStart > RATE_LIMIT_WINDOW_MS * 2) rateLimitMap.delete(phone);
  }
}, 5 * 60 * 1000);

// ================== MAIN HANDLER ==================
async function handleMessage(msgObj) {
  // Dedup: skip if we've already processed this message ID
  const messageId = msgObj.id;
  if (messageId) {
    if (recentMessageIds.has(messageId)) {
      logger.info(`[DEDUP] Skipping duplicate message: ${messageId}`);
      return;
    }
    recentMessageIds.set(messageId, Date.now());
  }

  const from = msgObj.from;

  // Rate limiting: prevent message flooding (per phone number)
  if (isPhoneRateLimited(from)) {
    logger.warn(`[RATE_LIMIT] Throttled: ${from} exceeded ${RATE_LIMIT_MAX} msgs/min`);
    return; // Silently drop — don't send a response (would encourage retries)
  }

  // Resolve patient ID — shared phones have sub-IDs (e.g. abc123_2)
  const basePatientId = sessionLib.hashPhone(from);
  let baseSession = await sessionLib.getSession(basePatientId);
  let patientId = (baseSession._isSharedPhone && baseSession._activeSubId)
    ? baseSession._activeSubId
    : basePatientId;
  let session = (patientId !== basePatientId)
    ? await sessionLib.getSession(patientId)
    : baseSession;

  // ==================== STOP — CONSENT WITHDRAWAL ====================
  // POPIA s11(3)(c): patient may withdraw consent at any time.
  // We must honour it immediately: delete all personal data and confirm.
  // Audit record is written BEFORE deletion (so the withdrawal is provable).
  if (msgObj.type === 'text') {
    const stopText = msgObj.text.body.trim().toUpperCase();
    if (stopText === 'STOP' || stopText === 'STOP.' || stopText === 'UNSUBSCRIBE') {
      const lang = session.language || 'en';
      // Log withdrawal FIRST — before any deletion
      await logConsent(patientId, 'service_consent_withdrawn', lang, CONSENT_VERSION,
        { study_code: session.studyCode || null, trigger: stopText });
      // Delete ALL personal data across all tables (POPIA s11(3)(c))
      // consent_log is intentionally KEPT — it's the proof that withdrawal happened.
      await Promise.all([
        supabase.from('sessions').delete().eq('patient_id', patientId),
        supabase.from('triage_logs').delete().eq('patient_id', patientId),
        supabase.from('follow_ups').delete().eq('patient_id', patientId),
        supabase.from('follow_up_outcomes').delete().eq('patient_id', patientId),
        supabase.from('clinic_queue').delete().eq('patient_id', patientId),
        supabase.from('referrals').delete().eq('patient_id', patientId),
        supabase.from('pre_arrival_alerts').delete().eq('patient_id', patientId),
        supabase.from('study_codes').delete().eq('patient_id', patientId),
        supabase.from('patient_identities').delete().eq('patient_id', patientId),
        supabase.from('triage_feedback').delete().eq('patient_id', patientId),
        supabase.from('doctor_referrals').delete().eq('patient_id', patientId),
        supabase.from('dispensing_outcomes').delete().eq('patient_id', patientId),
        supabase.from('satisfaction_surveys').delete().eq('patient_id', patientId),
        supabase.from('discharge_summaries').delete().eq('patient_id', patientId),
        supabase.from('regimen_changes').delete().eq('patient_id', patientId),
        supabase.from('vitals_history').delete().eq('patient_id', patientId),
        supabase.from('patient_allergies').delete().eq('patient_id', patientId),
      ].map(p => p.catch(e => logger.error('[STOP] Table delete error:', e.message))));
      // Also clear any shared-phone sub-IDs that point to this patient.
      // Instead of scanning all sessions, target the base phone hash (the
      // shared-phone parent session that contains _activeSubId pointers).
      const baseId = sessionLib.hashPhone(from);
      if (baseId !== patientId) {
        // This patient was accessed via a shared-phone sub-ID.
        // Clear the parent session's pointer so it doesn't reference deleted data.
        try {
          const { data: parentSession } = await supabase
            .from('sessions').select('data')
            .eq('patient_id', baseId).single();
          if (parentSession?.data?._activeSubId === patientId) {
            await supabase.from('sessions').update({ data: {} }).eq('patient_id', baseId);
          }
        } catch (e) { /* parent may not exist — fine */ }
      } else {
        // This IS the base session. Clear any sub-ID pointer it held.
        // The sub-ID's own data was already deleted above.
        try {
          await supabase.from('sessions')
            .update({ data: {} })
            .eq('patient_id', baseId);
        } catch (e) { /* already deleted — fine */ }
      }
      // Confirm to patient in their language
      const stopConfirmMsg = {
        en: `✅ You have been unsubscribed from BIZUSIZO.\n\nAll your personal information has been deleted. You will not receive any further messages.\n\nIf you ever need health guidance again, send "Hi" to start a new session.`,
        zu: `✅ Usukhishiwe ku-BIZUSIZO.\n\nYonke imininingwane yakho yomuntu ihiliwe. Ngeke uthole eminye imilayezo.\n\nUma udinga iseluleko sezempilo futhi, thumela "Hi" ukuqala isikhathi esisha.`,
        xh: `✅ Ususiwe ku-BIZUSIZO.\n\nYonke iinkcukacha zakho zomntu zisuwe. Akuyi kufumana manye amayalezo.\n\nUkuba ufuna ingcebiso yezempilo kwakhona, thumela "Hi" ukuqala iseshoni entsha.`,
        af: `✅ Jy is uitgeteken van BIZUSIZO.\n\nAl jou persoonlike inligting is uitgewis. Jy sal geen verdere boodskappe ontvang nie.\n\nAs jy ooit weer gesondheidsgeleiding nodig het, stuur "Hi" om 'n nuwe sessie te begin.`,
        nso: `✅ O tlosiwa go BIZUSIZO.\n\nTshedimošo yohle ya gago ya motho e phumulotšwe. Ga o na go amogela melaetša gape.\n\nGe o nyaka maele a tša maphelo gape, romela "Hi" go thoma sešene se sešwa.`,
        tn: `✅ O tlositwe go BIZUSIZO.\n\nTshedimosetso yotlhe ya gago ya motho e phimotse. Ga o kitla o amogela melaetsa gape.\n\nFa o tlhoka kgakololo ya boitekanelo gape, romela "Hi" go simolola seshene se ntšhwa.`,
        st: `✅ O tlositswe ho BIZUSIZO.\n\nTlhahisoleseding yohle ya hao ya motho e phumotse. Ha o na ho fumana melaetsa e mengwe.\n\nHa o hloka tataiso ya bophelo hape, romela "Hi" ho qala seshene e ntjha.`,
        ts: `✅ U susiwa eka BIZUSIZO.\n\nVuxokoxoko hinkwavyo bya wena bya munhu byi susiwa. U nga si amukeli switsundzuxo swin'wana.\n\nLoko u lava switsundzuxo swa rihanyo nakambe, rhumela "Hi" ku sungula sesheni leyintshwa.`,
        ss: `✅ Usunyulwe ku-BIZUSIZO.\n\nLonkhe lwati lwakho lomuntfu lususwe. Ngeke utfole tincwadzi letinye.\n\nNawudzinga teluleko yempilo futsi, tfumela "Hi" kucala sishini lesisha.`,
        ve: `✅ No bviswa kha BIZUSIZO.\n\nMafhungo othe aṋu a muthu o fhiswa. A ni tsha ḓo wana miṅwalelo yiṅwe.\n\nArali na ṱoḓa vhulivhisi ha mutakalo hafhu, rumelani "Hi" u thoma sesheni ntswa.`,
        nr: `✅ Usunyulwe ku-BIZUSIZO.\n\nLonke ulwazi lwakho lomuntu lususiwe. Ngeke uthole imiyalezo eminye.\n\nNawudzinga isinqophiso sezempilo godu, thumela "Hi" ukuqala iseshini entsha.`,
      };
      await sendWhatsAppMessage(from, stopConfirmMsg[lang] || stopConfirmMsg['en']);
      return;
    }
  }

  // RESET COMMAND — with shared phone detection (#4)
  // In SA, families share phones. Ask if same person or different.
  const isOnboarded = session.consent && session.identityDone && session.chronicScreeningDone && (!FEATURES.STUDY_MODE || session.isStudyParticipant !== undefined);
  const inboundText = (msgObj.type === 'text' ? msgObj.text.body.trim() : '').toLowerCase();
  const isGreeting = /^(hi|hello|hie|sawubona|molo|hallo|thobela|dumela|lumela|xewani|lotjha|aa|re a go amogela|re a lo amogela)$/i.test(inboundText);

  // EC1 FIX — New person grabs phone and sends greeting after a completed session
  // Trigger shared phone check when: session is fully onboarded AND a greeting arrives
  // (The '0' reset handles mid-session; this handles post-session new arrivals)
  if (msgObj.type === 'text' && isGreeting && isOnboarded && !session.awaitingSharedPhoneCheck) {
    session.awaitingSharedPhoneCheck = true;
    await sessionLib.saveSession(patientId, session);
    const lang = session.language || 'en';
    const name = (session.firstName && session.firstName.toLowerCase() !== 'skip' && session.firstName.length > 1) ? session.firstName : null;
    const sharedPhoneCheckMsg = {
      en: name ? `Welcome back! Are you *${name}*?

1 — Yes, it's me (new consultation)
2 — No, I am a different person` : `Welcome back! Are you the same person as before?

1 — Yes, new consultation
2 — No, I am a different person`,
      zu: name ? `Siyakwamukela! Ungubani *${name}*?

1 — Yebo, yimina (ukuxoxisana okusha)
2 — Cha, ngingomunye umuntu` : `Siyakwamukela! Ungumuntu ofanayo nangaphambili?

1 — Yebo, ukuxoxisana okusha
2 — Cha, ngingomunye umuntu`,
      xh: name ? `Wamkelekile! Ungu *${name}*?

1 — Ewe, ndim (ingxoxo entsha)
2 — Hayi, ndimntu owahlukileyo` : `Wamkelekile! Ungumntu ofanayo nangaphambili?

1 — Ewe, ingxoxo entsha
2 — Hayi, ndimntu owahlukileyo`,
      af: name ? `Welkom terug! Is jy *${name}*?

1 — Ja, dis ek (nuwe konsultasie)
2 — Nee, ek is 'n ander persoon` : `Welkom terug! Is jy dieselfde persoon as voorheen?

1 — Ja, nuwe konsultasie
2 — Nee, ek is 'n ander persoon`,
      nso: name ? `O amogelwa! Na o *${name}*?

1 — Ee, ke nna (poledišano ye mpsha)
2 — Aowa, ke motho o mongwe` : `O amogelwa! Na o motho yola wa pele?

1 — Ee, poledišano ye mpsha
2 — Aowa, ke motho o mongwe`,
      tn: name ? `O amogelwa! A o *${name}*?

1 — Ee, ke nna (puisano e ntšhwa)
2 — Nnyaa, ke motho o sele` : `O amogelwa! A o motho yoo o neng o le teng pele?

1 — Ee, puisano e ntšhwa
2 — Nnyaa, ke motho o sele`,
      st: name ? `O amohelwa! Na o *${name}*?

1 — E, ke nna (puisano e ntjha)
2 — Tjhe, ke motho e mong` : `O amohelwa! Na o motho yane oa pele?

1 — E, puisano e ntjha
2 — Tjhe, ke motho e mong`,
      ts: name ? `U amukeriwa! Xana u *${name}*?

1 — Ina, hi mina (mbulavurisano leyintshwa)
2 — E-e, ndzi munhu un'wana` : `U amukeriwa! Xana u munhu loyi a a ri kona?

1 — Ina, mbulavurisano leyintshwa
2 — E-e, ndzi munhu un'wana`,
      ss: name ? `Wemukelekile! Nguwe *${name}*?

1 — Yebo, ngimi (ingcoco lensha)
2 — Cha, ngingulomunye umuntfu` : `Wemukelekile! Nguwe lomuntfu lobekakhona?

1 — Yebo, ingcoco lensha
2 — Cha, ngingulomunye umuntfu`,
      ve: name ? `Ni a ṱanganedzwa! Ndi inwi *${name}*?

1 — Ee, ndi nne (nyambedzano ntswa)
2 — Hai, ndi muthu muswa` : `Ni a ṱanganedzwa! Ndi inwi muthu we a vha hone?

1 — Ee, nyambedzano ntswa
2 — Hai, ndi muthu muswa`,
      nr: name ? `Wamukelekile! Nguwe *${name}*?

1 — Iye, ngimi (ikulumiswano etja)
2 — Awa, ngimunye umuntu` : `Wamukelekile! Nguwe umuntu lobekakhona?

1 — Iye, ikulumiswano etja
2 — Awa, ngimunye umuntu`,
    };
    await sendWhatsAppMessage(from, sharedPhoneCheckMsg[lang] || sharedPhoneCheckMsg['en']);
    return;
  }

  // EC3 FIX — New person grabs phone mid-active-session (RED triage, transport safety, etc.)
  // If session has active awaiting states and a greeting arrives, gently intercept
  const hasActiveAwaitingState = session.awaitingTransportSafety || session.awaitingTransportMethod
    || session.awaitingFacilityConfirm || session.awaitingFollowUp;
  if (msgObj.type === 'text' && isGreeting && hasActiveAwaitingState && !session.awaitingSharedPhoneCheck) {
    session.awaitingSharedPhoneCheck = true;
    await sessionLib.saveSession(patientId, session);
    const lang = session.language || 'en';
    const name = (session.firstName && session.firstName.toLowerCase() !== 'skip' && session.firstName.length > 1) ? session.firstName : null;
    const interruptMsg = {
      en: name ? `There is an active consultation for *${name}*. Are you *${name}*?

1 — Yes, continue my consultation
2 — No, I am a different person` : `There is an active consultation on this phone. Are you the same person?

1 — Yes, continue the consultation
2 — No, I am a different person`,
      zu: name ? `Kukhona ukuxoxisana okusebenzayo ku-*${name}*. Ungubani *${name}*?

1 — Yebo, qhubeka ukuxoxisana kwami
2 — Cha, ngingomunye umuntu` : `Kukhona ukuxoxisana okusebenzayo kuleli foni. Ungumuntu ofanayo?

1 — Yebo, qhubeka nokuxoxisana
2 — Cha, ngingomunye umuntu`,
      xh: name ? `Kukho ingxoxo esebenzayo ye-*${name}*. Ungu *${name}*?

1 — Ewe, qhubeka ingxoxo yam
2 — Hayi, ndimntu owahlukileyo` : `Kukho ingxoxo esebenzayo kwifowuni. Ungumntu ofanayo?

1 — Ewe, qhubeka ingxoxo
2 — Hayi, ndimntu owahlukileyo`,
      af: name ? `Daar is 'n aktiewe konsultasie vir *${name}*. Is jy *${name}*?

1 — Ja, gaan voort met my konsultasie
2 — Nee, ek is 'n ander persoon` : `Daar is 'n aktiewe konsultasie op hierdie foon. Is jy dieselfde persoon?

1 — Ja, gaan voort
2 — Nee, ek is 'n ander persoon`,
      nso: name ? `Go na le poledišano ye e lego gona ya *${name}*. Na o *${name}*?

1 — Ee, tšwela pele le poledišano ya ka
2 — Aowa, ke motho o mongwe` : `Go na le poledišano ye e lego gona mogaleng o. Na o motho yola?

1 — Ee, tšwela pele
2 — Aowa, ke motho o mongwe`,
      tn: name ? `Go na le puisano e e tswelang pele ya *${name}*. A o *${name}*?

1 — Ee, tswelela le puisano ya me
2 — Nnyaa, ke motho o sele` : `Go na le puisano e e tswelang pele mogaleng ono. A o motho yoo?

1 — Ee, tswelela
2 — Nnyaa, ke motho o sele`,
    };
    await sendWhatsAppMessage(from, interruptMsg[lang] || interruptMsg['en']);
    return;
  }

  // EC7 FIX — New person grabs phone during Phase 2 identity collection
  // Phase 2 asks for name, surname etc — a new person might answer with their own details
  // Detect: Phase 2 is active AND a greeting arrives
  if (msgObj.type === 'text' && isGreeting && session.phase2Step && session.phase2Step !== 'done' && !session.awaitingSharedPhoneCheck) {
    session.awaitingSharedPhoneCheck = true;
    await sessionLib.saveSession(patientId, session);
    const lang = session.language || 'en';
    const interruptPhase2Msg = {
      en: `We were collecting details for a recent triage. Are you the same person?

1 — Yes, continue with my details
2 — No, I am a different person`,
      zu: `Siqoqa imininingwane yokuhlolwa kwakuqala. Ungumuntu ofanayo?

1 — Yebo, qhubeka nezinhlelo zami
2 — Cha, ngingomunye umuntu`,
      xh: `Sasibutha iinkcukacha ze-triage yamuva nje. Ungumntu ofanayo?

1 — Ewe, qhubeka neenkcukacha zam
2 — Hayi, ndimntu owahlukileyo`,
      af: `Ons was besig om besonderhede vir 'n onlangse triage te versamel. Is jy dieselfde persoon?

1 — Ja, gaan voort met my besonderhede
2 — Nee, ek is 'n ander persoon`,
      nso: `Re be re kgotha tshedimošo ya go hlola ga monaganong. Na o motho yola?

1 — Ee, tšwela pele le tshedimošo ya ka
2 — Aowa, ke motho o mongwe`,
      tn: `Re ne re kgotha tshedimosetso ya tlhahlobo ya monaganong. A o motho yoo?

1 — Ee, tswelela le tshedimosetso ya me
2 — Nnyaa, ke motho o sele`,
    };
    await sendWhatsAppMessage(from, interruptPhase2Msg[lang] || interruptPhase2Msg['en']);
    return;
  }

  // RESET COMMAND — with shared phone detection (#4)
  // In SA, families share phones. Ask if same person or different.
  if (msgObj.type === 'text' && inboundText === '0' && isOnboarded && !session.awaitingSharedPhoneCheck) {
    session.awaitingSharedPhoneCheck = true;
    await sessionLib.saveSession(patientId, session);
    const lang = session.language || 'en';
    const name = (session.firstName && session.firstName.toLowerCase() !== 'hi' && session.firstName.length > 1) ? session.firstName : null;
    const sharedPhoneMsg = {
      en: name ? `Are you *${name}*?\n\n1 — Yes, it's me (new consultation)\n2 — No, I am a different person` : `Are you the same person as before?\n\n1 — Yes, it's me (new consultation)\n2 — No, I am a different person`,
      zu: name ? `Ungubani *${name}*?\n\n1 — Yebo, yimina (ukuxoxisana okusha)\n2 — Cha, ngingomunye umuntu` : `Ungumuntu ofanayo nangaphambili?\n\n1 — Yebo, yimina (ukuxoxisana okusha)\n2 — Cha, ngingomunye umuntu`,
      xh: name ? `Ungu *${name}*?\n\n1 — Ewe, ndim (ingxoxo entsha)\n2 — Hayi, ndimntu owahlukileyo` : `Ungumntu ofanayo nangaphambili?\n\n1 — Ewe, ndim (ingxoxo entsha)\n2 — Hayi, ndimntu owahlukileyo`,
      af: name ? `Is jy *${name}*?\n\n1 — Ja, dis ek (nuwe konsultasie)\n2 — Nee, ek is 'n ander persoon` : `Is jy dieselfde persoon as voorheen?\n\n1 — Ja, dis ek (nuwe konsultasie)\n2 — Nee, ek is 'n ander persoon`,
      nso: name ? `Na o *${name}*?\n\n1 — Ee, ke nna (poledišano ye mpsha)\n2 — Aowa, ke motho o mongwe` : `Na o motho yola wa pele?\n\n1 — Ee, ke nna (poledišano ye mpsha)\n2 — Aowa, ke motho o mongwe`,
      tn: name ? `A o *${name}*?\n\n1 — Ee, ke nna (puisano e ntšhwa)\n2 — Nnyaa, ke motho o sele` : `A o motho yoo o neng o le teng pele?\n\n1 — Ee, ke nna (puisano e ntšhwa)\n2 — Nnyaa, ke motho o sele`,
      st: name ? `Na o *${name}*?\n\n1 — E, ke nna (puisano e ntjha)\n2 — Tjhe, ke motho e mong` : `Na o motho yane oa pele?\n\n1 — E, ke nna (puisano e ntjha)\n2 — Tjhe, ke motho e mong`,
      ts: name ? `Xana u *${name}*?\n\n1 — Ina, hi mina (mbulavurisano leyintshwa)\n2 — E-e, ndzi munhu un'wana` : `Xana u munhu loyi a a ri kona ku rhanga?\n\n1 — Ina, hi mina (mbulavurisano leyintshwa)\n2 — E-e, ndzi munhu un'wana`,
      ss: name ? `Nguwe *${name}*?\n\n1 — Yebo, ngimi (ingcoco lensha)\n2 — Cha, ngingulomunye umuntfu` : `Nguwe lomuntfu lobekakhona ngaphambilini?\n\n1 — Yebo, ngimi (ingcoco lensha)\n2 — Cha, ngingulomunye umuntfu`,
      ve: name ? `Ndi inwi *${name}*?\n\n1 — Ee, ndi nne (nyambedzano ntswa)\n2 — Hai, ndi muthu muswa` : `Ndi inwi muthu we a vha hone nga murahu?\n\n1 — Ee, ndi nne (nyambedzano ntswa)\n2 — Hai, ndi muthu muswa`,
      nr: name ? `Nguwe *${name}*?\n\n1 — Iye, ngimi (ikulumiswano etja)\n2 — Awa, ngimunye umuntu` : `Nguwe umuntu lobekakhona ngaphambilini?\n\n1 — Iye, ngimi (ikulumiswano etja)\n2 — Awa, ngimunye umuntu`,
    };
    await sendWhatsAppMessage(from, sharedPhoneMsg[lang] || sharedPhoneMsg['en']);
    return;
  }

  // Handle shared phone check response
  if (session.awaitingSharedPhoneCheck && msgObj.type === 'text') {
    const answer = msgObj.text.body.trim();
    session.awaitingSharedPhoneCheck = false;
    const lang = session.language || 'en';
    if (answer === '1') {
      const preserved = {
        language: session.language, consent: session.consent,
        firstName: session.firstName, surname: session.surname, dob: session.dob,
        sex: session.sex, identityDone: session.identityDone,
        chronicConditions: session.chronicConditions, ccmddConditions: session.ccmddConditions,
        chronicScreeningDone: session.chronicScreeningDone,
        isStudyParticipant: session.isStudyParticipant, studyCode: session.studyCode,
        location: session.location, patientAge: session.patientAge,
        isReturningPatient: session.isReturningPatient, fileStatus: session.fileStatus,
      };
      await sessionLib.saveSession(patientId, preserved);
      const resetMsg = { en: 'Conversation reset. How can we help you today?', zu: 'Ingxoxo iqalwe kabusha. Singakusiza kanjani namhlanje?', xh: 'Ingxoxo iqalwe kwakhona. Singakunceda njani namhlanje?', af: 'Gesprek herstel. Hoe kan ons jou vandag help?', nso: 'Poledišano e thomilwe lefsa. Re ka go thuša bjang lehono?', tn: 'Puisano e simolotse sešwa. Re ka go thusa jang gompieno?', st: 'Puisano e qadile bocha. Re ka o thusa joang kajeno?', ts: 'Mbulavurisano yi sungurile hi vuntshwa. Hi nga ku pfuna njhani namuntlha?', ss: 'Ingcoco icale kabusha. Singakusita njani lamuhla?', ve: 'Nyambedzano yo thoma hafhu. Ri nga ni thusa hani ṋamusi?', nr: 'Ikulumiswano ithome kabutjha. Singakusiza njani namhlanje?' };
      await sendWhatsAppMessage(from, resetMsg[lang] || resetMsg['en']);
      await sendWhatsAppMessage(from, msg('category_menu', lang));
      return;
    } else if (answer === '2') {
      // SHARED PHONE: Generate a new patient ID so this person's data
      // is completely separate from the previous user of this phone.
      // Count existing sub-IDs for this phone to determine the suffix.
      const baseId = sessionLib.hashPhone(from);
      const { data: existingSessions } = await supabase
        .from('sessions')
        .select('patient_id')
        .like('patient_id', baseId + '%');
      const subCount = (existingSessions || []).length + 1;
      const newPatientId = subCount <= 1 ? baseId + '_2' : baseId + '_' + subCount;

      // Store mapping so incoming messages from this phone route to the new person
      // Save the active sub-ID in the base session so the webhook can resolve it
      await sessionLib.saveSession(baseId, { _activeSubId: newPatientId, _isSharedPhone: true });
      await sessionLib.saveSession(newPatientId, {});

      // Re-assign patientId for the rest of this message's processing
      // (the next message will be routed via _activeSubId lookup)
      const freshMsg = { en: 'Welcome! Starting fresh for a new person.', zu: 'Siyakwamukela! Siqala kabusha nomunye umuntu.', xh: 'Wamkelekile! Siqala ngokutsha nomntu omtsha.', af: 'Welkom! Begin vars vir \'n nuwe persoon.', nso: 'O amogetšwe! Re thoma lefsa bakeng sa motho o moswa.', tn: 'O amogelwa! Re simolola sešwa bakeng sa motho o mošwa.', st: 'O amohelwa! Re qala bocha bakeng sa motho e mocha.', ts: 'U amukeriwa! Hi sungula hi vuntshwa eka munhu mun\'wana.', ss: 'Wemukelekile! Sicala kabusha nalomunye umuntfu.', ve: 'Ni a ṱanganedzwa! Ri thoma hafhu na muthu muswa.', nr: 'Wamukelekile! Sithoma kabutjha nomunye umuntu.' };
      await sendWhatsAppMessage(from, freshMsg[lang] || freshMsg['en']);
      await sendWhatsAppMessage(from, MESSAGES.language_menu._all);
      return;
    } else {
      session.awaitingSharedPhoneCheck = true;
      await sessionLib.saveSession(patientId, session);
      const clarifyMsg = { en: 'Please reply with 1 (same person) or 2 (different person).', zu: 'Sicela uphendule ngo-1 (umuntu ofanayo) noma ngo-2 (omunye umuntu).', xh: 'Nceda phendula ngo-1 (umntu ofanayo) okanye ngo-2 (omnye umntu).', af: 'Antwoord asseblief met 1 (dieselfde persoon) of 2 (ander persoon).', nso: 'Hle araba ka 1 (motho yola) goba 2 (motho o mongwe).', tn: 'Tsweetswee araba ka 1 (motho yoo) kgotsa 2 (motho o sele).', st: 'Ka kopo araba ka 1 (motho yane) kapa 2 (motho e mong).', ts: 'Hi kombela u hlamula hi 1 (munhu loyi) kumbe 2 (munhu un\'wana).', ss: 'Sicela uphendvule nge-1 (umuntfu lofanako) noma nge-2 (lomunye umuntfu).', ve: 'Ri humbela ni fhindule nga 1 (muthu uyo) kana 2 (muthu muswa).', nr: 'Sibawa uphendule nge-1 (umuntu ofanako) namkha nge-2 (omunye umuntu).' };
      await sendWhatsAppMessage(from, clarifyMsg[lang] || clarifyMsg['en']);
      return;
    }
  }

  // LOCATION HANDLING
  if (msgObj.type === 'location') {
    session.location = msgObj.location;
    await sessionLib.saveSession(patientId, session);

    const lang = session.language || 'en';

    // If we were waiting for location to complete routing
    if (session.pendingTriage && session.lastTriage) {
      session.pendingTriage = false;
      const { facilityType } = getTriagePathway(session.lastTriage.triage_level);
      const nearestFacilities = await findNearestFacilities(session.location, facilityType, 3);

      if (nearestFacilities.length > 0) {
        const nearest = nearestFacilities[0];
        const alternatives = nearestFacilities.slice(1);
        session.suggestedFacility = nearest;
        session.alternativeFacilities = alternatives;
        session.awaitingFacilityConfirm = true;
        await sessionLib.saveSession(patientId, session);
        await sendFacilitySuggest(from, lang, nearest, session.lastTriage?.triage_level);
      } else {
        await sendWhatsAppMessage(from, msg('triage_yellow', lang));
        await sessionLib.saveSession(patientId, session);
      }
      return;
    }

    // If patient was asked for clinic name and sent location instead, flag it
    // so the awaitingClinicName handler in orchestrate() can use the location
    if (session.awaitingClinicName) {
      session._locationJustReceived = true;
      await sessionLib.saveSession(patientId, session);
      // Don't return — let it fall through to orchestrateWithFallback
      // which will call orchestrate() where awaitingClinicName handler will pick it up
    } else {
      await sendWhatsAppMessage(from, '📍 ' + (lang === 'en' ? 'Location received.' : 'Location received.'));
      return;
    }
  }

  // ==================== VOICE NOTE HANDLING ====================
  // WhatsApp voice notes (audio messages) are transcribed by Claude
  // and treated as symptom descriptions. Critical for SA patients
  // who prefer speaking over typing.
  if (msgObj.type === 'audio') {
    const lang = session.language || 'en';
    const mediaId = msgObj.audio?.id;

    if (!mediaId) return;

    await sendWhatsAppMessage(from, msg('voice_note_received', lang));

    try {
      const audioBuffer = await downloadWhatsAppMedia(mediaId);
      if (!audioBuffer) {
        await sendWhatsAppMessage(from, lang === 'en'
          ? 'Sorry, I could not process your voice note. Please try typing your symptoms instead.'
          : 'Siyaxolisa, asikwazanga ukucubungula ivoice note yakho. Sicela uzame ukubhala izimpawu zakho.');
        return;
      }

      const transcription = await transcribeVoiceNote(audioBuffer, lang);
      if (!transcription) {
        await sendWhatsAppMessage(from, lang === 'en'
          ? 'Sorry, I could not understand your voice note. Please try again or type your symptoms.'
          : 'Siyaxolisa, asizwanga ivoice note yakho. Sicela uzame futhi noma ubhale izimpawu zakho.');
        return;
      }

      // Feed the transcription into the normal orchestration flow
      // Flag as voice_note source so triage log and dashboard can show this to nurses
      session.input_source = 'voice_note';
      await sessionLib.saveSession(patientId, session);

      // If patient was in category detail step, prepend category context
      if (session.awaitingSymptomDetail && session.selectedCategory) {
        const categoryContext = CATEGORY_DESCRIPTIONS[session.selectedCategory] || '';
        const enrichedText = `Category: ${categoryContext}. Patient says: ${transcription}`;
        session.awaitingSymptomDetail = false;
        await sessionLib.saveSession(patientId, session);
        await orchestrateWithFallback(patientId, from, enrichedText, session, msgObj?.id || null);
      } else {
        await orchestrateWithFallback(patientId, from, transcription, session, msgObj?.id || null);
      }
      // Clear after use so next typed message doesn't inherit the flag
      session.input_source = null;
      await sessionLib.saveSession(patientId, session);
    } catch (e) {
      logger.error('[VOICE] Error handling voice note:', e.message);
      await sendWhatsAppMessage(from, lang === 'en'
        ? 'Sorry, something went wrong processing your voice note. Please type your symptoms instead.'
        : 'Kukhona okungahambanga kahle. Sicela ubhale izimpawu zakho.');
    }
    return;
  }

  // UNSUPPORTED MESSAGE TYPES (stickers, images, videos, contacts, documents)
  if (msgObj.type !== 'text') {
    const lang = session.language || 'en';
    const unsupportedMsg = {
      en: 'Sorry, I can only read text messages and voice notes. Please type your message or send a voice note 🎤\n\nType *0* to start over or *help* for the menu.',
      zu: 'Siyaxolisa, ngifunda imiyalezo yombhalo namavoice note kuphela. Sicela ubhale umyalezo noma uthumele ivoice note 🎤\n\nBhala *0* ukuqala kabusha noma *help* ukubona imenyu.',
      xh: 'Siyaxolisa, ndifunda imiyalezo yombhalo neevoice note kuphela. Nceda ubhale umyalezo okanye uthumele ivoice note 🎤\n\nBhala *0* ukuqala kwakhona okanye *help* ukubona imenyu.',
      af: 'Jammer, ek kan net teksboodskappe en stemnota\'s lees. Tik asseblief jou boodskap of stuur \'n stemnota 🎤\n\nTik *0* om oor te begin of *help* vir die spyskaart.',
      nso: 'Tshwarelo, ke bala melaetša ya mongwalo le di-voice note fela. Hle ngwala molaetša goba romela voice note 🎤\n\nNgwala *0* go thoma lefsa goba *help* go bona menyu.',
      tn: 'Tshwarelo, ke bala melaetsa ya mongwalo le di-voice note fela. Tsweetswee kwala molaetsa kgotsa romela voice note 🎤\n\nKwala *0* go simolola sešwa kgotsa *help* go bona menyu.',
      st: 'Tshwarelo, ke bala melaetsa ya mongolo le di-voice note feela. Ka kopo ngola molaetsa kapa romela voice note 🎤\n\nNgola *0* ho qala bocha kapa *help* ho bona menyu.',
      ts: 'Khomela, ndzi hlaya marungula ya matsalwa na ti-voice note ntsena. Hi kombela u tsala marungula kumbe u rhumela voice note 🎤\n\nTsala *0* ku sungula hi vuntshwa kumbe *help* ku vona menyu.',
      ss: 'Siyacolisa, ngifundza imilayezo yembhalo ne-voice note kuphela. Sicela ubhale umlayezo noma utfumele voice note 🎤\n\nBhala *0* kucala kabusha noma *help* kubona imenyu.',
      ve: 'Humbela u ntswalele, ndi vhala mulaedza wa maṅwalo na dzi-voice note fhedzi. Ri humbela ni ṅwale mulaedza kana ni rumele voice note 🎤\n\nṄwalani *0* u thoma hafhu kana *help* u vhona menyu.',
      nr: 'Siyacolisa, ngifunda imilayezo yombhalo ne-voice note kwaphela. Sibawa utlole umlayezo noma uthumele voice note 🎤\n\nTlola *0* ukuthoma kabutjha noma *help* ukubona imenyu.',
    };
    await sendWhatsAppMessage(from, unsupportedMsg[lang] || unsupportedMsg['en']);
    return;
  }
  const text = msgObj.text.body.trim().toLowerCase();

  // ==================== FOLLOW-UP RESPONSE HANDLING ====================
  const { data: pendingFollowUps } = await supabase
    .from('follow_ups')
    .select('*')
    .eq('patient_id', patientId)
    .eq('status', 'sent')
    .order('scheduled_at', { ascending: true })
    .limit(1);

  if (pendingFollowUps && pendingFollowUps.length > 0) {
    const followUp = pendingFollowUps[0];
    const lang = session.language || 'en';

    // ── 24h CHECK-IN RESPONSE ──────────────────────────────────────
    if (followUp.type === 'check_in') {
      if (text === '1') {
        // Patient visited the clinic — cancel the 72h symptom check, we're done
        await supabase.from('follow_ups').update({ status: 'completed', response: 'visited' }).eq('id', followUp.id);
        await supabase.from('follow_ups').update({ status: 'cancelled' })
          .eq('patient_id', patientId).eq('type', 'symptom_check').eq('status', 'pending');
        const thanksMsg = {
          en: '✅ Great — we are glad you got care. Stay well! 💙',
          zu: '✅ Kuhle — siyajabula ukuthi uthole usizo. Hlala kahle! 💙',
          xh: '✅ Kulungile — siyavuya ukuba uye wafumana ukunyangwa. Hlala kakuhle! 💙',
          af: '✅ Uitstekend — ons is bly jy het sorg gekry. Bly gesond! 💙',
          nso: '✅ Go lokile — re thabile ge o hwetšitše thušo. Phela gabotse! 💙',
          tn: '✅ Go siame — re itumetse fa o fumane thuso. Nna sentle! 💙',
          st: '✅ Ho lokile — re thabile ha o fumane thuso. Phela hantle! 💙',
          ts: '✅ Ku lunghile — hi tsakile leswaku u kume vukorhokeri. Tshama kahle! 💙',
          ss: '✅ Kulungile — siyajabula nawutfola lusito. Hlala kahle! 💙',
          ve: '✅ Zwi a luga — ri fara vhufaro nga nḓila ya u wana tshumelo. Nná zwavhuḓi! 💙',
          nr: '✅ Kulungile — siyajabula nawuthola ukunakwa. Hlala kahle! 💙',
        };
        await sendWhatsAppMessage(from, thanksMsg[lang] || thanksMsg['en']);
      } else if (text === '2') {
        // Not visited yet — acknowledge and let the 72h symptom check run as planned
        await supabase.from('follow_ups').update({ status: 'completed', response: 'not_visited_yet' }).eq('id', followUp.id);
        const nudgeMsg = {
          en: '⏳ No problem. Please try to visit the clinic soon — your health matters.\n\nWe will check in with you again in 2 days.',
          zu: '⏳ Kulungile. Sicela uzame ukuya emtholampilo maduze — impilo yakho ibalulekile.\n\nSizokubuza futhi emva kwezinsuku ezi-2.',
          xh: '⏳ Kulungile. Nceda uzame ukuya ekliniki masinya — impilo yakho ibalulekile.\n\nSiza kukubuza kwakhona emva kweentsuku ezi-2.',
          af: '⏳ Geen probleem. Probeer asseblief gou die kliniek besoek — jou gesondheid is belangrik.\n\nOns sal oor 2 dae weer by jou inskakel.',
          nso: '⏳ Go lokile. Leka go ya kiliniki ka pela — boitšhelo bja gago bo bohlokwa.\n\nRe tla go botšiša gape morago ga matšatši a 2.',
          tn: '⏳ Go siame. Leka go ya kliniki ka bonako — boitekanelo jwa gago bo botlhokwa.\n\nRe tla go botsa gape morago ga malatsi a 2.',
          st: '⏳ Ho lokile. Leka ho ya kliniki kapele — bophelo ba hao bo bohlokwa.\n\nRe tla o botsa hape kamora matsatsi a 2.',
          ts: '⏳ Ku lunghile. Lava ku ya ekliniki hi ku hatlisa — vumo bya wena byi bohlokwa.\n\nHi ta ku vutisa hantlhano endzhaku ka masiku ya 2.',
          ss: '⏳ Kulungile. Tenta kuyekliniki masinyane — impilo yakho ibalulekile.\n\nSitakubuza futsi emvakwemalanga la-2.',
          ve: '⏳ Zwi a luga. Lingedza u ya kha kiliniki nga u ṱavhanya — mutakalo waṋu u na ndeme.\n\nRi ḓo ni vhudzisa hafhu nga murahu ha maḓuvha a 2.',
          nr: '⏳ Kulungile. Zama ukuya ekliniki masinyane — impilo yakho ibalulekile.\n\nSizakubuza futhi emvakwamalanga la-2.',
        };
        await sendWhatsAppMessage(from, nudgeMsg[lang] || nudgeMsg['en']);
      }
      await sessionLib.saveSession(patientId, session);
      return;
    }

    // ── 72h SYMPTOM CHECK RESPONSE (or legacy 48h) ─────────────────
    if (['1', '2', '3'].includes(text)) {
      if (text === '1') {
        await sendWhatsAppMessage(from, msg('follow_up_better', lang));
      } else if (text === '2') {
        await sendWhatsAppMessage(from, msg('follow_up_same', lang));
      } else if (text === '3') {
        // ESCALATION: symptoms worsening — upgrade recommendation
        const prevLevel = followUp.triage_level || session.lastTriage?.triage_level;
        let escalateMsg;

        if (prevLevel === 'GREEN') {
          // GREEN → YELLOW: now needs a clinic visit
          escalateMsg = {
            en: '⚠️ Your symptoms are worsening. You need to *visit a clinic today*. Do not delay.\n\nIf you cannot get there safely, call *10177*.\n\nWe have upgraded your triage to *URGENT*.',
            zu: '⚠️ Izimpawu zakho ziyabhibha. Udinga *ukuvakashela umtholampilo namuhla*. Ungalibali.\n\nUma ungakwazi ukuya ngokuphepha, shaya *10177*.\n\nSikhuphulile isimo sakho sokuhlolwa saba ngu-*KUPHUTHUMA*.',
            xh: '⚠️ Iimpawu zakho ziyabhibha. Kufuneka *utyelele ikliniki namhlanje*. Musa ukulibazisa.\n\nUkuba awukwazi ukuya ngokukhuselekileyo, tsalela *10177*.\n\nSiyinyusile inqanaba lakho lokuhlolwa laba yi-*KUNGXAMISEKILE*.',
            af: '⚠️ Jou simptome vererger. Jy moet *vandag \'n kliniek besoek*. Moenie uitstel nie.\n\nAs jy nie veilig daar kan kom nie, bel *10177*.\n\nOns het jou triage na *DRINGEND* opgegradeer.',
          };
          await sessionLib.logTriage({ patient_id: patientId, whatsapp_message_id: msgObj?.id || null, triage_level: 'YELLOW', confidence: 100, escalation: true, pathway: 'follow_up_escalation_green_to_yellow', symptoms: 'Follow-up: patient reports worsening (was GREEN → now YELLOW)' });

        } else if (prevLevel === 'YELLOW') {
          // YELLOW → ORANGE: needs urgent care NOW
          if (isClinicOpen()) {
            escalateMsg = {
              en: '🟠 *URGENT — your symptoms are getting worse.* Go to the clinic *immediately* and tell them you were triaged as VERY URGENT by BIZUSIZO.\n\nIf you cannot travel safely, call *10177*.',
              zu: '🟠 *KUPHUTHUMA — izimpawu zakho ziyabhibha.* Yana emtholampilo *MANJE* ubatshele ukuthi uhloliwe njengo-KUPHUTHUMA KAKHULU yi-BIZUSIZO.\n\nUma ungakwazi ukuhamba ngokuphepha, shaya *10177*.',
              xh: '🟠 *KUNGXAMISEKILE — iimpawu zakho ziyabhibha.* Yiya ekliniki *NGOKU* ubaxelele ukuba uhlolwe njenge-KUNGXAMISEKE KAKHULU yi-BIZUSIZO.\n\nUkuba awukwazi ukuhamba ngokukhuselekileyo, tsalela *10177*.',
              af: '🟠 *DRINGEND — jou simptome vererger.* Gaan *dadelik* na die kliniek en sê jy is as BAIE DRINGEND deur BIZUSIZO getrieer.\n\nAs jy nie veilig kan reis nie, bel *10177*.',
            };
          } else {
            escalateMsg = {
              en: '🟠 *URGENT — your symptoms are getting worse.* The clinic is closed. Go to your nearest *hospital emergency unit* immediately.\n\nOr call *10177* for an ambulance.',
              zu: '🟠 *KUPHUTHUMA — izimpawu zakho ziyabhibha.* Umtholampilo uvaliwe. Yana *esibhedlela esiseduze* ewodini yeziphuthumayo MANJE.\n\nNoma shaya *10177*.',
              xh: '🟠 *KUNGXAMISEKILE — iimpawu zakho ziyabhibha.* Ikliniki ivaliwe. Yiya *esibhedlele esikufutshane* kwicandelo lezongxamiseko NGOKU.\n\nOkanye tsalela *10177*.',
              af: '🟠 *DRINGEND — jou simptome vererger.* Die kliniek is gesluit. Gaan *dadelik na die naaste hospitaal noodafdeling*.\n\nOf bel *10177*.',
            };
          }
          await sessionLib.logTriage({ patient_id: patientId, whatsapp_message_id: msgObj?.id || null, triage_level: 'ORANGE', confidence: 100, escalation: true, pathway: 'follow_up_escalation_yellow_to_orange', symptoms: 'Follow-up: patient reports worsening (was YELLOW → now ORANGE)' });

        } else {
          // ORANGE or other — straight to emergency
          escalateMsg = {
            en: '🔴 *Your symptoms are worsening. Call an ambulance NOW: 10177 or 084 124 (ER24).* Do not wait.\n\nIf you can get to a hospital emergency unit, go immediately.',
            zu: '🔴 *Izimpawu zakho ziyabhibha. Shaya i-ambulensi MANJE: 10177 noma 084 124 (ER24).* Ungalindi.\n\nUma ungaya esibhedlela ewodini yeziphuthumayo, hamba MANJE.',
            xh: '🔴 *Iimpawu zakho ziyabhibha. Tsalela i-ambulensi NGOKU: 10177 okanye 084 124 (ER24).* Musa ukulinda.\n\nUkuba ungaya esibhedlele kwicandelo lezongxamiseko, yiya NGOKU.',
            af: '🔴 *Jou simptome vererger. Bel \'n ambulans NOU: 10177 of 084 124 (ER24).* Moenie wag nie.\n\nAs jy by \'n hospitaal noodafdeling kan uitkom, gaan dadelik.',
          };
          await sessionLib.logTriage({ patient_id: patientId, whatsapp_message_id: msgObj?.id || null, triage_level: 'RED', confidence: 100, escalation: true, pathway: 'follow_up_escalation_to_red', symptoms: 'Follow-up: patient reports worsening (was ' + prevLevel + ' → escalated to RED)' });
        }

        await sendWhatsAppMessage(from, escalateMsg[lang] || escalateMsg['en']);
        await sendWhatsAppMessage(from, msg('follow_up_worse', lang));
      }

      // Store symptom outcome
      const symptomOutcome = text === '1' ? 'better' : text === '2' ? 'same' : 'worse';
      await supabase.from('follow_ups')
        .update({ status: 'awaiting_visit_response', response: symptomOutcome })
        .eq('id', followUp.id);

      // Ask clinic visit question for YELLOW and GREEN patients (not RED/ORANGE — they were sent to hospital)
      const triageLevel = followUp.triage_level || 'YELLOW';
      if (['YELLOW', 'GREEN'].includes(triageLevel) && symptomOutcome !== 'worse') {
        await sendWhatsAppMessage(from, msg('follow_up_clinic_visit', lang));
        session.awaitingClinicVisitResponse = true;
        session.followUpId = followUp.id;
        session.followUpSymptomOutcome = symptomOutcome;
        session.followUpTriageLevel = triageLevel;
        await sessionLib.saveSession(patientId, session);
      } else {
        // RED/ORANGE or worsening — already got clinical guidance, just thank and close
        await supabase.from('follow_ups')
          .update({ status: 'completed' })
          .eq('id', followUp.id);
        await supabase.from('follow_up_outcomes').insert({
          patient_id: patientId,
          triage_level: triageLevel,
          symptom_outcome: symptomOutcome,
          visited_clinic: null,         // not asked for RED/ORANGE
          response_received_at: new Date().toISOString(),
          facility_name: session.suggestedFacility?.name || session.confirmedFacility?.name || null,
        }).catch(e => logger.error('[OUTCOME] Insert error:', e.message));
        await sendWhatsAppMessage(from, msg('follow_up_clinic_thanks', lang));
      }

      return;
    }

    // ── Clinic visit response (step 2 of follow-up) ──────────────
    if (session.awaitingClinicVisitResponse && ['1','2','3','4','5'].includes(text)) {
      const visitMap = { '1': 'clinic', '2': 'no', '3': 'hospital', '4': 'turned_away', '5': 'stockout' };
      const rawOutcome = visitMap[text] || 'unknown';
      const isAccessFailure = rawOutcome === 'turned_away' || rawOutcome === 'stockout';
      const visitedClinic = isAccessFailure ? 'clinic' : rawOutcome; // they did go; just couldn't access care
      const accessFailure = isAccessFailure ? rawOutcome : null;
      const lang = session.language || 'en';

      // Store structured outcome
      await supabase.from('follow_up_outcomes').insert({
        patient_id:          patientId,
        triage_level:        session.followUpTriageLevel || followUp?.triage_level || 'YELLOW',
        symptom_outcome:     session.followUpSymptomOutcome || 'unknown',
        visited_clinic:      visitedClinic,
        access_failure:      accessFailure,
        response_received_at: new Date().toISOString(),
        facility_name:       session.suggestedFacility?.name || session.confirmedFacility?.name || null,
      }).catch(e => logger.error('[OUTCOME] Insert error:', e.message));

      // Mark follow-up complete
      if (session.followUpId) {
        await supabase.from('follow_ups')
          .update({ status: 'completed', visit_response: visitedClinic })
          .eq('id', session.followUpId);
      }

      // Safety check: YELLOW patient who didn't go and is still the same/worse
      if (session.followUpTriageLevel === 'YELLOW' && visitedClinic === 'no' && session.followUpSymptomOutcome !== 'better') {
        const nudgeMsg = {
          en: `You were triaged as URGENT 2 days ago and have not visited the clinic. Please visit *today* — your condition may worsen if untreated.

If it is an emergency call *10177*.`,
          zu: `Wahloliwe njengo-KUPHUTHUMA izinsuku ezi-2 ezidlule futhi awuvakashele umtholampilo. Sicela uvakatjhele *namuhla* — isimo sakho singabhibha uma singelatshwe.

Uma kuphuthumile shaya *10177*.`,
          xh: `Uhloliwe njengoPHUTHUMELA kwiintsuku ezi-2 ezidlulileyo kwaye awutyeleli ikliniki. Nceda utyelele *namhlanje* — imeko yakho ingabhibha xa ingenatshitso.

Ukuba yingxakeko tsalela *10177*.`,
          af: `Jy is 2 dae gelede as DRINGEND getrieer en het nie die kliniek besoek nie. Besoek asseblief *vandag* — jou toestand kan vererger sonder behandeling.

As dit 'n noodgeval is bel *10177*.`,
          nso: `O hloilwe bjalo ka TŠHOGANETŠO mafelelong a matšatši a 2 gomme ga o kile oya kiliniki. Hle etela *lehono* — maemo a gago a ka mpefala ge a sa alafšwe.

Ge e le tšhoganetšo leletša *10177*.`,
          tn: `O ne o tshwanetse go ya kliniki malatsi a 2 a a fetileng mme ga o ya. Tsweetswee etela *gompieno* — maemo a gago a ka nna maswe fa a sa alafiwi.

Fa e le tshoganyetso letsa *10177*.`,
        };
        await sendWhatsAppMessage(from, nudgeMsg[lang] || nudgeMsg['en']);
      } else if (isAccessFailure) {
        // Patient was turned away or faced a stockout — acknowledge and advise
        const accessFailMsg = {
          en: rawOutcome === 'stockout'
            ? `💊 We are sorry — being turned away due to no medicine is unacceptable. *Your health still matters.*\n\nPlease try:\n• Ask the nurse to check with the CCMDD community pick-up point\n• Visit another nearby clinic\n• Call *0800 029 999* (National Health Hotline)\n\nWe have recorded this so the system can improve.`
            : `⛔ We are sorry you were turned away. That should not happen.\n\nPlease try:\n• Ask to speak to the facility manager\n• Visit another nearby clinic or hospital\n• Call *0800 029 999* (National Health Hotline)\n\nWe have recorded this so the system can improve.`,
          zu: rawOutcome === 'stockout'
            ? `💊 Siyaxolisa — ukubuyiselwa ngenxa yokungabi nemithi akwamukeleki. *Impilo yakho iseyabaluleka.*\n\nZama:\n• Cela unesi ahlole i-CCMDD\n• Yana emtholampilo omkhulu oseduze\n• Shaya *0800 029 999*\n\nSirekhodile ukuze uhlelo luthuthuke.`
            : `⛔ Siyaxolisa ukuthi ubuyiselwe emuva. Lokhu akufanele kwenzeke.\n\nZama:\n• Cela ukukhuluma nomphathi wesibhedlela\n• Yana emtholampilo omkhulu oseduze\n• Shaya *0800 029 999*\n\nSirekhodile ukuze uhlelo luthuthuke.`,
          xh: rawOutcome === 'stockout'
            ? `💊 Sixolisa — ukubuya ngenxa yokungabikho kwamayeza akwamukelekanga. *Impilo yakho isekubalulekile.*\n\nZama:\n• Cela umongikazi ahlole i-CCMDD\n• Yiya kwenye ikliniki ekufutshane\n• Tsalela *0800 029 999*\n\nSibhalisile oku ukuze inkqubo iphucuke.`
            : `⛔ Sixolisa ukuba ubuyiselwe. Oku akufanele kwenzeke.\n\nZama:\n• Cela ukuthetha nomphathi wesibhedlela\n• Yiya kwenye ikliniki ekufutshane\n• Tsalela *0800 029 999*\n\nSibhalisile oku ukuze inkqubo iphucuke.`,
          af: rawOutcome === 'stockout'
            ? `💊 Ons is jammer — teruggestuur word sonder medisyne is onaanvaarbaar. *Jou gesondheid is steeds belangrik.*\n\nProbeer:\n• Vra die verpleegkundige oor CCMDD-afhaalpunte\n• Besoek 'n ander naburige kliniek\n• Bel *0800 029 999*\n\nOns het dit aangeteken sodat die stelsel kan verbeter.`
            : `⛔ Ons is jammer dat jy weggestuur is. Dit moet nie gebeur nie.\n\nProbeer:\n• Vra om met die fasiliteitsbestuurder te praat\n• Besoek 'n ander kliniek of hospitaal\n• Bel *0800 029 999*\n\nOns het dit aangeteken sodat die stelsel kan verbeter.`,
        };
        await sendWhatsAppMessage(from, accessFailMsg[lang] || accessFailMsg['en']);
      } else {
        await sendWhatsAppMessage(from, msg('follow_up_clinic_thanks', lang));
      }

      // Clear session flags
      session.awaitingClinicVisitResponse = false;
      session.followUpId = null;
      session.followUpSymptomOutcome = null;
      session.followUpTriageLevel = null;
      await sessionLib.saveSession(patientId, session);
      return;
    }

    // ── GBV PEP adherence response (3d and 7d) ───────────────────
    if (session.awaitingGBVPepResponse && ['1','2','3','4'].includes(text)) {
      session.awaitingGBVPepResponse = false;
      const lang = session.language || 'en';

      if (session.gbvFollowUpId) {
        await supabase.from('follow_ups')
          .update({ status: 'completed', response: text })
          .eq('id', session.gbvFollowUpId);
      }

      if (text === '1') {
        // Taking PEP — encourage
        const msg = {
          en: '💙 Thank you for letting us know. Keep taking your medication every day for the full 28 days. You are doing the right thing.\n\nIf side effects become difficult, visit your clinic — they can help manage them without stopping PEP.',
          zu: '💙 Siyabonga ngokusazisa. Qhubeka uthatha umuthi wakho nsuku zonke izinsuku ezi-28 ezigcwele. Wenza into efanele.\n\nUma imiphumela emibi iba nzima, vakashela umtholampilo — bangakusiza ngaphandle kokuyeka i-PEP.',
          xh: '💙 Enkosi ngokusazisa. Qhubeka uthatha amayeza akho yonke imihla iintsuku ezi-28 ezipheleleyo. Wenza into efanelekileyo.\n\nUkuba iziphumo ezimbi ziba nzima, tyelela ikliniki yakho — bangakunceda ngaphandle kokuyeka iPEP.',
          af: '💙 Dankie dat jy ons laat weet het. Hou aan om jou medikasie elke dag te neem vir die volle 28 dae. Jy doen die regte ding.\n\nAs newe-effekte moeilik word, besoek jou kliniek — hulle kan help om dit te bestuur sonder om PEP te stop.',
          nso: '💙 Re a leboga ge o re tsebišitše. Tšwela pele o nwa dihlare tša gago letšatši le lengwe le le lengwe matšatši a 28 ka moka. O dira selo se se nepagetsego.\n\nGe ditlamorago di thoma go go tshwenya, etela kliniki ya gago — ba ka go thuša ntle le go tlogela PEP.',
          tn: '💙 Re a leboga go re itsise. Tswelela o nwa melemo ya gago letsatsi le letsatsi malatsi a le 28 ka botlalo. O dira selo se se siameng.\n\nFa ditlamorago di nna thata, etela kliniki ya gago — ba ka go thusa kwantle ga go tlogela PEP.',
          st: '💙 Re leboha ha o re tsebisa. Tswela pele o nwa meriana ya hao letsatsi le leng le le leng matsatsi a 28 ka botlalo. O etsa ntho e nepahetseng.\n\nHaeba ditlamorao di eba thata, etela kliniki ya hao — ba ka o thusa ntle le ho tloha ho nwa PEP.',
          ts: '💙 Hi khensa ku hi tivisa. Yisa emahlweni ku nwa murhi wa wena siku rin\'wana ni rin\'wana masiku ya 28 hinkwawo. U endla xilo lexi faneleke.\n\nLoko switandzhaku swi va swa nonon\'hwa, endzela kliniki ya wena — va nga ku pfuna handle ko tshika PEP.',
          ss: '💙 Siyabonga ngekusatisa. Chubeka unwa umutsi wakho onkhe emalanga emalanga la-28 aphelele. Wenta intfo lefanele.\n\nNangabe imiphumela lemibi iba matima, vakashela ikliniki yakho — bangakusita ngaphandle kwekuyeka i-PEP.',
          ve: '💙 Ri a livhuwa nge u ri ḓivhisa. Bvelani phanḓa u nwa mushonga waṋu ḓuvha ḽiṅwe na ḽiṅwe maḓuvha a 28 oṱhe. Ni khou ita tshithu tsho teaho.\n\nArali mbilaelo dzi tshi ṱoḓa u ni tshenisa, dalani kha kiliniki yaṋu — vha nga ni thusa hu si na u litsha PEP.',
          nr: '💙 Siyathokoza ngokusazisa. Ragela phambili unwa umuthi wakho ilanga nelanga amalanga ama-28 aphelele. Wenza into efaneleko.\n\nNangabe imiphumela emimbi iba budisi, vakatjhela ikliniki yakho — bangakusiza ngaphandle kokuyeka i-PEP.',
        };
        await sendWhatsAppMessage(from, msg[lang] || msg['en']);
      } else if (text === '2') {
        // Stopped or missed — urgent
        const msg = {
          en: '⚠️ *Please do not stop PEP.* The full 28 days protects you from HIV.\n\nIf side effects are difficult, visit your clinic *today* — they can give you medication to manage nausea and headaches without stopping PEP.\n\n📞 GBV helpline: *0800 428 428*',
          zu: '⚠️ *Sicela ungayeki i-PEP.* Izinsuku ezi-28 ezigcwele zikuvikela ku-HIV.\n\nUma imiphumela emibi inzima, vakashela umtholampilo *namuhla* — bangakunika umuthi wokulawula isiyezi nekhanda ngaphandle kokuyeka i-PEP.\n\n📞 Usizo lwe-GBV: *0800 428 428*',
          xh: '⚠️ *Nceda musa ukuyeka iPEP.* Iintsuku ezi-28 ezipheleleyo ziyakukhusela kwiHIV.\n\nUkuba iziphumo ezimbi zinzima, tyelela ikliniki yakho *namhlanje* — bangakunika amayeza okulawula ukugabha neentlungu zentloko ngaphandle kokuyeka iPEP.\n\n📞 Uncedo lweGBV: *0800 428 428*',
          af: '⚠️ *Moenie ophou om PEP te neem nie.* Die volle 28 dae beskerm jou teen MIV.\n\nAs newe-effekte moeilik is, besoek jou kliniek *vandag* — hulle kan jou medikasie gee om naarheid en hoofpyn te bestuur sonder om PEP te stop.\n\n📞 GBV hulplyn: *0800 428 428*',
          nso: '⚠️ *Hle o se ke wa tlogela PEP.* Matšatši a 28 ka botlalo a go šireletša go HIV.\n\nGe ditlamorago di le thata, etela kliniki ya gago *lehono* — ba ka go fa dihlare tša go laola go hlatša le hlogo e bohloko ntle le go tlogela PEP.\n\n📞 Mogala wa GBV: *0800 428 428*',
          tn: '⚠️ *Tswee-tswee o se ka wa tlogela PEP.* Malatsi a le 28 ka botlalo a go sireletsa mo go HIV.\n\nFa ditlamorago di le thata, etela kliniki ya gago *gompieno* — ba ka go naya melemo go laola go tlhapogela le tlhogo e botlhoko kwantle ga go tlogela PEP.\n\n📞 Mogala wa GBV: *0800 428 428*',
          st: '⚠️ *Ka kopo o se ke wa tloha ho nwa PEP.* Matsatsi a 28 ka botlalo a o sireletsa ho HIV.\n\nHaeba ditlamorao di thata, etela kliniki ya hao *kajeno* — ba ka o fa meriana ya ho laola ho phallatsa le hlooho e bohloko ntle le ho tloha ho nwa PEP.\n\n📞 Mohala wa GBV: *0800 428 428*',
          ts: '⚠️ *U nga tshiki ku nwa PEP.* Masiku ya 28 hinkwawo ya ku sirhelela eka HIV.\n\nLoko switandzhaku swi tika, endzela kliniki ya wena *namuntlha* — va nga ku nyika murhi wo lawula ku hlanyanisiwa ni nhloko yo vava handle ko tshika PEP.\n\n📞 Xitlhavelo xa GBV: *0800 428 428*',
          ss: '⚠️ *Sicela ungayeki i-PEP.* Emalanga la-28 aphelele akuvikela ku-HIV.\n\nNangabe imiphumela lemibi imatima, vakashela ikliniki yakho *lamuhla* — bangakunika umutsi wekulawula kucanuka nelikhanda lelibuhlungu ngaphandle kwekuyeka i-PEP.\n\n📞 Lusito lwe-GBV: *0800 428 428*',
          ve: '⚠️ *Ni songo litsha u nwa PEP.* Maḓuvha a 28 oṱhe a ni tsireledza kha HIV.\n\nArali mbilaelo dzi tshi ṱoḓa u ni tshenisa, dalani kha kiliniki yaṋu *ṋamusi* — vha nga ni ṋea mushonga wa u langula u ṱanzwa na u vhavha ha ṱhoho hu si na u litsha PEP.\n\n📞 Luṱingo lwa GBV: *0800 428 428*',
          nr: '⚠️ *Ungayeki ukunwa i-PEP.* Amalanga ama-28 aphelele akuvikela ku-HIV.\n\nNangabe imiphumela emimbi ibudisi, vakatjhela ikliniki yakho *namhlanje* — bangakunika umuthi wokulawula ukucanuka nekhanda elibuhlungu ngaphandle kokuyeka i-PEP.\n\n📞 Umugqa we-GBV: *0800 428 428*',
        };
        await sendWhatsAppMessage(from, msg[lang] || msg['en']);
        // Governance alert — PEP defaulter
        await supabase.from('governance_alerts').insert({
          alert_type: 'gbv_pep_defaulter', severity: 'HIGH', pillar: 'patient_safety',
          message: `GBV survivor stopped/missed PEP doses at ${session.gbvFollowUpType || '?'} check.`,
          data: { patient_id: patientId }, resolved: false,
        }).catch(e => {});
      } else if (text === '3') {
        // Did not receive medication
        const msg = {
          en: '📋 If you were not given PEP at the hospital or TCC, please go back *as soon as possible* — PEP must start within 72 hours of the incident to be effective.\n\nIf more than 72 hours have passed, still visit your clinic for STI treatment and counselling.\n\n📞 GBV helpline: *0800 428 428*',
          zu: '📋 Uma unganikwanga i-PEP esibhedlela noma e-TCC, sicela ubuyele *ngokushesha okukhulu* — i-PEP kumele iqale ngaphakathi kwamahora angu-72.\n\nUma sekudlule amahora angu-72, bona umtholampilo wakho ukuthola ukwelashwa kwe-STI nokwelulekwa.\n\n📞 Usizo lwe-GBV: *0800 428 428*',
          xh: '📋 Ukuba awunikwanga iPEP esibhedlele okanye eTCC, nceda ubuyele *ngokukhawuleza* — iPEP kufuneka iqale ngaphakathi kweeyure ezingama-72.\n\nUkuba kudlule iiyure ezingama-72, tyelela ikliniki yakho ukufumana unyango lweSTI nengcebiso.\n\n📞 Uncedo lweGBV: *0800 428 428*',
          af: '📋 As jy nie PEP by die hospitaal of TCC ontvang het nie, gaan asseblief terug *so gou moontlik* — PEP moet binne 72 uur begin om effektief te wees.\n\nAs meer as 72 uur verby is, besoek steeds jou kliniek vir SOI-behandeling en berading.\n\n📞 GBV hulplyn: *0800 428 428*',
          nso: '📋 Ge o sa ka wa fiwa PEP sepetlele goba TCC, hle boela morago *ka pela* — PEP e swanetše go thoma ka gare ga diiri tše 72.\n\nGe diiri tše 72 di fetile, sa le etela kliniki ya gago bakeng sa kalafo ya STI le thušo ya dikeletšo.\n\n📞 Mogala wa GBV: *0800 428 428*',
          tn: '📋 Fa o sa ka wa neelwa PEP kwa bookelong kgotsa TCC, tswee-tswee boela morago *ka bonako* — PEP e tshwanetse go simolola mo diureng di le 72.\n\nFa diura di le 72 di fetile, sa ntse o etele kliniki ya gago go bona kalafi ya STI le kgakololo.\n\n📞 Mogala wa GBV: *0800 428 428*',
          st: '📋 Haeba ha o a fuwa PEP sepetlele kapa TCC, ka kopo kgutla *kapele* — PEP e tlameha ho qala ka hare ho dihora tse 72.\n\nHaeba dihora tse 72 di fetile, ntse o etele kliniki ya hao bakeng sa kalafo ya STI le dikeletso.\n\n📞 Mohala wa GBV: *0800 428 428*',
          ts: '📋 Loko u nga nyikiwanga PEP exibedlhele kumbe TCC, hi kombela u tlhelela *hi ku hatlisa* — PEP yi fanele ku sungula endzeni ka tiawara ta 72.\n\nLoko tiawara ta 72 ti hundzile, ha u ya u endzela kliniki ya wena ku kuma vutshunguri bya STI ni vukhongeri.\n\n📞 Xitlhavelo xa GBV: *0800 428 428*',
          ss: '📋 Nangabe awuzange unikwe i-PEP esibhedlela noma e-TCC, sicela ubuyele *masinyane* — i-PEP kumele icale ngekhatsi kwema-awa la-72.\n\nNangabe ema-awa la-72 asendlulile, sale uvakatjhela ikliniki yakho kutfola kwelashwa kwe-STI nekwelulekwa.\n\n📞 Lusito lwe-GBV: *0800 428 428*',
          ve: '📋 Arali a no ngo ṋewa PEP sibadela kana TCC, ri humbela ni vhuye *nga u ṱavhanya* — PEP i fanela u thoma nga ngomu ha awara dza 72.\n\nArali awara dza 72 dzo no fhira, ni sa dalele kha kiliniki yaṋu u wana vhulafhuli ha STI na thikhedzo.\n\n📞 Luṱingo lwa GBV: *0800 428 428*',
          nr: '📋 Nangabe awukanikwa i-PEP esibhedlela noma e-TCC, sibawa ubuyele *msinyana* — i-PEP kufanele ithome ngaphakathi kwama-iri ama-72.\n\nNangabe ama-iri ama-72 asadlulile, ragela phambili uvakatjhele ikliniki yakho ukufumana ukwelashwa kwe-STI neluleko.\n\n📞 Umugqa we-GBV: *0800 428 428*',
        };
        await sendWhatsAppMessage(from, msg[lang] || msg['en']);
      } else {
        // Does not want to talk — respect, provide helpline
        const msg = {
          en: '💙 That is okay. We respect your choice.\n\nIf you ever need help, these services are free and confidential:\n📞 *0800 428 428* (GBV, 24/7)\n📞 *0800 567 567* (SADAG, 24/7)\n\nType *0* anytime.',
          zu: '💙 Kulungile. Sihlonipha ukukhetha kwakho.\n\nUma udinga usizo, lezi zinsiza zimahhala futhi ziyimfihlo:\n📞 *0800 428 428* (GBV, 24/7)\n📞 *0800 567 567* (SADAG, 24/7)\n\nBhala *0* noma nini.',
          xh: '💙 Kulungile. Siyayihlonipha inthetho yakho.\n\nUkuba ufuna uncedo, ezi nkonzo zikhululekile kwaye ziyimfihlo:\n📞 *0800 428 428* (GBV, 24/7)\n📞 *0800 567 567* (SADAG, 24/7)\n\nBhala *0* nanini na.',
          af: '💙 Dit is reg. Ons respekteer jou keuse.\n\nAs jy ooit hulp nodig het, hierdie dienste is gratis en vertroulik:\n📞 *0800 428 428* (GBV, 24/7)\n📞 *0800 567 567* (SADAG, 24/7)\n\nTik *0* enige tyd.',
          nso: '💙 Go lokile. Re hlompha kgetho ya gago.\n\nGe o ka hloka thušo, ditirelo tše ke tša mahala ebile di sephiri:\n📞 *0800 428 428* (GBV, 24/7)\n📞 *0800 567 567* (SADAG, 24/7)\n\nThaepa *0* nako efe goba efe.',
          tn: '💙 Go siame. Re tlotla kgetho ya gago.\n\nFa o ka tlhoka thuso, ditirelo tse di mahala ebile di sephiri:\n📞 *0800 428 428* (GBV, 24/7)\n📞 *0800 567 567* (SADAG, 24/7)\n\nTshwaisa *0* nako nngwe le nngwe.',
          st: '💙 Ho lokile. Re hlompha khetho ya hao.\n\nHaeba o hloka thuso, ditshebeletso tsena ke tsa mahala ebile ke lekunutu:\n📞 *0800 428 428* (GBV, 24/7)\n📞 *0800 567 567* (SADAG, 24/7)\n\nThaepa *0* nako efe kapa efe.',
          ts: '💙 Swi lulamile. Hi hlonipha nhlawulo ya wena.\n\nLoko u ka lava mpfuno, vukorhokeri lebyi i bya mahala naswona byi xihundla:\n📞 *0800 428 428* (GBV, 24/7)\n📞 *0800 567 567* (SADAG, 24/7)\n\nThayipa *0* nkarhi wun\'wana ni wun\'wana.',
          ss: '💙 Kulungile. Sihlonipha kukhetsa kwakho.\n\nNangabe udzinga lusito, letinsita timahhala futsi tiyimfihlo:\n📞 *0800 428 428* (GBV, 24/7)\n📞 *0800 567 567* (SADAG, 24/7)\n\nBhala *0* nganoma ngusiphi sikhatsi.',
          ve: '💙 Zwo luga. Ri a ṱhonifha khetho yaṋu.\n\nArali ni tshi ṱoḓa thuso, tshumelo idzi ndi dza mahala nahone ndi tshiphiri:\n📞 *0800 428 428* (GBV, 24/7)\n📞 *0800 567 567* (SADAG, 24/7)\n\nThaipha *0* tshifhinga tshiṅwe na tshiṅwe.',
          nr: '💙 Kulungile. Sihlonipha ukukhetha kwakho.\n\nNangabe udinga isizo, iinkonzo lezi zimahhala begodu ziyifihlo:\n📞 *0800 428 428* (GBV, 24/7)\n📞 *0800 567 567* (SADAG, 24/7)\n\nBhala *0* nganoma kunini.',
        };
        await sendWhatsAppMessage(from, msg[lang] || msg['en']);
      }

      session.gbvFollowUpId = null;
      session.gbvFollowUpType = null;
      await sessionLib.saveSession(patientId, session);
      return;
    }

    // ── GBV welfare response (domestic violence 7d check) ────────
    if (session.awaitingGBVWelfareResponse && ['1','2','3'].includes(text)) {
      session.awaitingGBVWelfareResponse = false;
      const lang = session.language || 'en';

      if (session.gbvFollowUpId) {
        await supabase.from('follow_ups')
          .update({ status: 'completed', response: text })
          .eq('id', session.gbvFollowUpId);
      }

      if (text === '1') {
        const msg = {
          en: '💙 We are glad you are safe. Remember, help is always available:\n📞 *0800 428 428* (free, 24/7)\n\nType *0* anytime.',
          zu: '💙 Siyajabula ukuthi uphephile. Khumbula, usizo lukhona njalo:\n📞 *0800 428 428* (mahhala, 24/7)\n\nBhala *0* noma nini.',
          xh: '💙 Siyavuya ukuba ukhuselekile. Khumbula, uncedo lukhona ngalo lonke ixesha:\n📞 *0800 428 428* (simahla, 24/7)\n\nBhala *0* nanini na.',
          af: '💙 Ons is bly jy is veilig. Onthou, hulp is altyd beskikbaar:\n📞 *0800 428 428* (gratis, 24/7)\n\nTik *0* enige tyd.',
          nso: '💙 Re thabile gore o bolokegile. Gopola, thušo e gona ka mehla:\n📞 *0800 428 428* (mahala, 24/7)\n\nThaepa *0* nako efe goba efe.',
          tn: '💙 Re itumetse gore o babalesegile. Gopola, thuso e nna e le teng:\n📞 *0800 428 428* (mahala, 24/7)\n\nTshwaisa *0* nako nngwe le nngwe.',
          st: '💙 Re thabile hore o bolokehile. Hopola, thuso e fumaneha ka nako tsohle:\n📞 *0800 428 428* (mahala, 24/7)\n\nThaepa *0* nako efe kapa efe.',
          ts: '💙 Hi tsakile leswaku u hlayisekile. Tsundzuka, mpfuno yi kona nkarhi hinkwawo:\n📞 *0800 428 428* (mahala, 24/7)\n\nThayipa *0* nkarhi wun\'wana ni wun\'wana.',
          ss: '💙 Siyajabula kutsi uphephile. Khumbula, lusito lukhona njalo:\n📞 *0800 428 428* (mahhala, 24/7)\n\nBhala *0* nganoma ngusiphi sikhatsi.',
          ve: '💙 Ri a takala uri no tsireledzeha. Humbulani, thuso i hone nḓila yoṱhe:\n📞 *0800 428 428* (mahala, 24/7)\n\nThaipha *0* tshifhinga tshiṅwe na tshiṅwe.',
          nr: '💙 Siyathaba bona uphephile. Khumbula, isizo sikhona njalo:\n📞 *0800 428 428* (simahla, 24/7)\n\nBhala *0* nganoma kunini.',
        };
        await sendWhatsAppMessage(from, msg[lang] || msg['en']);
      } else if (text === '2') {
        // NOT SAFE — immediate alert
        const msg = {
          en: '🚨 *If you are in immediate danger, call SAPS: 10111*\n\n📞 GBV Command Centre: *0800 428 428* (free, 24/7)\n📞 Childline: *116* (if under 18)\n\nYou can also go to your nearest police station. You have the right to protection.\n\nWe are alerting support services.',
          zu: '🚨 *Uma usengozini, shaya i-SAPS: 10111*\n\n📞 GBV: *0800 428 428* (mahhala, 24/7)\n📞 Childline: *116* (uma ungaphansi kwe-18)\n\nUngaya futhi esiteshini samaphoyisa esiseduze. Unelungelo lokuvikelwa.\n\nSazisa izinsiza zokusiza.',
          xh: '🚨 *Ukuba usengozini, tsalela iSAPS: 10111*\n\n📞 GBV: *0800 428 428* (simahla, 24/7)\n📞 Childline: *116* (ukuba ungaphantsi kwe-18)\n\nUnokuya kwisikhululo samapolisa esikufutshane. Unelungelo lokukhusela.\n\nSazisa iinkonzo zoncedo.',
          af: '🚨 *As jy in onmiddellike gevaar is, bel SAPD: 10111*\n\n📞 GBV: *0800 428 428* (gratis, 24/7)\n📞 Childline: *116* (as onder 18)\n\nJy kan ook na jou naaste polisiekantoor gaan. Jy het die reg op beskerming.\n\nOns stel ondersteuningsdienste in kennis.',
          nso: '🚨 *Ge o le kotsing, letšetša SAPS: 10111*\n\n📞 GBV: *0800 428 428* (mahala, 24/7)\n📞 Childline: *116* (ge o ka fase ga 18)\n\nO ka ya gape seteišeneng sa maphodisa se se lego kgauswi. O na le tokelo ya go šireletšwa.\n\nRe tsebiša ditirelo tša thušo.',
          tn: '🚨 *Fa o mo kotsing, leletsa SAPS: 10111*\n\n📞 GBV: *0800 428 428* (mahala, 24/7)\n📞 Childline: *116* (fa o ka fa tlase ga 18)\n\nO ka ya gape kwa seteišeneng sa mapodisi se se gaufi. O na le tshwanelo ya go sirelediwa.\n\nRe itsise ditirelo tsa thuso.',
          st: '🚨 *Haeba o kotsing, letsetsa SAPS: 10111*\n\n📞 GBV: *0800 428 428* (mahala, 24/7)\n📞 Childline: *116* (haeba o ka tlase ho 18)\n\nO ka ya hape seteisheneng sa maphodisa se haufi. O na le tokelo ya ho sireletswa.\n\nRe tsebisa ditshebeletso tsa thuso.',
          ts: '🚨 *Loko u le khombyeni, rhingela SAPS: 10111*\n\n📞 GBV: *0800 428 428* (mahala, 24/7)\n📞 Childline: *116* (loko u le ehansi ka 18)\n\nU nga ya nakambe exitichini xa maphorisa lexi nga kusuhi. U na mfanelo yo sirheleriwa.\n\nHi tivisa vukorhokeri bya mpfuno.',
          ss: '🚨 *Nangabe usengotini, shayela SAPS: 10111*\n\n📞 GBV: *0800 428 428* (mahhala, 24/7)\n📞 Childline: *116* (nangabe ungaphansi kwa-18)\n\nUngaya futsi esiteshini semaphoyisa lesiseduze. Unelilungelo lekuvikelwa.\n\nSatisa tinsita tekusita.',
          ve: '🚨 *Arali ni khomboni, imbelelani SAPS: 10111*\n\n📞 GBV: *0800 428 428* (mahala, 24/7)\n📞 Childline: *116* (arali ni fhasi ha 18)\n\nNi nga dovha na ya tshiteshini tsha mapholisa tsho sendeleaho. Ni na pfanelo ya u tsireledza.\n\nRi khou ḓivhisa tshumelo dza thuso.',
          nr: '🚨 *Nangabe usengozini, fonela i-SAPS: 10111*\n\n📞 GBV: *0800 428 428* (simahla, 24/7)\n📞 Childline: *116* (nangabe ungaphasi kwe-18)\n\nUngaya godu esitejini samapholisa esiseduze. Unelungelo lokuvikelwa.\n\nSazisa iinkonzo zosizo.',
        };
        await sendWhatsAppMessage(from, msg[lang] || msg['en']);
        // CRITICAL governance alert
        await supabase.from('governance_alerts').insert({
          alert_type: 'gbv_patient_not_safe', severity: 'CRITICAL', pillar: 'patient_safety',
          message: `GBV survivor reports NOT SAFE at 7-day welfare check.`,
          data: { patient_id: patientId }, resolved: false,
        }).catch(e => {});
      } else {
        // Needs to talk
        const msg = {
          en: '💙 Help is available right now:\n\n📞 *0800 428 428* — GBV Command Centre (free, 24/7)\n📞 *0800 567 567* — SADAG mental health (free, 24/7)\n📞 *116* — Childline (under 18)\n\nYou can also visit your clinic and ask to speak to a counsellor.\n\nYou are not alone.',
          zu: '💙 Usizo lukhona manje:\n\n📞 *0800 428 428* — GBV (mahhala, 24/7)\n📞 *0800 567 567* — SADAG (mahhala, 24/7)\n📞 *116* — Childline (ngaphansi kwe-18)\n\nUngavakashela futhi umtholampilo ucele ukukhuluma nomeluleki.\n\nAwuwedwa.',
          xh: '💙 Uncedo lukho ngoku:\n\n📞 *0800 428 428* — GBV (simahla, 24/7)\n📞 *0800 567 567* — SADAG (simahla, 24/7)\n📞 *116* — Childline (ngaphantsi kwe-18)\n\nUnokuya kwikliniki yakho ucele ukuthetha nomcebisi.\n\nAwuwedwa.',
          af: '💙 Hulp is nou beskikbaar:\n\n📞 *0800 428 428* — GBV (gratis, 24/7)\n📞 *0800 567 567* — SADAG (gratis, 24/7)\n📞 *116* — Childline (onder 18)\n\nJy kan ook jou kliniek besoek en vra om met \'n berader te praat.\n\nJy is nie alleen nie.',
          nso: '💙 Thušo e gona gonabjale:\n\n📞 *0800 428 428* — GBV (mahala, 24/7)\n📞 *0800 567 567* — SADAG (mahala, 24/7)\n📞 *116* — Childline (ka fase ga 18)\n\nO ka etela gape kliniki ya gago wa kgopela go bolela le moeleletši.\n\nGa o tee.',
          tn: '💙 Thuso e teng jaanong:\n\n📞 *0800 428 428* — GBV (mahala, 24/7)\n📞 *0800 567 567* — SADAG (mahala, 24/7)\n📞 *116* — Childline (ka fa tlase ga 18)\n\nO ka etela gape kliniki ya gago o kope go bua le mogakolodi.\n\nGa o nosi.',
          st: '💙 Thuso e fumaneha hajwale:\n\n📞 *0800 428 428* — GBV (mahala, 24/7)\n📞 *0800 567 567* — SADAG (mahala, 24/7)\n📞 *116* — Childline (ka tlase ho 18)\n\nO ka etela hape kliniki ya hao wa kopa ho bua le moeletsi.\n\nHa o mong.',
          ts: '💙 Mpfuno yi kona sweswi:\n\n📞 *0800 428 428* — GBV (mahala, 24/7)\n📞 *0800 567 567* — SADAG (mahala, 24/7)\n📞 *116* — Childline (ehansi ka 18)\n\nU nga endzela nakambe kliniki ya wena u kombela ku vulavula na mukhongeri.\n\nA wu ri xiviri.',
          ss: '💙 Lusito lukhona nyalo:\n\n📞 *0800 428 428* — GBV (mahhala, 24/7)\n📞 *0800 567 567* — SADAG (mahhala, 24/7)\n📞 *116* — Childline (ngaphansi kwa-18)\n\nUngavakashela futsi ikliniki yakho ucele kukhuluma nemeluleki.\n\nAwuwedvwa.',
          ve: '💙 Thuso i hone zwino:\n\n📞 *0800 428 428* — GBV (mahala, 24/7)\n📞 *0800 567 567* — SADAG (mahala, 24/7)\n📞 *116* — Childline (fhasi ha 18)\n\nNi nga dovha na dalela kha kiliniki yaṋu na humbela u amba na muṱoledzi.\n\nA ni noṱhe.',
          nr: '💙 Isizo sikhona nje nganje:\n\n📞 *0800 428 428* — GBV (simahla, 24/7)\n📞 *0800 567 567* — SADAG (simahla, 24/7)\n📞 *116* — Childline (ngaphasi kwe-18)\n\nUngavakatjhela godu ikliniki yakho ubawa ukukhuluma nomeluleki.\n\nAwuwedwa.',
        };
        await sendWhatsAppMessage(from, msg[lang] || msg['en']);
      }

      session.gbvFollowUpId = null;
      await sessionLib.saveSession(patientId, session);
      return;
    }

    // ── Hospital arrival check response (4h after escalation) ─────
    if (session.awaitingHospitalArrivalResponse && ['1','2','3','4'].includes(text)) {
      session.awaitingHospitalArrivalResponse = false;
      const lang = session.language || 'en';
      const data = session.hospitalReferralData || {};
      const outcomeMap = { '1': 'at_hospital', '2': 'seen_and_discharged', '3': 'could_not_get_there', '4': 'decided_not_to_go' };
      const outcome = outcomeMap[text];

      if (session.hospitalFollowUpId) {
        await supabase.from('follow_ups')
          .update({ status: 'completed', response: outcome })
          .eq('id', session.hospitalFollowUpId);
      }

      if (outcome === 'at_hospital') {
        const msg = { en: '🏥 Thank you. We hope you are receiving good care. We will check in again in 48 hours.\n\nIf you need anything from your clinic, type *0*.', zu: '🏥 Siyabonga. Sethemba uthola ukunakekelwa okuhle. Sizobuza futhi emva kwamahora angu-48.\n\nUma udinga okuthile emtholampilo, bhala *0*.' };
        await sendWhatsAppMessage(from, msg[lang] || msg['en']);
      } else if (outcome === 'seen_and_discharged') {
        const msg = { en: '✅ Glad you were seen. Do you need a follow-up appointment at your clinic?\n\n1 — Yes, please arrange\n2 — No, I am fine', zu: '✅ Siyajabula ukuthi uboniwe. Udinga isikhathi sokulandelela emtholampilo wakho?\n\n1 — Yebo, sicela uhlele\n2 — Cha, ngiyaphila' };
        await sendWhatsAppMessage(from, msg[lang] || msg['en']);
        session.awaitingPostHospitalFollowUp = true;
      } else if (outcome === 'could_not_get_there') {
        const msg = { en: '⚠️ Please try to get to the hospital as soon as possible. Your condition was assessed as urgent.\n\nIf you need transport help, call *10177* for an ambulance.\n\nIf you feel worse, type *0*.', zu: '⚠️ Sicela uzame ukuya esibhedlela ngokushesha. Isimo sakho sihlolwe njengokuphuthuma.\n\nUma udinga usizo lokuhamba, shaya *10177*.\n\nUma uzizwa kabi, bhala *0*.' };
        await sendWhatsAppMessage(from, msg[lang] || msg['en']);
        // Governance alert — patient couldn't reach hospital
        await supabase.from('governance_alerts').insert({
          alert_type: 'hospital_access_failure', severity: 'HIGH', pillar: 'patient_safety',
          message: `Escalated patient could not get to hospital (${data.destination || 'unknown'}). Referral: ${data.referral_id || 'unknown'}.`,
          data: { patient_id: patientId, referral_id: data.referral_id, destination: data.destination },
          resolved: false,
        }).catch(e => logger.error('[HOSPITAL] Access alert failed:', e.message));
      } else {
        // Decided not to go
        const msg = { en: '⚠️ You were referred because your condition was assessed as serious. If you are still unwell, please reconsider going to the hospital.\n\nIf your condition worsens, call *10177* immediately.\n\nType *0* if you need a new consultation.', zu: '⚠️ Uthunyelwe ngoba isimo sakho sihlolwe njengesibi. Uma usagula, sicela ucabange ukuya esibhedlela.\n\nUma isimo sakho sibhebhetheka, shaya *10177* ngokushesha.\n\nBhala *0* uma udinga ukuxoxisana okusha.' };
        await sendWhatsAppMessage(from, msg[lang] || msg['en']);
        await supabase.from('governance_alerts').insert({
          alert_type: 'patient_declined_hospital', severity: 'HIGH', pillar: 'patient_safety',
          message: `Escalated patient decided not to go to hospital. Referral: ${data.referral_id || 'unknown'}.`,
          data: { patient_id: patientId, referral_id: data.referral_id },
          resolved: false,
        }).catch(e => logger.error('[HOSPITAL] Declined alert failed:', e.message));
      }

      session.hospitalFollowUpId = null;
      session.hospitalReferralData = null;
      await sessionLib.saveSession(patientId, session);
      return;
    }

    // ── Hospital discharge check response (48h after escalation) ──
    if (session.awaitingHospitalDischargeResponse && ['1','2','3','4'].includes(text)) {
      session.awaitingHospitalDischargeResponse = false;
      const lang = session.language || 'en';
      const data = session.hospitalDischargeData || {};
      const outcomeMap = { '1': 'still_admitted', '2': 'discharged_better', '3': 'discharged_not_well', '4': 'not_admitted' };
      const outcome = outcomeMap[text];

      if (session.hospitalDischargeFollowUpId) {
        await supabase.from('follow_ups')
          .update({ status: 'completed', response: outcome })
          .eq('id', session.hospitalDischargeFollowUpId);
      }

      if (outcome === 'still_admitted') {
        const msg = { en: '🏥 We hope you recover soon. We will check in again in 5 days.\n\nYour clinic has been notified.', zu: '🏥 Sethemba ululama maduze. Sizobuza futhi emva kwezinsuku ezi-5.\n\nUmtholampilo wakho wazisiwe.' };
        await sendWhatsAppMessage(from, msg[lang] || msg['en']);
        // Schedule another check in 5 days
        await supabase.from('follow_ups').insert({
          patient_id: patientId, phone: from, triage_level: 'RED',
          scheduled_at: new Date(Date.now() + 5 * 24 * 60 * 60 * 1000),
          status: 'pending', type: 'hospital_discharge_check',
          data: JSON.stringify(data),
        }).catch(e => {});
      } else if (outcome === 'discharged_better') {
        const msg = { en: '✅ Glad you are feeling better. Do you need a follow-up appointment at your clinic?\n\n1 — Yes, please arrange\n2 — No, I am fine', zu: '✅ Siyajabula ukuthi uzizwa ngcono. Udinga isikhathi sokulandelela emtholampilo?\n\n1 — Yebo, sicela uhlele\n2 — Cha, ngiyaphila' };
        await sendWhatsAppMessage(from, msg[lang] || msg['en']);
        session.awaitingPostHospitalFollowUp = true;
      } else if (outcome === 'discharged_not_well') {
        const msg = { en: '⚠️ If you are not feeling well after discharge, please visit your clinic tomorrow. Tell the nurse you were recently in hospital.\n\nIf your condition worsens, call *10177* or go back to the hospital.\n\nType *0* for a new consultation.', zu: '⚠️ Uma ungaphili kahle emva kokukhishwa, sicela uye emtholampilo kusasa. Tshela unesi ukuthi ubusanda kuba sesibhedlela.\n\nUma isimo sakho sibhebhetheka, shaya *10177* noma ubuyele esibhedlela.\n\nBhala *0* ukuqala ukuxoxisana okusha.' };
        await sendWhatsAppMessage(from, msg[lang] || msg['en']);
      } else {
        const msg = { en: 'If you are still unwell, please visit your clinic. Type *0* for help.', zu: 'Uma usagula, sicela uye emtholampilo. Bhala *0* ukuthola usizo.' };
        await sendWhatsAppMessage(from, msg[lang] || msg['en']);
      }

      session.hospitalDischargeFollowUpId = null;
      session.hospitalDischargeData = null;
      await sessionLib.saveSession(patientId, session);
      return;
    }

    // ── Post-hospital follow-up appointment request ─────────────
    if (session.awaitingPostHospitalFollowUp && ['1','2'].includes(text)) {
      session.awaitingPostHospitalFollowUp = false;
      const lang = session.language || 'en';

      if (text === '1') {
        const msg = { en: '📋 We will ask your clinic to arrange a follow-up appointment. You will receive a date and time on WhatsApp.\n\nBring: your hospital discharge letter, ID, clinic card, and any new medication.', zu: '📋 Sizocela umtholampilo wakho ukuthi uhlele isikhathi sokulandelela. Uzothola usuku nesikhathi ku-WhatsApp.\n\nLetha: incwadi yokukhishwa esibhedlela, i-ID, ikhadi lasemtholampilo, nemithi emisha.' };
        await sendWhatsAppMessage(from, msg[lang] || msg['en']);
        // Governance alert for clinic to schedule follow-up
        await supabase.from('governance_alerts').insert({
          alert_type: 'post_hospital_followup_needed', severity: 'MEDIUM', pillar: 'patient_safety',
          message: `Patient discharged from hospital, requesting clinic follow-up appointment.`,
          data: { patient_id: patientId, facility_name: session.confirmedFacility?.name },
          resolved: false,
        }).catch(e => {});
      } else {
        const msg = { en: '👍 Take care. If you need help later, type *0*.\n\nRemember to take any medication the hospital prescribed.', zu: '👍 Zinakekele. Uma udinga usizo, bhala *0*.\n\nKhumbula ukuthatha umuthi onikwe esibhedlela.' };
        await sendWhatsAppMessage(from, msg[lang] || msg['en']);
      }

      await sessionLib.saveSession(patientId, session);
      return;
    }

    // ── Doctor appointment confirmation response ──────────────────
    if (session.awaitingAppointmentConfirmation && ['1','2'].includes(text)) {
      session.awaitingAppointmentConfirmation = false;
      const lang = session.language || 'en';
      const data = session.appointmentReminderData || {};

      if (text === '1') {
        // CONFIRMED — patient will attend
        // Update referral status to confirmed
        if (data.referral_id) {
          await supabase.from('doctor_referrals')
            .update({ status: 'confirmed' })
            .eq('id', data.referral_id);
        }
        if (session.appointmentFollowUpId) {
          await supabase.from('follow_ups')
            .update({ status: 'completed', response: 'confirmed' })
            .eq('id', session.appointmentFollowUpId);
        }

        const confirmMsg = {
          en: `✅ *Appointment confirmed.*\n\n📅 ${data.appointment_date || 'Tomorrow'}${data.assigned_slot ? '\n⏰ ' + data.assigned_slot : ''}\n🏥 ${data.facility_name || 'Your clinic'}\n👤 ${data.doctor_name || 'Doctor'}\n\nPlease arrive at your assigned time. Your file will be ready.\n\nBring: ID, clinic card, current medication.`,
          zu: `✅ *Isikhathi siqinisekisiwe.*\n\n📅 ${data.appointment_date || 'Kusasa'}${data.assigned_slot ? '\n⏰ ' + data.assigned_slot : ''}\n🏥 ${data.facility_name || 'Umtholampilo wakho'}\n👤 ${data.doctor_name || 'Udokotela'}\n\nSicela ufike ngesikhathi sakho. Ifayela lakho lizolungiswa.\n\nLetha: I-ID, ikhadi lasemtholampilo, umuthi owuthathayo.`,
          xh: `✅ *Idinga liqinisekisiwe.*\n\n📅 ${data.appointment_date || 'Ngomso'}${data.assigned_slot ? '\n⏰ ' + data.assigned_slot : ''}\n🏥 ${data.facility_name || 'Ikliniki yakho'}\n👤 ${data.doctor_name || 'Ugqirha'}\n\nNceda ufike ngexesha lakho. Ifayile yakho iya kulungiswa.\n\nZisa: Isazisi, ikhadi lasekliniki, amayeza owathathayo.`,
          af: `✅ *Afspraak bevestig.*\n\n📅 ${data.appointment_date || 'Môre'}${data.assigned_slot ? '\n⏰ ' + data.assigned_slot : ''}\n🏥 ${data.facility_name || 'Jou kliniek'}\n👤 ${data.doctor_name || 'Dokter'}\n\nKom asseblief op jou toegewysde tyd. Jou lêer sal gereed wees.\n\nBring: ID, kliniekkaart, huidige medikasie.`,
        };
        await sendWhatsAppMessage(from, confirmMsg[lang] || confirmMsg['en']);
      } else {
        // CANNOT ATTEND — offer reschedule
        // Release the slot
        if (data.referral_id) {
          await supabase.from('doctor_referrals')
            .update({ status: 'rescheduled', assigned_slot: null })
            .eq('id', data.referral_id);
        }
        if (session.appointmentFollowUpId) {
          await supabase.from('follow_ups')
            .update({ status: 'completed', response: 'cannot_attend' })
            .eq('id', session.appointmentFollowUpId);
        }

        const rescheduleMsg = {
          en: `📅 No problem. Your slot has been released.\n\nWould you like to:\n1 — Reschedule for the next available doctor day\n2 — I will contact the clinic myself`,
          zu: `📅 Kulungile. Isikhathi sakho sikhululiwe.\n\nUngathanda:\n1 — Ukuhlela kabusha kosuku lokugcina lukadokotela\n2 — Ngizothinta umtholampilo ngokwami`,
          xh: `📅 Kulungile. Ixesha lakho likhululwe.\n\nUngathanda:\n1 — Ukuhlela ngokutsha ngosuku olungcono lukagqirha\n2 — Ndiza kuqhagamshelana nekliniki ngokwam`,
          af: `📅 Geen probleem. Jou gleuf is vrygestel.\n\nWil jy:\n1 — Herskeduleer vir die volgende dokterdag\n2 — Ek sal self die kliniek kontak`,
        };
        await sendWhatsAppMessage(from, rescheduleMsg[lang] || rescheduleMsg['en']);
        session.awaitingRescheduleChoice = true;
        session.rescheduleReferralData = data;
      }

      session.appointmentReminderData = null;
      session.appointmentFollowUpId = null;
      await sessionLib.saveSession(patientId, session);
      return;
    }

    // ── Reschedule choice response ──────────────────────────────
    if (session.awaitingRescheduleChoice && ['1','2'].includes(text)) {
      session.awaitingRescheduleChoice = false;
      const lang = session.language || 'en';
      const data = session.rescheduleReferralData || {};

      if (text === '1') {
        // Patient wants to reschedule — we need to find next available doctor day
        // For now, tell them the clinic will contact them (the nurse needs to re-refer)
        const reschedMsg = {
          en: `📋 We will ask the clinic to reschedule your doctor appointment. You will receive a new date and time on WhatsApp.\n\nIf your condition worsens before then, type *0* or visit the clinic.`,
          zu: `📋 Sizocela umtholampilo ukuthi uhlele kabusha isikhathi sakho sikadokotela. Uzothola usuku nesikhathi esisha ku-WhatsApp.\n\nUma isimo sakho sibhebhetheka, bhala *0* noma uye emtholampilo.`,
          xh: `📋 Siza kucela ikliniki ukuba ihlele kwakhona idinga lakho logqirha. Uza kufumana umhla nexesha elitsha kuWhatsApp.\n\nUkuba imeko yakho iya isiba mbi, bhala *0* okanye utyelele ikliniki.`,
          af: `📋 Ons sal die kliniek vra om jou dokterafspraak te herskeduleer. Jy sal \'n nuwe datum en tyd op WhatsApp ontvang.\n\nAs jou toestand vererger, tik *0* of besoek die kliniek.`,
        };
        await sendWhatsAppMessage(from, reschedMsg[lang] || reschedMsg['en']);

        // Create a governance alert so the clinic knows to reschedule
        await supabase.from('governance_alerts').insert({
          alert_type: 'appointment_reschedule_needed',
          severity: 'MEDIUM',
          pillar: 'patient_safety',
          message: `Patient cannot attend doctor appointment on ${data.appointment_date || 'scheduled date'}. Needs rescheduling at ${data.facility_name || 'facility'}.`,
          data: { patient_id: patientId, doctor_name: data.doctor_name, clinical_reason: data.clinical_reason, facility_name: data.facility_name },
          resolved: false,
        }).catch(e => logger.error('[RESCHEDULE] Alert failed:', e.message));
      } else {
        // Patient will contact clinic themselves
        const selfMsg = {
          en: `👍 Please contact your clinic to arrange a new appointment. The number should be on your clinic card.\n\nIf your condition worsens, type *0* or call *10177*.`,
          zu: `👍 Sicela uthinte umtholampilo wakho ukuhlela isikhathi esisha. Inombolo kufanele ibe sekhardini lakho lasemtholampilo.\n\nUma isimo sakho sibhebhetheka, bhala *0* noma shaya *10177*.`,
          xh: `👍 Nceda uqhagamshelane nekliniki yakho ukuhlela idinga elitsha. Inombolo kufuneka ibe kwikadi lakho lasekliniki.\n\nUkuba imeko yakho iya isiba mbi, bhala *0* okanye tsalela *10177*.`,
          af: `👍 Kontak asseblief jou kliniek om \'n nuwe afspraak te reël. Die nommer behoort op jou kliniekkaart te wees.\n\nAs jou toestand vererger, tik *0* of bel *10177*.`,
        };
        await sendWhatsAppMessage(from, selfMsg[lang] || selfMsg['en']);
      }

      session.rescheduleReferralData = null;
      await sessionLib.saveSession(patientId, session);
      return;
    }

    // ── Doctor appointment slot choice response ───────────────────
    if (session.awaitingDoctorSlotChoice) {
      const choice = parseInt(text);
      const slots = session.doctorSlotOptions || [];
      const lang = session.language || 'en';

      if (choice >= 1 && choice <= slots.length) {
        session.awaitingDoctorSlotChoice = false;
        const chosenSlot = slots[choice - 1];

        // Update the referral with chosen slot
        if (session.doctorSlotReferralId) {
          await supabase.from('doctor_referrals')
            .update({ assigned_slot: chosenSlot, status: 'scheduled' })
            .eq('id', session.doctorSlotReferralId);
        }

        const confirmMsg = {
          en: `✅ *Appointment confirmed*\n\n📅 ${session.doctorSlotDate}\n⏰ ${chosenSlot}\n👤 ${session.doctorSlotDoctor}\n🏥 ${session.doctorSlotFacility}\n\nPlease arrive at your time — this helps avoid long waits.\n\nWe will send you a reminder the day before.`,
          zu: `✅ *Isikhathi siqinisekisiwe*\n\n📅 ${session.doctorSlotDate}\n⏰ ${chosenSlot}\n👤 ${session.doctorSlotDoctor}\n🏥 ${session.doctorSlotFacility}\n\nSicela uze ngesikhathi sakho — lokhu kusiza ukugwema ukulinda isikhathi eside.\n\nSizokuthumelela isikhumbuzo.`,
          xh: `✅ *Idinga liqinisekisiwe*\n\n📅 ${session.doctorSlotDate}\n⏰ ${chosenSlot}\n👤 ${session.doctorSlotDoctor}\n🏥 ${session.doctorSlotFacility}\n\nNceda uze ngexesha lakho — oku kunceda ukuphepha ukulinda.\n\nSiza kukuthumela isikhumbuzo.`,
          af: `✅ *Afspraak bevestig*\n\n📅 ${session.doctorSlotDate}\n⏰ ${chosenSlot}\n👤 ${session.doctorSlotDoctor}\n🏥 ${session.doctorSlotFacility}\n\nKom asseblief op jou tyd — dit help om wagtye te verminder.\n\nOns sal jou herinner.`,
        };
        await sendWhatsAppMessage(from, confirmMsg[lang] || confirmMsg['en']);

        // Schedule day-before reminder with chosen slot
        try {
          // Parse the date from the stored string — approximate using the referral record
          const { data: ref } = await supabase.from('doctor_referrals')
            .select('referral_date')
            .eq('id', session.doctorSlotReferralId).single();
          if (ref?.referral_date) {
            const refDate = new Date(ref.referral_date);
            const reminderTime = new Date(refDate.getTime() - 18 * 60 * 60 * 1000);
            await supabase.from('follow_ups').insert({
              patient_id: patientId, type: 'doctor_appointment_reminder',
              status: 'pending', scheduled_at: reminderTime, phone: from,
              data: JSON.stringify({
                doctor_name: session.doctorSlotDoctor,
                clinical_reason: session.doctorSlotClinicalReason,
                appointment_date: session.doctorSlotDate,
                assigned_slot: chosenSlot,
                facility_name: session.doctorSlotFacility,
              }),
            });
          }
        } catch (e) { /* non-critical */ }

        // Clear session flags
        session.doctorSlotReferralId = null;
        session.doctorSlotOptions = null;
        session.doctorSlotDate = null;
        session.doctorSlotDoctor = null;
        session.doctorSlotFacility = null;
        session.doctorSlotClinicalReason = null;
        await sessionLib.saveSession(patientId, session);
      } else {
        // Invalid choice — re-show options
        const slotList = slots.map((s, i) => `${i + 1} — ${s}`).join('\n');
        const retryMsg = {
          en: `Please reply with a number from the list:\n\n${slotList}`,
          zu: `Sicela uphendule ngenombolo ohlwini:\n\n${slotList}`,
          xh: `Nceda uphendule ngenombolo kuluhlu:\n\n${slotList}`,
          af: `Antwoord asseblief met 'n nommer van die lys:\n\n${slotList}`,
        };
        await sendWhatsAppMessage(from, retryMsg[lang] || retryMsg['en']);
      }
      return;
    }

    // ── Treatment adherence response ──────────────────────────────
    if (session.awaitingAdherenceResponse && ['1','2','3','4'].includes(text)) {
      session.awaitingAdherenceResponse = false;
      const lang = session.language || 'en';
      const outcomeMap = { '1': 'adherent', '2': 'missed_doses', '3': 'stopped', '4': 'side_effects' };
      const outcome = outcomeMap[text];

      // Update follow-up
      if (session.adherenceFollowUpId) {
        await supabase.from('follow_ups')
          .update({ status: 'completed', response: outcome })
          .eq('id', session.adherenceFollowUpId);
      }

      if (outcome === 'adherent') {
        const msg = {
          en: '✅ Great — keep taking your medication as prescribed. Complete the full course even if you feel better.\n\nIf anything changes, type *0*.',
          zu: '✅ Kuhle — qhubeka uthatha umuthi wakho njengoba uwunikeziwe. Qeda isigaba esigcwele ngisho noma uzizwa ngcono.\n\nUma kukhona okushintshayo, bhala *0*.',
          xh: '✅ Kulungile — qhubeka uthatha amayeza akho njengoko unikeziwe. Gqiba ixesha eligcweleyo nangona uziva ungcono.\n\nUkuba kukhona okutshintshayo, bhala *0*.',
          af: '✅ Goed — hou aan om jou medikasie soos voorgeskryf te neem. Voltooi die volle kursus selfs as jy beter voel.\n\nAs iets verander, tik *0*.',
        };
        await sendWhatsAppMessage(from, msg[lang] || msg['en']);
      } else if (outcome === 'side_effects') {
        const msg = {
          en: '🤒 Side effects can be uncomfortable. *Do not stop your medication* without talking to a nurse.\n\nPlease visit the clinic to discuss your side effects — the nurse may adjust your treatment.\n\nIf severe (rash, swelling, difficulty breathing), go to the clinic *now* or call *10177*.',
          zu: '🤒 Imiphumela emibi ingakhathaza. *Ungayeki umuthi wakho* ngaphandle kokukhuluma nonesi.\n\nSicela uvakashele umtholampilo ukuze uxoxe ngemiphumela — unesi angashintsha ukwelashwa kwakho.\n\nUma kubukhali (isiphehla, ukuvuvuka, ukuphefumula), yana emtholampilo *MANJE* noma shaya *10177*.',
          xh: '🤒 Iziphumo ezimbi zingangeneki. *Musa ukuyeka amayeza akho* ngaphandle kokuthetha nomongikazi.\n\nNceda utyelele ikliniki ukuxoxa ngeziphumo — umongikazi angatshintsha unyango lwakho.\n\nUkuba kunzima (irash, ukudumba, ukuphefumla), yiya ekliniki *NGOKU* okanye tsalela *10177*.',
          af: '🤒 Newe-effekte kan ongemaklik wees. *Moenie jou medikasie stop* sonder om met \'n verpleegster te praat nie.\n\nBesoek asseblief die kliniek om jou newe-effekte te bespreek.\n\nAs dit ernstig is (uitslag, swelling, asemnood), gaan *nou* na die kliniek of bel *10177*.',
        };
        await sendWhatsAppMessage(from, msg[lang] || msg['en']);
        // Governance alert for side effects
        await supabase.from('governance_alerts').insert({
          alert_type: 'medication_side_effects', severity: 'MEDIUM', pillar: 'patient_safety',
          message: `Patient reported medication side effects.`,
          data: { patient_id: patientId, facility_name: session.confirmedFacility?.name },
          resolved: false,
        }).catch(e => logger.error('[ADHERENCE] Side effects alert failed:', e.message));
      } else {
        // missed_doses or stopped
        const msg = {
          en: `⚠️ It is important to take your medication as prescribed${outcome === 'stopped' ? ' — *stopping early can make your condition worse*' : ''}.\n\nPlease visit the clinic if you are having trouble with your medication — the nurse can help.\n\nIf you feel unwell, type *0*.`,
          zu: `⚠️ Kubalulekile ukuthatha umuthi wakho njengoba uwunikeziwe${outcome === 'stopped' ? ' — *ukuyeka ngaphambi kwesikhathi kungenza isimo sakho sibhibhe*' : ''}.\n\nSicela uvakashele umtholampilo uma unenkinga ngomuthi — unesi angakusiza.\n\nUma uzizwa ungaphili kahle, bhala *0*.`,
          xh: `⚠️ Kubalulekile ukuthatha amayeza akho njengoko unikeziwe${outcome === 'stopped' ? ' — *ukuyeka ngaphambi kwexesha kunokwenza imeko yakho ibe mbi*' : ''}.\n\nNceda utyelele ikliniki ukuba unengxaki ngamayeza — umongikazi anganceda.\n\nUkuba uziva ungaphilanga, bhala *0*.`,
          af: `⚠️ Dit is belangrik om jou medikasie soos voorgeskryf te neem${outcome === 'stopped' ? ' — *om vroeg te stop kan jou toestand vererger*' : ''}.\n\nBesoek asseblief die kliniek as jy probleme het met jou medikasie.\n\nAs jy siek voel, tik *0*.`,
        };
        await sendWhatsAppMessage(from, msg[lang] || msg['en']);
      }

      session.adherenceFollowUpId = null;
      await sessionLib.saveSession(patientId, session);
      return;
    }

    // ── Patient satisfaction survey response ──────────────────────
    if (session.awaitingSatisfactionSurvey && ['1','2','3','4','5'].includes(text)) {
      session.awaitingSatisfactionSurvey = false;
      const lang = session.language || 'en';
      const rating = parseInt(text);

      // Store satisfaction outcome
      await supabase.from('satisfaction_surveys').insert({
        patient_id: patientId,
        follow_up_id: session.satisfactionFollowUpId || null,
        rating,
        facility_name: session.satisfactionFacility || session.confirmedFacility?.name || null,
        response_received_at: new Date().toISOString(),
      }).catch(e => logger.error('[SATISFACTION] Insert error:', e.message));

      // Update follow-up
      if (session.satisfactionFollowUpId) {
        await supabase.from('follow_ups')
          .update({ status: 'completed', response: String(rating) })
          .eq('id', session.satisfactionFollowUpId);
      }

      if (rating <= 2) {
        // Poor experience — ask for details and create governance alert
        const poorMsg = {
          en: '🙏 We are sorry your experience was not good. Would you like to tell us what went wrong? (Type your feedback or *skip*)',
          zu: '🙏 Siyaxolisa ukuthi awuphathwanga kahle. Ungathanda ukusitshela okungahambanga kahle? (Bhala umbono wakho noma *skip*)',
          xh: '🙏 Siyaxolisa ukuba amava akho abemabi. Ungathanda ukusixelela okungahambanga kakuhle? (Bhala impendulo yakho okanye *skip*)',
          af: '🙏 Ons is jammer jou ervaring was nie goed nie. Wil jy ons vertel wat verkeerd gegaan het? (Tik jou terugvoer of *skip*)',
        };
        await sendWhatsAppMessage(from, poorMsg[lang] || poorMsg['en']);
        session.awaitingSatisfactionFeedback = true;
        session.satisfactionRating = rating;
        await sessionLib.saveSession(patientId, session);

        // Governance alert for poor satisfaction
        await supabase.from('governance_alerts').insert({
          alert_type: 'poor_patient_satisfaction', severity: 'MEDIUM', pillar: 'equity',
          message: `Patient rated experience ${rating}/5 at ${session.satisfactionFacility || 'facility'}.`,
          data: { patient_id: patientId, rating, facility_name: session.satisfactionFacility },
          resolved: false,
        }).catch(e => logger.error('[SATISFACTION] Governance alert failed:', e.message));
      } else {
        const thankMsg = {
          en: `🙏 Thank you for your feedback! ${rating >= 4 ? 'We are glad you had a good experience.' : 'We appreciate you taking the time to respond.'}\n\nStay well.`,
          zu: `🙏 Siyabonga ngombono wakho! ${rating >= 4 ? 'Siyajabula ukuthi uphathwe kahle.' : 'Siyabonga ukuthi uthathile isikhathi sokuphendula.'}\n\nUhlale kahle.`,
          xh: `🙏 Enkosi ngempendulo yakho! ${rating >= 4 ? 'Siyavuya ukuba unamava amahle.' : 'Siyabulela ngethuba lakho lokuphendula.'}\n\nHlala kakuhle.`,
          af: `🙏 Dankie vir jou terugvoer! ${rating >= 4 ? 'Ons is bly jy het \'n goeie ervaring gehad.' : 'Ons waardeer dat jy die tyd geneem het om te antwoord.'}\n\nBly gesond.`,
        };
        await sendWhatsAppMessage(from, thankMsg[lang] || thankMsg['en']);
        session.satisfactionFollowUpId = null;
        session.satisfactionFacility = null;
        await sessionLib.saveSession(patientId, session);
      }
      return;
    }

    // ── Satisfaction feedback (free text after poor rating) ──────
    if (session.awaitingSatisfactionFeedback) {
      session.awaitingSatisfactionFeedback = false;
      const lang = session.language || 'en';
      const feedback = text.toLowerCase() === 'skip' ? null : text;

      if (feedback) {
        // Store the feedback text
        await supabase.from('satisfaction_surveys')
          .update({ feedback_text: feedback })
          .eq('patient_id', patientId)
          .order('created_at', { ascending: false })
          .limit(1)
          .catch(e => logger.error('[SATISFACTION] Feedback update error:', e.message));
      }

      const thankMsg = {
        en: '🙏 Thank you for your feedback. It has been recorded and will be reviewed by the facility manager.\n\nStay well.',
        zu: '🙏 Siyabonga ngombono wakho. Uqoshiwe futhi uzobuyekezwa umphathi wesibhedlela.\n\nUhlale kahle.',
        xh: '🙏 Enkosi ngempendulo yakho. Ibhaliwe kwaye iza kuhlolwa ngumlawuli wesibhedlele.\n\nHlala kakuhle.',
        af: '🙏 Dankie vir jou terugvoer. Dit is aangeteken en sal deur die fasiliteitsbestuurder hersien word.\n\nBly gesond.',
      };
      await sendWhatsAppMessage(from, thankMsg[lang] || thankMsg['en']);
      session.satisfactionFollowUpId = null;
      session.satisfactionFacility = null;
      session.satisfactionRating = null;
      await sessionLib.saveSession(patientId, session);
      return;
    }

    // ── Dispensing confirmation response (DoH Exit Process) ──────
    if (session.awaitingDispensingConfirmation && ['1','2','3','4'].includes(text)) {
      session.awaitingDispensingConfirmation = false;
      const lang = session.language || 'en';

      const dispensingResult = {
        '1': 'received',       // Got medication
        '2': 'return_later',   // Told to come back
        '3': 'stockout',       // Stockout
        '4': 'not_yet',        // Haven't been yet
      }[text];

      // Log dispensing outcome
      await supabase.from('dispensing_outcomes').insert({
        patient_id: patientId,
        follow_up_id: session.dispensingFollowUpId || null,
        outcome: dispensingResult,
        facility_name: session.confirmedFacility?.name || session.suggestedFacility?.name || null,
        response_received_at: new Date().toISOString(),
      }).catch(e => logger.error('[DISPENSING] Insert error:', e.message));

      // Update follow-up status
      if (session.dispensingFollowUpId) {
        await supabase.from('follow_ups')
          .update({ status: 'completed', response: dispensingResult })
          .eq('id', session.dispensingFollowUpId);
      }

      if (dispensingResult === 'received') {
        const thankMsg = {
          en: '✅ Thank you for confirming. Remember to take your medication as prescribed.\n\nIf you have any side effects or questions, type *0* to start a new consultation.',
          zu: '✅ Siyabonga ngokuqinisekisa. Khumbula ukuthatha umuthi wakho njengoba uwunikeziwe.\n\nUma unezimpawu ezimbi noma imibuzo, bhala *0* ukuqala kabusha.',
          xh: '✅ Enkosi ngokuqinisekisa. Khumbula ukuthatha amayeza akho njengoko unikeziwe.\n\nUkuba uneziphumo ezimbi okanye imibuzo, bhala *0* ukuqala kwakhona.',
          af: '✅ Dankie vir die bevestiging. Onthou om jou medikasie soos voorgeskryf te neem.\n\nAs jy enige newe-effekte of vrae het, tik *0* vir \'n nuwe konsultasie.',
        };
        await sendWhatsAppMessage(from, thankMsg[lang] || thankMsg['en']);
      } else if (dispensingResult === 'stockout') {
        // Stockout — governance alert + patient guidance
        const stockoutMsg = {
          en: '❌ We are sorry you could not get your medication. This has been reported to the facility manager.\n\nPlease try again tomorrow, or ask the nurse if another clinic nearby has stock.\n\nIf you feel unwell, type *0* for help.',
          zu: '❌ Siyaxolisa ukuthi awutholanga umuthi wakho. Lokhu kubikwe kumphathi wesibhedlela.\n\nSicela uzame futhi kusasa, noma ubuze unesi uma omunye umtholampilo oseduze unayo.\n\nUma uzizwa ungaphili kahle, bhala *0* ukuthola usizo.',
          xh: '❌ Siyaxolisa ukuba awufumananga amayeza akho. Oku kubikwe kumlawuli wesibhedlele.\n\nNceda uzame kwakhona ngomso, okanye ubuze umongikazi ukuba enye ikliniki ekufutshane inayo.\n\nUkuba uziva ungaphilanga, bhala *0* ukufumana uncedo.',
          af: '❌ Ons is jammer dat jy nie jou medikasie kon kry nie. Dit is aan die fasiliteitsbestuurder gerapporteer.\n\nProbeer asseblief môre weer, of vra die verpleegster of \'n ander kliniek naby voorraad het.\n\nAs jy siek voel, tik *0* vir hulp.',
        };
        await sendWhatsAppMessage(from, stockoutMsg[lang] || stockoutMsg['en']);

        // Governance alert for stockout
        await supabase.from('governance_alerts').insert({
          alert_type: 'medication_stockout', severity: 'HIGH', pillar: 'patient_safety',
          message: `Patient reported medication stockout at ${session.confirmedFacility?.name || 'facility'}.`,
          data: { patient_id: patientId, facility_name: session.confirmedFacility?.name },
          resolved: false,
        }).catch(e => logger.error('[DISPENSING] Stockout governance alert failed:', e.message));
      } else if (dispensingResult === 'return_later') {
        const returnMsg = {
          en: '⏳ Noted. Please remember to go back for your medication. If you need a reminder, we will check in again in 24 hours.',
          zu: '⏳ Kuqoshiwe. Sicela ukhumbule ukubuyela umuthi wakho. Uma udinga isikhumbuzo, sizobuza futhi emva kwamahora angu-24.',
          xh: '⏳ Kubhaliwe. Nceda ukhumbule ukubuyela amayeza akho. Ukuba ufuna isikhumbuzo, siza kubuza kwakhona emva kweeyure ezingama-24.',
          af: '⏳ Genoteer. Onthou asseblief om terug te gaan vir jou medikasie. As jy \'n herinnering nodig het, sal ons oor 24 uur weer inskakel.',
        };
        await sendWhatsAppMessage(from, returnMsg[lang] || returnMsg['en']);

        // Re-schedule dispensing check in 24 hours
        await supabase.from('follow_ups').insert({
          patient_id: patientId,
          phone: from,
          triage_level: session.lastTriage?.triage_level || 'GREEN',
          scheduled_at: new Date(Date.now() + 24 * 60 * 60 * 1000),
          status: 'pending',
          type: 'dispensing_confirmation',
          data: session.dispensingFollowUpId ? null : JSON.stringify({ medications: [], facility_name: session.confirmedFacility?.name }),
        }).catch(e => logger.error('[DISPENSING] Re-schedule failed:', e.message));
      } else {
        // not_yet
        const notYetMsg = {
          en: '⏳ No problem. Please collect your medication from the pharmacy when you can. We will check in again in 24 hours.',
          zu: '⏳ Kulungile. Sicela uthhole umuthi wakho ekhemisi uma ukwazi. Sizobuza futhi emva kwamahora angu-24.',
          xh: '⏳ Kulungile. Nceda uthathele amayeza akho ekemisti xa unako. Siza kubuza kwakhona emva kweeyure ezingama-24.',
          af: '⏳ Geen probleem nie. Haal asseblief jou medikasie by die apteek af wanneer jy kan. Ons sal oor 24 uur weer inskakel.',
        };
        await sendWhatsAppMessage(from, notYetMsg[lang] || notYetMsg['en']);

        // Re-schedule in 24 hours
        await supabase.from('follow_ups').insert({
          patient_id: patientId,
          phone: from,
          triage_level: session.lastTriage?.triage_level || 'GREEN',
          scheduled_at: new Date(Date.now() + 24 * 60 * 60 * 1000),
          status: 'pending',
          type: 'dispensing_confirmation',
        }).catch(e => logger.error('[DISPENSING] Re-schedule failed:', e.message));
      }

      session.dispensingFollowUpId = null;
      await sessionLib.saveSession(patientId, session);
      return;
    }
  }

  // NORMAL ORCHESTRATION
  await orchestrateWithFallback(patientId, from, text, session, msgObj?.id || null);
}

// ================== FOLLOW-UP AGENT ==================
setInterval(followup.runFollowUpAgent, 5 * 60 * 1000);

// ================== PER-PATIENT ASYNC QUEUE ==================
// Serializes processing for each patient — prevents session corruption
// when two messages from the same phone arrive simultaneously.
// Each patient gets a promise chain; new messages append to the tail.
const _patientQueues = new Map(); // patientId → Promise

function enqueueForPatient(patientId, task) {
  const prev = _patientQueues.get(patientId) || Promise.resolve();
  const next = prev.then(task).catch(err => {
    logger.error({ err, patientId }, '[QUEUE] Patient processing error');
  });
  _patientQueues.set(patientId, next);
  // Remove entry once the chain is empty so the map doesn't grow unbounded
  next.then(() => {
    if (_patientQueues.get(patientId) === next) _patientQueues.delete(patientId);
  });
}

// ================== PER-PATIENT RATE LIMITING ==================
// Max messages per patient per rolling window. Protects Anthropic API budget.
const TRIAGE_RATE_LIMIT_MAX = 20;          // messages allowed
const TRIAGE_RATE_LIMIT_WINDOW_MS = 60 * 60 * 1000; // 1 hour
const _rateLimits = new Map();      // patientId → [timestamp, timestamp, ...]

function isPatientRateLimited(patientId) {
  const now = Date.now();
  const cutoff = now - TRIAGE_RATE_LIMIT_WINDOW_MS;
  let timestamps = _rateLimits.get(patientId) || [];
  // Prune expired entries
  timestamps = timestamps.filter(t => t > cutoff);
  if (timestamps.length >= TRIAGE_RATE_LIMIT_MAX) {
    _rateLimits.set(patientId, timestamps);
    return true;
  }
  timestamps.push(now);
  _rateLimits.set(patientId, timestamps);
  return false;
}

// Periodic cleanup — remove stale entries every 10 minutes
setInterval(() => {
  const cutoff = Date.now() - TRIAGE_RATE_LIMIT_WINDOW_MS;
  for (const [pid, timestamps] of _rateLimits) {
    const active = timestamps.filter(t => t > cutoff);
    if (active.length === 0) _rateLimits.delete(pid);
    else _rateLimits.set(pid, active);
  }
}, 10 * 60 * 1000);

// ================== MESSAGE DEDUPLICATION ==================
// Meta occasionally delivers the same webhook twice (network retries, edge caching).
// Track seen message IDs to prevent double-processing (duplicate triage, double messages).
const _seenMessages = new Set();
const WEBHOOK_DEDUP_TTL_MS = 5 * 60 * 1000; // 5 minutes — well beyond Meta's retry window
const _seenTimestamps = new Map();   // msgId → timestamp (for cleanup)

function isDuplicate(messageId) {
  if (!messageId) return false; // no ID = can't dedup, allow through
  if (_seenMessages.has(messageId)) return true;
  _seenMessages.add(messageId);
  _seenTimestamps.set(messageId, Date.now());
  return false;
}

// Cleanup expired dedup entries every 2 minutes
setInterval(() => {
  const cutoff = Date.now() - WEBHOOK_DEDUP_TTL_MS;
  for (const [msgId, ts] of _seenTimestamps) {
    if (ts < cutoff) {
      _seenMessages.delete(msgId);
      _seenTimestamps.delete(msgId);
    }
  }
}, 2 * 60 * 1000);

// ================== WEBHOOK ==================
// Note: handler is synchronous — res.sendStatus(200) fires before any I/O,
// so Meta never retries even if processing takes several seconds.
// WhatsApp webhook signature verification (Meta X-Hub-Signature-256)
function verifyWebhookSignature(req) {
  const signature = req.headers['x-hub-signature-256'];
  if (!process.env.WHATSAPP_APP_SECRET) {
    logger.error('[SECURITY] WHATSAPP_APP_SECRET not configured — rejecting webhook');
    return false;
  }
  if (!signature) return false;
  const expected = 'sha256=' + crypto.createHmac('sha256', process.env.WHATSAPP_APP_SECRET)
    .update(JSON.stringify(req.body)).digest('hex');
  return crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected));
}

// ── Clickatell inbound SMS webhook ──────────────────────────────
// Patient texts BZ code to Clickatell number → receives health passport via SMS.
// No WhatsApp, no data, no smartphone needed.
// Configure CLICKATELL_CALLBACK_URL in Clickatell dashboard to point here.
app.post('/api/sms/inbound', smsLib.handleInboundSMS);

app.post('/webhook', (req, res) => {
  // Verify signature before processing — reject spoofed webhooks
  if (!verifyWebhookSignature(req)) {
    logger.warn('[WEBHOOK] Invalid signature — possible spoofing attempt');
    return res.sendStatus(403);
  }
  res.sendStatus(200);

  const msgObj = req.body.entry?.[0]?.changes?.[0]?.value?.messages?.[0];
  if (!msgObj) return;

  // Dedup — Meta sometimes delivers the same message twice
  if (isDuplicate(msgObj.id)) {
    logger.info({ messageId: msgObj.id }, '[DEDUP] Duplicate webhook dropped');
    return;
  }

  const from = msgObj.from;

  // ── WHITELIST GATE — pre-pilot access control ──────────────────────────────
  // Only whitelisted numbers reach the triage flow. Everyone else gets a
  // development notice with emergency numbers. This gate ensures the system
  // does not provide clinical triage to the public before ethics approval.
  const whitelistedNumbers = (process.env.WHITELISTED_NUMBERS || '')
    .split(',')
    .map(n => n.trim().replace(/^\+/, ''))
    .filter(Boolean);

  if (whitelistedNumbers.length > 0 && !whitelistedNumbers.includes(from.replace(/^\+/, ''))) {
    logger.info({ from: sessionLib.hashPhone(from) }, '[WHITELIST] Non-whitelisted number — development notice sent');
    sendWhatsAppMessage(from, msg('development_notice', 'en')).catch(() => {});
    return;
  }
  // ── END WHITELIST GATE ─────────────────────────────────────────────────────

  const patientId = sessionLib.hashPhone(from);

  // Rate limit check — drop message if patient exceeds threshold
  if (isPatientRateLimited(patientId)) {
    logger.warn({ patientId }, '[RATE LIMIT] Patient exceeded 20 msgs/hour — message dropped');
    // Best-effort language lookup; fall back to English if DB is slow
    sessionLib.getSession(patientId)
      .then(s => sendWhatsAppMessage(from, msg('rate_limited', s?.language || 'en')))
      .catch(() => sendWhatsAppMessage(from, msg('rate_limited', 'en')).catch(() => {}));
    return;
  }

  enqueueForPatient(patientId, async () => {
    try {
      // ==================== LOAD SHEDDING / OUTAGE SAFETY NET ====================
      // If processing stalls for 15 seconds (load shedding, API timeout, DB outage),
      // send an emergency fallback so the patient is never left with silence.
      const TIMEOUT_MS = 15000;
      let responded = false;

      const timeoutPromise = new Promise((resolve) => {
        setTimeout(async () => {
          if (!responded) {
            try {
              let lang = 'en';
              try {
                const session = await sessionLib.getSession(patientId);
                lang = session.language || 'en';
              } catch (e) { /* DB might be down too — use English */ logger.error('[SILENT] Suppressed error in timeout lang lookup:', e.message || 'unknown'); }

              const timeoutMsg = msg('system_timeout', lang);
              await sendWhatsAppMessage(from, timeoutMsg);

              try {
                governance.systemIntegrity.recordInferenceError('message_processing_timeout_15s');
              } catch (e) {
                queueEvent({
                  type: 'message_processing_timeout',
                  table: 'governance_alerts',
                  data: {
                    alert_type: 'message_processing_timeout_15s',
                    severity: 'HIGH',
                    pillar: 'system_integrity',
                    message: `Patient message timed out after 15s (lang: ${lang}). Patient: ${patientId}`,
                    assigned_to: 'devops_engineer',
                    original_timestamp: new Date().toISOString(),
                  }
                });
              }
            } catch (e) {
              logger.error('[TIMEOUT] Failed to send fallback message:', e.message);
            }
          }
          resolve();
        }, TIMEOUT_MS);
      });

      const messagePromise = handleMessage(msgObj).then(() => { responded = true; });

      await Promise.race([messagePromise, timeoutPromise]);

      if (!responded) {
        messagePromise.then(() => { responded = true; }).catch(() => {});
      }
    } catch (err) {
      logger.error('Error handling message:', err);
    }
  });
});

app.get('/webhook', (req, res) => {
  if (req.query['hub.verify_token'] === process.env.WHATSAPP_VERIFY_TOKEN) {
    res.send(req.query['hub.challenge']);
  } else {
    res.sendStatus(403);
  }
});

// ── Website chatbot endpoint ─────────────────────────────────────────────────
const WEBSITE_CHAT_RATE_LIMIT = new Map();

app.post('/api/chat', async (req, res) => {
  try {
    const { message, history = [] } = req.body;
    if (!message || typeof message !== 'string') {
      return res.status(400).json({ error: 'Message required' });
    }
    if (message.length > 500) {
      return res.status(400).json({ error: 'Message too long' });
    }

    // Rate limit: 20 messages per hour per IP
    const ip = req.headers['x-forwarded-for'] || req.socket.remoteAddress || 'unknown';
    const now = Date.now();
    const entry = WEBSITE_CHAT_RATE_LIMIT.get(ip) || { count: 0, windowStart: now };
    if (now - entry.windowStart > 60 * 60 * 1000) {
      entry.count = 0;
      entry.windowStart = now;
    }
    entry.count++;
    WEBSITE_CHAT_RATE_LIMIT.set(ip, entry);
    if (entry.count > 20) {
      return res.status(429).json({ error: 'Too many messages. Please try again later.' });
    }

    const messages = [
      ...history.slice(-6).map(h => ({ role: h.role, content: h.content })),
      { role: 'user', content: message.trim() }
    ];

    const response = await anthropic.messages.create({
      model: 'claude-haiku-4-5-20251001', // Haiku — website chatbot needs speed, not deep reasoning
      max_tokens: 400,
      system: `You are the BIZUSIZO assistant on the BIZUSIZO website (bizusizo.co.za). BIZUSIZO is a WhatsApp-based AI-assisted triage and patient navigation system for South African public primary healthcare. It operates across all 11 official South African languages and uses the South African Triage Scale (SATS).

You help three types of visitors:
1. General public and patients — curious about what BIZUSIZO is and how to use it
2. Funders and researchers — asking about validation evidence, publications, the EVAH application
3. Health district managers and institutional partners — asking about POPIA compliance, pilot logistics, data collection, staffing, risk

WHAT YOU KNOW:
- BIZUSIZO delivers triage via WhatsApp — no app download needed
- It uses an advanced AI model for free-text symptom classification
- A deterministic rules engine catches life-threatening emergencies independently of AI
- Validated across multiple languages with low under-triage rates and zero RED emergencies missed
- Extended to 135 vignettes across all 11 official SA languages
- Quadratic weighted kappa indicates almost perfect agreement with clinical reference
- Pilot sites: three Tshwane pilot clinics
- Research partner: Prof Tobias Chirwa, Wits School of Public Health
- Clinical Governance Lead: Sheila Plaatjie, RN
- EVAH application submitted (Gates Foundation / Wellcome Trust / Novo Nordisk)
- Data collected: name, date of birth, symptoms — stored in POPIA-compliant encrypted database
- No IT integration required to join the pilot
- Contact: hello@bizusizo.co.za

STRICT RULES — follow these without exception:
1. NEVER give clinical advice of any kind. If anyone asks about symptoms, diagnoses, medication, or what they should do medically, say: "I can't give clinical advice. For urgent symptoms, call 10177 or send a WhatsApp to the BIZUSIZO number to get triaged safely."
2. NEVER discuss specific patient data, triage results, or any individual's health information.
3. If asked to use BIZUSIZO, direct them to WhatsApp: "To use BIZUSIZO, send a WhatsApp message to our number. You can find it on the website or contact us at hello@bizusizo.co.za."
4. Keep responses concise — 3 to 5 sentences maximum. This is a website chat widget, not a consultation.
5. If you do not know something, say so honestly and direct them to hello@bizusizo.co.za.
6. Be warm, professional, and plain-spoken. Avoid jargon. Remember some visitors may be patients with limited health literacy.
7. You may answer in any South African language if the visitor writes in one.`,
      messages
    });

    const reply = response.content[0]?.text || 'I am sorry, I could not generate a response. Please contact hello@bizusizo.co.za.';
    res.json({ reply });

  } catch (e) {
    logger.error('[CHAT] Error:', e.message);
    res.status(500).json({ error: 'Something went wrong. Please try again or contact hello@bizusizo.co.za.' });
  }
});

// Clean up old rate limit entries every hour
setInterval(() => {
  const now = Date.now();
  for (const [ip, entry] of WEBSITE_CHAT_RATE_LIMIT.entries()) {
    if (now - entry.windowStart > 60 * 60 * 1000) WEBSITE_CHAT_RATE_LIMIT.delete(ip);
  }
}, 60 * 60 * 1000);

// ================== HEALTH CHECK ==================
app.get('/', (req, res) => {
  res.json({
    status: 'ok',
    version: '2.2',
    service: 'BIZUSIZO',
    governance: governance.systemIntegrity.isFailsafeActive() ? 'FAILSAFE' : 'NOMINAL',
  });
});

// ================================================================
// CLINIC QUEUE, KIOSK & PRE-ARRIVAL ROUTES — moved to routes/queue.js
// ================================================================
require('./routes/queue')(app, {
  supabase,
  requireDashboardAuth,
  facilityFilter,
  logAudit,
  logTriage: sessionLib.logTriage,
  getSession: sessionLib.getSession,
  saveSession: sessionLib.saveSession,
  scheduleFollowUp: sessionLib.scheduleFollowUp,
  queueEvent,
  sendPreArrivalAlert,
  refreshPreArrivalAlert,
  triageToQueueType,
});


// ================== START ==================
app.listen(process.env.PORT || 3000, () => {
  logger.info('🚀 BIZUSIZO v2.3 Orchestrator LIVE (Governance + Identity + Clinic Queue + Kiosk)');
});

// ── Process-level error handlers ─────────────────────────────────────────
// Catch crashes that would otherwise silently kill the server.
// Logged to Railway console — visible in Railway dashboard logs.
process.on('uncaughtException', (err) => {
  logger.error('[CRASH] Uncaught exception — server staying up:', err.message);
  try {
    queueEvent({
      type: 'process_error', table: 'governance_alerts',
      data: {
        alert_type: 'uncaught_exception', severity: 'CRITICAL', pillar: 'system_integrity',
        message: 'Uncaught exception: ' + err.message, original_timestamp: new Date().toISOString(),
      }
    });
  } catch (e) { /* governance also down — log only */ logger.error('[SILENT] Suppressed error in governance startup check:', e.message || 'unknown'); }
});

process.on('unhandledRejection', (reason) => {
  logger.error('[CRASH] Unhandled promise rejection:', reason);
});

process.on('SIGTERM', () => {
  logger.info('[SHUTDOWN] SIGTERM received — Railway restarting. In-flight messages will receive system_timeout fallback.');
});