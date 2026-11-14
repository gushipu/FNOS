'use strict';

const { app, Menu, shell } = require('electron');

const windows = require('./windows');
const lock = require('./lock');
const update = require('./update');

const HOMEPAGE = 'https://github.com/gushipu/FNOS';

function buildAppMenu() {
  const template = [
    {
      label: '飞牛 NAS',
      submenu: [
        { label: '关于 飞牛 NAS', role: 'about' },
        {
          label: '检查更新…',
          click: () => update.check({ silent: false })
        },
        { type: 'separator' },
        {
          label: '设置…',
          accelerator: 'Cmd+,',
          click: () => windows.createSettings(windows.getMain())
        },
        {
          label: '下载中心',
          accelerator: 'Cmd+J',
          click: () => windows.createDownloads(windows.getMain())
        },
        {
          label: '电视直播',
          accelerator: 'Cmd+Shift+L',
          click: () => windows.createLive(windows.getMain())
        },
        { type: 'separator' },
        { label: '立即锁屏', click: () => lock.lock('menu') },
        { label: '老板键（隐藏/恢复）', click: () => lock.bossToggle() },
        { type: 'separator' },
        { role: 'hide', label: '隐藏 飞牛 NAS' },
        { role: 'hideOthers', label: '隐藏其他' },
        { role: 'unhide', label: '显示全部' },
        { type: 'separator' },
        { label: '退出', accelerator: 'Cmd+Q', click: () => { windows.markQuitting(); app.quit(); } }
      ]
    },
    {
      label: '编辑',
      submenu: [
        { role: 'undo', label: '撤销' },
        { role: 'redo', label: '重做' },
        { type: 'separator' },
        { role: 'cut', label: '剪切' },
        { role: 'copy', label: '复制' },
        { role: 'paste', label: '粘贴' },
        { role: 'selectAll', label: '全选' }
      ]
    },
    {
      label: '视图',
      submenu: [
        { role: 'reload', label: '刷新' },
        { role: 'forceReload', label: '强制刷新' },
        { type: 'separator' },
        { role: 'resetZoom', label: '实际大小' },
        { role: 'zoomIn', label: '放大' },
        { role: 'zoomOut', label: '缩小' },
        { type: 'separator' },
        { role: 'togglefullscreen', label: '全屏' },
        { role: 'toggleDevTools', label: '开发者工具' }
      ]
    },
    {
      label: '窗口',
      submenu: [
        { role: 'minimize', label: '最小化' },
        { role: 'zoom', label: '缩放' },
        { type: 'separator' },
        { role: 'front', label: '前置全部窗口' }
      ]
    },
    {
      label: '帮助',
      submenu: [
        { label: '项目主页', click: () => shell.openExternal(HOMEPAGE).catch(() => {}) },
        { label: '发布说明', click: () => update.openReleasePage() }
      ]
    }
  ];

  return Menu.buildFromTemplate(template);
}

module.exports = { buildAppMenu };
