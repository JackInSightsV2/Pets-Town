---
name: office
description: Launch or reopen this repository's PetsTown office for existing Codex agents, or an explicitly requested development preview.
---

# Open PetsTown

Use the repository's existing launcher. This is an observation UI: never create, resume, assign, or stop Codex agents. Start the day controls presentation only.

1. Work from the repository root containing [package.json](../../../package.json) and [scripts/office.ts](../../../scripts/office.ts). Resolve it from this skill's location if the current directory differs. Check the requested port (default 4317, or `PETSTOWN_PORT`) at `/api/health` and `/api/office` before launching. Keep the snapshot's `controlToken` private.
2. Choose the requested mode. Normal launch is observation mode. Add `--fixture` only when the user explicitly requests a synthetic development preview. An existing fixture bridge does not authorize silently substituting fixture data for a live request. Preserve running services; use another free port when their mode or adapter differs.
3. Reuse a recognized bridge when its mode matches and no different adapter was requested. The launcher verifies service/protocol/mode. If a specific adapter was requested, reuse only when this session already established that exact process's adapter identity; otherwise start on a free port because the launcher deliberately rejects uncertain explicit-adapter reuse. Do not kill the existing preview. A `codex` source label alone does not prove that a live observer is connected; check `connection` and `capabilities` in the snapshot.
4. For a new bridge, prepare only missing or stale prerequisites: supported Node from `package.json`; `npm ci` if dependencies are absent or the lockfile changed since installation; `npm run build` if `dist/index.html` is absent or source/configuration is newer than the build; `npm run pets:fetch` if any known `.cache/pets/{codex,dewey,hoots}.webp` file is absent. The fetch script downloads official assets with certificate verification. A fetch failure must be reported; retain the honest CDN fallback and do not substitute artwork. Reuse a healthy bridge without rebuilding or reinstalling.
5. Launch using the relevant command below in a managed terminal that remains available for the foreground bridge process. The launcher opens the browser by default; add `--no-open` only when appropriate for the environment or explicitly requested. Do not detach an untracked daemon.

```sh
npm run office
npm run office -- --fixture
npm run office -- --adapter ./path/to/observed-runtime-adapter.ts --port 4318
```

`PETSTOWN_ADAPTER_MODULE` also selects an adapter. Use a supplied, existing compatible observation adapter; do not invent an adapter module or start agents to populate the office. With no adapter configured, opening the normal office is still useful, but explicitly report that it is an empty unsupported observation view. Replies remain unavailable unless the product's verified capability says otherwise.

When reopening an already verified bridge with an adapter environment variable set, invoke the launcher with that variable unset **for that command only** and the matching mode/port; this avoids requesting an unverifiable adapter reload. Do this only to reuse the existing bridge, not to change the user's configured adapter for a new process.

Finish after `/api/health` identifies `petstown-office` and `/api/office` confirms the actual source and connection state. Report the URL, live/fixture/unsupported status, and whether the browser was actually opened. Opening a page is not proof of visual rendering or live Codex observation.

This repository-local skill is intended for `$office` or discovery through `/skills` in Codex CLI. Do not promise registration of a bare `/office` command or install global configuration.
