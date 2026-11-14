'use strict';

const log = require('./logger').create('media');

const MAX_ROWS = 60;
const rows = [];
let seq = 0;
const hooked = new WeakSet();
let listener = null;

const MEDIA_TYPES = [
  { test: /^video\//i, kind: 'video' },
  { test: /^audio\//i, kind: 'audio' },
  { test: /mpegurl|x-mpegurl/i, kind: 'hls' },
  { test: /dash\+xml/i, kind: 'dash' },
  { test: /^application\/octet-stream$/i, kind: 'binary' }
];

const MEDIA_EXT = /\.(mp4|mkv|webm|flv|mov|m4v|ts|m3u8|mpd|mp3|aac|flac|wav|ogg|m4a|avi|wmv)(\?|#|$)/i;

function looksLikeMedia(details, headers) {
  const type = String(headers['content-type'] || headers['Content-Type'] || '').split(';')[0].trim();
  const url = String(details.url || '');
  for (const rule of MEDIA_TYPES) {
    if (rule.test.test(type)) {
      if (rule.kind === 'binary' && !MEDIA_EXT.test(url)) continue;
      return { kind: rule.kind, type };
    }
  }
  if (MEDIA_EXT.test(url) && /^media$/i.test(String(details.resourceType || ''))) {
    return { kind: 'media', type: type || 'unknown' };
  }
  return null;
}

function pushOnce(row) {
  const key = row.url.split('#')[0];
  const exists = rows.find((item) => item.url.split('#')[0] === key);
  if (exists) {
    exists.at = Date.now();
    return exists;
  }
  rows.unshift(row);
  if (rows.length > MAX_ROWS) rows.length = MAX_ROWS;
  return row;
}

function setListener(fn) {
  listener = typeof fn === 'function' ? fn : null;
}

function emit(row) {
  if (!listener) return;
  try { listener(row); } catch (err) { /* ignore */ }
}

function attach(ses) {
  if (!ses || hooked.has(ses)) return false;
  hooked.add(ses);
  try {
    ses.webRequest.onHeadersReceived({ urls: ['*://*/*'] }, (details, callback) => {
      const headers = details.responseHeaders || {};
      const hit = looksLikeMedia(details, headers);
      if (hit) {
        seq += 1;
        const length = Number(headers['content-length'] || headers['Content-Length'] || 0) || 0;
        const row = pushOnce({
          id: 'm-' + seq,
          url: details.url,
          kind: hit.kind,
          mime: hit.type,
          size: length,
          at: Date.now()
        });
        emit(row);
      }
      callback({ cancel: false, responseHeaders: headers });
    });
  } catch (err) {
    log.error('媒体嗅探挂载失败', err && err.message);
    return false;
  }
  return true;
}

function list() {
  return rows.slice();
}

function find(id) {
  return rows.find((row) => row.id === id) || null;
}

function clear() {
  rows.length = 0;
  return { ok: true };
}

async function cookieFor(ses, url) {
  if (!ses) return '';
  try {
    const cookies = await ses.cookies.get({ url });
    return cookies.map((item) => `${item.name}=${item.value}`).join('; ');
  } catch (err) {
    return '';
  }
}

module.exports = { attach, setListener, list, find, clear, cookieFor };
