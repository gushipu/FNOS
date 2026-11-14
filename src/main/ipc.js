'use strict';

const { app, ipcMain, dialog, shell, session, nativeTheme, BrowserWindow, Menu, clipboard } = require('electron');
const store = require('./store');
const windows = require('./windows');
const tabs = require('./tabs');
const downloads = require('./downloads');
const update = require('./update');

function senderWindow(event) {
  try {
    return BrowserWindow.fromWebContents(event.sender);
  } catch (err) {
    return null;
  }
}

function broadcast(channel, payload) {
  [windows.getMain(), windows.getConnect(), windows.getSettings()].forEach((win) => {
    if (win && !win.isDestroyed()) {
      win.webContents.send(channel, payload);
    }
  });
}

function activateServer(server) {
  const win = windows.createMain();
  const connect = windows.getConnect();
  if (connect && !connect.isDestroyed()) {
    setTimeout(() => {
      if (connect && !connect.isDestroyed()) connect.close();
    }, 80);
  }
  if (win && !win.isDestroyed()) {
    win.webContents.send('server:changed', server);
  }
  return win;
}

function showTabMenu(event, payload) {
  const win = senderWindow(event);
  if (!win) return { ok: false };
  const tabId = payload && payload.tabId;
  const url = (payload && payload.url) || '';
  const isDesktop = payload && payload.kind === 'desktop';

  const template = [
    {
      label: '刷新',
      accelerator: 'F5',
      click: () => win.webContents.send('tabs:command', { tabId, action: 'reload' })
    },
    {
      label: '复制页面地址',
      enabled: !!url,
      click: () => clipboard.writeText(url)
    },
    {
      label: '在系统浏览器中打开',
      enabled: /^https?:\/\//i.test(url),
      click: () => shell.openExternal(url).catch(() => {})
    },
    { type: 'separator' },
    {
      label: '关闭标签页',
      enabled: !isDesktop,
      click: () => win.webContents.send('tabs:command', { tabId, action: 'close' })
    },
    {
      label: '关闭其他标签页',
      click: () => win.webContents.send('tabs:command', { tabId, action: 'close-others' })
    },
    { type: 'separator' },
    {
      label: '检查元素',
      click: () => win.webContents.send('tabs:command', { tabId, action: 'devtools' })
    }
  ];

  Menu.buildFromTemplate(template).popup({ window: win });
  return { ok: true };
}

function register() {
  ipcMain.handle('app:boot', () => ({
    platform: process.platform,
    appName: app.getName(),
    version: app.getVersion(),
    partition: downloads.DOWNLOAD_PARTITION,
    settings: store.getSettings(),
    servers: store.listServers(),
    activeServer: store.activeServer(),
    sessionTabs: store.readSessionTabs()
  }));

  ipcMain.handle('app:version', () => app.getVersion());

  ipcMain.handle('app:open-settings', (event) => {
    windows.createSettings(senderWindow(event) || windows.getMain());
    return { ok: true };
  });

  ipcMain.handle('app:open-connect', (event) => {
    windows.createConnect(senderWindow(event) || windows.getMain());
    return { ok: true };
  });

  ipcMain.handle('app:open-external', (event, url) => {
    if (!/^https?:\/\//i.test(String(url || ''))) return { ok: false };
    shell.openExternal(String(url)).catch(() => {});
    return { ok: true };
  });

  ipcMain.handle('app:quit', () => {
    windows.markQuitting();
    app.quit();
    return { ok: true };
  });

  ipcMain.handle('app:check-update', () => update.check());

  ipcMain.handle('app:open-release', (event, url) => {
    update.openReleasePage(url).catch(() => {});
    return { ok: true };
  });

  ipcMain.handle('app:clear-cache', async () => {
    const ses = session.fromPartition(downloads.DOWNLOAD_PARTITION);
    try {
      await ses.clearCache();
      await ses.clearStorageData({ storages: ['cachestorage', 'shadercache', 'serviceworkers'] });
      return { ok: true };
    } catch (err) {
      return { ok: false, error: err && err.message };
    }
  });

  ipcMain.handle('app:clear-login', async () => {
    const ses = session.fromPartition(downloads.DOWNLOAD_PARTITION);
    try {
      await ses.clearStorageData();
      return { ok: true };
    } catch (err) {
      return { ok: false, error: err && err.message };
    }
  });

  ipcMain.handle('server:list', () => ({
    servers: store.listServers(),
    activeId: store.get().activeServerId
  }));

  ipcMain.handle('server:add', (event, payload) => {
    const result = store.addServer(payload || {});
    if (!result.ok) return result;
    activateServer(result.server);
    return result;
  });

  ipcMain.handle('server:update', (event, payload) => store.updateServer(payload && payload.id, payload || {}));
  ipcMain.handle('server:remove', (event, id) => store.removeServer(id));
  ipcMain.handle('server:activate', (event, id) => {
    const result = store.setActiveServer(id);
    if (result.ok) activateServer(result.server);
    return result;
  });

  ipcMain.handle('settings:get', () => store.getSettings());

  ipcMain.handle('settings:patch', (event, patch) => {
    const next = store.patchSettings(patch || {});
    if (patch && typeof patch.theme === 'string') nativeTheme.themeSource = patch.theme;
    broadcast('settings:changed', next);
    return next;
  });

  ipcMain.handle('settings:choose-download-dir', async (event) => {
    const win = senderWindow(event);
    const result = await dialog.showOpenDialog(win || undefined, {
      title: '选择下载保存目录',
      properties: ['openDirectory', 'createDirectory']
    });
    if (result.canceled || !result.filePaths.length) return { ok: false };
    const dir = result.filePaths[0];
    const next = store.patchSettings({ downloadDir: dir });
    broadcast('settings:changed', next);
    return { ok: true, dir };
  });

  ipcMain.handle('settings:open-download-dir', async () => {
    const dir = downloads.downloadDir();
    const error = await shell.openPath(dir);
    return { ok: !error, dir, error };
  });

  ipcMain.handle('window:minimize', (event) => {
    const win = senderWindow(event);
    if (win) win.minimize();
    return { ok: true };
  });

  ipcMain.handle('window:toggle-maximize', (event) => {
    const win = senderWindow(event);
    if (!win) return { ok: false, maximized: false };
    if (win.isMaximized()) win.unmaximize();
    else win.maximize();
    return { ok: true, maximized: win.isMaximized() };
  });

  ipcMain.handle('window:close', (event) => {
    const win = senderWindow(event);
    if (win) win.close();
    return { ok: true };
  });

  ipcMain.handle('window:state', (event) => {
    const win = senderWindow(event);
    return {
      maximized: !!win && win.isMaximized(),
      fullscreen: !!win && win.isFullScreen()
    };
  });

  ipcMain.handle('tab:register', (event, payload) => tabs.registerTab(senderWindow(event), payload || {}));
  ipcMain.handle('tab:unregister', (event, webContentsId) => {
    tabs.unregisterTab(webContentsId);
    return { ok: true };
  });
  ipcMain.handle('tab:open', (event, payload) => {
    const data = payload || {};
    const win = senderWindow(event) || windows.getMain();
    tabs.openTab(data.url, { win, kind: data.kind || 'app', title: data.title || '', source: 'renderer' });
    return { ok: true };
  });

  ipcMain.handle('tab:menu', (event, payload) => showTabMenu(event, payload));

  ipcMain.handle('session:save', (event, list) => {
    store.saveSessionTabs(list);
    return { ok: true };
  });

  ipcMain.handle('connect:submit', (event, payload) => {
    const result = store.addServer(payload || {});
    if (result.ok) activateServer(result.server);
    return result;
  });

  ipcMain.on('guest:route', (event, payload) => {
    try {
      tabs.handleRouteChange(event.sender, payload && payload.href);
    } catch (err) {
      console.error('[ipc] 路由处理失败:', err && err.message);
    }
  });

  ipcMain.on('guest:shortcut', (event, action) => {
    const win = windows.getMain();
    if (win && !win.isDestroyed()) win.webContents.send('shortcuts:run', action);
  });

  ipcMain.on('guest:fullscreen', (event, payload) => {
    const win = windows.getMain();
    if (!win || win.isDestroyed()) return;
    win.webContents.send('tab:fullscreen', { active: !!(payload && payload.active) });
  });
}

module.exports = { register };
