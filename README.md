# OBS 着色器选型器

obs-shaderfilter 插件的**汉化包 + 可视化面板**。一键安装，无需端口、无需 Node 运行时。

- 142 个效果缩略图 + 可视化参数面板
- 通过 OBS Custom Browser Dock（`file://`）加载，直连 obs-websocket v5
- 面板与 OBS 实时同步：源列表增删、滤镜状态（"当前"标记）自动回读，改源即同步
- 安装脚本处理全部前提条件：无 OBS → 提示先装；已有插件 → 覆盖且场景不丢；OBS 运行中 → 自动关闭并轮询等待

## 快速开始

1. 下载 [最新 Release](https://github.com/wampeeHuang/obs-shaderpicker/releases) 里的 `OBS着色器选型器-汉化包-v1.zip`
2. 解压，双击 `install.bat`，按提示操作（GBK 编码，中文 cmd 可直接运行）
3. 打开 OBS → 菜单栏 **Dock** → **着色器选型器**

详细说明见 `使用说明.txt`。

## 目录结构

```
install.bat        一键安装（GBK+CRLF，兼容中文 cmd）
provision.ps1      安装逻辑（UTF-8 BOM，PowerShell 5.1）
plugin/            插件本体：上游 obs-shaderfilter.dll + 163 个 shader + 汉化 zh-CN.ini
panel/             可视化面板源码（file:// 加载，直连 obs-websocket）
LICENSE / NOTICE   许可证与版权声明
```

## 工作原理

- 面板以 OBS Custom Browser Dock 加载本地 `panel/`，无 HTTP 服务器、无端口
- 面板每 2 秒通过 obs-websocket v5 轮询 OBS 状态：源列表增量同步、当前源滤镜状态回读
- 同步决策逻辑（`panel/sync.js`）为纯函数，可独立单元测试

## 版权

| 部分 | 版权 |
| --- | --- |
| 插件本体 | [Oncorporation/obs-shaderfilter](https://github.com/Oncorporation/obs-shaderfilter)，GPL-2.0 |
| 汉化、面板、安装脚本 | 作者原创，见 [NOTICE.txt](NOTICE.txt) |

本项目整体按 **GPL-2.0** 发布（见 [LICENSE](LICENSE)）。插件二进制由上游源码构建，上游源码见上表链接。
