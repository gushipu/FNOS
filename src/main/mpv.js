'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { app } = require('electron');

const log = require('./logger').create('mpv');
const store = require('./store');

const PROCS = new Set();
const ALLOWED = /^(https?|rtsp|rtmp|rtmps|mms):\/\//i;

function candidates() {
  const cfg = store.getSettings();
  const list = [];
  if (cfg.mpvPath) list.push(cfg.mpvPath);
  const res = process.resourcesPath || '';
  if (res) {
    list.push(path.join(res, 'mpv', 'mpv.exe'));
    list.push(path.join(res, 'mpv.exe'));
    list.push(path.join(res, 'mpv', 'mpv'));
  }
  try {
    list.push(path.join(app.getAppPath(), 'resources', 'mpv', 'mpv.exe'));
  } catch (err) { /* ignore */ }
  if (process.platform === 'win32') {
    list.push('C:\\Program Files\\mpv\\mpv.exe');
  } else {
    list.push('/usr/local/bin/mpv', '/usr/bin/mpv', '/opt/homebrew/bin/mpv');
  }
  return list.filter(Boolean);
}

let cachedPath = null;

function resolve() {
  if (cachedPath && fs.existsSync(cachedPath)) return cachedPath;
  cachedPath = null;
  for (const item of candidates()) {
    try {
      if (fs.existsSync(item)) {
        cachedPath = item;
        return cachedPath;
      }
    } catch (err) { /* ignore */ }
  }
  return null;
}

function status() {
  const found = resolve();
  const cfg = store.getSettings();
  return {
    enabled: cfg.mpvEnabled !== false,
    available: !!found,
    path: found || '',
    embed: !!cfg.mpvEmbed,
    hint: found ? '' : '未找到 mpv 内核，可在设置中指定 mpv.exe 路径，或下载 mpv 后放入安装目录 resources\\mpv'
  };
}

function headersOf(options) {
  const rows = [];
  const cookie = String((options && options.cookie) || '').trim();
  const referer = String((options && options.referer) || '').trim();
  const origin = String((options && options.origin) || '').trim();
  if (referer) rows.push('Referer: ' + referer);
  if (origin) rows.push('Origin: ' + origin);
  if (cookie) rows.push('Cookie: ' + cookie);
  return rows.join(',');
}

function play(input) {
  const url = String((input && input.url) || '').trim();
  if (!ALLOWED.test(url)) return { ok: false, error: '仅支持 http/https/rtsp/rtmp 媒体地址' };
  const bin = resolve();
  if (!bin) return { ok: false, error: '未找到 mpv 内核，请先在设置中指定 mpv.exe' };

  const cfg = store.getSettings();
  const args = ['--no-terminal', '--force-window=yes', '--keep-open=no', '--osc=yes'];
  const ua = String((input && input.userAgent) || '').trim();
  if (ua) args.push('--user-agent=' + ua);
  const headers = headersOf(input);
  if (headers) args.push('--http-header-fields=' + headers);
  const title = String((input && input.title) || '').trim();
  if (title) args.push('--force-media-title=' + title);
  const start = Number(input && input.start);
  if (Number.isFinite(start) && start > 0) args.push('--start=' + Math.floor(start));
  const extra = String(cfg.mpvExtraArgs || '').trim();
  if (extra) {
    extra.split(/\s+/).filter(Boolean).forEach((item) => {
      if (/^--[A-Za-z0-9-]+(=.+)?$/.test(item)) args.push(item);
    });
  }
  args.push(url);

  try {
    const child = spawn(bin, args, { detached: false, stdio: 'ignore', windowsHide: false });
    PROCS.add(child);
    child.on('exit', (code) => {
      PROCS.delete(child);
      log.info('mpv 退出', code);
    });
    child.on('error', (err) => {
      PROCS.delete(child);
      log.error('mpv 启动失败', err && err.message);
    });
    log.info('已用 mpv 打开媒体', { url: url.slice(0, 160) });
    return { ok: true, pid: child.pid, bin };
  } catch (err) {
    log.error('mpv 启动异常', err && err.message);
    return { ok: false, error: (err && err.message) || '启动 mpv 失败' };
  }
}

function killAll() {
  for (const child of Array.from(PROCS)) {
    try { child.kill(); } catch (err) { /* ignore */ }
    PROCS.delete(child);
  }
}

module.exports = { status, play, resolve, killAll };
