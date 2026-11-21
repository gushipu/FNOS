'use strict';

const { globalShortcut } = require('electron');

const log = require('./logger').create('shortcut');
const store = require('./store');

const ACTIONS = ['newTab', 'closeTab', 'reload', 'reopenTab', 'downloads', 'lock', 'boss'];
const IS_MAC = process.platform === 'darwin';
const registered = new Map();
let handlers = {};

function normalize(accelerator) {
  const raw = String(accelerator || '').trim();
  if (!raw) return '';
  const parts = raw.split('+').map((item) => item.trim()).filter(Boolean);
  if (!parts.length) return '';
  const mods = new Set();
  let key = '';
  for (const part of parts) {
    const low = part.toLowerCase();
    if (low === 'ctrl' || low === 'control') mods.add('Control');
    else if (low === 'cmdorctrl' || low === 'commandorcontrol') mods.add(IS_MAC ? 'Command' : 'Control');
    else if (low === 'cmd' || low === 'command' || low === 'meta' || low === 'super') mods.add(process.platform === 'darwin' ? 'Command' : 'Super');
    else if (low === 'alt' || low === 'option') mods.add('Alt');
    else if (low === 'shift') mods.add('Shift');
    else key = part.length === 1 ? part.toUpperCase() : part;
  }
  if (!key) return '';
  const order = ['Control', 'Command', 'Super', 'Alt', 'Shift'];
  const list = order.filter((item) => mods.has(item)).concat([key]);
  return list.join('+');
}

/* 系统按键差异：macOS 用 Command(⌘)，Windows/Linux 用 Control。
   配置里可能残留旧版的 Control 组合，注册前统一换成当前平台的主修饰键 */
function toPlatform(accelerator) {
  if (!accelerator) return '';
  const parts = String(accelerator).split('+');
  if (IS_MAC) {
    if (parts.includes('Command')) return parts.filter((item) => item !== 'Control').join('+');
    return parts.map((item) => (item === 'Control' ? 'Command' : item)).join('+');
  }
  return parts.map((item) => (item === 'Command' || item === 'Super' ? 'Control' : item)).join('+');
}

const MAC_SYMBOLS = { Command: '⌘', Control: '⌃', Shift: '⇧', Alt: '⌥', Option: '⌥' };
/* macOS 键帽顺序：⌃⌥⇧⌘；Windows 键盘上的修饰键写作 Ctrl/Win，不是 Control/Super */
const MAC_ORDER = ['Control', 'Alt', 'Shift', 'Command'];
const WIN_LABELS = { Control: 'Ctrl', Super: 'Win', Alt: 'Alt', Shift: 'Shift', Command: 'Ctrl' };

/* 界面展示用：macOS 显示 ⌃⌥⇧⌘H 这类系统符号，Windows/Linux 显示 Ctrl+Shift+H */
function display(accelerator) {
  const value = toPlatform(normalize(accelerator));
  if (!value) return '';
  const parts = value.split('+');
  if (IS_MAC) {
    const key = parts.filter((item) => !MAC_ORDER.includes(item)).join('+');
    const mods = MAC_ORDER.filter((item) => parts.includes(item)).map((item) => MAC_SYMBOLS[item]).join('');
    return mods + key;
  }
  return parts.map((item) => WIN_LABELS[item] || item).join('+');
}

function validate(accelerator) {
  const value = normalize(accelerator);
  if (!value) return { ok: false, error: '快捷键不能为空' };
  const parts = value.split('+');
  if (parts.length < 2 && !/^F\d{1,2}$/i.test(value)) {
    return { ok: false, error: '全局快捷键需包含修饰键（Ctrl/Alt/Shift）' };
  }
  return { ok: true, accelerator: value };
}

function unregisterAll() {
  for (const [id, accelerator] of registered) {
    try { globalShortcut.unregister(accelerator); } catch (err) { /* ignore */ }
    registered.delete(id);
  }
}

function conflictOf(accelerator) {
  const busy = [];
  for (const [id, value] of registered) {
    if (value === accelerator) busy.push(id);
  }
  if (globalShortcut.isRegistered(accelerator)) busy.push('system');
  return busy;
}

function apply() {
  unregisterAll();
  const cfg = store.getSettings();
  const map = Object.assign({}, cfg.shortcuts || {});
  if (cfg.bossKeyEnabled && cfg.bossKey) map.boss = cfg.bossKey;
  if (cfg.lockEnabled === false) delete map.lock;
  const failed = [];
  const ok = [];
  for (const id of ACTIONS) {
    const accelerator = toPlatform(normalize(map[id]));
    if (!accelerator) continue;
    const handler = handlers[id];
    if (typeof handler !== 'function') continue;
    try {
      const done = globalShortcut.register(accelerator, () => {
        try { handler(); } catch (err) { log.error('快捷键执行失败', id, err && err.message); }
      });
      if (done) {
        registered.set(id, accelerator);
        ok.push({ id, accelerator });
      } else {
        failed.push({ id, accelerator, reason: '已被其它应用或系统占用' });
      }
    } catch (err) {
      failed.push({ id, accelerator, reason: (err && err.message) || '注册失败' });
    }
  }
  if (failed.length) log.warn('部分快捷键注册失败', failed);
  return { ok, failed };
}

function update(id, accelerator) {
  if (!ACTIONS.includes(id)) return { ok: false, error: '未知的快捷键标识' };
  const checked = validate(accelerator);
  if (!checked.ok) return checked;
  const busy = conflictOf(toPlatform(checked.accelerator));
  if (busy.length && busy.some((item) => item !== id)) {
    return { ok: false, error: '该组合已被其它应用占用，请更换' };
  }
  const cfg = store.getSettings();
  const next = Object.assign({}, cfg.shortcuts || {});
  next[id] = checked.accelerator;
  const patch = { shortcuts: next };
  if (id === 'boss') {
    patch.bossKey = checked.accelerator;
    patch.bossKeyEnabled = true;
  }
  store.patchSettings(patch);
  const result = apply();
  return {
    ok: true,
    accelerator: checked.accelerator,
    display: display(checked.accelerator),
    registered: result.ok,
    failed: result.failed
  };
}

function reset() {
  const defaults = store.DEFAULTS.settings.shortcuts;
  store.patchSettings({ shortcuts: Object.assign({}, defaults) });
  return apply();
}

function list() {
  const cfg = store.getSettings();
  const map = Object.assign({}, cfg.shortcuts || {});
  if (cfg.bossKey) map.boss = cfg.bossKey;
  return ACTIONS.map((id) => ({
    id,
    accelerator: normalize(map[id]),
    display: display(map[id]),
    platform: toPlatform(normalize(map[id])),
    active: registered.has(id)
  }));
}

function bind(map) {
  handlers = Object.assign({}, handlers, map || {});
}

function dispose() {
  unregisterAll();
  handlers = {};
}

module.exports = { ACTIONS, bind, apply, update, reset, list, validate, normalize, display, toPlatform, dispose, conflictOf };
