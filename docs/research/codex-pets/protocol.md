# Existing agent protocol evidence

PetsTown observes existing agents. Follow [Office contract v1](../../contracts/office-v1.md) and issues [#1](https://github.com/JackInSightsV2/Pets-Town/issues/1), [#4](https://github.com/JackInSightsV2/Pets-Town/issues/4), and [#7](https://github.com/JackInSightsV2/Pets-Town/issues/7). The office must not create, resume, fork, interrupt or assign agent work.

The earlier three-owned-thread architecture is superseded. A new private app-server process does not establish observation of agents running elsewhere.

## Versions and evidence

Windows CLI 0.158.0 help and generated schemas were inspected. The repository's [integration notes](../../integration-notes.md) report Mac CLI 0.166.0; that target was not executed during this audit. Public source was independently checked at OpenAI commit `67f0994b532b8740f14b5b738af7b7b2a915b1d6`.

No app-server handshake, live agent observation, model turn or response routing was executed. Regenerate the protocol on the actual demo machine:

```sh
codex --version
codex app-server --help
codex app-server proxy --help
codex app-server generate-ts --out <temporary-schema-directory>
```

Record the CLI version and relevant generated file hashes. Do not mix SDK dot-separated events with app-server slash-separated methods.

## First route to verify

Installed help includes `app-server proxy`, described as proxying stdio bytes to a running app-server control socket. The existing repository evidence also identifies `codex agents` as a session view on the shared daemon. Inspect the target's help to determine its exact invocation and control-socket selection.

```text
Browser office <-> local bridge <-> existing Codex daemon
                                      |
                                 existing agents
```

Connecting to that existing daemon is a candidate, not a passed test. Starting a fresh server tests a different topology.

The [official transport guide](https://learn.chatgpt.com/docs/app-server#protocol) documents JSONL over stdio and local transport. Keep stderr out of protocol stdout. Initialize once per connection, await the response, then send `initialized`. This schema-backed 0.158.0 example has not been executed:

```json
{"id":1,"method":"initialize","params":{"clientInfo":{"name":"petstown","title":"PetsTown","version":"0.1.0"},"capabilities":null}}
{"method":"initialized"}
```

The initialized notification is a unit variant in the [pinned protocol source](https://github.com/openai/codex/blob/67f0994b532b8740f14b5b738af7b7b2a915b1d6/codex-rs/app-server-protocol/src/protocol/common.rs); the example uses its canonical serialization. Do not save the entire initialize/account response into shared evidence: it can expose local home/account details.

## Passive discovery and subscriptions

Use `thread/loaded/list` to find IDs loaded in the connected server, then `thread/read` for metadata/state. `thread/list` can discover stored history; choose source/subagent filters deliberately.

The official guide explicitly says [thread/read does not subscribe](https://learn.chatgpt.com/docs/app-server#read-a-thread). A history record or successful read is not proof of live tool/activity access.

A source-backed status route is worth testing:

1. `ThreadWatchManager::mutate_and_publish` emits `ThreadStatusChanged` through the global outgoing sender.
2. The sender converts an empty recipient list into `OutgoingEnvelope::Broadcast`.
3. Transport routing delivers broadcasts to initialized connections that have not opted out.

Evidence: [thread_status.rs](https://github.com/openai/codex/blob/67f0994b532b8740f14b5b738af7b7b2a915b1d6/codex-rs/app-server/src/thread_status.rs#L246), [outgoing_message.rs](https://github.com/openai/codex/blob/67f0994b532b8740f14b5b738af7b7b2a915b1d6/codex-rs/app-server/src/outgoing_message.rs#L847), [transport.rs](https://github.com/openai/codex/blob/67f0994b532b8740f14b5b738af7b7b2a915b1d6/codex-rs/app-server/src/transport.rs).

This supports a same-daemon status-observer experiment. It does not prove separate-process coverage, item/tool subscriptions, pending-request replay or reconnect recovery. Do not call `thread/resume` merely to obtain subscriptions; the office contract forbids silently changing observed execution.

## State semantics

The inspected 0.158.0 schema declares:

```ts
type ThreadStatus =
  | { type: "notLoaded" }
  | { type: "idle" }
  | { type: "systemError" }
  | { type: "active"; activeFlags: ThreadActiveFlag[] };

type ThreadActiveFlag =
  | "waitingOnApproval"
  | "waitingOnUserInput";
```

Loaded does not mean working. Idle does not mean closed. Not-loaded does not mean successful completion. Bridge disconnection is separate from agent error.

`turn/completed` carries a turn whose status can be completed, interrupted or failed; the schema's turn-status union also includes inProgress. Only a verified successful outcome may emit the office completion/celebration event. Preserve the source correlation and failure information.

`thread/start`, `turn/start` and `turn/interrupt` exist in the protocol but are not presentation actions. Reset must not invoke them.

## Requests and responses

A waiting flag can support Needs input while question details remain unavailable. Do not fabricate a prompt or enable replies on that basis.

Keep JSON-RPC request ID together with its server/connection context and thread identity. A pet name or item ID is not sufficient. Command approvals may include an `approvalId` because one item can have more than one callback.

| Kind | Inspected response distinction |
| --- | --- |
| Command approval | A decision; string choices include accept, acceptForSession, decline, cancel, plus supported structured amendments |
| File-change approval | A decision using the four string choices |
| Permission approval | Permissions and scope, with optional strict-auto-review fields; not the generic decision shape |
| User-input request | Its own answer schema; not an ordinary chat turn |

Source includes `pending_requests_for_thread` and `replay_requests_to_connection_for_thread`, recipient authorization for human-command approvals, and separate single-owner verification ceremonies. The existence of replay code does not authorize every second client to answer every pending request. [Request routing source](https://github.com/openai/codex/blob/67f0994b532b8740f14b5b738af7b7b2a915b1d6/codex-rs/app-server/src/outgoing_message.rs#L525).

For #7, prove a supported replay/access trigger, response ownership, exact schema, duplicate behaviour, and resolution in the original client. Until then, inspection remains useful and response capability stays unsupported. `serverRequest/resolved` can mean answered or cleared; interruption/completion can also clear a request. Do not translate every resolution into approved. [Request lifecycle](https://learn.chatgpt.com/docs/app-server#toolrequestuserinput).

## Authentic handoffs

For #4, inspect real collaboration events/tool items for sender, recipient and stable source correlation. A parent relationship, simultaneous activity or a pet movement is not an exchange.

Normalize a verified source exchange into `handoff.observed`. Do not create a turn or transfer work to manufacture the scene. Fixture-derived meetings do not pass live acceptance.

## Focused live proof sequence

1. Record target CLI version and existing-daemon connection route.
2. Observe an agent that was active before connecting, retaining its original identity.
3. Capture a genuine state change and any supported activity detail.
4. Disconnect/reconnect the viewer and confirm the agent continues untouched.
5. Capture one authentic exchange with both participants.
6. Separately test a supported request and duplicate/original-client resolution behaviour.

Save sanitized method names, correlation IDs, states, timestamps and outcomes. Exclude credentials and private prompt/transcript contents. Unsupported routes must produce explicit capabilities and reasons, not synthetic success.
