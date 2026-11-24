'use strict';

const path = require('node:path');
const fs = require('node:fs');
const {
  app, ipcMain, dialog, shell, session, nativeTheme, BrowserWindow, Menu, clipboard, webContents
} = require('electron');

const store = require('./store');
const addr = require('./addr');
const windows = require('./windows');
const tabs = require('./tabs');
const downloads = require('./downloads');
const update = require('./update');
const lock = require('./lock');
const skins = require('./fskin');
const mpv = require('./mpv');
const live = require('./live');
const media = require('./media');
const shortcuts = require('./shortcuts');
const applink = require('./applink');
const logger = require('./logger');

const log = logger.create('ipc');

function senderWindow(event) {
  try {
    return BrowserWindow.fromWebContents(event.sender);
  } catch (err) {
    return null;
  }
}

function broadcast(channel, payload) {
  [windows.getMain(), windows.getConnect(), windows.getSettings(), windows.getDownloads(), windows.getLive()]
    .forEach((win) => {
      if (win && !win.isDestroyed()) win.webContents.send(channel, payload);
    });
}

function activePartition() {
  const server = store.activeServer();
  if (!server) return 'persist:fnos';
  return store.partitionOf(server.id);
}

function sessionOf(partition) {
  try {
    return session.fromPartition(partition);
  } catch (err) {
    return session.defaultSession;
  }
}

/* store 的服务器方法统一返回 { ok, server, ... } 包装，
   这里统一取出真正的服务器对象，避免把包装当服务器用（id/url 为 undefined）。 */
function unpackServer(result) {
  if (!result || typeof result !== 'object') return null;
  const inner = result.server;
  return inner && typeof inner === 'object' ? inner : result;
}

function ensureSession(partition) {
  const ses = sessionOf(partition);
  try {
    downloads.attach(ses);
    media.attach(ses);
  } catch (err) {
    log.error('挂载分区能力失败', err && err.message);
  }
  return ses;
}

function activateServer(server) {
  const win = windows.createMain();
  const connect = windows.getConnect();
  if (connect && !connect.isDestroyed()) {
    setTimeout(() => {
      if (connect && !connect.isDestroyed()) connect.close();
    }, 80);
  }
  if (!server || !server.id || !server.url) {
    log.error('切换设备失败：设备信息不完整', JSON.stringify(server && { id: server.id, url: server.url }));
    return win;
  }
  if (win && !win.isDestroyed()) {
    const payload = {
      ...server,
      partition: store.partitionOf(server.id)
    };
    /* 主窗可能是本轮才创建（从连接窗/设置窗切换设备）：
       渲染层尚未加载完时直接 send 会丢事件，导致“切换设备没反应”。
       先判断是否仍在加载，加载完再补发，并做一次短轮询兜底。 */
    const deliver = () => {
      if (win.isDestroyed()) return;
      win.webContents.send('server:changed', payload);
    };
    if (win.webContents.isLoading()) {
      win.webContents.once('did-finish-load', deliver);
    } else {
      deliver();
    }
  }
  return win;
}

function showTabMenu(event, payload) {
  const win = senderWindow(event);
  if (!win) return { ok: false };
  const tabId = payload && payload.tabId;
  const url = (payload && payload.url) || '';
  const isDesktop = payload && payload.kind === 'desktop';
  const send = (action) => win.webContents.send('tabs:command', { tabId, action });

  const mediaRows = media.list().slice(0, 5);
  const template = [
    { label: '刷新', accelerator: 'F5', click: () => send('reload') },
    { label: '复制页面地址', enabled: !!url, click: () => clipboard.writeText(url) },
    {
      label: '在系统浏览器中打开',
      enabled: /^https?:\/\//i.test(url),
      click: () => shell.openExternal(url).catch(() => {})
    },
    {
      label: '用 MPV 播放当前页媒体',
      enabled: mpv.status().available && mediaRows.length > 0,
      click: async () => {
        const first = mediaRows[0];
        const cookie = await media.cookieFor(win.webContents.session, first.url);
        mpv.play({ url: first.url, cookie, title: '标签页媒体' });
      }
    },
    { type: 'separator' },
    { label: '关闭标签页', enabled: !isDesktop, click: () => send('close') },
    { label: '关闭其他标签页', enabled: !isDesktop, click: () => send('close-others') },
    { label: '复制标签页地址到剪贴板', enabled: !!url, click: () => clipboard.writeText(url) },
    { type: 'separator' },
    { label: '下载中心', click: () => windows.createDownloads(win) },
    { label: '电视直播', click: () => windows.createLive(win) }
  ];
  Menu.buildFromTemplate(template).popup({ window: win });
  return { ok: true };
}

function register() {
  /* ---------------- 启动与全局 ---------------- */
  ipcMain.handle('app:boot', () => {
    const server = store.activeServer();
    const partition = server ? store.partitionOf(server.id) : 'persist:fnos';
    ensureSession(partition);
    return {
      platform: process.platform,
      appName: app.getName(),
      version: app.getVersion(),
      partition,
      settings: store.getSettings(),
      servers: store.listServers(),
      activeServer: server,
      sessionTabs: store.readSessionTabs(),
      lock: lock.status(),
      skin: skins.current(),
      skins: skins.list(),
      mpv: mpv.status(),
      shortcuts: shortcuts.list(),
      downloads: downloads.list(),
      media: media.list(),
      userData: app.getPath('userData'),
      downloadsDir: downloads.downloadDir()
    };
  });

  ipcMain.handle('app:version', () => ({
    version: app.getVersion(),
    electron: process.versions.electron,
    chrome: process.versions.chrome,
    node: process.versions.node,
    platform: process.platform
  }));

  ipcMain.handle('app:open-settings', () => {
    windows.createSettings(windows.getMain());
    return { ok: true };
  });

  ipcMain.handle('app:open-connect', () => {
    windows.createConnect(windows.getMain());
    return { ok: true };
  });

  ipcMain.handle('app:open-update', () => {
    windows.createUpdate(windows.getMain());
    return { ok: true };
  });

  ipcMain.handle('app:open-installer', (event, file) => {
    const result = update.openInstaller(file);
    return result || { ok: false };
  });

  ipcMain.handle('app:open-downloads', () => {
    windows.createDownloads(windows.getMain());
    return { ok: true };
  });

  ipcMain.handle('app:open-live', () => {
    windows.createLive(windows.getMain());
    return { ok: true };
  });

  ipcMain.handle('app:open-external', (event, url) => {
    if (!/^https?:\/\//i.test(String(url || ''))) return { ok: false };
    return shell.openExternal(url).then(() => ({ ok: true })).catch((err) => ({ ok: false, error: err.message }));
  });

  ipcMain.handle('app:open-path', (event, target) => {
    if (!target) return { ok: false };
    return shell.openPath(String(target)).then((msg) => ({ ok: !msg, error: msg })).catch((err) => ({ ok: false, error: err.message }));
  });

  ipcMain.handle('app:quit', () => {
    windows.markQuitting();
    app.quit();
    return { ok: true };
  });

  ipcMain.handle('app:restart', () => {
    windows.markQuitting();
    app.relaunch();
    app.exit(0);
    return { ok: true };
  });

  ipcMain.handle('app:open-log-dir', () => shell.openPath(logger.dir()));

  ipcMain.handle('app:log-tail', (event, lines) => logger.tail(Number(lines) || 200));

  ipcMain.handle('app:clear-cache', async () => {
    try {
      await ensureSession(activePartition()).clearCache();
      return { ok: true };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  });

  /* ---------------- 托盘菜单弹层（独立窗口） ---------------- */
  const TRAY_UI_ACTIONS = new Set(['new-tab', 'reload', 'devtools', 'activate-server']);

  function trayMenuItems() {
    const servers = store.listServers() || [];
    const active = store.activeServer();
    const main = windows.getMain();
    const visible = !!(main && !main.isDestroyed() && main.isVisible() && !main.isMinimized());
    const mac = process.platform === 'darwin';
    const items = [
      { key: 'toggle-window', label: visible ? '隐藏主窗口' : '显示主窗口' },
      { separator: true },
      { key: 'new-tab', label: '新建标签页', hint: mac ? '⌘T' : 'Ctrl+T' },
      { key: 'reload', label: '重新加载', hint: mac ? '⌘R' : 'Ctrl+R' },
      { separator: true }
    ];
    servers.forEach((server) => {
      items.push({
        key: 'activate-server',
        id: server.id,
        label: server.name || '未命名设备',
        hint: String(server.url || '').replace(/^https?:\/\//, ''),
        checked: !!(active && active.id === server.id)
      });
    });
    if (servers.length) items.push({ separator: true });
    items.push({ key: 'add-server', label: '添加设备地址…' });
    items.push({ key: 'settings', label: '打开设置…' });
    items.push({ separator: true });
    items.push({ key: 'clear-cache', label: '清除页面缓存' });
    items.push({ key: 'check-update', label: '检查更新' });
    items.push({ key: 'devtools', label: '开发者工具' });
    items.push({ separator: true });
    items.push({ key: 'quit', label: '退出' });
    return { items, version: app.getVersion(), platform: process.platform };
  }

  ipcMain.handle('tray-menu:items', (event) => {
    if (!windows.isTrayMenu(senderWindow(event))) return { items: [] };
    return trayMenuItems();
  });

  /* 渲染层量完内容高度再报告，主进程据此定位并显示，避免菜单先以占位高度闪一下 */
  ipcMain.handle('tray-menu:ready', (event, payload) => {
    if (!windows.isTrayMenu(senderWindow(event))) return { ok: false };
    windows.placeTrayMenu(payload && payload.height);
    return { ok: true };
  });

  ipcMain.handle('tray-menu:close', () => {
    windows.closeTrayMenu();
    return { ok: true };
  });

  ipcMain.handle('tray-menu:action', async (event, payload) => {
    const name = payload && payload.name ? String(payload.name) : '';
    const id = payload && payload.id;
    const menuWin = senderWindow(event);
    if (menuWin && !menuWin.isDestroyed()) {
      try { menuWin.hide(); } catch (err) { /* ignore */ }
    }
    setTimeout(() => windows.closeTrayMenu(), 50);
    switch (name) {
      case 'toggle-window': {
        const win = windows.createMain();
        if (!win) return { ok: false, error: '主窗口不可用' };
        if (win.isVisible() && !win.isMinimized()) {
          win.hide();
        } else {
          if (win.isMinimized()) win.restore();
          win.show();
          win.focus();
        }
        return { ok: true };
      }
      case 'settings':
        windows.createSettings(windows.getMain());
        return { ok: true };
      case 'add-server':
        windows.createConnect(windows.getMain());
        return { ok: true };
      case 'clear-cache':
        try {
          await ensureSession(activePartition()).clearCache();
          return { ok: true };
        } catch (err) {
          return { ok: false, error: err.message };
        }
      case 'check-update':
        windows.createSettings(windows.getMain(), 'about', true);
        return { ok: true };
      case 'quit':
        windows.markQuitting();
        app.quit();
        return { ok: true };
      default: {
        if (!TRAY_UI_ACTIONS.has(name)) return { ok: false, error: '未知动作' };
        const win = windows.createMain();
        if (!win) return { ok: false, error: '主窗口不可用' };
        if (win.isMinimized()) win.restore();
        if (!win.isVisible()) win.show();
        win.focus();
        const deliver = () => {
          try { win.webContents.send('tray:do', { action: name, id }); } catch (err) { /* ignore */ }
        };
        if (win.webContents.isLoading()) win.webContents.once('did-finish-load', deliver);
        else deliver();
        return { ok: true };
      }
    }
  });

  ipcMain.handle('app:clear-login', async () => {
    try {
      await ensureSession(activePartition()).clearStorageData();
      return { ok: true };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  });

  /* ---------------- 服务器 ---------------- */
  ipcMain.handle('server:list', () => {
    const servers = store.listServers().map((server) => ({
      ...server,
      partition: store.partitionOf(server.id)
    }));
    return { servers, activeId: (store.activeServer() || {}).id || '' };
  });

  ipcMain.handle('server:add', (event, input) => {
    try {
      const result = store.addServer(input);
      if (!result || result.ok === false) return result || { ok: false, error: '添加失败' };
      const server = unpackServer(result);
      ensureSession(store.partitionOf(server.id));
      broadcast('server:list-changed', store.listServers());
      return { ok: true, server };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  });

  ipcMain.handle('server:update', (event, id, patch) => {
    try {
      const payload = id && typeof id === 'object' ? id : { id, patch };
      const targetId = id && typeof id === 'object' ? payload.id : id;
      const result = store.updateServer(targetId, (id && typeof id === 'object' ? payload.patch : patch) || {});
      if (!result || result.ok === false) return result || { ok: false, error: '更新失败' };
      const server = unpackServer(result);
      broadcast('server:list-changed', store.listServers());
      // 改的若是当前正在使用的设备，必须让界面按新地址重建，否则会停在旧地址上无响应
      const active = store.activeServer();
      if (active && server && server.id && active.id === server.id) {
        broadcast('server:changed', { ...server, partition: store.partitionOf(server.id) });
      }
      return { ok: true, server };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  });

  ipcMain.handle('server:remove', (event, id) => {
    try {
      store.removeServer(id);
      broadcast('server:list-changed', store.listServers());
      return { ok: true };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  });

  ipcMain.handle('server:activate', (event, id) => {
    try {
      const result = store.setActiveServer(id);
      if (!result || result.ok === false) return result || { ok: false, error: '切换失败' };
      const server = unpackServer(result);
      if (!server || !server.id) return { ok: false, error: '设备记录无效' };
      const partition = store.partitionOf(server.id);
      ensureSession(partition);
      store.saveSessionTabs([]);
      activateServer(server);
      broadcast('server:list-changed', store.listServers());
      return { ok: true, server, partition };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  });

  ipcMain.handle('server:status', (event, id) => {
    const server = store.findServer(id);
    if (!server) return { ok: false };
    return { ok: true, server, partition: store.partitionOf(id) };
  });

  /* ---------------- 凭据保险箱 ---------------- */
  ipcMain.handle('vault:status', () => store.vaultStatus());

  ipcMain.handle('vault:get', (event, key) => {
    const value = store.vaultGet(key);
    return { ok: true, value };
  });

  ipcMain.handle('vault:set', (event, key, value) => {
    try {
      const result = store.vaultSet(key, value);
      return { ok: true, encrypted: !!(result && result.encrypted) };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  });

  ipcMain.handle('vault:clear', (event, key) => {
    try {
      store.vaultClear(key);
      return { ok: true };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  });

  // 当前活动设备的凭据，供客页登录表单自动填充
  ipcMain.handle('vault:active', () => {
    const active = store.activeServer();
    if (!active || !active.id) return { ok: true, serverId: '', value: { username: '', password: '' } };
    return { ok: true, serverId: active.id, value: store.vaultGet(active.id) };
  });

  /* ---------------- 设置 ---------------- */
  ipcMain.handle('settings:get', () => store.getSettings());

  ipcMain.handle('settings:patch', (event, patch) => {
    const next = store.patchSettings(patch || {});
    if (patch && patch.theme) nativeTheme.themeSource = patch.theme;
    broadcast('settings:changed', next);
    if (patch && (patch.bossKey !== undefined || patch.bossKeyEnabled !== undefined
      || patch.shortcuts !== undefined || patch.lockEnabled !== undefined)) {
      shortcuts.apply();
      lock.restartIdleWatch();
      windows.refreshTray();
    }
    return next;
  });

  ipcMain.handle('settings:choose-download-dir', async (event) => {
    const win = senderWindow(event);
    const result = await dialog.showOpenDialog(win || undefined, {
      title: '选择下载目录',
      properties: ['openDirectory', 'createDirectory']
    });
    if (result.canceled || !result.filePaths.length) return { ok: false };
    store.patchSettings({ downloadDir: result.filePaths[0] });
    broadcast('settings:changed', store.getSettings());
    return { ok: true, dir: result.filePaths[0] };
  });

  ipcMain.handle('settings:open-download-dir', () => shell.openPath(downloads.downloadDir()));

  /* ---------------- 窗口 ---------------- */
  ipcMain.handle('window:minimize', (event) => {
    const win = senderWindow(event);
    if (win) win.minimize();
    return { ok: true };
  });

  ipcMain.on('window:toggle-maximize', (event) => {
    const win = senderWindow(event);
    if (!win) return;
    if (win.isMaximized()) win.unmaximize();
    else win.maximize();
  });

  ipcMain.handle('window:toggle-maximize-state', (event) => {
    const win = senderWindow(event);
    if (!win) return { ok: false };
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
    if (!win) return { maximized: false, fullscreen: false };
    return { maximized: win.isMaximized(), fullscreen: win.isFullScreen() };
  });

  /* ---------------- 标签页 ---------------- */
  ipcMain.handle('tab:register', (event, payload) => {
    tabs.registerTab(event.sender, payload || {});
    try {
      downloads.attach(event.sender.session);
      media.attach(event.sender.session);
    } catch (err) { /* ignore */ }
    return { ok: true };
  });

  ipcMain.handle('tab:unregister', (event) => {
    tabs.unregisterTab(event.sender.id);
    return { ok: true };
  });

  ipcMain.handle('tab:open', (event, payload, options) => {
    const input = typeof payload === 'string' ? { url: payload } : (payload || {});
    const target = input.url || input.href || '';
    const opened = tabs.openTab(target, {
      win: senderWindow(event), kind: input.kind || 'app', source: 'ipc', ...(options || {})
    });
    return { ok: !!opened };
  });

  ipcMain.handle('tab:menu', (event, payload) => showTabMenu(event, payload));

  ipcMain.handle('session:save', (event, tabsList) => {
    store.saveSessionTabs(Array.isArray(tabsList) ? tabsList : []);
    return { ok: true };
  });

  ipcMain.handle('session:read', () => store.readSessionTabs());

  /* ---------------- 连接 ---------------- */
  ipcMain.handle('connect:preview', (event, input) => {
    const target = store.parseTarget(input && input.url);
    if (!target) return { ok: false, error: '地址无效' };
    return {
      ok: true,
      url: target.url,
      hostKind: target.hostKind,
      localHost: target.localHost,
      privateHost: !!target.privateHost,
      explicitPort: target.explicitPort,
      defaultPort: target.defaultPort,
      fnConnect: target.fnConnect,
      fnPortBlocked: !!target.fnPortBlocked,
      port: target.port || ''
    };
  });

  ipcMain.handle('connect:submit', async (event, input) => {
    try {
      const resolved = await store.resolveServerInput(input);
      if (!resolved.ok) return { ok: false, error: resolved.error };
      const server = store.addServer({ ...(input || {}), url: resolved.url });
      if (!server || !server.ok) return { ok: false, error: (server && server.error) || '连接失败' };
      const partition = store.partitionOf(server.server.id);
      ensureSession(partition);
      store.setActiveServer(server.server.id);
      activateServer(server.server);
      return {
        ok: true,
        server: server.server,
        partition,
        hostKind: resolved.hostKind || '',
        explicitPort: !!resolved.explicitPort,
        defaultPort: !!resolved.defaultPort,
        fnConnect: !!resolved.fnConnect,
        fnPortBlocked: !!resolved.fnPortBlocked
      };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  });

  /* ---------------- 局域网连接诊断（macOS 本地网络授权） ---------------- */
  ipcMain.handle('net:diagnose', async (event, input) => {
    try {
      const target = store.parseTarget(input && input.url);
      if (!target) return { ok: false, error: '地址无效' };
      if (target.fnConnect) {
        // FN Connect 中继只转发 443；显式非 443 端口必然连不通，直接给出明确结论
        if (target.fnPortBlocked) {
          return {
            ok: true,
            fnConnect: true,
            privateHost: false,
            hostKind: 'fn',
            host: target.hostname,
            port: Number(target.port) || Number(addr.FN_STANDARD_PORT),
            protocol: 'https',
            status: 'fn-port-blocked',
            detail: 'FN Connect 中继不支持端口直达'
          };
        }
        return { ok: true, fnConnect: true, status: 'skipped', privateHost: false };
      }
      const protocol = target.protocol === 'https:' ? 'https' : 'http';
      const defaultPort = protocol === 'https' ? addr.HTTPS_DEFAULT_PORT : addr.HTTP_DEFAULT_PORT;
      let port = defaultPort;
      try {
        port = Number(new URL(target.url).port) || defaultPort;
      } catch (err) {
        port = defaultPort;
      }
      const result = await addr.diagnose(target.hostname, port);
      const payload = {
        ok: true,
        host: target.hostname,
        port,
        protocol,
        hostKind: target.hostKind,
        privateHost: !!target.privateHost,
        status: result.status,
        elapsed: result.elapsed,
        detail: result.detail
      };
      // 端口不通时换另一个默认端口再探，能连上就提示改写协议
      if (result.status !== 'ok' && payload.privateHost) {
        const altPort = Number(port) === Number(addr.HTTP_DEFAULT_PORT)
          ? Number(addr.HTTPS_DEFAULT_PORT)
          : Number(addr.HTTP_DEFAULT_PORT);
        const altResult = await addr.diagnose(target.hostname, altPort, 1500);
        if (altResult.status === 'ok') payload.suggestPort = altPort;
      }
      return payload;
    } catch (err) {
      return { ok: false, error: (err && err.message) || '诊断失败' };
    }
  });

  // 直接跳到 macOS「隐私与安全性 › 本地网络」面板
  ipcMain.handle('net:open-local-network', async () => {
    if (process.platform !== 'darwin') return { ok: false, error: '仅 macOS 需要该项授权' };
    const version = String(process.getSystemVersion() || '0').split('.');
    const major = Number(version[0]) || 0;
    const urls = major >= 13
      ? ['x-apple.systempreferences:com.apple.settings.PrivacySecurity.extension?Privacy_LocalNetwork',
        'x-apple.systempreferences:com.apple.preference.security?Privacy_LocalNetwork']
      : ['x-apple.systempreferences:com.apple.preference.security?Privacy_LocalNetwork'];
    for (const url of urls) {
      try {
        await shell.openExternal(url);
        return { ok: true, url };
      } catch (err) {
        /* 换下一个入口 */
      }
    }
    return { ok: false, error: '未能打开系统设置，请手动前往「系统设置 › 隐私与安全性 › 本地网络」勾选 FNOS' };
  });

  /* ---------------- 下载中心 ---------------- */
  ipcMain.handle('downloads:list', () => ({
    items: downloads.list(),
    stats: downloads.stats(),
    dir: downloads.downloadDir(),
    settings: {
      notify: store.getSettings().downloadNotify,
      maxConcurrent: store.getSettings().maxConcurrentDownloads
    }
  }));

  ipcMain.handle('downloads:control', (event, id, action) => {
    try {
      return downloads.control(id, action);
    } catch (err) {
      return { ok: false, error: err.message };
    }
  });

  ipcMain.handle('downloads:pause-all', () => downloads.pauseAll());

  ipcMain.handle('downloads:open', (event, id) => downloads.openFile(id));

  ipcMain.handle('downloads:folder', (event, id) => downloads.showInFolder(id));

  ipcMain.handle('downloads:remove', (event, id) => downloads.remove(id));

  ipcMain.handle('downloads:clear', () => downloads.clearCompleted());

  ipcMain.handle('downloads:choose-dir', async (event) => {
    const win = senderWindow(event);
    const result = await dialog.showOpenDialog(win || undefined, {
      title: '选择下载目录',
      properties: ['openDirectory', 'createDirectory']
    });
    if (result.canceled || !result.filePaths.length) return { ok: false };
    store.patchSettings({ downloadDir: result.filePaths[0] });
    downloads.broadcast(true);
    return { ok: true, dir: result.filePaths[0] };
  });

  /* ---------------- 媒体嗅探 / MPV ---------------- */
  ipcMain.handle('media:list', () => media.list());
  ipcMain.handle('media:clear', () => media.clear());

  ipcMain.handle('mpv:status', () => mpv.status());
  ipcMain.handle('mpv:pick', async (event) => {
    const win = senderWindow(event);
    const result = await dialog.showOpenDialog(win || undefined, {
      title: '选择 mpv 可执行文件',
      properties: ['openFile'],
      filters: process.platform === 'win32' ? [{ name: 'mpv', extensions: ['exe'] }] : []
    });
    if (result.canceled || !result.filePaths.length) return { ok: false };
    store.patchSettings({ mpvPath: result.filePaths[0] });
    return { ok: true, status: mpv.status() };
  });

  ipcMain.handle('mpv:play', async (event, payload) => {
    const input = payload || {};
    const ses = event.sender ? event.sender.session : null;
    const cookie = input.url ? await media.cookieFor(ses, input.url) : '';
    return mpv.play({ ...input, cookie: input.cookie || cookie });
  });

  ipcMain.handle('mpv:play-media', async (event, id) => {
    const row = media.find(id);
    if (!row) return { ok: false, error: '媒体地址已失效' };
    const cookie = await media.cookieFor(event.sender ? event.sender.session : null, row.url);
    return mpv.play({ url: row.url, cookie, title: row.mime });
  });

  // 嗅探到的媒体直接在宿主窗口内嵌播放
  ipcMain.handle('mpv:embed-media', async (event, payload) => {
    const win = senderWindow(event);
    if (!win) return { ok: false, error: '宿主窗口不可用' };
    const input = payload || {};
    const row = media.find(input.id);
    if (!row) return { ok: false, error: '媒体地址已失效' };
    const cookie = await media.cookieFor(event.sender ? event.sender.session : null, row.url);
    return mpv.embed(win, {
      url: row.url,
      cookie,
      title: input.title || row.title || row.mime,
      rect: input.rect,
      titlebarHeight: input.titlebarHeight,
      viewOffset: input.viewOffset
    });
  });

  /* ---------------- MPV 内核信息 / 应用内嵌入 ---------------- */
  ipcMain.handle('mpv:info', () => mpv.info());
  ipcMain.handle('mpv:rescan', () => mpv.rescan());
  ipcMain.handle('mpv:helper', () => mpv.startHelper());

  // 在宿主窗口的视频区嵌入 mpv：cookie 由当前会话按目标地址自动补齐
  ipcMain.handle('mpv:embed', async (event, payload) => {
    const win = senderWindow(event);
    if (!win) return { ok: false, error: '宿主窗口不可用' };
    const input = payload || {};
    let cookie = input.cookie || '';
    if (!cookie && input.url) cookie = await media.cookieFor(event.sender ? event.sender.session : null, input.url);
    return mpv.embed(win, { ...input, cookie });
  });
  ipcMain.handle('mpv:embed-rect', (event, rect, viewOffset) => mpv.embedRect(rect, viewOffset));
  ipcMain.handle('mpv:embed-control', (event, action, value) => mpv.embedControl(action, value));
  ipcMain.handle('mpv:embed-title', (event, title) => mpv.embedTitle(title));
  ipcMain.handle('mpv:embed-close', () => mpv.closeEmbed());

  /* ---------------- 电视直播 ---------------- */
  ipcMain.handle('live:state', async () => ({
    sources: live.listSources(),
    favorites: store.readLive().favorites || [],
    settings: {
      enabled: store.getSettings().liveEnabled,
      playlist: store.getSettings().livePlaylist,
      lastChannel: store.getSettings().liveLastChannel,
      epgUrl: store.getSettings().liveEpgUrl
    }
  }));

  ipcMain.handle('live:add-source', (event, input) => {
    try {
      const source = live.addSource(input || {});
      return { ok: true, source, sources: live.listSources() };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  });

  ipcMain.handle('live:remove-source', (event, id) => {
    live.removeSource(id);
    return { ok: true, sources: live.listSources() };
  });

  ipcMain.handle('live:load', async (event, sourceId) => {
    try {
      return await live.load(sourceId);
    } catch (err) {
      return { ok: false, error: err.message };
    }
  });

  ipcMain.handle('live:favorite', (event, channel) => {
    try {
      return { ok: true, favorites: live.toggleFavorite(channel || {}) };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  });

  ipcMain.handle('live:epg', async (event, url) => {
    try {
      return await live.epg(url || store.getSettings().liveEpgUrl);
    } catch (err) {
      return { ok: false, error: err.message };
    }
  });

  ipcMain.handle('live:save-recording', (event, name, base64) => {
    try {
      return live.saveRecording(name, base64);
    } catch (err) {
      return { ok: false, error: err.message };
    }
  });

  ipcMain.handle('live:play-mpv', async (event, channel) => {
    const target = channel && channel.url;
    if (!target) return { ok: false, error: '频道地址为空' };
    store.patchSettings({ liveLastChannel: (channel && channel.name) || '' });
    return mpv.play({ url: target, title: (channel && channel.name) || '电视直播' });
  });

  /* ---------------- 皮肤包 ---------------- */
  ipcMain.handle('skin:list', () => ({ skins: skins.list(), current: skins.current(), tokens: skins.TOKENS }));

  ipcMain.handle('skin:apply', (event, id) => {
    try {
      const skin = skins.apply(id);
      broadcast('skin:changed', skin);
      return { ok: true, skin };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  });

  ipcMain.handle('skin:import', async (event) => {
    const result = await skins.importPack(senderWindow(event));
    if (result && result.ok) broadcast('skin:changed', skins.current());
    return result || { ok: false };
  });

  ipcMain.handle('skin:export', async (event, id) => skins.exportPack(senderWindow(event), id));

  ipcMain.handle('skin:remove', (event, id) => {
    try {
      skins.remove(id);
      broadcast('skin:changed', skins.current());
      return { ok: true, skins: skins.list() };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  });

  /* ---------------- 锁屏 / 老板键 ---------------- */
  ipcMain.handle('lock:status', () => lock.status());

  ipcMain.handle('lock:set-password', (event, password) => {
    try {
      lock.setPassword(password || '');
      return { ok: true, status: lock.status() };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  });

  ipcMain.handle('lock:change-password', (event, oldPassword, newPassword) => {
    const result = lock.changePassword(oldPassword || '', newPassword || '');
    return result && result.ok !== false ? { ok: true, status: lock.status() } : (result || { ok: true });
  });

  ipcMain.handle('lock:clear-password', (event, password) => {
    const result = lock.clearPassword(password || '');
    return result && result.ok !== false ? { ok: true, status: lock.status() } : (result || { ok: true });
  });

  ipcMain.handle('lock:enable', (event, options) => {
    const status = lock.enable(options || {});
    return { ok: true, status };
  });

  ipcMain.handle('lock:verify', (event, password) => lock.verify(password || ''));
  ipcMain.handle('lock:unlock', (event, password) => lock.unlock(password || ''));
  ipcMain.handle('lock:lock', () => {
    lock.lock('manual');
    return { ok: true };
  });

  ipcMain.handle('lock:boss-toggle', () => {
    lock.bossToggle();
    return { ok: true };
  });

  /* ---------------- 快捷键 ---------------- */
  ipcMain.handle('shortcut:list', () => shortcuts.list());

  ipcMain.handle('shortcut:validate', (event, accelerator) => ({
    valid: shortcuts.validate(accelerator),
    normalized: shortcuts.normalize(accelerator),
    conflict: shortcuts.conflictOf(accelerator)
  }));

  ipcMain.handle('shortcut:update', (event, id, accelerator) => {
    const result = shortcuts.update(id, accelerator);
    return result && result.ok !== undefined ? result : { ok: true, list: shortcuts.list() };
  });

  ipcMain.handle('shortcut:reset', () => {
    shortcuts.reset();
    return { ok: true, list: shortcuts.list() };
  });

  /* ---------------- 应用快捷方式 ---------------- */
  ipcMain.handle('applink:info', () => applink.info());

  ipcMain.handle('applink:pick-dir', async (event) => {
    const dir = await applink.pickDir(senderWindow(event));
    return dir ? { ok: true, dir } : { ok: false };
  });

  ipcMain.handle('applink:create', (event, input) => {
    try {
      const result = applink.create(input || {});
      return { ok: true, ...result };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  });

  /* ---------------- 更新 ---------------- */
  ipcMain.handle('app:check-update', (event, silent) => update.check({ silent: !!silent }));

  ipcMain.handle('update:download', (event, assetUrl, filename) => update.downloadAsset(assetUrl, filename));

  ipcMain.handle('app:open-release', (event, url) => update.openReleasePage(url).then(() => ({ ok: true })).catch(() => ({ ok: false })));

  ipcMain.handle('update:open-folder', (event, file) => update.openFolder(file));

  /* ---------------- 来自 guest 的转发 ---------------- */
  /* 页面内视频开播：转给宿主窗口渲染层，由内置 mpv 在当前页面接管播放 */
  ipcMain.on('guest:video-play', (event, info) => {
    const sender = event.sender;
    if (!sender || !info || !info.url) return;
    let win = null;
    try {
      const hostContents = sender.hostWebContents;
      if (hostContents) win = BrowserWindow.fromWebContents(hostContents);
    } catch (err) { win = null; }
    if (!win) win = senderWindow(event);
    if (!win) return;
    try { win.webContents.send('mpv:auto-video', Object.assign({}, info, { guestId: sender.id })); } catch (err) { /* 忽略 */ }
  });

  /* 内置播放器接管/释放时，让页面自己的 <video> 暂停或恢复，避免两份声音 */
  ipcMain.handle('mpv:hold-guest', (event, guestId, hold) => {
    try {
      const guest = webContents.fromId(Number(guestId));
      if (!guest || guest.isDestroyed()) return { ok: false, error: '页面已关闭' };
      guest.send(hold ? 'guest:video-hold' : 'guest:video-resume');
      return { ok: true };
    } catch (err) {
      return { ok: false, error: (err && err.message) || '发送失败' };
    }
  });

  ipcMain.on('guest:route', (event, payload) => {
    const href = typeof payload === 'string' ? payload : (payload && payload.href);
    if (href) tabs.handleRouteChange(event.sender, href);
  });

  ipcMain.on('guest:shortcut', (event, action) => {
    broadcast('shortcut:run', { action });
  });

  ipcMain.on('guest:fullscreen', (event, payload) => {
    const win = senderWindow(event);
    if (!win || win.isDestroyed()) return;
    const active = payload ? (payload.fullscreen !== undefined ? payload.fullscreen : payload.active) : false;
    if (active) win.setFullScreen(true);
    else win.setFullScreen(false);
    broadcast('tab:fullscreen', { fullscreen: !!active });
  });

  log.info('IPC 通道注册完成');
  return { ok: true };
}

module.exports = { register, activePartition, ensureSession };
