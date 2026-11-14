'use strict';

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { app } = require('electron');

const secure = require('./secure');
const log = require('./logger').create('store');

const DEFAULTS = {
  version: 2,
  servers: [],
  activeServerId: '',
  settings: {
    theme: 'system',
    restoreTabs: true,
    closeAction: 'quit',
    downloadDir: '',
    askDownloadPath: false,
    openLinkInTab: true,
    externalBrowserForLinks: false,

    /* 外观 */
    skinId: 'default',
    roundedCorners: true,
    blurTitlebar: true,
    accent: '',

    /* 性能兼容 */
    gpuCompatible: false,

    /* 播放内核 */
    mpvEnabled: true,
    mpvPath: '',
    mpvEmbed: false,
    mpvExtraArgs: '',
    sniffMedia: true,

    /* 直播 */
    liveEnabled: true,
    livePlaylist: '',
    liveLastChannel: '',
    liveEpgUrl: '',

    /* 下载中心 */
    downloadNotify: true,
    maxConcurrentDownloads: 3,

    /* 安全 */
    lockEnabled: false,
    lockOnStart: false,
    lockIdleMinutes: 0,
    lockPassword: null,
    bossKeyEnabled: true,
    bossKey: 'Control+Shift+H',

    /* 全局快捷键 */
    shortcuts: {
      newTab: 'Control+T',
      closeTab: 'Control+W',
      reload: 'Control+R',
      reopenTab: 'Control+Shift+T',
      downloads: 'Control+J',
      live: 'Control+Shift+L',
      lock: 'Control+Shift+L+Alt',
      boss: 'Control+Shift+H'
    },

    /* 应用快捷方式 */
    appShortcuts: true,

    /* 更新 */
    autoCheckUpdate: true,
    lastUpdateCheck: 0
  },
  window: { x: null, y: null, width: 1360, height: 860, maximized: false },
  session: { tabs: [] },
  downloads: [],
  live: { sources: [], favorites: [] },
  vault: ''
};

let state = JSON.parse(JSON.stringify(DEFAULTS));
let configFile = '';
let vault = {};

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
    log.error('读取配置失败，使用默认配置', err && err.message);
  }
  if (!Array.isArray(state.servers)) state.servers = [];
  if (!state.settings || typeof state.settings !== 'object') state.settings = deepCopy(DEFAULTS.settings);
  if (!Array.isArray(state.downloads)) state.downloads = [];
  if (!state.live || typeof state.live !== 'object') state.live = { sources: [], favorites: [] };
  if (!Array.isArray(state.live.sources)) state.live.sources = [];
  if (!Array.isArray(state.live.favorites)) state.live.favorites = [];
  vault = secure.readBlob(state.vault);
  if (!secure.canEncrypt()) log.warn('系统安全存储不可用，凭据将以明文形式保存在本地配置中');
  return state;
}

function persist() {
  if (!configFile) return;
  const tmp = configFile + '.tmp';
  try {
    state.vault = secure.writeBlob(vault);
    fs.writeFileSync(tmp, JSON.stringify(state, null, 2), 'utf8');
    fs.renameSync(tmp, configFile);
  } catch (err) {
    log.error('保存配置失败', err && err.message);
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

function findServer(id) {
  return state.servers.find((item) => item.id === id) || null;
}

function partitionOf(id) {
  const key = String(id || '').replace(/[^A-Za-z0-9_-]/g, '');
  return key ? `persist:fnos-${key}` : 'persist:fnos-guest';
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
    host = new URL(url).host;
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
  const server = findServer(id);
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
  if (vault[id]) {
    delete vault[id];
    persist();
  }
  const changed = before !== state.servers.length;
  if (changed) persist();
  return { ok: changed, servers: state.servers };
}

function setActiveServer(id) {
  const server = findServer(id);
  if (!server) return { ok: false, error: '记录不存在' };
  server.lastUsedAt = Date.now();
  state.activeServerId = server.id;
  persist();
  return { ok: true, server };
}

function activeServer() {
  if (!state.activeServerId) return null;
  return findServer(state.activeServerId);
}

/* ---------- 凭据保险箱（safeStorage 加密） ---------- */

function vaultGet(id) {
  const row = vault[id];
  if (!row || typeof row !== 'object') return { username: '', password: '' };
  return { username: String(row.username || ''), password: String(row.password || '') };
}

function vaultSet(id, data) {
  if (!id) return { ok: false, error: '缺少服务器标识' };
  const username = String((data && data.username) || '');
  const password = String((data && data.password) || '');
  if (!username && !password) {
    delete vault[id];
  } else {
    vault[id] = { username, password, at: Date.now() };
  }
  persist();
  return { ok: true, encrypted: secure.canEncrypt() };
}

function vaultClear(id) {
  if (!id) {
    vault = {};
  } else {
    delete vault[id];
  }
  persist();
  return { ok: true };
}

function vaultStatus() {
  return { supported: secure.canEncrypt(), count: Object.keys(vault).length };
}

/* ---------- 会话 / 窗口 ---------- */

function saveSessionTabs(list) {
  const rows = Array.isArray(list) ? list : [];
  state.session = {
    tabs: rows.filter((row) => row && typeof row.url === 'string' && /^https?:\/\//i.test(row.url))
      .slice(0, 40)
      .map((row) => ({
        url: row.url,
        title: String(row.title || ''),
        kind: row.kind === 'app' ? 'app' : 'web',
        serverId: String(row.serverId || state.activeServerId || '')
      }))
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

/* ---------- 下载历史 ---------- */

function saveDownloads(list) {
  state.downloads = (Array.isArray(list) ? list : []).slice(0, 500);
  persist();
}

function readDownloads() {
  return Array.isArray(state.downloads) ? state.downloads.slice() : [];
}

/* ---------- 直播 ---------- */

function readLive() {
  return deepCopy(state.live);
}

function saveLive(patch) {
  state.live = merge(state.live, patch || {});
  persist();
  return deepCopy(state.live);
}

module.exports = {
  init, persist, get, getSettings, patchSettings,
  normalizeUrl, listServers, findServer, partitionOf,
  addServer, updateServer, removeServer, setActiveServer, activeServer,
  vaultGet, vaultSet, vaultClear, vaultStatus,
  saveSessionTabs, readSessionTabs, saveWindowState,
  saveDownloads, readDownloads, readLive, saveLive,
  DEFAULTS
};
