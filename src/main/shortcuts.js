'use strict';

const { globalShortcut } = require('electron');

const log = require('./logger').create('shortcut');
const store = require('./store');

const ACTIONS = ['newTab', 'closeTab', 'reload', 'reopenTab', 'downloads', 'live', 'lock', 'boss'];
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
    if (low === 'ctrl' || low === 'control' || low === 'cmdorctrl' || low === 'commandorcontrol') mods.add('Control');
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
    const accelerator = normalize(map[id]);
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
  const busy = conflictOf(checked.accelerator);
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
  return { ok: true, accelerator: checked.accelerator, registered: result.ok, failed: result.failed };
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

module.exports = { ACTIONS, bind, apply, update, reset, list, validate, normalize, dispose, conflictOf };
