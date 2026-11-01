# PetsTown

A living office for existing Codex agents, launched from Codex CLI into a local browser. Genuine ChatGPT/Codex pets arrive, give a brief standup and reflect real work, requests and handoffs.

**Status:** this branch contains the local bridge, browser office, pet inspection panel, request tracking and development fixtures. The existing-agent adapter and live acceptance remain integration work; the app does not start Codex agents. See the [Track C handoff](docs/track-c.md).

![PetsTown office environment](assets/office/office-v1.png)

## Run the app

Use Node.js 22.12 or later, from the repository root:

```sh
npm ci
npm run build
npm run office -- --fixture
```

`--fixture` opens an explicitly labelled **synthetic development office**. It is not live Codex evidence. Keep the terminal open; Ctrl-C stops the bridge it owns. The default browser address is `http://127.0.0.1:4317`.

To connect a teammate's observation adapter:

```sh
npm run office -- --adapter ./path/to/adapter.ts
```

Replace the module path with a module exporting the [adapter contract](docs/track-c.md#adapter-integration). Without `--fixture` or `--adapter`, the app opens with an honest unsupported/empty source. No live adapter is selected automatically.

Launcher options are `--fixture`, `--adapter <module>`, `--port <1–65535>` and `--no-open`. `PETSTOWN_PORT` and `PETSTOWN_ADAPTER_MODULE` provide defaults. Fixture and adapter modes cannot be combined. Repeat fixture/default launches can reuse a matching bridge; an explicit adapter launch refuses an occupied office port because adapter identity cannot be verified. Use a free `--port` or stop the old bridge yourself.

For UI development with Vite and the bridge together:

```sh
npm run dev:all -- --fixture
```

Use the Vite URL printed in the terminal. Combined development requires bridge port 4317; stop an existing bridge on that port first. `npm run dev:all -- --adapter ./path/to/adapter.ts` uses the same adapter module contract.

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
- [Glossary](GLOSSARY.md)
- [Integration evidence and remaining checks](docs/integration-notes.md)
- [Office image prompt and provenance](assets/office/office-v1.prompt.md)

The app references three genuine built-in pet sprite sheets through the official asset URLs in [the pet manifest](src/shared/pets.ts). Live agent mapping and the integrated asset check remain part of #1. Plugin installation, live office acceptance, voice and live computer view are not claimed complete.
