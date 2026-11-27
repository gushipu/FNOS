'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { app, shell, session } = require('electron');

const log = require('./logger').create('downloads');
const store = require('./store');

const items = new Map();
const recentKeys = new Map();
let seq = 0;
let lastEmit = 0;

function downloadDir() {
  const dir = store.getSettings().downloadDir;
  if (dir) {
    try {
      fs.mkdirSync(dir, { recursive: true });
      return dir;
    } catch (err) { /* 回退到系统下载目录 */ }
  }
  return app.getPath('downloads');
}

function uniquePath(dir, filename) {
  const base = String(filename || 'download').replace(/[\\/:*?"<>|]/g, '_');
  const ext = path.extname(base);
  const stem = path.basename(base, ext);
  let candidate = path.join(dir, base);
  let index = 1;
  while (fs.existsSync(candidate)) {
    candidate = path.join(dir, `${stem} (${index})${ext}`);
    index += 1;
  }
  return candidate;
}

function serialize(item) {
  const total = item.totalBytes || 0;
  const received = item.receivedBytes || 0;
  const percent = total > 0 ? Math.min(100, received / total * 100) : 0;
  return {
    id: item.id,
    filename: item.filename,
    url: item.url,
    savePath: item.savePath,
    totalBytes: total,
    receivedBytes: received,
    percent: Math.round(percent * 10) / 10,
    state: item.state,
    speed: item.speed || 0,
    startedAt: item.startedAt,
    updatedAt: item.updatedAt || Date.now()
  };
}

function persist() {
  const rows = [];
  for (const item of items.values()) {
    if (item.state === 'completed' || item.state === 'cancelled' || item.state === 'interrupted') {
      rows.push(serialize(item));
    }
  }
  const history = store.readDownloads().filter((row) => !items.has(row.id));
  store.saveDownloads(rows.concat(history).sort((a, b) => (b.startedAt || 0) - (a.startedAt || 0)).slice(0, 500));
}

function broadcast(force) {
  const now = Date.now();
  if (!force && now - lastEmit < 400) return;
  lastEmit = now;
  const rows = list();
  for (const win of require('./windows').allWindows()) {
    if (!win.isDestroyed()) win.webContents.send('downloads:changed', rows);
  }
}

function list() {
  const active = Array.from(items.values()).map(serialize);
  const activeIds = new Set(active.map((row) => row.id));
  const history = store.readDownloads().filter((row) => !activeIds.has(row.id) && fs.existsSync(row.savePath || ''));
  return active.concat(history).sort((a, b) => (b.startedAt || 0) - (a.startedAt || 0));
}

function send(contents, payload) {
  try {
    if (contents && !contents.isDestroyed()) contents.send('download:event', payload);
  } catch (err) { /* ignore */ }
}

function attach(ses) {
  if (!ses || ses.__fnosDownloadHooked) return;
  ses.__fnosDownloadHooked = true;
  ses.on('will-download', (event, item, contents) => {
    const settings = store.getSettings();
    const filename = item.getFilename();
    const dir = downloadDir();
    let savePath;
    if (settings.askDownloadPath) {
      const chosen = item.getSavePath();
      savePath = chosen || path.join(dir, filename);
    } else {
      savePath = uniquePath(dir, filename);
    }
    /* 统一先以 .part 占位：既避免与系统保存框争抢目标路径，也让未完成文件可续传 */
    const partPath = savePath + '.part';
    try {
      fs.mkdirSync(path.dirname(partPath), { recursive: true });
      fs.closeSync(fs.openSync(partPath, 'a'));
      item.setSavePath(partPath);
      /* 同步暂停：在 Chromium 弹原生保存框前接管，随即立刻恢复下载 */
      item.pause();
      setImmediate(() => {
        try { item.resume(); } catch (err) { /* ignore */ }
      });
    } catch (err) {
      log.warn('下载占位失败，回退默认保存', err && err.message);
      try { item.setSavePath(savePath); } catch (e2) { /* ignore */ }
    }
    /* 同一地址在极短时间内被双触发（网页自身 + 窗口拦截）时只保留首个任务 */
    const dedupeKey = [item.getURL(), filename, item.getTotalBytes()].join('|');
    const lastHit = recentKeys.get(dedupeKey) || 0;
    if (Date.now() - lastHit < 3000) {
      log.info('忽略重复下载', { file: filename });
      try {
        item.pause();
        setImmediate(() => { try { item.cancel(); } catch (err) { /* ignore */ } });
      } catch (err) { /* ignore */ }
      return;
    }
    recentKeys.set(dedupeKey, Date.now());
    if (recentKeys.size > 200) {
      const cutoff = Date.now() - 60000;
      for (const [k, v] of recentKeys) { if (v < cutoff) recentKeys.delete(k); }
    }

    seq += 1;
    const record = {
      id: 'dl-' + Date.now().toString(36) + '-' + seq,
      filename,
      url: item.getURL(),
      savePath,
      partPath,
      totalBytes: item.getTotalBytes(),
      receivedBytes: 0,
      state: 'progressing',
      speed: 0,
      startedAt: Date.now(),
      updatedAt: Date.now(),
      item
    };
    items.set(record.id, record);
    log.info('开始下载', { file: filename, savePath });
    send(contents, { id: record.id, state: 'started', filename, savePath });
    broadcast(true);

    let lastTick = Date.now();
    let lastBytes = 0;

    item.on('updated', (e, state) => {
      record.receivedBytes = item.getReceivedBytes();
      record.totalBytes = item.getTotalBytes();
      record.state = state === 'interrupted' ? 'interrupted' : (item.isPaused() ? 'paused' : 'progressing');
      const now = Date.now();
      const span = now - lastTick;
      if (span >= 500) {
        record.speed = Math.max(0, Math.round((record.receivedBytes - lastBytes) / span * 1000));
        lastTick = now;
        lastBytes = record.receivedBytes;
      }
      record.updatedAt = now;
      send(contents, {
        id: record.id, state: record.state, percent: serialize(record).percent,
        receivedBytes: record.receivedBytes, totalBytes: record.totalBytes, speed: record.speed
      });
      broadcast(false);
    });

    item.once('done', (e, state) => {
      record.receivedBytes = item.getReceivedBytes();
      record.totalBytes = item.getTotalBytes();
      record.state = state === 'completed' ? 'completed' : (state === 'cancelled' ? 'cancelled' : 'interrupted');
      record.speed = 0;
      record.updatedAt = Date.now();
      record.item = null;
      if (record.state === 'completed') {
        /* 完成时把 .part 落成正式文件名；目标重名则另取唯一名，绝不覆盖已有文件 */
        try {
          if (fs.existsSync(record.partPath)) {
            let target = record.savePath;
            if (fs.existsSync(target)) target = uniquePath(path.dirname(target), path.basename(target));
            fs.renameSync(record.partPath, target);
            record.savePath = target;
          }
        } catch (err) {
          log.warn('落盘重命名失败', err && err.message);
        }
      } else if (record.state === 'cancelled') {
        try { if (fs.existsSync(record.partPath)) fs.unlinkSync(record.partPath); } catch (err) { /* ignore */ }
      }
      log.info('下载结束', { file: filename, state: record.state, savePath: record.savePath });
      send(contents, { id: record.id, state: record.state, savePath: record.savePath, filename });
      persist();
      broadcast(true);
      if (record.state === 'completed' && store.getSettings().downloadNotify !== false) {
        try {
          const { Notification } = require('electron');
          if (Notification.isSupported()) {
            new Notification({ title: '下载完成', body: record.filename }).show();
          }
        } catch (err) { /* ignore */ }
      }
    });
  });
}

function attachAll() {
  try {
    attach(session.defaultSession);
  } catch (err) {
    log.error('挂载默认会话下载监听失败', err && err.message);
  }
}

function control(id, action) {
  const record = items.get(String(id || ''));
  if (!record) return { ok: false, error: '任务不存在或已结束' };
  const item = record.item;
  if (!item) return { ok: false, error: '任务已结束' };
  try {
    if (action === 'pause') {
      item.pause();
      record.state = 'paused';
    } else if (action === 'resume') {
      if (!item.canResume()) return { ok: false, error: '该任务不支持断点续传，请重新下载' };
      item.resume();
      record.state = 'progressing';
    } else if (action === 'cancel') {
      /* 先暂停再延迟取消：避免服务端把中断当成异常而清理临时资源 */
      try { item.pause(); } catch (err) { /* ignore */ }
      record.state = 'cancelled';
      broadcast(true);
      setTimeout(() => { try { item.cancel(); } catch (err) { /* ignore */ } }, 600);
      return { ok: true, state: record.state };
    } else {
      return { ok: false, error: '未知操作' };
    }
    broadcast(true);
    return { ok: true, state: record.state };
  } catch (err) {
    return { ok: false, error: (err && err.message) || '操作失败' };
  }
}

function pauseAll() {
  for (const record of items.values()) {
    if (record.item) {
      try { record.item.pause(); record.state = 'paused'; } catch (err) { /* ignore */ }
    }
  }
  broadcast(true);
  return { ok: true, rows: list() };
}

async function openFile(id) {
  const row = list().find((item) => item.id === id);
  if (!row) return { ok: false, error: '任务不存在' };
  if (!row.savePath || !fs.existsSync(row.savePath)) return { ok: false, error: '文件不存在或已被移动' };
  const err = await shell.openPath(row.savePath);
  return err ? { ok: false, error: err } : { ok: true };
}

function showInFolder(id) {
  const row = list().find((item) => item.id === id);
  if (!row || !row.savePath) return { ok: false, error: '任务不存在' };
  if (!fs.existsSync(row.savePath)) return { ok: false, error: '文件不存在或已被移动' };
  shell.showItemInFolder(row.savePath);
  return { ok: true };
}

function remove(id) {
  const key = String(id || '');
  const record = items.get(key);
  if (record && record.item) {
    try { record.item.cancel(); } catch (err) { /* ignore */ }
    items.delete(key);
  }
  const history = store.readDownloads().filter((row) => row.id !== key);
  store.saveDownloads(history);
  broadcast(true);
  return { ok: true, rows: list() };
}

function clearCompleted() {
  const history = store.readDownloads().filter((row) => row.state !== 'completed');
  store.saveDownloads(history);
  for (const [id, record] of Array.from(items)) {
    if (record.state === 'completed') items.delete(id);
  }
  broadcast(true);
  return { ok: true, rows: list() };
}

function stats() {
  const rows = list();
  return {
    total: rows.length,
    active: rows.filter((row) => row.state === 'progressing' || row.state === 'paused').length,
    completed: rows.filter((row) => row.state === 'completed').length,
    dir: downloadDir()
  };
}

module.exports = {
  downloadDir, uniquePath, attach, attachAll, list, control, pauseAll,
  openFile, showInFolder, remove, clearCompleted, stats, broadcast
};
