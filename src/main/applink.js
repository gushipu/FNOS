'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { app, shell } = require('electron');

const log = require('./logger').create('applink');
const store = require('./store');

const ARG_APP = '--fnos-app=';
const ARG_SERVER = '--fnos-server=';

function parseArgv(argv) {
  const list = Array.isArray(argv) ? argv : [];
  let appUrl = '';
  let serverId = '';
  for (const item of list) {
    if (typeof item !== 'string') continue;
    if (item.startsWith(ARG_APP)) appUrl = item.slice(ARG_APP.length).replace(/^"|"$/g, '');
    else if (item.startsWith(ARG_SERVER)) serverId = item.slice(ARG_SERVER.length).replace(/^"|"$/g, '');
  }
  if (appUrl && !/^https?:\/\//i.test(appUrl)) appUrl = '';
  const out = { appUrl, serverId, type: appUrl ? 'app' : '', url: appUrl, path: '/v', name: '', server: serverId };
  if (appUrl) {
    try {
      const parsed = new URL(appUrl);
      out.path = (parsed.pathname || '/v') + (parsed.search || '');
    } catch (err) {
      out.path = '/v';
    }
  }
  return out;
}

function defaultDir() {
  try {
    return app.getPath('desktop');
  } catch (err) {
    return app.getPath('home');
  }
}

function safeName(name) {
  const value = String(name || 'FNOS 应用').replace(/[\\/:*?"<>|]/g, ' ').trim();
  return (value || 'FNOS 应用').slice(0, 60);
}

function create(input) {
  const active = store.activeServer();
  const serverId = String((input && input.serverId) || (active && active.id) || '');
  const name = safeName(input && input.name);
  const explicitUrl = String((input && input.url) || '').trim();
  const baseUrl = explicitUrl || (active ? String(active.url || '').replace(/\/+$/, '') + '/v' : '');
  const url = /^https?:\/\//i.test(baseUrl) ? baseUrl : '';
  const target = process.execPath;
  const args = url
    ? `${ARG_APP}"${url}" ${ARG_SERVER}"${serverId}"`
    : '';
  const dir = String((input && input.dir) || defaultDir());
  try {
    fs.mkdirSync(dir, { recursive: true });
  } catch (err) { /* ignore */ }

  if (process.platform === 'win32') {
    const file = path.join(dir, name + '.lnk');
    const icon = (input && input.icon) || process.execPath;
    const done = shell.writeShortcutLink(file, 'create', {
      target,
      args,
      cwd: path.dirname(target),
      icon: icon + ',0',
      iconIndex: 0,
      description: name + ' - FNOS 应用快捷方式',
      appUserModelId: 'com.gushipu.fnos'
    });
    if (!done) return { ok: false, error: '创建快捷方式失败，请检查桌面写入权限' };
    log.info('已创建应用快捷方式', file);
    return { ok: true, file };
  }

  if (process.platform === 'darwin') {
    const file = path.join(dir, name + '.command');
    try {
      fs.writeFileSync(file, `#!/bin/bash\nopen -a "${target}" --args ${args}\n`, { mode: 0o755 });
      return { ok: true, file };
    } catch (err) {
      return { ok: false, error: (err && err.message) || '创建快捷方式失败' };
    }
  }

  const file = path.join(dir, name + '.desktop');
  try {
    fs.writeFileSync(file, [
      '[Desktop Entry]',
      'Type=Application',
      'Name=' + name,
      'Exec="' + target + '" ' + args,
      'Terminal=false',
      'Categories=Network;'
    ].join('\n'), { mode: 0o755 });
    return { ok: true, file };
  } catch (err) {
    return { ok: false, error: (err && err.message) || '创建快捷方式失败' };
  }
}

/* ---------------- P1-6 应用清单 + 图标离线缓存 ---------------- */
const APPS_FILE = 'apps.json';
const MAX_ICON_BYTES = 2 * 1024 * 1024;

function appsFile() {
  return path.join(app.getPath('userData'), APPS_FILE);
}

function iconDir() {
  const root = path.join(app.getPath('userData'), 'assets', 'apps');
  try { fs.mkdirSync(root, { recursive: true }); } catch (err) { /* ignore */ }
  return root;
}

function readApps() {
  try {
    const file = appsFile();
    if (!fs.existsSync(file)) return [];
    const data = JSON.parse(fs.readFileSync(file, 'utf8'));
    return Array.isArray(data) ? data : [];
  } catch (err) {
    return [];
  }
}

function writeApps(list) {
  try {
    fs.writeFileSync(appsFile(), JSON.stringify(list, null, 2), 'utf8');
    return true;
  } catch (err) {
    log.error('应用清单写入失败', err && err.message);
    return false;
  }
}

function appKey(appId) {
  return String(appId || 'app').replace(/[^\w.\-]+/g, '_').slice(0, 64) || 'app';
}

function iconDataUrl(file) {
  try {
    if (!file || !fs.existsSync(file)) return '';
    const stat = fs.statSync(file);
    if (stat.size > 512 * 1024) return '';
    const ext = path.extname(file).toLowerCase();
    const mime = ext === '.jpg' || ext === '.jpeg' ? 'image/jpeg' : ext === '.svg' ? 'image/svg+xml' : 'image/png';
    return `data:${mime};base64,` + fs.readFileSync(file).toString('base64');
  } catch (err) {
    return '';
  }
}

/* 记录一个应用入口：地址 + 名称 + 图标，断网时也能从本地清单渲染宫格 */
function record(input) {
  const payload = input || {};
  const url = String(payload.url || '').trim();
  const appId = String(payload.appId || payload.id || url).trim();
  if (!appId || !/^https?:\/\//i.test(url)) return { ok: false, error: '应用地址无效' };
  const active = store.activeServer();
  const list = readApps();
  const found = list.find((row) => row.appId === appId);
  const row = {
    appId,
    name: safeName(payload.name || payload.appName || ''),
    url,
    serverId: String(payload.serverId || (active && active.id) || ''),
    nasAddress: String(payload.nasAddress || (active && active.url) || ''),
    iconPath: found ? found.iconPath || '' : '',
    updatedAt: Date.now()
  };
  if (found) Object.assign(found, row);
  else list.unshift(row);
  writeApps(list.slice(0, 500));
  return { ok: true, app: row };
}

function saveIcon(appId, dataUrl) {
  const raw = String(dataUrl || '');
  const m = raw.match(/^data:image\/(png|jpe?g|svg\+xml|webp);base64,(.+)$/i);
  if (!m) return { ok: false, error: '图标数据无效' };
  const body = m[2];
  if (body.length > MAX_ICON_BYTES) return { ok: false, error: '图标过大（超过 2MB）' };
  const ext = /jpe?g/i.test(m[1]) ? 'jpg' : /svg/i.test(m[1]) ? 'svg' : /webp/i.test(m[1]) ? 'webp' : 'png';
  try {
    const file = path.join(iconDir(), appKey(appId) + '.' + ext);
    for (const name of fs.readdirSync(iconDir())) {
      if (name.startsWith(appKey(appId) + '.')) {
        try { fs.unlinkSync(path.join(iconDir(), name)); } catch (err) { /* ignore */ }
      }
    }
    fs.writeFileSync(file, Buffer.from(body, 'base64'));
    const list = readApps();
    const found = list.find((row) => row.appId === appId);
    if (found) {
      found.iconPath = file;
      found.updatedAt = Date.now();
      writeApps(list);
    }
    return { ok: true, iconPath: file };
  } catch (err) {
    return { ok: false, error: (err && err.message) || '图标写入失败' };
  }
}

function listApps() {
  const list = readApps().map((row) => {
    const exists = !!(row.iconPath && fs.existsSync(row.iconPath));
    return {
      appId: row.appId,
      name: row.name,
      url: row.url,
      serverId: row.serverId,
      nasAddress: row.nasAddress,
      updatedAt: row.updatedAt || 0,
      hasIcon: exists,
      icon: exists ? iconDataUrl(row.iconPath) : ''
    };
  });
  return list.sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
}

function removeApp(appId) {
  const key = String(appId || '');
  if (!key) return { ok: false, error: '缺少应用标识' };
  const list = readApps();
  const rest = list.filter((row) => row.appId !== key);
  writeApps(rest);
  try {
    for (const name of fs.readdirSync(iconDir())) {
      if (name.startsWith(appKey(key) + '.')) fs.unlinkSync(path.join(iconDir(), name));
    }
  } catch (err) { /* ignore */ }
  return { ok: true };
}

async function pickDir(win) {
  const { dialog } = require('electron');
  const result = await dialog.showOpenDialog(win || null, {
    title: '选择快捷方式保存位置',
    properties: ['openDirectory', 'createDirectory']
  });
  if (result.canceled || !result.filePaths.length) return { ok: false, canceled: true };
  return { ok: true, dir: result.filePaths[0] };
}

function info() {
  const active = store.activeServer();
  return {
    enabled: store.getSettings().appShortcuts !== false,
    dir: defaultDir(),
    exePath: process.execPath,
    serverId: active ? active.id : '',
    serverUrl: active ? String(active.url || '') : '',
    platform: process.platform,
    supported: process.platform === 'win32' || process.platform === 'darwin' || process.platform === 'linux'
  };
}

module.exports = {
  parseArgv, create, pickDir, info, ARG_APP, ARG_SERVER,
  record, saveIcon, listApps, removeApp, iconDir, appsFile
};
