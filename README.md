# PetsTown

A browser office for existing Codex agents, launched from Codex CLI. Genuine ChatGPT/Codex pets make observed agent state visible.

**Status:** the local bridge and browser office observe existing Codex agent metadata, show active goals when available, and support pet inspection, request tracking and handoff presentation. Normal launch attempts the built-in read-only observer. Live request and handoff observation and the timed target-Mac rehearsal remain acceptance gates; the app does not start Codex agents. See the [Track C handoff](docs/track-c.md) and [90-second demo runbook](docs/demo-runbook.md).

![PetsTown office environment](assets/office/office-v1.png)

## Run the app

Use Node.js 22.12 or later, from the repository root:

```sh
npm ci
npm run pets:fetch
npm run build
npm run office
```

Normal launch opens `http://127.0.0.1:4317` and attempts to observe an **already running** local Codex daemon. Its default scope is the exact current working directory, normally this repository root. It shows loaded agent identities, runtime status and explicitly active goals when available. Item activity, request details and handoffs are unavailable through metadata polling. Connection failures are displayed; the launcher never starts agents or silently substitutes fixture data.

Keep the terminal open; Ctrl-C stops only the bridge it owns. Install dependencies and build on a fresh checkout or after relevant changes, rather than on every launch.

Codex CLI can discover the repository-local `$office` skill through `/skills`.

To include several project directories, supply an explicit allowlist:

```sh
PETSTOWN_METADATA_CWDS='["/absolute/path/project-a","/absolute/path/project-b"]' npm run office
```

`PETSTOWN_METADATA_CWDS` is a nonempty JSON array of absolute directories. Matching is exact after path normalization; listing a parent does not include its child directories. The default control socket is `$CODEX_HOME/app-server-control/app-server-control.sock`, or `~/.codex/app-server-control/app-server-control.sock` when `CODEX_HOME` is unset. `PETSTOWN_METADATA_SOCKET` selects another existing absolute Unix socket. This transport cannot attach to the Windows desktop stdio server.

For an explicitly labelled **synthetic development office**:

```sh
npm run office -- --fixture --port 4318
```

Fixture activity is development evidence, not live Codex observation.

To connect a teammate's observation adapter:

```sh
npm run office -- --adapter ./path/to/adapter.ts
```

Replace the module path with a module exporting the [adapter contract](docs/track-c.md#adapter-integration). An explicit adapter, including one selected by `PETSTOWN_ADAPTER_MODULE`, replaces the built-in metadata observer.

Launcher options are `--fixture`, `--adapter <module>`, `--port <1–65535>` and `--no-open`. `PETSTOWN_PORT` and `PETSTOWN_ADAPTER_MODULE` provide defaults. Fixture and adapter modes cannot be combined. Repeated normal launches reuse only a recognized built-in bridge with matching platform, normalized directory allowlist and socket identity. Matching fixture launches reuse their bridge without replaying the trace. Explicit adapter launches and older bridges with unverified identity refuse automatic reuse; reopen their known URL or choose a free `--port`. Existing processes are preserved.

For UI development with Vite and the bridge together:

```sh
npm run dev:all
```

Use the Vite URL printed in the terminal. Combined development requires bridge port 4317; stop an existing bridge on that port first. Add `--fixture` for synthetic data or `--adapter ./path/to/adapter.ts` for a custom observer.

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

The app references three genuine built-in pet sprite sheets through the official asset URLs in [the pet manifest](src/shared/pets.ts), with a local download cache for reliable rendering. Plugin installation, full live office acceptance, voice and live computer view are not claimed complete.
