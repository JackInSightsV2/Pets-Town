# Issue 40 implementation

Branch: `epic/chatgpt-office-40`.

## Scope and streams

- Server (primary): local stdio MCP server; reuse the observation bridge and exact directory scope; model-readable summaries plus a token-free embedded resource; protocol and isolation tests.
- UI (parallel): embedded entrypoint reusing the scene/store, native composer context, capability-detected modes, connection/empty/stale states, browser integration tests.
- Host investigation (parallel): verify supported plugin packaging/installation and actual host capabilities; inspect existing response transport.

## Coordination

Primary owns dependencies, build scripts, MCP server, shared integration types and plugin packaging. UI owns `src/chatgpt/ui/` and associated browser tests. Host investigation is read-only. Keep existing standalone office entrypoints and CSS behavior intact.

## Acceptance boundaries

Protocol tests and a simulated MCP host establish implementation behavior, not actual ChatGPT acceptance. Record real local observation separately. Verify installation and actual host rendering before declaring #42–#44 complete. #45 requires #7's supported response transport; no fabricated reply implementation or inferred approvals.
