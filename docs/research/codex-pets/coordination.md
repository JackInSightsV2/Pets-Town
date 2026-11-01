# Dots coordination and repository monitoring

Use a Dot as the coordination owner while the three Codex main agents implement Alex's issues. The user can paste [the coordinator prompt](prompts/00-dot-coordinator.md) into their Dot. It explicitly delegates the three sessions and requires subagent parallelism inside each.

OpenAI documents that a Dot can coordinate background work, create visible tasks and send follow-ups. Local Codex tasks run on their connected computer; cloud coding tasks require a configured environment. Each new task receives its own supplied context rather than every previous conversation. [Dots tasks and memory](https://learn.chatgpt.com/docs/dots/tasks-and-memory).

This pack has not created a Dot or launched coding sessions. The prompts and the repository monitor are separate deliverables.

## Coordination registry

Maintain a compact registry in the coordinator conversation:

| Field | Purpose |
| --- | --- |
| Issue and accountable owner | #1/#4/#7 belong to getmateri; respect other claimed lanes |
| Task identifier and host/environment | Route follow-ups to the actual task, not a similar title |
| Branch/worktree and base main SHA | Avoid shared-checkout branch changes and stale baselines |
| Owned files/modules | Detect overlap before two writers edit the same file |
| Required interface version | Keep adapter, bridge and scene aligned with Office v1 |
| Current evidence and blocker | Separate source, fixture and live results |
| PR and next integration action | Make handoffs concrete |

Use compact task-progress snapshots when available. A completed agent run is not a passed issue. Read the resulting diff and evidence before recommending integration.

## Repository watch

A heartbeat named **PetsTown integration watch** was created in the preparation chat: every five minutes until **17:30 Europe/London on 1 November 2026**. It watches main, PRs, checks, issue ownership and contract changes, and reports only meaningful impact. The existing watch is read-only; do not create a duplicate schedule if it is available.

The watch complements these checks that every coding parent performs:
- At session startup, read latest main, relevant open PRs and current issue ownership.
- Before changing a shared interface, inspect the current contract and the other producer/consumer changes.
- Before integration or merge, fetch latest main and inspect overlap with work landed since the branch base.
- After a dependency merges, re-run the affected contract and focused integration checks.
- When another teammate changes the flow, adapt to the latest user-approved plan and report the concrete impact.

Watch especially plan.md, design.md, docs/contracts/office-v1.md, package/entrypoint files, src/codex, src/server, src/ui and src/office.

For each actionable change, record the exact commit/PR, affected files/lane, incompatible assumption, and next action. Do not generate repeated no-change status messages.

## Keep teammates' flows intact

Lane C owns the shared app/server entrypoints and package changes. Jack's #3 panel work was already in progress at preparation time. Lane A owns the general scene; #4 contributes a dedicated handoff module through that interface. #1 owns connection/discovery/status; #7 owns request handling.

Do not infer that a newly opened PR replaces an agreed contract. Inspect its content and acceptance evidence. Do not automatically merge, close issues, or reassign another teammate's work merely to increase throughput.

Each worker keeps its own changes intact when refreshing its branch. Use normal Git protections; no forced reset, overwrite or force push as a coordination shortcut.
