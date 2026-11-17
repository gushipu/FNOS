'use strict';

const api = window.fnos;

const dom = {
  version: document.getElementById('version'),
  versionCurrent: document.getElementById('version-current'),
  versionLatest: document.getElementById('version-latest'),
  status: document.getElementById('status'),
  notes: document.getElementById('notes'),
  progressCard: document.getElementById('progress-card'),
  progressBar: document.getElementById('progress-bar'),
  progressText: document.getElementById('progress-text'),
  recheck: document.getElementById('recheck'),
  later: document.getElementById('later'),
  download: document.getElementById('download')
};

let pending = null;
let busy = false;
let installer = '';

document.getElementById('win-min').addEventListener('click', () => api.window.minimize());
document.getElementById('win-close').addEventListener('click', () => api.window.close());
dom.later.addEventListener('click', () => api.window.close());

function setStatus(text) {
  dom.status.textContent = text;
}

function renderNotes(text) {
  const body = String(text || '').trim();
  if (!body) {
    dom.notes.hidden = true;
    return;
  }
  dom.notes.hidden = false;
  dom.notes.textContent = body;
}

function setProgress(percent, text) {
  dom.progressCard.hidden = false;
  const value = Math.max(0, Math.min(100, Math.round(Number(percent) || 0)));
  dom.progressBar.style.width = `${value}%`;
  dom.progressText.textContent = text || `${value}%`;
}

async function loadVersion() {
  try {
    const info = await api.version();
    const ver = info && typeof info === 'object' ? info.version : info;
    const text = ver ? `当前版本 ${ver}` : '当前版本 -';
    dom.version.textContent = text;
    dom.versionCurrent.textContent = ver ? String(ver) : '-';
  } catch (err) {
    dom.version.textContent = '当前版本 -';
  }
}

async function runCheck() {
  if (busy) return;
  busy = true;
  dom.download.disabled = true;
  dom.recheck.disabled = true;
  dom.progressCard.hidden = true;
  dom.progressBar.style.width = '0%';
  setStatus('正在检查更新…');
  renderNotes('');
  try {
    const result = await api.app.checkUpdate(true);
    if (!result || !result.ok) {
      setStatus(`检查失败：${(result && result.error) || '网络异常，请稍后重试'}`);
      return;
    }
    if (result.current) dom.versionCurrent.textContent = String(result.current);
    if (result.latest) dom.versionLatest.textContent = String(result.latest);
    if (!result.hasUpdate) {
      setStatus(`已是最新版本 ${result.current || ''}`.trim());
      return;
    }
    pending = result.asset && result.asset.url ? result.asset : null;
    setStatus(`发现新版本 ${result.latest}（当前 ${result.current}），即将在此窗口内下载安装`);
    renderNotes(result.notes);
    dom.download.disabled = !pending;
    dom.download.textContent = pending ? '下载并安装' : '前往发布页下载';
    // 检测到新版本后直接在应用内开始下载（带进度条，完成后自动打开安装包）
    if (pending) setTimeout(() => { startDownload(); }, 450);
  } catch (err) {
    setStatus(`检查失败：${(err && err.message) || '网络异常'}`);
  } finally {
    busy = false;
    dom.recheck.disabled = false;
  }
}

dom.recheck.addEventListener('click', runCheck);

async function startDownload() {
  if (busy) return;
  if (installer) {
    await api.app.openInstaller(installer);
    return;
  }
  if (!pending) {
    const result = await api.app.checkUpdate(true);
    if (result && result.ok && result.url) await api.app.openExternal(result.url);
    return;
  }
  busy = true;
  dom.download.disabled = true;
  dom.download.textContent = '下载中…';
  setProgress(0, '正在连接下载服务器…');
  setStatus(`正在下载 ${pending.name || '安装包'}，下载完成后会自动退出并完成安装`);
  try {
    const result = await api.app.downloadUpdate(pending.url, pending.name);
    if (result && result.ok && result.file) {
      installer = result.file;
      setProgress(100, '下载完成，应用即将退出并自动安装…');
      setStatus('安装包已下载完成，应用将退出并在原安装目录完成覆盖安装');
      dom.download.textContent = '再次执行安装';
      dom.download.disabled = false;
    } else {
      setStatus(`下载失败：${(result && result.error) || '网络异常'}`);
      dom.download.textContent = '重试下载';
      dom.download.disabled = false;
      setProgress(0, '下载失败');
    }
  } catch (err) {
    setStatus(`下载失败：${(err && err.message) || '网络异常'}`);
    dom.download.textContent = '重试下载';
    dom.download.disabled = false;
  } finally {
    busy = false;
  }
}

dom.download.addEventListener('click', () => { startDownload(); });

if (typeof api.app.onUpdateProgress === 'function') {
  api.app.onUpdateProgress((payload) => {
    if (!payload) return;
    if (payload.applying) {
      setProgress(100, '正在退出并安装新版本…');
      setStatus('应用即将退出，安装程序会在原安装目录完成覆盖安装');
      return;
    }
    if (payload.done) {
      setProgress(100, '下载完成');
      return;
    }
    const total = Number(payload.total) || 0;
    const received = Number(payload.received) || 0;
    const percent = total > 0 ? (received / total) * 100 : Number(payload.percent) || 0;
    const size = total > 0 ? `${(received / 1048576).toFixed(1)} / ${(total / 1048576).toFixed(1)} MB` : `${(received / 1048576).toFixed(1)} MB`;
    setProgress(percent, `${percent.toFixed(0)}% · ${size}`);
  });
}

loadVersion();
runCheck();
