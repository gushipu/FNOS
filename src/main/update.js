'use strict';

const { app, net, shell } = require('electron');

const REPO = 'gushipu/FNOS';
const API = `https://api.github.com/repos/${REPO}/releases/latest`;

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

function check() {
  return new Promise((resolve) => {
    let settled = false;
    const finish = (payload) => {
      if (settled) return;
      settled = true;
      resolve(payload);
    };
    let request;
    try {
      request = net.request({ method: 'GET', url: API, redirect: 'follow' });
    } catch (err) {
      finish({ ok: false, error: err.message });
      return;
    }
    request.setHeader('User-Agent', `fnos-client/${app.getVersion()}`);
    request.setHeader('Accept', 'application/vnd.github+json');
    const timer = setTimeout(() => {
      try { request.abort(); } catch (err) { /* 忽略 */ }
      finish({ ok: false, error: '请求超时' });
    }, 12000);

    request.on('response', (response) => {
      let body = '';
      response.on('data', (chunk) => { body += chunk.toString('utf8'); });
      response.on('end', () => {
        clearTimeout(timer);
        if (response.statusCode !== 200) {
          finish({ ok: false, error: `GitHub 返回 ${response.statusCode}` });
          return;
        }
        try {
          const data = JSON.parse(body);
          const latest = String(data.tag_name || data.name || '').replace(/^v/i, '');
          const current = app.getVersion();
          finish({
            ok: true,
            latest,
            current,
            hasUpdate: latest ? compareVersion(latest, current) > 0 : false,
            url: data.html_url || `https://github.com/${REPO}/releases`,
            notes: typeof data.body === 'string' ? data.body.slice(0, 2000) : ''
          });
        } catch (err) {
          finish({ ok: false, error: '返回内容解析失败' });
        }
      });
    });
    request.on('error', (err) => {
      clearTimeout(timer);
      finish({ ok: false, error: err && err.message ? err.message : '网络异常' });
    });
    request.end();
  });
}

function openReleasePage(url) {
  const target = url || `https://github.com/${REPO}/releases`;
  return shell.openExternal(target);
}

module.exports = { check, openReleasePage, compareVersion };
