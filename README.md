# PetsTown

A local ChatGPT plugin that shows your existing Codex agents as pets in a live office inside your conversation. Select **`@petstown`** and ask **“Show my team.”** Select a pet to inspect its observed task and activity.

**Version 0.1.4:** a local, read-only office for existing Codex agents, available in a standalone browser or through a locally installed plugin. macOS observes an existing Unix daemon; Windows automatically reads existing session logs. Supported sources can supply activity, handoffs and turn lifecycle observations. Availability depends on your runtime and source; request replies remain unavailable. See [delivery status](docs/delivery-status.md) for verification limits.

![PetsTown office environment](assets/office/office-v1.png)

## Install the ChatGPT plugin

Build and install the plugin on the computer where you use ChatGPT. You need a compatible local ChatGPT desktop host, Git, Node.js **22.12.0 or later** with npm, and the `codex` CLI. Node.js and Codex must be on your PATH. Internet access is required for dependencies and the official pet sprites.

```sh
git clone https://github.com/JackInSightsV2/Pets-Town.git
cd Pets-Town
npm ci
npm run build:chatgpt
npm run package:chatgpt -- --project /absolute/path/to/your-project
codex plugin marketplace add /absolute/path/to/Pets-Town
codex plugin add petstown@petstown-local --json
codex plugin list --marketplace petstown-local --json
npm run check:chatgpt:plugin
```

Replace the project path with the exact working directory of your existing Codex sessions, and the marketplace path with the repository you cloned. Repeat `--project` for multiple projects; parent directories do not include their children. On Windows, use quoted paths such as `"C:/Users/you/projects/my-project"` and `"C:/Users/you/Pets-Town"`.

Packaging writes a machine-specific, Git-ignored project configuration. Set any custom socket or rollout environment variables before packaging. Build and package separately on each computer.

### Use it in ChatGPT

1. Open a **new local ChatGPT conversation**.
2. Select **`@petstown`** from the plugin selector.
3. Ask **“Show my team.”**
4. Select a pet to inspect its observed context.

The desktop host starts the installed plugin server when needed. You do not need to run `npm run office` or keep a browser bridge open. Start your Codex work separately; the plugin observes existing sessions in the projects you configured.

If the plugin is missing, check the installation with the commands above, restart the app when convenient, and open a new conversation. If the office is empty, confirm your sessions use the exact directories supplied to `--project`. The current integration runs locally; web-hosted access to your computer is not provided. Live Windows desktop acceptance remains an open verification item.

### Update the plugin

Preserve or commit local changes, then run from a clean checkout:

```sh
git pull --ff-only
npm ci
npm run build:chatgpt
npm run package:chatgpt -- --project /absolute/path/to/your-project
codex plugin add petstown@petstown-local --json
npm run check:chatgpt:plugin
```

Use your actual project paths again. Open a new conversation after reinstalling; running conversations may retain the old plugin connection. See the [desktop integration guide](docs/chatgpt-integration.md) for host requirements and source configuration.

## Optional: install the standalone browser office

The standalone browser office is available for development and previews. These steps are optional and are not required for the ChatGPT plugin.

### Requirements

- Git.
- Node.js **22.12.0 or later**, with npm. Check with `node --version` and `npm --version`.
- System `curl` on your PATH, used to download the official pet artwork. Check with `curl --version` (use `curl.exe --version` in Windows PowerShell).
- Internet access for npm dependencies and the pet asset download.
- A modern browser. To observe real work, you also need existing local Codex sessions; PetsTown does not create agents.

The browser office and synthetic preview run on Windows, macOS and Linux. On macOS/Linux the default live observer requires an existing Unix Codex daemon control socket. Windows automatically selects the session-log observer. Explicit rollout settings select session logs on either platform.

### Download and build

Run these commands in a terminal (PowerShell, bash or zsh):

```sh
git clone https://github.com/JackInSightsV2/Pets-Town.git
cd Pets-Town
npm ci
npm run pets:fetch
npm run build
```

The asset command caches three official pet sprite sheets in `.cache/pets`. Keep that cache local; do not commit or redistribute it. If the download fails, check system curl, network access and certificates. The app can fall back to the official CDN when the cache is missing.

## Run the standalone browser office

All commands below run from the cloned repository directory containing `package.json`.

### Try the office without Codex

```sh
npm run office -- --fixture
```

This opens a clearly labelled **synthetic development office** at [http://127.0.0.1:4317](http://127.0.0.1:4317). It is useful for trying the UI without a running Codex session; the pets and activity in this mode are fixture data.

Keep the terminal open while using the office. Press **Ctrl+C** to stop the bridge started by that terminal. Stop the fixture bridge before switching to live observation on the same port.

### Observe existing Codex sessions on macOS or Linux

Start your Codex work separately, then tell PetsTown which project directories to observe:

```sh
PETSTOWN_METADATA_CWDS='["/absolute/path/to/your-project"]' npm run office
```

Replace the example with the absolute working directory used by your Codex session. To watch several projects, include each directory in the JSON array:

```sh
PETSTOWN_METADATA_CWDS='["/absolute/path/project-a","/absolute/path/project-b"]' npm run office
```

Matching is exact after path normalization: listing a parent directory does not include its children. Without this setting, `npm run office` observes only its current working directory, normally the PetsTown repository.

The default observer connects to an **already running** local daemon at `$CODEX_HOME/app-server-control/app-server-control.sock`, or `~/.codex/app-server-control/app-server-control.sock` when `CODEX_HOME` is unset. Set `PETSTOWN_METADATA_SOCKET` to use another existing absolute Unix socket. A Codex installation without this endpoint cannot use this transport.

The observer shows loaded identities, runtime status and explicitly active goals when available. The macOS composition also attempts verified handoff and turn-lifecycle history readers. Unsupported sources retain their reported limitations; request replies remain unavailable. Connection failures appear in the office; the launcher never silently substitutes fixture data.

### Observe existing session logs on Windows

Windows automatically uses the included read-only session-log observer. It reads `CODEX_HOME/sessions`, or your user profile’s `.codex/sessions` directory by default. In PowerShell:

```powershell
$env:PETSTOWN_METADATA_CWDS = '["C:/path/to/your-project"]'
npm run office
```

Replace the project path with your actual Codex working directory. Forward slashes in JSON Windows paths avoid backslash escaping. To select a different log directory, set `$env:PETSTOWN_ROLLOUT_ROOT = "C:/path/to/sessions"` before launching.

For a few specific logs instead of directory discovery, set `PETSTOWN_ROLLOUT_FILES` to a JSON array of absolute session-log paths:

```powershell
Remove-Item Env:PETSTOWN_ROLLOUT_ROOT -ErrorAction SilentlyContinue
$env:PETSTOWN_ROLLOUT_FILES = '["C:/path/to/rollout-session.jsonl"]'
npm run office
```

Logs describe recorded lifecycle events. Historical records alone do not establish current activity; new lifecycle records are required to confirm active work. Discovery is bounded and does not follow directory links. Invalid, replaced or conflicting identity metadata quarantines a file for the reader's lifetime; restart the observer to retry it. Restart is also required after the cumulative discovery limit of 1,000 tracked paths is reached. A missing discovery root is reported as disconnected.

PowerShell environment variables persist in that terminal. Clear settings you no longer want with `Remove-Item Env:VARIABLE_NAME` or use a fresh terminal.

### Launch options

```sh
npm run office -- --port 4318
npm run office -- --no-open
npm run office -- --adapter ./path/to/adapter.ts
```

| Option | Purpose |
| --- | --- |
| `--port <1–65535>` | Select a port; defaults to `PETSTOWN_PORT` or `4317`. |
| `--no-open` | Start the bridge without opening a browser; visit its printed URL manually. |
| `--fixture` | Show synthetic development data. |
| `--adapter <module>` | Load a custom observation adapter; defaults to `PETSTOWN_ADAPTER_MODULE` when set. |

Fixture and adapter modes cannot be combined. Custom modules must export the [adapter contract](docs/track-c.md#adapter-integration).

Repeated normal launches can reuse a recognized built-in bridge with matching platform, project scope and socket identity. Matching fixture launches reuse their bridge without replaying the trace. Explicit adapter launches and older bridges with unverified identity refuse automatic reuse: reopen their known URL, stop their original terminal, or choose another port. The launcher preserves existing processes.

### Troubleshooting

| Problem | What to check |
| --- | --- |
| Empty office | Confirm your Codex session exists and its exact working directory appears in `PETSTOWN_METADATA_CWDS`. |
| Disconnected or unsupported observer | Check the connection message. On Windows, check that the session-log directory exists and contains your sessions. On macOS/Linux, verify that the existing daemon socket is available, or configure a rollout source. |
| Port occupied or bridge cannot be reused | Reopen the existing office URL, stop its original terminal, or add `--port 4318`. |
| Browser does not open | Add `--no-open` and open the URL printed in the terminal. |
| Missing build or stale UI | Run `npm run build` again after source changes. |
| Pet download fails | Check `curl`, network access and certificates, then retry `npm run pets:fetch`. |
| Fixture mode conflicts with adapter mode | Clear `PETSTOWN_ADAPTER_MODULE` in your terminal before launching with `--fixture`. |

## Update the standalone browser office

Stop the bridge, then update a clean checkout:

```sh
git pull --ff-only
npm ci
npm run pets:fetch
npm run build
```

Launch again using your preferred mode. Preserve or commit local changes before updating.

## Development

For UI development with Vite and the bridge together:

```sh
npm run dev:all
```

Use the Vite URL printed in the terminal. Combined development requires bridge port 4317; stop an existing bridge on that port first. Add `--fixture` for synthetic data or `--adapter ./path/to/adapter.ts` for a custom observer.

Codex CLI can discover the repository-local `$office` skill through `/skills`; installing a global plugin is not required for the terminal commands above.

## Checks

```sh
npm run typecheck
npm test
```

Targeted browser checks are available through `npm run test:e2e -- tests/browser/inspection.spec.ts` once the Playwright browser is installed. Fixture/unit/browser checks do not satisfy the real-agent evidence required by [#3](https://github.com/JackInSightsV2/Pets-Town/issues/3) or the target-Mac rehearsal in [#6](https://github.com/JackInSightsV2/Pets-Town/issues/6).

## Start here

1. Read the [delivery plan](plan.md), [design](design.md) and [shared event contract](docs/contracts/office-v1.md).
2. Claim [#1: Show one existing agent as a genuine pet](https://github.com/JackInSightsV2/Pets-Town/issues/1). The Codex integration lead owns it, with the other two teammates contributing the minimum scene and launcher.
3. Once #1 passes, work on the three independent slices below in parallel.

| Teammate lane | First parallel slice | Next responsibility |
| --- | --- | --- |
| A — Office visuals | [#2: Arrivals, standup and work locations](https://github.com/JackInSightsV2/Pets-Town/issues/2) | [#5: Project areas and subagent visibility](https://github.com/JackInSightsV2/Pets-Town/issues/5) |
| B — Codex integration | [#4: Real water-cooler handoff](https://github.com/JackInSightsV2/Pets-Town/issues/4) | [#7: In-office replies](https://github.com/JackInSightsV2/Pets-Town/issues/7) |
| C — App and demo | [#3: Live pet inspection](https://github.com/JackInSightsV2/Pets-Town/issues/3) | [#6: Integrated 90-second demo](https://github.com/JackInSightsV2/Pets-Town/issues/6) |

Then consider [#8: Voice](https://github.com/JackInSightsV2/Pets-Town/issues/8) and [#9: Live computer view](https://github.com/JackInSightsV2/Pets-Town/issues/9) in the approved checkpoint order.

## Working together

- Assign yourself to your issue before starting. Owner-lane labels identify responsibility; individual assignees have not been guessed.
- Work in an issue branch from current main and keep each pull request focused on its vertical slice.
- Native GitHub blocked-by relationships specify delivery order. Read the acceptance criteria before implementing.
- Lane C coordinates shared entrypoints and package changes. Agree contract changes before producer and consumer diverge.
- Start the day controls presentation only. Existing agents keep ownership of their execution.
- Fixtures are development tools; live acceptance needs real agent evidence. Generated replacement pet characters do not satisfy the asset requirement.

## Project material

- [All issues](https://github.com/JackInSightsV2/Pets-Town/issues)
- [Issue and dependency mapping](.claude/epics/petstown-hackathon/github-mapping.md)
- [PRD and user stories](.claude/prds/petstown-hackathon.md)
- [Technical epic and acceptance criteria](.claude/epics/petstown-hackathon/epic.md)
- [Office mapping and environment coordinates](docs/office-mapping.md)
- [Glossary](GLOSSARY.md)
- [Integration evidence and remaining checks](docs/integration-notes.md)
- [Office image prompt and provenance](assets/office/office-v1.prompt.md)

The app references three genuine built-in pet sprite sheets through the official asset URLs in [the pet manifest](src/shared/pets.ts), with a local download cache for reliable rendering. Local plugin packaging is available; full live office acceptance, voice and live computer view are not claimed complete. See [desktop integration](docs/chatgpt-integration.md) and [delivery status](docs/delivery-status.md).
