'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { app, dialog } = require('electron');

const log = require('./logger').create('fskin');
const store = require('./store');

const TOKENS = ['bg', 'bgElev', 'bgSunken', 'fg', 'fgDim', 'accent', 'accentFg', 'border', 'shadow', 'radius', 'tabBg', 'tabActive', 'titlebar', 'danger'];

const BUILTIN = [
  {
    id: 'default',
    name: '默认',
    author: 'FNOS',
    builtin: true,
    tokens: {
      light: { bg: '#f6f7f9', bgElev: '#ffffff', bgSunken: '#eceef2', fg: '#16202b', fgDim: '#6b7684', accent: '#2f7cf6', accentFg: '#ffffff', border: 'rgba(15,23,32,.1)', shadow: '0 12px 32px rgba(15,23,32,.12)', radius: '12px', tabBg: 'rgba(15,23,32,.05)', tabActive: '#ffffff', titlebar: 'rgba(246,247,249,.86)', danger: '#e0453b' },
      dark: { bg: '#161a20', bgElev: '#1e242c', bgSunken: '#12161b', fg: '#e8edf3', fgDim: '#93a0af', accent: '#4b8ef7', accentFg: '#ffffff', border: 'rgba(255,255,255,.1)', shadow: '0 16px 40px rgba(0,0,0,.45)', radius: '12px', tabBg: 'rgba(255,255,255,.06)', tabActive: '#2a323c', titlebar: 'rgba(22,26,32,.86)', danger: '#ff6b60' }
    }
  },
  {
    id: 'glass',
    name: '磨砂玻璃',
    author: 'FNOS',
    builtin: true,
    blur: true,
    tokens: {
      light: { bg: 'rgba(243,246,250,.72)', bgElev: 'rgba(255,255,255,.66)', bgSunken: 'rgba(236,240,246,.6)', fg: '#101a24', fgDim: '#5f6b79', accent: '#3b82f6', accentFg: '#ffffff', border: 'rgba(15,23,32,.08)', shadow: '0 18px 46px rgba(15,23,32,.16)', radius: '16px', tabBg: 'rgba(15,23,32,.05)', tabActive: 'rgba(255,255,255,.78)', titlebar: 'rgba(243,246,250,.55)', danger: '#e0453b' },
      dark: { bg: 'rgba(18,22,28,.74)', bgElev: 'rgba(32,39,48,.68)', bgSunken: 'rgba(12,15,20,.6)', fg: '#eaf0f7', fgDim: '#94a1b0', accent: '#5b9bff', accentFg: '#ffffff', border: 'rgba(255,255,255,.12)', shadow: '0 22px 54px rgba(0,0,0,.5)', radius: '16px', tabBg: 'rgba(255,255,255,.07)', tabActive: 'rgba(255,255,255,.14)', titlebar: 'rgba(18,22,28,.55)', danger: '#ff6b60' }
    }
  },
  {
    id: 'midnight',
    name: '午夜深蓝',
    author: 'FNOS',
    builtin: true,
    tokens: {
      light: { bg: '#eef2fb', bgElev: '#ffffff', bgSunken: '#e3e9f7', fg: '#101a33', fgDim: '#5c6883', accent: '#3557d6', accentFg: '#ffffff', border: 'rgba(16,26,51,.1)', shadow: '0 12px 32px rgba(16,26,51,.14)', radius: '10px', tabBg: 'rgba(16,26,51,.05)', tabActive: '#ffffff', titlebar: 'rgba(238,242,251,.86)', danger: '#d9453c' },
      dark: { bg: '#0d1424', bgElev: '#152036', bgSunken: '#0a101c', fg: '#e6ecf9', fgDim: '#8f9db8', accent: '#6f8dff', accentFg: '#0b1020', border: 'rgba(255,255,255,.09)', shadow: '0 18px 44px rgba(0,0,0,.55)', radius: '10px', tabBg: 'rgba(255,255,255,.05)', tabActive: '#1d2b47', titlebar: 'rgba(13,20,36,.9)', danger: '#ff6b60' }
    }
  }
];

function skinsDir() {
  const dir = path.join(app.getPath('userData'), 'skins');
  try { fs.mkdirSync(dir, { recursive: true }); } catch (err) { /* ignore */ }
  return dir;
}

function sanitize(source) {
  const out = {};
  for (const key of TOKENS) {
    const value = source && source[key];
    if (typeof value !== 'string') continue;
    if (value.length > 400) continue;
    if (/[;{}<>]/.test(value)) continue;
    out[key] = value;
  }
  return out;
}

function normalize(raw, fallbackId) {
  const pack = raw && typeof raw === 'object' ? raw : {};
  const tokens = pack.tokens && typeof pack.tokens === 'object' ? pack.tokens : pack;
  const light = sanitize(tokens.light || tokens);
  const dark = sanitize(tokens.dark || tokens);
  if (!Object.keys(light).length && !Object.keys(dark).length) return null;
  return {
    id: String(pack.id || fallbackId || ('skin-' + Date.now().toString(36))).replace(/[^A-Za-z0-9_-]/g, ''),
    name: String(pack.name || '自定义皮肤').slice(0, 40),
    author: String(pack.author || '未知').slice(0, 40),
    version: String(pack.version || '1.0').slice(0, 16),
    blur: !!pack.blur,
    wallpaper: typeof pack.wallpaper === 'string' && /^(data:image\/|https?:\/\/)/i.test(pack.wallpaper) ? pack.wallpaper : '',
    tokens: { light, dark }
  };
}

function readPackFile(file) {
  try {
    const raw = JSON.parse(fs.readFileSync(file, 'utf8'));
    return normalize(raw, path.basename(file, '.fskin'));
  } catch (err) {
    return null;
  }
}

function list() {
  const rows = BUILTIN.map((item) => ({ id: item.id, name: item.name, author: item.author, builtin: true }));
  let files = [];
  try {
    files = fs.readdirSync(skinsDir()).filter((name) => /\.fskin$/i.test(name));
  } catch (err) { files = []; }
  for (const name of files) {
    const pack = readPackFile(path.join(skinsDir(), name));
    if (pack) rows.push({ id: pack.id, name: pack.name, author: pack.author, builtin: false, file: path.join(skinsDir(), name) });
  }
  const current = store.getSettings().skinId || 'default';
  return { skins: rows, current };
}

function resolve(id) {
  const key = String(id || 'default');
  const builtin = BUILTIN.find((item) => item.id === key);
  if (builtin) return builtin;
  try {
    const files = fs.readdirSync(skinsDir()).filter((name) => /\.fskin$/i.test(name));
    for (const name of files) {
      const pack = readPackFile(path.join(skinsDir(), name));
      if (pack && pack.id === key) return pack;
    }
  } catch (err) { /* ignore */ }
  return BUILTIN[0];
}

function current() {
  const id = store.getSettings().skinId || 'default';
  const pack = resolve(id);
  return {
    id: pack.id,
    name: pack.name,
    blur: !!pack.blur,
    wallpaper: pack.wallpaper || '',
    tokens: pack.tokens || { light: {}, dark: {} }
  };
}

function apply(id) {
  const pack = resolve(id);
  if (!pack) return { ok: false, error: '皮肤不存在' };
  store.patchSettings({ skinId: pack.id });
  log.info('皮肤已切换', pack.id);
  return { ok: true, skin: current() };
}

async function importPack(win) {
  const target = win || null;
  const result = await dialog.showOpenDialog(target, {
    title: '导入皮肤包',
    filters: [{ name: 'FNOS 皮肤包', extensions: ['fskin', 'json'] }],
    properties: ['openFile']
  });
  if (result.canceled || !result.filePaths.length) return { ok: false, canceled: true };
  const file = result.filePaths[0];
  const pack = readPackFile(file);
  if (!pack) return { ok: false, error: '皮肤包格式无效，需为包含 tokens 的 .fskin(JSON) 文件' };
  const dest = path.join(skinsDir(), pack.id + '.fskin');
  try {
    fs.copyFileSync(file, dest);
  } catch (err) {
    return { ok: false, error: '写入皮肤目录失败：' + ((err && err.message) || '') };
  }
  log.info('皮肤已导入', dest);
  return { ok: true, skin: { id: pack.id, name: pack.name, author: pack.author }, list: list() };
}

async function exportPack(win) {
  const target = win || null;
  const pack = resolve(store.getSettings().skinId || 'default');
  const result = await dialog.showSaveDialog(target, {
    title: '导出当前皮肤',
    defaultPath: (pack.name || 'skin') + '.fskin',
    filters: [{ name: 'FNOS 皮肤包', extensions: ['fskin'] }]
  });
  if (result.canceled || !result.filePath) return { ok: false, canceled: true };
  try {
    fs.writeFileSync(result.filePath, JSON.stringify({
      id: pack.id, name: pack.name, author: pack.author, version: pack.version || '1.0',
      blur: !!pack.blur, wallpaper: pack.wallpaper || '', tokens: pack.tokens
    }, null, 2), 'utf8');
    return { ok: true, file: result.filePath };
  } catch (err) {
    return { ok: false, error: '导出失败：' + ((err && err.message) || '') };
  }
}

function remove(id) {
  const key = String(id || '');
  if (!key) return { ok: false, error: '缺少皮肤标识' };
  if (BUILTIN.some((item) => item.id === key)) return { ok: false, error: '内置皮肤不可删除' };
  try {
    const file = path.join(skinsDir(), key + '.fskin');
    if (fs.existsSync(file)) fs.unlinkSync(file);
  } catch (err) {
    return { ok: false, error: '删除失败：' + ((err && err.message) || '') };
  }
  if (store.getSettings().skinId === key) store.patchSettings({ skinId: 'default' });
  return { ok: true, list: list(), skin: current() };
}

module.exports = { list, current, apply, importPack, exportPack, remove, TOKENS };
