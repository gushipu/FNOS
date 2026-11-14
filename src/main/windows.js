'use strict';

const path = require('node:path');
const { app, BrowserWindow, Tray, Menu, nativeImage, screen } = require('electron');
const store = require('./store');
const tabs = require('./tabs');

const RENDERER_DIR = path.join(__dirname, '..', 'renderer');
const PRELOAD_DIR = path.join(__dirname, '..', 'preload');
const ASSETS_DIR = path.join(__dirname, '..', '..', 'assets');

let mainWin = null;
let connectWin = null;
let settingsWin = null;
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

function createMain() {
  if (mainWin && !mainWin.isDestroyed()) {
    mainWin.show();
    mainWin.focus();
    return mainWin;
  }
  const isMac = process.platform === 'darwin';
  const saved = store.get().window || {};
  const bounds = safeBounds(saved);

  mainWin = new BrowserWindow({
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
    webPreferences: {
      preload: path.join(PRELOAD_DIR, 'shell.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      webviewTag: true,
      spellcheck: false,
      backgroundThrottling: false
    }
  });

  tabs.setMainWindow(mainWin);
  mainWin.loadFile(path.join(RENDERER_DIR, 'shell.html'));

  mainWin.once('ready-to-show', () => {
    if (saved.maximized) mainWin.maximize();
    mainWin.show();
  });

  ['maximize', 'unmaximize', 'enter-full-screen', 'leave-full-screen'].forEach((event) => {
    mainWin.on(event, broadcastWindowState);
  });
  mainWin.on('resize', scheduleStateSave);
  mainWin.on('move', scheduleStateSave);
  mainWin.on('maximize', scheduleStateSave);
  mainWin.on('unmaximize', scheduleStateSave);

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
    height: 640,
    minWidth: 620,
    minHeight: 560,
    show: false,
    resizable: true,
    minimizable: false,
    maximizable: false,
    title: '连接飞牛 NAS',
    backgroundColor: '#14171c',
    icon: iconPath(),
    parent: parent && !parent.isDestroyed() ? parent : undefined,
    webPreferences: {
      preload: path.join(PRELOAD_DIR, 'shell.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    }
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
    width: 780,
    height: 700,
    minWidth: 700,
    minHeight: 560,
    show: false,
    title: '设置',
    backgroundColor: '#14171c',
    icon: iconPath(),
    parent: parent && !parent.isDestroyed() ? parent : undefined,
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(PRELOAD_DIR, 'shell.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    }
  });
  settingsWin.loadFile(path.join(RENDERER_DIR, 'settings.html'));
  settingsWin.once('ready-to-show', () => settingsWin.show());
  settingsWin.on('closed', () => {
    settingsWin = null;
  });
  return settingsWin;
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
    {
      label: '设置',
      click: () => createSettings(mainWin)
    },
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

function getMain() {
  return mainWin && !mainWin.isDestroyed() ? mainWin : null;
}

function getConnect() {
  return connectWin && !connectWin.isDestroyed() ? connectWin : null;
}

function getSettings() {
  return settingsWin && !settingsWin.isDestroyed() ? settingsWin : null;
}

module.exports = {
  createMain,
  createConnect,
  createSettings,
  ensureTray,
  getMain,
  getConnect,
  getSettings,
  markQuitting,
  isQuitting
};
