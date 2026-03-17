'use strict';
/**
 * Crash-proof key-value store.
 * Never throws — always returns null/[] on failure.
 */
const fs   = require('fs');
const path = require('path');

const LOCAL_PATH = path.join(__dirname, '..', '.f404-store.json');
const IS_VERCEL  = !!(process.env.VERCEL);
const HAS_KV     = !!(process.env.KV_REST_API_URL && process.env.KV_REST_API_TOKEN);

// In-memory hot cache — always works, no deps
const mem = new Map();

// Lazy-load kv to avoid module-level crashes
let _kv = null;
function getKV() {
  if (_kv) return _kv;
  if (!HAS_KV) return null;
  try { _kv = require('@vercel/kv'); return _kv; }
  catch { return null; }
}

function readFile() {
  try { return JSON.parse(fs.readFileSync(LOCAL_PATH, 'utf8')); }
  catch { return {}; }
}
function writeFile(data) {
  try { fs.writeFileSync(LOCAL_PATH, JSON.stringify(data, null, 2)); }
  catch { /* read-only on Vercel — ok */ }
}

async function get(key) {
  const kv = getKV();
  if (kv) {
    try { const v = await kv.get(key); if (v !== null && v !== undefined) { mem.set(key, v); return v; } }
    catch { /* fall through */ }
  }
  if (!IS_VERCEL) { const v = readFile()[key]; if (v !== undefined) return v; }
  return mem.get(key) ?? null;
}

async function set(key, value) {
  mem.set(key, value);
  const kv = getKV();
  if (kv) { try { await kv.set(key, value); return; } catch { /* fall through */ } }
  if (!IS_VERCEL) { const s = readFile(); s[key] = value; writeFile(s); }
}

async function del(key) {
  mem.delete(key);
  const kv = getKV();
  if (kv) { try { await kv.del(key); return; } catch { /* fall through */ } }
  if (!IS_VERCEL) { const s = readFile(); delete s[key]; writeFile(s); }
}

async function keys(pattern) {
  const prefix = pattern.replace(/\*/g, '');
  const kv = getKV();
  if (kv) {
    try { return await kv.keys(pattern); }
    catch { /* fall through */ }
  }
  if (!IS_VERCEL) return Object.keys(readFile()).filter(k => k.startsWith(prefix));
  return [...mem.keys()].filter(k => k.startsWith(prefix));
}

async function delpattern(pattern) {
  const ks = await keys(pattern);
  for (const k of ks) await del(k);
}

module.exports = { get, set, del, keys, delpattern };
