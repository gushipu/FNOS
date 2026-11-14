'use strict';

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { app } = require('electron');

const DEFAULTS = {
  version: 1,
  servers: [],
  activeServerId: '',
  settings: {
    theme: 'system',
    restoreTabs: true,
    closeAction: 'quit',
    downloadDir: '',
    askDownloadPath: false,
    openLinkInTab: true,
    externalBrowserForLinks: false
  },
  window: { x: null, y: null, width: 1360, height: 860, maximized: false },
  session: { tabs: [] }
};

let state = JSON.parse(JSON.stringify(DEFAULTS));
let configFile = '';

function deepCopy(value) {
  return value === null || typeof value !== 'object' ? value : JSON.parse(JSON.stringify(value));
}

function merge(base, patch) {
  const out = Array.isArray(base) ? base.slice() : Object.assign({}, base);
  if (!patch || typeof patch !== 'object') return out;
  for (const key of Object.keys(patch)) {
    const incoming = patch[key];
    const current = out[key];
    const bothPlain = incoming && typeof incoming === 'object' && !Array.isArray(incoming)
      && current && typeof current === 'object' && !Array.isArray(current);
    out[key] = bothPlain ? merge(current, incoming) : deepCopy(incoming);
  }
  return out;
}

function init() {
  configFile = path.join(app.getPath('userData'), 'config.json');
  state = deepCopy(DEFAULTS);
  try {
    if (fs.existsSync(configFile)) {
      const raw = JSON.parse(fs.readFileSync(configFile, 'utf8'));
      state = merge(DEFAULTS, raw);
    }
  } catch (err) {
    console.error('[store] 读取配置失败，使用默认配置:', err && err.message);
  }
  if (!Array.isArray(state.servers)) state.servers = [];
  if (!state.settings || typeof state.settings !== 'object') state.settings = deepCopy(DEFAULTS.settings);
  return state;
}

function persist() {
  if (!configFile) return;
  const tmp = configFile + '.tmp';
  try {
    fs.writeFileSync(tmp, JSON.stringify(state, null, 2), 'utf8');
    fs.renameSync(tmp, configFile);
  } catch (err) {
    console.error('[store] 保存配置失败:', err && err.message);
  }
}

function get() {
  return state;
}

function getSettings() {
  return state.settings;
}

function patchSettings(patch) {
  state.settings = merge(state.settings, patch || {});
  persist();
  return state.settings;
}

function normalizeUrl(input) {
  let value = String(input || '').trim();
  if (!value) return '';
  if (!/^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//.test(value)) value = 'http://' + value;
  let url;
  try {
    url = new URL(value);
  } catch (err) {
    return '';
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return '';
  if (!url.port && url.protocol === 'http:') url.port = '5666';
  url.hash = '';
  let href = url.toString();
  if (href.endsWith('/')) href = href.slice(0, -1);
  return href;
}

function listServers() {
  return state.servers.slice();
}

function addServer(input) {
  const url = normalizeUrl(input && input.url);
  if (!url) return { ok: false, error: '地址无效，请填写形如 192.168.1.10 或 http://192.168.1.10:5666 的地址' };
  const existing = state.servers.find((item) => item.url === url);
  if (existing) {
    setActiveServer(existing.id);
    return { ok: true, server: existing, existed: true };
  }
  let host = url;
  try {
    const parsed = new URL(url);
    host = parsed.host;
  } catch (err) { /* 保留原值 */ }
  const name = String((input && input.name) || '').trim() || host;
  const server = {
    id: crypto.randomUUID(),
    name,
    url,
    createdAt: Date.now(),
    lastUsedAt: Date.now()
  };
  state.servers.unshift(server);
  state.activeServerId = server.id;
  persist();
  return { ok: true, server, existed: false };
}

function updateServer(id, patch) {
  const server = state.servers.find((item) => item.id === id);
  if (!server) return { ok: false, error: '记录不存在' };
  if (patch && patch.name) server.name = String(patch.name).trim() || server.name;
  if (patch && patch.url) {
    const url = normalizeUrl(patch.url);
    if (!url) return { ok: false, error: '地址无效' };
    server.url = url;
  }
  persist();
  return { ok: true, server };
}

function removeServer(id) {
  const before = state.servers.length;
  state.servers = state.servers.filter((item) => item.id !== id);
  if (state.activeServerId === id) {
    state.activeServerId = state.servers.length ? state.servers[0].id : '';
  }
  const changed = before !== state.servers.length;
  if (changed) persist();
  return { ok: changed, servers: state.servers };
}

function setActiveServer(id) {
  const server = state.servers.find((item) => item.id === id);
  if (!server) return { ok: false, error: '记录不存在' };
  server.lastUsedAt = Date.now();
  state.activeServerId = server.id;
  persist();
  return { ok: true, server };
}

function activeServer() {
  if (!state.activeServerId) return null;
  return state.servers.find((item) => item.id === state.activeServerId) || null;
}

function saveSessionTabs(list) {
  const rows = Array.isArray(list) ? list : [];
  state.session = {
    tabs: rows.filter((row) => row && typeof row.url === 'string' && /^https?:\/\//i.test(row.url))
      .slice(0, 40)
      .map((row) => ({ url: row.url, title: String(row.title || ''), kind: row.kind === 'app' ? 'app' : 'web' }))
  };
  persist();
}

function readSessionTabs() {
  return Array.isArray(state.session && state.session.tabs) ? state.session.tabs.slice() : [];
}

function saveWindowState(bounds) {
  if (!bounds) return;
  state.window = {
    x: typeof bounds.x === 'number' ? bounds.x : null,
    y: typeof bounds.y === 'number' ? bounds.y : null,
    width: Math.max(940, Math.round(bounds.width || 1360)),
    height: Math.max(560, Math.round(bounds.height || 860)),
    maximized: !!bounds.maximized
  };
  persist();
}

module.exports = {
  init,
  get,
  getSettings,
  patchSettings,
  normalizeUrl,
  listServers,
  addServer,
  updateServer,
  removeServer,
  setActiveServer,
  activeServer,
  saveSessionTabs,
  readSessionTabs,
  saveWindowState
};
