'use strict';

const path = require('node:path');
const { contextBridge, ipcRenderer } = require('electron');
const { pathToFileURL } = require('node:url');

const GUEST_PRELOAD = pathToFileURL(path.join(__dirname, 'guest.js')).toString();

function subscribe(channel, handler) {
  if (typeof handler !== 'function') return () => {};
  const listener = (event, payload) => {
    try {
      handler(payload);
    } catch (err) {
      console.error(`[preload] 处理 ${channel} 失败:`, err && err.message);
    }
  };
  ipcRenderer.on(channel, listener);
  return () => ipcRenderer.removeListener(channel, listener);
}

const invoke = (channel, payload) => ipcRenderer.invoke(channel, payload);

contextBridge.exposeInMainWorld('fnos', {
  guestPreload: GUEST_PRELOAD,
  boot: () => invoke('app:boot'),
  version: () => invoke('app:version'),
  app: {
    openSettings: () => invoke('app:open-settings'),
    openConnect: () => invoke('app:open-connect'),
    openExternal: (url) => invoke('app:open-external', url),
    quit: () => invoke('app:quit'),
    checkUpdate: () => invoke('app:check-update'),
    openRelease: (url) => invoke('app:open-release', url),
    clearCache: () => invoke('app:clear-cache'),
    clearLogin: () => invoke('app:clear-login')
  },
  servers: {
    list: () => invoke('server:list'),
    add: (payload) => invoke('server:add', payload),
    update: (payload) => invoke('server:update', payload),
    remove: (id) => invoke('server:remove', id),
    activate: (id) => invoke('server:activate', id)
  },
  settings: {
    get: () => invoke('settings:get'),
    patch: (patch) => invoke('settings:patch', patch),
    chooseDownloadDir: () => invoke('settings:choose-download-dir'),
    openDownloadDir: () => invoke('settings:open-download-dir')
  },
  window: {
    minimize: () => invoke('window:minimize'),
    toggleMaximize: () => invoke('window:toggle-maximize'),
    close: () => invoke('window:close'),
    state: () => invoke('window:state')
  },
  tabs: {
    register: (payload) => invoke('tab:register', payload),
    unregister: (webContentsId) => invoke('tab:unregister', webContentsId),
    open: (payload) => invoke('tab:open', payload),
    menu: (payload) => invoke('tab:menu', payload)
  },
  session: {
    save: (list) => invoke('session:save', list)
  },
  connect: {
    submit: (payload) => invoke('connect:submit', payload)
  },
  on: subscribe
});
