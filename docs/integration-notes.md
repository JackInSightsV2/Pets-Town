# PetsTown integration evidence

Read-only findings gathered on 2026-11-01. These establish integration candidates, not a working PetsTown connection. Nothing has been installed or launched, and no private conversation content was inspected.

## CLI launcher

- The installed CLI reports `codex-cli 0.166.0` and exposes plugin package management.
- Official documentation supports explicit skill invocation through `/skills` or `$` mentions. An Office skill can bundle an executable launcher that starts or reuses a local web server and opens its URL in a browser. This launcher is a proposed implementation using documented script support, not tested code.
- Direct plugin registration of a bare `/office` command was not established. The installed Office skill's exact name and completion behavior need validation.

Sources: [skill invocation and executable resources](https://learn.chatgpt.com/docs/build-skills), [plugin packaging](https://developers.openai.com/plugins/build/plugins), [converting commands into skills](https://developers.openai.com/plugins/guides/submit-claude-plugin).

## Existing-agent discovery

- Local CLI help describes `codex agents` as browsing sessions on the shared local app-server daemon, and `codex app-server proxy` as connecting to its existing control socket.
- The local generated protocol schema includes loaded-thread listing and thread metadata without turns. Available fields include thread identity, working directory, project identity, parent thread identity, nickname, role, source and runtime status.
- Runtime states include active, idle, system error and not loaded. Active flags can identify waiting for approval or user input. Loaded alone does not mean actively working.
- Listing defaults may omit subagents; source filters and parent relationships must be handled explicitly.
- Still unverified: which already-running CLI and desktop sessions are reachable through the same daemon, how to subscribe without changing their execution, and how events recover after reconnecting.

Source: [Codex App Server](https://learn.chatgpt.com/docs/app-server). Local protocol schemas were generated under `/tmp/petstown-codex-schema` for inspection only.

## Inspection and help

- The protocol documents user-input and approval request IDs, responses, and request-resolved events. Attention should follow the underlying request state, including resolution through interruption or completion.
- It is not yet established that a second browser-backed client can retrieve and answer a request already pending in the original client. Request ownership, replay and simultaneous responses need a focused integration check.
- A normal message to an agent is not equivalent to answering an outstanding approval request.
- Official desktop links support `codex://threads/<thread-id>` for navigating to an existing local chat. This is a possible navigation fallback for users with the desktop app, not a proven CLI-only answer mechanism.

Sources: [request lifecycle](https://learn.chatgpt.com/docs/app-server#toolrequestuserinput), [desktop conversation links](https://learn.chatgpt.com/docs/app/commands#chats).

## Pet artwork

- The installed desktop pet contract describes custom packages under `~/.codex/pets/<pet-name>/`, with a pet manifest and sprite sheet.
- The locally installed desktop v2 contract specifies an 8-by-11 atlas of 1536 by 2288 pixels. Public web-pet material uses a different 8-by-9 shape, so the renderer must use the contract of the actual supplied asset.
- A supported export path and redistribution terms for bundled built-in desktop artwork have not been established. Local custom pet packages are a technically inspectable candidate.
- Access to the ChatGPT Work pet connector does not by itself establish access to the desktop pet library or a per-agent pet assignment.

Local evidence: `/Applications/ChatGPT.app/Contents/Resources/skills/skills/.curated/hatch-pet/references/codex-pet-contract.md`. Native pet status behavior is documented in [Pets](https://learn.chatgpt.com/docs/pets#understand-pet-status).
