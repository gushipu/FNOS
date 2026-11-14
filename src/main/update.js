'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { app, net, shell, dialog } = require('electron');

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
    if (!opts.silent && payload.hasUpdate) {
      const win = require('./windows').getMain();
      dialog.showMessageBox(win || undefined, {
        type: 'info',
        title: '发现新版本',
        message: `FNOS ${latest} 已发布`,
        detail: (payload.notes || '').slice(0, 600) || '前往发布页查看更新内容。',
        buttons: ['前往下载', '稍后'],
        defaultId: 0,
        cancelId: 1
      }).then((result) => {
        if (result.response === 0) openReleasePage(payload.url);
      }).catch(() => {});
    }
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
    if (custom) {
      try {
        fs.mkdirSync(custom, { recursive: true });
        return custom;
      } catch (err) { /* 回退系统下载目录 */ }
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
    check({ silent: false });
  }, Number(delay) || 8000);
}

module.exports = { check, openReleasePage, compareVersion, downloadAsset, scheduleAutoCheck, pickAsset };
