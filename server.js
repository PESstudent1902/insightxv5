'use strict';

const express = require('express');
const cookieParser = require('cookie-parser');
const crypto = require('crypto');
const path = require('path');
const fs = require('fs');
const { buildDb } = require('./lib/db');

const app = express();
const PORT = process.env.PORT || 3000;

// Config
const ADMIN_USER = process.env.ADMIN_USER || 'volunteer';
const ADMIN_PASS = process.env.ADMIN_PASS || 'F404Admin2024';
const COOKIE_SECRET = process.env.COOKIE_SECRET || crypto.randomBytes(32).toString('hex');
const LOCAL_STORE = path.join(process.cwd(), '.f404-store.json');

// Layer unlock schedule (minutes after game start)
const LAYER_SCHEDULE = {
  '1': 0,
  '2': 30,
  '2B': 30,
  '3': 60,
  '4': 90,
  '5': 120,
  '6': 150,
  '7': 180,
};

// Layer -> table mapping
const LAYER_TABLES = {
  '1': ['flight_telemetry'],
  '2': ['passenger_manifest'],
  '2B': ['passport_database'],
  '3': ['fuel_logs'],
  '4': ['atc_logs'],
  '5': ['insurance_claims'],
  '6': ['cargo_cctv'],
  '7': ['medical_examiner'],
};

const ALL_LAYERS = ['1', '2', '2B', '3', '4', '5', '6', '7'];

// ─── State persistence ────────────────────────────────────────────────────────

function defaultState() {
  return {
    startedAt: null,     // ISO string of when game clock was started
    clockOffset: 0,      // minutes added/subtracted from timer
    overrides: {},       // { layerId: 'unlocked' | 'locked' | 'timer' }
    submissions: [],     // [{ team, layer, answer, ts }]
  };
}

async function loadState() {
  if (process.env.KV_REST_API_URL && process.env.KV_REST_API_TOKEN) {
    try {
      const res = await fetch(
        `${process.env.KV_REST_API_URL}/get/f404_state`,
        { headers: { Authorization: `Bearer ${process.env.KV_REST_API_TOKEN}` } }
      );
      const json = await res.json();
      if (json.result) return JSON.parse(json.result);
    } catch (_) {}
  }
  if (fs.existsSync(LOCAL_STORE)) {
    try { return JSON.parse(fs.readFileSync(LOCAL_STORE, 'utf8')); } catch (_) {}
  }
  return defaultState();
}

async function saveState(state) {
  if (process.env.KV_REST_API_URL && process.env.KV_REST_API_TOKEN) {
    try {
      await fetch(
        `${process.env.KV_REST_API_URL}/set/f404_state`,
        {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${process.env.KV_REST_API_TOKEN}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(JSON.stringify(state)),
        }
      );
      return;
    } catch (_) {}
  }
  fs.writeFileSync(LOCAL_STORE, JSON.stringify(state, null, 2));
}

// ─── Database ─────────────────────────────────────────────────────────────────

let db;
(async () => { db = await buildDb(); })();

// ─── Helpers ──────────────────────────────────────────────────────────────────

function sign(value) {
  const hmac = crypto.createHmac('sha256', COOKIE_SECRET);
  hmac.update(value);
  return `${value}.${hmac.digest('hex')}`;
}

function verify(signed) {
  if (!signed) return null;
  const idx = signed.lastIndexOf('.');
  if (idx < 0) return null;
  const value = signed.slice(0, idx);
  return sign(value) === signed ? value : null;
}

function isAdmin(req) {
  return verify(req.cookies && req.cookies.f404_admin) === 'admin';
}

function computeUnlocked(state) {
  if (!state.startedAt) return [];
  const now = Date.now();
  const elapsed = (now - new Date(state.startedAt).getTime()) / 60000 + state.clockOffset;
  return ALL_LAYERS.filter(layer => {
    const ov = state.overrides[layer];
    if (ov === 'unlocked') return true;
    if (ov === 'locked') return false;
    return elapsed >= LAYER_SCHEDULE[layer];
  });
}

function getUnlockedTables(state) {
  const layers = computeUnlocked(state);
  return layers.flatMap(l => LAYER_TABLES[l] || []);
}

// ─── Middleware ───────────────────────────────────────────────────────────────

app.use(express.json());
app.use(cookieParser());
app.use(express.static(path.join(__dirname, 'public')));

// ─── Auth endpoints ───────────────────────────────────────────────────────────

app.post('/api/admin/login', (req, res) => {
  const { username, password } = req.body || {};
  if (username === ADMIN_USER && password === ADMIN_PASS) {
    res.cookie('f404_admin', sign('admin'), { httpOnly: true, sameSite: 'strict' });
    return res.json({ ok: true });
  }
  res.status(401).json({ error: 'Invalid credentials' });
});

app.post('/api/admin/logout', (req, res) => {
  res.clearCookie('f404_admin');
  res.json({ ok: true });
});

app.get('/api/admin/me', (req, res) => {
  res.json({ admin: isAdmin(req) });
});

// ─── Game state ───────────────────────────────────────────────────────────────

app.get('/api/state', async (req, res) => {
  const state = await loadState();
  const unlocked = computeUnlocked(state);
  res.json({
    startedAt: state.startedAt,
    clockOffset: state.clockOffset,
    unlocked,
    layers: ALL_LAYERS.map(id => ({
      id,
      name: LAYER_TABLES[id].join(', '),
      unlockMinutes: LAYER_SCHEDULE[id],
      override: state.overrides[id] || 'timer',
      isUnlocked: unlocked.includes(id),
    })),
  });
});

// ─── Admin game controls ──────────────────────────────────────────────────────

function adminOnly(req, res, next) {
  if (!isAdmin(req)) return res.status(403).json({ error: 'Forbidden' });
  next();
}

app.post('/api/admin/start', adminOnly, async (req, res) => {
  const state = await loadState();
  state.startedAt = new Date().toISOString();
  state.clockOffset = 0;
  state.overrides = {};
  await saveState(state);
  res.json({ ok: true, startedAt: state.startedAt });
});

app.post('/api/admin/unlock/:layer', adminOnly, async (req, res) => {
  const { layer } = req.params;
  if (!ALL_LAYERS.includes(layer)) return res.status(400).json({ error: 'Unknown layer' });
  const state = await loadState();
  state.overrides[layer] = 'unlocked';
  await saveState(state);
  res.json({ ok: true });
});

app.post('/api/admin/lock/:layer', adminOnly, async (req, res) => {
  const { layer } = req.params;
  if (!ALL_LAYERS.includes(layer)) return res.status(400).json({ error: 'Unknown layer' });
  const state = await loadState();
  state.overrides[layer] = 'locked';
  await saveState(state);
  res.json({ ok: true });
});

app.post('/api/admin/revert/:layer', adminOnly, async (req, res) => {
  const { layer } = req.params;
  if (!ALL_LAYERS.includes(layer)) return res.status(400).json({ error: 'Unknown layer' });
  const state = await loadState();
  delete state.overrides[layer];
  await saveState(state);
  res.json({ ok: true });
});

app.post('/api/admin/shift-clock', adminOnly, async (req, res) => {
  const minutes = Number(req.body && req.body.minutes);
  if (!Number.isFinite(minutes)) return res.status(400).json({ error: 'minutes must be a number' });
  const state = await loadState();
  state.clockOffset = (state.clockOffset || 0) + minutes;
  await saveState(state);
  res.json({ ok: true, clockOffset: state.clockOffset });
});

app.post('/api/admin/unlock-all', adminOnly, async (req, res) => {
  const state = await loadState();
  ALL_LAYERS.forEach(l => { state.overrides[l] = 'unlocked'; });
  await saveState(state);
  res.json({ ok: true });
});

app.post('/api/admin/lock-all', adminOnly, async (req, res) => {
  const state = await loadState();
  ALL_LAYERS.forEach(l => { state.overrides[l] = 'locked'; });
  await saveState(state);
  res.json({ ok: true });
});

app.post('/api/admin/reset', adminOnly, async (req, res) => {
  const fresh = defaultState();
  await saveState(fresh);
  res.json({ ok: true });
});

// ─── Submissions ──────────────────────────────────────────────────────────────

app.post('/api/submit', async (req, res) => {
  const { team, answer } = req.body || {};
  if (!team || !answer) return res.status(400).json({ error: 'team and answer required' });
  const state = await loadState();
  state.submissions.push({ team, answer, ts: new Date().toISOString() });
  await saveState(state);
  res.json({ ok: true });
});

app.get('/api/admin/submissions', adminOnly, async (req, res) => {
  const state = await loadState();
  res.json(state.submissions);
});

app.get('/api/admin/export-csv', adminOnly, async (req, res) => {
  const state = await loadState();
  const rows = [
    ['Team', 'Answer', 'Timestamp'],
    ...state.submissions.map(s => [s.team, s.answer, s.ts]),
  ];
  const csv = rows.map(r => r.map(v => `"${String(v).replace(/"/g, '""')}"`).join(',')).join('\r\n');
  res.setHeader('Content-Type', 'text/csv');
  res.setHeader('Content-Disposition', 'attachment; filename="f404-submissions.csv"');
  res.send(csv);
});

// ─── SQL query ────────────────────────────────────────────────────────────────

// DML / DDL keywords that must never appear in participant queries
const FORBIDDEN_KEYWORDS = /\b(INSERT|UPDATE|DELETE|DROP|CREATE|ALTER|ATTACH|DETACH|PRAGMA|VACUUM|REINDEX|SAVEPOINT|RELEASE|ROLLBACK|COMMIT|BEGIN)\b/i;

app.post('/api/query', async (req, res) => {
  if (!db) return res.status(503).json({ error: 'Database not ready' });
  const { sql: query } = req.body || {};
  if (!query || typeof query !== 'string') return res.status(400).json({ error: 'sql required' });

  const trimmed = query.trim();

  // Must start with SELECT
  if (!/^SELECT\b/i.test(trimmed)) {
    return res.status(400).json({ error: 'Only SELECT queries are allowed' });
  }

  // Reject any DML / DDL keywords anywhere in the query (covers subqueries)
  if (FORBIDDEN_KEYWORDS.test(trimmed)) {
    return res.status(400).json({ error: 'Only SELECT queries are allowed' });
  }

  const state = await loadState();
  const unlockedTables = getUnlockedTables(state);

  // Check that the query only references unlocked tables (word-boundary match)
  const allTables = Object.values(LAYER_TABLES).flat();
  for (const table of allTables) {
    if (!unlockedTables.includes(table)) {
      const pattern = new RegExp(`\\b${table}\\b`, 'i');
      if (pattern.test(trimmed)) {
        return res.status(403).json({ error: `Table "${table}" is not yet unlocked` });
      }
    }
  }

  try {
    const stmt = db.prepare(trimmed);
    const results = [];
    while (stmt.step()) {
      results.push(stmt.getAsObject());
    }
    stmt.free();
    res.json({ rows: results });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// ─── Start ────────────────────────────────────────────────────────────────────

app.listen(PORT, () => {
  console.log(`Flight 404 server running on http://localhost:${PORT}`);
  console.log(`Admin panel: http://localhost:${PORT}/admin.html`);
  if (!process.env.ADMIN_PASS) {
    console.warn('[WARN] ADMIN_PASS not set — using default password. Set this env var in production!');
  }
  if (!process.env.COOKIE_SECRET) {
    console.warn('[WARN] COOKIE_SECRET not set — a random secret is used. Admin sessions will not persist across restarts. Set this env var in production!');
  }
});
