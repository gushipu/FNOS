'use strict';

const { app, Menu, nativeTheme, shell } = require('electron');

const store = require('./store');
const windows = require('./windows');
const tabs = require('./tabs');
const downloads = require('./downloads');
const menu = require('./menu');
const ipc = require('./ipc');

app.setAppUserModelId('com.gushipu.fnos');

const singleInstance = app.requestSingleInstanceLock();

if (!singleInstance) {
  app.quit();
} else {
  app.on('second-instance', () => {
    const win = windows.getMain() || windows.getConnect();
    if (!win) return;
    if (win.isMinimized()) win.restore();
    win.show();
    win.focus();
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
    nativeTheme.themeSource = store.getSettings().theme || 'system';

    if (process.platform === 'darwin') {
      Menu.setApplicationMenu(menu.buildAppMenu());
    } else {
      Menu.setApplicationMenu(null);
    }

    ipc.register();
    downloads.attachAll();

    if (store.activeServer()) {
      windows.createMain();
    } else {
      windows.createConnect();
    }
  });

  app.on('activate', () => {
    if (windows.getMain() || windows.getConnect()) return;
    if (store.activeServer()) windows.createMain();
    else windows.createConnect();
  });

  app.on('before-quit', () => {
    windows.markQuitting();
  });

  app.on('window-all-closed', () => {
    if (process.platform === 'darwin') return;
    windows.markQuitting();
    app.quit();
  });
}
