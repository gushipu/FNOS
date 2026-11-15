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
  serverLabel: document.getElementById('server-label'),
  btnDownloads: document.getElementById('btn-downloads'),
  downloadBadge: document.getElementById('download-badge'),
  btnLive: document.getElementById('btn-live'),
  btnMedia: document.getElementById('btn-media'),
  btnLock: document.getElementById('btn-lock'),
  mediaDrawer: document.getElementById('media-drawer'),
  mediaList: document.getElementById('media-list'),
  mediaClear: document.getElementById('media-clear'),
  mediaClose: document.getElementById('media-close'),
  mediaTip: document.getElementById('media-tip'),
  mpvStage: document.getElementById('mpv-stage'),
  mpvStageHead: document.querySelector('.mpv-stage-head'),
  mpvStageTitle: document.getElementById('mpv-stage-title'),
  mpvStageBody: document.getElementById('mpv-stage-body'),
  mpvStagePop: document.getElementById('mpv-stage-pop'),
  mpvStageClose: document.getElementById('mpv-stage-close'),
  lockScreen: document.getElementById('lock-screen'),
  lockForm: document.getElementById('lock-form'),
  lockPassword: document.getElementById('lock-password'),
  lockSub: document.getElementById('lock-sub'),
  lockError: document.getElementById('lock-error'),
  lockBoss: document.getElementById('lock-boss')
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

// 只有点在菜单面板之外才关闭；菜单项自身的按下事件必须放行，否则 mousedown 会先清空面板导致 click 落空
dom.menuLayer.addEventListener('mousedown', (event) => {
  const target = event.target;
  if (target && typeof target.closest === 'function' && target.closest('.menu')) return;
  closeMenu();
});

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
    const asset = result.asset && result.asset.url ? result.asset : null;
    const items = [
      { label: `发现新版本 ${result.latest}`, disabled: true }
    ];
    if (asset) {
      items.push({
        label: '内置下载安装包',
        action: async () => {
          toast('正在使用内置下载…');
          const saved = await window.fnos.app.downloadUpdate(asset.url, asset.name);
          if (saved && saved.ok && saved.file) {
            toast(`已下载到 ${saved.file}`, { type: 'success', duration: 6000 });
            window.fnos.app.openUpdateFolder(saved.file);
          } else {
            toast(`下载失败：${(saved && saved.error) || '网络异常'}`, { type: 'error', duration: 4200 });
          }
        }
      });
    }
    items.push({ label: '前往下载页面', action: () => window.fnos.app.openRelease(result.url) });
    openMenu(items, dom.btnMenu);
  } else {
    toast(`已是最新版本 ${result.current}`, { type: 'success' });
  }
}

/* ---------------------------- 标签 ---------------------------- */

let lastNetworkToast = 0;
const tabNodes = new Map();

function createTabNode(tab) {
  const node = document.createElement('div');
  node.setAttribute('role', 'tab');

  const icon = document.createElement('div');
  icon.className = 'tab-icon';

  const favicon = document.createElement('img');
  favicon.className = 'tab-favicon';
  favicon.alt = '';
  favicon.addEventListener('error', () => {
    favicon.style.display = 'none';
    icon.classList.add('fallback');
  });

  const spinner = document.createElement('span');
  spinner.className = 'spinner';
  spinner.style.display = 'none';

  icon.appendChild(favicon);
  icon.appendChild(spinner);

  const title = document.createElement('span');
  title.className = 'tab-title';

  node.appendChild(icon);
  node.appendChild(title);

  const refs = { node, icon, favicon, spinner, title, close: null, faviconUrl: null };

  if (tab.kind !== 'desktop') {
    const close = document.createElement('button');
    close.type = 'button';
    close.className = 'tab-close';
    close.title = '关闭标签页';
    close.textContent = '×';
    // 关闭动作绑定在 mousedown：即使标签栏在按下与抬起之间被重绘，也不会丢失这次点击
    close.addEventListener('mousedown', (event) => {
      if (event.button !== 0) return;
      event.stopPropagation();
      event.preventDefault();
      closeTab(tab.id);
    });
    close.addEventListener('click', (event) => {
      event.stopPropagation();
      if (!state.tabs.some((item) => item.id === tab.id)) return;
      closeTab(tab.id);
    });
    node.appendChild(close);
    refs.close = close;
  }

  node.addEventListener('mousedown', (event) => {
    if (event.button !== 0) return;
    if (event.target && event.target.closest && event.target.closest('.tab-close')) return;
    activateTab(tab.id);
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

  return refs;
}

function paintTabNode(tab, refs) {
  const className = `tab${tab.id === state.activeId ? ' active' : ''}${tab.loading ? ' loading' : ''}`;
  if (refs.node.className !== className) refs.node.className = className;
  if (refs.node.dataset.id !== tab.id) refs.node.dataset.id = tab.id;

  const faviconUrl = tab.favicon || '';
  if (refs.faviconUrl !== faviconUrl) {
    refs.faviconUrl = faviconUrl;
    if (faviconUrl) {
      refs.favicon.src = faviconUrl;
      refs.favicon.style.display = '';
      refs.icon.classList.remove('fallback');
    } else {
      refs.favicon.removeAttribute('src');
      refs.favicon.style.display = 'none';
      refs.icon.classList.add('fallback');
    }
  }

  refs.spinner.style.display = tab.loading ? '' : 'none';

  const label = tab.title || '新标签页';
  if (refs.title.textContent !== label) refs.title.textContent = label;
  const tip = tab.title || '';
  if (refs.title.title !== tip) refs.title.title = tip;
}

/** 增量渲染：复用既有节点，避免整栏重建导致点击/拖拽被吞 */
function renderTabs() {
  let cursor = dom.tabs.firstElementChild;
  state.tabs.forEach((tab) => {
    let refs = tabNodes.get(tab.id);
    if (!refs) {
      refs = createTabNode(tab);
      tabNodes.set(tab.id, refs);
    }
    paintTabNode(tab, refs);
    const node = refs.node;
    if (node === cursor) {
      cursor = cursor.nextElementSibling;
    } else {
      dom.tabs.insertBefore(node, cursor || null);
      cursor = node.nextElementSibling;
    }
  });

  const alive = new Set(state.tabs.map((tab) => tab.id));
  tabNodes.forEach((refs, id) => {
    if (alive.has(id)) return;
    refs.node.remove();
    tabNodes.delete(id);
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

  const clearLoadTimer = () => {
    if (tab.loadTimer) {
      clearTimeout(tab.loadTimer);
      tab.loadTimer = null;
    }
  };

  view.addEventListener('dom-ready', () => {
    registerTab(tab);
    try {
      view.setZoomFactor(tab.zoom || 1);
    } catch (err) { /* 忽略 */ }
  });

  view.addEventListener('did-start-loading', () => {
    tab.loading = true;
    renderTabs();
    clearLoadTimer();
    // 连接不上 NAS 时 Chromium 可能长时间挂起，超时兜底避免标签一直转圈
    tab.loadTimer = setTimeout(() => {
      tab.loadTimer = null;
      if (!tab.loading) return;
      tab.loading = false;
      renderTabs();
      toast('连接超时：无法连接到服务器，请确认 NAS 已开机、地址与端口正确', { type: 'error', duration: 6000 });
    }, 25000);
  });

  view.addEventListener('did-stop-loading', () => {
    clearLoadTimer();
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
    if (event.isMainFrame === false) return;
    const wasLoading = tab.loading;
    clearLoadTimer();
    tab.loading = false;
    if (!tab.title || tab.title === '加载中…') {
      try { tab.title = new URL(tab.url || event.validatedURL).host; } catch (err) { /* 忽略 */ }
    }
    renderTabs();
    const now = Date.now();
    if (tab.lastError && now - tab.lastError < 8000) return;
    tab.lastError = now;
    const NETWORK_ERRORS = [-7, -21, -100, -101, -102, -103, -104, -105, -106, -107, -108, -109, -110, -118, -137, -324, -501, -502];
    if (NETWORK_ERRORS.includes(event.errorCode)) {
      // 多个标签同时连不上时只提示一次，避免提示刷屏
      if (Date.now() - lastNetworkToast < 4000) return;
      lastNetworkToast = Date.now();
      toast(`无法连接服务器：${event.errorDescription || event.errorCode}，请确认 NAS 已开机、地址与端口正确`, { type: 'error', duration: 6000 });
    } else {
      toast(`页面加载失败：${event.errorDescription || event.errorCode}`, { type: 'error', duration: 4200 });
    }
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

  // webview 必须先落入 DOM 才能创建 webContents；用 src 属性驱动首次加载，
  // 不依赖 dom-ready（该事件本身要等加载开始后才触发，会形成死锁）。
  try {
    view.setAttribute('src', url);
  } catch (err) {
    tab.loading = false;
    renderTabs();
    toast(`页面加载失败：${(err && err.message) || '未知错误'}`, { type: 'error', duration: 4200 });
  }

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
  const name = String(action || '');
  const tab = activeTab();
  switch (name) {
    case 'new-tab':
    case 'newTab':
      createTab({ url: state.baseUrl, kind: 'web', title: '新标签页' });
      break;
    case 'close-tab':
    case 'closeTab':
      if (tab) closeTab(tab.id);
      break;
    case 'next-tab':
    case 'nextTab': {
      const index = state.tabs.findIndex((item) => item.id === state.activeId);
      const next = state.tabs[(index + 1) % state.tabs.length];
      if (next) activateTab(next.id);
      break;
    }
    case 'prev-tab':
    case 'prevTab': {
      const index = state.tabs.findIndex((item) => item.id === state.activeId);
      const prev = state.tabs[(index - 1 + state.tabs.length) % state.tabs.length];
      if (prev) activateTab(prev.id);
      break;
    }
    case 'reload':
      if (tab && tab.view) tab.view.reload();
      break;
    case 'reload-hard':
    case 'forceReload':
      if (tab && tab.view) tab.view.reloadIgnoringCache();
      break;
    case 'zoom-in':
    case 'zoomIn':
    case 'zoom-out':
    case 'zoomOut':
    case 'zoom-reset':
    case 'zoomReset': {
      if (!tab) break;
      const reset = name === 'zoom-reset' || name === 'zoomReset';
      const plus = name === 'zoom-in' || name === 'zoomIn';
      const current = tab.zoom || 1;
      const next = reset ? 1 : (plus ? current + 0.1 : current - 0.1);
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
    case 'toggleDevTools':
      if (tab && tab.view) tab.view.openDevTools({ mode: 'detach' });
      break;
    case 'home':
    case 'goHome':
      if (state.baseUrl) createTab({ url: state.baseUrl, kind: 'desktop', title: '桌面' });
      break;
    case 'downloads':
    case 'openDownloads':
      window.fnos.app.openDownloads();
      break;
    case 'live':
    case 'openLive':
      window.fnos.app.openLive();
      break;
    case 'settings':
    case 'openSettings':
      window.fnos.app.openSettings();
      break;
    case 'lock':
    case 'lockScreen':
      window.fnos.lock.lock();
      break;
    case 'boss':
    case 'bossKey':
      window.fnos.lock.bossToggle();
      break;
    case 'media':
    case 'toggleMedia':
      toggleMediaDrawer();
      break;
    default: {
      const match = /^switch-([1-9])$/.exec(name);
      if (match) {
        const target = state.tabs[Number(match[1]) - 1];
        if (target) activateTab(target.id);
      }
    }
  }
}

/* ------------------------- 下载 / 媒体 / 锁屏 / 皮肤 ------------------------- */
function updateDownloadBadge(rows) {
  if (!dom.downloadBadge) return;
  const list = Array.isArray(rows) ? rows : [];
  const active = list.filter((row) => row && (row.state === 'progressing' || row.state === 'paused')).length;
  if (active > 0) {
    dom.downloadBadge.hidden = false;
    dom.downloadBadge.textContent = active > 99 ? '99+' : String(active);
  } else {
    dom.downloadBadge.hidden = true;
    dom.downloadBadge.textContent = '0';
  }
}

async function refreshDownloadBadge() {
  try {
    updateDownloadBadge(await window.fnos.downloads.list());
  } catch (err) {
    /* 忽略 */
  }
}

function formatSize(bytes) {
  const size = Number(bytes) || 0;
  if (size <= 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let index = 0;
  let value = size;
  while (value >= 1024 && index < units.length - 1) {
    value /= 1024;
    index += 1;
  }
  return `${value.toFixed(value < 10 && index > 0 ? 1 : 0)} ${units[index]}`;
}

async function renderMedia() {
  if (!dom.mediaList) return;
  let rows = [];
  try {
    rows = await window.fnos.media.list();
  } catch (err) {
    rows = [];
  }
  dom.mediaList.textContent = '';
  dom.mediaTip.hidden = rows.length > 0;
  rows.slice(0, 60).forEach((row) => {
    const item = document.createElement('li');
    item.className = 'media-item';

    const info = document.createElement('div');
    info.className = 'media-info';
    const name = document.createElement('strong');
    name.textContent = row.title || (row.mime || '媒体流');
    const meta = document.createElement('span');
    meta.textContent = `${row.platform === 'hls' ? 'HLS' : (row.mime || '媒体')} · ${formatSize(row.size)}`;
    info.appendChild(name);
    info.appendChild(meta);

    const play = document.createElement('button');
    play.className = 'mini primary';
    play.type = 'button';
    play.textContent = 'MPV';
    play.addEventListener('click', async () => {
      // 内嵌模式：画面贴在主窗口播放；否则交给独立 mpv 窗口
      if (state.settings && state.settings.mpvEmbed) {
        const ok = await openMpvStage(row);
        if (ok) dom.mediaDrawer.hidden = true;
        return;
      }
      const result = await window.fnos.mpv.playMedia(row.id);
      if (!result || !result.ok) toast('MPV 播放失败，请检查设置中的播放器路径', { type: 'error' });
    });

    item.appendChild(info);
    item.appendChild(play);
    dom.mediaList.appendChild(item);
  });
}

async function toggleMediaDrawer() {
  if (!dom.mediaDrawer) return;
  const nextHidden = !dom.mediaDrawer.hidden;
  dom.mediaDrawer.hidden = nextHidden;
  if (!nextHidden) await renderMedia();
}

/* ---------------- 内置播放器舞台（MPV 画面贴在主窗口内） ---------------- */
let mpvStageBound = false;
let mpvStageLive = false;
let mpvStageRow = null;
let mpvStageTimer = null;

function bindMpvStage() {
  if (mpvStageBound) return;
  mpvStageBound = true;
  if (dom.mpvStageClose) dom.mpvStageClose.addEventListener('click', () => closeMpvStage());
  if (dom.mpvStagePop) dom.mpvStagePop.addEventListener('click', () => popOutMpvStage());
  window.addEventListener('resize', () => {
    if (!mpvStageLive) return;
    clearTimeout(mpvStageTimer);
    mpvStageTimer = setTimeout(() => syncMpvStageRect(), 120);
  });
  // 侧栏折叠、窗口布局变化等不会触发 resize，用观察器补齐
  if (dom.mpvStageBody && typeof ResizeObserver === 'function') {
    const observer = new ResizeObserver(() => {
      if (!mpvStageLive) return;
      clearTimeout(mpvStageTimer);
      mpvStageTimer = setTimeout(() => syncMpvStageRect(), 120);
    });
    observer.observe(dom.mpvStageBody);
  }
}

// 返回 { rect, titlebarHeight }；rect 为相对窗口内容区（DIP）的遮罩矩形
function mpvStageGeometry() {
  const body = dom.mpvStageBody;
  const stage = dom.mpvStage;
  if (!body || !stage) return null;
  const b = body.getBoundingClientRect();
  return {
    rect: {
      x: Math.round(b.left),
      y: Math.round(b.top),
      width: Math.round(b.width),
      height: Math.round(b.height),
    },
    // 播放窗口顶边需对齐到 body 顶（标题栏 + 工具条下方），避免遮住工具条按钮
    titlebarHeight: Math.round(b.top),
  };
}

async function syncMpvStageRect() {
  if (!mpvStageLive) return;
  const geo = mpvStageGeometry();
  if (!geo || geo.rect.width < 40 || geo.rect.height < 40) return;
  try {
    await window.fnos.mpv.embedRect(geo.rect, { x: 0, y: 0 });
  } catch (err) {
    /* 窗口尺寸同步失败不影响播放 */
  }
}

async function openMpvStage(row) {
  if (!dom.mpvStage) return false;
  bindMpvStage();
  if (mpvStageLive) closeMpvStage();
  const title = row.title || row.mime || '媒体流';
  dom.mpvStageTitle.textContent = title;
  dom.mpvStageBody.textContent = '正在启动内置播放器…';
  dom.mpvStage.hidden = false;
  const geo = mpvStageGeometry();
  const result = await window.fnos.mpv.embedMedia({
    id: row.id,
    title,
    rect: geo && geo.rect,
    titlebarHeight: geo && geo.titlebarHeight,
  });
  if (!result || !result.ok) {
    dom.mpvStageBody.textContent = '';
    dom.mpvStage.hidden = true;
    toast((result && result.error) || '内置播放器启动失败，可在设置中关闭内嵌播放', { type: 'error' });
    return false;
  }
  mpvStageLive = true;
  mpvStageRow = row;
  dom.mpvStageBody.textContent = '';
  return true;
}

function closeMpvStage() {
  clearTimeout(mpvStageTimer);
  if (mpvStageLive) {
    window.fnos.mpv.embedClose().catch(() => {});
    mpvStageLive = false;
  }
  mpvStageRow = null;
  if (dom.mpvStageBody) dom.mpvStageBody.textContent = '';
  if (dom.mpvStage) dom.mpvStage.hidden = true;
}

// 转为独立播放窗口
async function popOutMpvStage() {
  const row = mpvStageRow;
  closeMpvStage();
  if (!row) return;
  const result = await window.fnos.mpv.playMedia(row.id);
  if (!result || !result.ok) toast('MPV 播放失败，请检查设置中的播放器路径', { type: 'error' });
}

function applyLockState(payload) {
  const locked = !!(payload && payload.locked);
  if (locked) closeMpvStage();
  document.body.classList.toggle('locked', locked);
  if (dom.lockScreen) dom.lockScreen.hidden = !locked;
  if (locked) {
    if (dom.lockSub && payload && payload.reason === 'idle') dom.lockSub.textContent = '长时间未操作，已自动锁定';
    setTimeout(() => {
      if (dom.lockPassword) dom.lockPassword.focus();
    }, 80);
  } else {
    if (dom.lockPassword) dom.lockPassword.value = '';
    if (dom.lockError) dom.lockError.hidden = true;
  }
}

async function syncLockState() {
  try {
    const status = await window.fnos.lock.status();
    const locked = !!(status && status.locked);
    const enabled = !!(status && status.enabled);
    if (locked && !enabled) {
      /* 未设置锁屏密码却处于锁定态：自动解除，避免出现无法解锁的死锁界面 */
      try { await window.fnos.lock.unlock(''); } catch (err) { /* 忽略 */ }
      applyLockState({ locked: false, reason: 'boot' });
      return;
    }
    applyLockState({ locked, reason: 'boot' });
  } catch (err) {
    /* 忽略 */
  }
}

const SKIN_TOKEN_MAP = {
  bg: '--bg',
  bgElev: '--surface',
  bgSunken: '--surface-2',
  bgHover: '--surface-3',
  surface: '--surface',
  surface2: '--surface-2',
  fg: '--text',
  fgDim: '--text-dim',
  text: '--text',
  textDim: '--text-dim',
  accent: '--accent',
  accentFg: '--accent-dim',
  accentDim: '--accent-dim',
  border: '--border',
  danger: '--danger',
  shadow: '--shadow',
  radius: '--radius',
  tabBg: '--surface-2',
  titlebar: '--surface'
};

function applySkin(payload) {
  const root = document.documentElement;
  if (!root) return;
  const raw = payload && payload.tokens ? payload.tokens : null;
  const tokens = raw && (raw.dark || raw.light) ? Object.assign({}, raw.light || {}, raw.dark || {}) : raw;
  const keys = tokens ? Object.keys(tokens) : [];
  if (!keys.length) {
    ['--bg', '--surface', '--surface-2', '--surface-3', '--border', '--text', '--text-dim',
      '--accent', '--accent-dim', '--danger'].forEach((name) => root.style.removeProperty(name));
    return;
  }
  Object.keys(tokens).forEach((key) => {
    const value = tokens[key];
    if (value === undefined || value === null || value === '') return;
    const name = key.startsWith('--') ? key : (SKIN_TOKEN_MAP[key] || `--${key}`);
    root.style.setProperty(name, String(value));
  });
}

async function syncSkin() {
  try {
    const data = await window.fnos.skin.list();
    const current = data && data.current ? data.current : null;
    applySkin(current ? { tokens: current.tokens } : null);
  } catch (err) {
    /* 忽略 */
  }
}

function bindFeatureButtons() {
  if (dom.btnDownloads) dom.btnDownloads.addEventListener('click', () => window.fnos.app.openDownloads());
  if (dom.btnLive) dom.btnLive.addEventListener('click', () => window.fnos.app.openLive());
  if (dom.btnLock) dom.btnLock.addEventListener('click', () => window.fnos.lock.lock());
  if (dom.btnMedia) dom.btnMedia.addEventListener('click', () => toggleMediaDrawer());
  if (dom.mediaClose) dom.mediaClose.addEventListener('click', () => { dom.mediaDrawer.hidden = true; });
  if (dom.mediaClear) dom.mediaClear.addEventListener('click', async () => {
    await window.fnos.media.clear();
    renderMedia();
  });

  if (dom.lockForm) {
    dom.lockForm.addEventListener('submit', async (event) => {
      event.preventDefault();
      const password = dom.lockPassword ? dom.lockPassword.value : '';
      if (!password) return;
      const result = await window.fnos.lock.unlock(password);
      if (result && result.ok) {
        applyLockState({ locked: false });
      } else {
        if (dom.lockError) {
          dom.lockError.hidden = false;
          dom.lockError.textContent = '密码不正确，请重试';
        }
        if (dom.lockPassword) {
          dom.lockPassword.value = '';
          dom.lockPassword.focus();
        }
      }
    });
  }
  if (dom.lockBoss) {
    dom.lockBoss.addEventListener('click', () => window.fnos.lock.bossToggle());
  }

  refreshDownloadBadge();
  syncSkin();
  syncLockState();
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
    desktop.loading = true;
    try {
      desktop.view.loadURL(server.url);
    } catch (err) {
      // webContents 尚未就绪时 loadURL 会抛错，退回 src 属性驱动加载
      try {
        desktop.view.setAttribute('src', server.url);
      } catch (err2) { /* 忽略 */ }
    }
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
    if (payload.state === 'started' || payload.phase === 'start') toast(`开始下载：${payload.filename}`);
    else if (payload.state === 'completed' || payload.phase === 'done') toast(`下载完成：${payload.filename}`, { type: 'success', duration: 4600 });
    else if (payload.state === 'interrupted' || payload.state === 'failed' || payload.phase === 'failed') toast(`下载中断：${payload.filename}`, { type: 'error', duration: 4600 });
  });

  window.fnos.on('shortcut:run', runAction);
  window.fnos.on('lock:state', applyLockState);
  window.fnos.on('lock:changed', applyLockState);
  window.fnos.on('downloads:changed', (rows) => updateDownloadBadge(rows));
  window.fnos.on('media:sniffed', () => {
    if (dom.mediaDrawer && !dom.mediaDrawer.hidden) renderMedia();
  });
  window.fnos.on('skin:changed', applySkin);
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
  bindFeatureButtons();
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


/* ---------------- 浮层 Esc 关闭（对齐上游：菜单/媒体抽屉/播放舞台可随时退出） ---------------- */
document.addEventListener('keydown', (event) => {
  if (!event || event.key !== 'Escape') return;
  if (dom.menuLayer && !dom.menuLayer.hidden) {
    closeMenu();
    return;
  }
  if (dom.mediaDrawer && !dom.mediaDrawer.hidden) {
    dom.mediaDrawer.hidden = true;
    return;
  }
  if (dom.mpvStage && !dom.mpvStage.hidden) {
    closeMpvStage();
  }
});
