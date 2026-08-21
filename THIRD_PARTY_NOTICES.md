# Third-party notices

PhoneWeave is a clean, new implementation. The initial code in this repository does **not** copy source files from RustDesk or Android Remote Control MCP.

## Architectural research references

- RustDesk — AGPL-3.0. Studied for remote desktop architecture, Android MediaProjection lifecycle, P2P/relay concepts, QoS and human input flow. No RustDesk source code is incorporated into this repository.
- Android Remote Control MCP — MIT. Studied for Accessibility/UI-tree/MCP concepts. No upstream source code is incorporated into this initial repository.

## Runtime/build dependencies

Licenses remain with their respective projects. Important direct dependencies include:

- WebRTC Android prebuilt (`io.github.webrtc-sdk:android`) — BSD-3-Clause upstream WebRTC distribution.
- OkHttp — Apache-2.0.
- `ws` — MIT.
- Model Context Protocol TypeScript SDK — follow the package's distributed license.
- zod — MIT.
- coturn — BSD-3-Clause.

Before publishing a release, generate a dependency SBOM and verify exact notices for the pinned release versions.
