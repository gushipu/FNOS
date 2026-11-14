'use strict';

const { powerMonitor } = require('electron');

const log = require('./logger').create('lock');
const store = require('./store');
const secure = require('./secure');

let locked = false;
let hooks = { hideAll: null, showAll: null, broadcast: null, isHidden: false };
let idleTimer = null;
let lastActivityLock = 0;

function setHooks(next) {
  hooks = Object.assign({}, hooks, next || {});
}

function isEnabled() {
  const cfg = store.getSettings();
  return !!(cfg.lockEnabled && cfg.lockPassword);
}

function isLocked() {
  return locked;
}

function broadcast() {
  if (typeof hooks.broadcast === 'function') {
    try {
      hooks.broadcast({ locked, enabled: isEnabled(), hidden: !!hooks.isHidden });
    } catch (err) { /* ignore */ }
  }
}

function notifyRenderer() {
  if (typeof hooks.onLockChange === 'function') {
    try { hooks.onLockChange(locked); } catch (err) { /* ignore */ }
  }
}

function setPassword(password) {
  const pass = String(password || '');
  if (pass.length < 4) return { ok: false, error: '密码至少 4 位' };
  const record = secure.hashPassword(pass);
  if (!record) return { ok: false, error: '密码不能为空' };
  store.patchSettings({ lockPassword: record, lockEnabled: true });
  log.info('已设置启动密码');
  broadcast();
  return { ok: true };
}

function changePassword(oldPassword, newPassword) {
  const cfg = store.getSettings();
  if (!cfg.lockPassword) return setPassword(newPassword);
  if (!secure.verifyPassword(oldPassword, cfg.lockPassword)) return { ok: false, error: '原密码不正确' };
  return setPassword(newPassword);
}

function clearPassword(password) {
  const cfg = store.getSettings();
  if (cfg.lockPassword && !secure.verifyPassword(password, cfg.lockPassword)) {
    return { ok: false, error: '密码不正确' };
  }
  store.patchSettings({ lockPassword: null, lockEnabled: false, lockOnStart: false });
  locked = false;
  broadcast();
  return { ok: true };
}

function enable(options) {
  const cfg = store.getSettings();
  const opts = options || {};
  const patch = {};
  if (typeof opts.enabled === 'boolean') patch.lockEnabled = opts.enabled;
  if (typeof opts.lockOnStart === 'boolean') patch.lockOnStart = opts.lockOnStart;
  if (Number.isFinite(Number(opts.idleMinutes))) patch.lockIdleMinutes = Math.max(0, Math.min(240, Number(opts.idleMinutes)));
  if (patch.lockEnabled && !cfg.lockPassword && patch.lockEnabled) {
    return { ok: false, error: '请先设置启动密码' };
  }
  store.patchSettings(patch);
  restartIdleWatch();
  broadcast();
  return { ok: true, settings: status() };
}

function verify(password) {
  const cfg = store.getSettings();
  const ok = secure.verifyPassword(password, cfg.lockPassword);
  if (!ok) log.warn('解锁失败：密码错误');
  return { ok };
}

function lock(reason) {
  if (!isEnabled()) return { ok: false, error: '未启用启动密码' };
  if (locked) return { ok: true, locked };
  locked = true;
  log.info('已锁定', reason || '');
  notifyRenderer();
  broadcast();
  return { ok: true, locked };
}

function unlock(password) {
  if (!isEnabled()) {
    locked = false;
    notifyRenderer();
    broadcast();
    return { ok: true, locked: false };
  }
  if (!secure.verifyPassword(password, store.getSettings().lockPassword)) {
    return { ok: false, error: '密码不正确' };
  }
  locked = false;
  lastActivityLock = Date.now();
  log.info('已解锁');
  notifyRenderer();
  broadcast();
  return { ok: true, locked: false };
}

/* ---------- 老板键：隐藏 / 恢复全部窗口 ---------- */

function bossToggle() {
  const cfg = store.getSettings();
  if (!cfg.bossKeyEnabled) return { ok: false, error: '老板键未启用' };
  const hidden = !hooks.isHidden;
  try {
    if (hidden && typeof hooks.hideAll === 'function') hooks.hideAll();
    if (!hidden && typeof hooks.showAll === 'function') hooks.showAll();
  } catch (err) {
    log.error('老板键切换失败', err && err.message);
    return { ok: false, error: '切换失败' };
  }
  hooks.isHidden = hidden;
  log.info(hidden ? '老板键：已隐藏' : '老板键：已恢复');
  broadcast();
  return { ok: true, hidden };
}

/* ---------- 空闲自动锁定 ---------- */

function restartIdleWatch() {
  if (idleTimer) {
    clearInterval(idleTimer);
    idleTimer = null;
  }
  const minutes = Number(store.getSettings().lockIdleMinutes) || 0;
  if (!minutes || !isEnabled()) return;
  idleTimer = setInterval(() => {
    try {
      const idle = powerMonitor.getSystemIdleTime();
      if (idle >= minutes * 60 && !locked) lock('idle');
    } catch (err) { /* ignore */ }
  }, 20000);
  if (idleTimer.unref) idleTimer.unref();
}

function status() {
  const cfg = store.getSettings();
  return {
    enabled: !!(cfg.lockEnabled && cfg.lockPassword),
    hasPassword: !!cfg.lockPassword,
    lockOnStart: !!cfg.lockOnStart,
    idleMinutes: Number(cfg.lockIdleMinutes) || 0,
    bossKeyEnabled: !!cfg.bossKeyEnabled,
    bossKey: cfg.bossKey || '',
    locked,
    hidden: !!hooks.isHidden
  };
}

module.exports = {
  setHooks, status, isEnabled, isLocked, setPassword, changePassword, clearPassword,
  enable, verify, lock, unlock, bossToggle, restartIdleWatch
};
