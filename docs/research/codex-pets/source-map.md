# Codex CLI and Pets source map

The source below was independently inspected at OpenAI Codex commit `67f0994b532b8740f14b5b738af7b7b2a915b1d6`, dated 31 October 2026. These references explain implementation paths; they do not establish runtime parity with every installed CLI.

| Concern | File and symbol | Use in PetsTown |
| --- | --- | --- |
| Installed executable | [codex-cli/bin/codex.js](https://github.com/openai/codex/blob/67f0994b532b8740f14b5b738af7b7b2a915b1d6/codex-cli/bin/codex.js#L80), `findCodexExecutable` | Resolve the installed platform executable; avoid modifying the npm shim. |
| CLI dispatch | [codex-rs/cli/src/main.rs](https://github.com/openai/codex/blob/67f0994b532b8740f14b5b738af7b7b2a915b1d6/codex-rs/cli/src/main.rs#L1037), `main`, `dispatch_cli` | Identify the actual installed subcommand and transport paths. |
| App-server entry | [main.rs AppServer branch](https://github.com/openai/codex/blob/67f0994b532b8740f14b5b738af7b7b2a915b1d6/codex-rs/cli/src/main.rs#L1236), `run_main_with_transport_options` | Understand server/proxy entry points; do not assume a new server sees existing processes. |
| Skill discovery | [ext/skills/src/host_roots.rs](https://github.com/openai/codex/blob/67f0994b532b8740f14b5b738af7b7b2a915b1d6/codex-rs/ext/skills/src/host_roots.rs#L56), `resolve_skill_roots`, `repo_agents_skill_roots` | Repository `.agents/skills` discovery. |
| Skill invocation | [skills/src/selection.rs](https://github.com/openai/codex/blob/67f0994b532b8740f14b5b738af7b7b2a915b1d6/codex-rs/skills/src/selection.rs#L33), `collect_explicit_skill_mentions` | `$office` selects instructions; the actual launch must be deterministic code. |
| RPC dispatch | [app-server/src/message_processor.rs](https://github.com/openai/codex/blob/67f0994b532b8740f14b5b738af7b7b2a915b1d6/codex-rs/app-server/src/message_processor.rs), `process_request`, `handle_initialized_client_request` | Trace read/list operations and their side effects. |
| Threads and turns | [request_processors](https://github.com/openai/codex/tree/67f0994b532b8740f14b5b738af7b7b2a915b1d6/codex-rs/app-server/src/request_processors) | Keep read-only observation separate from creation/resumption/interruption. |
| Status broadcasts | [thread_status.rs](https://github.com/openai/codex/blob/67f0994b532b8740f14b5b738af7b7b2a915b1d6/codex-rs/app-server/src/thread_status.rs#L246), `ThreadWatchManager::mutate_and_publish` | Candidate route to same-daemon status observation. |
| Request replay and recipients | [outgoing_message.rs](https://github.com/openai/codex/blob/67f0994b532b8740f14b5b738af7b7b2a915b1d6/codex-rs/app-server/src/outgoing_message.rs#L525), `pending_requests_for_thread`, `replay_requests_to_connection_for_thread` | Investigate #7 ownership, replay and response correlation. |
| Transport routing | [transport.rs](https://github.com/openai/codex/blob/67f0994b532b8740f14b5b738af7b7b2a915b1d6/codex-rs/app-server/src/transport.rs) | Trace initialized connections, broadcast delivery and opt-outs. |
| Core-to-client events | [bespoke_event_handling.rs](https://github.com/openai/codex/blob/67f0994b532b8740f14b5b738af7b7b2a915b1d6/codex-rs/app-server/src/bespoke_event_handling.rs), `apply_bespoke_event_handling` | Source correlation for lifecycle and real collaboration events; access from a passive client still needs proof. |
| Pets formats and states | [tui/src/pets](https://github.com/openai/codex/tree/67f0994b532b8740f14b5b738af7b7b2a915b1d6/codex-rs/tui/src/pets) | `model.rs`, `ambient.rs`, `catalog.rs`, `asset_pack.rs`, `frames.rs`; browser rendering is separate from terminal output. |

The public CLI includes terminal Pets and a `/pets` command. That is distinct from the desktop shell. This pack does not depend on access to desktop UI source.

The TypeScript SDK uses dot-separated event names; app-server uses slash-separated methods. Keep the version-specific adapter separate from the repository's normalized Office v1 events.
