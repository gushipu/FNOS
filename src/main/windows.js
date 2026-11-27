'use strict';

const path = require('node:path');
const { app, BrowserWindow, Tray, Menu, nativeImage, screen, shell, nativeTheme } = require('electron');
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
let updateWin = null;
let liveWin = null;
let logsWin = null;
let appsWin = null;
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
  /* 文字清晰度优先：Windows 窗口级 acrylic 会让整个窗口内容走透明合成，
     Chromium 因此在全窗关闭 ClearType 次像素抗锯齿，标签栏菜单这类小字号
     文字会明显发虚。毛玻璃观感改由渲染层 backdrop-filter 承担，主窗改用
     不透明底色，保证文字走 ClearType 渲染。 */
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
  const appearance = appearanceOptions();

  mainWin = new BrowserWindow(Object.assign({
    x: bounds.x,
    y: bounds.y,
    width: bounds.width,
    height: bounds.height,
    minWidth: 960,
    minHeight: 600,
    show: false,
    title: '飞牛 NAS',
    backgroundColor: nativeTheme.shouldUseDarkColors ? '#14171c' : '#f4f5f7',
    icon: iconPath(),
    frame: isMac,
    titleBarStyle: isMac ? 'hiddenInset' : 'default',
    trafficLightPosition: isMac ? { x: 18, y: 20 } : undefined,
    autoHideMenuBar: true,
    webPreferences: basePrefs({ webviewTag: true, backgroundThrottling: false })
  }, appearance));

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
  const isMacFrame = process.platform === 'darwin';
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
    frame: isMacFrame,
    titleBarStyle: isMacFrame ? 'hiddenInset' : 'default',
    trafficLightPosition: isMacFrame ? { x: 18, y: 20 } : undefined,
    backgroundColor: nativeTheme.shouldUseDarkColors ? '#14171c' : '#f4f5f7',
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

/* 让已打开的设置窗口切到指定面板；autoCheck 时顺带触发一次检查更新 */
function focusSettingsPanel(win, panel, autoCheck) {
  if (!win || win.isDestroyed() || !panel) return;
  const run = () => {
    const script = `window.showSettingsPanel && window.showSettingsPanel(${JSON.stringify(panel)}, ${autoCheck ? 'true' : 'false'})`;
    try {
      const result = win.webContents.executeJavaScript(script, true);
      if (result && typeof result.catch === 'function') result.catch(() => {});
    } catch (err) { /* ignore */ }
  };
  if (win.webContents.isLoading()) win.webContents.once('did-finish-load', run);
  else run();
}

function createSettings(parent, panel, autoCheck) {
  if (settingsWin && !settingsWin.isDestroyed()) {
    settingsWin.show();
    settingsWin.focus();
    focusSettingsPanel(settingsWin, panel, autoCheck);
    return settingsWin;
  }
  const isMacFrame = process.platform === 'darwin';
  settingsWin = new BrowserWindow({
    width: 880,
    height: 760,
    minWidth: 760,
    minHeight: 600,
    show: false,
    title: '设置',
    frame: isMacFrame,
    titleBarStyle: isMacFrame ? 'hiddenInset' : 'default',
    trafficLightPosition: isMacFrame ? { x: 18, y: 20 } : undefined,
    backgroundColor: nativeTheme.shouldUseDarkColors ? '#14171c' : '#f4f5f7',
    icon: iconPath(),
    parent: parent && !parent.isDestroyed() ? parent : undefined,
    autoHideMenuBar: true,
    webPreferences: basePrefs()
  });
  if (panel) settingsWin.loadFile(path.join(RENDERER_DIR, 'settings.html'), { hash: panel });
  else settingsWin.loadFile(path.join(RENDERER_DIR, 'settings.html'));
  focusSettingsPanel(settingsWin, panel, autoCheck);
  settingsWin.once('ready-to-show', () => settingsWin.show());
  settingsWin.on('closed', () => {
    settingsWin = null;
  });
  return settingsWin;
}

function createUpdate(parent) {
  if (updateWin && !updateWin.isDestroyed()) {
    updateWin.show();
    updateWin.focus();
    return updateWin;
  }
  const isMacFrame = process.platform === 'darwin';
  updateWin = new BrowserWindow({
    width: 640,
    height: 620,
    minWidth: 560,
    minHeight: 520,
    show: false,
    resizable: true,
    minimizable: true,
    maximizable: false,
    title: '软件更新',
    frame: isMacFrame,
    titleBarStyle: isMacFrame ? 'hiddenInset' : 'default',
    trafficLightPosition: isMacFrame ? { x: 18, y: 20 } : undefined,
    backgroundColor: nativeTheme.shouldUseDarkColors ? '#14171c' : '#f4f5f7',
    icon: iconPath(),
    parent: parent && !parent.isDestroyed() ? parent : undefined,
    autoHideMenuBar: true,
    webPreferences: basePrefs()
  });
  updateWin.loadFile(path.join(RENDERER_DIR, 'update.html'));
  updateWin.once('ready-to-show', () => updateWin.show());
  updateWin.on('closed', () => {
    updateWin = null;
  });
  return updateWin;
}

function getUpdate() {
  return updateWin && !updateWin.isDestroyed() ? updateWin : null;
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
    backgroundColor: nativeTheme.shouldUseDarkColors ? '#14171c' : '#f4f5f7',
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
    backgroundColor: nativeTheme.shouldUseDarkColors ? '#14171c' : '#f4f5f7',
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

function createLogs(parent) {
  if (logsWin && !logsWin.isDestroyed()) {
    logsWin.show();
    logsWin.focus();
    return logsWin;
  }
  logsWin = new BrowserWindow({
    width: 1040,
    height: 700,
    minWidth: 780,
    minHeight: 480,
    show: false,
    title: '日志查看器',
    backgroundColor: nativeTheme.shouldUseDarkColors ? '#14171c' : '#f4f5f7',
    icon: iconPath(),
    parent: parent && !parent.isDestroyed() ? parent : undefined,
    autoHideMenuBar: true,
    webPreferences: basePrefs({ backgroundThrottling: false })
  });
  logsWin.loadFile(path.join(RENDERER_DIR, 'logs.html'));
  logsWin.once('ready-to-show', () => logsWin.show());
  logsWin.on('closed', () => {
    logsWin = null;
  });
  return logsWin;
}

function createApps(parent) {
  if (appsWin && !appsWin.isDestroyed()) {
    appsWin.show();
    appsWin.focus();
    return appsWin;
  }
  appsWin = new BrowserWindow({
    width: 1040,
    height: 720,
    minWidth: 780,
    minHeight: 500,
    show: false,
    title: '应用中心',
    backgroundColor: nativeTheme.shouldUseDarkColors ? '#14171c' : '#f4f5f7',
    icon: iconPath(),
    parent: parent && !parent.isDestroyed() ? parent : undefined,
    autoHideMenuBar: true,
    webPreferences: basePrefs({ backgroundThrottling: false })
  });
  appsWin.loadFile(path.join(RENDERER_DIR, 'apps.html'));
  appsWin.once('ready-to-show', () => appsWin.show());
  appsWin.on('closed', () => {
    appsWin = null;
  });
  return appsWin;
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
  /* 托盘不用系统原生菜单，也不再借主窗口的菜单层：
     菜单放在独立的无边框透明窗口里，按托盘图标在屏幕上的真实位置定位；
     图标被折叠进任务栏溢出区（隐藏区域）时 getBounds 会返回无效值，此时退化为按鼠标位置定位，
     两种情况都能贴着图标弹出，不再依赖主窗口是否显示、也不再把主窗口强行拉到前面 */
  const openTrayMenu = () => {
    let bounds = null;
    try { bounds = tray.getBounds(); } catch (err) { bounds = null; }
    openTrayMenuWindow(bounds);
  };
  /* 左键点图标回到主窗口：先收起可能还开着的菜单，再从最小化状态还原并聚焦 */
  const showMainFromTray = () => {
    closeTrayMenu();
    const win = createMain();
    if (win.isMinimized && win.isMinimized()) win.restore();
    win.show();
    /* macOS 上 Dock 图标隐藏后应用不是前台应用，需要主动抢一次焦点，窗口才会出现在最前 */
    if (process.platform === 'darwin') app.focus({ steal: true });
    win.focus();
  };
  tray.on('click', showMainFromTray);
  tray.on('right-click', openTrayMenu);
  tray.on('double-click', showMainFromTray);
  return tray;
}

function refreshTray() {
  if (!tray) return;
  try { tray.destroy(); } catch (err) { /* ignore */ }
  tray = null;
  ensureTray();
}

/* ---------------- 托盘菜单弹层 ----------------
   独立无边框透明窗口承载菜单，位置按托盘图标的屏幕坐标计算。
   图标被折叠进任务栏溢出区时 tray.getBounds() 会返回全零/过期值，此时改用鼠标位置作为锚点，
   这样无论图标可见与否，菜单都会贴着图标（或点出溢出面板的那个图标）弹出。 */
const TRAY_MENU_WIDTH = 268;
let trayMenuWin = null;
let trayMenuAnchor = null;
let trayMenuReady = false;

function validAnchor(bounds) {
  return !!bounds && Number.isFinite(bounds.x) && Number.isFinite(bounds.y)
    && Number.isFinite(bounds.width) && Number.isFinite(bounds.height)
    && bounds.width > 0 && bounds.height > 0;
}

function openTrayMenuWindow(anchor) {
  closeTrayMenu();
  trayMenuAnchor = validAnchor(anchor) ? anchor : null;
  trayMenuReady = false;
  const win = new BrowserWindow({
    width: TRAY_MENU_WIDTH,
    height: 240,
    show: false,
    frame: false,
    transparent: true,
    resizable: false,
    movable: false,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    skipTaskbar: true,
    alwaysOnTop: true,
    hasShadow: false,
    backgroundColor: '#00000000',
    title: '飞牛 NAS 菜单',
    webPreferences: basePrefs()
  });
  trayMenuWin = win;
  try { win.setAlwaysOnTop(true, 'pop-up-menu'); } catch (err) { /* ignore */ }
  win.on('blur', () => {
    /* 只有仍是当前这一层菜单时才关闭：再次点托盘会先建新窗口，旧窗口的 blur 不能误关新菜单 */
    if (trayMenuReady && trayMenuWin === win) closeTrayMenu();
  });
  win.on('closed', () => {
    if (trayMenuWin === win) {
      trayMenuWin = null;
      trayMenuReady = false;
    }
  });
  win.loadFile(path.join(RENDERER_DIR, 'tray-menu.html'));
  return win;
}

function placeTrayMenu(contentHeight) {
  const win = trayMenuWin;
  if (!win || win.isDestroyed()) return;
  const height = Math.max(72, Math.min(Math.round(contentHeight || 240), 640));
  const anchor = trayMenuAnchor;
  const cursor = screen.getCursorScreenPoint();
  const display = screen.getDisplayNearestPoint(anchor ? { x: anchor.x, y: anchor.y } : cursor);
  const area = display.workArea;
  const centerX = anchor ? anchor.x + anchor.width / 2 : cursor.x;
  const iconTop = anchor ? anchor.y : cursor.y - 10;
  const iconBottom = anchor ? anchor.y + anchor.height : cursor.y + 10;
  const upward = (iconTop + iconBottom) / 2 > area.y + area.height / 2;
  let x = Math.round(centerX - TRAY_MENU_WIDTH / 2);
  let y = Math.round(upward ? iconTop - height - 8 : iconBottom + 8);
  x = Math.max(area.x + 4, Math.min(area.x + area.width - TRAY_MENU_WIDTH - 4, x));
  y = Math.max(area.y + 4, Math.min(area.y + area.height - height - 4, y));
  win.setBounds({ x, y, width: TRAY_MENU_WIDTH, height });
  try { win.setAlwaysOnTop(true, 'pop-up-menu'); } catch (err) { /* ignore */ }
  win.show();
  win.focus();
  trayMenuReady = true;
}

function closeTrayMenu() {
  const win = trayMenuWin;
  trayMenuWin = null;
  trayMenuReady = false;
  trayMenuAnchor = null;
  if (win && !win.isDestroyed()) {
    try { win.destroy(); } catch (err) { /* ignore */ }
  }
}

function isTrayMenu(win) {
  return !!trayMenuWin && win === trayMenuWin;
}

/* 其它窗口（主窗口、设置页等）拿到焦点时收起托盘菜单；
   托管这个判断是因为菜单窗口若抢不到焦点，就不会触发自身的 blur */
app.on('browser-window-focus', (event, win) => {
  if (trayMenuReady && trayMenuWin && win !== trayMenuWin) closeTrayMenu();
});

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
  createMain, createConnect, createSettings, createDownloads, createUpdate, createLive,
  createLogs, createApps,
  ensureTray, refreshTray, bindLockHooks, hideAll, showAll,
  openTrayMenuWindow, placeTrayMenu, closeTrayMenu, isTrayMenu,
  allWindows, getMain, getConnect, getSettings, getDownloads, getUpdate, getLive,
  getLogs: () => logsWin, getApps: () => appsWin,
  markQuitting, isQuitting, iconPath, safeBounds
};
