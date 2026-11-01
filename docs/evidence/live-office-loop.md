# Live office movement checkpoint — 2026-11-01

This checkpoint observes existing Codex agents; it does not create or control them.

## Run

From the integration checkout, after `npm ci` and `npm run build`:

```sh
PETSTOWN_METADATA_CWDS='["/Users/jackinsights/Coding/PetsTown","/Users/jackinsights/Coding/PetsTown-track-c"]' npm run office -- --adapter ./src/codex/live-handoff-adapter.ts --port 4320
```

Use your actual absolute project directories. This explicit adapter requires the existing Mac Unix daemon reporting Codex 0.166.0. The default metadata-only office remains available. A reader disconnect requires reopening this bridge; no agent is restarted.

## Observed

- Source `codex`, four existing agents, connected metadata and supported handoff observation.
- Browser opened the real bridge, started/skipped the presentation, and showed subagents.
- An actual work message to a reviewing agent appeared as a new source-correlated handoff.
- Two pets acquired the water-cooler location, displayed “Sent a message.”, and returned after the meeting. No browser page errors.
- Screenshot: [real handoff](track-c-real-handoff.png).
- The [version-matched source audit](codex-0166-handoff-source.md) establishes accepted message delivery, not recipient consumption or work completion.

## Not yet complete

Sending instructions/replies from the office is unsupported. Real pending-request observation/resolution is not established. This does not prove the full 90-second team rehearsal, automatic reader reconnect, every activity-to-location transition, or Elliot's final environment integration. Issues #3 and #6 remain open.
