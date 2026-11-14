'use strict';

const form = document.getElementById('form');
const urlInput = document.getElementById('url');
const nameInput = document.getElementById('name');
const submitBtn = document.getElementById('submit');
const errorBox = document.getElementById('error');
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

form.addEventListener('submit', async (event) => {
  event.preventDefault();
  showError('');
  const raw = urlInput.value.trim();
  if (!raw) {
    showError('请填写设备地址');
    urlInput.focus();
    return;
  }
  setBusy(true);
  const result = await window.fnos.connect.submit({ url: raw, name: nameInput.value.trim() });
  setBusy(false);
  if (!result || !result.ok) {
    showError((result && result.error) || '地址无效，请检查后重试');
  }
});

urlInput.focus();
loadRecent().catch(() => {});
