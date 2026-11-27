'use strict';

/*
 * P1-4 网页内标题栏接管
 * - off：不介入；solid / frosted / clear：隐藏网页自带顶部栏，注入一条与外壳同色的占位条；
 * - 只作用于主框架，且只在页面本身存在顶部导航时生效，避免误伤内容页；
 * - 拖动仍由外壳窗口负责（webview 内部元素无法参与系统拖拽），这里只做视觉接管。
 */
const STYLE_ID = 'fnos-titlebar-style';
const BAR_ID = 'fnos-titlebar';

const BAR_CSS = {
  solid: 'background:rgba(255,255,255,.96);border-bottom:1px solid rgba(0,0,0,.08);',
  frosted: 'background:rgba(255,255,255,.62);backdrop-filter:blur(18px) saturate(140%);border-bottom:1px solid rgba(0,0,0,.06);',
  clear: 'background:transparent;'
};

let current = 'off';
let height = 36;
let observer = null;

function remove() {
  const style = document.getElementById(STYLE_ID);
  if (style) style.remove();
  const bar = document.getElementById(BAR_ID);
  if (bar) bar.remove();
  if (observer) {
    try { observer.disconnect(); } catch (err) { /* ignore */ }
    observer = null;
  }
  try { document.documentElement.style.removeProperty('--fnos-titlebar-height'); } catch (err) { /* ignore */ }
}

function apply(mode) {
  const next = ['off', 'solid', 'frosted', 'clear'].indexOf(String(mode || '')) >= 0 ? String(mode || 'off') : 'off';
  current = next;
  if (!document.body) {
    window.addEventListener('DOMContentLoaded', () => apply(current), { once: true });
    return current;
  }
  remove();
  if (next === 'off') return current;

  document.documentElement.style.setProperty('--fnos-titlebar-height', height + 'px');

  /* 隐藏网页自带顶部栏：只认显式声明为顶部导航的容器 */
  const css = [
    'html{scroll-padding-top:' + height + 'px;}',
    'body > header, body > .header, body > .topbar, body > #header, body > .app-header,',
    'body > .navbar-fixed-top, #app > header, #root > header {display:none !important;}',
    'body{padding-top:' + height + 'px;}',
    '#' + BAR_ID + '{position:fixed;top:0;left:0;right:0;height:' + height + 'px;z-index:2147483000;'
      + 'pointer-events:none;-webkit-app-region:drag;' + BAR_CSS[next] + '}'
  ].join('\n');
  const style = document.createElement('style');
  style.id = STYLE_ID;
  style.textContent = css;
  document.head.appendChild(style);

  const bar = document.createElement('div');
  bar.id = BAR_ID;
  document.body.appendChild(bar);
  return current;
}

function install(settings) {
  try {
    if (window.top !== window) return 'off';
  } catch (err) {
    return 'off';
  }
  const cfg = settings || {};
  height = Math.max(24, Math.min(72, Number(cfg.titlebarHeight) || 36));
  const mode = cfg.titlebarMode || 'off';
  if (document.readyState === 'loading') {
    window.addEventListener('DOMContentLoaded', () => apply(mode), { once: true });
  } else {
    apply(mode);
  }
  return mode;
}

module.exports = { install, apply, BAR_ID };
