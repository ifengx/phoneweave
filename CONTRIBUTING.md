# Contributing to PhoneWeave

## Design rules

1. Keep `ControlEngine` transport-agnostic.
2. Do not duplicate Android actions in REST, MCP or Web UI adapters.
3. Keep realtime media independent from control messages.
4. Preserve control lease and fencing-token semantics.
5. Do not copy AGPL source into the Apache-2.0 tree without an explicit project-level license decision.
6. New privileged capabilities must document why they are required and what user-visible authorization protects them.

## Local checks

```bash
./phoneweave smoke
```

Before a pull request that changes Android code, also run:

```bash
./phoneweave android-build
```

## Commit scope suggestions

- `agent:` Android Agent
- `control:` action engine / lease protocol
- `rtc:` screen/WebRTC
- `server:` registry/signaling/API
- `web:` browser console
- `mcp:` MCP adapter
- `docs:` documentation
