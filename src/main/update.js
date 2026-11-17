'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { app, net, shell } = require('electron');
const { spawn } = require('node:child_process');

const log = require('./logger').create('update');
const store = require('./store');

const REPO = 'gushipu/FNOS';
const API = `https://api.github.com/repos/${REPO}/releases/latest`;
let downloading = false;

function parseVersion(text) {
  return String(text || '')
    .replace(/^v/i, '')
    .split(/[.+-]/)
    .map((part) => parseInt(part, 10))
    .map((num) => (Number.isFinite(num) ? num : 0));
}

function compareVersion(a, b) {
  const left = parseVersion(a);
  const right = parseVersion(b);
  const len = Math.max(left.length, right.length);
  for (let i = 0; i < len; i += 1) {
    const l = left[i] || 0;
    const r = right[i] || 0;
    if (l > r) return 1;
    if (l < r) return -1;
  }
  return 0;
}

function request(url) {
  return new Promise((resolve, reject) => {
    let req;
    try {
      req = net.request({ method: 'GET', url, redirect: 'follow' });
    } catch (err) {
      reject(err);
      return;
    }
    req.setHeader('User-Agent', 'fnos-client/' + app.getVersion());
    req.setHeader('Accept', 'application/vnd.github+json');
    const timer = setTimeout(() => {
      try { req.abort(); } catch (err) { /* ignore */ }
      reject(new Error('请求超时'));
    }, 15000);
    req.on('response', (response) => {
      let body = '';
      response.on('data', (chunk) => { body += chunk.toString('utf8'); });
      response.on('end', () => {
        clearTimeout(timer);
        if (response.statusCode !== 200) {
          reject(new Error('GitHub 返回 ' + response.statusCode));
          return;
        }
        resolve(body);
      });
    });
    req.on('error', (err) => {
      clearTimeout(timer);
      reject(err);
    });
    req.end();
  });
}

function pickAsset(assets) {
  const list = Array.isArray(assets) ? assets : [];
  const arch = process.arch;
  if (process.platform === 'win32') {
    return list.find((item) => /\.exe$/i.test(item.name) && /setup|installer/i.test(item.name))
      || list.find((item) => /\.exe$/i.test(item.name)) || null;
  }
  if (process.platform === 'darwin') {
    const dmg = list.find((item) => /\.dmg$/i.test(item.name) && new RegExp(arch === 'arm64' ? 'arm64' : 'x64|intel', 'i').test(item.name));
    return dmg || list.find((item) => /\.dmg$/i.test(item.name)) || null;
  }
  return list.find((item) => /\.AppImage$/i.test(item.name)) || null;
}

async function check(options) {
  const opts = options || {};
  try {
    const body = await request(API);
    const data = JSON.parse(body);
    const latest = String(data.tag_name || data.name || '').replace(/^v/i, '');
    const current = app.getVersion();
    const asset = pickAsset(data.assets);
    const payload = {
      ok: true,
      latest,
      current,
      hasUpdate: latest ? compareVersion(latest, current) > 0 : false,
      url: data.html_url || ('https://github.com/' + REPO + '/releases'),
      notes: typeof data.body === 'string' ? data.body.slice(0, 4000) : '',
      asset: asset ? { name: asset.name, url: asset.browser_download_url, size: asset.size } : null,
      checkedAt: Date.now()
    };
    store.patchSettings({ lastUpdateCheck: payload.checkedAt });
    log.info('检查更新完成', { current, latest, hasUpdate: payload.hasUpdate });
    // 发现更新后由渲染层统一弹出「软件更新」窗口（样式与设置界面一致），此处只返回结果
    broadcast('update:available', payload);
    return payload;
  } catch (err) {
    log.error('检查更新失败', err && err.message);
    return { ok: false, error: '检查更新失败：' + ((err && err.message) || '未知错误') };
  }
}

function openReleasePage(url) {
  const target = url || ('https://github.com/' + REPO + '/releases');
  return shell.openExternal(target);
}

function installTargetDir() {
  try {
    const exe = app.getPath('exe');
    return exe ? path.dirname(exe) : '';
  } catch (err) {
    return '';
  }
}

function dirWritable(dir) {
  if (!dir) return false;
  const probe = path.join(dir, '.fnos-write-test.tmp');
  try {
    fs.writeFileSync(probe, 'ok');
    fs.unlinkSync(probe);
    return true;
  } catch (err) {
    return false;
  }
}

function launchSilentSetup(target, dir) {
  const file = target.replace(/'/g, "''");
  const args = (dir ? '/S /D=' + dir : '/S').replace(/'/g, "''");
  const needElevate = !dirWritable(dir);
  const start = needElevate
    ? `Start-Process -FilePath '${file}' -ArgumentList '${args}' -Verb RunAs`
    : `Start-Process -FilePath '${file}' -ArgumentList '${args}'`;
  const script = `Start-Sleep -Milliseconds 1500; ${start}`;
  const child = spawn('powershell.exe', [
    '-NoProfile', '-ExecutionPolicy', 'Bypass', '-WindowStyle', 'Hidden', '-Command', script,
  ], { detached: true, stdio: 'ignore', windowsHide: true });
  child.on('error', () => { /* ignore */ });
  child.unref();
}

function openInstaller(file) {
  const target = String(file || '').trim();
  if (!target) return { ok: false, error: '路径为空' };
  if (!fs.existsSync(target)) return { ok: false, error: '安装包不存在，请重新下载' };
  const silent = process.platform === 'win32' && /\.exe$/i.test(target) && app.isPackaged;
  if (!silent) {
    try {
      shell.openPath(target);
      return { ok: true, manual: true };
    } catch (err) {
      return { ok: false, error: (err && err.message) || '打开安装包失败' };
    }
  }
  const dir = installTargetDir();
  if (!dir) return { ok: false, error: '无法定位当前安装目录' };
  try {
    // 先退出应用，再由安装程序在原安装目录静默覆盖安装，避免旧版被卸载后新版本装不上
    broadcast('update:progress', { received: 0, total: 0, percent: 100, done: true, applying: true, dir });
    log.info('准备退出并安装更新', { target, dir, elevate: !dirWritable(dir) });
    launchSilentSetup(target, dir);
    try { require('./windows').markQuitting(); } catch (err) { /* ignore */ }
    setTimeout(() => { app.exit(0); }, 900);
    return { ok: true, restarting: true, dir };
  } catch (err) {
    return { ok: false, error: (err && err.message) || '启动安装程序失败' };
  }
}

function openFolder(file) {
  const target = String(file || '').trim();
  if (!target) return { ok: false, error: '路径为空' };
  try {
    if (fs.existsSync(target)) {
      if (fs.statSync(target).isDirectory()) shell.openPath(target);
      else shell.showItemInFolder(target);
    } else {
      const dir = path.dirname(target);
      if (dir && fs.existsSync(dir)) shell.openPath(dir);
      else return { ok: false, error: '目录不存在' };
    }
    return { ok: true };
  } catch (err) {
    return { ok: false, error: (err && err.message) || '打开失败' };
  }
}

function broadcast(channel, payload) {
  try {
    for (const win of require('./windows').allWindows()) {
      if (!win.isDestroyed()) win.webContents.send(channel, payload);
    }
  } catch (err) { /* ignore */ }
}

async function downloadAsset(assetUrl, filename) {
  if (downloading) return { ok: false, error: '已有安装包正在下载' };
  const target = String(assetUrl || '');
  if (!/^https:\/\//i.test(target)) return { ok: false, error: '下载地址无效' };
  downloading = true;
  const dir = (() => {
    const custom = store.getSettings().downloadDir;
    const appDir = installTargetDir();
    if (custom) {
      try {
        fs.mkdirSync(custom, { recursive: true });
        const insideApp = appDir
          && path.resolve(custom).toLowerCase().startsWith(path.resolve(appDir).toLowerCase() + path.sep);
        if (!insideApp) return custom;
      } catch (err) { /* 回退用户数据目录 */ }
    }
    /* 安装包必须落在安装目录之外：旧版卸载会清空安装目录，
       放在安装目录内会被一并删除，导致“旧版已卸载、新版装不上”；
       优先用户数据目录（卸载不清理），再回退本地应用数据，最后回退系统下载目录 */
    const candidates = [];
    try { candidates.push(path.join(app.getPath('userData'), 'updates')); } catch (err) { /* ignore */ }
    try { candidates.push(path.join(process.env.LOCALAPPDATA || app.getPath('temp'), 'FNOS', 'updates')); } catch (err) { /* ignore */ }
    for (const candidate of candidates) {
      try {
        fs.mkdirSync(candidate, { recursive: true });
        const probe = path.join(candidate, '.fnos-write-test');
        fs.writeFileSync(probe, '');
        fs.unlinkSync(probe);
        return candidate;
      } catch (err) { /* 尝试下一个候选目录 */ }
    }
    return app.getPath('downloads');
  })();
  const file = path.join(dir, String(filename || 'fnos-update.exe').replace(/[\\/:*?"<>|]/g, '_'));
  return new Promise((resolve) => {
    let settled = false;
    const finish = (payload) => {
      if (settled) return;
      settled = true;
      downloading = false;
      resolve(payload);
    };
    let req;
    try {
      req = net.request({ method: 'GET', url: target, redirect: 'follow' });
    } catch (err) {
      finish({ ok: false, error: (err && err.message) || '下载失败' });
      return;
    }
    req.setHeader('User-Agent', 'fnos-client/' + app.getVersion());
    const timer = setTimeout(() => {
      try { req.abort(); } catch (err) { /* ignore */ }
      finish({ ok: false, error: '下载超时' });
    }, 10 * 60 * 1000);
    req.on('response', (response) => {
      if (response.statusCode !== 200) {
        clearTimeout(timer);
        finish({ ok: false, error: '下载失败，HTTP ' + response.statusCode });
        return;
      }
      const total = Number(response.headers['content-length'] || 0) || 0;
      let received = 0;
      const stream = fs.createWriteStream(file);
      response.on('data', (chunk) => {
        received += chunk.length;
        stream.write(chunk);
        broadcast('update:progress', {
          received, total,
          percent: total ? Math.round(received / total * 1000) / 10 : 0
        });
      });
      response.on('end', () => {
        clearTimeout(timer);
        stream.end(() => {
          log.info('安装包下载完成', file);
          broadcast('update:progress', { received, total, percent: 100, done: true, file });
          finish({ ok: true, file });
          // 下载完成后自动启动安装包
          setTimeout(() => { openInstaller(file); }, 1200);
        });
      });
      response.on('error', (err) => {
        clearTimeout(timer);
        try { stream.end(); } catch (e) { /* ignore */ }
        finish({ ok: false, error: (err && err.message) || '下载中断' });
      });
    });
    req.on('error', (err) => {
      clearTimeout(timer);
      finish({ ok: false, error: (err && err.message) || '网络异常' });
    });
    req.end();
  });
}

function scheduleAutoCheck(delay) {
  if (store.getSettings().autoCheckUpdate === false) return;
  setTimeout(() => {
    const last = Number(store.getSettings().lastUpdateCheck) || 0;
    if (Date.now() - last < 6 * 60 * 60 * 1000) return;
    check({ silent: true }).then((payload) => {
      if (payload && payload.ok && payload.hasUpdate) {
        const windows = require('./windows');
        windows.createUpdate(windows.getMain());
      }
    }).catch(() => {});
  }, Number(delay) || 8000);
}

module.exports = { check, openReleasePage, openFolder, openInstaller, compareVersion, downloadAsset, scheduleAutoCheck, pickAsset };
