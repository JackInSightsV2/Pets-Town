# ChatGPT host integration evidence — issue #40

Observed on 2026-11-01. This record separates supported packaging, installed state, protocol checks and actual host acceptance.

## Host and access boundary

- `/Applications/ChatGPT.app` is installed: version **26.1027.30824**, build **22943** (read from its `Info.plist`).
- Computer Use inventory reported ChatGPT running with bundle ID `com.openai.codex`.
- Browser inventory returned no usable browser host and reported: `The browser access host is unavailable`.
- Selecting the native app through Computer Use returned: `Computer Use is not allowed to use the app 'com.openai.codex' for safety reasons.` No attempt was made to bypass this boundary.
- These observations do not prove that this host renders the new PetsTown UI. Actual plugin invocation and visual acceptance remain separate checks.

## Supported local route

The [official packaging guide](https://developers.openai.com/plugins/build/plugins) documents repository marketplaces at `.agents/plugins/marketplace.json`, with plugin sources resolved relative to the repository root. A plugin at `plugins/petstown` is referenced with `source.path: "./plugins/petstown"`.

New portable packages use root `plugin.json` and root `mcp.json`. The legacy `.mcp.json` format remains supported but is not the canonical portable format. The portable MCP file declares `$schema: "https://agent-plugins.org/schemas/1.0.0/mcp.schema.json"` and a `type` for each server.

The [desktop-only plugin guide](https://developers.openai.com/plugins/deploy/desktop-only) documents local stdio servers with `${PLUGIN_ROOT}` paths. A bundled server can be configured as:

```json
{
  "$schema": "https://agent-plugins.org/schemas/1.0.0/mcp.schema.json",
  "mcpServers": {
    "petstown": {
      "type": "stdio",
      "command": "node",
      "args": ["${PLUGIN_ROOT}/server.mjs"],
      "cwd": "${PLUGIN_ROOT}",
      "env": {
        "PETSTOWN_METADATA_CWDS": "[\"/absolute/path/to/project\"]"
      }
    }
  }
}
```

The published [Agent Plugins MCP schema](https://agent-plugins.org/schemas/1.0.0/mcp.schema.json) confirms that stdio `env` is a string-valued map. The project path above is illustrative and must be generated from the user's explicitly selected project scope. Do not use the installed plugin cache directory as the observer scope. Include the server, UI and dependencies in the package so cached installation does not depend on paths outside the package.

A local stdio transport avoids publishing the observer or an unauthenticated loopback proxy on the internet. This does not imply that arbitrary ChatGPT web sessions can access the local machine. Public distribution of desktop-only MCP plugins has a separate partner approval requirement; local development installation is the immediate target.

## Installation and refresh checks

Read-only CLI checks established these current commands:

```sh
codex plugin marketplace list
codex plugin add petstown@petstown-local --json
codex plugin list --marketplace petstown-local --json
```

The repository marketplace was registered with `codex plugin marketplace add`, then `codex plugin add petstown@petstown-local --json` installed version **0.1.0**. `codex plugin list --marketplace petstown-local --json` reports `installed: true` and `enabled: true`.

The installed copy is `~/.codex/plugins/cache/petstown-local/petstown/0.1.0/`. SHA-256 comparisons confirmed that its manifest, generated MCP configuration, server bundle and HTML match the final packaged files. An MCP SDK client launched that installed server, initialized it, discovered all three tools, called `show_office` and read the HTML resource. It returned **six real Codex agents**, a connected metadata source at **2026-11-01T15:35:18.479Z**, and no control token. This is installed-package protocol evidence, not an in-chat UI invocation.

This installation uses the versioned cache path above. Some unversioned local packages use a `local/` cache directory. The official guide says to update the source package and restart ChatGPT for local changes to be picked up. `codex plugin marketplace upgrade --help` specifically describes refreshing Git marketplace snapshots; it is not evidence of a local-package hot reload.

The [connection/testing guide](https://developers.openai.com/plugins/deploy/connect-chatgpt) instructs testing the installed plugin in a **new conversation**. Loading new tools into this already-running conversation without a restart or refresh has not been established. Do not restart the user's active app merely to turn pending validation into a success claim.

## UI protocol contract

[Add UI to your MCP server](https://developers.openai.com/plugins/build/chatgpt-ui) specifies:

- Link a rendering tool through `_meta.ui.resourceUri`.
- Return an HTML resource with MIME `text/html;profile=mcp-app`.
- Initialize through the MCP Apps bridge and receive `ui/notifications/tool-result`.
- Use `tools/call` for widget actions and `ui/update-model-context` for bounded model-visible selection context.
- Keep tools useful as structured/text results when the client does not render UI.

The [component bridge reference](https://developers.openai.com/plugins/reference) documents optional `window.openai.requestDisplayMode` and synchronous widget-scoped `setWidgetState`. Feature-detect optional APIs. Advertised display modes are not proof that the running host supports or accepted each mode. Verify inline, expanded and picture-in-picture presentations separately.

## Reply capability remains unsupported

The existing code at the start of this branch does not implement #7's response ownership route:

- `src/server/server.ts` forces `respondToRequests` to unsupported and applies that limitation to pending requests.
- Request response endpoints under `/api/requests/` return HTTP 501.
- `src/codex/metadata-adapter.ts` explicitly says metadata cannot read or answer requests.
- `src/server/server.test.ts` checks that even an adapter advertising replies cannot enable them through the current bridge.

Therefore an MCP wrapper alone cannot satisfy #45's real reply requirement. Keep reply controls unavailable with the factual reason until a supported, correlated response transport is implemented and verified. Successful tool submission, a composer message or a link to the original conversation is not observed request resolution.

## Remaining acceptance evidence

- [x] Install the built local package and verify the installed copy and tool/resource discovery.
- [ ] Invoke Show my team in a new supported local ChatGPT conversation.
- [ ] Observe a real agent state change in the embedded UI, with explicit project scope.
- [ ] Select a pet and verify a factual follow-up through the native composer.
- [ ] Inspect supported display modes, theme, resize and keyboard behaviour in the actual host.
- [ ] Record unavailable modes/capabilities without substituting browser-only or fixture evidence.
- [ ] Implement and verify the upstream #7 response route before claiming #45 or full #40 completion.

## Automated validation

- TypeScript check and the standalone Vite build passed.
- 96 unit/protocol tests passed, including three new MCP/scope boundary checks.
- Six simulated-host browser checks passed: selection/context/question, display modes, refresh recovery, narrow dark keyboard/overflow, disappearing selection, and delayed refresh isolation across both changed and unchanged scope. No localhost requests leave the embedded iframe.
- Five existing standalone office inspection browser checks passed. An initial run encountered an occupied test port; the port was free on read-only inspection and the subsequent isolated run passed. No existing process was stopped.
- The narrow dark screenshot was inspected visually. This uses synthetic data and is not actual ChatGPT visual evidence.
- JEV remains disabled; its advisory review is unavailable.

The current conversation has no newly loaded PetsTown tools. A new local conversation is required for the next actual-host test; no app restart was performed.
