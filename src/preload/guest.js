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

/* ------------------ 页面内视频自动交给内置 MPV（当前页面播放） ------------------ */
// 标签栏的嗅探按钮已取消：页面里 <video> 真正开播时通知宿主，由内置 mpv 在同一页面播放。
// 只处理主框架——子框架的 rect 相对 iframe，换算不到宿主窗口。
if (isTopFrame) {
  let lastAutoUrl = '';
  let stallTimer = null;

  /* 播放设置由主进程同步：alwaysUseMpv 决定「一开播就接管」还是「出问题才接管」 */
  let mpvSettings = { alwaysUseMpv: false, mpvEnabled: true, sniffFallback: true, titlebarMode: 'off' };
  try {
    const initial = ipcRenderer.sendSync('guest:config-sync');
    if (initial && typeof initial === 'object') mpvSettings = Object.assign(mpvSettings, initial);
  } catch (err) { /* 主进程未就绪时按默认档处理 */ }
  ipcRenderer.on('guest:mpv-config', (event, cfg) => {
    if (cfg && typeof cfg === 'object') mpvSettings = Object.assign(mpvSettings, cfg);
  });

  const measure = (el) => {
    let rect = null;
    try { rect = el.getBoundingClientRect ? el.getBoundingClientRect() : null; } catch (err) { rect = null; }
    return rect;
  };

  /* 返回可交给 mpv 的地址；blob:/MediaSource 只在页面上下文有效，mpv 取不到 */
  const playable = (el) => {
    if (!el || el.tagName !== 'VIDEO') return '';
    const url = el.currentSrc || el.src || '';
    if (!/^https?:\/\//i.test(url)) return '';
    const rect = measure(el);
    /* 过小的多为预览/广告位，接管反而干扰 */
    if (rect && (rect.width < 200 || rect.height < 120)) return '';
    return url;
  };

  const handoff = (el, url, reason, override) => {
    if (!url || url === lastAutoUrl) return;
    lastAutoUrl = url;
    /* override: 取流兜底扫描命中时，没有 <video> 元素可量，用点击目标的位置代替 */
    const rect = override === undefined ? measure(el) : override;
    try {
      ipcRenderer.send('guest:video-play', {
        url,
        reason: reason || 'auto',
        title: document.title || '',
        rect: rect ? { x: Math.round(rect.left), y: Math.round(rect.top), width: Math.round(rect.width), height: Math.round(rect.height) } : null
      });
    } catch (err) { /* 忽略 */ }
  };

  document.addEventListener('playing', (event) => {
    const el = event.target;
    const url = playable(el);
    if (!url) return;
    /* 设置里关掉内置播放器时完全不接管，避免接管后没有画面 */
    if (mpvSettings.mpvEnabled === false) return;
    if (mpvSettings.alwaysUseMpv) { handoff(el, url, 'always'); return; }
    /* 默认档不打扰：先让页面自己播，只有播放报错或画面长时间不动才交给 mpv */
    if (stallTimer) clearTimeout(stallTimer);
    const baseline = el.currentTime;
    stallTimer = setTimeout(() => {
      stallTimer = null;
      try {
        if (!el.isConnected || el.paused) return;
        const stuck = Math.abs(el.currentTime - baseline) < 0.05;
        if (el.error || el.readyState < 2 || stuck) handoff(el, url, 'stalled');
      } catch (err) { /* ignore */ }
    }, 9000);
  }, true);

  /* 页面自己的播放器直接报错时立刻接管，不必等满 9 秒 */
  document.addEventListener('error', (event) => {
    const el = event.target;
    const url = playable(el);
    if (!url) return;
    if (mpvSettings.mpvEnabled === false || mpvSettings.alwaysUseMpv) return;
    handoff(el, url, 'error');
  }, true);

  /* 内置播放器接管后暂停页面自身播放，避免两份声音；关闭内嵌时恢复 */
  ipcRenderer.on('guest:video-hold', () => {
    document.querySelectorAll('video').forEach((el) => {
      try {
        if (!el.paused) { el.dataset.fnosAutoPaused = '1'; el.pause(); }
      } catch (err) { /* 忽略 */ }
    });
  });

  /* ---------------- P1-3 点击后页面不给流：资源时序兜底扫描 ---------------- */
  const SNIFF_HIT = /\.(m3u8|flv)(\?|#|$)/i;
  const SNIFF_SKIP = /(\/music\/|\/videos\/|\/audio\/|\/photos\/|\/items\/|\.(mp3|flac|wav|m4a|ogg|aac|jpg|jpeg|png|webp|gif|svg|txt|json)(\?|#|$))/i;
  let sniffTimer = null;
  let lastSniffUrl = '';
  let lastClickRect = null;

  const sniffStreams = () => {
    if (mpvSettings.sniffFallback === false || mpvSettings.mpvEnabled === false) return;
    let entries = [];
    try { entries = performance.getEntriesByType('resource') || []; } catch (err) { return; }
    const hits = entries.filter((entry) => SNIFF_HIT.test(entry.name || '') && !SNIFF_SKIP.test(entry.name || ''));
    if (!hits.length) return;
    hits.sort((a, b) => (b.startTime || 0) - (a.startTime || 0));
    const url = hits[0].name || '';
    if (!/^https?:\/\//i.test(url) || url === lastSniffUrl) return;
    lastSniffUrl = url;
    handoff(null, url, 'sniff', lastClickRect);
  };

  document.addEventListener('click', (event) => {
    if (mpvSettings.sniffFallback === false || mpvSettings.mpvEnabled === false) return;
    let node = event.target;
    try {
      if (node && node.closest) node = node.closest('a,button,li,article,div') || node;
      const box = node && node.getBoundingClientRect ? node.getBoundingClientRect() : null;
      lastClickRect = box && box.width > 60 && box.height > 40
        ? { x: Math.round(box.left), y: Math.round(box.top), width: Math.round(box.width), height: Math.round(box.height) }
        : null;
    } catch (err) { lastClickRect = null; }
    const baseline = lastAutoUrl;
    if (sniffTimer) clearTimeout(sniffTimer);
    sniffTimer = setTimeout(() => {
      sniffTimer = null;
      /* 页面自己已经把流交给宿主时不再兜底，避免重复接管 */
      if (lastAutoUrl !== baseline) return;
      sniffStreams();
    }, 2600);
  }, true);

  /* ---------------- P1-4 网页内标题栏接管（默认关闭） ---------------- */
  try {
    require('./titlebar').install(mpvSettings);
    ipcRenderer.on('app:titlebar-changed', (event, mode) => {
      try { require('./titlebar').apply(mode); } catch (err) { /* ignore */ }
    });
  } catch (err) { /* 标题栏接管失败不影响播放 */ }

  ipcRenderer.on('guest:video-resume', () => {
    document.querySelectorAll('video').forEach((el) => {
      try {
        if (el.dataset && el.dataset.fnosAutoPaused === '1') {
          delete el.dataset.fnosAutoPaused;
          const done = el.play();
          if (done && typeof done.catch === 'function') done.catch(() => {});
        }
      } catch (err) { /* 忽略 */ }
    });
  });
}
