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
        tvgName: attr(line, 'tvg-name'),
        /* P1-2 回看：M3U 里的 catchup 系列属性随频道带出 */
        catchup: attr(line, 'catchup'),
        catchupSource: attr(line, 'catchup-source'),
        catchupDays: Number(attr(line, 'catchup-days')) || 0,
        catchupCorrection: attr(line, 'catchup-correction')
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

/* ---------------- P1-1 直播三线路探测（inner → ipv6 → frp） ---------------- */
const LINE_ORDER = ['inner', 'ipv6', 'frp'];
const LINE_TIMEOUT = 3000;
const LINE_CACHE_TTL = 5 * 60 * 1000;
const lineCache = new Map();

function stripSlash(url) {
  return String(url || '').trim().replace(/\/+$/, '');
}

/* 探针请求：单条 3s 超时，判据是 HTTP 200 且响应体含 #EXTM3U */
async function probeFetch(url) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), LINE_TIMEOUT);
  try {
    const res = await net.fetch(url, {
      signal: controller.signal,
      headers: { 'User-Agent': 'FNOS/3.3 (+live)' },
      cache: 'no-cache'
    });
    if (!res.ok) return { ok: false, status: res.status };
    const text = await res.text();
    return { ok: /#EXTM3U/i.test(text.slice(0, 4096)), status: res.status, text };
  } catch (err) {
    return { ok: false, error: (err && err.message) || '请求失败' };
  } finally {
    clearTimeout(timer);
  }
}

/* 按 inner → ipv6 → frp 顺序探测，命中即停，结果进程级缓存 5 分钟 */
async function probeLines(baseUrl) {
  const base = stripSlash(baseUrl);
  if (!/^https?:\/\//i.test(base)) {
    return { ok: false, error: '线路探测需要 http/https 服务地址', results: [] };
  }
  const cached = lineCache.get(base);
  if (cached && Date.now() - cached.at < LINE_CACHE_TTL) {
    return Object.assign({ cached: true }, cached.value);
  }
  const results = [];
  for (const line of LINE_ORDER) {
    const url = `${base}/m3u/${line}.m3u8`;
    const started = Date.now();
    const probe = await probeFetch(url);
    const row = { line, url, ok: !!probe.ok, status: probe.status || 0, ms: Date.now() - started };
    if (probe.error) row.error = probe.error;
    results.push(row);
    if (probe.ok) {
      const value = { ok: true, line, url, results };
      lineCache.set(base, { at: Date.now(), value });
      log.info('直播线路探测命中', { base: base.slice(0, 120), line, ms: row.ms });
      return Object.assign({ text: probe.text }, value);
    }
  }
  const value = { ok: false, error: '三条线路均不可用，请确认 NAS 直播服务已开启', results };
  lineCache.set(base, { at: Date.now(), value });
  return value;
}

function clearLineCache(baseUrl) {
  const base = stripSlash(baseUrl);
  if (base) lineCache.delete(base);
  else lineCache.clear();
  return { ok: true };
}

/* 把播放列表地址里的线路名替换成目标线路 */
function lineVariant(url, line) {
  const m = String(url || '').match(/^(https?:\/\/.+\/m3u\/)(inner|ipv6|frp)\.m3u8(\?.*)?$/i);
  if (!m) return '';
  return m[1] + line + '.m3u8' + (m[3] || '');
}

/* ---------------- P1-2 直播回看：catchup-source 模板 ---------------- */
function pad2(n) { return String(n).padStart(2, '0'); }

function utcParts(ms) {
  const d = new Date(ms);
  return {
    Y: String(d.getUTCFullYear()),
    m: pad2(d.getUTCMonth() + 1),
    d: pad2(d.getUTCDate()),
    H: pad2(d.getUTCHours()),
    M: pad2(d.getUTCMinutes()),
    S: pad2(d.getUTCSeconds())
  };
}

function applyTemplate(tpl, startMs, endMs, nowMs) {
  const s = utcParts(startMs);
  const now = Number(nowMs) || Date.now();
  const map = {
    '{Y}-{m}-{d}': `${s.Y}-${s.m}-${s.d}`,
    '{Y}{m}{d}{H}{M}{S}': `${s.Y}${s.m}${s.d}${s.H}${s.M}${s.S}`,
    '{duration}': String(Math.max(0, Math.round((endMs - startMs) / 1000))),
    '{start}': String(Math.floor(startMs / 1000)),
    '{end}': String(Math.floor(endMs / 1000)),
    '{lutc}': String(Math.floor(now / 1000)),
    '{utc}': String(Math.floor(startMs / 1000)),
    '{Y}': s.Y, '{m}': s.m, '{d}': s.d, '{H}': s.H, '{M}': s.M, '{S}': s.S
  };
  return Object.keys(map).reduce((out, key) => out.split(key).join(map[key]), String(tpl));
}

function absoluteTemplate(source, channelUrl) {
  const src = String(source || '').trim();
  if (!src) return '';
  if (/^https?:\/\//i.test(src)) return src;
  try {
    return new URL(src, String(channelUrl || '')).toString();
  } catch (err) {
    return '';
  }
}

/* 生成回看地址：优先 catchup-source 模板，其次 catchup=append/shift 约定 */
function buildCatchupUrl(channel, startMs, endMs) {
  const ch = channel || {};
  const start = Number(startMs) || 0;
  if (!start) return { ok: false, error: '缺少回看起始时间' };
  const end = Number(endMs) || start + 3600 * 1000;
  const now = Date.now();
  const template = absoluteTemplate(ch.catchupSource, ch.url);
  if (template) {
    return { ok: true, url: applyTemplate(template, start, end, now), mode: 'template' };
  }
  const mode = String(ch.catchup || '').trim().toLowerCase();
  const base = String(ch.url || '').trim();
  if (!base) return { ok: false, error: '频道地址为空' };
  if (mode === 'append' || mode === 'default') {
    const q = `utc=${Math.floor(start / 1000)}&lutc=${Math.floor(now / 1000)}`;
    return { ok: true, url: base + (base.includes('?') ? '&' : '?') + q, mode };
  }
  if (mode === 'shift') {
    const q = `start=${Math.floor(start / 1000)}&end=${Math.floor(end / 1000)}`;
    return { ok: true, url: base + (base.includes('?') ? '&' : '?') + q, mode };
  }
  return { ok: false, error: '该频道未提供回看信息（缺少 catchup / catchup-source）' };
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

async function load(input) {
  const payload = input && typeof input === 'object' ? input : { sourceId: input };
  const target = String(payload.sourceId || '').trim();
  const wantedLine = String(payload.line || store.getSettings().liveLine || '').trim();
  let url = '';
  if (/^https?:\/\//i.test(target)) {
    url = target;
  } else {
    const found = listSources().find((row) => row.id === target || row.url === target);
    url = found ? found.url : store.getSettings().livePlaylist;
  }
  if (!url) return { ok: false, error: '尚未配置播放列表，请在设置或直播页添加 m3u 地址' };

  /* 候选队列：手动锁定的线路优先，其后是原地址，再按 inner/ipv6/frp 顺序兜底 */
  const candidates = [];
  const push = (item) => { if (item && candidates.indexOf(item) < 0) candidates.push(item); };
  push(wantedLine ? lineVariant(url, wantedLine) : '');
  push(url);
  for (const line of LINE_ORDER) push(lineVariant(url, line));

  const tried = [];
  for (const candidate of candidates) {
    try {
      const text = await fetchText(candidate);
      const channels = parseM3U(text);
      if (!channels.length) {
        tried.push({ url: candidate, error: '未解析到频道' });
        continue;
      }
      const groups = [];
      const index = new Map();
      for (const ch of channels) {
        if (!index.has(ch.group)) {
          index.set(ch.group, { name: ch.group, count: 0 });
          groups.push(index.get(ch.group));
        }
        index.get(ch.group).count += 1;
      }
      const hitLine = String(candidate).match(/\/m3u\/(inner|ipv6|frp)\.m3u8/i);
      log.info('直播列表加载完成', { url: String(candidate).slice(0, 120), channels: channels.length, line: hitLine ? hitLine[1] : '' });
      return {
        ok: true,
        url: candidate,
        line: hitLine ? hitLine[1].toLowerCase() : '',
        channels,
        groups: groups.sort((a, b) => b.count - a.count)
      };
    } catch (err) {
      tried.push({ url: candidate, error: (err && err.message) || '未知错误' });
    }
  }
  log.error('直播列表加载失败', JSON.stringify(tried.slice(0, 4)));
  const last = tried[tried.length - 1] || {};
  return { ok: false, error: '加载播放列表失败：' + (last.error || '未知错误'), tried };
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
  toggleFavorite, epg, saveRecording, recordingDir,
  probeLines, clearLineCache, buildCatchupUrl, lineVariant, LINE_ORDER
};
