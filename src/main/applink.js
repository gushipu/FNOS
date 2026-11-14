'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { app, shell } = require('electron');

const log = require('./logger').create('applink');
const store = require('./store');

const ARG_APP = '--fnos-app=';
const ARG_SERVER = '--fnos-server=';

function parseArgv(argv) {
  const list = Array.isArray(argv) ? argv : [];
  let appUrl = '';
  let serverId = '';
  for (const item of list) {
    if (typeof item !== 'string') continue;
    if (item.startsWith(ARG_APP)) appUrl = item.slice(ARG_APP.length).replace(/^"|"$/g, '');
    else if (item.startsWith(ARG_SERVER)) serverId = item.slice(ARG_SERVER.length).replace(/^"|"$/g, '');
  }
  if (appUrl && !/^https?:\/\//i.test(appUrl)) appUrl = '';
  return { appUrl, serverId };
}

function defaultDir() {
  try {
    return app.getPath('desktop');
  } catch (err) {
    return app.getPath('home');
  }
}

function safeName(name) {
  const value = String(name || 'FNOS 应用').replace(/[\\/:*?"<>|]/g, ' ').trim();
  return (value || 'FNOS 应用').slice(0, 60);
}

function create(input) {
  const active = store.activeServer();
  const serverId = String((input && input.serverId) || (active && active.id) || '');
  const name = safeName(input && input.name);
  const explicitUrl = String((input && input.url) || '').trim();
  const baseUrl = explicitUrl || (active ? String(active.url || '').replace(/\/+$/, '') + '/v' : '');
  const url = /^https?:\/\//i.test(baseUrl) ? baseUrl : '';
  const target = process.execPath;
  const args = url
    ? `${ARG_APP}"${url}" ${ARG_SERVER}"${serverId}"`
    : '';
  const dir = String((input && input.dir) || defaultDir());
  try {
    fs.mkdirSync(dir, { recursive: true });
  } catch (err) { /* ignore */ }

  if (process.platform === 'win32') {
    const file = path.join(dir, name + '.lnk');
    const icon = (input && input.icon) || process.execPath;
    const done = shell.writeShortcutLink(file, 'create', {
      target,
      args,
      cwd: path.dirname(target),
      icon: icon + ',0',
      iconIndex: 0,
      description: name + ' - FNOS 应用快捷方式',
      appUserModelId: 'com.gushipu.fnos'
    });
    if (!done) return { ok: false, error: '创建快捷方式失败，请检查桌面写入权限' };
    log.info('已创建应用快捷方式', file);
    return { ok: true, file };
  }

  if (process.platform === 'darwin') {
    const file = path.join(dir, name + '.command');
    try {
      fs.writeFileSync(file, `#!/bin/bash\nopen -a "${target}" --args ${args}\n`, { mode: 0o755 });
      return { ok: true, file };
    } catch (err) {
      return { ok: false, error: (err && err.message) || '创建快捷方式失败' };
    }
  }

  const file = path.join(dir, name + '.desktop');
  try {
    fs.writeFileSync(file, [
      '[Desktop Entry]',
      'Type=Application',
      'Name=' + name,
      'Exec="' + target + '" ' + args,
      'Terminal=false',
      'Categories=Network;'
    ].join('\n'), { mode: 0o755 });
    return { ok: true, file };
  } catch (err) {
    return { ok: false, error: (err && err.message) || '创建快捷方式失败' };
  }
}

async function pickDir(win) {
  const { dialog } = require('electron');
  const result = await dialog.showOpenDialog(win || null, {
    title: '选择快捷方式保存位置',
    properties: ['openDirectory', 'createDirectory']
  });
  if (result.canceled || !result.filePaths.length) return { ok: false, canceled: true };
  return { ok: true, dir: result.filePaths[0] };
}

function info() {
  const active = store.activeServer();
  return {
    enabled: store.getSettings().appShortcuts !== false,
    dir: defaultDir(),
    exePath: process.execPath,
    serverId: active ? active.id : '',
    serverUrl: active ? String(active.url || '') : '',
    platform: process.platform,
    supported: process.platform === 'win32' || process.platform === 'darwin' || process.platform === 'linux'
  };
}

module.exports = { parseArgv, create, pickDir, info, ARG_APP, ARG_SERVER };
