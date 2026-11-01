# Track C: 90-second demo runbook

This branch can show the browser office and a read-only preview of existing Codex agent metadata. Its separate fixture demonstrates activity, requests and handoffs synthetically. A full lane B adapter, real handoff evidence and a timed human rehearsal remain **unverified**. The interim walkthrough below demonstrates current progress; it is not the intended final live demo or a completed acceptance record.

## Evidence captured so far

The integration lead observed bridge 4319 change from the main agent working with three children idle to all four working after follow-up tasks. This verifies genuine native metadata transitions, not request resolution or handoff semantics. Build `62bc08b` passed and the browser check reported no JavaScript errors; PR #10 was updated. These observations do not establish a completed 90-second human rehearsal or full demo acceptance.

## Prepare before the clock

Use the repository root and Node.js 22.12 or later. Install dependencies on a fresh checkout or changed lockfile; build after source changes. Download the genuine official pet assets so the browser can use local files instead of relying on CDN access:

```sh
npm ci
npm run pets:fetch
npm run build
```

Do not repeat installation on every launch. `pets:fetch` requires network access and system `curl` with working certificate verification. It writes only the known official assets to `.cache/pets`. Keep bridge terminals open.

The live metadata preview additionally requires an **already running** local Codex daemon and existing agents in the allowed PetsTown working directories. It does not start or resume agents:

```sh
npm run office -- --adapter ./tests/manual/codex-metadata-adapter.ts --port 4319
```

Default socket: `$CODEX_HOME/app-server-control/app-server-control.sock`, or `~/.codex/app-server-control/app-server-control.sock` when `CODEX_HOME` is unset. `PETSTOWN_METADATA_SOCKET` can select an existing absolute Unix socket. `PETSTOWN_METADATA_CWDS` accepts a JSON array of absolute allowed working directories; defaults cover this checkout and its sibling `PetsTown` checkout. The adapter polls every two seconds and reports connection failures honestly. It exposes runtime status, identities and explicitly active goals when present; other task details, activity history, request details and handoffs are unavailable.

Confirm `http://127.0.0.1:4319` shows the expected agents and connection message before presenting. If it is empty or disconnected, explain that limitation; do not call the fixture live. A default `npm run office` without an adapter deliberately opens an unsupported empty office.

## Interim preview walkthrough (90 seconds)

| Time | Action and narration |
| --- | --- |
| 0–15s | Show the live metadata office on port 4319. Identify the connection status and existing pets: “This observes agents already running in Codex.” |
| 15–30s | Select a pet and show its identity, project and observed runtime state. Point out unavailable task/request details. Avoid claiming a state change unless it actually occurs. |
| 30–40s | Click **Start the day**, or **Reset scene** then **Start the day**. Explain that this changes presentation only; it sends no agent execution commands. |
| 40–60s | In a prepared second terminal, launch a **fresh** fixture using the command below. Announce “synthetic development trace.” Select Fixture child promptly to see its initial request; the fixture resolves it after six seconds. The trace then shows completion, idle, disconnection and reconnection. |
| 60–80s | Inspect activity and the request limitation. Use **Reset scene** and **Start the day** to replay presentation, or **Skip to live office** during the ceremony. Reset does not restart the fixture trace or clear unresolved source requests. |
| 80–90s | Return to the live metadata tab. State the remaining gate: full lane B event mapping, a real pending/resolved request and real handoff, then a timed target-Mac human rehearsal. |

Fresh fixture launch, using a free port separate from the live preview:

```sh
npm run office -- --fixture --port 4318
```

The fixture runs **once per bridge start**, independently of Start the day: activity at +2s, synthetic handoff +4s, request resolution +6s, completion +8s, idle +10s, disconnection +12s and reconnection +14s. If the initial request disappears before inspection, say that the trace advanced; do not claim that clicking cleared it. For a slower explanation, show the fixture's retained activity and explain the trace, or restart only its owned bridge before another attempt.

## Final live acceptance sequence (90 seconds maximum)

After lane A choreography and lane B observation integration, rehearse this sequence with the team against real existing agents: **Start the day → arrivals → standup → inspect a real outstanding request → observe a real handoff**. Complete it in at most 90 seconds, using genuine pets and source-correlated events. Verify that matching resolution from the original Codex client clears only the real request and that presentation controls never start or resume agents.

This is the intended integrated demo. The fixture segment in the interim walkthrough is development evidence only and cannot replace its real request or handoff. Acceptance requires A/B integration, the source evidence above and a timed team rehearsal on the target Mac; those gates remain open.

## Recovery

- **Refresh or reopen:** return to the existing URL. Presentation and current source state survive browser refresh while the bridge remains running. Repeating the same fixture command reuses a recognized fixture bridge; it does not restart its trace.
- **Replay presentation:** use Reset scene, then Start the day. Pending real requests remain until matching source resolution. Skip changes choreography only.
- **Replay the fixture trace:** Ctrl-C in the terminal that owns the fixture bridge, then rerun its fixture command. Leave the separate live preview and all Codex agents running.
- **Port occupied:** use another free `--port`. Explicit `--adapter` launches reject reuse because adapter identity cannot be verified; reopen the known live URL directly instead. Never terminate an unrelated service.
- **Missing sprites:** run `npm run pets:fetch`, then restart only the relevant owned bridge so its local allowlist is rebuilt. Report download failures; do not replace the official pets.
- **Lost Codex connection:** the metadata adapter retries on its next poll. Show disconnected/stale status and preserve the distinction from agent failure. Do not manufacture successful work or switch silently to fixture mode.

See [README](../README.md) for normal launch options and [Track C handoff](track-c.md) for the production adapter seam. No voice, live computer view, in-office reply capability, full live handoff acceptance or completed human rehearsal is claimed here.
