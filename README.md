# 飞牛 NAS 桌面客户端

## 功能

- 多标签浏览：新建、切换、中键关闭、拖拽排序、右键菜单，`Ctrl+T` / `Ctrl+W` / `Ctrl+Tab` / `Ctrl+1…9` 快捷键
- 多设备管理：保存多个 NAS 地址，随时切换，启动自动连接默认设备
- 会话恢复：可选在启动时还原上次未关闭的标签
- 下载接管：网页下载直接写入指定目录，重名自动加序号，支持每次询问保存位置
- 独立会话：所有页面共用 `persist:fnos` 会话分区，登录一次长期有效
- 主题跟随、托盘最小化、窗口位置记忆、版本检查（读取 GitHub Release）
- 无自绘标题栏干扰：Windows 使用原生窗口按钮，macOS 使用交通灯布局

## 开发

```bash
npm install
npm start
```

要求 Node.js 20 及以上、Electron 44。

## 打包

```bash
npm run dist:win   # Windows NSIS 安装包
npm run dist:mac   # macOS dmg（Apple Silicon）
```

产物输出到 `dist/`。

## 持续构建

推送 `v` 开头的标签即可触发 GitHub Actions 全流程：

```bash
git tag v1.0.0
git push origin v1.0.0
```

流水线依次执行脚本语法检查、Windows 与 macOS 双平台打包，并把安装包附到对应的 Release。

## 目录结构

```
src/
  main/        主进程：窗口、标签治理、配置、下载、更新
  preload/     预加载脚本：界面桥接与页面路由上报
  renderer/    界面：主窗口、连接设备、设置
assets/        图标资源
build/         打包资源
.github/       持续集成配置
```

## 许可

MIT
