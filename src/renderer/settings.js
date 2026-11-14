'use strict';

const api = window.fnos;
let settings = {};

const dom = {
  restoreTabs: document.getElementById('restoreTabs'),
  closeAction: document.getElementById('closeAction'),
  linkMode: document.getElementById('linkMode'),
  downloadDir: document.getElementById('download-dir'),
  askDownloadPath: document.getElementById('askDownloadPath'),
  theme: document.getElementById('theme'),
  serverList: document.getElementById('server-list'),
  addServer: document.getElementById('add-server'),
  chooseDir: document.getElementById('choose-dir'),
  openDir: document.getElementById('open-dir'),
  version: document.getElementById('version'),
  updateStatus: document.getElementById('update-status'),
  checkUpdate: document.getElementById('check-update'),
  openRepo: document.getElementById('open-repo'),
  clearCache: document.getElementById('clear-cache'),
  clearLogin: document.getElementById('clear-login')
};

document.getElementById('win-min').addEventListener('click', () => api.window.minimize());
document.getElementById('win-close').addEventListener('click', () => api.window.close());

document.getElementById('side').addEventListener('click', (event) => {
  const button = event.target.closest('.side-item');
  if (!button) return;
  document.querySelectorAll('.side-item').forEach((item) => item.classList.toggle('active', item === button));
  const panel = button.dataset.panel;
  document.querySelectorAll('.panel').forEach((item) => item.classList.toggle('active', item.dataset.panel === panel));
});

function applySettings(next) {
  settings = Object.assign({}, settings, next || {});
  dom.restoreTabs.checked = settings.restoreTabs !== false;
  dom.closeAction.value = settings.closeAction === 'tray' ? 'tray' : 'quit';
  dom.linkMode.value = settings.externalBrowserForLinks ? 'browser' : 'tab';
  dom.askDownloadPath.checked = !!settings.askDownloadPath;
  dom.theme.value = settings.theme || 'system';
  dom.downloadDir.textContent = settings.downloadDir || '系统默认下载目录';
}

function patch(payload) {
  api.settings.patch(payload).then((next) => applySettings(next)).catch(() => {});
}

dom.restoreTabs.addEventListener('change', () => patch({ restoreTabs: dom.restoreTabs.checked }));
dom.closeAction.addEventListener('change', () => patch({ closeAction: dom.closeAction.value }));
dom.linkMode.addEventListener('change', () => patch({ externalBrowserForLinks: dom.linkMode.value === 'browser' }));
dom.askDownloadPath.addEventListener('change', () => patch({ askDownloadPath: dom.askDownloadPath.checked }));
dom.theme.addEventListener('change', () => patch({ theme: dom.theme.value }));

dom.chooseDir.addEventListener('click', async () => {
  const result = await api.settings.chooseDownloadDir();
  if (result && result.ok) {
    const next = await api.settings.get();
    applySettings(next);
  }
});

dom.openDir.addEventListener('click', async () => {
  const result = await api.settings.openDownloadDir();
  if (result && !result.ok) dom.openDir.textContent = '无法打开';
});

function makeButton(label, className, onClick) {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = `ghost${className ? ` ${className}` : ''}`;
  button.textContent = label;
  button.addEventListener('click', onClick);
  return button;
}

function confirmButton(button, label, action) {
  if (button.dataset.armed === '1') {
    clearTimeout(Number(button.dataset.timer || 0));
    button.dataset.armed = '';
    button.classList.remove('confirming');
    action();
    return;
  }
  button.dataset.armed = '1';
  const original = label;
  button.textContent = '确认删除';
  button.classList.add('confirming');
  const timer = setTimeout(() => {
    button.dataset.armed = '';
    button.textContent = original;
    button.classList.remove('confirming');
  }, 3600);
  button.dataset.timer = String(timer);
}

async function loadServers() {
  const result = await api.servers.list();
  const servers = (result && result.servers) || [];
  const activeId = result && result.activeId;
  dom.serverList.innerHTML = '';

  if (!servers.length) {
    const empty = document.createElement('p');
    empty.className = 'panel-desc';
    empty.textContent = '尚未添加任何设备。';
    dom.serverList.appendChild(empty);
    return;
  }

  servers.forEach((server) => {
    const card = document.createElement('div');
    card.className = 'server-card';

    const main = document.createElement('div');
    main.className = 'server-main';

    const name = document.createElement('input');
    name.className = 'server-name';
    name.value = server.name;
    name.spellcheck = false;
    name.addEventListener('change', () => {
      const value = name.value.trim();
      if (!value) {
        name.value = server.name;
        return;
      }
      api.servers.update({ id: server.id, name: value }).then(loadServers);
    });

    const url = document.createElement('div');
    url.className = 'server-url';
    url.textContent = server.url;

    main.appendChild(name);
    main.appendChild(url);
    card.appendChild(main);

    const actions = document.createElement('div');
    actions.className = 'server-actions';

    if (server.id === activeId) {
      const badge = document.createElement('span');
      badge.className = 'badge';
      badge.textContent = '默认';
      actions.appendChild(badge);
    } else {
      actions.appendChild(makeButton('设为默认', '', async () => {
        await api.servers.activate(server.id);
        loadServers();
      }));
    }

    const remove = makeButton('删除', 'danger', () => {});
    remove.addEventListener('click', () => {
      confirmButton(remove, '删除', async () => {
        await api.servers.remove(server.id);
        loadServers();
      });
    });
    actions.appendChild(remove);

    card.appendChild(actions);
    dom.serverList.appendChild(card);
  });
}

dom.addServer.addEventListener('click', () => api.app.openConnect());

dom.checkUpdate.addEventListener('click', async () => {
  dom.updateStatus.textContent = '正在检查…';
  const result = await api.app.checkUpdate();
  if (!result || !result.ok) {
    dom.updateStatus.textContent = `检查失败：${(result && result.error) || '网络异常'}`;
    return;
  }
  dom.updateStatus.textContent = result.hasUpdate
    ? `发现新版本 ${result.latest}（当前 ${result.current}）`
    : `已是最新版本 ${result.current}`;
});

dom.openRepo.addEventListener('click', () => api.app.openExternal('https://github.com/gushipu/FNOS'));

dom.clearCache.addEventListener('click', async () => {
  const result = await api.app.clearCache();
  dom.clearCache.textContent = result && result.ok ? '已清除' : '失败';
  setTimeout(() => { dom.clearCache.textContent = '清除'; }, 2200);
});

dom.clearLogin.addEventListener('click', () => {
  confirmButton(dom.clearLogin, '清除', async () => {
    const result = await api.app.clearLogin();
    dom.clearLogin.textContent = result && result.ok ? '已清除' : '失败';
    setTimeout(() => { dom.clearLogin.textContent = '清除'; }, 2200);
  });
});

async function boot() {
  const [current, version] = await Promise.all([api.settings.get(), api.version()]);
  applySettings(current);
  dom.version.textContent = version || '-';
  await loadServers();
}

boot().catch((err) => {
  console.error('[settings] 初始化失败:', err);
});
