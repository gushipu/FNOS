'use strict';

const { Menu, clipboard, shell } = require('electron');

const DESKTOP_PATHS = new Set([
  '',
  '/index.html',
  '/login',
  '/signin',
  '/auth',
  '/desktop',
  '/home',
  '/welcome',
  '/redirect'
]);

const OPEN_COOLDOWN = 1200;
const registry = new Map();
const recentOpens = new Map();
const learnedDesktop = new Set();

let lastRestore = { key: '', at: 0 };

let mainWindow = null;

function setMainWindow(win) {
  mainWindow = win;
}

function targetWindow(win) {
  return win && !win.isDestroyed() ? win : (mainWindow && !mainWindow.isDestroyed() ? mainWindow : null);
}

function parse(url) {
  try {
    const parsed = new URL(url);
    return {
      origin: parsed.origin,
      path: parsed.pathname.replace(/\/+$/, '') || '/',
      hash: parsed.hash || '',
      href: parsed.href
    };
  } catch (err) {
    return null;
  }
}

/** 将哈希片段解析为路径形式，便于与桌面路径集合比对 */
function hashPath(hash) {
  if (!hash || hash === '#' || hash === '#/') return '';
  const raw = hash.replace(/^#/, '');
  const withoutQuery = raw.split('?')[0];
  if (!withoutQuery.startsWith('/')) return '';
  const trimmed = withoutQuery.replace(/\/+$/, '');
  return trimmed || '/';
}

function routeKey(url) {
  const parsed = parse(url);
  return parsed ? `${parsed.path}${parsed.hash}` : '';
}

/** 判断地址是否属于桌面/登录流程，应留在常驻桌面标签内 */
function staysOnDesktop(targetUrl, baseUrl) {
  const target = parse(targetUrl);
  const base = parse(baseUrl);
  if (!target || !base) return false;
  if (target.origin !== base.origin) return false;

  if (learnedDesktop.has(routeKey(targetUrl))) return true;

  if (DESKTOP_PATHS.has(target.path) && !hashPath(target.hash)) return true;

  if (target.path === base.path && !hashPath(target.hash)) return true;

  const hashSegment = hashPath(target.hash);
  if (hashSegment && DESKTOP_PATHS.has(hashSegment)) return true;

  return false;
}

function notify(win, channel, payload) {
  const target = targetWindow(win);
  if (!target) return;
  try {
    target.webContents.send(channel, payload);
  } catch (err) {
    console.error('[tabs] 通知渲染层失败:', err && err.message);
  }
}

function openTab(url, options = {}) {
  if (!url || !/^https?:\/\//i.test(url)) return false;
  const now = Date.now();
  const last = recentOpens.get(url);
  if (last && now - last < OPEN_COOLDOWN) return false;
  recentOpens.set(url, now);
  if (recentOpens.size > 200) {
    for (const [key, time] of recentOpens) {
      if (now - time > 60000) recentOpens.delete(key);
    }
  }
  notify(options.win, 'tabs:open', {
    url,
    title: options.title || '',
    kind: options.kind || 'app',
    activate: options.activate !== false,
    source: options.source || 'system'
  });
  return true;
}

function registerTab(win, payload) {
  const data = payload || {};
  if (typeof data.webContentsId !== 'number') return { ok: false };
  registry.set(data.webContentsId, {
    tabId: data.tabId,
    kind: data.kind === 'desktop' ? 'desktop' : 'web',
    baseUrl: data.baseUrl || '',
    win: targetWindow(win),
    registeredAt: Date.now()
  });
  return { ok: true };
}

function unregisterTab(webContentsId) {
  registry.delete(webContentsId);
}

function tabInfo(webContentsId) {
  return registry.get(webContentsId) || null;
}

function restoreDesktop(contents, info) {
  if (!contents || contents.isDestroyed() || !info || !info.baseUrl) return;
  const current = contents.getURL();
  const key = routeKey(current);
  const now = Date.now();

  // 拉回首页后若又被导向同一地址，说明该地址本身属于桌面流程，登记后不再拦截
  if (key && key === lastRestore.key && now - lastRestore.at < 5000) {
    learnedDesktop.add(key);
    return;
  }
  lastRestore = { key, at: now };

  setTimeout(() => {
    if (contents.isDestroyed()) return;
    if (staysOnDesktop(contents.getURL(), info.baseUrl)) return;
    contents.loadURL(info.baseUrl).catch(() => {});
  }, 160);
}

function resolvedBase(contents, info) {
  if (info && info.baseUrl) return info.baseUrl;
  if (!contents || contents.isDestroyed()) return '';
  const current = contents.getURL();
  return /^https?:\/\//i.test(current) ? current : '';
}

function buildContextMenu(contents, params) {
  const items = [];
  if (params.linkURL) {
    items.push({
      label: '在新标签中打开链接',
      click: () => openTab(params.linkURL, { kind: 'app' })
    });
    items.push({
      label: '在系统浏览器中打开链接',
      click: () => shell.openExternal(params.linkURL).catch(() => {})
    });
    items.push({ label: '复制链接地址', click: () => clipboard.writeText(params.linkURL) });
    items.push({ type: 'separator' });
  }
  if (params.isEditable) {
    items.push({ label: '撤销', role: 'undo', enabled: params.editFlags.canUndo });
    items.push({ label: '重做', role: 'redo', enabled: params.editFlags.canRedo });
    items.push({ type: 'separator' });
    items.push({ label: '剪切', role: 'cut', enabled: params.editFlags.canCut });
    items.push({ label: '复制', role: 'copy', enabled: params.editFlags.canCopy });
    items.push({ label: '粘贴', role: 'paste', enabled: params.editFlags.canPaste });
    items.push({ label: '全选', role: 'selectAll' });
    items.push({ type: 'separator' });
  } else if (params.selectionText) {
    items.push({
      label: '复制',
      click: () => clipboard.writeText(params.selectionText)
    });
    items.push({ type: 'separator' });
  }
  items.push({
    label: '刷新页面',
    click: () => {
      if (!contents.isDestroyed()) contents.reload();
    }
  });
  items.push({
    label: '返回上一页',
    enabled: contents.canGoBack(),
    click: () => {
      if (!contents.isDestroyed() && contents.canGoBack()) contents.goBack();
    }
  });
  items.push({ type: 'separator' });
  items.push({
    label: '检查元素',
    click: () => {
      if (!contents.isDestroyed()) contents.inspectElement(params.x, params.y);
    }
  });

  return Menu.buildFromTemplate(items);
}

function attachContents(contents) {
  if (!contents || contents.isDestroyed()) return;
  if (contents.getType() !== 'webview') return;

  contents.setWindowOpenHandler(({ url }) => {
    if (url && /^https?:\/\//i.test(url)) {
      openTab(url, { kind: 'app', source: 'window-open' });
    }
    return { action: 'deny' };
  });

  contents.on('will-navigate', (event, url) => {
    const info = registry.get(contents.id);
    if (!info || info.kind !== 'desktop') return;
    if (!info.baseUrl) return;
    if (staysOnDesktop(url, info.baseUrl)) return;
    event.preventDefault();
    openTab(url, { win: info.win, kind: 'app', source: 'navigate' });
    restoreDesktop(contents, info);
  });

  contents.on('will-redirect', (event, url) => {
    const info = registry.get(contents.id);
    if (!info || info.kind !== 'desktop' || !info.baseUrl) return;
    if (staysOnDesktop(url, info.baseUrl)) return;
    event.preventDefault();
    openTab(url, { win: info.win, kind: 'app', source: 'redirect' });
    restoreDesktop(contents, info);
  });

  contents.on('context-menu', (event, params) => {
    try {
      const menu = buildContextMenu(contents, params);
      menu.popup({ window: targetWindow(registry.get(contents.id) && registry.get(contents.id).win) || undefined });
    } catch (err) {
      console.error('[tabs] 右键菜单失败:', err && err.message);
    }
  });

  contents.on('render-process-gone', () => {
    const info = registry.get(contents.id);
    if (info) {
      notify(info.win, 'tab:crashed', { tabId: info.tabId });
    }
  });

  contents.on('destroyed', () => {
    registry.delete(contents.id);
  });
}

/** SPA 内部路由变化（pushState）上报后的处理入口 */
function handleRouteChange(sender, href) {
  const info = registry.get(sender.id);
  if (!info || info.kind !== 'desktop' || !info.baseUrl || !href) return false;
  if (staysOnDesktop(href, info.baseUrl)) return false;
  const opened = openTab(href, { win: info.win, kind: 'app', source: 'route' });
  if (opened) restoreDesktop(sender, info);
  return opened;
}

module.exports = {
  setMainWindow,
  attachContents,
  registerTab,
  unregisterTab,
  tabInfo,
  openTab,
  handleRouteChange,
  staysOnDesktop
};
