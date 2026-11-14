'use strict';

const { app, Menu, shell } = require('electron');
const windows = require('./windows');

function buildAppMenu() {
  const template = [
    {
      label: app.getName(),
      submenu: [
        { role: 'about', label: '关于 飞牛 NAS' },
        { type: 'separator' },
        { label: '设置…', accelerator: 'Cmd+,', click: () => windows.createSettings(windows.getMain()) },
        { type: 'separator' },
        { role: 'hide', label: '隐藏' },
        { role: 'hideOthers', label: '隐藏其他' },
        { role: 'unhide', label: '显示全部' },
        { type: 'separator' },
        {
          label: '退出',
          click: () => {
            windows.markQuitting();
            app.quit();
          }
        }
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
        {
          label: '飞牛官网',
          click: () => shell.openExternal('https://www.fnnas.com/').catch(() => {})
        }
      ]
    }
  ];
  return Menu.buildFromTemplate(template);
}

module.exports = { buildAppMenu };
