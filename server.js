'use strict';
const express      = require('express');
const cookieParser = require('cookie-parser');
const path         = require('path');
const crypto       = require('crypto');

const { LAYERS } = require('./lib/layers');
const store      = require('./lib/store');

const PORT          = process.env.PORT || 3000;
const ADMIN_USER    = process.env.ADMIN_USER    || 'volunteer';
const ADMIN_PASS    = process.env.ADMIN_PASS    || 'F404Admin2024';
const COOKIE_SECRET = process.env.COOKIE_SECRET || 'f404-super-secret-runway-2024';
const COOKIE_NAME   = 'f404_admin';

const app = express();
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser(COOKIE_SECRET));
app.use(express.static(path.join(__dirname, 'public')));

// ── auth ──────────────────────────────────────────────────────
function setAdminCookie(res) {
  const val  = 'admin:' + Date.now();
  const sig  = crypto.createHmac('sha256', COOKIE_SECRET).update(val).digest('base64url');
  res.cookie(COOKIE_NAME, val + '.' + sig, { httpOnly: true, maxAge: 12*60*60*1000, sameSite: 'lax' });
}
function isAdmin(req) {
  const raw = req.cookies?.[COOKIE_NAME] || '';
  const i   = raw.lastIndexOf('.');
  if (i < 0) return false;
  const val = raw.slice(0, i), sig = raw.slice(i + 1);
  const exp = crypto.createHmac('sha256', COOKIE_SECRET).update(val).digest('base64url');
  return sig === exp && val.startsWith('admin:');
}
function requireAdmin(req, res, next) {
  if (isAdmin(req)) return next();
  res.status(401).json({ error: 'Unauthorised' });
}

// ── game helpers ──────────────────────────────────────────────
async function getGameState() {
  try { return await store.get('game:state'); } catch { return null; }
}
async function getLayerStatus(layerId) {
  try {
    const state = await getGameState();
    if (!state || !state.active) return { unlocked: false, unlocksIn: null, manualOverride: false };
    const layer = LAYERS.find(l => l.id === String(layerId));
    if (!layer) return { unlocked: false, unlocksIn: null, manualOverride: false };
    const elapsedMins = (Date.now() - Number(state.start_time)) / 60000;
    const override    = await store.get(`override:${layerId}`);
    const unlocked    = override !== null ? override.force_unlocked === 1 : elapsedMins >= layer.unlockMins;
    const secsLeft    = unlocked ? 0 : Math.ceil((layer.unlockMins - elapsedMins) * 60);
    return { unlocked, unlocksIn: secsLeft, manualOverride: override !== null };
  } catch { return { unlocked: false, unlocksIn: null, manualOverride: false }; }
}

// ── SQL guard ─────────────────────────────────────────────────
function isSafeSelect(sql) {
  const up = sql.trim().toUpperCase();
  if (!up.startsWith('SELECT')) return false;
  return !['DROP','DELETE','UPDATE','INSERT','CREATE','ALTER','ATTACH','PRAGMA'].some(k => up.includes(k));
}

// ── db (lazy — only load when first needed) ───────────────────
let _dbQuery = null;
async function dbQuery(sql) {
  if (!_dbQuery) {
    const { query } = require('./lib/db');
    _dbQuery = query;
  }
  return _dbQuery(sql);
}

// ═══════════════════════════════════════════════════════════
//  PUBLIC ROUTES
// ═══════════════════════════════════════════════════════════

// Health / connectivity check — intentionally minimal, no DB
app.get('/api/health', (req, res) => {
  res.json({ ok: true, ts: Date.now(), env: process.env.VERCEL ? 'vercel' : 'local' });
});

app.get('/api/start', async (req, res) => {
  try {
    let state = await getGameState();
    if (!state) {
      state = { start_time: Date.now(), active: 1 };
      await store.set('game:state', state);
    }
    res.json({ startTime: Number(state.start_time), active: state.active });
  } catch (e) {
    console.error('/api/start error:', e);
    res.status(500).json({ error: e.message });
  }
});

app.get('/api/layers', async (req, res) => {
  try {
    const state  = await getGameState();
    const layers = await Promise.all(LAYERS.map(async layer => {
      const status = await getLayerStatus(layer.id);
      return { ...layer, ...status };
    }));
    res.json({ layers, startTime: state ? Number(state.start_time) : null });
  } catch (e) {
    console.error('/api/layers error:', e);
    res.status(500).json({ error: e.message });
  }
});

app.get('/api/layer/:id/data', async (req, res) => {
  try {
    const layer = LAYERS.find(l => l.id === req.params.id);
    if (!layer) return res.status(404).json({ error: 'Layer not found' });
    const { unlocked } = await getLayerStatus(layer.id);
    if (!unlocked) return res.status(403).json({ error: 'Layer locked' });
    const rows = await dbQuery(`SELECT * FROM "${layer.table}"`);
    res.json({ data: rows, table: layer.table, name: layer.name });
  } catch (e) {
    console.error('/api/layer data error:', e);
    res.status(500).json({ error: e.message });
  }
});

app.post('/api/query', async (req, res) => {
  try {
    const { sql } = req.body;
    if (!sql) return res.status(400).json({ error: 'No query provided.' });
    if (!isSafeSelect(sql)) return res.status(400).json({ error: 'Only SELECT statements are permitted.' });

    // Check tables are unlocked
    const sqlUp = sql.toUpperCase();
    for (const layer of LAYERS) {
      if (sqlUp.includes(layer.table.toUpperCase())) {
        const { unlocked } = await getLayerStatus(layer.id);
        if (!unlocked) return res.status(403).json({ error: `Table not yet unlocked: ${layer.table}` });
      }
    }
    const rows = await dbQuery(sql);
    res.json({ data: rows, rowCount: rows.length });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

app.get('/api/tables', async (req, res) => {
  try {
    const unlocked = [];
    for (const layer of LAYERS) {
      const { unlocked: u } = await getLayerStatus(layer.id);
      if (u) unlocked.push({ id: layer.id, name: layer.name, table: layer.table });
    }
    res.json({ tables: unlocked });
  } catch (e) {
    res.json({ tables: [] });
  }
});

app.post('/api/submit', async (req, res) => {
  try {
    const { team_name, culprit, motive, method, evidence } = req.body;
    if (!team_name || !culprit) return res.status(400).json({ error: 'Team name and culprit are required.' });
    const id = Date.now();
    await store.set(`sub:${id}`, { id, team_name, culprit, motive, method, evidence, submitted_at: id });
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.get('/api/submissions/count', async (req, res) => {
  try {
    const ks = await store.keys('sub:*');
    res.json({ count: ks.length });
  } catch { res.json({ count: 0 }); }
});

// ═══════════════════════════════════════════════════════════
//  ADMIN ROUTES
// ═══════════════════════════════════════════════════════════

app.post('/api/admin/login', (req, res) => {
  const { username, password } = req.body;
  if (username === ADMIN_USER && password === ADMIN_PASS) {
    setAdminCookie(res);
    res.json({ success: true });
  } else {
    res.status(401).json({ error: 'Invalid credentials.' });
  }
});

app.post('/api/admin/logout', (req, res) => {
  res.clearCookie(COOKIE_NAME);
  res.json({ success: true });
});

app.get('/api/admin/check', (req, res) => {
  res.json({ authenticated: isAdmin(req) });
});

app.get('/api/admin/status', requireAdmin, async (req, res) => {
  try {
    const state = await getGameState();
    const subKeys = await store.keys('sub:*');
    const subs = (await Promise.all(subKeys.map(k => store.get(k))))
      .filter(Boolean).sort((a, b) => b.submitted_at - a.submitted_at);
    const layers = await Promise.all(LAYERS.map(async layer => ({
      ...layer, ...await getLayerStatus(layer.id)
    })));
    res.json({ state, submissions: subs, layers });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.post('/api/admin/layer/:id/override', requireAdmin, async (req, res) => {
  try {
    const { force_unlocked } = req.body;
    await store.set(`override:${req.params.id}`, { layer_id: req.params.id, force_unlocked: force_unlocked ? 1 : 0 });
    res.json({ success: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.delete('/api/admin/layer/:id/override', requireAdmin, async (req, res) => {
  try { await store.del(`override:${req.params.id}`); res.json({ success: true }); }
  catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/admin/unlock-all', requireAdmin, async (req, res) => {
  try {
    await store.delpattern('override:*');
    for (const l of LAYERS) await store.set(`override:${l.id}`, { layer_id: l.id, force_unlocked: 1 });
    res.json({ success: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/admin/lock-all', requireAdmin, async (req, res) => {
  try {
    await store.delpattern('override:*');
    for (const l of LAYERS) await store.set(`override:${l.id}`, { layer_id: l.id, force_unlocked: 0 });
    res.json({ success: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/admin/start-time', requireAdmin, async (req, res) => {
  try {
    const t = req.body.startTime || Date.now();
    const existing = await getGameState();
    await store.set('game:state', { ...(existing || {}), start_time: t, active: 1 });
    res.json({ success: true, startTime: t });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/admin/reset', requireAdmin, async (req, res) => {
  try {
    await store.delpattern('override:*');
    await store.delpattern('sub:*');
    const now = Date.now();
    await store.set('game:state', { start_time: now, active: 1 });
    res.json({ success: true, startTime: now });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── start ──────────────────────────────────────────────────────
if (require.main === module) {
  app.listen(PORT, '0.0.0.0', () => {
    console.log(`\n✈  FLIGHT 404 running on http://localhost:${PORT}`);
    console.log(`🔐 Admin panel: http://localhost:${PORT}/admin.html\n`);
    // warm up DB
    require('./lib/db').getDb().catch(console.error);
  });
} else {
  // Vercel — warm up DB in background, don't block cold start
  setImmediate(() => require('./lib/db').getDb().catch(console.error));
}

module.exports = app;
