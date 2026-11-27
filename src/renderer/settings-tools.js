'use strict';

/* P1-4 / P1-1 / P1-3 与工具入口：独立于 settings.js 绑定，避免与既有表单渲染互相覆盖 */
(function () {
  const $ = (id) => document.getElementById(id);
  const api = window.fnos || {};
  const titlebar = $('titlebarMode');
  const line = $('liveLine');
  const sniff = $('sniffFallback');
  const logs = $('open-logs');
  const apps = $('open-apps');

  const patch = async (payload) => {
    try {
      await api.settings.patch(payload);
    } catch (err) { /* 忽略 */ }
  };

  (async () => {
    let settings = {};
    try {
      settings = (await api.settings.get()) || {};
    } catch (err) {
      settings = {};
    }
    if (titlebar) titlebar.value = ['off', 'solid', 'frosted', 'clear'].indexOf(settings.titlebarMode) >= 0 ? settings.titlebarMode : 'off';
    if (line) line.value = ['inner', 'ipv6', 'frp'].indexOf(settings.liveLine) >= 0 ? settings.liveLine : '';
    if (sniff) sniff.checked = settings.sniffFallback !== false;
  })();

  if (titlebar) {
    titlebar.addEventListener('change', async () => {
      await patch({ titlebarMode: titlebar.value });
      try {
        await api.titlebar.apply(titlebar.value);
      } catch (err) { /* 忽略 */ }
    });
  }

  if (line) {
    line.addEventListener('change', () => patch({ liveLine: line.value || '' }));
  }

  if (sniff) {
    sniff.addEventListener('change', () => patch({ sniffFallback: sniff.checked }));
  }

  if (logs) {
    logs.addEventListener('click', () => api.logs && api.logs.open());
  }

  if (apps) {
    apps.addEventListener('click', () => api.apps && api.apps.open());
  }
})();
