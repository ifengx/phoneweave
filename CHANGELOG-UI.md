# PhoneWeave v0.2 UI Preview

- Replaced zero-build Web Console with React + Vite + Tailwind CSS v4 structure.
- Added Shadcn/ui `new-york` configuration and reusable UI primitives.
- Added dark-first remote control dashboard: sidebar, device rail, canvas, telemetry drawer and Cmd+K palette.
- Added VS Code full-stack UI debug configuration.
- Added Web dev/build scripts and production Docker multi-stage Web build.
- Migrated Android setup surface to Jetpack Compose + Material Design 3.
- Added `docs/UI_UX_SPEC.md` with visual tokens, layout rules and Figma construction guidance.

## v0.2.3 - VS Code Vite lifecycle fix

- Replaced detached `nohup` Vite startup with a VS Code-managed background task.
- Added deterministic `WEB_DEV_STARTING` / `WEB_DEV_READY` markers and a background problem matcher.
- Browser debug waits until Vite is reachable before opening `127.0.0.1:5173`.
- Avoids VS Code reaping the Vite child process after a preLaunch task exits.
