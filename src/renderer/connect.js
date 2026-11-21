'use strict';

const form = document.getElementById('form');
const urlInput = document.getElementById('url');
const nameInput = document.getElementById('name');
const usernameInput = document.getElementById('username');
const passwordInput = document.getElementById('password');
const submitBtn = document.getElementById('submit');
const errorBox = document.getElementById('error');
const preview = document.getElementById('preview');
const recent = document.getElementById('recent');
const recentList = document.getElementById('recent-list');

document.getElementById('win-min').addEventListener('click', () => window.fnos.window.minimize());
document.getElementById('win-close').addEventListener('click', () => window.fnos.window.close());

function showError(message) {
  errorBox.textContent = message;
  errorBox.hidden = !message;
}

function setBusy(busy) {
  submitBtn.disabled = busy;
  submitBtn.textContent = busy ? '正在连接…' : '连接';
}

async function loadRecent() {
  const result = await window.fnos.servers.list();
  const servers = (result && result.servers) || [];
  if (!servers.length) {
    recent.hidden = true;
    return;
  }
  recentList.innerHTML = '';
  servers.slice(0, 6).forEach((server) => {
    const row = document.createElement('button');
    row.type = 'button';
    row.className = 'recent-item';

    const left = document.createElement('div');
    const name = document.createElement('div');
    name.className = 'name';
    name.textContent = server.name;
    const addr = document.createElement('div');
    addr.className = 'addr';
    addr.textContent = server.url;
    left.appendChild(name);
    left.appendChild(addr);

    const right = document.createElement('span');
    right.className = 'addr';
    right.textContent = '连接';

    row.appendChild(left);
    row.appendChild(right);
    row.addEventListener('click', async () => {
      setBusy(true);
      const activated = await window.fnos.servers.activate(server.id);
      setBusy(false);
      if (!activated || !activated.ok) showError((activated && activated.error) || '连接失败');
    });
    recentList.appendChild(row);
  });
  recent.hidden = false;
}

let previewTimer = 0;

function showPreview(target) {
  if (!target || !target.url) {
    preview.hidden = true;
    preview.textContent = '';
    return;
  }
  preview.hidden = false;
  preview.classList.remove('warn');
  preview.textContent = '';
  const label = document.createTextNode('将连接 ');
  const code = document.createElement('b');
  code.textContent = target.url;
  preview.appendChild(label);
  preview.appendChild(code);
  if (target.fnConnect) {
    preview.appendChild(document.createTextNode('（FN Connect 远程通道）'));
  } else if (target.defaultPort) {
    preview.classList.add('warn');
    preview.appendChild(document.createTextNode(target.hostKind === 'ip'
      ? '（IP 未写端口，已按默认端口补全）'
      : '（局域网主机名未写端口，已按默认端口补全）'));
  } else if (target.hostKind === 'domain' && !target.explicitPort) {
    preview.appendChild(document.createTextNode('（域名未写端口，按域名默认端口访问）'));
  }
}

urlInput.addEventListener('input', () => {
  window.clearTimeout(previewTimer);
  const raw = urlInput.value.trim();
  if (!raw) {
    showPreview(null);
    return;
  }
  previewTimer = window.setTimeout(async () => {
    try {
      const result = await window.fnos.connect.preview({ url: raw });
      showPreview(result && result.ok ? result : null);
    } catch (err) {
      showPreview(null);
    }
  }, 180);
});

form.addEventListener('submit', async (event) => {
  event.preventDefault();
  showError('');
  const raw = urlInput.value.trim();
  if (!raw) {
    showError('请填写设备地址或 FN ID');
    urlInput.focus();
    return;
  }
  setBusy(true);
  const result = await window.fnos.connect.submit({ url: raw, name: nameInput.value.trim() });
  setBusy(false);
  if (!result || !result.ok) {
    showError((result && result.error) || '地址无效，请检查后重试');
    return;
  }
  // 填了 NAS 账号密码就按设备加密保存，之后登录页自动填充
  const username = usernameInput.value.trim();
  const password = passwordInput.value;
  if ((username || password) && result.server && result.server.id) {
    try {
      const saved = await window.fnos.vault.set(result.server.id, { username, password });
      if (saved && saved.ok === false) {
        showError(`账号密码保存失败：${saved.error || '未知错误'}`);
      } else if (saved && saved.encrypted === false) {
        showError('账号密码已保存，但当前系统不支持加密存储');
      }
    } catch (err) {
      showError(`账号密码保存失败：${(err && err.message) || '未知错误'}`);
    }
  }
});

urlInput.focus();
loadRecent().catch(() => {});
