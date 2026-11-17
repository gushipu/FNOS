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

  /* ---------------- 已保存的 NAS 账号密码：登录页自动填充 ---------------- */
  const autoFill = (() => {
    let creds = null;
    let filled = false;
    let userField = null;

    const setValue = (el, value) => {
      try {
        const desc = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(el), 'value');
        if (desc && typeof desc.set === 'function') desc.set.call(el, value);
        else el.value = value;
      } catch (err) {
        try { el.value = value; } catch (err2) { return; }
      }
      el.dispatchEvent(new Event('input', { bubbles: true }));
      el.dispatchEvent(new Event('change', { bubbles: true }));
    };

    const attempt = () => {
      if (filled || !creds) return;
      const pwd = document.querySelector('input[type="password"]');
      if (!pwd) return;
      const scope = pwd.form || document;
      const user = scope.querySelector('input[type="text"], input[type="email"], input[type="tel"], input:not([type])');
      if (user && !user.value && creds.username) {
        setValue(user, creds.username);
        userField = user;
      }
      if (!pwd.value && creds.password) setValue(pwd, creds.password);
      filled = true;
    };

    const start = async () => {
      try {
        const result = await ipcRenderer.invoke('vault:active');
        const value = (result && result.value) || {};
        if (!value.username && !value.password) return;
        creds = value;
      } catch (err) {
        return;
      }
      attempt();
      const timer = setInterval(() => {
        if (filled) {
          clearInterval(timer);
          return;
        }
        attempt();
      }, 600);
      setTimeout(() => clearInterval(timer), 20000);
      try {
        const observer = new MutationObserver(() => {
          if (filled) {
            observer.disconnect();
            return;
          }
          attempt();
        });
        observer.observe(document.documentElement, { childList: true, subtree: true });
        setTimeout(() => observer.disconnect(), 20000);
      } catch (err) { /* 忽略 */ }
    };

    if (document.readyState === 'loading') {
      window.addEventListener('DOMContentLoaded', start, { once: true });
    } else {
      start();
    }

    // 单页应用里登出/换页后允许再次填充
    window.addEventListener('popstate', () => {
      filled = false;
      userField = null;
      attempt();
    }, true);

    return { attempt };
  })();
}
