# 飞牛 NAS 桌面客户端 3.1.0

面向飞牛 NAS（fnOS）的跨平台桌面客户端。以浏览器式的多标签容器承载 NAS 网页端，并在窗口层补齐下载、播放、直播、安全与集成能力：不用再在浏览器标签与桌面之间来回切换。

## 功能

- 多标签浏览：新建、切换、中键关闭、拖拽排序、右键菜单，`Ctrl+T` / `Ctrl+W` / `Ctrl+Tab` / `Ctrl+1…9` 快捷键
- 多设备管理：保存多个 NAS 地址，随时切换，启动自动连接默认设备
- 会话恢复：可选在启动时还原上次未关闭的标签
- 下载接管：网页下载直接写入指定目录，重名自动加序号，支持每次询问保存位置
- 主题跟随、托盘最小化（托盘菜单含下载中心与直播入口）、窗口位置记忆、版本检查（读取 GitHub Release）
- 应用内更新：读取 GitHub Release 后在窗口内下载，退出应用后在原安装目录静默覆盖安装，安装包存放在用户数据目录，不随旧版卸载丢失
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
git tag v2.0.0
git push origin v2.0.0
```

流水线依次执行脚本语法检查、Windows 与 macOS 双平台打包，并把安装包附到对应的 Release。

## 目录结构

```
src/
  main/        主进程：窗口与标签治理、配置与凭据、下载、MPV、直播、皮肤、锁屏、快捷键、快捷方式、更新
  preload/     预加载脚本：界面桥接、页面路由上报、页面内媒体嗅探
  renderer/    界面：主窗口、连接设备、设置、下载中心、电视直播
assets/        图标资源
mpv/           内置播放器运行时（mpv.exe 与依赖 DLL，由发布资源提供，不纳入版本库）
mpv-config/    内置播放器配置：解码与字幕优选、右键菜单、快捷键提示
build/         打包资源
.github/       持续集成配置
```

## 许可

MIT
