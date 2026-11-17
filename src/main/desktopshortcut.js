'use strict';

/* 桌面快捷方式图标修复：
   覆盖安装后 Windows 仍可能显示旧图标（旧 .lnk 指向旧路径，或图标缓存未刷新）。
   启动时校验桌面快捷方式，必要时重写为当前 exe（图标取自 exe 内置资源），
   再刷新一次系统图标缓存，保证 3.0.2 的新图标立即生效。 */

const path = require('path');
const fs = require('fs');
const { app, shell } = require('electron');
const { execFile } = require('child_process');

const LINK_NAME = '飞牛 NAS.lnk';
const DESCRIPTION = '飞牛 NAS 桌面客户端';

function refreshIconCache() {
  try {
    execFile('ie4uinit.exe', ['-show'], { windowsHide: true }, () => {});
  } catch (err) { /* 仅影响图标缓存刷新，失败无副作用 */ }
}

function fixShortcut(dir) {
  const linkPath = path.join(dir, LINK_NAME);
  const exe = process.execPath;
  try {
    if (fs.existsSync(linkPath)) {
      const info = shell.readShortcutLink(linkPath);
      const sameTarget = String(info.target || '').toLowerCase() === exe.toLowerCase();
      const sameIcon = String(info.icon || '').toLowerCase() === exe.toLowerCase();
      if (sameTarget && sameIcon) return false;
      shell.writeShortcutLink(linkPath, 'update', {
        target: exe,
        icon: exe,
        iconIndex: 0,
        description: DESCRIPTION,
        cwd: path.dirname(exe)
      });
      return true;
    }
    shell.writeShortcutLink(linkPath, 'create', {
      target: exe,
      icon: exe,
      iconIndex: 0,
      description: DESCRIPTION,
      cwd: path.dirname(exe)
    });
    return true;
  } catch (err) {
    return false;
  }
}

function ensureDesktopShortcut() {
  if (process.platform !== 'win32') return;
  if (!app.isPackaged) return;
  let changed = false;
  try {
    const dir = app.getPath('desktop');
    if (dir && fixShortcut(dir)) changed = true;
  } catch (err) { /* 忽略：桌面目录不可用时不影响启动 */ }
  if (changed) refreshIconCache();
}

module.exports = { ensureDesktopShortcut };
