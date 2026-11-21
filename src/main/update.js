'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { app, net, shell } = require('electron');
const { spawn } = require('node:child_process');

const log = require('./logger').create('update');
const store = require('./store');

const REPO = 'gushipu/FNOS';
const API = `https://api.github.com/repos/${REPO}/releases/latest`;
let downloading = false;
// 安装流程一旦启动就不再重复触发：下载完成会自动调用一次，用户点“再次执行安装”不应再起第二个安装器
let applying = false;

function parseVersion(text) {
  return String(text || '')
    .replace(/^v/i, '')
    .split(/[.+-]/)
    .map((part) => parseInt(part, 10))
    .map((num) => (Number.isFinite(num) ? num : 0));
}

function compareVersion(a, b) {
  const left = parseVersion(a);
  const right = parseVersion(b);
  const len = Math.max(left.length, right.length);
  for (let i = 0; i < len; i += 1) {
    const l = left[i] || 0;
    const r = right[i] || 0;
    if (l > r) return 1;
    if (l < r) return -1;
  }
  return 0;
}

function request(url) {
  return new Promise((resolve, reject) => {
    let req;
    try {
      req = net.request({ method: 'GET', url, redirect: 'follow' });
    } catch (err) {
      reject(err);
      return;
    }
    req.setHeader('User-Agent', 'fnos-client/' + app.getVersion());
    req.setHeader('Accept', 'application/vnd.github+json');
    const timer = setTimeout(() => {
      try { req.abort(); } catch (err) { /* ignore */ }
      reject(new Error('请求超时'));
    }, 15000);
    req.on('response', (response) => {
      let body = '';
      response.on('data', (chunk) => { body += chunk.toString('utf8'); });
      response.on('end', () => {
        clearTimeout(timer);
        if (response.statusCode !== 200) {
          reject(new Error('GitHub 返回 ' + response.statusCode));
          return;
        }
        resolve(body);
      });
    });
    req.on('error', (err) => {
      clearTimeout(timer);
      reject(err);
    });
    req.end();
  });
}

function pickAsset(assets) {
  const list = Array.isArray(assets) ? assets : [];
  const arch = process.arch;
  if (process.platform === 'win32') {
    return list.find((item) => /\.exe$/i.test(item.name) && /setup|installer/i.test(item.name))
      || list.find((item) => /\.exe$/i.test(item.name)) || null;
  }
  if (process.platform === 'darwin') {
    const dmg = list.find((item) => /\.dmg$/i.test(item.name) && new RegExp(arch === 'arm64' ? 'arm64' : 'x64|intel', 'i').test(item.name));
    return dmg || list.find((item) => /\.dmg$/i.test(item.name)) || null;
  }
  return list.find((item) => /\.AppImage$/i.test(item.name)) || null;
}

async function check(options) {
  const opts = options || {};
  try {
    const body = await request(API);
    const data = JSON.parse(body);
    const latest = String(data.tag_name || data.name || '').replace(/^v/i, '');
    const current = app.getVersion();
    const asset = pickAsset(data.assets);
    const payload = {
      ok: true,
      latest,
      current,
      hasUpdate: latest ? compareVersion(latest, current) > 0 : false,
      url: data.html_url || ('https://github.com/' + REPO + '/releases'),
      notes: typeof data.body === 'string' ? data.body.slice(0, 4000) : '',
      asset: asset ? { name: asset.name, url: asset.browser_download_url, size: asset.size } : null,
      checkedAt: Date.now()
    };
    store.patchSettings({ lastUpdateCheck: payload.checkedAt });
    log.info('检查更新完成', { current, latest, hasUpdate: payload.hasUpdate });
    // 发现更新后由渲染层统一弹出「软件更新」窗口（样式与设置界面一致），此处只返回结果
    broadcast('update:available', payload);
    return payload;
  } catch (err) {
    log.error('检查更新失败', err && err.message);
    return { ok: false, error: '检查更新失败：' + ((err && err.message) || '未知错误') };
  }
}

function openReleasePage(url) {
  const target = url || ('https://github.com/' + REPO + '/releases');
  return shell.openExternal(target);
}

function installTargetDir() {
  try {
    const exe = app.getPath('exe');
    return exe ? path.dirname(exe) : '';
  } catch (err) {
    return '';
  }
}

function dirWritable(dir) {
  if (!dir) return false;
  const probe = path.join(dir, '.fnos-write-test.tmp');
  try {
    fs.writeFileSync(probe, 'ok');
    fs.unlinkSync(probe);
    return true;
  } catch (err) {
    return false;
  }
}

function psString(value) {
  return `'${String(value == null ? '' : value).replace(/'/g, "''")}'`;
}

function powershellPath() {
  /* 用绝对路径：PATH 里可能没有 powershell，也可能被别的东西抢占 */
  const root = process.env.SystemRoot || process.env.windir || 'C:\\Windows';
  const full = path.join(root, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
  return fs.existsSync(full) ? full : 'powershell.exe';
}

/* 安装包必须跑出「看得见的安装过程」：不传 /S（静默），也不传 /D=（指定目录），
   安装路径、进度、完成提示全部交给安装程序自己的界面，用户能看清装到哪、装没装上。
   安装目录在 Program Files 这类需要提权的位置时用 runas 拉起，UAC 和安装界面同样可见。 */
function launchInstaller(target, dir) {
  const elevate = !dirWritable(dir);
  log.info('启动安装程序界面', { target, dir, elevate });
  if (!elevate) {
    let child;
    try {
      child = spawn(target, [], { detached: true, stdio: 'ignore' });
    } catch (err) {
      log.error('安装程序启动失败', (err && err.message) || String(err));
      return { ok: false, elevate, error: (err && err.message) || '启动安装程序失败' };
    }
    child.on('error', (err) => {
      log.error('安装程序进程异常', (err && err.message) || String(err));
    });
    child.unref();
    return { ok: true, elevate };
  }
  /* 提权分支只给 -FilePath，不拼任何命令行参数：路径里的空格、中文、引号都不会被拆坏 */
  const script = `Start-Process -FilePath ${psString(target)} -Verb RunAs`;
  const args = ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', script];
  let child;
  try {
    child = spawn(powershellPath(), args, { detached: true, stdio: 'ignore' });
  } catch (err) {
    log.error('安装程序提权启动失败', (err && err.message) || String(err));
    return { ok: false, elevate, error: (err && err.message) || '启动安装程序失败' };
  }
  child.on('error', (err) => {
    log.error('安装程序提权进程异常', (err && err.message) || String(err));
  });
  child.unref();
  return { ok: true, elevate };
}

function cleanupMarkerPath() {
  try { return path.join(app.getPath('userData'), 'installer-cleanup.json'); } catch (err) { return ''; }
}

// 本应用自己的更新包目录：userData/updates 与 %LOCALAPPDATA%/FNOS/updates
function ownedPackageRoots() {
  const roots = [];
  try { roots.push(path.join(app.getPath('userData'), 'updates')); } catch (err) { /* 忽略 */ }
  try { roots.push(path.join(process.env.LOCALAPPDATA || app.getPath('temp'), 'FNOS', 'updates')); } catch (err) { /* 忽略 */ }
  return roots;
}

// 只删本应用下载的更新包：避免把用户手动选择的任意安装包（或别的文件）写进待删清单
function isOwnedPackage(file) {
  const target = String(file || '').trim();
  if (!target) return false;
  let resolved = '';
  try { resolved = path.resolve(target); } catch (err) { return false; }
  const low = resolved.toLowerCase();
  for (const root of ownedPackageRoots()) {
    const base = path.resolve(root).toLowerCase();
    if (low === base || low.indexOf(base + path.sep) === 0) return true;
  }
  try {
    const downloads = path.resolve(app.getPath('downloads')).toLowerCase();
    if (low.indexOf(downloads + path.sep) === 0 && /^fnos[-_a-z0-9.() ]*\.(exe|dmg|zip|pkg)$/i.test(path.basename(resolved))) return true;
  } catch (err) { /* 忽略 */ }
  return false;
}

function markInstallerForCleanup(file) {
  const marker = cleanupMarkerPath();
  const target = String(file || '').trim();
  if (!marker || !target) return;
  if (!isOwnedPackage(target)) return;
  try {
    const previous = fs.existsSync(marker) ? (JSON.parse(fs.readFileSync(marker, 'utf8')).files || []) : [];
    const files = previous.concat([target]).filter((item, index, list) => item && list.indexOf(item) === index);
    fs.mkdirSync(path.dirname(marker), { recursive: true });
    fs.writeFileSync(marker, JSON.stringify({ files, at: new Date().toISOString() }, null, 2), 'utf8');
  } catch (err) { /* 忽略 */ }
}

/* 删掉上一次安装用过的安装包，并顺手清掉 updates 目录里的历史安装包 */
function cleanupInstallerPackages() {
  const targets = [];
  const marker = cleanupMarkerPath();
  if (marker && fs.existsSync(marker)) {
    try {
      const parsed = JSON.parse(fs.readFileSync(marker, 'utf8'));
      (parsed.files || []).forEach((item) => { if (item) targets.push(item); });
    } catch (err) { /* 忽略 */ }
  }
  try {
    const folder = path.join(app.getPath('userData'), 'updates');
    if (fs.existsSync(folder)) {
      for (const name of fs.readdirSync(folder)) {
        if (/\.(exe|dmg|zip|pkg)$/i.test(name)) targets.push(path.join(folder, name));
      }
    }
  } catch (err) { /* 忽略 */ }
  const removed = [];
  const failed = [];
  for (const item of targets) {
    try {
      if (!isOwnedPackage(item)) continue;
      if (!fs.existsSync(item)) continue;
      fs.unlinkSync(item);
      removed.push(item);
    } catch (err) {
      failed.push(item);
    }
  }
  if (marker) {
    try {
      if (failed.length) fs.writeFileSync(marker, JSON.stringify({ files: failed, at: new Date().toISOString() }, null, 2), 'utf8');
      else if (fs.existsSync(marker)) fs.unlinkSync(marker);
    } catch (err) { /* 忽略 */ }
  }
  if (removed.length) log.info('已清理旧安装包', removed);
  return { removed, failed };
}

function openInstaller(file) {
  const target = String(file || '').trim();
  if (!target) return { ok: false, error: '路径为空' };
  if (applying) return { ok: true, restarting: true, duplicate: true };
  markInstallerForCleanup(target);
  if (!fs.existsSync(target)) return { ok: false, error: '安装包不存在，请重新下载' };
  try {
    // 残缺的安装包同样会“启动后毫无反应”，先挡住明显不完整的文件
    const size = fs.statSync(target).size;
    if (size < 512 * 1024) return { ok: false, error: `安装包不完整（${size} 字节），请重新下载` };
  } catch (err) { /* 忽略 */ }
  /* 便携版跑在临时解压目录里，没有固定安装位置，交给用户手动安装 */
  const portable = Boolean(process.env.PORTABLE_EXECUTABLE_DIR);
  const interactive = process.platform === 'win32' && /\.exe$/i.test(target) && app.isPackaged && !portable;
  if (!interactive) {
    try {
      shell.openPath(target);
      return { ok: true, manual: true };
    } catch (err) {
      return { ok: false, error: (err && err.message) || '打开安装包失败' };
    }
  }
  const dir = installTargetDir();
  if (!dir) return { ok: false, error: '无法定位当前安装目录' };
  applying = true;
  try {
    /* 拉起带界面的安装程序：进度、安装路径、完成提示都由安装程序自己展示，不再后台静默覆盖 */
    broadcast('update:progress', { received: 0, total: 0, percent: 100, done: true, applying: true, interactive: true, dir });
    log.info('已启动安装向导', { target, dir, elevate: !dirWritable(dir) });
    const started = launchInstaller(target, dir);
    if (!started.ok) {
      /* 安装器拉不起来就别急着自己退出：退回系统默认安装流程，让用户手动装完 */
      applying = false;
      try { shell.openPath(target); } catch (err) { /* ignore */ }
      return { ok: false, error: started.error || '启动安装程序失败，已打开安装包' };
    }
    if (started.elevate) {
      /* 要等用户在 UAC 里点确认，安装器还没真正起来，此时不能先退出应用；
         一段时间后放开 applying，万一用户取消了 UAC 还能重试 */
      setTimeout(() => { applying = false; }, 15000);
      return { ok: true, restarting: false, interactive: true, dir };
    }
    /* 目录可写时安装器会立刻替换安装文件，应用继续运行会占用文件，主动退出让安装顺利完成 */
    try { require('./windows').markQuitting(); } catch (err) { /* ignore */ }
    setTimeout(() => { app.exit(0); }, 1500);
    return { ok: true, restarting: true, interactive: true, dir };
  } catch (err) {
    applying = false;
    return { ok: false, error: (err && err.message) || '启动安装程序失败' };
  }
}

function openFolder(file) {
  const target = String(file || '').trim();
  if (!target) return { ok: false, error: '路径为空' };
  try {
    if (fs.existsSync(target)) {
      if (fs.statSync(target).isDirectory()) shell.openPath(target);
      else shell.showItemInFolder(target);
    } else {
      const dir = path.dirname(target);
      if (dir && fs.existsSync(dir)) shell.openPath(dir);
      else return { ok: false, error: '目录不存在' };
    }
    return { ok: true };
  } catch (err) {
    return { ok: false, error: (err && err.message) || '打开失败' };
  }
}

function broadcast(channel, payload) {
  try {
    for (const win of require('./windows').allWindows()) {
      if (!win.isDestroyed()) win.webContents.send(channel, payload);
    }
  } catch (err) { /* ignore */ }
}

async function downloadAsset(assetUrl, filename) {
  if (downloading) return { ok: false, error: '已有安装包正在下载' };
  const target = String(assetUrl || '');
  if (!/^https:\/\//i.test(target)) return { ok: false, error: '下载地址无效' };
  downloading = true;
  const dir = (() => {
    const custom = store.getSettings().downloadDir;
    const appDir = installTargetDir();
    if (custom) {
      try {
        fs.mkdirSync(custom, { recursive: true });
        const insideApp = appDir
          && path.resolve(custom).toLowerCase().startsWith(path.resolve(appDir).toLowerCase() + path.sep);
        if (!insideApp) return custom;
      } catch (err) { /* 回退用户数据目录 */ }
    }
    /* 安装包必须落在安装目录之外：旧版卸载会清空安装目录，
       放在安装目录内会被一并删除，导致“旧版已卸载、新版装不上”；
       优先用户数据目录（卸载不清理），再回退本地应用数据，最后回退系统下载目录 */
    const candidates = [];
    try { candidates.push(path.join(app.getPath('userData'), 'updates')); } catch (err) { /* ignore */ }
    try { candidates.push(path.join(process.env.LOCALAPPDATA || app.getPath('temp'), 'FNOS', 'updates')); } catch (err) { /* ignore */ }
    for (const candidate of candidates) {
      try {
        fs.mkdirSync(candidate, { recursive: true });
        const probe = path.join(candidate, '.fnos-write-test');
        fs.writeFileSync(probe, '');
        fs.unlinkSync(probe);
        return candidate;
      } catch (err) { /* 尝试下一个候选目录 */ }
    }
    return app.getPath('downloads');
  })();
  const file = path.join(dir, String(filename || 'fnos-update.exe').replace(/[\\/:*?"<>|]/g, '_'));
  return new Promise((resolve) => {
    let settled = false;
    const finish = (payload) => {
      if (settled) return;
      settled = true;
      downloading = false;
      resolve(payload);
    };
    let req;
    try {
      req = net.request({ method: 'GET', url: target, redirect: 'follow' });
    } catch (err) {
      finish({ ok: false, error: (err && err.message) || '下载失败' });
      return;
    }
    req.setHeader('User-Agent', 'fnos-client/' + app.getVersion());
    const timer = setTimeout(() => {
      try { req.abort(); } catch (err) { /* ignore */ }
      finish({ ok: false, error: '下载超时' });
    }, 10 * 60 * 1000);
    req.on('response', (response) => {
      if (response.statusCode !== 200) {
        clearTimeout(timer);
        finish({ ok: false, error: '下载失败，HTTP ' + response.statusCode });
        return;
      }
      const total = Number(response.headers['content-length'] || 0) || 0;
      let received = 0;
      const stream = fs.createWriteStream(file);
      response.on('data', (chunk) => {
        received += chunk.length;
        stream.write(chunk);
        broadcast('update:progress', {
          received, total,
          percent: total ? Math.round(received / total * 1000) / 10 : 0
        });
      });
      response.on('end', () => {
        clearTimeout(timer);
        stream.end(() => {
          /* 长度对不上说明连接被中途掐断，这种残包运行起来只会静默失败，直接判下载失败 */
          if (total && received !== total) {
            try { fs.unlinkSync(file); } catch (err) { /* ignore */ }
            finish({ ok: false, error: `安装包下载不完整（${received}/${total} 字节），请重试` });
            return;
          }
          log.info('安装包下载完成', file);
          broadcast('update:progress', { received, total, percent: 100, done: true, file });
          finish({ ok: true, file });
          // 下载完成后打开安装程序自身的界面；拉不起来时必须把原因回传界面，不能静默吞掉
          setTimeout(() => {
            const result = openInstaller(file);
            if (result && result.ok) return;
            broadcast('update:progress', {
              received, total, percent: 100, done: true, file, failed: true,
              error: (result && result.error) || '启动安装程序失败，请手动运行安装包',
            });
          }, 1200);
        });
      });
      response.on('error', (err) => {
        clearTimeout(timer);
        try { stream.end(); } catch (e) { /* ignore */ }
        finish({ ok: false, error: (err && err.message) || '下载中断' });
      });
    });
    req.on('error', (err) => {
      clearTimeout(timer);
      finish({ ok: false, error: (err && err.message) || '网络异常' });
    });
    req.end();
  });
}

function scheduleAutoCheck(delay) {
  if (store.getSettings().autoCheckUpdate === false) return;
  setTimeout(() => {
    const last = Number(store.getSettings().lastUpdateCheck) || 0;
    if (Date.now() - last < 6 * 60 * 60 * 1000) return;
    check({ silent: true }).then((payload) => {
      if (payload && payload.ok && payload.hasUpdate) {
        const windows = require('./windows');
        windows.createUpdate(windows.getMain());
      }
    }).catch(() => {});
  }, Number(delay) || 8000);
}

module.exports = { check, openReleasePage, openFolder, openInstaller, compareVersion, downloadAsset, scheduleAutoCheck, pickAsset, cleanupInstallerPackages };
