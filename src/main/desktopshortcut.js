'use strict';

/* 桌面快捷方式：创建 / 去重 / 图标纠正
   - 同时覆盖「用户桌面」与「公共桌面」：安装器通常在公共桌面写死一个 FNOS.exe,0 的快捷方式，
     覆盖安装后不会更新，这是图标长期不刷新的主要原因
   - 已存在指向当前 exe 的快捷方式不再重复创建，只就地修正图标与工作目录
   - 图标优先指向随包分发的 resources/icon.ico（随版本更新，路径稳定可被缓存识别），
     回退到 exe 内置资源
   - 图标签名变化时才清一次系统图标缓存，其余启动只做轻量刷新，避免每次启动都闪图标 */

const path = require('path');
const fs = require('fs');
const { app, shell } = require('electron');
const { execFile } = require('child_process');

const LINK_NAME = '飞牛 NAS.lnk';
const DESCRIPTION = '飞牛 NAS 桌面客户端';

function normPath(p) {
  if (!p) return '';
  try { return path.resolve(String(p)).toLowerCase(); } catch (err) { return String(p).toLowerCase(); }
}

function sameFile(a, b) {
  if (!a || !b) return false;
  return normPath(a) === normPath(b);
}

/* 图标来源：优先随包分发的 icon.ico；找不到才回退 exe 内置资源 */
function resolveIcon() {
  const exe = process.execPath;
  const candidates = [];
  if (process.resourcesPath) candidates.push(path.join(process.resourcesPath, 'icon.ico'));
  const exeDir = path.dirname(exe);
  candidates.push(path.join(exeDir, 'icon.ico'));
  candidates.push(path.join(exeDir, 'app.ico'));
  candidates.push(path.join(exeDir, 'resources', 'icon.ico'));
  for (const candidate of candidates) {
    try {
      if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) return candidate;
    } catch (err) { /* 忽略：继续尝试下一个候选 */ }
  }
  return exe;
}

/* 用户桌面可能被重定向（如 D:\桌面），公共桌面也可能不在系统盘 */
function desktopDirs() {
  const dirs = [];
  const push = (dir) => {
    if (!dir) return;
    if (dirs.some((item) => sameFile(item, dir))) return;
    dirs.push(dir);
  };
  try { push(app.getPath('desktop')); } catch (err) { /* 忽略 */ }
  const pub = process.env.PUBLIC;
  if (pub) push(path.join(pub, 'Desktop'));
  push('C:\\Users\\Public\\Desktop');
  return dirs.filter((dir) => {
    try { return fs.statSync(dir).isDirectory(); } catch (err) { return false; }
  });
}

/* 某个桌面目录下所有指向当前 exe 的快捷方式（含用户改名后的） */
function linksTargeting(dir) {
  const exe = process.execPath;
  const found = [];
  let entries = [];
  try { entries = fs.readdirSync(dir); } catch (err) { return found; }
  for (const name of entries) {
    if (!/\.lnk$/i.test(name)) continue;
    const full = path.join(dir, name);
    let info = null;
    try { info = shell.readShortcutLink(full); } catch (err) { continue; }
    if (!info) continue;
    if (sameFile(info.target, exe)) found.push({ path: full, name, info });
  }
  return found;
}

function writeLink(linkPath, mode, iconPath) {
  const exe = process.execPath;
  shell.writeShortcutLink(linkPath, mode, {
    target: exe,
    cwd: path.dirname(exe),
    description: DESCRIPTION,
    icon: iconPath,
    iconIndex: 0,
    appUserModelId: 'com.gushipu.fnos'
  });
}

/* 单个快捷方式：目标/工作目录/图标不一致才重写，内容一致时保持原样（避免每次启动写盘） */
function ensureLink(linkPath, iconPath, existing) {
  const exe = process.execPath;
  const info = existing || (() => {
    try { return fs.existsSync(linkPath) ? shell.readShortcutLink(linkPath) : null; } catch (err) { return null; }
  })();

  if (info) {
    const sameTarget = sameFile(info.target, exe);
    const sameIcon = sameFile(info.icon, iconPath);
    const sameCwd = sameFile(info.cwd, path.dirname(exe));
    if (sameTarget && sameIcon && sameCwd) return 'unchanged';
    writeLink(linkPath, 'update', iconPath);
    return 'updated';
  }

  writeLink(linkPath, 'create', iconPath);
  return 'created';
}

function iconSignature(iconPath) {
  let stamp = 'exe';
  try { stamp = String(Math.round(fs.statSync(iconPath).mtimeMs)); } catch (err) { /* 用 exe 内置图标 */ }
  return `${normPath(iconPath)}|${stamp}`;
}

function markerPath() {
  try { return path.join(app.getPath('userData'), 'desktop-shortcut.json'); } catch (err) { return null; }
}

/* 图标签名变化时才清缓存；否则只做轻量刷新 */
function refreshIconCache(forceClear) {
  if (forceClear) {
    try { execFile('ie4uinit.exe', ['-ClearIconCache'], { windowsHide: true }, () => {}); } catch (err) { /* 忽略 */ }
  }
  try { execFile('ie4uinit.exe', ['-show'], { windowsHide: true }, () => {}); } catch (err) { /* 忽略 */ }
}

function shouldClearCache(signature) {
  const file = markerPath();
  if (!file) return false;
  let previous = '';
  try { previous = String(JSON.parse(fs.readFileSync(file, 'utf8')).signature || ''); } catch (err) { previous = ''; }
  if (previous === signature) return false;
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, JSON.stringify({ signature, at: new Date().toISOString() }, null, 2), 'utf8');
  } catch (err) { /* 忽略：标记写入失败最多多点一次清缓存 */ }
  return true;
}

function ensureDesktopShortcut() {
  const result = { ok: false, iconPath: '', user: '', public: '', duplicates: [], actions: [] };
  if (process.platform !== 'win32') return result;
  if (!app.isPackaged) return result;

  const iconPath = resolveIcon();
  result.iconPath = iconPath;

  const dirs = desktopDirs();
  if (!dirs.length) return result;

  let userDir = '';
  try { userDir = app.getPath('desktop') || ''; } catch (err) { userDir = ''; }
  const isUserDir = (dir) => Boolean(userDir) && sameFile(dir, userDir);

  /* 第一步：把所有桌面目录扫一遍。
     用户桌面可能被重定向（如 F:\桌面），而安装器习惯把快捷方式写在公共桌面，
     两边各建一份就出现两个同名图标 —— 必须先看全量，再决定要不要新建 */
  const existing = [];
  for (const dir of dirs) {
    for (const link of linksTargeting(dir)) existing.push({ path: link.path, name: link.name, info: link.info, dir });
  }

  let changed = false;

  if (existing.length) {
    /* 第二步：只要有一份就不新建，仅就地纠正目标/工作目录/图标 */
    for (const link of existing) {
      try {
        const state = ensureLink(link.path, iconPath, link.info);
        if (state !== 'unchanged') changed = true;
        result.actions.push({ dir: link.dir, file: link.name, state });
      } catch (err) {
        result.actions.push({ dir: link.dir, file: link.name, state: 'error' });
      }
      if (isUserDir(link.dir)) {
        if (!result.user) result.user = link.path;
      } else if (!result.public) {
        result.public = link.path;
      }
    }
    /* 已经存在多份时不再新增；多余的那几份只登记，不擅自删除用户桌面上的东西 */
    if (existing.length > 1) {
      const keep = existing.find((x) => isUserDir(x.dir) && x.name === LINK_NAME)
        || existing.find((x) => isUserDir(x.dir))
        || existing.find((x) => x.name === LINK_NAME)
        || existing[0];
      for (const link of existing) {
        if (link !== keep) result.duplicates.push(link.path);
      }
    }
  } else {
    /* 第二步：一份都没有才创建；用户桌面优先，用户桌面不可用时退到公共桌面 */
    const targetDir = (userDir && dirs.some((dir) => sameFile(dir, userDir))) ? userDir : dirs[0];
    try {
      const linkPath = path.join(targetDir, LINK_NAME);
      const state = ensureLink(linkPath, iconPath, null);
      if (state !== 'unchanged') changed = true;
      result.actions.push({ dir: targetDir, file: LINK_NAME, state });
      if (isUserDir(targetDir)) result.user = linkPath;
      else result.public = linkPath;
    } catch (err) {
      result.actions.push({ dir: targetDir, file: LINK_NAME, state: 'create-failed' });
    }
  }

  if (changed) refreshIconCache(false);
  /* 图标文件本身变化（换版本换了 ico）才清一次缓存，避免每次启动都重建整个图标缓存 */
  if (shouldClearCache(iconSignature(iconPath))) refreshIconCache(true);

  result.ok = true;
  return result;
}

module.exports = { ensureDesktopShortcut };
