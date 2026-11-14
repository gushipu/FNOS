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

const invoke = (channel, ...args) => ipcRenderer.invoke(channel, ...args);

contextBridge.exposeInMainWorld('fnos', {
  guestPreload: GUEST_PRELOAD,
  platform: process.platform,

  boot: () => invoke('app:boot'),
  version: () => invoke('app:version'),

  app: {
    openSettings: () => invoke('app:open-settings'),
    openConnect: () => invoke('app:open-connect'),
    openDownloads: () => invoke('app:open-downloads'),
    openLive: () => invoke('app:open-live'),
    openExternal: (url) => invoke('app:open-external', url),
    openPath: (target) => invoke('app:open-path', target),
    openLogDir: () => invoke('app:open-log-dir'),
    logTail: (lines) => invoke('app:log-tail', lines),
    quit: () => invoke('app:quit'),
    restart: () => invoke('app:restart'),
    checkUpdate: (silent) => invoke('app:check-update', silent),
    downloadUpdate: (url, name) => invoke('update:download', url, name),
    openRelease: (url) => invoke('app:open-release', url),
    clearCache: () => invoke('app:clear-cache'),
    clearLogin: () => invoke('app:clear-login')
  },

  servers: {
    list: () => invoke('server:list'),
    add: (payload) => invoke('server:add', payload),
    update: (id, patch) => (patch === undefined
      ? invoke('server:update', id)
      : invoke('server:update', id, patch)),
    remove: (id) => invoke('server:remove', id),
    activate: (id) => invoke('server:activate', id),
    status: (id) => invoke('server:status', id)
  },

  vault: {
    status: () => invoke('vault:status'),
    get: (key) => invoke('vault:get', key),
    set: (key, value) => invoke('vault:set', key, value),
    clear: () => invoke('vault:clear')
  },

  settings: {
    get: () => invoke('settings:get'),
    patch: (patch) => invoke('settings:patch', patch),
    chooseDownloadDir: () => invoke('settings:choose-download-dir'),
    openDownloadDir: () => invoke('settings:open-download-dir')
  },

  window: {
    minimize: () => invoke('window:minimize'),
    toggleMaximize: () => invoke('window:toggle-maximize-state'),
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
    save: (list) => invoke('session:save', list),
    read: () => invoke('session:read')
  },

  connect: {
    submit: (payload) => invoke('connect:submit', payload)
  },

  downloads: {
    list: () => invoke('downloads:list'),
    control: (id, action) => invoke('downloads:control', id, action),
    pauseAll: () => invoke('downloads:pause-all'),
    open: (id) => invoke('downloads:open', id),
    folder: (id) => invoke('downloads:folder', id),
    remove: (id) => invoke('downloads:remove', id),
    clear: () => invoke('downloads:clear'),
    chooseDir: () => invoke('downloads:choose-dir')
  },

  media: {
    list: () => invoke('media:list'),
    clear: () => invoke('media:clear')
  },

  mpv: {
    status: () => invoke('mpv:status'),
    pick: () => invoke('mpv:pick'),
    play: (payload) => invoke('mpv:play', payload),
    playMedia: (id) => invoke('mpv:play-media', id)
  },

  live: {
    state: () => invoke('live:state'),
    addSource: (payload) => invoke('live:add-source', payload),
    removeSource: (id) => invoke('live:remove-source', id),
    load: (sourceId) => invoke('live:load', sourceId),
    favorite: (channel) => invoke('live:favorite', channel),
    epg: (url) => invoke('live:epg', url),
    saveRecording: (name, base64) => invoke('live:save-recording', name, base64),
    playMpv: (channel) => invoke('live:play-mpv', channel)
  },

  skin: {
    list: () => invoke('skin:list'),
    apply: (id) => invoke('skin:apply', id),
    importPack: () => invoke('skin:import'),
    exportPack: (id) => invoke('skin:export', id),
    remove: (id) => invoke('skin:remove', id)
  },

  lock: {
    status: () => invoke('lock:status'),
    setPassword: (password) => invoke('lock:set-password', password),
    changePassword: (oldPassword, newPassword) => invoke('lock:change-password', oldPassword, newPassword),
    clearPassword: (password) => invoke('lock:clear-password', password),
    enable: (options) => invoke('lock:enable', options),
    verify: (password) => invoke('lock:verify', password),
    unlock: (password) => invoke('lock:unlock', password),
    lock: () => invoke('lock:lock'),
    bossToggle: () => invoke('lock:boss-toggle')
  },

  shortcuts: {
    list: () => invoke('shortcut:list'),
    validate: (accelerator) => invoke('shortcut:validate', accelerator),
    update: (id, accelerator) => invoke('shortcut:update', id, accelerator),
    reset: () => invoke('shortcut:reset')
  },

  applink: {
    info: () => invoke('applink:info'),
    pickDir: () => invoke('applink:pick-dir'),
    create: (payload) => invoke('applink:create', payload)
  },

  on: subscribe
});
