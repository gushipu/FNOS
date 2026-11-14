'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { app, session } = require('electron');
const store = require('./store');
const windows = require('./windows');

const DOWNLOAD_PARTITION = 'persist:fnos';

function downloadDir() {
  const configured = store.getSettings().downloadDir;
  if (configured) {
    try {
      fs.mkdirSync(configured, { recursive: true });
      return configured;
    } catch (err) {
      console.error('[downloads] 目录不可用，回退到系统下载目录:', err && err.message);
    }
  }
  return app.getPath('downloads');
}

function uniquePath(dir, filename) {
  const safeName = String(filename || 'download').replace(/[\\/:*?"<>|]/g, '_');
  const ext = path.extname(safeName);
  const base = path.basename(safeName, ext);
  let candidate = path.join(dir, safeName);
  let index = 1;
  while (fs.existsSync(candidate)) {
    candidate = path.join(dir, `${base} (${index})${ext}`);
    index += 1;
    if (index > 999) break;
  }
  return candidate;
}

function send(channel, payload) {
  const win = windows.getMain();
  if (!win) return;
  try {
    win.webContents.send(channel, payload);
  } catch (err) {
    console.error('[downloads] 推送失败:', err && err.message);
  }
}

function formatBytes(value) {
  const size = Number(value) || 0;
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`;
  if (size < 1024 * 1024 * 1024) return `${(size / 1024 / 1024).toFixed(1)} MB`;
  return `${(size / 1024 / 1024 / 1024).toFixed(2)} GB`;
}

function attach(ses) {
  if (!ses) return;
  if (ses.__fnosDownloadBound) return;
  ses.__fnosDownloadBound = true;

  ses.on('will-download', (event, item) => {
    const settings = store.getSettings();
    const filename = item.getFilename() || 'download';
    if (!settings.askDownloadPath) {
      item.setSavePath(uniquePath(downloadDir(), filename));
    }

    send('download:event', {
      phase: 'start',
      filename,
      total: formatBytes(item.getTotalBytes()),
      savePath: item.getSavePath()
    });

    let lastTick = 0;
    item.on('updated', (e, state) => {
      const now = Date.now();
      if (now - lastTick < 400) return;
      lastTick = now;
      const total = item.getTotalBytes() || 0;
      const received = item.getReceivedBytes() || 0;
      send('download:event', {
        phase: state === 'interrupted' ? 'interrupted' : 'progress',
        filename,
        percent: total > 0 ? Math.min(100, Math.round((received / total) * 100)) : 0,
        received: formatBytes(received),
        total: formatBytes(total),
        savePath: item.getSavePath()
      });
    });

    item.once('done', (e, state) => {
      send('download:event', {
        phase: state === 'completed' ? 'done' : 'failed',
        filename,
        state,
        savePath: item.getSavePath()
      });
    });
  });
}

function attachAll() {
  attach(session.defaultSession);
  attach(session.fromPartition(DOWNLOAD_PARTITION));
}

module.exports = {
  attach,
  attachAll,
  downloadDir,
  DOWNLOAD_PARTITION
};
