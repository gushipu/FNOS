'use strict';

const api = window.fnos || {};
const $ = (id) => document.getElementById(id);
const el = {
  file: $('file-select'),
  level: $('level-select'),
  keyword: $('keyword'),
  refresh: $('btn-refresh'),
  auto: $('auto'),
  counter: $('counter'),
  copy: $('btn-copy'),
  dir: $('btn-dir'),
  meta: $('meta'),
  log: $('log'),
  toast: $('toast')
};

let files = [];
let current = '';
let timer = null;
let lastText = '';

function toast(message) {
  if (!message) return;
  el.toast.textContent = message;
  el.toast.hidden = false;
  clearTimeout(toast._timer);
  toast._timer = setTimeout(() => { el.toast.hidden = true; }, 1800);
}

function sizeText(bytes) {
  const n = Number(bytes) || 0;
  if (n < 1024) return n + ' B';
  if (n < 1024 * 1024) return (n / 1024).toFixed(1) + ' KB';
  return (n / 1024 / 1024).toFixed(1) + ' MB';
}

function timeText(ms) {
  if (!ms) return '';
  const d = new Date(ms);
  const pad = (v) => String(v).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

async function refreshFiles() {
  try {
    const result = await api.logs.files();
    files = (result && result.files) || [];
    const keep = current || el.file.value;
    el.file.innerHTML = '';
    if (!files.length) {
      const opt = document.createElement('option');
      opt.value = '';
      opt.textContent = '暂无日志文件';
      el.file.appendChild(opt);
      current = '';
      el.log.textContent = '暂无日志内容';
      el.counter.textContent = '0 行';
      return;
    }
    files.forEach((file) => {
      const opt = document.createElement('option');
      opt.value = file.name;
      opt.textContent = `${file.name} · ${sizeText(file.size)} · ${timeText(file.at)}`;
      el.file.appendChild(opt);
    });
    current = files.some((f) => f.name === keep) ? keep : files[0].name;
    el.file.value = current;
  } catch (err) {
    toast('读取日志列表失败');
  }
}

async function load() {
  if (!current) return;
  try {
    const result = await api.logs.read(current, {
      level: el.level.value,
      keyword: el.keyword.value,
      limit: 3000
    });
    if (!result || !result.ok) {
      el.log.textContent = (result && result.error) || '读取失败';
      el.counter.textContent = '0 行';
      return;
    }
    const text = result.content || '（无匹配内容）';
    const atBottom = el.log.scrollHeight - el.log.scrollTop - el.log.clientHeight < 60;
    if (text !== lastText) {
      lastText = text;
      el.log.textContent = text;
      if (atBottom) el.log.scrollTop = el.log.scrollHeight;
    }
    el.counter.textContent = `${result.matched} / ${result.total} 行`;
    el.meta.hidden = false;
    el.meta.textContent = `${result.name} · 已显示最近 ${Math.min(result.matched, 3000)} 行`
      + (result.truncated ? '（已截断，可用关键词收窄）' : '');
  } catch (err) {
    toast('读取日志失败');
  }
}

async function reloadAll() {
  await refreshFiles();
  await load();
}

function startAuto() {
  stopAuto();
  if (!el.auto.checked) return;
  timer = setInterval(() => {
    if (document.visibilityState === 'hidden') return;
    load();
  }, 5000);
}

function stopAuto() {
  if (timer) clearInterval(timer);
  timer = null;
}

el.file.addEventListener('change', () => {
  current = el.file.value;
  lastText = '';
  load();
});
el.level.addEventListener('change', load);
el.keyword.addEventListener('input', () => {
  clearTimeout(el.keyword._timer);
  el.keyword._timer = setTimeout(load, 260);
});
el.refresh.addEventListener('click', reloadAll);
el.auto.addEventListener('change', startAuto);
el.copy.addEventListener('click', async () => {
  try {
    await navigator.clipboard.writeText(el.log.textContent || '');
    toast('已复制当前日志');
  } catch (err) {
    toast('复制失败');
  }
});
el.dir.addEventListener('click', () => {
  if (api.logs && api.logs.dir) api.logs.dir();
});
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') reloadAll();
});

reloadAll();
startAuto();
