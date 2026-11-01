# PetsTown

A living office for existing Codex agents, launched from Codex CLI into a local browser. Genuine ChatGPT/Codex pets arrive, give a brief standup and reflect real work, requests and handoffs.

**Status:** the agreed design, generated office environment and nine implementation issues are published. The application has not been implemented yet.

![PetsTown office environment](assets/office/office-v1.png)

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

The environment image is available; retrieval and validation of genuine ChatGPT/Codex pet assets is part of #1. No plugin installation or live office connection has been verified yet.
