'use strict';
const logger = require('../logger');

module.exports = function registerClinicalRoutes(app, { supabase, requireDashboardAuth }) {

// GET /api/clinical/stats — Overview statistics
app.get('/api/clinical/stats', requireDashboardAuth, async (req, res) => {
  try {
    const { data: triages } = await supabase.from('triage_logs').select('triage_level, confidence, created_at, pathway, symptoms');
    const { data: sessions } = await supabase.from('sessions').select('language, chronicConditions, isStudyParticipant, created_at');
    const { data: followUps } = await supabase.from('follow_ups').select('status, triage_level, created_at');
    const { data: studyCodes } = await supabase.from('study_codes').select('id');

    // Today's avg wait time (checked_in_at → called_at for completed entries)
    const todayMidnight = new Date(); todayMidnight.setHours(0, 0, 0, 0);
    const { data: completedToday } = await supabase
      .from('clinic_queue')
      .select('checked_in_at, called_at')
      .eq('status', 'completed')
      .gte('checked_in_at', todayMidnight.toISOString())
      .not('called_at', 'is', null);
    const waitMins = (completedToday || [])
      .map(p => (new Date(p.called_at) - new Date(p.checked_in_at)) / 60000)
      .filter(w => w > 0 && w < 480);
    const avgWaitToday = waitMins.length > 0
      ? Math.round(waitMins.reduce((a, b) => a + b, 0) / waitMins.length)
      : null;

    const t = triages || [];
    const s = sessions || [];
    const f = followUps || [];

    // Triage distribution
    const triageCounts = { RED: 0, ORANGE: 0, YELLOW: 0, GREEN: 0 };
    t.forEach(r => { if (triageCounts[r.triage_level] !== undefined) triageCounts[r.triage_level]++; });

    // Language distribution
    const langCounts = {};
    s.forEach(r => { const l = r.language || 'unknown'; langCounts[l] = (langCounts[l] || 0) + 1; });

    // Confidence stats
    const confidences = t.filter(r => r.confidence).map(r => r.confidence);
    const avgConfidence = confidences.length > 0 ? Math.round(confidences.reduce((a, b) => a + b, 0) / confidences.length) : 0;
    const lowConfidence = confidences.filter(c => c < 75).length;

    // Follow-up stats
    const followUpSent = f.filter(r => r.status === 'sent').length;
    const followUpResponded = f.filter(r => ['better', 'same', 'worse'].includes(r.status)).length;

    // Pathway distribution
    const pathwayCounts = {};
    t.forEach(r => { const p = r.pathway || 'unknown'; pathwayCounts[p] = (pathwayCounts[p] || 0) + 1; });

    // Daily triage counts (last 30 days)
    const dailyCounts = {};
    const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    t.forEach(r => {
      if (r.created_at && new Date(r.created_at) > thirtyDaysAgo) {
        const day = new Date(r.created_at).toISOString().split('T')[0];
        dailyCounts[day] = (dailyCounts[day] || 0) + 1;
      }
    });

    // Chronic conditions distribution
    const conditionCounts = {};
    s.forEach(r => {
      if (r.chronicConditions && Array.isArray(r.chronicConditions)) {
        r.chronicConditions.forEach(c => {
          const name = typeof c === 'object' ? (c.label_en || c.id || 'unknown') : c;
          conditionCounts[name] = (conditionCounts[name] || 0) + 1;
        });
      }
    });

    res.json({
      total_triages: t.length,
      total_sessions: s.length,
      study_participants: (studyCodes || []).length,
      triage_distribution: triageCounts,
      language_distribution: langCounts,
      avg_confidence: avgConfidence,
      low_confidence_count: lowConfidence,
      follow_up_sent: followUpSent,
      follow_up_responded: followUpResponded,
      follow_up_response_rate: followUpSent > 0 ? Math.round(followUpResponded / followUpSent * 100) : 0,
      pathway_distribution: pathwayCounts,
      daily_triages: dailyCounts,
      chronic_conditions: conditionCounts,
      avg_wait_today_minutes: avgWaitToday,
      avg_wait_sample_size: waitMins.length,
    });
  } catch (e) {
    res.status(500).json({ error: 'Server error' });
  }
});

// GET /api/clinical/recent — Recent triage events
app.get('/api/clinical/recent', requireDashboardAuth, async (req, res) => {
  try {
    const limit = parseInt(req.query.limit) || 20;
    const { data } = await supabase
      .from('triage_logs')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(limit);
    res.json(data || []);
  } catch (e) {
    res.status(500).json({ error: 'Server error' });
  }
});

// ================================================================
// CLINICAL DASHBOARD — Inline HTML (vanilla JS, no dependencies)
// ================================================================
app.get('/clinical', (req, res) => {
  res.setHeader('Content-Type', 'text/html');
  res.send(getClinicalDashboardHTML());
});

function getClinicalDashboardHTML() {
  return [
'<!DOCTYPE html>',
'<html lang="en">',
'<head>',
'<meta charset="UTF-8">',
'<meta name="viewport" content="width=device-width, initial-scale=1.0">',
'<title>BIZUSIZO Clinical Dashboard</title>',
'<style>',
'*{margin:0;padding:0;box-sizing:border-box}',
'body{background:#0a0e17;color:#e2e8f0;font-family:-apple-system,sans-serif;padding:20px}',
'.header{display:flex;justify-content:space-between;align-items:center;margin-bottom:24px;padding-bottom:16px;border-bottom:1px solid #1e293b}',
'.header h1{font-size:20px}',
'.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:16px;margin-bottom:24px}',
'.card{background:#111827;border:1px solid #1e293b;border-radius:10px;padding:16px}',
'.card .label{font-size:11px;color:#64748b;text-transform:uppercase;letter-spacing:.05em}',
'.card .value{font-size:28px;font-weight:700;margin-top:4px}',
'.card .sub{font-size:12px;color:#64748b;margin-top:4px}',
'.section{margin-bottom:24px}',
'.section h2{font-size:16px;color:#94a3b8;margin-bottom:12px}',
'.chart-row{display:grid;grid-template-columns:1fr 1fr;gap:16px;margin-bottom:24px}',
'.bar-chart{background:#111827;border:1px solid #1e293b;border-radius:10px;padding:16px}',
'.bar{display:flex;align-items:center;gap:8px;margin-bottom:8px}',
'.bar .bar-label{width:80px;font-size:12px;color:#94a3b8;text-align:right;flex-shrink:0}',
'.bar .bar-fill{height:24px;border-radius:4px;transition:width .5s;display:flex;align-items:center;padding-left:8px;font-size:11px;font-weight:600;min-width:30px}',
'.bar-red{background:rgba(239,68,68,.7)}.bar-orange{background:rgba(249,115,22,.7)}.bar-yellow{background:rgba(234,179,8,.7)}.bar-green{background:rgba(34,197,94,.7)}.bar-default{background:rgba(59,130,246,.5)}',
'table{width:100%;border-collapse:collapse;font-size:13px}',
'th{text-align:left;padding:8px 12px;background:#111827;color:#64748b;font-size:11px;text-transform:uppercase;border-bottom:1px solid #1e293b}',
'td{padding:8px 12px;border-bottom:1px solid #1e293b}',
'.badge{display:inline-block;padding:2px 8px;border-radius:99px;font-size:11px;font-weight:600}',
'.badge-RED{color:#ef4444;border:1px solid rgba(239,68,68,.3)}.badge-ORANGE{color:#f97316;border:1px solid rgba(249,115,22,.3)}.badge-YELLOW{color:#eab308;border:1px solid rgba(234,179,8,.3)}.badge-GREEN{color:#22c55e;border:1px solid rgba(34,197,94,.3)}',
'.empty{text-align:center;padding:40px;color:#475569}',
'.login{position:fixed;inset:0;background:#0a0e17;display:flex;align-items:center;justify-content:center;z-index:99}',
'.login-box{background:#111827;border:1px solid #1e293b;border-radius:10px;padding:32px;width:320px;text-align:center}',
'.login-box h2{margin-bottom:16px;font-size:18px}',
'.login-box input{width:100%;padding:10px;border-radius:6px;border:1px solid #1e293b;background:#0d1321;color:#e2e8f0;margin-bottom:12px;font-size:14px}',
'.login-box button{width:100%;padding:10px;border-radius:6px;border:none;background:#3b82f6;color:white;font-size:14px;cursor:pointer}',
'.nav{display:flex;gap:12px;margin-bottom:24px;font-size:13px}',
'.nav a{color:#64748b;text-decoration:none;padding:6px 12px;border-radius:6px;border:1px solid #1e293b}',
'.nav a:hover,.nav a.active{color:#e2e8f0;border-color:#3b82f6}',
'</style>',
'</head>',
'<body>',
'<div id="login" class="login"><div class="login-box">',
'<h2>BIZUSIZO Clinical Dashboard</h2>',
'<p style="color:#64748b;font-size:13px;margin-bottom:16px">Sign in to access the dashboard</p>',
'<input type="text" id="uname" placeholder="Username (e.g. bongekile.nkosi)" style="width:100%;padding:10px;border-radius:6px;border:1px solid #1e293b;background:#0d1321;color:#e2e8f0;margin-bottom:8px;font-size:14px">',
'<input type="password" id="pwd" placeholder="Password" onkeyup="if(event.key===\'Enter\')doLogin()">',
'<button onclick="doLogin()">Sign in</button>',
'<p id="login-err" style="color:#ef4444;font-size:12px;margin-top:8px"></p>',
'</div></div>',
'<div id="app" style="display:none">',
'<div class="header"><h1>BIZUSIZO Clinical Dashboard</h1><div><span style="color:#475569;font-size:11px" id="logged-in-as"></span><span style="color:#475569;font-size:11px;margin-left:12px" id="last-refresh"></span></div></div>',
'<div class="nav"><a href="/dashboard">Governance Dashboard</a><a href="/clinical" class="active">Clinical Dashboard</a></div>',
'<div class="grid" id="stat-cards"></div>',
'<div class="chart-row">',
'<div class="bar-chart"><h3 style="font-size:14px;color:#94a3b8;margin-bottom:12px">Triage Distribution</h3><div id="triage-bars"></div></div>',
'<div class="bar-chart"><h3 style="font-size:14px;color:#94a3b8;margin-bottom:12px">Languages Used</h3><div id="lang-bars"></div></div>',
'</div>',
'<div class="chart-row">',
'<div class="bar-chart"><h3 style="font-size:14px;color:#94a3b8;margin-bottom:12px">Chronic Conditions</h3><div id="condition-bars"></div></div>',
'<div class="bar-chart"><h3 style="font-size:14px;color:#94a3b8;margin-bottom:12px">Pathways</h3><div id="pathway-bars"></div></div>',
'</div>',
'<div class="section"><h2>Recent Triage Events</h2><div class="card">',
'<table><thead><tr><th>Time</th><th>Level</th><th>Confidence</th><th>Pathway</th><th>Symptoms</th></tr></thead>',
'<tbody id="recent-body"></tbody></table></div></div>',
'<div style="margin-top:32px;padding-top:16px;border-top:1px solid #1e293b;font-size:10px;color:#475569;display:flex;justify-content:space-between">',
'<span>BIZUSIZO Clinical Dashboard v1.0</span><span>Auto-refresh every 60s</span></div>',
'</div>',
'<script>',
'var PWD="";var UNAME="";var SESSION_TOKEN="";',
'var langNames={en:"English",zu:"isiZulu",xh:"isiXhosa",af:"Afrikaans",nso:"Sepedi",tn:"Setswana",st:"Sesotho",ts:"Xitsonga",ss:"siSwati",ve:"Tshivenda",nr:"isiNdebele"};',
'function getToken(){if(SESSION_TOKEN)return SESSION_TOKEN;var m=document.cookie.match(/bz_session=([a-f0-9]+)/);return m?m[1]:"";}',
'async function api(p){try{var h={};var t=SESSION_TOKEN||getToken();if(t){h["Authorization"]="Bearer "+t;}if(PWD){h["x-dashboard-password"]=PWD;h["x-dashboard-user"]=UNAME;}var r=await fetch(p,{headers:h});if(r.status===401){SESSION_TOKEN="";document.getElementById("login").style.display="flex";document.getElementById("app").style.display="none";return null;}if(!r.ok)throw new Error(r.status);return await r.json();}catch(e){console.error(p,e);return null;}}',
'async function doLogin(){UNAME=document.getElementById("uname").value.trim();PWD=document.getElementById("pwd").value;if(!UNAME){document.getElementById("login-err").textContent="Please enter your username";return;}if(!PWD){document.getElementById("login-err").textContent="Please enter your password";return;}try{var r=await fetch("/api/auth/login",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({username:UNAME.toLowerCase(),password:PWD})});if(r.ok){var data=await r.json();SESSION_TOKEN=data.token;document.cookie="bz_session="+data.token+";path=/;max-age="+(8*60*60)+";SameSite=Lax";UNAME=data.user.display_name;document.getElementById("login").style.display="none";document.getElementById("app").style.display="block";document.getElementById("logged-in-as").textContent="Signed in as: "+UNAME;refresh();return;}}catch(e){}try{var t=await fetch("/api/clinical/stats",{headers:{"x-dashboard-password":PWD,"x-dashboard-user":UNAME}});if(t.ok){document.getElementById("login").style.display="none";document.getElementById("app").style.display="block";document.getElementById("logged-in-as").textContent="Signed in as: "+UNAME;refresh();return;}}catch(e){}document.getElementById("login-err").textContent="Invalid username or password";}',
'function timeAgo(d){if(!d)return"-";var s=Math.floor((Date.now()-new Date(d))/1000);if(s<60)return s+"s ago";if(s<3600)return Math.floor(s/60)+"m ago";if(s<86400)return Math.floor(s/3600)+"h ago";return Math.floor(s/86400)+"d ago";}',
'function makeBars(id,data,cm){var el=document.getElementById(id);var e=Object.entries(data).sort(function(a,b){return b[1]-a[1]});var mx=Math.max.apply(null,e.map(function(x){return x[1]}));if(mx<1)mx=1;if(e.length===0){el.innerHTML="<div class=\\"empty\\">No data yet</div>";return;}el.innerHTML=e.map(function(x){var pct=Math.round(x[1]/mx*100);var cls=cm&&cm[x[0]]?cm[x[0]]:"bar-default";var lb=langNames[x[0]]||x[0];return "<div class=\\"bar\\"><span class=\\"bar-label\\">"+lb+"</span><div class=\\"bar-fill "+cls+"\\" style=\\"width:"+pct+"%\\">"+x[1]+"</div></div>";}).join("");}',
'async function refresh(){var stats=await api("/api/clinical/stats");if(!stats)return;document.getElementById("last-refresh").textContent="Updated "+new Date().toLocaleTimeString();var td=stats.triage_distribution||{};var total=stats.total_triages||0;',
'document.getElementById("stat-cards").innerHTML=[{l:"Total Triages",v:total,s:"All time"},{l:"Active Sessions",v:stats.total_sessions||0,s:"Unique patients"},{l:"Study Participants",v:stats.study_participants||0,s:"With BZ-XXXX codes"},{l:"RED",v:td.RED||0,s:total>0?((td.RED||0)/total*100).toFixed(1)+"%":"0%"},{l:"ORANGE",v:td.ORANGE||0,s:total>0?((td.ORANGE||0)/total*100).toFixed(1)+"%":"0%"},{l:"YELLOW",v:td.YELLOW||0,s:total>0?((td.YELLOW||0)/total*100).toFixed(1)+"%":"0%"},{l:"GREEN",v:td.GREEN||0,s:total>0?((td.GREEN||0)/total*100).toFixed(1)+"%":"0%"},{l:"Avg Confidence",v:stats.avg_confidence+"%",s:"Low conf: "+(stats.low_confidence_count||0)},{l:"Follow-up Rate",v:stats.follow_up_response_rate+"%",s:stats.follow_up_responded+"/"+stats.follow_up_sent},{l:"Avg Wait Today",v:stats.avg_wait_today_minutes!=null?stats.avg_wait_today_minutes+"m":"—",s:stats.avg_wait_today_minutes!=null?(stats.avg_wait_today_minutes<187?"Below national avg (187m)":"Above national avg (187m)"):"No completed visits yet"}].map(function(c){return "<div class=\\"card\\"><div class=\\"label\\">"+c.l+"</div><div class=\\"value\\">"+c.v+"</div><div class=\\"sub\\">"+c.s+"</div></div>";}).join("");',
'makeBars("triage-bars",td,{RED:"bar-red",ORANGE:"bar-orange",YELLOW:"bar-yellow",GREEN:"bar-green"});',
'makeBars("lang-bars",stats.language_distribution||{});',
'makeBars("condition-bars",stats.chronic_conditions||{});',
'makeBars("pathway-bars",stats.pathway_distribution||{});',
'var recent=await api("/api/clinical/recent?limit=15");var rb=document.getElementById("recent-body");',
'if(recent&&recent.length>0){rb.innerHTML=recent.map(function(r){var sym=(r.symptoms||"-").substring(0,60);return "<tr><td>"+timeAgo(r.created_at)+"</td><td><span class=\\"badge badge-"+(r.triage_level||"")+"\\">"+( r.triage_level||"-")+"</span></td><td>"+(r.confidence||"-")+"%</td><td>"+(r.pathway||"-")+"</td><td>"+sym+"</td></tr>";}).join("");}else{rb.innerHTML="<tr><td colspan=\\"5\\" class=\\"empty\\">No triage events yet</td></tr>";}}',
'setInterval(refresh,60000);',
'// Auto-login disabled — use the built-in login form',
'</script>',
'</body>',
'</html>',
  ].join('\n');
}

// ================================================================
// STUDY CODE — API ENDPOINTS (for research assistants)
// ================================================================

// GET /api/study-codes/lookup/:code — Look up patient by study code
app.get('/api/study-codes/lookup/:code', requireDashboardAuth, async (req, res) => {
  try {
    const result = await lookupStudyCode(req.params.code);
    if (!result) return res.status(404).json({ error: 'Study code not found' });

    // Get the patient's session for additional context
    const session = await getSession(result.patient_id);

    res.json({
      study_code: result.study_code,
      patient_id: result.patient_id,
      created_at: result.created_at,
      language: session.language || 'en',
      chronic_conditions: (session.chronicConditions || []).map(c => c.label_en),
      has_location: !!session.location,
    });
  } catch (e) {
    res.status(500).json({ error: 'Server error' });
  }
});

// GET /api/study-codes — List all study codes (paginated)
app.get('/api/study-codes', requireDashboardAuth, async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('study_codes')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(parseInt(req.query.limit) || 100);

    if (error) throw error;
    res.json({ codes: data, total: data ? data.length : 0 });
  } catch (e) {
    res.status(500).json({ error: 'Server error' });
  }
});

// GET /api/study-codes/patient/:patientId — Get study code for a patient
app.get('/api/study-codes/patient/:patientId', requireDashboardAuth, async (req, res) => {
  try {
    const { data } = await supabase
      .from('study_codes')
      .select('*')
      .eq('patient_id', req.params.patientId)
      .limit(1);

    if (!data || data.length === 0) return res.status(404).json({ error: 'No study code for this patient' });
    res.json(data[0]);
  } catch (e) {
    res.status(500).json({ error: 'Server error' });
  }
});

// ================================================================

};
