# 内置 MPV 播放器运行时

本目录用于存放随安装包分发的播放器本体，主进程按以下顺序解析播放器路径：

1. 用户设置中手动指定的 `mpvPath`
2. 本目录下的 `mpv.exe`（打包后位于 `resources/mpv/mpv.exe`）
3. 系统 `PATH` 中的 `mpv`

## 文件说明

- `mpv.exe` — 播放器主程序（x86_64）
- `d3dcompiler_43.dll` — Direct3D 运行时依赖，缺失时部分渲染后端会启动失败

二进制体积较大且平台相关，不纳入版本库（见根目录 `.gitignore`）。发布流水线在打 `v*` 标签构建时，依次从下列位置下载 `mpv-runtime-x86_64.7z` 并解压到本目录：

1. 本仓库的 `mpv-runtime` 发布资源
2. 上游模板仓库 `zhouchunwei513-cyber/fnos-desktop` 的 `mpv-runtime` 发布资源

两条回落都失败时流水线直接报错退出，避免产出没有播放内核的安装包。

## 本地开发

无内核时功能仍然可用：设置页提供“选择播放器路径”，也可把 `mpv.exe` 直接放入本目录。内核缺失或启动失败时，播放入口会给出提示并回退到网页播放器。

## 随包配置

`../mpv-config/` 会被打包到 `resources/mpv-config/`，启动时通过 `--config-dir` 传入，包含：

- `mpv.conf` — 解码、缓存、字幕与音轨优选
- `script-opts/context_menu.conf` — 右键菜单项
- `scripts/fnos-menu.lua` — 右键菜单脚本
- `scripts/osc-zh-cn.lua` — 中文字幕 / 音轨 / 章节菜单
