# Office launcher evidence and implementation brief

The launcher opens a local browser that observes existing Codex work. It starts or reuses only office-owned services. It does not launch, resume, assign, interrupt or stop agents.

Follow [the plan](../../../plan.md) and [Office contract v1](../../contracts/office-v1.md). Launcher and shared entrypoint stewardship belongs to lane C; #1's observer session should coordinate its minimal shell contribution rather than create a competing scaffold.

## Supported entry

Official [skill documentation](https://learn.chatgpt.com/docs/build-skills) and pinned source support repository `.agents/skills/office/SKILL.md`, invoked through `$office` or `/skills` → office.

- [Skill discovery](https://github.com/openai/codex/blob/67f0994b532b8740f14b5b738af7b7b2a915b1d6/codex-rs/ext/skills/src/host_roots.rs#L56) walks from the working directory to the repository root.
- [Explicit selection](https://github.com/openai/codex/blob/67f0994b532b8740f14b5b738af7b7b2a915b1d6/codex-rs/skills/src/selection.rs#L33) resolves structured skill input and dollar-prefixed names.
- A skill supplies agent instructions; it is not a direct executable alias. Put startup logic in a deterministic script that can also be invoked directly.

Proposed metadata, to be created by the launcher owner after selecting the actual app command:

```yaml
---
name: office
description: Open PetsTown in a local browser to observe existing Codex agents.
---
```

The body should resolve the repository root, run the launcher and report its local URL or actionable startup error. It should not ask the model to invent startup commands or create demonstration agents.

## Bare slash names and presets

The inspected built-in slash enum has no Office command. Presets are numbered saved inputs, not named slash registrations.

[Quick-dial recall](https://github.com/openai/codex/blob/67f0994b532b8740f14b5b738af7b7b2a915b1d6/codex-rs/tui/src/chatwidget/quick_dials.rs#L189) queues saved input for parsing. [Slash resolution](https://github.com/openai/codex/blob/67f0994b532b8740f14b5b738af7b7b2a915b1d6/codex-rs/tui/src/bottom_pane/slash_commands.rs#L135) resolves built-ins/model service tiers; [dispatch](https://github.com/openai/codex/blob/67f0994b532b8740f14b5b738af7b7b2a915b1d6/codex-rs/tui/src/chatwidget/slash_dispatch.rs#L1181) rejects unknown names.

Thus a bare `/office` is unsupported in this inspected path. Saving `$office` as preset input does not change that. This is source verification, not an interactive test of every installed build. The user already accepted the supported skill route.

## Launcher acceptance

These are implementation checks, not completed tests.

- Resolve files from the project/script location and support spaces in paths.
- Start or reuse the expected loopback office service; validate its identity/snapshot contract, not merely an HTTP 200.
- Wait for readiness with a bounded timeout; report missing dependencies, wrong service on the port and startup failures clearly.
- Repeated invocation reuses the bridge and preserves presentation state. Do not kill unrelated port owners.
- Open the local URL with the target OS's browser opener. On Windows keep helper windows hidden.
- A live bridge is not proof that an observer connection works. Surface connection/capability status independently.
- Closing the page or stopping office-owned services leaves existing Codex work untouched.
- Test both direct launcher invocation and actual skill discovery/invocation on the demo Mac.

Reuse these existing routes:

| Route | Meaning |
| --- | --- |
| GET /api/office | Current snapshot, capabilities and observed roster |
| GET /api/events | Ordered SSE events and explicit reconnect recovery |
| POST /api/presentation/start | Arrivals/standup from current observed facts |
| POST /api/presentation/skip | Move from ceremony to live presentation |
| POST /api/presentation/reset | Reset presentation while keeping live agents and requests intact |

Starting a new private app-server does not prove visibility into an existing daemon. The observer connection and request-response capabilities have their own [protocol gates](protocol.md).

No launcher or Office skill was installed or invoked in this research. The Mac's actual CLI/runtime and browser-opening behaviour still need a live check.
