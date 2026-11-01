import { test } from "node:test";
import assert from "node:assert/strict";
import { createRoomAdapter } from "./adapter.js";
import { createSharedRoom } from "./host.js";
import { emptySnapshot } from "../shared/contract.js";
import { builtInPets } from "../shared/pets.js";
function snapshot() {
  const s = emptySnapshot("local");
  s.connection = {
    status: "connected",
    lastObservedAt: new Date().toISOString(),
    message: null,
  };
  s.petAssets = builtInPets;
  s.capabilities.observeHandoffs = { supported: true, reason: null };
  s.projects = [
    { projectId: "p", displayName: "Project", cwd: "/private/path" },
  ];
  s.agents = [
    {
      agentId: "same-id",
      parentAgentId: null,
      projectId: "p",
      displayName: "Agent",
      role: null,
      task: null,
      runtimeState: "working",
      activityKind: "editing",
      lastObservedAt: null,
      pendingRequestIds: [],
      petAssetId: "codex",
      recentActivity: [],
    },
  ];
  return s;
}
test("room namespaces two Macs and retains unknown state on disconnect", () => {
  let now = 10000;
  const r = createRoomAdapter(() => now);
  r.upsert("alice", "Alice", snapshot());
  r.upsert("bob", "Bob", snapshot());
  const s = r.snapshot();
  assert.equal(s.agents.length, 2);
  assert.notEqual(s.agents[0].agentId, s.agents[1].agentId);
  assert.ok(s.projects.every((p) => p.cwd === null));
  now += 16000;
  r.expire();
  assert.ok(r.snapshot().agents.every((a) => a.runtimeState === "unknown"));
  assert.equal(r.snapshot().connection.status, "reconnecting");
  r.upsert("alice", "Alice", snapshot());
  assert.equal(r.snapshot().connection.status, "reconnecting");
  r.upsert("bob", "Bob", snapshot());
  assert.equal(r.snapshot().connection.status, "connected");
});
test("room does not invent initial handoff meetings or replay polling history", () => {
  const r = createRoomAdapter();
  const s = snapshot();
  s.agents.push({ ...s.agents[0], agentId: "second" });
  s.recentHandoffs = [
    {
      handoffId: "h",
      fromAgentId: "same-id",
      toAgentId: "second",
      summary: "Observed exchange",
      occurredAt: new Date().toISOString(),
      sourceItemId: "h",
    },
  ];
  const events: string[] = [];
  r.adapter.subscribe((e) => events.push(e.type));
  r.upsert("a", "A", s);
  assert.equal(events.filter((e) => e === "handoff.observed").length, 0);
  s.recentHandoffs.unshift({ ...s.recentHandoffs[0], handoffId: "new" });
  r.upsert("a", "A", s);
  r.upsert("a", "A", s);
  assert.equal(events.filter((e) => e === "handoff.observed").length, 1);
});
test("shared gateway requires an invitation and isolates publisher credentials", async () => {
  const room = await createSharedRoom({ port: 0 });
  try {
    assert.equal((await fetch(`${room.url}/api/office`)).status, 401);
    assert.equal(
      (await fetch(`${room.url}/api/room/enroll`, { method: "POST" })).status,
      401,
    );
    const auth = {
      Authorization: `Bearer ${room.token}`,
      "Content-Type": "application/json",
    };
    const session = await fetch(`${room.url}/api/room/session`, {
      method: "POST",
      headers: auth,
    });
    assert.equal(session.status, 200);
    const cookie = session.headers.get("set-cookie")!.split(";")[0];
    assert.equal(
      (await fetch(`${room.url}/api/office`, { headers: { Cookie: cookie } }))
        .status,
      200,
    );
    const a = (await (
      await fetch(`${room.url}/api/room/enroll`, {
        method: "POST",
        headers: auth,
        body: JSON.stringify({ name: "Alice" }),
      })
    ).json()) as { participantId: string; publisherToken: string };
    const b = (await (
      await fetch(`${room.url}/api/room/enroll`, {
        method: "POST",
        headers: auth,
        body: JSON.stringify({ name: "Bob" }),
      })
    ).json()) as { participantId: string; publisherToken: string };
    const publish = (id: string, token: string) =>
      fetch(`${room.url}/api/room/publish`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "X-Participant-Id": id,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(snapshot()),
      });
    assert.equal(
      (await publish(a.participantId, b.publisherToken)).status,
      401,
    );
    assert.equal(
      (await publish(a.participantId, a.publisherToken)).status,
      200,
    );
    assert.equal(
      (await publish(b.participantId, b.publisherToken)).status,
      200,
    );
    const state = (await (
      await fetch(`${room.url}/api/office`, { headers: auth })
    ).json()) as ReturnType<typeof snapshot>;
    assert.equal(state.agents.length, 2);
    assert.ok(state.agents.some((a) => a.displayName === "Alice · Agent"));
    assert.ok(state.agents.some((a) => a.displayName === "Bob · Agent"));
    assert.equal(
      (
        await fetch(`${room.url}/api/office`, {
          headers: { ...auth, Origin: "http://elsewhere.invalid" },
        })
      ).status,
      403,
    );
  } finally {
    await room.close();
  }
});

test("missing request details and source outages do not resolve pending attention", () => {
  const r = createRoomAdapter();
  const s = snapshot();
  s.agents[0].pendingRequestIds = ["q"];
  s.pendingRequests = [
    {
      requestId: "q",
      agentId: "same-id",
      kind: "user-input",
      prompt: null,
      options: [],
      createdAt: new Date().toISOString(),
      responseCapability: { supported: false, reason: "Source only" },
      revision: null,
    },
  ];
  const events: string[] = [];
  r.adapter.subscribe((e) => events.push(e.type));
  r.upsert("a", "A", s);
  s.pendingRequests = [];
  r.upsert("a", "A", s);
  assert.equal(events.filter((e) => e === "request.resolved").length, 0);
  s.connection.status = "disconnected";
  s.agents[0].pendingRequestIds = [];
  r.upsert("a", "A", s);
  assert.equal(events.filter((e) => e === "request.resolved").length, 0);
  s.connection.status = "connected";
  r.upsert("a", "A", s);
  assert.equal(events.filter((e) => e === "request.resolved").length, 1);
  assert.equal(r.snapshot().pendingRequests.length, 0);
});

test("detail-free waiting state survives a lost connection", () => {
  let now = 0;
  const r = createRoomAdapter(() => now);
  const s = snapshot();
  s.agents[0].runtimeState = "waiting-for-input";
  s.agents[0].pendingRequestIds = ["q"];
  r.upsert("a", "A", s);
  now = 16000;
  r.expire();
  assert.equal(r.snapshot().agents[0].runtimeState, "waiting-for-input");
  s.connection.status = "disconnected";
  s.agents[0].pendingRequestIds = [];
  r.upsert("a", "A", s);
  assert.deepEqual(r.snapshot().agents[0].pendingRequestIds, ["room:a:q"]);
  s.connection.status = "connected";
  s.agents[0].runtimeState = "working";
  r.upsert("a", "A", s);
  assert.equal(r.snapshot().agents[0].pendingRequestIds.length, 0);
});
