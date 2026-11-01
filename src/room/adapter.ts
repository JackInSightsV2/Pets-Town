import { randomUUID } from "node:crypto";
import type { OfficeAdapter } from "../server/adapter.js";
import {
  emptySnapshot,
  unsupported,
  type OfficeEvent,
} from "../shared/contract.js";
import { builtInPets } from "../shared/pets.js";
import { isOfficeSnapshot } from "../client/validation.js";

/** Room participants publish only explicit, normalized selections. No filesystem or Codex control access. */
export function createRoomAdapter(now = () => Date.now()) {
  const state = emptySnapshot(randomUUID());
  state.petAssets = structuredClone(builtInPets);
  state.connection.message = "Waiting for teammates to share selected pets.";
  const listeners = new Set<(event: OfficeEvent) => void>();
  const participants = new Map<
    string,
    {
      name: string;
      lastSeen: number;
      agents: Set<string>;
      requests: Set<string>;
      handoffs: Set<string>;
      offline: boolean;
      handoffsSupported: boolean;
    }
  >();
  let seq = 0;
  function emit(
    type: OfficeEvent["type"],
    data: unknown,
    agentId: string | null = null,
    source: "codex" | "fixture" = "codex",
  ) {
    const event = {
      protocolVersion: 1,
      bridgeEpoch: state.bridgeEpoch,
      seq: ++seq,
      eventId: randomUUID(),
      occurredAt: new Date(now()).toISOString(),
      source,
      type,
      agentId,
      data,
    } as OfficeEvent;
    state.lastSeq = seq;
    for (const listener of listeners) listener(event);
  }
  const adapter: OfficeAdapter = {
    initialSnapshot: () => structuredClone(state),
    subscribe(fn) {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
    stop() {
      listeners.clear();
    },
  };
  function upsert(id: string, name: string, input: unknown) {
    if (
      !isOfficeSnapshot(input) ||
      input.agents.length > 100 ||
      input.projects.length > 100 ||
      input.pendingRequests.length > 100 ||
      input.recentHandoffs.length > 100
    )
      throw new Error("Invalid or oversized office snapshot");
    if (!participants.has(id) && participants.size >= 12)
      throw new Error("This room supports 12 teammates.");
    const ns = (value: string) => `room:${id}:${value}`;
    const previous = participants.get(id);
    const requestOwners = new Map(
      state.agents.flatMap((a) =>
        a.pendingRequestIds.map((requestId) => [requestId, a.agentId] as const),
      ),
    );
    for (const request of state.pendingRequests)
      requestOwners.set(request.requestId, request.agentId);
    const current = {
      name,
      lastSeen: now(),
      agents: new Set<string>(),
      requests: new Set<string>(),
      handoffs: previous?.handoffs ?? new Set<string>(),
      offline: input.connection.status !== "connected",
      handoffsSupported: input.capabilities.observeHandoffs.supported,
    };
    if (
      new Set([
        ...(previous?.handoffs ?? []),
        ...input.recentHandoffs.map((h) => h.handoffId),
      ]).size > 10000
    )
      throw new Error("Handoff history limit reached; restart this publisher.");
    const source = input.source;
    if (source === "fixture") state.source = "fixture";
    for (const p of input.projects) {
      const project = {
        projectId: ns(p.projectId),
        displayName: `${name} · ${p.displayName.slice(0, 120)}`,
        cwd: null,
      };
      state.projects = [
        ...state.projects.filter((p) => p.projectId !== project.projectId),
        project,
      ];
      emit("project.upserted", { project }, null, source);
    }
    for (const a of input.agents) {
      const lastAgent = state.agents.find(
        (old) => old.agentId === ns(a.agentId),
      );
      const agent = {
        ...a,
        runtimeState:
          input.connection.status === "connected"
            ? a.runtimeState
            : lastAgent?.runtimeState.startsWith("waiting-")
              ? lastAgent.runtimeState
              : ("unknown" as const),
        agentId: ns(a.agentId),
        parentAgentId: a.parentAgentId ? ns(a.parentAgentId) : null,
        projectId: ns(a.projectId),
        displayName: `${name} · ${a.displayName.slice(0, 120)}`,
        pendingRequestIds: [
          ...new Set([
            ...a.pendingRequestIds.map(ns),
            ...(current.offline ? (lastAgent?.pendingRequestIds ?? []) : []),
          ]),
        ],
        petAssetId: builtInPets.some((p) => p.assetId === a.petAssetId)
          ? a.petAssetId
          : null,
        recentActivity: a.recentActivity.slice(0, 12).map((x) => ({
          ...x,
          agentId: ns(x.agentId),
          activityId: ns(x.activityId),
          sourceItemId: null,
        })),
      };
      current.agents.add(agent.agentId);
      for (const requestId of agent.pendingRequestIds)
        current.requests.add(requestId);
      state.agents = [
        ...state.agents.filter((a) => a.agentId !== agent.agentId),
        agent,
      ];
      emit("agent.upserted", { agent }, agent.agentId, source);
    }
    for (const r of input.pendingRequests) {
      if (!current.agents.has(ns(r.agentId))) continue;
      const request = {
        ...r,
        requestId: ns(r.requestId),
        agentId: ns(r.agentId),
        responseCapability: unsupported(
          "Respond on the owning teammate’s Mac.",
        ),
      };
      current.requests.add(request.requestId);
      state.pendingRequests = [
        ...state.pendingRequests.filter(
          (r) => r.requestId !== request.requestId,
        ),
        request,
      ];
      emit("request.opened", { request }, request.agentId, source);
    }
    for (const requestId of previous?.requests ?? [])
      if (!current.requests.has(requestId)) {
        const owner = requestOwners.get(requestId);
        if (current.offline || !owner || !current.agents.has(owner)) {
          current.requests.add(requestId);
          continue;
        }
        state.pendingRequests = state.pendingRequests.filter(
          (r) => r.requestId !== requestId,
        );
        for (const agent of state.agents)
          agent.pendingRequestIds = agent.pendingRequestIds.filter(
            (id) => id !== requestId,
          );
        emit(
          "request.resolved",
          { requestId, reason: "Resolved at the publishing source" },
          null,
          source,
        );
      }
    // Removal from a shared selection is not completion or closure of its underlying agent.
    for (const agentId of previous?.agents ?? [])
      if (!current.agents.has(agentId)) {
        const agent = state.agents.find((a) => a.agentId === agentId);
        if (agent) {
          agent.runtimeState = "unknown";
          agent.displayName = `${name} · no longer shared`;
          emit("agent.upserted", { agent }, agentId, source);
        }
      }
    for (const h of [...input.recentHandoffs].reverse()) {
      if (
        !current.agents.has(ns(h.fromAgentId)) ||
        !current.agents.has(ns(h.toAgentId))
      )
        continue;
      const fresh = !current.handoffs.has(h.handoffId);
      current.handoffs.add(h.handoffId);
      // A participant's initial snapshot is history, not a new meeting.
      if (
        fresh &&
        previous &&
        !previous.offline &&
        !current.offline &&
        current.handoffsSupported
      ) {
        const handoff = {
          ...h,
          handoffId: ns(h.handoffId),
          fromAgentId: ns(h.fromAgentId),
          toAgentId: ns(h.toAgentId),
          sourceItemId: ns(h.handoffId),
        };
        state.recentHandoffs = [handoff, ...state.recentHandoffs].slice(0, 50);
        emit("handoff.observed", { handoff }, null, source);
      }
    }
    if (current.handoffs.size > 10000)
      throw new Error("Handoff history limit reached; restart this publisher.");
    participants.set(id, current);
    state.capabilities = {
      observeAgents: { supported: true, reason: null },
      observeHandoffs: {
        supported: [...participants.values()].some(
          (p) => !p.offline && p.handoffsSupported,
        ),
        reason:
          "Observed handoffs among shared agents; no exchanges are invented.",
      },
      respondToRequests: unsupported("Reply on the owning teammate’s Mac."),
    };
    emit(
      "capabilities.changed",
      { capabilities: state.capabilities },
      null,
      source,
    );
    connection();
  }
  function connection() {
    const offline = [...participants.values()].filter((p) => p.offline).length;
    state.connection = {
      status: offline
        ? "reconnecting"
        : participants.size
          ? "connected"
          : "unsupported",
      lastObservedAt: new Date(now()).toISOString(),
      message: offline
        ? `${offline} teammate connection(s) lost; last observed state is retained.`
        : `${participants.size} teammate(s) sharing selected pets.`,
    };
    emit("connection.changed", { connection: state.connection });
  }
  function expire() {
    let changed = false;
    for (const p of participants.values())
      if (!p.offline && now() - p.lastSeen > 15000) {
        p.offline = true;
        changed = true;
        for (const id of p.agents) {
          const a = state.agents.find((a) => a.agentId === id);
          if (a && !a.runtimeState.startsWith("waiting-")) {
            a.runtimeState = "unknown";
            emit("agent.state.changed", { runtimeState: "unknown" }, id);
          }
        }
      }
    if (changed) connection();
  }
  return { adapter, upsert, expire, snapshot: () => structuredClone(state) };
}
