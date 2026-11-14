'use strict';

/* 设置页扩展面板：播放与直播 / 安全与锁屏 / 快捷键 / 兼容与集成 */

const api = window.fnos;

const ext = {
  playback: document.getElementById('panel-playback'),
  security: document.getElementById('panel-security'),
  shortcuts: document.getElementById('panel-shortcuts'),
  integration: document.getElementById('panel-integration')
};

let currentSettings = {};
let currentLock = {};

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function makeRow(title, desc, control) {
  const row = el('div', 'row');
  const text = el('div', 'row-text');
  text.appendChild(el('div', 'row-title', title));
  if (desc) text.appendChild(el('div', 'row-desc', desc));
  row.appendChild(text);
  const holder = el('div', 'row-control');
  if (control) holder.appendChild(control);
  row.appendChild(holder);
  return row;
}

function makeSwitch(checked, onChange) {
  const label = el('label', 'switch');
  const input = el('input');
  input.type = 'checkbox';
  input.checked = !!checked;
  input.addEventListener('change', () => onChange(input.checked));
  label.appendChild(input);
  label.appendChild(el('span'));
  return label;
}

function makeInput(value, placeholder, onCommit, width) {
  const input = el('input', 'ext-input');
  input.type = 'text';
  input.value = value || '';
  input.placeholder = placeholder || '';
  if (width) input.style.width = width;

  const actions = el('div', 'ext-actions');
  const save = el('button', 'ghost', '保存');
  save.type = 'button';
  save.addEventListener('click', () => onCommit(input.value.trim()));
  actions.appendChild(save);

  const wrap = el('div', 'ext-flex');
  wrap.appendChild(input);
  wrap.appendChild(actions);
  return wrap;
}

function makeSelect(value, options, onChange) {
  const select = el('select');
  options.forEach((option) => {
    const node = el('option', '', option.label);
    node.value = String(option.value);
    select.appendChild(node);
  });
  select.value = String(value);
  select.addEventListener('change', () => onChange(select.value));
  return select;
}

function makeButton(label, onClick, className) {
  const button = el('button', className || 'ghost', label);
  button.type = 'button';
  button.addEventListener('click', onClick);
  return button;
}

function makeNote(text, tone) {
  return el('p', `ext-note${tone ? ` ${tone}` : ''}`, text);
}

async function patchSettings(payload) {
  const next = await api.settings.patch(payload);
  currentSettings = next || currentSettings;
  return currentSettings;
}

function flash(node, message, tone) {
  node.textContent = message;
  node.className = `ext-status${tone ? ` ${tone}` : ''}`;
}

/* ---------------- 播放与直播 ---------------- */

async function renderPlayback() {
  const host = ext.playback;
  if (!host) return;
  host.textContent = '';

  const status = await api.mpv.status().catch(() => null);
  const available = !!(status && status.available);
  const statusLine = makeNote(
    available ? `已检测到 MPV 内核：${status.path || '内置'}` : '未检测到 MPV 内核，HLS 直播将回退到网页播放器',
    available ? 'ok' : 'warn'
  );
  host.appendChild(statusLine);

  host.appendChild(makeRow(
    '启用 MPV 播放内核',
    '用于播放 HLS 直播流与网页播放器不支持的封装格式',
    makeSwitch(currentSettings.mpvEnabled, async (checked) => {
      await patchSettings({ mpvEnabled: checked });
    })
  ));

  const pickRow = makeRow('MPV 可执行文件', '留空则使用安装包内置的 mpv，可手动指定本机 mpv 路径', makeButton('选择', async () => {
    const result = await api.mpv.pick();
    if (!result || !result.ok) {
      flash(statusLine, (result && result.error) || '未选择文件', 'warn');
      return;
    }
    await patchSettings({ mpvPath: result.path });
    renderPlayback();
  }));
  host.appendChild(pickRow);
  host.appendChild(makeRow('当前路径', currentSettings.mpvPath || '使用内置内核', null));

  host.appendChild(makeRow(
    '内嵌 MPV 窗口',
    '启用后 MPV 画面贴在主窗口内；关闭则使用独立播放窗口',
    makeSwitch(currentSettings.mpvEmbed, async (checked) => {
      await patchSettings({ mpvEmbed: checked });
    })
  ));

  host.appendChild(makeRow(
    'MPV 附加参数',
    '例如 --hwdec=auto --cache=yes',
    makeInput(currentSettings.mpvExtraArgs || '', '--hwdec=auto', async (value) => {
      await patchSettings({ mpvExtraArgs: value });
    }, '260px')
  ));

  host.appendChild(makeRow(
    '嗅探页面媒体',
    '自动收集页面中的视频流地址，便于用 MPV 播放与下载',
    makeSwitch(currentSettings.sniffMedia, async (checked) => {
      await patchSettings({ sniffMedia: checked });
    })
  ));

  host.appendChild(makeRow(
    '启用电视直播',
    '在标题栏显示直播入口，读取 m3u 播放列表',
    makeSwitch(currentSettings.liveEnabled, async (checked) => {
      await patchSettings({ liveEnabled: checked });
    })
  ));

  host.appendChild(makeRow(
    '直播节目单（EPG）地址',
    '填写 xmltv 地址后可在直播页查看节目单',
    makeInput(currentSettings.liveEpgUrl || '', 'https://example.com/epg.xml', async (value) => {
      await patchSettings({ liveEpgUrl: value });
      flash(statusLine, '已保存', 'ok');
    }, '260px')
  ));
}

/* ---------------- 安全与锁屏 ---------------- */

async function renderSecurity() {
  const host = ext.security;
  if (!host) return;
  host.textContent = '';

  currentLock = (await api.lock.status().catch(() => null)) || {};

  host.appendChild(makeNote(
    currentLock.hasPassword ? '已设置启动密码' : '尚未设置密码，设置后才能启用锁屏',
    currentLock.hasPassword ? 'ok' : 'warn'
  ));

  host.appendChild(makeRow(
    '启用锁屏',
    '启动时与手动锁屏后需要输入密码',
    makeSwitch(currentLock.enabled, async (checked) => {
      const result = await api.lock.enable({ enabled: checked });
      if (!result || !result.ok) alert((result && result.error) || '无法切换锁屏状态');
      renderSecurity();
    })
  ));

  host.appendChild(makeRow(
    '启动时锁定',
    '应用启动后直接进入锁屏界面',
    makeSwitch(currentLock.lockOnStart, async (checked) => {
      const result = await api.lock.enable({ lockOnStart: checked });
      if (!result || !result.ok) alert((result && result.error) || '设置失败');
      renderSecurity();
    })
  ));

  host.appendChild(makeRow(
    '无操作自动锁屏',
    '离开电脑后自动锁屏，0 表示不自动锁定',
    makeSelect(currentLock.idleMinutes || 0, [
      { label: '不自动锁定', value: 0 },
      { label: '5 分钟', value: 5 },
      { label: '10 分钟', value: 10 },
      { label: '15 分钟', value: 15 },
      { label: '30 分钟', value: 30 }
    ], async (value) => {
      await api.lock.enable({ idleMinutes: Number(value) });
    })
  ));

  const passState = makeNote('', '');
  const oldPass = el('input', 'ext-input');
  oldPass.type = 'password';
  oldPass.placeholder = '原密码（首次设置可留空）';
  const newPass = el('input', 'ext-input');
  newPass.type = 'password';
  newPass.placeholder = '新密码（至少 4 位）';
  const confirmPass = el('input', 'ext-input');
  confirmPass.type = 'password';
  confirmPass.placeholder = '确认新密码';

  const passBox = el('div', 'ext-form');
  passBox.appendChild(oldPass);
  passBox.appendChild(newPass);
  passBox.appendChild(confirmPass);
  passBox.appendChild(makeButton('保存密码', async () => {
    if (newPass.value.length < 4) {
      flash(passState, '密码至少 4 位', 'warn');
      return;
    }
    if (newPass.value !== confirmPass.value) {
      flash(passState, '两次输入不一致', 'warn');
      return;
    }
    const result = currentLock.hasPassword
      ? await api.lock.changePassword(oldPass.value, newPass.value)
      : await api.lock.setPassword(newPass.value);
    if (!result || !result.ok) {
      flash(passState, (result && result.error) || '保存失败', 'warn');
      return;
    }
    oldPass.value = '';
    newPass.value = '';
    confirmPass.value = '';
    flash(passState, '密码已保存', 'ok');
    renderSecurity();
  }, 'primary'));
  passBox.appendChild(passState);

  host.appendChild(makeRow('启动密码', '密码经系统密钥加密并派生存储，不会保存明文', null));
  host.appendChild(passBox);

  const clearPass = el('input', 'ext-input');
  clearPass.type = 'password';
  clearPass.placeholder = '输入当前密码以清除';
  const clearState = makeNote('', '');
  const clearBox = el('div', 'ext-form');
  clearBox.appendChild(clearPass);
  clearBox.appendChild(makeButton('清除密码并关闭锁屏', async () => {
    const result = await api.lock.clearPassword(clearPass.value);
    if (!result || !result.ok) {
      flash(clearState, (result && result.error) || '清除失败', 'warn');
      return;
    }
    clearPass.value = '';
    flash(clearState, '已清除密码', 'ok');
    renderSecurity();
  }, 'ghost danger'));
  clearBox.appendChild(clearState);
  host.appendChild(clearBox);

  host.appendChild(makeRow(
    '启用老板键',
    '按下快捷键立即隐藏全部窗口',
    makeSwitch(currentLock.bossKeyEnabled, async (checked) => {
      await patchSettings({ bossKeyEnabled: checked });
      await api.shortcuts.update('boss', checked ? (currentLock.bossKey || 'Control+Shift+H') : '');
    })
  ));

  const bossState = makeNote('', '');
  const bossRow = makeRow('老板键', '填写组合键后按“应用”生效', makeInput(currentLock.bossKey || '', 'Control+Shift+H', async (value) => {
    const result = await api.shortcuts.update('boss', value);
    if (!result || !result.ok) {
      flash(bossState, (result && result.error) || '快捷键无效', 'warn');
      return;
    }
    await patchSettings({ bossKey: value });
    flash(bossState, '已生效', 'ok');
  }, '200px'));
  host.appendChild(bossRow);
  host.appendChild(bossState);
}

/* ---------------- 快捷键 ---------------- */

const ACTION_LABELS = {
  newTab: '新建标签页',
  closeTab: '关闭当前标签页',
  reload: '刷新当前页面',
  reopenTab: '恢复最近关闭的标签页',
  downloads: '打开下载中心',
  live: '打开电视直播',
  lock: '锁定应用',
  boss: '老板键（隐藏全部窗口）'
};

async function renderShortcuts() {
  const host = ext.shortcuts;
  if (!host) return;
  host.textContent = '';

  const raw = await api.shortcuts.list().catch(() => null);
  const rows = Array.isArray(raw) ? raw : (raw && (raw.shortcuts || raw.list)) || [];

  if (!rows.length) {
    host.appendChild(makeNote('未能读取快捷键配置', 'warn'));
    return;
  }

  const table = el('div', 'ext-shortcuts');
  rows.forEach((row) => {
    const id = row.id || row.action || row.name;
    if (!id) return;
    const line = el('div', 'ext-shortcut-row');
    line.appendChild(el('div', 'ext-shortcut-label', ACTION_LABELS[id] || row.label || id));

    const input = el('input', 'ext-input');
    input.type = 'text';
    input.value = row.accelerator || row.value || '';
    input.placeholder = '例如 Control+Shift+H';

    const state = makeNote('', '');
    const actions = el('div', 'ext-actions');
    actions.appendChild(makeButton('应用', async () => {
      const result = await api.shortcuts.update(id, input.value.trim());
      if (!result || !result.ok) {
        flash(state, (result && result.error) || '设置失败', 'warn');
        return;
      }
      flash(state, '已生效', 'ok');
    }, 'primary'));

    line.appendChild(input);
    line.appendChild(actions);
    table.appendChild(line);
    table.appendChild(state);
  });

  host.appendChild(table);
  host.appendChild(makeButton('全部恢复默认', async () => {
    await api.shortcuts.reset();
    renderShortcuts();
  }));
}

/* ---------------- 兼容与集成 ---------------- */

async function renderIntegration() {
  const host = ext.integration;
  if (!host) return;
  host.textContent = '';

  const note = makeNote('', '');

  host.appendChild(makeRow(
    '显卡兼容模式',
    '关闭硬件加速，解决花屏、黑屏、界面闪烁；切换后需重启应用',
    makeSwitch(currentSettings.gpuCompatible, async (checked) => {
      await patchSettings({ gpuCompatible: checked });
      flash(note, '已保存，重启后生效', 'ok');
    })
  ));

  host.appendChild(makeRow(
    '启动时检查更新',
    '每次启动从 GitHub 发布页比对最新版本',
    makeSwitch(currentSettings.autoCheckUpdate, async (checked) => {
      await patchSettings({ autoCheckUpdate: checked });
    })
  ));

  host.appendChild(makeRow(
    '应用快捷方式',
    '在飞牛 NAS 网页中点击应用图标时，用独立窗口或系统默认程序打开',
    makeSwitch(currentSettings.appShortcuts, async (checked) => {
      await patchSettings({ appShortcuts: checked });
    })
  ));

  const info = await api.applink.info().catch(() => null);
  const exePath = info && (info.exePath || info.target || '');
  host.appendChild(makeRow(
    '桌面快捷方式',
    exePath ? `目标：${exePath}` : '安装版可直接创建，便携版需手动指定程序路径',
    makeButton('创建', async () => {
      const result = await api.applink.create({});
      if (!result || !result.ok) {
        flash(note, (result && result.error) || '创建失败', 'warn');
        return;
      }
      flash(note, '桌面快捷方式已创建', 'ok');
    })
  ));
  host.appendChild(note);

  const ops = el('div', 'ext-actions');
  ops.appendChild(makeButton('打开日志目录', () => api.app.openLogDir()));
  ops.appendChild(makeButton('重启应用', () => api.app.restart()));
  host.appendChild(ops);
}

async function boot() {
  currentSettings = (await api.settings.get()) || {};
  await Promise.all([
    renderPlayback().catch(() => null),
    renderSecurity().catch(() => null),
    renderShortcuts().catch(() => null),
    renderIntegration().catch(() => null)
  ]);
}

boot();
