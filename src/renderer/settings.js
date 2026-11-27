'use strict';

const api = window.fnos;
if (/Mac/i.test(navigator.userAgent)) document.body.classList.add('mac');

let settings = {};

const dom = {
  restoreTabs: document.getElementById('restoreTabs'),
  closeAction: document.getElementById('closeAction'),
  linkMode: document.getElementById('linkMode'),
  downloadDir: document.getElementById('download-dir'),
  askDownloadPath: document.getElementById('askDownloadPath'),
  autoStart: document.getElementById('autoStart'),
  keepLogin: document.getElementById('keepLogin'),
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

/* 面板切换：菜单/托盘/外部调用统一走这里，autoCheck 为 true 时顺带触发一次检查更新 */
function showSettingsPanel(name, autoCheck) {
  const panel = name || 'general';
  const target = document.querySelector(`.side-item[data-panel="${panel}"]`);
  if (!target) return false;
  document.querySelectorAll('.side-item').forEach((item) => item.classList.toggle('active', item === target));
  document.querySelectorAll('.panel').forEach((item) => item.classList.toggle('active', item.dataset.panel === panel));
  if (autoCheck && panel === 'about' && typeof checkUpdateNow === 'function') checkUpdateNow();
  return true;
}

window.showSettingsPanel = showSettingsPanel;

document.getElementById('side').addEventListener('click', (event) => {
  const button = event.target.closest('.side-item');
  if (!button) return;
  showSettingsPanel(button.dataset.panel);
});

function applySettings(next) {
  settings = Object.assign({}, settings, next || {});
  dom.restoreTabs.checked = settings.restoreTabs !== false;
  dom.closeAction.value = settings.closeAction === 'tray' ? 'tray' : 'quit';
  dom.linkMode.value = settings.externalBrowserForLinks ? 'browser' : 'tab';
  dom.askDownloadPath.checked = !!settings.askDownloadPath;

  /* 开机自启：以系统登录项的真实状态为准，切换失败即回滚开关 */
  if (dom.autoStart) {
    dom.autoStart.disabled = true;
    api.settings.getAutostart().then((res) => {
      dom.autoStart.checked = !!(res && res.enabled);
      dom.autoStart.disabled = false;
    }).catch(() => { dom.autoStart.disabled = false; });
    dom.autoStart.addEventListener('change', async () => {
      const want = dom.autoStart.checked;
      const res = await api.settings.setAutostart(want);
      if (!res || !res.ok) {
        dom.autoStart.checked = !want;
        if (typeof toast === 'function') toast((res && res.error) || '开机自启设置失败', { type: 'error' });
        return;
      }
      dom.autoStart.checked = !!res.enabled;
    });
  }

  /* 保持登录：关闭时当场清掉本机登录态，避免开关与实际状态不一致 */
  if (dom.keepLogin) {
    dom.keepLogin.checked = settings.keepLogin === true;
    dom.keepLogin.addEventListener('change', async () => {
      const want = dom.keepLogin.checked;
      if (!want && !window.confirm('关闭后本机保存的登录状态会立即清除，需要重新登录。确定关闭吗？')) {
        dom.keepLogin.checked = true;
        return;
      }
      const res = await api.settings.setKeepLogin(want);
      if (!res || !res.ok) {
        dom.keepLogin.checked = !want;
        if (typeof toast === 'function') toast('保持登录设置失败', { type: 'error' });
        return;
      }
      if (!want && typeof toast === 'function') toast('已清除本机登录状态');
    });
  }
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

    // NAS 登录账号密码：加密保存在本机，登录页自动填充
    const cred = document.createElement('div');
    cred.className = 'server-cred';

    const userInput = document.createElement('input');
    userInput.className = 'server-cred-input';
    userInput.placeholder = 'NAS 用户名';
    userInput.spellcheck = false;
    userInput.autocomplete = 'off';

    const passInput = document.createElement('input');
    passInput.className = 'server-cred-input';
    passInput.type = 'password';
    passInput.placeholder = 'NAS 密码';
    passInput.autocomplete = 'new-password';

    let savedValue = { username: '', password: '' };
    const saveCred = makeButton('保存账号', '', async () => {
      const password = passInput.value || savedValue.password || '';
      if (!userInput.value.trim() && !password) {
        saveCred.textContent = '请填写账号';
        setTimeout(() => { saveCred.textContent = '保存账号'; }, 1600);
        return;
      }
      const res = await api.vault.set(server.id, { username: userInput.value.trim(), password });
      if (res && res.ok) {
        savedValue = { username: userInput.value.trim(), password };
        passInput.value = '';
        passInput.placeholder = '已保存，留空则保持不变';
        saveCred.textContent = '已保存';
      } else {
        saveCred.textContent = '保存失败';
      }
      setTimeout(() => { if (saveCred.textContent !== '保存账号') saveCred.textContent = '保存账号'; }, 1800);
    });

    cred.appendChild(userInput);
    cred.appendChild(passInput);
    cred.appendChild(saveCred);
    card.appendChild(cred);

    api.vault.get(server.id).then((res) => {
      const value = (res && res.value) || {};
      savedValue = { username: value.username || '', password: value.password || '' };
      if (savedValue.username) userInput.value = savedValue.username;
      if (savedValue.password) passInput.placeholder = '已保存，留空则保持不变';
    }).catch(() => {});

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

async function checkUpdateNow() {
  if (!dom.checkUpdate || dom.checkUpdate.disabled) return;
  dom.checkUpdate.disabled = true;
  dom.updateStatus.textContent = '正在检查…';
  try {
    const result = await api.app.checkUpdate(true);
    if (!result || !result.ok) {
      dom.updateStatus.textContent = `检查失败：${(result && result.error) || '网络异常'}`;
      return;
    }
    if (!result.hasUpdate) {
      dom.updateStatus.textContent = `已是最新版本 ${result.current || ''}`.trim();
      return;
    }
    dom.updateStatus.textContent = `发现新版本 ${result.latest}（当前 ${result.current}），已打开更新窗口`;
    await api.app.openUpdate();
  } finally {
    dom.checkUpdate.disabled = false;
  }
}

dom.checkUpdate.addEventListener('click', () => { checkUpdateNow(); });

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
  const [current, info] = await Promise.all([api.settings.get(), api.version()]);
  applySettings(current);
  // app:version 返回 { version, electron, chrome, node } 对象，不能直接塞进 textContent，
  // 否则会渲染成 "[object Object]"。
  const ver = info && typeof info === 'object' ? info.version : info;
  const extra = info && info.electron ? ` · Electron ${info.electron}` : '';
  dom.version.textContent = ver ? `${ver}${extra}` : '-';
  await loadServers();
  const hashPanel = (location.hash || '').replace(/^#/, '').split('?')[0];
  if (hashPanel) showSettingsPanel(hashPanel, /[?&]check=1/.test(location.hash || ''));
}

boot().catch((err) => {
  console.error('[settings] 初始化失败:', err);
});
