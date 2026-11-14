'use strict';

const state = {
  config: null,
  settings: {},
  server: null,
  baseUrl: '',
  servers: [],
  tabs: [],
  activeId: null,
  seq: 0,
  sessionTimer: null,
  draggingId: null
};

const dom = {
  tabs: document.getElementById('tabs'),
  views: document.getElementById('views'),
  newTab: document.getElementById('new-tab'),
  placeholder: document.getElementById('placeholder'),
  placeholderConnect: document.getElementById('placeholder-connect'),
  toasts: document.getElementById('toasts'),
  winMin: document.getElementById('win-min'),
  winMax: document.getElementById('win-max'),
  winClose: document.getElementById('win-close'),
  btnMenu: document.getElementById('btn-menu'),
  btnServer: document.getElementById('btn-server'),
  menuLayer: document.getElementById('menu-layer'),
  serverLabel: document.getElementById('server-label')
};

function activeTab() {
  return state.tabs.find((tab) => tab.id === state.activeId) || null;
}

function toast(message, options = {}) {
  const node = document.createElement('div');
  node.className = `toast${options.type ? ` ${options.type}` : ''}`;
  node.textContent = message;
  dom.toasts.appendChild(node);
  const duration = options.duration || 3200;
  setTimeout(() => {
    node.classList.add('out');
    setTimeout(() => node.remove(), 280);
  }, duration);
}

function hostLabel(server) {
  if (!server) return '飞牛 NAS';
  return server.name || server.url.replace(/^https?:\/\//, '');
}

function updateServerLabel() {
  dom.serverLabel.textContent = hostLabel(state.server);
  dom.serverLabel.title = state.server ? state.server.url : '';
}

function updateWindowTitle() {
  const tab = activeTab();
  document.title = tab && tab.title ? `${tab.title} - 飞牛 NAS` : '飞牛 NAS';
}

/* ---------------------------- 菜单 ---------------------------- */

function closeMenu() {
  dom.menuLayer.hidden = true;
  dom.menuLayer.innerHTML = '';
}

function openMenu(items, anchor) {
  dom.menuLayer.innerHTML = '';
  const menu = document.createElement('div');
  menu.className = 'menu';

  items.forEach((item) => {
    if (item.separator) {
      const sep = document.createElement('div');
      sep.className = 'menu-sep';
      menu.appendChild(sep);
      return;
    }
    const row = document.createElement('button');
    row.type = 'button';
    row.className = 'menu-item';
    const label = document.createElement('span');
    label.textContent = (item.checked ? '✓ ' : '') + item.label;
    row.appendChild(label);
    if (item.hint) {
      const hint = document.createElement('span');
      hint.className = 'hint';
      hint.textContent = item.hint;
      row.appendChild(hint);
    }
    if (item.disabled) row.disabled = true;
    row.addEventListener('click', () => {
      closeMenu();
      if (typeof item.action === 'function') item.action();
    });
    menu.appendChild(row);
  });

  dom.menuLayer.appendChild(menu);
  dom.menuLayer.hidden = false;

  const rect = anchor ? anchor.getBoundingClientRect() : { left: 24, bottom: 48 };
  const width = 230;
  const height = menu.offsetHeight || 160;
  const left = Math.max(8, Math.min(window.innerWidth - width - 10, rect.left));
  const top = Math.min(window.innerHeight - height - 10, rect.bottom + 6);
  menu.style.width = `${width}px`;
  menu.style.left = `${left}px`;
  menu.style.top = `${Math.max(8, top)}px`;
}

dom.menuLayer.addEventListener('mousedown', closeMenu);

function openMainMenu() {
  const items = [
    { label: '新建标签页', hint: 'Ctrl+T', action: () => runAction('new-tab') },
    { label: '重新加载', hint: 'Ctrl+R', action: () => runAction('reload') },
    { separator: true },
    { label: '切换设备', action: openServerMenu },
    { label: '设置…', action: () => window.fnos.app.openSettings() },
    { separator: true },
    { label: '清除页面缓存', action: clearCache },
    { label: '检查更新', action: checkUpdate },
    { separator: true },
    { label: '开发者工具', action: () => { const tab = activeTab(); if (tab && tab.view) tab.view.openDevTools(); } },
    { label: '退出', action: () => window.fnos.app.quit() }
  ];
  openMenu(items, dom.btnMenu);
}

function openServerMenu() {
  const items = (state.servers || []).map((server) => ({
    label: server.name,
    hint: server.url.replace(/^https?:\/\//, ''),
    checked: !!state.server && server.id === state.server.id,
    action: () => window.fnos.servers.activate(server.id)
  }));
  if (items.length) items.push({ separator: true });
  items.push({ label: '添加设备地址…', action: () => window.fnos.app.openConnect() });
  items.push({ label: '打开设置…', action: () => window.fnos.app.openSettings() });
  openMenu(items, dom.btnServer);
}

async function clearCache() {
  const result = await window.fnos.app.clearCache();
  if (result && result.ok) toast('页面缓存已清除', { type: 'success' });
  else toast('缓存清除失败', { type: 'error' });
}

async function checkUpdate() {
  toast('正在检查更新…');
  const result = await window.fnos.app.checkUpdate();
  if (!result || !result.ok) {
    toast(`检查更新失败：${(result && result.error) || '网络异常'}`, { type: 'error', duration: 4200 });
    return;
  }
  if (result.hasUpdate) {
    openMenu([
      { label: `发现新版本 ${result.latest}`, disabled: true },
      { label: '前往下载页面', action: () => window.fnos.app.openRelease(result.url) }
    ], dom.btnMenu);
  } else {
    toast(`已是最新版本 ${result.current}`, { type: 'success' });
  }
}

/* ---------------------------- 标签 ---------------------------- */

function renderTabs() {
  dom.tabs.innerHTML = '';
  state.tabs.forEach((tab) => {
    const node = document.createElement('div');
    node.className = `tab${tab.id === state.activeId ? ' active' : ''}${tab.loading ? ' loading' : ''}`;
    node.setAttribute('role', 'tab');
    node.dataset.id = tab.id;

    const icon = document.createElement('div');
    icon.className = 'tab-icon';
    if (tab.favicon) {
      const img = document.createElement('img');
      img.src = tab.favicon;
      img.alt = '';
      img.addEventListener('error', () => {
        img.remove();
        icon.classList.add('fallback');
      });
      icon.appendChild(img);
    } else {
      icon.classList.add('fallback');
    }
    if (tab.loading) {
      const spinner = document.createElement('span');
      spinner.className = 'spinner';
      icon.appendChild(spinner);
    }

    const title = document.createElement('span');
    title.className = 'tab-title';
    title.textContent = tab.title || '新标签页';
    title.title = tab.title || '';

    node.appendChild(icon);
    node.appendChild(title);

    if (tab.kind !== 'desktop') {
      const close = document.createElement('button');
      close.type = 'button';
      close.className = 'tab-close';
      close.title = '关闭标签页';
      close.textContent = '×';
      close.addEventListener('click', (event) => {
        event.stopPropagation();
        closeTab(tab.id);
      });
      node.appendChild(close);
    }

    node.addEventListener('mousedown', (event) => {
      if (event.button === 0) activateTab(tab.id);
    });

    node.addEventListener('auxclick', (event) => {
      if (event.button === 1) {
        event.preventDefault();
        closeTab(tab.id);
      }
    });

    node.addEventListener('contextmenu', (event) => {
      event.preventDefault();
      activateTab(tab.id);
      window.fnos.tabs.menu({ tabId: tab.id, kind: tab.kind, url: tab.url });
    });

    if (tab.kind !== 'desktop') {
      node.draggable = true;
      node.addEventListener('dragstart', (event) => {
        state.draggingId = tab.id;
        event.dataTransfer.effectAllowed = 'move';
        try { event.dataTransfer.setData('text/plain', tab.id); } catch (err) { /* 忽略 */ }
      });
      node.addEventListener('dragend', () => {
        state.draggingId = null;
        node.classList.remove('drop-target');
      });
    }

    node.addEventListener('dragover', (event) => {
      if (!state.draggingId || state.draggingId === tab.id) return;
      event.preventDefault();
      node.classList.add('drop-target');
    });

    node.addEventListener('dragleave', () => node.classList.remove('drop-target'));

    node.addEventListener('drop', (event) => {
      event.preventDefault();
      node.classList.remove('drop-target');
      if (state.draggingId) moveTab(state.draggingId, tab.id);
    });

    dom.tabs.appendChild(node);
  });
}

function moveTab(fromId, toId) {
  const fromIndex = state.tabs.findIndex((tab) => tab.id === fromId);
  const toIndex = state.tabs.findIndex((tab) => tab.id === toId);
  if (fromIndex < 0 || toIndex < 0 || fromIndex === toIndex) return;
  if (state.tabs[fromIndex].kind === 'desktop') return;
  const [moved] = state.tabs.splice(fromIndex, 1);
  const insertAt = Math.max(1, toIndex);
  state.tabs.splice(insertAt, 0, moved);
  renderTabs();
  saveSession();
}

function registerTab(tab) {
  if (!tab.view || !tab.view.getWebContentsId) return;
  let id = null;
  try {
    id = tab.view.getWebContentsId();
  } catch (err) {
    return;
  }
  if (!id) return;
  tab.webContentsId = id;
  window.fnos.tabs.register({
    webContentsId: id,
    tabId: tab.id,
    kind: tab.kind,
    baseUrl: tab.kind === 'desktop' ? tab.baseUrl : ''
  });
}

function createTab(options) {
  const settings = typeof options === 'string' ? { url: options } : (options || {});
  const url = settings.url;
  if (!url) return null;
  const kind = settings.kind === 'desktop' || settings.kind === 'app' ? settings.kind : 'web';

  if (kind !== 'desktop') {
    const existing = state.tabs.find((tab) => tab.url === url && tab.kind !== 'desktop');
    if (existing) {
      if (settings.activate !== false) activateTab(existing.id);
      return existing;
    }
  }

  const tab = {
    id: `tab-${++state.seq}`,
    url,
    kind,
    baseUrl: kind === 'desktop' ? url : '',
    title: settings.title || (kind === 'desktop' ? '桌面' : '加载中…'),
    favicon: '',
    loading: true,
    zoom: 1,
    view: null,
    webContentsId: null
  };

  const view = document.createElement('webview');
  view.className = 'view';
  view.setAttribute('partition', (state.config && state.config.partition) || 'persist:fnos');
  view.setAttribute('preload', window.fnos.guestPreload);
  view.setAttribute('allowpopups', 'true');
  view.setAttribute('webpreferences', 'contextIsolation=yes,nodeIntegration=no,javascript=yes,backgroundThrottling=no');

  tab.view = view;

  view.addEventListener('dom-ready', () => {
    registerTab(tab);
    try {
      view.setZoomFactor(tab.zoom || 1);
    } catch (err) { /* 忽略 */ }
  });

  view.addEventListener('did-start-loading', () => {
    tab.loading = true;
    renderTabs();
  });

  view.addEventListener('did-stop-loading', () => {
    tab.loading = false;
    try {
      const current = view.getURL();
      if (current) tab.url = current;
    } catch (err) { /* 忽略 */ }
    renderTabs();
    saveSession();
  });

  view.addEventListener('page-title-updated', (event) => {
    if (event && event.title) {
      tab.title = event.title;
      renderTabs();
      updateWindowTitle();
      saveSession();
    }
  });

  view.addEventListener('page-favicon-updated', (event) => {
    const icons = (event && event.favicons) || [];
    if (icons.length) {
      tab.favicon = icons[0];
      renderTabs();
    }
  });

  view.addEventListener('did-fail-load', (event) => {
    if (!event || event.errorCode === -3 || event.errorCode === 0) return;
    tab.loading = false;
    renderTabs();
    toast(`页面加载失败：${event.errorDescription || event.errorCode}`, { type: 'error', duration: 4200 });
  });

  view.addEventListener('render-process-gone', () => {
    toast('页面进程异常退出，可刷新重试', { type: 'error' });
  });

  view.addEventListener('enter-html-full-screen', () => {
    document.body.classList.add('html-fullscreen');
  });
  view.addEventListener('leave-html-full-screen', () => {
    document.body.classList.remove('html-fullscreen');
  });

  state.tabs.push(tab);
  dom.views.appendChild(view);
  if (settings.activate !== false) activateTab(tab.id);
  else renderTabs();

  return tab;
}

function activateTab(id) {
  const tab = state.tabs.find((item) => item.id === id);
  if (!tab) return;
  state.activeId = id;
  state.tabs.forEach((item) => {
    if (item.view) item.view.classList.toggle('active', item.id === id);
  });
  renderTabs();
  updateWindowTitle();
}

function closeTab(id) {
  const index = state.tabs.findIndex((tab) => tab.id === id);
  if (index < 0) return;
  const tab = state.tabs[index];
  if (tab.kind === 'desktop') {
    toast('桌面标签页常驻，不可关闭');
    return;
  }
  try {
    if (tab.webContentsId) window.fnos.tabs.unregister(tab.webContentsId);
  } catch (err) { /* 忽略 */ }
  if (tab.view) tab.view.remove();
  state.tabs.splice(index, 1);
  if (state.activeId === id) {
    const next = state.tabs[Math.min(index, state.tabs.length - 1)];
    if (next) activateTab(next.id);
    else {
      state.activeId = null;
      renderTabs();
    }
  } else {
    renderTabs();
  }
  saveSession();
}

function saveSession() {
  clearTimeout(state.sessionTimer);
  state.sessionTimer = setTimeout(() => {
    const list = state.tabs
      .filter((tab) => tab.kind !== 'desktop')
      .map((tab) => ({ url: tab.url, title: tab.title, kind: 'app' }));
    window.fnos.session.save(list);
  }, 700);
}

/* ---------------------------- 快捷操作 ---------------------------- */

function runAction(action) {
  const tab = activeTab();
  switch (action) {
    case 'new-tab':
      createTab({ url: state.baseUrl, kind: 'web', title: '新标签页' });
      break;
    case 'close-tab':
      if (tab) closeTab(tab.id);
      break;
    case 'next-tab': {
      const index = state.tabs.findIndex((item) => item.id === state.activeId);
      const next = state.tabs[(index + 1) % state.tabs.length];
      if (next) activateTab(next.id);
      break;
    }
    case 'prev-tab': {
      const index = state.tabs.findIndex((item) => item.id === state.activeId);
      const prev = state.tabs[(index - 1 + state.tabs.length) % state.tabs.length];
      if (prev) activateTab(prev.id);
      break;
    }
    case 'reload':
      if (tab && tab.view) tab.view.reload();
      break;
    case 'reload-hard':
      if (tab && tab.view) tab.view.reloadIgnoringCache();
      break;
    case 'zoom-in':
    case 'zoom-out':
    case 'zoom-reset': {
      if (!tab) break;
      const current = tab.zoom || 1;
      const next = action === 'zoom-reset' ? 1 : (action === 'zoom-in' ? current + 0.1 : current - 0.1);
      tab.zoom = Math.min(2.5, Math.max(0.5, Math.round(next * 100) / 100));
      try {
        tab.view.setZoomFactor(tab.zoom);
      } catch (err) { /* 忽略 */ }
      toast(`缩放 ${Math.round(tab.zoom * 100)}%`);
      break;
    }
    case 'print':
      if (tab && tab.view) tab.view.print();
      break;
    default: {
      const match = /^switch-([1-9])$/.exec(action);
      if (match) {
        const target = state.tabs[Number(match[1]) - 1];
        if (target) activateTab(target.id);
      }
    }
  }
}

function handleTabCommand(payload) {
  if (!payload) return;
  const tab = state.tabs.find((item) => item.id === payload.tabId);
  switch (payload.action) {
    case 'reload':
      if (tab && tab.view) tab.view.reload();
      break;
    case 'close':
      closeTab(payload.tabId);
      break;
    case 'close-others':
      state.tabs.filter((item) => item.id !== payload.tabId && item.kind !== 'desktop')
        .forEach((item) => closeTab(item.id));
      break;
    case 'devtools':
      if (tab && tab.view) tab.view.openDevTools({ mode: 'detach' });
      break;
    default:
      break;
  }
}

/* ---------------------------- 服务器切换 ---------------------------- */

function handleServerChanged(server) {
  if (!server) return;
  state.server = server;
  state.baseUrl = server.url;
  state.servers = state.servers.map((item) => (item.id === server.id ? server : item));
  if (!state.servers.some((item) => item.id === server.id)) state.servers.push(server);
  updateServerLabel();
  hidePlaceholder();

  const desktop = state.tabs.find((tab) => tab.kind === 'desktop');
  state.tabs.filter((tab) => tab.kind !== 'desktop').forEach((tab) => closeTab(tab.id));

  if (desktop) {
    desktop.url = server.url;
    desktop.baseUrl = server.url;
    desktop.title = '桌面';
    try {
      desktop.view.loadURL(server.url);
    } catch (err) { /* 忽略 */ }
    activateTab(desktop.id);
  } else {
    createTab({ url: server.url, kind: 'desktop', title: '桌面', activate: true });
  }
  saveSession();
}

function showPlaceholder() {
  dom.placeholder.hidden = false;
}

function hidePlaceholder() {
  dom.placeholder.hidden = true;
}

/* ---------------------------- 初始化 ---------------------------- */

function bindWindowControls() {
  dom.winMin.addEventListener('click', () => window.fnos.window.minimize());
  dom.winMax.addEventListener('click', async () => {
    const result = await window.fnos.window.toggleMaximize();
    state.maximized = !!(result && result.maximized);
    document.body.classList.toggle('maximized', state.maximized);
  });
  dom.winClose.addEventListener('click', () => window.fnos.window.close());
  dom.newTab.addEventListener('click', () => runAction('new-tab'));
  dom.btnMenu.addEventListener('click', (event) => {
    event.stopPropagation();
    openMainMenu();
  });
  dom.btnServer.addEventListener('click', (event) => {
    event.stopPropagation();
    openServerMenu();
  });
  dom.placeholderConnect.addEventListener('click', () => window.fnos.app.openConnect());
}

function bindIpc() {
  window.fnos.on('tabs:open', (payload) => {
    if (!payload || !payload.url) return;
    hidePlaceholder();
    createTab({
      url: payload.url,
      title: payload.title || '',
      kind: 'app',
      activate: payload.activate !== false
    });
  });

  window.fnos.on('tabs:command', handleTabCommand);
  window.fnos.on('shortcuts:run', runAction);

  window.fnos.on('server:changed', handleServerChanged);

  window.fnos.on('settings:changed', (settings) => {
    state.settings = Object.assign({}, state.settings, settings || {});
  });

  window.fnos.on('window:state', (payload) => {
    state.maximized = !!(payload && payload.maximized);
    document.body.classList.toggle('maximized', state.maximized);
  });

  window.fnos.on('download:event', (payload) => {
    if (!payload) return;
    if (payload.phase === 'start') toast(`开始下载：${payload.filename}`);
    else if (payload.phase === 'done') toast(`下载完成：${payload.filename}`, { type: 'success', duration: 4600 });
    else if (payload.phase === 'failed') toast(`下载中断：${payload.filename}`, { type: 'error', duration: 4600 });
  });

  window.fnos.on('tab:crashed', () => toast('页面异常退出，请刷新重试', { type: 'error' }));
}

async function boot() {
  const config = await window.fnos.boot();
  state.config = config;
  state.settings = config.settings || {};
  state.servers = config.servers || [];
  document.body.classList.add(`platform-${config.platform}`);
  if (config.platform === 'darwin') document.body.classList.add('mac');

  bindWindowControls();
  bindIpc();

  const winState = await window.fnos.window.state();
  state.maximized = !!(winState && winState.maximized);
  document.body.classList.toggle('maximized', state.maximized);

  if (!config.activeServer) {
    updateServerLabel();
    showPlaceholder();
    return;
  }

  state.server = config.activeServer;
  state.baseUrl = config.activeServer.url;
  updateServerLabel();

  createTab({ url: state.baseUrl, kind: 'desktop', title: '桌面', activate: true });

  if (state.settings.restoreTabs !== false && Array.isArray(config.sessionTabs)) {
    config.sessionTabs.forEach((item) => {
      if (!item || !item.url || item.url === state.baseUrl) return;
      createTab({ url: item.url, title: item.title || '', kind: 'app', activate: false });
    });
  }

  if (state.tabs.length) activateTab(state.tabs[0].id);
}

boot().catch((err) => {
  console.error('[shell] 初始化失败:', err);
  toast('界面初始化失败，请重启应用', { type: 'error', duration: 6000 });
});
