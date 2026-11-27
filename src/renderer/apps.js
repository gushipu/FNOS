'use strict';

const api = window.fnos || {};
const $ = (id) => document.getElementById(id);
const el = {
  search: $('search'),
  refresh: $('btn-refresh'),
  record: $('btn-record'),
  counter: $('counter'),
  bar: $('record-bar'),
  name: $('rec-name'),
  url: $('rec-url'),
  save: $('rec-save'),
  cancel: $('rec-cancel'),
  grid: $('grid'),
  empty: $('empty'),
  toast: $('toast')
};

let apps = [];
let keyword = '';

function toast(message) {
  if (!message) return;
  el.toast.textContent = message;
  el.toast.hidden = false;
  clearTimeout(toast._timer);
  toast._timer = setTimeout(() => { el.toast.hidden = true; }, 1800);
}

function hostOf(url) {
  try { return new URL(url).host; } catch (err) { return url || ''; }
}

function initialOf(name) {
  const text = String(name || '').trim();
  return text ? text.slice(0, 1).toUpperCase() : '#';
}

function render() {
  const list = apps.filter((app) => {
    if (!keyword) return true;
    const hay = (app.name + ' ' + app.url).toLowerCase();
    return hay.indexOf(keyword) >= 0;
  });
  el.grid.innerHTML = '';
  list.forEach((app) => {
    const card = document.createElement('div');
    card.className = 'card';
    card.title = app.url;

    const icon = document.createElement('div');
    icon.className = 'icon';
    if (app.icon) {
      const img = document.createElement('img');
      img.src = app.icon;
      img.alt = app.name || '应用';
      icon.appendChild(img);
    } else {
      icon.textContent = initialOf(app.name);
    }

    const info = document.createElement('div');
    info.className = 'info';
    const name = document.createElement('div');
    name.className = 'name';
    name.textContent = app.name || hostOf(app.url);
    const host = document.createElement('div');
    host.className = 'host';
    host.textContent = hostOf(app.url);
    info.appendChild(name);
    info.appendChild(host);

    const tools = document.createElement('div');
    tools.className = 'tools';
    const iconBtn = document.createElement('button');
    iconBtn.className = 'tool';
    iconBtn.type = 'button';
    iconBtn.textContent = '图标';
    iconBtn.addEventListener('click', async (event) => {
      event.stopPropagation();
      const res = await api.apps.pickIcon(app.appId);
      if (res && res.ok) { toast('图标已更新'); load(); }
      else if (res && res.error) toast(res.error);
    });
    const removeBtn = document.createElement('button');
    removeBtn.className = 'tool danger';
    removeBtn.type = 'button';
    removeBtn.textContent = '移除';
    removeBtn.addEventListener('click', async (event) => {
      event.stopPropagation();
      await api.apps.remove(app.appId);
      toast('已移除');
      load();
    });
    tools.appendChild(iconBtn);
    tools.appendChild(removeBtn);

    card.appendChild(icon);
    card.appendChild(info);
    card.appendChild(tools);
    card.addEventListener('dblclick', () => open(app));
    card.addEventListener('click', () => open(app));
    el.grid.appendChild(card);
  });
  el.counter.textContent = `${list.length} 个应用`;
  el.empty.hidden = list.length > 0;
  if (!apps.length) el.empty.textContent = '还没有收录应用。在 NAS 上打开容器应用后，点「收录应用」把入口和图标存到本地，断网也能从宫格打开。';
  else if (!list.length) el.empty.textContent = '没有匹配的应用';
}

async function open(app) {
  const res = await api.apps.launch({ url: app.url, name: app.name });
  if (res && !res.ok) toast(res.error || '打开失败');
}

async function load() {
  try {
    const res = await api.apps.list();
    apps = (res && res.apps) || [];
  } catch (err) {
    apps = [];
  }
  render();
}

el.search.addEventListener('input', () => {
  keyword = el.search.value.trim().toLowerCase();
  render();
});
el.refresh.addEventListener('click', load);
el.record.addEventListener('click', () => {
  el.bar.hidden = !el.bar.hidden;
  if (!el.bar.hidden) el.name.focus();
});
el.cancel.addEventListener('click', () => {
  el.bar.hidden = true;
  el.name.value = '';
  el.url.value = '';
});
el.save.addEventListener('click', async () => {
  const url = el.url.value.trim();
  if (!/^https?:\/\//i.test(url)) { toast('请填写以 http(s):// 开头的应用地址'); return; }
  const res = await api.apps.record({ name: el.name.value.trim(), url });
  if (!res || !res.ok) { toast((res && res.error) || '保存失败'); return; }
  el.name.value = '';
  el.url.value = '';
  el.bar.hidden = true;
  toast('已收录');
  load();
});

load();
