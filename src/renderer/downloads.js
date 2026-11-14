'use strict';

const dom = {
  rows: document.getElementById('rows'),
  empty: document.getElementById('empty'),
  summary: document.getElementById('summary'),
  openDir: document.getElementById('btn-open-dir'),
  pauseAll: document.getElementById('btn-pause-all'),
  clear: document.getElementById('btn-clear'),
  refresh: document.getElementById('btn-refresh'),
  toast: document.getElementById('toast')
};

const STATE_TEXT = {
  progressing: '下载中',
  paused: '已暂停',
  completed: '已完成',
  interrupted: '已中断',
  cancelled: '已取消',
  pending: '等待中'
};

let toastTimer = null;

function toast(message) {
  if (!dom.toast) return;
  dom.toast.textContent = message;
  dom.toast.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { dom.toast.hidden = true; }, 2600);
}

function formatSize(bytes) {
  const size = Number(bytes) || 0;
  if (size <= 0) return '—';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let index = 0;
  let value = size;
  while (value >= 1024 && index < units.length - 1) {
    value /= 1024;
    index += 1;
  }
  return `${value.toFixed(value < 10 && index > 0 ? 1 : 0)} ${units[index]}`;
}

function progressOf(row) {
  const total = Number(row.totalBytes || row.total || 0);
  const received = Number(row.receivedBytes || row.received || 0);
  if (!total) return { percent: row.state === 'completed' ? 100 : 0, received, total };
  return { percent: Math.min(100, Math.round((received / total) * 100)), received, total };
}

function createButton(label, className, onClick) {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = className || 'mini';
  button.textContent = label;
  button.addEventListener('click', onClick);
  return button;
}

function renderRows(rows) {
  const list = Array.isArray(rows) ? rows : [];
  dom.rows.textContent = '';
  dom.empty.hidden = list.length > 0;
  dom.summary.textContent = list.length ? `共 ${list.length} 项` : '暂无任务';

  list.forEach((row) => {
    const tr = document.createElement('tr');

    const nameTd = document.createElement('td');
    const nameCell = document.createElement('div');
    nameCell.className = 'name-cell';
    const name = document.createElement('strong');
    name.textContent = row.filename || row.savePath || '未命名文件';
    const path = document.createElement('span');
    path.textContent = row.savePath || row.url || '';
    nameCell.appendChild(name);
    if (row.savePath || row.url) nameCell.appendChild(path);
    nameTd.appendChild(nameCell);

    const stateTd = document.createElement('td');
    const tag = document.createElement('span');
    tag.className = `state-tag ${row.state || ''}`;
    tag.textContent = STATE_TEXT[row.state] || row.state || '未知';
    stateTd.appendChild(tag);

    const progressTd = document.createElement('td');
    const info = progressOf(row);
    const wrap = document.createElement('div');
    wrap.className = 'progress';
    const track = document.createElement('div');
    track.className = 'progress-track';
    const fill = document.createElement('div');
    fill.className = 'progress-fill';
    fill.style.width = `${info.percent}%`;
    track.appendChild(fill);
    const meta = document.createElement('div');
    meta.className = 'progress-meta';
    meta.textContent = `${info.percent}%`;
    wrap.appendChild(track);
    wrap.appendChild(meta);
    progressTd.appendChild(wrap);

    const sizeTd = document.createElement('td');
    sizeTd.textContent = formatSize(info.total || info.received);

    const actionTd = document.createElement('td');
    const actions = document.createElement('div');
    actions.className = 'actions';

    if (row.state === 'progressing') {
      actions.appendChild(createButton('暂停', 'mini', async () => {
        const result = await window.fnos.downloads.control(row.id, 'pause');
        if (!result || !result.ok) toast((result && result.error) || '暂停失败');
        refresh();
      }));
    } else if (row.state === 'paused') {
      actions.appendChild(createButton('继续', 'mini', async () => {
        const result = await window.fnos.downloads.control(row.id, 'resume');
        if (!result || !result.ok) toast((result && result.error) || '无法继续');
        refresh();
      }));
    }

    if (row.state === 'completed') {
      actions.appendChild(createButton('打开', 'mini', async () => {
        const result = await window.fnos.downloads.open(row.id);
        if (!result || !result.ok) toast((result && result.error) || '文件不存在');
      }));
    }

    actions.appendChild(createButton('定位', 'mini', async () => {
      const result = await window.fnos.downloads.folder(row.id);
      if (!result || !result.ok) toast((result && result.error) || '无法定位文件');
    }));

    actions.appendChild(createButton('移除', 'mini danger', async () => {
      const result = await window.fnos.downloads.remove(row.id);
      if (!result || !result.ok) toast((result && result.error) || '移除失败');
      refresh();
    }));

    actionTd.appendChild(actions);

    tr.appendChild(nameTd);
    tr.appendChild(stateTd);
    tr.appendChild(progressTd);
    tr.appendChild(sizeTd);
    tr.appendChild(actionTd);
    dom.rows.appendChild(tr);
  });
}

async function refresh() {
  try {
    renderRows(await window.fnos.downloads.list());
  } catch (err) {
    toast('读取下载列表失败');
  }
}

dom.openDir.addEventListener('click', () => window.fnos.settings.openDownloadDir());
dom.refresh.addEventListener('click', refresh);
dom.pauseAll.addEventListener('click', async () => {
  await window.fnos.downloads.pauseAll();
  toast('已暂停全部任务');
  refresh();
});
dom.clear.addEventListener('click', async () => {
  await window.fnos.downloads.clear();
  refresh();
});

window.fnos.on('downloads:changed', (rows) => renderRows(rows));
window.fnos.on('download:event', () => refresh());

refresh();
