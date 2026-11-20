'use strict';

/* 托盘菜单弹层渲染：
   1. 向主进程取菜单项并渲染；
   2. 量出真实内容高度回传给主进程，由主进程按托盘图标位置定位窗口后显示（避免占位高度闪动）；
   3. 点击或回车执行动作，Esc/失焦关闭。 */
const api = window.fnos && window.fnos.trayMenu;
const root = document.getElementById('menu');

let rows = [];
let cursor = -1;

function clearFocus() {
  rows.forEach((row) => row.classList.remove('focused'));
}

function focusAt(index) {
  if (!rows.length) return;
  const next = (index + rows.length) % rows.length;
  cursor = next;
  clearFocus();
  const row = rows[next];
  row.classList.add('focused');
  if (typeof row.scrollIntoView === 'function') row.scrollIntoView({ block: 'nearest' });
}

function buildRow(item) {
  const row = document.createElement('button');
  row.type = 'button';
  row.className = 'item';
  row.setAttribute('role', item.checked ? 'menuitemradio' : 'menuitem');
  if (item.checked) {
    row.classList.add('checked');
    row.setAttribute('aria-checked', 'true');
  }

  const tick = document.createElement('span');
  tick.className = 'tick';
  tick.textContent = item.checked ? '✓' : '';

  const label = document.createElement('span');
  label.className = 'label';
  label.textContent = item.label || '';

  row.appendChild(tick);
  row.appendChild(label);

  if (item.hint) {
    const hint = document.createElement('span');
    hint.className = 'hint';
    hint.textContent = item.hint;
    row.appendChild(hint);
  }

  row.addEventListener('mouseenter', () => {
    const index = rows.indexOf(row);
    if (index >= 0) focusAt(index);
  });
  row.addEventListener('click', () => invoke(item));
  return row;
}

async function invoke(item) {
  if (!item || root.classList.contains('busy')) return;
  root.classList.add('busy');
  try {
    await api.action({ name: item.key, id: item.id });
  } catch (err) {
    /* 窗口已被主进程关闭，忽略 */
  }
}

function render(items) {
  root.textContent = '';
  rows = [];
  cursor = -1;
  (items || []).forEach((item) => {
    if (item && item.separator) {
      const sep = document.createElement('div');
      sep.className = 'sep';
      root.appendChild(sep);
      return;
    }
    if (!item || !item.key) return;
    const row = buildRow(item);
    rows.push(row);
    root.appendChild(row);
  });
}

function nextFrame() {
  return new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
}

async function boot() {
  if (!api) return;
  let items = [];
  try {
    const data = await api.items();
    items = (data && data.items) || [];
  } catch (err) {
    items = [];
  }
  render(items);
  await nextFrame();
  const height = Math.ceil(root.getBoundingClientRect().height) + 8;
  try {
    await api.ready({ height });
  } catch (err) {
    /* 忽略 */
  }
  focusAt(0);
}

document.addEventListener('keydown', (event) => {
  if (!api) return;
  if (event.key === 'Escape') {
    event.preventDefault();
    Promise.resolve(api.close()).catch(() => {});
    return;
  }
  if (event.key === 'ArrowDown') {
    event.preventDefault();
    focusAt(cursor + 1);
    return;
  }
  if (event.key === 'ArrowUp') {
    event.preventDefault();
    focusAt(cursor - 1);
    return;
  }
  if (event.key === 'Enter' || event.key === ' ') {
    event.preventDefault();
    const row = rows[Math.max(0, cursor)];
    if (row) row.click();
  }
});

/* 关闭由主进程监听 blur 负责，这里不再重复触发，避免刚显示就因焦点竞争被关掉 */
boot();
