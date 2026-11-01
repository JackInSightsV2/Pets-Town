# Verification ledger

This ledger separates observed results from source inspection and planned acceptance checks. Research was gathered on 1 November 2026 and revised to the user-confirmed observer design.

| Claim | Verification | Result and limit |
| --- | --- | --- |
| Repository baseline | GitHub contents and complete recursive tree, independently repeated | Main `ddd4163bea84af84deb5af317498c7a2fa17867e`: 25 files, docs/office artwork, no app source or dependency manifest. Refresh main before implementing. |
| Repository write access | GitHub repository permissions | Pull, push and triage are true. Earlier empty/read-only statements are stale. |
| Issue ownership | GitHub profile plus add-assignee results | Authenticated account `getmateri`; #1, #4 and #7 assigned. #3 was already assigned to JackInSightsV2. Assignment is not implementation progress. |
| Local Git setup | Earlier successful shell commands | Origin points to Pets-Town; local main configured to track origin/main; fetch succeeded. It has not been freshly synchronized after the new remote baseline. |
| Windows tools | Earlier successful version checks | Git 2.52.0.windows.1; Node 24.13.0; npm 11.6.2; Codex 0.158.0. |
| Windows Codex login | Successful check outside restricted sandbox | Logged in using ChatGPT. An earlier sandboxed Not logged in result did not reflect the actual available login. |
| Installed protocol generation | Executed `codex app-server generate-ts` successfully | Generated 0.158.0 TypeScript schemas in a temporary directory; required method names independently inspected. These are protocol declarations, not live observation. |
| Initialization and state/approval types | Independent local schema reads; app-server help returned | JSONL/stdio default, initialization shape, state flags, lifecycle and response types inspected. No server handshake was executed. |
| Public source revision | GitHub commit API and pinned source reads | `67f0994b532b8740f14b5b738af7b7b2a915b1d6` exists; source commit time 2026-10-31T00:12:17Z. |
| Same-server status broadcasts | Independent source trace through status, outgoing sender and transport | A candidate passive route on the same daemon. No live cross-process coverage proved. |
| Pets atlas/layout | Independent native source, local plugin contract and exposed tool metadata | Standard v1/v2 dimensions and row counts corroborated. No genuine asset downloaded or browser-rendered in this preparation. |
| Launcher skill path | Official docs plus pinned source | `$office` and `/skills` path supported. No Office skill installed or invoked. |
| Demo Mac CLI 0.166.0 | Reported in existing [integration notes](../../integration-notes.md) | Not executed by this research run. Verify exact target version and daemon before building. |
| Contract gaps | Two independent readers of contract v1; SSE standard | Snapshot/stream cursor, exact payloads and replay/reset semantics need implementation decisions. |
| Host filesystem writes | Multiple reads/writes stalled; pending work was stopped | No local handoff or diagnostic file is counted as successfully saved or tested. Publication via GitHub is verified separately. |

## Live acceptance still required

- Observe an agent that was running before the office connected, without resuming or modifying it.
- Show a genuine pet asset with a real frame sequence in the browser.
- Capture a real state/activity change with stable source identity.
- Prove authentic handoff visibility with both participants and source correlation.
- Prove supported access/ownership before answering an existing request; include stale and original-client resolution cases.
- Confirm reconnect, refresh and presentation reset do not alter agent execution.
- Run the full 90-second sequence on the actual demo Mac.

A schema, source function, fixture, rendered image or successful HTTP response cannot substitute for these checks. Record a sanitized trace and tested revision for each live claim. Keep credentials, authentication responses and private conversation content out of committed evidence.

The earlier untested scripts and own-thread contract drafts are not part of this published pack. If they appear locally after a delayed tool completion, inspect and reconcile them before use.

## Teammate implementation observed during publication

[PR #10](https://github.com/JackInSightsV2/Pets-Town/pull/10), head `1df6a73a8913ebad336ab8c730bf480e18d4e04f`, adds executable scaffold and a concrete OfficeAdapter. The full added lines of adapter.ts, shared/contract.ts, server.ts, client/connection.ts, server/main.ts and docs/track-c.md were inspected. Its reported test/browser passes are the author's evidence, not rerun results from this preparation. The base-main no-app finding above remains true for that pinned earlier snapshot.
