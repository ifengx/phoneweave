# PhoneWeave

**Open control fabric for real mobile devices — for humans, scripts and AI agents.**

PhoneWeave 是一个面向**真实异地手机**的开源远程控制项目。项目目标不是复制传统远程桌面，也不是把 Android 模拟器伪装成真机，而是把分散在不同地点的真实移动设备组织成一个统一、可编程、可人工接管的设备网络。

> 当前仓库为 **v0.2 UI engineering preview**：控制平面、人工 Web 控制台、Android Accessibility 控制、截图/UI Tree、MCP stdio gateway、WebRTC 屏幕流骨架已经放在同一个工程中。MediaProjection 授权仍受 Android 系统规则约束；首次启用实时屏幕需要设备端用户授权。

## 为什么叫 PhoneWeave

- **Phone**：聚焦真实手机，而不是模拟器。
- **Weave**：把不同地点、不同网络、不同型号的设备“编织”为一个统一设备网。
- 名称不绑定 Android、MCP、RustDesk 或 WebRTC，因此未来可以扩展到 iOS、硬件控制器、更多 Agent 协议。

## 核心愿景

一个设备，三种控制入口，共用一个动作引擎：

```text
                         PhoneWeave
                            │
                ┌───────────┼───────────┐
                │           │           │
              Human       Script       Agent
                │           │           │
             Browser       REST         MCP
                │           │           │
                └───────────┼───────────┘
                            │
                     ControlArbiter
                            │
                      ControlEngine
                            │
                AccessibilityService
                            │
                       Real Android
```

画面与控制解耦：

```text
Realtime human video:
MediaProjection → libwebrtc → P2P / TURN → Browser

Agent observation:
Accessibility UI tree + on-demand screenshot → REST/MCP
```

## v0.1 已实现

- Android 真机主动通过 WSS/WS 连接控制服务器，不要求手机有公网 IP。
- AccessibilityService：tap、swipe、文本输入、Back、Home、Recents、启动 App。
- UI Tree 读取。
- Android 11+ Accessibility screenshot。
- 浏览器设备列表和人工接管。
- 浏览器点击/拖动映射为 Android tap/swipe。
- Human / Agent 控制权仲裁和 fencing token。
- Android WebRTC `ScreenCapturerAndroid` + hardware encoder 路径骨架。
- P2P 优先、TURN fallback 的 ICE 配置下发。
- REST API。
- MCP 2026-07-28 SDK v2 stdio gateway。
- Docker Compose + coturn。
- 完整启动、诊断、Android 构建/安装脚本。

## 目录

```text
phoneweave/
├── phoneweave                  # 统一命令入口
├── docker-compose.yml
├── .env.example
├── server/                     # Device Registry / signaling / lease / REST
├── web-console/                # React + Tailwind v4 + Shadcn/ui-style Web Console
├── mcp/                        # MCP stdio gateway
├── android-agent/              # 原生 Kotlin Android Agent
├── deploy/coturn/              # TURN 说明
├── scripts/                    # 启动与构建脚本
└── docs/                       # 架构、协议、安全与路线图
```

---

# 快速启动

## macOS + Android Studio + VS Code（推荐开发方式）

如果你在 Mac 上安装了 Android Studio，SDK 默认通常位于：

```bash
$HOME/Library/Android/sdk
```

PhoneWeave 会自动探测，无需手工设置环境变量：

```bash
./phoneweave android-sdk
./phoneweave doctor
```

第一阶段推荐直接使用 Android Studio Emulator：

```bash
./phoneweave dev          # Mac 本机 Server :8787
./phoneweave emulator-run # 启动模拟器、构建并安装 APK
```

模拟器中的 Agent 默认使用 `http://10.0.2.2:8787` 访问 Mac 的 `localhost:8787`。

仓库已经包含 `.vscode/launch.json` 和 `.vscode/tasks.json`。在 VS Code 的 **Run and Debug** 中选择 `PhoneWeave: Server Debug + Web Console` 后按 F5，即可断点调试服务端并自动打开 Web Console。

完整说明：[`docs/MACOS_DEVELOPMENT.md`](docs/MACOS_DEVELOPMENT.md)

## 1. 服务端本地启动

需要 Node.js 20+（推荐 Node.js 22+）。

```bash
cp .env.example .env
./phoneweave bootstrap
./phoneweave dev
```

默认打开：

```text
http://localhost:8787
```

健康检查：

```bash
curl http://localhost:8787/api/health
```

## 2. Docker + TURN

服务器有 Docker 时：

```bash
cp .env.example .env
# 编辑 .env，至少修改 token、PUBLIC_BASE_URL、TURN_URL
./phoneweave up
```

停止：

```bash
./phoneweave down
```

> 公网部署 TURN 时，需要把 `TURN_URL` 设置为手机和浏览器都能访问的公网域名/IP，例如 `turn:turn.example.com:3478`。如果 coturn 在 NAT 后，还需要按 coturn 文档配置 external-ip 和 UDP 端口映射。

远端服务器直接按 IP 部署：

```bash
./phoneweave deploy-server # 一键部署：发布 coturn 与 Web 控制服务
./phoneweave deploy-turn   # 单独发布或更新 coturn
./phoneweave deploy-web    # 单独发布或更新 Web Console 与控制服务器
```

默认公网端点：

```text
Web / Android Server URL: http://<服务器IP>:8787
TURN URL:                 turn:<服务器IP>:3478
```

完整说明见 [`docs/REMOTE_TURN_DEPLOYMENT.md`](docs/REMOTE_TURN_DEPLOYMENT.md)。

面向部署和日常使用人员的完整中文步骤见 [`docs/OPERATOR_MANUAL.md`](docs/OPERATOR_MANUAL.md)。

## 3. Android Agent 构建

要求：

- JDK 17+
- Android SDK Platform 36
- Android SDK Build Tools 36.0.0+
- ADB

PhoneWeave 固定使用 AGP 9.2.x / Gradle 9.4.1，并使用 AGP 9 的 built-in Kotlin。

```bash
./phoneweave android-build
```

连接一台本地测试手机后安装：

```bash
./phoneweave android-install
```

如果本机没有 Gradle，脚本会下载 Gradle 9.4.1 到项目自己的 `.tools/`，不会污染系统 Gradle。

## 4. 手机上的一次性初始化

打开 PhoneWeave Agent：

1. 填写 `Server URL`，例如 `https://pw.example.com` 或开发环境 `http://192.168.1.10:8787`。
2. 填写 Device ID，例如 `pixel-001`。
3. 填写 Device Token（与服务端 `.env` 相同）。
4. 点击 **Enable Accessibility**，打开 PhoneWeave accessibility service。
5. 点击 **Start Agent**。
6. 如需实时视频，点击 **Enable Live Screen** 并确认 Android 的系统屏幕捕获授权。

之后手机会主动连接控制服务器。

## 5. 人工远控

浏览器访问服务端首页：

```text
https://pw.example.com/
```

使用根目录 `.env` 中的 `WEB_TOKEN` 登录，再选择设备。登录成功后浏览器只保存 HttpOnly 会话 Cookie，不保存明文密码：

- `Take Over`：抢占人工控制权。
- `Start Live`：启动 WebRTC 实时屏幕。
- 直接点击屏幕：tap。
- 拖动：swipe。
- Back / Home / Recents。
- Snapshot：未授权 MediaProjection 或实时流不可用时自动使用截图，并且仍可点击/拖动控制。
- 上传文件：选择本机文件后分块发送到 Android 的 `Downloads/PhoneWeave`，默认最大 512 MiB，服务器可通过 `PHONEWEAVE_MAX_UPLOAD_BYTES` 调低上限。

## 6. MCP

先启动服务端，再：

```bash
export PHONEWEAVE_BASE_URL=http://localhost:8787
export PHONEWEAVE_ADMIN_TOKEN=change-me-admin
./phoneweave mcp
```

MCP stdio server 暴露：

- `phoneweave_list_devices`
- `phoneweave_device_status`
- `phoneweave_tap`
- `phoneweave_swipe`
- `phoneweave_input_text`
- `phoneweave_back`
- `phoneweave_home`
- `phoneweave_launch_app`
- `phoneweave_ui_tree`
- `phoneweave_screenshot`
- `phoneweave_release_agent`

可以把 `./phoneweave mcp` 配置为 OpenClaw 或任意 MCP host 的 stdio command。

---

# 关键工程原则

完整组件边界和依赖规则见 [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md)。每个组件只拥有一种能力，通过稳定契约协作；新增传输或客户端不得复制动作引擎。

### 1. 一个动作只实现一次

Human、REST、MCP 都不能各自实现 tap/swipe；它们必须统一进入 `ControlEngine`。

### 2. 画面和控制分离

实时视频网络拥堵不能阻塞鼠标操作。v0.1 的控制事件通过控制 WebSocket 独立传输；后续可增加 WebRTC DataChannel fast-path。

### 3. Latest state wins

远程桌面优先展示“现在”，不是补播历史帧。后续视频 QoS 会优先丢弃过期帧，而不是积压。

### 4. Human 永远可以抢占 Agent

控制状态：

```text
FREE → AGENT → HUMAN
         ↑       │
         └───────┘ release
```

每次 ownership 切换都会增加 fencing token，旧请求即使延迟到达也不能执行。

### 5. Live video 失效 ≠ 设备失联

Android MediaProjection 有系统授权约束。即使视频流失效，只要 Accessibility + Agent socket 在线，仍可通过 screenshot/UI tree/tap 进行救援。

---

# 安全边界

PhoneWeave 面向你拥有或明确授权管理的设备。默认设计包含：

- Device token 与 Admin token 分离。
- Android 只建立 outbound connection。
- Human takeover 有显式 lease。
- REST action 有 fencing token/ownership 验证。
- 不提供隐藏 Root、设备指纹伪造、绕过应用完整性检测等能力。

生产部署请务必放在 TLS 反向代理之后，并更换 `.env.example` 中所有默认凭据。

更多：[`docs/SECURITY.md`](docs/SECURITY.md)

# 许可证

项目代码计划使用 **Apache-2.0**。

本仓库没有复制 RustDesk AGPL 源代码；RustDesk 只作为远程桌面架构研究参考。Android Remote Control MCP 的 MIT 实现也只作为设计研究参考，当前工程代码为重新实现。若未来直接引入第三方源码，必须在 `THIRD_PARTY_NOTICES.md` 标注来源、版本和许可证。

详见 [`docs/LICENSE_STRATEGY.md`](docs/LICENSE_STRATEGY.md)。


## v0.2 UI development

Web Console now uses React + Vite + Tailwind v4 with Shadcn/ui-style primitives. Android Agent uses Jetpack Compose + Material Design 3.

```bash
./phoneweave bootstrap
./phoneweave dev       # control server :8787
./phoneweave web-dev   # web console :5173, proxies /api and /ws
```

In VS Code select **PhoneWeave: Full Stack UI Debug** to start the Node debugger and the Web Console. See `docs/UI_UX_SPEC.md`.
