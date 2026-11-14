'use strict';

const { app, Menu, nativeTheme, shell } = require('electron');

const gpu = require('./gpu');
const logger = require('./logger').create('app');

/* GPU 兼容模式必须在 ready 之前生效 */
gpu.apply(app);

const store = require('./store');
const windows = require('./windows');
const tabs = require('./tabs');
const downloads = require('./downloads');
const media = require('./media');
const menu = require('./menu');
const ipc = require('./ipc');
const lock = require('./lock');
const shortcuts = require('./shortcuts');
const applink = require('./applink');
const update = require('./update');

app.setAppUserModelId('com.gushipu.fnos');

const singleInstance = app.requestSingleInstanceLock();
let pendingLink = applink.parseArgv(process.argv);

function focusMain() {
  const win = windows.getMain() || windows.getConnect();
  if (!win) return null;
  if (win.isMinimized()) win.restore();
  win.show();
  win.focus();
  return win;
}

function sendToMain(channel, payload) {
  const win = windows.getMain();
  if (win && !win.isDestroyed()) win.webContents.send(channel, payload);
}

function openAppLink(link) {
  if (!link || link.type !== 'app') return false;
  const servers = store.listServers();
  const server = link.server ? store.findServer(link.server) || servers.find((item) => item.name === link.server) : null;
  if (server && server.id !== (store.activeServer() || {}).id) {
    store.setActiveServer(server.id);
  }
  const target = server || store.activeServer() || servers[0];
  if (!target) return false;
  const base = (target.url || '').replace(/\/+$/, '');
  if (!base) return false;
  const url = base + (link.path || '/v');
  const win = windows.getMain() || windows.createMain();
  if (!win || win.isDestroyed()) return false;
  const fire = () => setTimeout(() => sendToMain('applink:open', { url, name: link.name || '' }), 600);
  if (win.webContents.isLoading()) win.webContents.once('did-finish-load', fire);
  else fire();
  return true;
}

if (!singleInstance) {
  app.quit();
} else {
  app.on('second-instance', (event, argv) => {
    focusMain();
    const link = applink.parseArgv(argv);
    if (link && link.type === 'app') openAppLink(link);
  });

  app.on('open-url', (event, url) => {
    event.preventDefault();
    const link = applink.parseArgv([url]);
    if (link && link.type === 'app') openAppLink(link);
  });

  app.on('web-contents-created', (event, contents) => {
    tabs.attachContents(contents);
    if (contents.getType() !== 'webview') {
      contents.setWindowOpenHandler(({ url }) => {
        if (/^https?:\/\//i.test(url)) shell.openExternal(url).catch(() => {});
        return { action: 'deny' };
      });
    }
  });

  app.whenReady().then(() => {
    store.init();
    logger.info('应用启动', { version: app.getVersion(), platform: process.platform, gpuCompat: gpu.rawEnabled() });
    nativeTheme.themeSource = store.getSettings().theme || 'system';

    if (process.platform === 'darwin') {
      Menu.setApplicationMenu(menu.buildAppMenu());
    } else {
      Menu.setApplicationMenu(null);
    }

    ipc.register();
    downloads.attachAll();
    windows.bindLockHooks();
    windows.ensureTray();

    media.setListener((row) => sendToMain('media:sniffed', row));

    shortcuts.bind({
      newTab: () => sendToMain('shortcut:run', { action: 'newTab' }),
      closeTab: () => sendToMain('shortcut:run', { action: 'closeTab' }),
      reload: () => sendToMain('shortcut:run', { action: 'reload' }),
      reopenTab: () => sendToMain('shortcut:run', { action: 'reopenTab' }),
      downloads: () => windows.createDownloads(windows.getMain()),
      live: () => windows.createLive(windows.getMain()),
      lock: () => lock.lock('shortcut'),
      boss: () => lock.bossToggle()
    });
    shortcuts.apply();
    lock.restartIdleWatch();

    const server = store.activeServer();
    if (server) {
      ipc.ensureSession(store.partitionOf(server.id));
      const win = windows.createMain();
      if (store.getSettings().lockEnabled && store.getSettings().lockOnStart) {
        win.webContents.once('did-finish-load', () => lock.lock('startup'));
      }
    } else {
      windows.createConnect();
    }

    if (pendingLink && pendingLink.type === 'app') {
      const link = pendingLink;
      pendingLink = null;
      setTimeout(() => openAppLink(link), 400);
    }

    update.scheduleAutoCheck(9000);
  });

  app.on('activate', () => {
    if (windows.getMain() || windows.getConnect()) return;
    if (store.activeServer()) windows.createMain();
    else windows.createConnect();
  });

  app.on('before-quit', () => {
    windows.markQuitting();
    try { shortcuts.dispose(); } catch (err) { /* ignore */ }
  });

  app.on('will-quit', () => {
    try { shortcuts.dispose(); } catch (err) { /* ignore */ }
  });

  app.on('window-all-closed', () => {
    if (process.platform === 'darwin') return;
    windows.markQuitting();
    app.quit();
  });
}
