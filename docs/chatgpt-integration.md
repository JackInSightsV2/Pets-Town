# PetsTown inside ChatGPT

Issue #40 has a local, read-only MCP implementation on `epic/chatgpt-office-40`. It shares the existing observer and scene with the standalone browser office. The embedded UI uses the MCP Apps host bridge; it makes no localhost network requests and starts no agents.

## Build and install on the local desktop

From the repository root, with the Node version required by `package.json`:

```sh
npm ci
npm run build:chatgpt
npm run package:chatgpt -- --project /absolute/path/to/project
codex plugin marketplace add /absolute/path/to/PetsTown
codex plugin add petstown@petstown-local --json
codex plugin list --marketplace petstown-local --json
npm run check:chatgpt:plugin
```

Repeat `--project` for each explicitly allowed directory. Matching is exact, including normalization; parents do not include children. The generated `plugins/petstown/.mcp.json` pins those directories and invokes `node` from the host PATH. It is machine-specific and ignored by Git. Set `PETSTOWN_METADATA_SOCKET` during packaging only if the existing daemon uses a nondefault socket. macOS uses the existing Unix Codex control socket. Windows reads existing session logs under `CODEX_HOME/sessions`, or the current user’s `.codex/sessions` directory. It does not attach to or take over a Windows stdio runtime. Set `PETSTOWN_ROLLOUT_ROOT` or `PETSTOWN_ROLLOUT_FILES` when packaging to select an explicit log source on either platform. Historical logs establish identity only; fresh lifecycle records establish observed work state.

The compatibility manifest is `.codex-plugin/plugin.json`, pointing to `.mcp.json`. Do not add a portable root `plugin.json`: Desktop 26.1027 recognises its identity but shadows the compatibility MCP declaration, reporting zero servers. The discovery check above exercises the running desktop and catches this failure; a direct SDK smoke test does not.

The generated package contains the bundled server and self-contained office HTML. It runs from the installed plugin cache without dependencies on repository source paths. The genuine pet sprites load from their approved OpenAI CDN URLs. A CDN failure keeps the asset failure explicit.

In a **new local ChatGPT conversation**, select `@petstown` and ask **“Show my team.”** If the plugin is absent from the selector, restart the app when convenient, then open a new conversation. This implementation does not claim web-host access to the local machine. It does not publish a public endpoint.

After code changes, rebuild, package and run `codex plugin add` again. Verify the installed copy matches the new bundle, then use a new conversation. Running threads may retain their old plugin connection. Avoid restarting active work just to reload the plugin.

Build/package on each target machine so the explicit project directory allowlist matches that machine. In Windows PowerShell, use `npm run package:chatgpt -- --project $PWD.Path`. Node.js must be on the desktop host's PATH. The server/UI code is shared across platforms; the generated local configuration remains machine-specific. Platform CI exercises both macOS and Windows, but CI fixtures do not establish live Windows desktop acceptance.

## Experience

- `show_office` renders the team; optional stable `agentId` and `projectId` select or narrow the view.
- Selecting a pet shares bounded observed context through the native host bridge. “Ask about this pet” sends an explicit read-only question to the existing composer.
- `inspect_agent` refreshes the selected identity's task, activity and request facts without remounting the office.
- `refresh_office` is app-only and polls while the view is visible. A scope change invalidates an older view instead of crossing into the new scope.
- Inline, fullscreen and picture-in-picture controls appear according to host capabilities. Theme, reduced motion and safe insets are respected.
- Agent selection and presentation stay local to each rendered view. The server stores no shared selected-agent state.

The current metadata observer provides identities, runtime status and explicitly active goals. It does not supply item activity, handoffs or request details. Those limitations are returned to the model; the UI does not invent them. The full scene can render those observations when supplied by the shared contract, but that is not live evidence of support in this source.

Replies remain disabled because #7 has no verified request-response transport. A composer question, successful tool call or link to Codex is not an approval or completed request. #45 and full #40 acceptance remain open.

## Verification

```sh
npm run typecheck
npm test
npm run build
npm run test:chatgpt:browser
```

Server tests use the actual MCP client/server protocol to check tools, resources, scope isolation, control-token removal, updates and stale-scope rejection. Browser tests simulate an MCP Apps host and exercise the compiled UI; they are separate from actual ChatGPT acceptance. The existing standalone browser tests keep their original configuration.

See [host evidence](chatgpt-host-evidence.md) for installed-package verification, actual local observations and remaining host checks.
