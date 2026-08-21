# PhoneWeave

**Open control fabric for real mobile devices — for humans, scripts and AI agents.**

[English](#english) | [简体中文](#简体中文)

---

<a name="english"></a>
## English

PhoneWeave is an open-source remote control and orchestration fabric designed for **real remote Android devices**. The goal is not to replicate traditional desktop-centric remote software, nor to pretend emulators are real hardware, but to weave distributed, real mobile devices across diverse networks into a unified, programmable, and human-takeover-ready device fabric.

> Current repository status: **v0.2 UI Engineering Preview**. Control plane, Web Console, Android Accessibility control, UI Tree / Screenshots, MCP stdio gateway, and WebRTC streaming skeleton are integrated into a single unified workspace. Android MediaProjection permissions remain subject to OS security constraints; first-time live screen capture requires on-device user authorization.

### Why PhoneWeave

- **Phone**: Focused on real physical smartphones rather than emulators.
- **Weave**: "Weaves" devices across locations, networks, and manufacturers into a cohesive fabric.
- Open naming not tied to Android, MCP, RustDesk, or WebRTC, enabling future expansion to iOS, hardware controllers, and emerging Agent protocols.

### Core Vision

One device, three control interfaces, powered by a single unified action engine:

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

Decoupled observation and control:

```text
Realtime human video:
MediaProjection → libwebrtc → P2P / TURN → Browser

Agent observation:
Accessibility UI tree + on-demand screenshot → REST / MCP
```

### Features

- **Inbound Device Connections**: Android devices connect outbound to the control server via WS/WSS — no public IP or port forwarding required on phones.
- **Accessibility Control Engine**: Tap, swipe, text input, Back, Home, Recents, app launching.
- **UI Tree & Snapshot Extraction**: High-performance JSON UI hierarchy extraction and Android 11+ Accessibility screenshots.
- **Web Console**: Responsive device list, live screen / snapshot stream, mouse click/drag to tap/swipe translation, and chunked file transfers (up to 512 MiB).
- **Control Arbitration**: Dual Human / Agent ownership arbitration with fencing tokens to prevent stale command execution.
- **WebRTC Screen Stream**: Low-latency video pipeline (`ScreenCapturerAndroid` + hardware H.264 encoder) with P2P-first and TURN fallback.
- **MCP Integration**: Model Context Protocol (2026-07-28 SDK v2) stdio gateway for AI agents (Claude Desktop, OpenClaw, cursor/IDE hosts).
- **Production-Ready Deployment**: Docker Compose + coturn deployment automation and one-click remote deployment scripts.

### Project Layout

```text
phoneweave/
├── phoneweave                  # Unified CLI launcher
├── docker-compose.yml          # Containerized local / server setup
├── .env.example                # Configuration template
├── server/                     # Device registry / signaling / lease / REST API
├── web-console/                # React + Tailwind v4 + Shadcn/ui Web Console
├── mcp/                        # MCP stdio gateway
├── android-agent/              # Native Kotlin Android Agent
├── deploy/coturn/              # Coturn TURN deployment configuration
├── scripts/                    # Development, build, and diagnostic scripts
└── docs/                       # Architecture, protocol, and operator docs
```

---

### Quick Start

#### macOS + Android Studio + VS Code (Recommended Dev Environment)

Android Studio SDK is auto-detected (typically `$HOME/Library/Android/sdk`):

```bash
./phoneweave android-sdk
./phoneweave doctor
```

Run local development with Android Studio Emulator:

```bash
./phoneweave dev          # Starts local control server on :8787
./phoneweave emulator-run # Starts emulator, builds and installs Android Agent
```

> The emulator connects to the host server at `http://10.0.2.2:8787`. In VS Code, select **PhoneWeave: Full Stack UI Debug** and press `F5` to debug server and launch Web Console.

#### 1. Local Server Launch

Requires Node.js 20+ (Node.js 22+ recommended):

```bash
cp .env.example .env
./phoneweave bootstrap
./phoneweave dev
```

Open `http://localhost:8787` in your browser. Health check:

```bash
curl http://localhost:8787/api/health
```

#### 2. Docker & TURN Deployment

```bash
cp .env.example .env
# Edit .env: set custom tokens, PUBLIC_BASE_URL, and TURN_URL
./phoneweave up
```

Stop containers:

```bash
./phoneweave down
```

Remote server one-click deployment:

```bash
./phoneweave deploy-server # One-click deployment: coturn + Web control server
./phoneweave deploy-turn   # Deploy / update coturn only
./phoneweave deploy-web    # Deploy / update Web Console & server only
```

#### 3. Build & Install Android Agent

Prerequisites: JDK 17+, Android SDK Platform 36, Build Tools 36.0.0+, ADB. (Built with AGP 9.2.x / Gradle 9.4.1).

```bash
./phoneweave android-build    # Assemble debug APK
./phoneweave android-install  # Install onto connected USB/ADB device
```

#### 4. Device Setup

Open PhoneWeave Agent on your phone:
1. Enter `Server URL` (e.g. `https://pw.example.com` or local `http://192.168.1.10:8787`).
2. Enter `Device ID` (e.g. `pixel-001`).
3. Enter `Device Token` (matching `PHONEWEAVE_DEVICE_TOKEN` in `.env`).
4. Tap **Enable Accessibility** and turn on the PhoneWeave accessibility service.
5. Tap **Start Agent**.
6. (Optional) Tap **Enable Live Screen** and grant Android MediaProjection screen capture permission.

#### 5. Web Console Takeover

Navigate to your server URL:

```text
https://pw.example.com/
```

Log in with `WEB_TOKEN` from `.env`. (Sessions are managed via secure HttpOnly cookies).
- **Take Over**: Claim human control arbitration.
- **Start Live**: Stream real-time WebRTC display.
- **Snapshot Mode**: Fallback on-demand screenshots when MediaProjection is unavailable.
- **Mouse Interaction**: Click to tap, drag to swipe, navigation keys (Back, Home, Recents).
- **File Transfer**: Send files in chunks directly to Android's `Downloads/PhoneWeave`.

#### 6. MCP Gateway for AI Agents

```bash
export PHONEWEAVE_BASE_URL=http://localhost:8787
export PHONEWEAVE_ADMIN_TOKEN=change-me-admin
./phoneweave mcp
```

MCP stdio server exposes:
`phoneweave_list_devices`, `phoneweave_device_status`, `phoneweave_tap`, `phoneweave_swipe`, `phoneweave_input_text`, `phoneweave_back`, `phoneweave_home`, `phoneweave_launch_app`, `phoneweave_ui_tree`, `phoneweave_screenshot`, `phoneweave_release_agent`.

---

### Key Engineering Principles

1. **Single Action Implementation**: Human, REST, and MCP commands funnel into a single `ControlEngine`. No duplicated gesture logic across transport layers.
2. **Decoupled Video & Control**: Control signals travel over independent WebSockets so network congestion on video streams never stalls input commands.
3. **Latest State Wins**: Remote desktop prioritizes the "present" rather than replaying buffered stale frames.
4. **Human Preempts Agent**: Humans can always preempt AI control via lease arbitration and fencing tokens:
   ```text
   FREE → AGENT → HUMAN
            ↑       │
            └───────┘ release
   ```
5. **Video Loss ≠ Device Offline**: Even if MediaProjection is revoked, as long as Accessibility and Agent WebSocket are active, the device remains fully controllable via UI tree, snapshot, and tap.

### Security Boundaries

PhoneWeave is designed for devices you own or have explicit authorization to operate:
- Clear separation between Device token and Admin token.
- Outbound-only device connections (no open inbound ports on phones).
- Explicit leases and fencing token validation on control actions.
- No hidden root exploits, device fingerprint spoofing, or integrity bypasses.
- Production deployments must be placed behind a TLS reverse proxy with default credentials changed.

### License

PhoneWeave is open source under the **Apache-2.0** license.

---

<a name="简体中文"></a>
## 简体中文

PhoneWeave 是一个面向**真实异地手机**的开源远程控制与编排平台。项目目标不是复制传统桌面远程软件，也不是把 Android 模拟器伪装成真机，而是把分散在不同地点、不同网络的真实移动设备组织成一个统一、可编程、可人工接管的设备网络。

> 当前仓库状态：**v0.2 UI engineering preview**。控制平面、人工 Web 控制台、Android Accessibility 控制、截图/UI Tree、MCP stdio gateway、WebRTC 屏幕流骨架已统一集成在同一工程中。MediaProjection 授权仍受 Android 系统安全规则约束；首次启用实时屏幕需要设备端用户授权。

### 为什么叫 PhoneWeave

- **Phone**：聚焦真实物理手机，而不是模拟器。
- **Weave**：把不同地点、不同网络、不同型号的设备“编织”为一个统一设备网。
- 名称不绑定 Android、MCP、RustDesk 或 WebRTC，未来可扩展到 iOS、硬件控制器及更多 Agent 协议。

### 核心愿景

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
Accessibility UI tree + on-demand screenshot → REST / MCP
```

### 功能特性

- **真机主动连接**：Android 真机主动通过 WSS/WS 连接控制服务器，无需手机具备公网 IP 或配置内网穿透。
- **无障碍控制引擎**：支持 Tap、Swipe、文本输入、Back、Home、Recents、启动 App。
- **UI Tree 与截屏提取**：高性能提取 JSON 格式 UI 层级树，支持 Android 11+ Accessibility 高速截屏。
- **Web 控制台**：设备列表管理、实时屏幕/截图流、鼠标点击/拖动转手势操作、大文件分块上传（默认最高 512 MiB）。
- **控制权仲裁机制**：Human / Agent 双重控制权仲裁与 Fencing Token 机制，防止过期指令误执行。
- **WebRTC 实时屏幕流**：低延迟视频管道（`ScreenCapturerAndroid` + 硬件 H.264 编码器），P2P 优先并在穿透失败时通过 TURN 中继。
- **MCP 协议支持**：支持 Model Context Protocol (2026-07-28 SDK v2) stdio gateway，无缝对接各类 AI Agent 宿主。
- **自动化运维与部署**：内置 Docker Compose + coturn 部署自动化与一键远端发布脚本。

### 项目目录

```text
phoneweave/
├── phoneweave                  # 统一命令入口
├── docker-compose.yml          # 本地与服务端容器编排
├── .env.example                # 环境变量配置模板
├── server/                     # 设备注册 / 信令 / 租约 / REST API
├── web-console/                # React + Tailwind v4 + Shadcn/ui 控制台
├── mcp/                        # MCP stdio gateway
├── android-agent/              # 原生 Kotlin Android Agent
├── deploy/coturn/              # TURN 部署配置说明
├── scripts/                    # 开发、构建与诊断脚本
└── docs/                       # 架构、协议、运维与安全文档
```

---

### 快速启动

#### macOS + Android Studio + VS Code（推荐开发方式）

如果安装了 Android Studio，SDK 通常位于 `$HOME/Library/Android/sdk`，脚本会自动探测：

```bash
./phoneweave android-sdk
./phoneweave doctor
```

使用 Android Studio Emulator 启动本地联调：

```bash
./phoneweave dev          # 启动本机控制服务器 :8787
./phoneweave emulator-run # 启动模拟器、自动构建并安装 APK
```

> 模拟器中的 Agent 默认使用 `http://10.0.2.2:8787` 访问宿主机的 `localhost:8787`。在 VS Code 的 **Run and Debug** 中选择 `PhoneWeave: Full Stack UI Debug` 后按 `F5` 即可断点调试服务端并自动打开 Web Console。

#### 1. 服务端本地启动

环境要求：Node.js 20+（推荐 Node.js 22+）。

```bash
cp .env.example .env
./phoneweave bootstrap
./phoneweave dev
```

默认打开控制台：`http://localhost:8787`。服务健康检查：

```bash
curl http://localhost:8787/api/health
```

#### 2. Docker 与 TURN 部署

```bash
cp .env.example .env
# 编辑 .env，配置自定义 Token、PUBLIC_BASE_URL、TURN_URL 等
./phoneweave up
```

停止服务：

```bash
./phoneweave down
```

远端服务器一键自动化部署：

```bash
./phoneweave deploy-server # 一键部署：发布 coturn 与 Web 控制服务
./phoneweave deploy-turn   # 单独发布或更新 coturn
./phoneweave deploy-web    # 单独发布或更新 Web Console 与控制服务器
```

#### 3. Android Agent 构建与安装

环境要求：JDK 17+、Android SDK Platform 36、Build Tools 36.0.0+、ADB（固定采用 AGP 9.2.x / Gradle 9.4.1）。

```bash
./phoneweave android-build    # 构建 Debug APK
./phoneweave android-install  # 安装至已连接的 USB/ADB 设备
```

#### 4. 手机端初始化配置

打开手机上的 PhoneWeave Agent 应用：
1. 填写 `Server URL`（例如 `https://pw.example.com` 或内网 `http://192.168.1.10:8787`）。
2. 填写 `Device ID`（例如 `pixel-001`）。
3. 填写 `Device Token`（需与服务端 `.env` 中的 `PHONEWEAVE_DEVICE_TOKEN` 一致）。
4. 点击 **Enable Accessibility**，开启 PhoneWeave 无障碍服务。
5. 点击 **Start Agent**。
6. （可选）如需实时视频流，点击 **Enable Live Screen** 并确认 Android 系统的屏幕录制授权。

#### 5. 人工远控与 Web Console

浏览器访问控制台：

```text
https://pw.example.com/
```

使用 `.env` 中的 `WEB_TOKEN` 登录（基于安全 HttpOnly Cookie 管理会话）：
- **Take Over**：抢占人工控制权。
- **Start Live**：启动 WebRTC 实时高清屏幕流。
- **Snapshot 模式**：未授权屏幕录制时自动降级为截图模式，仍支持点击与拖动手势。
- **手势控制**：鼠标点击映射为 Tap，拖动映射为 Swipe，支持 Back / Home / Recents 物理按键。
- **文件分块传输**：直接上传文件至手机的 `Downloads/PhoneWeave` 目录。

#### 6. AI Agent 的 MCP 集成

```bash
export PHONEWEAVE_BASE_URL=http://localhost:8787
export PHONEWEAVE_ADMIN_TOKEN=change-me-admin
./phoneweave mcp
```

MCP stdio server 暴露以下工具集：
`phoneweave_list_devices`、`phoneweave_device_status`、`phoneweave_tap`、`phoneweave_swipe`、`phoneweave_input_text`、`phoneweave_back`、`phoneweave_home`、`phoneweave_launch_app`、`phoneweave_ui_tree`、`phoneweave_screenshot`、`phoneweave_release_agent`。

---

### 关键工程原则

1. **一个动作只实现一次**：Human、REST、MCP 均进入统一的 `ControlEngine`，不同传输层不重复实现手势逻辑。
2. **画面与控制严格解耦**：控制指令通过独立的 WebSocket 传输，视频流卡顿或丢包绝不阻塞控制指令。
3. **Latest State Wins**：远程桌面优先保证“当前画面”的实时性，不积压过期历史帧。
4. **Human 永远可以抢占 Agent**：通过租约仲裁与 Fencing Token 保证人工介入的最高优先级：
   ```text
   FREE → AGENT → HUMAN
            ↑       │
            └───────┘ release
   ```
5. **画面失效 ≠ 设备失联**：即使 MediaProjection 权限失效，只要 Accessibility 与 Agent 连接在线，依然可以通过 UI Tree、截屏与手势完成救援。

### 安全边界

PhoneWeave 面向使用者拥有或明确授权管理的设备：
- Device Token 与 Admin Token 严格隔离。
- Android 设备仅发起 outbound 外发连接。
- 人工接管拥有显式租约保护，控制动作通过 Fencing Token 校验。
- 不提供隐藏 Root、指纹伪造或绕过应用完整性检测等侵入式能力。
- 生产环境请务必置于 TLS 反向代理后，并修改所有默认凭据。

### 开源许可证

本项目基于 **Apache-2.0** 许可证开源。
