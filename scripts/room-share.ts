import { isOfficeSnapshot } from "../src/client/validation.js";
const args = process.argv.slice(2);
const option = (name: string) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
};
const bridge = option("--bridge") ?? "http://127.0.0.1:4317";
const bridgeUrl = new URL(bridge);
if (!["127.0.0.1", "localhost"].includes(bridgeUrl.hostname))
  throw new Error("--bridge must be this Mac’s loopback office bridge.");
const read = async () => {
  const r = await fetch(`${bridge}/api/office`, {
    signal: AbortSignal.timeout(5000),
  });
  if (!r.ok) throw new Error("Local office is unavailable");
  const s: unknown = await r.json();
  if (!isOfficeSnapshot(s)) throw new Error("Invalid local office snapshot");
  return s;
};
if (args.includes("--list")) {
  for (const a of (await read()).agents)
    console.log(`${a.agentId}\t${a.displayName}`);
  process.exit(0);
}
const room = option("--room"),
  name = option("--name"),
  ids = option("--agents")?.split(",").filter(Boolean),
  token = process.env.PETSTOWN_ROOM_TOKEN;
if (!room || !name || !ids?.length || !token)
  throw new Error(
    "Use --room URL --name NAME --agents ID,ID and set PETSTOWN_ROOM_TOKEN. Use --list to see existing agents.",
  );
const roomUrl = new URL(room);
if (
  !["http:", "https:"].includes(roomUrl.protocol) ||
  roomUrl.username ||
  roomUrl.password ||
  roomUrl.search ||
  roomUrl.hash
)
  throw new Error("Use the room base URL without the invitation fragment.");
const selected = new Set(ids);
const details = args.includes("--share-details");
const enrollment = await fetch(`${roomUrl.origin}/api/room/enroll`, {
  method: "POST",
  headers: {
    Authorization: `Bearer ${token}`,
    "Content-Type": "application/json",
  },
  body: JSON.stringify({ name }),
  signal: AbortSignal.timeout(5000),
});
if (!enrollment.ok) throw new Error(`Room join failed (${enrollment.status})`);
const credentials = (await enrollment.json()) as {
  participantId: string;
  publisherToken: string;
};
let stopped = false;
let timer: ReturnType<typeof setTimeout> | undefined;
async function publish() {
  if (stopped) return;
  try {
    const s = await read();
    s.agents = s.agents
      .filter((a) => selected.has(a.agentId))
      .map((a) => ({
        ...a,
        parentAgentId:
          a.parentAgentId && selected.has(a.parentAgentId)
            ? a.parentAgentId
            : null,
        task: details ? a.task : null,
        role: details ? a.role : null,
        recentActivity: details
          ? a.recentActivity.map((x) => ({ ...x, sourceItemId: null }))
          : [],
      }));
    const projects = new Set(s.agents.map((a) => a.projectId));
    s.projects = s.projects
      .filter((p) => projects.has(p.projectId))
      .map((p) => ({ ...p, cwd: null }));
    s.pendingRequests = s.pendingRequests
      .filter((r) => selected.has(r.agentId))
      .map((r) => ({
        ...r,
        prompt: details ? r.prompt : null,
        options: details ? r.options : [],
      }));
    s.recentHandoffs = s.recentHandoffs
      .filter((h) => selected.has(h.fromAgentId) && selected.has(h.toAgentId))
      .map((h) => ({
        ...h,
        summary: details ? h.summary : "Observed handoff between shared pets.",
      }));
    delete s.controlToken;
    const result = await fetch(`${roomUrl.origin}/api/room/publish`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${credentials.publisherToken}`,
        "X-Participant-Id": credentials.participantId,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(s),
      signal: AbortSignal.timeout(5000),
    });
    if (!result.ok) throw new Error(`Room refused update (${result.status})`);
  } catch (error) {
    console.error(
      error instanceof Error ? error.message : "Room update failed",
    );
  } finally {
    if (!stopped) timer = setTimeout(() => void publish(), 2000);
  }
}
console.log(
  `Sharing ${selected.size} selected pets as ${name}. ${details ? "Task and activity text included." : "Task text, prompts and local paths excluded."} Ctrl-C stops sharing only.`,
);
for (const signal of ["SIGINT", "SIGTERM"])
  process.once(signal, () => {
    stopped = true;
    clearTimeout(timer);
  });
await publish();
