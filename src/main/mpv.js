'use strict';

// mpv.js —— 内置 MPV 播放器门面（对外统一入口）
// 组成：
//   mpv-player.js  播放内核管理（内置 mpv.exe 探测、命名管道 JSON-RPC、缓存/硬解参数）
//   mpv-surface.js 应用内嵌入播放层（原生窗口按视频区几何覆盖，随宿主窗移动缩放）
//   mpv-helper.js  本地助手服务（本机回环 HTTP，仅供 mpv 内的中文菜单脚本调用）
// 对外能力：
//   独立窗口播放 play() / 应用内嵌入 embed() / 播放控制 control() / 内核状态 status()
//
// 内核来源优先级：设置页手动指定 → 随包内置 mpv/ → 系统已安装 mpv

const player = require('./mpv-player');
const { MpvSurface } = require('./mpv-surface');
const helper = require('./mpv-helper');
const store = require('./store');
const logger = require('./logger').create('mpv');

let embedded = null;          // 当前应用内嵌入的播放层实例
let embeddedOwner = 0;        // 宿主窗口 id
let currentEmbedUrl = '';     // 当前嵌入播放的媒体地址，用于关窗后的免打扰判定
const recentClosed = new Map(); // 媒体标识 -> 最近一次关窗时间
const SUPPRESS_MS = 180 * 1000; // 关窗后同一媒体 180 秒内不再自动接管

function mediaKey(url) {
  try {
    const u = new URL(String(url));
    return (u.host + u.pathname).toLowerCase();
  } catch (err) {
    return String(url || '').split('#')[0].split('?')[0].toLowerCase();
  }
}

/* 用户在播放窗口里主动关闭后，同一媒体短时间内不再自动接管 */
function shouldSuppress(url, windowMs) {
  if (!url) return false;
  const span = Number(windowMs) > 0 ? Number(windowMs) : SUPPRESS_MS;
  const ts = recentClosed.get(mediaKey(url)) || 0;
  return ts > 0 && (Date.now() - ts) < span;
}
let helperReady = false;

function settings() {
  try { return store.getSettings() || {}; } catch (_) { return {}; }
}

// 把用户指定的内核路径同步给播放器模块（其内部只在启动时探测一次）
function syncCustomExe() {
  const p = settings().mpvPath;
  if (p) process.env.FNOS_MPV_EXE = p;
  else delete process.env.FNOS_MPV_EXE;
}

// 启停本地助手服务；端口与令牌经环境变量注入 mpv 子进程，供中文菜单脚本回连
async function startHelper() {
  if (helperReady) return { ok: true, port: helper.getPort() };
  if (settings().mpvHelper === false) return { ok: false, disabled: true };
  try {
    const r = await helper.start();
    helperReady = true;
    global.__mpvHelperPort = r.port;
    global.__mpvHelperToken = r.token;
    logger.info('helper.start', { port: r.port });
    return { ok: true, port: r.port };
  } catch (err) {
    logger.warn('helper.start.fail', { err: String(err && err.message || err) });
    return { ok: false, error: String(err && err.message || err) };
  }
}

function resolve() {
  syncCustomExe();
  return player.getMpvExe();
}

function status() {
  syncCustomExe();
  const cfg = settings();
  const exe = player.getMpvExe();
  return {
    enabled: cfg.mpvEnabled !== false,
    available: !!exe,
    path: exe || '',
    embed: !!cfg.mpvEmbed,
    builtin: !!exe && !cfg.mpvPath,
    helper: helperReady ? helper.getPort() : 0,
    hint: exe ? '' : (player.mpvMissingReason() || '未找到 mpv 内核')
  };
}

function info() {
  syncCustomExe();
  try { return player.getMpvInfo() || {}; } catch (_) { return {}; }
}

function rescan() {
  try { player.rescanMpv(); } catch (_) {}
  return status();
}

// 独立窗口播放（与网页播放器互不影响）
function play(input) {
  const opts = input || {};
  if (!opts || !opts.url) return { ok: false, error: '缺少播放地址' };
  syncCustomExe();
  const cfg = settings();
  if (cfg.mpvEnabled === false) return { ok: false, error: 'MPV 播放已在设置中关闭' };
  const res = player.play(opts.url, {
    cookie: opts.cookie || '',
    referer: opts.referer || '',
    userAgent: opts.userAgent || '',
    title: opts.title || '飞牛 NAS',
    isLive: !!opts.isLive,
    hwDecode: opts.hwDecode || cfg.mpvHwDecode || 'auto',
    cacheLevel: opts.cacheLevel || cfg.mpvCache || '',
    volume: opts.volume
  });
  if (res && res.ok) logger.info('play', { pid: res.pid, builtin: !cfg.mpvPath });
  else logger.warn('play.fail', { reason: (res && (res.reason || res.error)) || 'unknown' });
  return res;
}

// 应用内嵌入播放：以宿主窗口的视频区矩形为准，把 mpv 原生窗口贴合覆盖上去
function embed(hostWin, payload) {
  const input = payload || {};
  if (!hostWin || hostWin.isDestroyed()) return { ok: false, error: '宿主窗口不可用' };
  if (!input.url) return { ok: false, error: '缺少播放地址' };
  syncCustomExe();
  /* 切换媒体导致的关闭不算用户主动关窗，不进入免打扰名单 */
  closeEmbed('switch');
  const cfg = settings();
  if (cfg.mpvEnabled === false) return { ok: false, error: 'MPV 播放已在设置中关闭' };
  try {
    embedded = new MpvSurface(hostWin, input.rect || null, {
      standalone: false,
      titlebarHeight: Number(input.titlebarHeight) || 34,
      viewOffsetX: Number(input.viewOffsetX) || 0,
      viewOffsetY: Number(input.viewOffsetY) || 0,
      settings: {
        hwDecode: cfg.mpvHwDecode || 'auto',
        cacheLevel: cfg.mpvCache || '',
        volume: input.volume
      }
    });
    embeddedOwner = hostWin.id;
    currentEmbedUrl = input.url;
    const headers = {};
    if (input.cookie) headers.Cookie = input.cookie;
    if (input.referer) headers.Referer = input.referer;
    if (input.userAgent) headers['User-Agent'] = input.userAgent;
    const r = embedded.play(input.url, Object.keys(headers).length ? headers : null, {
      title: input.title || '飞牛 NAS',
      isLive: !!input.isLive,
      hwDecode: cfg.mpvHwDecode || 'auto',
      cacheLevel: input.isLive ? 'live' : (cfg.mpvCache || '')
    });
    logger.info('embed.start', { host: embeddedOwner });
    return { ok: true, result: r, builtin: !cfg.mpvPath };
  } catch (err) {
    embedded = null;
    const msg = String(err && err.message || err);
    logger.warn('embed.fail', { err: msg });
    return { ok: false, error: msg };
  }
}

function embedRect(rect, viewOffset) {
  if (!embedded || !embedded.isAlive()) return { ok: false };
  try { embedded.setRect(rect, viewOffset); return { ok: true }; } catch (_) { return { ok: false }; }
}

// 播放控制动作：pauseToggle / seek（秒，可负）/ volume（0-130）/ stop
function embedControl(action, value) {
  if (!embedded || !embedded.isAlive()) return Promise.resolve({ ok: false, error: '播放器未启动' });
  try {
    return Promise.resolve(embedded.control(action, value))
      .then(() => ({ ok: true }))
      .catch((err) => ({ ok: false, error: String(err && err.message || err) }));
  } catch (err) {
    return Promise.resolve({ ok: false, error: String(err && err.message || err) });
  }
}

// 覆盖 mpv 窗口标题（任务栏/媒体浮层显示用）
function embedTitle(title) {
  if (!embedded || !embedded.isAlive()) return { ok: false, error: '播放器未启动' };
  try {
    embedded.player.command(['set_property', 'title', String(title || '飞牛 NAS')]).catch(() => {});
    return { ok: true };
  } catch (err) {
    return { ok: false, error: String(err && err.message || err) };
  }
}

function closeEmbed(reason) {
  const lastUrl = currentEmbedUrl;
  currentEmbedUrl = '';
  if (lastUrl && reason !== 'switch') {
    recentClosed.set(mediaKey(lastUrl), Date.now());
    if (recentClosed.size > 100) {
      const cutoff = Date.now() - SUPPRESS_MS * 2;
      for (const [k, v] of recentClosed) { if (v < cutoff) recentClosed.delete(k); }
    }
  }
  if (!embedded) return { ok: true };
  try { embedded.destroy(); } catch (_) {}
  embedded = null;
  embeddedOwner = 0;
  return { ok: true };
}

function killAll() {
  closeEmbed();
  try { player.killAll(); } catch (_) {}
  return { ok: true };
}

module.exports = {
  startHelper,
  status,
  info,
  rescan,
  resolve,
  play,
  embed,
  embedRect,
  embedControl,
  embedTitle,
  closeEmbed,
  killAll,
  shouldSuppress,
  mediaKey
};
