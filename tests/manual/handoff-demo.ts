import { createMeetingQueue } from '../../src/office/handoffs/meeting-queue.js';
import { builtInPets } from '../../src/shared/pets.js';
import type { OfficeAgent, OfficeHandoff } from '../../src/shared/contract.js';

const byId = <T extends HTMLElement>(id: string): T => {
  const element = document.getElementById(id);
  if (!element) throw new Error(`Missing demo element: ${id}`);
  return element as T;
};
const start = byId<HTMLButtonElement>('start');
const skip = byId<HTMLButtonElement>('skip');
const reset = byId<HTMLButtonElement>('reset');
const fail = byId<HTMLButtonElement>('fail');
const showThird = byId<HTMLInputElement>('show-third');
const pets = byId<HTMLDivElement>('pets');
const status = byId<HTMLParagraphElement>('status');
const queueLabel = byId<HTMLParagraphElement>('queue');
const log = byId<HTMLOListElement>('log');
const queue = createMeetingQueue({ maxQueued: 8 });

const agent = (agentId: string, displayName: string, petAssetId: string): OfficeAgent => ({
  agentId, displayName, petAssetId, parentAgentId: null, projectId: 'synthetic-project',
  role: null, task: null, runtimeState: 'working', activityKind: 'communicating',
  lastObservedAt: null, pendingRequestIds: [], recentActivity: [],
});
const freshAgents = (): OfficeAgent[] => [
  agent('codex', 'Codex', 'codex'),
  agent('dewey', 'Dewey', 'dewey'),
  agent('hoots', 'Hoots', 'hoots'),
];
let agents = freshAgents();
let active: { token: { generation: number; serial: number; handoffId: string }; handoff: OfficeHandoff } | null = null;
let meetingTimer: number | undefined;
let sequence = 0;
const homes: Record<string, number> = { codex: 15, dewey: 50, hoots: 85 };
const nodes = new Map<string, { root: HTMLDivElement; image: HTMLImageElement; bubble: HTMLDivElement }>();

function appendLog(message: string): void {
  const item = document.createElement('li');
  item.textContent = message;
  log.prepend(item);
  while (log.children.length > 8) log.lastElementChild?.remove();
}

function buildPets(): void {
  pets.replaceChildren();
  nodes.clear();
  for (const person of agents) {
    const asset = builtInPets.find(item => item.assetId === person.petAssetId);
    if (!asset) continue;
    const root = document.createElement('div');
    root.className = 'pet';
    root.style.left = `${homes[person.agentId]}%`;
    const bubble = document.createElement('div');
    bubble.className = 'bubble';
    const sprite = document.createElement('span');
    sprite.className = 'sprite';
    sprite.setAttribute('role', 'img');
    sprite.setAttribute('aria-label', `${asset.name} native pet`);
    const image = document.createElement('img');
    image.src = asset.imageUrl;
    image.alt = '';
    image.draggable = false;
    const fallback = document.createElement('span');
    fallback.className = 'sprite-fallback';
    fallback.textContent = 'Pet unavailable';
    image.addEventListener('error', () => { image.hidden = true; sprite.classList.add('unavailable'); });
    sprite.append(image, fallback);
    const label = document.createElement('span');
    label.className = 'pet-name';
    label.textContent = person.displayName;
    root.append(bubble, sprite, label);
    pets.append(root);
    nodes.set(person.agentId, { root, image, bubble });
  }
  applyVisibility();
}

function visibleIds(): string[] {
  return agents.filter(person => person.agentId !== 'hoots' || showThird.checked).map(person => person.agentId);
}
function applyVisibility(): void {
  const visible = new Set(visibleIds());
  for (const [id, node] of nodes) node.root.hidden = !visible.has(id);
}
function homePets(): void {
  for (const [id, node] of nodes) {
    node.root.style.left = `${homes[id]}%`;
    node.bubble.textContent = '';
  }
}
function clearTimer(): void {
  if (meetingTimer !== undefined) window.clearTimeout(meetingTimer);
  meetingTimer = undefined;
}
function processEffects(): void {
  for (const effect of queue.drainEffects()) {
    if (effect.type === 'start') {
      clearTimer();
      active = effect.meeting;
      const { handoff, token } = effect.meeting;
      homePets();
      const from = nodes.get(handoff.fromAgentId);
      const to = nodes.get(handoff.toAgentId);
      if (from) { from.root.style.left = '39%'; from.bubble.textContent = handoff.summary; }
      if (to) { to.root.style.left = '61%'; to.bubble.textContent = 'Handoff observed'; }
      status.textContent = `Synthetic meeting: ${handoff.fromAgentId} → ${handoff.toAgentId}`;
      appendLog(`Meeting started: ${handoff.summary}`);
      meetingTimer = window.setTimeout(() => {
        queue.complete(token);
        processEffects();
      }, 7000);
    } else if (effect.type === 'end') {
      clearTimer();
      active = null;
      homePets();
      status.textContent = `Meeting ended: ${effect.reason}.`;
      appendLog(`Meeting ended: ${effect.reason}.`);
    } else if (effect.type === 'hidden') {
      appendLog(`Hidden participant: ${effect.signal.hiddenAgentIds.join(', ')}. No meeting is shown for this handoff.`);
    } else if (effect.type === 'clear-hidden') {
      appendLog(`Hidden signal cleared for ${effect.handoffId}.`);
    }
  }
  skip.disabled = active === null;
  fail.disabled = active === null;
  const state = queue.getState();
  queueLabel.textContent = `${state.active ? 'One meeting is active' : 'No meeting is active'}; ${state.queued.length} waiting; ${state.hiddenSignals.length} hidden signal(s).`;
}

function handoff(fromAgentId: string, toAgentId: string, summary: string): OfficeHandoff {
  sequence += 1;
  return {
    handoffId: `synthetic-${sequence}`, fromAgentId, toAgentId, summary,
    occurredAt: new Date().toISOString(), sourceItemId: `synthetic-item-${sequence}`,
  };
}

start.addEventListener('click', () => {
  queue.setPresentation('live');
  queue.setAgents(agents, visibleIds());
  processEffects();
  queue.observe(handoff('codex', 'dewey', 'The draft is ready for review.'));
  processEffects();
  queue.observe(handoff('dewey', 'hoots', 'The review notes are ready.'));
  processEffects();
  start.disabled = true;
});
skip.addEventListener('click', () => {
  if (!active) return;
  queue.complete(active.token);
  processEffects();
});
fail.addEventListener('click', () => {
  if (!active) return;
  const id = active.handoff.fromAgentId;
  agents = agents.map(person => person.agentId === id ? { ...person, runtimeState: 'error' } : person);
  appendLog(`Synthetic failure: ${id} entered error state.`);
  queue.setAgents(agents, visibleIds());
  processEffects();
});
showThird.addEventListener('change', () => {
  applyVisibility();
  queue.setAgents(agents, visibleIds());
  processEffects();
});
reset.addEventListener('click', () => {
  clearTimer();
  queue.reset();
  processEffects();
  agents = freshAgents();
  active = null;
  showThird.checked = true;
  start.disabled = false;
  log.replaceChildren();
  buildPets();
  queue.setAgents(agents, visibleIds());
  queue.setPresentation('ready');
  processEffects();
  status.textContent = 'Ready to start.';
});

buildPets();
queue.setAgents(agents, visibleIds());
queue.setPresentation('ready');
// Animate only frames declared by the native atlas; reduced-motion users see the first frame.
if (!window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
  let frame = 0;
  window.setInterval(() => {
    frame = (frame + 1) % 6;
    for (const node of nodes.values()) node.image.style.left = `-${frame * 72}px`;
  }, 1000 / 6);
}
