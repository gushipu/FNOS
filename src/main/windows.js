'use strict';

const path = require('node:path');
const { app, BrowserWindow, Tray, Menu, nativeImage, screen, shell } = require('electron');
const store = require('./store');
const tabs = require('./tabs');
const lock = require('./lock');

const RENDERER_DIR = path.join(__dirname, '..', 'renderer');
const PRELOAD_DIR = path.join(__dirname, '..', 'preload');
const ASSETS_DIR = path.join(__dirname, '..', '..', 'assets');

let mainWin = null;
let connectWin = null;
let settingsWin = null;
let downloadsWin = null;
let liveWin = null;
let tray = null;
let quitting = false;
let stateTimer = null;

function markQuitting() {
  quitting = true;
}

function isQuitting() {
  return quitting;
}

function iconPath() {
  return path.join(ASSETS_DIR, 'icon.png');
}

function allWindows() {
  return BrowserWindow.getAllWindows().filter((win) => !win.isDestroyed());
}

function basePrefs(extra) {
  return Object.assign({
    preload: path.join(PRELOAD_DIR, 'shell.js'),
    contextIsolation: true,
    nodeIntegration: false,
    sandbox: false,
    spellcheck: false
  }, extra || {});
}

function safeBounds(saved) {
  const width = Math.max(960, Math.round(saved.width || 1360));
  const height = Math.max(600, Math.round(saved.height || 860));
  const result = { width, height };
  if (typeof saved.x === 'number' && typeof saved.y === 'number') {
    const displays = screen.getAllDisplays();
    const visible = displays.some((display) => {
      const area = display.workArea;
      return saved.x >= area.x - 40 && saved.y >= area.y - 40
        && saved.x < area.x + area.width - 80 && saved.y < area.y + area.height - 80;
    });
    if (visible) {
      result.x = saved.x;
      result.y = saved.y;
    }
  }
  return result;
}

function scheduleStateSave() {
  clearTimeout(stateTimer);
  stateTimer = setTimeout(() => {
    if (!mainWin || mainWin.isDestroyed()) return;
    if (mainWin.isMinimized() || mainWin.isFullScreen()) return;
    const bounds = mainWin.isMaximized() ? mainWin.getNormalBounds() : mainWin.getBounds();
    store.saveWindowState({ ...bounds, maximized: mainWin.isMaximized() });
  }, 400);
}

function broadcastWindowState() {
  if (!mainWin || mainWin.isDestroyed()) return;
  mainWin.webContents.send('window:state', {
    maximized: mainWin.isMaximized(),
    fullscreen: mainWin.isFullScreen()
  });
}

function appearanceOptions() {
  const settings = store.getSettings();
  const opts = {};
  if (process.platform === 'win32' && settings.blurTitlebar && !settings.gpuCompatible) {
    opts.backgroundMaterial = 'acrylic';
  }
  if (settings.roundedCorners === false && process.platform === 'win32') {
    opts.roundedCorners = false;
  }
  return opts;
}

function createMain() {
  if (mainWin && !mainWin.isDestroyed()) {
    mainWin.show();
    mainWin.focus();
    return mainWin;
  }
  const isMac = process.platform === 'darwin';
  const saved = store.get().window || {};
  const bounds = safeBounds(saved);

  mainWin = new BrowserWindow(Object.assign({
    x: bounds.x,
    y: bounds.y,
    width: bounds.width,
    height: bounds.height,
    minWidth: 960,
    minHeight: 600,
    show: false,
    title: '飞牛 NAS',
    backgroundColor: '#14171c',
    icon: iconPath(),
    frame: isMac,
    titleBarStyle: isMac ? 'hiddenInset' : 'default',
    trafficLightPosition: isMac ? { x: 18, y: 20 } : undefined,
    autoHideMenuBar: true,
    webPreferences: basePrefs({ webviewTag: true, backgroundThrottling: false })
  }, appearanceOptions()));

  tabs.setMainWindow(mainWin);
  mainWin.loadFile(path.join(RENDERER_DIR, 'shell.html'));

  mainWin.once('ready-to-show', () => {
    if (saved.maximized) mainWin.maximize();
    mainWin.show();
  });

  ['maximize', 'unmaximize', 'enter-full-screen', 'leave-full-screen'].forEach((event) => {
    mainWin.on(event, broadcastWindowState);
  });
  ['resize', 'move', 'maximize', 'unmaximize'].forEach((event) => {
    mainWin.on(event, scheduleStateSave);
  });

  mainWin.on('close', (event) => {
    if (quitting) {
      store.saveWindowState({
        ...(mainWin.isMaximized() ? mainWin.getNormalBounds() : mainWin.getBounds()),
        maximized: mainWin.isMaximized()
      });
      return;
    }
    const action = store.getSettings().closeAction;
    if (action === 'tray' || action === 'minimize') {
      event.preventDefault();
      mainWin.hide();
      ensureTray();
      return;
    }
    store.saveWindowState({
      ...(mainWin.isMaximized() ? mainWin.getNormalBounds() : mainWin.getBounds()),
      maximized: mainWin.isMaximized()
    });
  });

  mainWin.on('closed', () => {
    mainWin = null;
  });

  mainWin.webContents.on('will-attach-webview', (event, webPreferences) => {
    webPreferences.contextIsolation = true;
    webPreferences.nodeIntegration = false;
    webPreferences.sandbox = false;
    webPreferences.webSecurity = true;
  });

  return mainWin;
}

function createConnect(parent) {
  if (connectWin && !connectWin.isDestroyed()) {
    connectWin.show();
    connectWin.focus();
    return connectWin;
  }
  connectWin = new BrowserWindow({
    width: 660,
    height: 660,
    minWidth: 620,
    minHeight: 580,
    show: false,
    resizable: true,
    minimizable: false,
    maximizable: false,
    title: '连接飞牛 NAS',
    backgroundColor: '#14171c',
    icon: iconPath(),
    parent: parent && !parent.isDestroyed() ? parent : undefined,
    webPreferences: basePrefs()
  });
  connectWin.loadFile(path.join(RENDERER_DIR, 'connect.html'));
  connectWin.once('ready-to-show', () => connectWin.show());
  connectWin.on('closed', () => {
    connectWin = null;
    if (!mainWin && !quitting) {
      app.quit();
    }
  });
  return connectWin;
}

function createSettings(parent) {
  if (settingsWin && !settingsWin.isDestroyed()) {
    settingsWin.show();
    settingsWin.focus();
    return settingsWin;
  }
  settingsWin = new BrowserWindow({
    width: 880,
    height: 760,
    minWidth: 760,
    minHeight: 600,
    show: false,
    title: '设置',
    backgroundColor: '#14171c',
    icon: iconPath(),
    parent: parent && !parent.isDestroyed() ? parent : undefined,
    autoHideMenuBar: true,
    webPreferences: basePrefs()
  });
  settingsWin.loadFile(path.join(RENDERER_DIR, 'settings.html'));
  settingsWin.once('ready-to-show', () => settingsWin.show());
  settingsWin.on('closed', () => {
    settingsWin = null;
  });
  return settingsWin;
}

function createDownloads(parent) {
  if (downloadsWin && !downloadsWin.isDestroyed()) {
    downloadsWin.show();
    downloadsWin.focus();
    return downloadsWin;
  }
  downloadsWin = new BrowserWindow({
    width: 820,
    height: 600,
    minWidth: 680,
    minHeight: 460,
    show: false,
    title: '下载中心',
    backgroundColor: '#14171c',
    icon: iconPath(),
    parent: parent && !parent.isDestroyed() ? parent : undefined,
    autoHideMenuBar: true,
    webPreferences: basePrefs()
  });
  downloadsWin.loadFile(path.join(RENDERER_DIR, 'downloads.html'));
  downloadsWin.once('ready-to-show', () => downloadsWin.show());
  downloadsWin.on('closed', () => {
    downloadsWin = null;
  });
  return downloadsWin;
}

function createLive(parent) {
  if (liveWin && !liveWin.isDestroyed()) {
    liveWin.show();
    liveWin.focus();
    return liveWin;
  }
  liveWin = new BrowserWindow({
    width: 1120,
    height: 720,
    minWidth: 860,
    minHeight: 540,
    show: false,
    title: '电视直播',
    backgroundColor: '#0b0e12',
    icon: iconPath(),
    parent: parent && !parent.isDestroyed() ? parent : undefined,
    autoHideMenuBar: true,
    webPreferences: basePrefs({ backgroundThrottling: false })
  });
  liveWin.loadFile(path.join(RENDERER_DIR, 'live.html'));
  liveWin.once('ready-to-show', () => liveWin.show());
  liveWin.on('closed', () => {
    liveWin = null;
  });
  return liveWin;
}

/* ---------- 老板键：隐藏 / 恢复 ---------- */

function hideAll() {
  for (const win of allWindows()) {
    try { win.hide(); } catch (err) { /* ignore */ }
  }
}

function showAll() {
  if (!mainWin || mainWin.isDestroyed()) createMain();
  for (const win of allWindows()) {
    try { win.show(); } catch (err) { /* ignore */ }
  }
  if (mainWin && !mainWin.isDestroyed()) {
    mainWin.show();
    mainWin.focus();
  }
}

function broadcastLock(locked) {
  for (const win of allWindows()) {
    try { win.webContents.send('lock:changed', { locked }); } catch (err) { /* ignore */ }
  }
}

function ensureTray() {
  if (tray) return tray;
  const image = nativeImage.createFromPath(iconPath());
  const scaled = image.isEmpty() ? image : image.resize({ width: 20, height: 20 });
  tray = new Tray(scaled);
  tray.setToolTip('飞牛 NAS');
  tray.setContextMenu(Menu.buildFromTemplate([
    {
      label: '显示主窗口',
      click: () => {
        const win = createMain();
        win.show();
        win.focus();
      }
    },
    { label: '下载中心', click: () => createDownloads(null) },
    { label: '电视直播', click: () => createLive(null) },
    { type: 'separator' },
    { label: '立即锁屏', click: () => { lock.lock('tray'); } },
    { label: '老板键（隐藏/恢复）', click: () => { lock.bossToggle(); } },
    { type: 'separator' },
    { label: '设置', click: () => createSettings(mainWin) },
    { label: '打开配置目录', click: () => shell.openPath(app.getPath('userData')) },
    { type: 'separator' },
    {
      label: '退出',
      click: () => {
        markQuitting();
        app.quit();
      }
    }
  ]));
  tray.on('double-click', () => {
    const win = createMain();
    win.show();
    win.focus();
  });
  return tray;
}

function refreshTray() {
  if (!tray) return;
  try { tray.destroy(); } catch (err) { /* ignore */ }
  tray = null;
  ensureTray();
}

function getMain() {
  return mainWin && !mainWin.isDestroyed() ? mainWin : null;
}

function getConnect() {
  return connectWin && !connectWin.isDestroyed() ? connectWin : null;
}

function getSettings() {
  return settingsWin && !settingsWin.isDestroyed() ? settingsWin : null;
}

function getDownloads() {
  return downloadsWin && !downloadsWin.isDestroyed() ? downloadsWin : null;
}

function getLive() {
  return liveWin && !liveWin.isDestroyed() ? liveWin : null;
}

function bindLockHooks() {
  lock.setHooks({
    hideAll,
    showAll,
    broadcast: (payload) => {
      for (const win of allWindows()) {
        try { win.webContents.send('lock:state', payload); } catch (err) { /* ignore */ }
      }
      refreshTray();
    },
    onLockChange: broadcastLock
  });
}

module.exports = {
  createMain, createConnect, createSettings, createDownloads, createLive,
  ensureTray, refreshTray, bindLockHooks, hideAll, showAll,
  allWindows, getMain, getConnect, getSettings, getDownloads, getLive,
  markQuitting, isQuitting, iconPath, safeBounds
};
