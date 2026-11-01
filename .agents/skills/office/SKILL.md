---
name: office
description: Launch or reopen this repository's PetsTown office for existing Codex agents, or an explicitly requested development preview.
---

# Open PetsTown

Use the repository's existing launcher. This is an observation UI: never create, resume, assign, or stop Codex agents. Start the day controls presentation only.

1. Work from the repository root containing [package.json](../../../package.json) and [scripts/office.ts](../../../scripts/office.ts). Resolve it from this skill's location if the current directory differs. Check the requested port (default 4317, or `PETSTOWN_PORT`) at `/api/health` and `/api/office` before launching. Keep the snapshot's `controlToken` private.
2. Choose the requested mode and scope. Normal launch attempts the built-in read-only observer against the existing local Codex daemon. Its default allowlist is the exact launch working directory (`process.cwd()`). For requested projects outside that directory, set `PETSTOWN_METADATA_CWDS` to a nonempty JSON array of their absolute directories; matching is exact after normalization, not recursive. An explicitly configured `--adapter` or `PETSTOWN_ADAPTER_MODULE` selects a custom observer instead. Add `--fixture` only for an explicitly requested synthetic preview; fixture and custom-adapter modes cannot be combined, so clear the adapter environment variable for that command only when selecting the requested fixture.
3. Let the launcher verify reuse. A normal launch reuses a recognized built-in bridge only when protocol, source and its platform/normalized-allowlist/socket identity match. Matching fixture launches reuse without restarting their trace. Explicit adapters and older bridges with unverifiable identity require a free port; reopen a known existing URL directly when this session already verified its mode and scope. Preserve running previews. A `codex` source label alone does not prove observation is connected; check `connection`, its message and `capabilities` in the snapshot.
4. For a new bridge, prepare only missing or stale prerequisites: supported Node from `package.json`; `npm ci` if dependencies are absent or the lockfile changed since installation; `npm run build` if `dist/index.html` is absent or source/configuration is newer than the build; `npm run pets:fetch` if any known `.cache/pets/{codex,dewey,hoots}.webp` file is absent. The fetch script downloads official assets with certificate verification. A fetch failure must be reported; retain the honest CDN fallback and do not substitute artwork. Reuse a healthy bridge without rebuilding or reinstalling.
5. Launch using the relevant command below in a managed terminal that remains available for the foreground bridge process. The launcher opens the browser by default; add `--no-open` only when appropriate for the environment or explicitly requested. Do not detach an untracked daemon.

```sh
npm run office
PETSTOWN_METADATA_CWDS='["/absolute/path/project-a","/absolute/path/project-b"]' npm run office
npm run office -- --fixture
npm run office -- --adapter ./path/to/observed-runtime-adapter.ts --port 4318
```

The default observer reads loaded identities, runtime status and explicitly active goals when available. Item activity, request details, handoffs and replies remain unavailable through metadata polling. An empty office can mean no loaded agents match the exact allowlist; a failed connection is shown as unavailable. Report the actual result instead of switching to a fixture.

The default endpoint is `$CODEX_HOME/app-server-control/app-server-control.sock`, or `~/.codex/app-server-control/app-server-control.sock` when `CODEX_HOME` is unset. `PETSTOWN_METADATA_SOCKET` selects another existing absolute Unix socket. This transport does not attach to the Windows desktop stdio server. Read [the launch reference](../../../README.md#run-the-app) when troubleshooting scope, socket or custom-adapter configuration.

Finish after `/api/health` identifies `petstown-office` and `/api/office` confirms the actual source and connection state. Report the URL, live/fixture/unsupported status, and whether the browser was actually opened. Opening a page is not proof of visual rendering or live Codex observation.

This repository-local skill is intended for `$office` or discovery through `/skills` in Codex CLI. Do not promise registration of a bare `/office` command or install global configuration.
