'use strict';

const { ipcRenderer } = require('electron');

const isTopFrame = (() => {
  try {
    return window.top === window;
  } catch (err) {
    return false;
  }
})();

if (isTopFrame) {
  let lastReported = '';
  let reportTimer = null;

  const report = () => {
    reportTimer = null;
    const href = window.location.href;
    if (!href || href === 'about:blank') return;
    if (href === lastReported) return;
    lastReported = href;
    ipcRenderer.send('guest:route', { href });
  };

  const scheduleReport = () => {
    if (reportTimer) return;
    reportTimer = setTimeout(report, 60);
  };

  // 监听单页路由切换，交由主进程判断是否需要在新标签中打开
  try {
    const wrap = (name) => {
      const original = window.history[name];
      if (typeof original !== 'function') return;
      window.history[name] = function patched(...args) {
        const result = original.apply(this, args);
        scheduleReport();
        return result;
      };
    };
    wrap('pushState');
    wrap('replaceState');
  } catch (err) {
    console.error('[guest] 路由劫持失败:', err && err.message);
  }

  window.addEventListener('popstate', scheduleReport, true);
  window.addEventListener('hashchange', scheduleReport, true);
  window.addEventListener('DOMContentLoaded', scheduleReport, true);

  setInterval(() => {
    if (document.visibilityState === 'hidden') return;
    if (window.location.href !== lastReported) scheduleReport();
  }, 1000);

  window.addEventListener('keydown', (event) => {
    const modifier = event.ctrlKey || event.metaKey;
    if (!modifier || event.altKey) return;
    const key = String(event.key || '').toLowerCase();
    let action = '';
    if (key === 't') action = 'new-tab';
    else if (key === 'w') action = 'close-tab';
    else if (key === 'r') action = event.shiftKey ? 'reload-hard' : 'reload';
    else if (key === 'tab') action = event.shiftKey ? 'prev-tab' : 'next-tab';
    else if (key === '=' || key === '+') action = 'zoom-in';
    else if (key === '-') action = 'zoom-out';
    else if (key === '0') action = 'zoom-reset';
    else if (key === 'p') action = 'print';
    else if (/^[1-9]$/.test(key)) action = `switch-${key}`;
    if (!action) return;
    event.preventDefault();
    ipcRenderer.send('guest:shortcut', action);
  }, true);

  document.addEventListener('enter-html-full-screen', () => {
    ipcRenderer.send('guest:fullscreen', { active: true });
  });
  document.addEventListener('leave-html-full-screen', () => {
    ipcRenderer.send('guest:fullscreen', { active: false });
  });
}
