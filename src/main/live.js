'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { net } = require('electron');

const log = require('./logger').create('live');
const store = require('./store');

const TIMEOUT = 15000;

function attr(line, key) {
  const re = new RegExp(key + '="([^"]*)"', 'i');
  const m = line.match(re);
  return m ? m[1] : '';
}

function parseM3U(text) {
  const lines = String(text || '').split(/\r?\n/);
  const out = [];
  let pending = null;
  for (const raw of lines) {
    const line = raw.trim();
    if (!line) continue;
    if (/^#EXTINF/i.test(line)) {
      const info = line.replace(/^#EXTINF:\s*[^,]*,\s*/i, '');
      pending = {
        name: info.trim(),
        group: attr(line, 'group-title') || '未分组',
        logo: attr(line, 'tvg-logo'),
        tvgId: attr(line, 'tvg-id'),
        tvgName: attr(line, 'tvg-name')
      };
      if (!pending.name) pending.name = pending.tvgName || pending.tvgId || '未命名频道';
    } else if (/^#EXTGRP:/i.test(line)) {
      if (pending) pending.group = line.replace(/^#EXTGRP:/i, '').trim() || pending.group;
    } else if (!line.startsWith('#')) {
      if (/^(https?|rtmp|rtsp|mms):\/\//i.test(line)) {
        out.push(Object.assign({
          id: String(out.length + 1),
          url: line,
          name: '未命名频道',
          group: '未分组',
          logo: '',
          tvgId: '',
          tvgName: ''
        }, pending || {}));
      }
      pending = null;
    }
  }
  return out;
}

async function fetchText(url) {
  const target = String(url || '').trim();
  if (!/^https?:\/\//i.test(target)) throw new Error('播放列表地址无效');
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT);
  try {
    const res = await net.fetch(target, {
      signal: controller.signal,
      headers: { 'User-Agent': 'FNOS/2.0 (+live)' },
      cache: 'no-cache'
    });
    if (!res.ok) throw new Error('HTTP ' + res.status);
    return await res.text();
  } finally {
    clearTimeout(timer);
  }
}

function listSources() {
  const live = store.readLive();
  const settings = store.getSettings();
  const rows = live.sources.slice();
  if (settings.livePlaylist && !rows.some((row) => row.url === settings.livePlaylist)) {
    rows.unshift({ id: 'default', name: '默认播放列表', url: settings.livePlaylist, builtin: true });
  }
  return rows;
}

function addSource(input) {
  const url = String((input && input.url) || '').trim();
  const name = String((input && input.name) || '').trim();
  if (!/^https?:\/\//i.test(url)) return { ok: false, error: '请填写 http/https 开头的播放列表地址' };
  const live = store.readLive();
  if (live.sources.some((row) => row.url === url)) return { ok: false, error: '该播放列表已存在' };
  const row = { id: 'src-' + Date.now().toString(36), name: name || url.replace(/^https?:\/\//i, '').slice(0, 40), url };
  live.sources.push(row);
  store.saveLive({ sources: live.sources });
  return { ok: true, source: row, sources: live.sources };
}

function removeSource(id) {
  const live = store.readLive();
  const before = live.sources.length;
  live.sources = live.sources.filter((row) => row.id !== id && row.url !== id);
  store.saveLive({ sources: live.sources });
  return { ok: before !== live.sources.length, sources: live.sources };
}

async function load(sourceId) {
  const target = String(sourceId || '').trim();
  let url = '';
  if (/^https?:\/\//i.test(target)) {
    url = target;
  } else {
    const found = listSources().find((row) => row.id === target || row.url === target);
    url = found ? found.url : store.getSettings().livePlaylist;
  }
  if (!url) return { ok: false, error: '尚未配置播放列表，请在设置或直播页添加 m3u 地址' };
  try {
    const text = await fetchText(url);
    const channels = parseM3U(text);
    if (!channels.length) return { ok: false, error: '播放列表中没有解析到频道' };
    const groups = [];
    const index = new Map();
    for (const ch of channels) {
      if (!index.has(ch.group)) {
        index.set(ch.group, { name: ch.group, count: 0 });
        groups.push(index.get(ch.group));
      }
      index.get(ch.group).count += 1;
    }
    log.info('直播列表加载完成', { url: url.slice(0, 120), channels: channels.length });
    return { ok: true, url, channels, groups: groups.sort((a, b) => b.count - a.count) };
  } catch (err) {
    log.error('直播列表加载失败', err && err.message);
    return { ok: false, error: '加载播放列表失败：' + ((err && err.message) || '未知错误') };
  }
}

function toggleFavorite(channel) {
  const live = store.readLive();
  const key = String((channel && (channel.tvgId || channel.url)) || '');
  if (!key) return { ok: false, error: '频道信息不完整', favorites: live.favorites };
  const exists = live.favorites.some((row) => row.key === key);
  live.favorites = exists
    ? live.favorites.filter((row) => row.key !== key)
    : live.favorites.concat([{ key, name: String(channel.name || ''), url: String(channel.url || ''), group: String(channel.group || ''), logo: String(channel.logo || '') }]).slice(-200);
  store.saveLive({ favorites: live.favorites });
  return { ok: true, favorited: !exists, favorites: live.favorites };
}

function parseXmltv(text) {
  const out = {};
  const re = /<programme\b([^>]*)>([\s\S]*?)<\/programme>/gi;
  let m;
  while ((m = re.exec(String(text || '')))) {
    const head = m[1];
    const channel = attr(head, 'channel');
    const start = attr(head, 'start');
    const stop = attr(head, 'stop');
    const titleMatch = m[2].match(/<title[^>]*>([\s\S]*?)<\/title>/i);
    const title = titleMatch ? titleMatch[1].replace(/<!\[CDATA\[|\]\]>/g, '').trim() : '';
    if (!channel || !start) continue;
    if (!out[channel]) out[channel] = [];
    if (out[channel].length < 400) out[channel].push({ start, stop, title });
  }
  return out;
}

async function epg(url) {
  const target = String(url || store.getSettings().liveEpgUrl || '').trim();
  if (!target) return { ok: false, error: '未配置 EPG 地址' };
  try {
    const text = await fetchText(target);
    return { ok: true, data: parseXmltv(text) };
  } catch (err) {
    return { ok: false, error: 'EPG 加载失败：' + ((err && err.message) || '未知错误') };
  }
}

function recordingDir() {
  const settings = store.getSettings();
  const base = settings.downloadDir || '';
  const dir = base ? path.join(base, '录制') : path.join(require('electron').app.getPath('videos'), 'FNOS录制');
  try { fs.mkdirSync(dir, { recursive: true }); } catch (err) { /* ignore */ }
  return dir;
}

function saveRecording(name, base64) {
  try {
    const raw = String(base64 || '');
    if (!raw) return { ok: false, error: '录制数据为空' };
    const safeName = (String(name || '录制') + '-' + Date.now()).replace(/[\\/:*?"<>|]/g, '_');
    const file = path.join(recordingDir(), safeName + '.webm');
    fs.writeFileSync(file, Buffer.from(raw.replace(/^data:[^,]+,/, ''), 'base64'));
    log.info('录制已保存', file);
    return { ok: true, file };
  } catch (err) {
    return { ok: false, error: (err && err.message) || '保存录制失败' };
  }
}

module.exports = {
  parseM3U, listSources, addSource, removeSource, load,
  toggleFavorite, epg, saveRecording, recordingDir
};
