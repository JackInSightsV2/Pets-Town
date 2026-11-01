import type { OfficeAgent, OfficeSnapshot, RuntimeState } from '../../shared/contract';
import type { Meeting, MeetingToken } from '../handoffs/meeting-queue';
import type { OfficeGeometry, OfficeLayout, Point } from '../layout';
import type { LifecycleToken, SpriteLifecycle } from '../lifecycle/controller';
import { planFamilyProximity } from '../family-proximity';
import { checkInAnimationName, createCheckInController, type DecorativeCheckIn } from '../check-ins/controller';

export const OFFICE_WALK_MS = 1100;
export const OFFICE_EXCHANGE_MS = 4000;
export type OfficeMeetingPhase = 'none' | 'approaching' | 'exchanging' | 'returning';
export interface OfficeBehaviorInput {
  snapshot: OfficeSnapshot | null;
  visibleAgents: readonly OfficeAgent[];
  layout: OfficeLayout;
  geometry: OfficeGeometry;
  entrances: ReadonlyMap<string, Point>;
  standups: ReadonlyMap<string, Point>;
  rests: ReadonlyMap<string, Point>;
  lifecycles: readonly SpriteLifecycle[];
  /** Changes only for an accepted authoritative snapshot, never ordinary polling renders. */
  snapshotRevision: number;
  transportConnected: boolean;
  meeting: Meeting | null;
  realHandoffPending: boolean;
  reducedMotion: boolean;
}
export interface OfficePetPlacement {
  agent: OfficeAgent;
  /** Native pose only; the observed agent and its runtime metadata stay intact. */
  visualState: RuntimeState;
  home: Point;
  entrance: Point;
  standup: Point;
  point: Point;
  location: 'entrance' | 'standup' | 'rest' | 'home' | 'family' | 'water-cooler';
  participantIndex: number;
  animationName: string | undefined;
  lifecyclePhase: SpriteLifecycle['phase'];
  motion: 'settled' | 'arriving' | 'entering' | 'leaving';
}
export interface OfficeBehaviorFrame {
  placed: OfficePetPlacement[];
  meeting: Meeting | null;
  meetingPhase: OfficeMeetingPhase;
  checkIn: DecorativeCheckIn | null;
  /** Decorative office small talk, never observed activity or a handoff. */
  speech: { agentId: string; text: string } | null;
  completedMeetings: MeetingToken[];
  completedLifecycles: LifecycleToken[];
}
type MeetingRun = { key: string; meeting: Meeting; startedAt: number; reducedMotion: boolean; returns: Map<string, Point> };
type MotionRun = { key: string; token: LifecycleToken; startedAt: number; duration: number };
const meetingKey = (meeting: Meeting) => JSON.stringify([meeting.token.generation, meeting.token.serial, meeting.token.handoffId]);
const lifecycleKey = (token: LifecycleToken) => JSON.stringify([token.generation, token.serial, token.agentId, token.turnId]);
const samePoint = (a: Point, b: Point) => a.x === b.x && a.y === b.y;
const attention = (agent: OfficeAgent, snapshot: OfficeSnapshot | null) => agent.pendingRequestIds.length > 0
  || agent.runtimeState === 'waiting-for-input' || agent.runtimeState === 'waiting-for-approval'
  || !!snapshot?.pendingRequests.some(request => request.agentId === agent.agentId);
const CHATTER = ['Lovely spot for a breather.', 'Anyone fancy a biscuit?', 'The coffee smells good.',
  'This chair is surprisingly comfy.', 'Nice weather out here.', 'I could get used to this view.'];

/** One presentation owner: attention/lifecycle, real handoff, decorative wave, proximity and small talk.
 * The source and its accepted-delivery lifecycle controller remain authoritative.
 * No callbacks or runtime mutations happen here; the hook consumes completion tokens.
 */
export function createOfficeBehaviorController(options: { checkInIntervalMs?: number; checkInDurationMs?: number } = {}) {
  const checkIns = createCheckInController({ intervalMs: options.checkInIntervalMs, durationMs: options.checkInDurationMs });
  let context = '';
  let spatialContext = '';
  let previousPresentation = '';
  let run: MeetingRun | null = null;
  let retiredMeeting: string | null = null;
  let pendingMeetingCompletion: MeetingToken | null = null;
  let previousPositions = new Map<string, Point>();
  const poseAnchors = new Map<string, Point>();
  const motions = new Map<string, MotionRun>();
  const finishedMotions = new Map<string, { key: string; acknowledged: boolean }>();
  let chatterKey = '';
  let chatterStartedAt = 0;
  let nextChatterAt = 0;
  let speech: (NonNullable<OfficeBehaviorFrame['speech']> & { endsAt: number }) | null = null;
  let lastNow = 0;
  return {
    update(input: OfficeBehaviorInput, now: number): OfficeBehaviorFrame {
      if (!Number.isFinite(now) || now < lastNow) throw new RangeError('Office behavior requires a monotonic clock.');
      lastNow = now;
      const { snapshot, layout, geometry } = input;
      const state = snapshot?.presentation.state ?? 'ready';
      const connected = input.transportConnected && snapshot?.connection.status === 'connected';
      const nextSpatialContext = JSON.stringify([snapshot?.bridgeEpoch, snapshot?.officeSessionId, geometry]);
      const nextContext = JSON.stringify([snapshot?.bridgeEpoch, snapshot?.officeSessionId, input.snapshotRevision, state,
        connected, geometry]);
      if (context !== nextContext) {
        // Retain the old token as cancelled even if a stale caller presents it again.
        retiredMeeting = run?.key ?? retiredMeeting;
        context = nextContext;
        run = null;
        motions.clear();
        if (spatialContext !== nextSpatialContext || previousPresentation !== state) previousPositions.clear();
        if (spatialContext !== nextSpatialContext) poseAnchors.clear();
        checkIns.reset();
        chatterKey = '';
        speech = null;
      }
      spatialContext = nextSpatialContext;
      previousPresentation = state;
      const lifecycle = new Map(input.lifecycles.map(value => [value.agentId, value]));
      // Windows can prove a fresh current turn before runtime metadata catches up.
      // Project that independent evidence only into visual planning; never rewrite
      // the observed roster or override explicit waiting/error/closed metadata.
      const behaviorAgents = (snapshot?.agents ?? []).map(agent => {
        const life = lifecycle.get(agent.agentId);
        return agent.runtimeState === 'unknown' && life?.status === 'started' && life.phase === 'present' && life.pose === 'awake'
          ? { ...agent, runtimeState: 'working' as const } : agent;
      });
      const visualStates = new Map(behaviorAgents.map(agent => [agent.agentId, agent.runtimeState]));
      const completedLifecycles: LifecycleToken[] = [];
      const completedMeetings: MeetingToken[] = [];
      const nativeAgents = input.visibleAgents.filter(agent => (agent.runtimeState !== 'closed' || lifecycle.get(agent.agentId)?.phase === 'dying')
        && snapshot?.petAssets.some(asset => asset.assetId === agent.petAssetId)
        && (attention(agent, snapshot) || lifecycle.get(agent.agentId)?.visible !== false));
      const rendered = new Set(nativeAgents.map(agent => agent.agentId));
      const reserved = new Set<string>();
      const eligible = (id: string) => {
        const agent = nativeAgents.find(agent => agent.agentId === id);
        const life = lifecycle.get(id);
        // Unknown lifecycle evidence preserves existing observed presence and genuine
        // source handoffs. Neither is evidence that a turn started or finished.
        return !!agent && !attention(agent, snapshot) && agent.runtimeState !== 'error'
          && (!life || life.phase === 'unknown' || life.meetingEligible);
      };
      for (const life of input.lifecycles) {
        if (life.attention || (life.phase !== 'unknown' && life.phase !== 'present')) reserved.add(life.agentId);
        if (!life.token || !connected || state !== 'live') { motions.delete(life.agentId); continue; }
        const key = lifecycleKey(life.token);
        const finished = finishedMotions.get(life.agentId);
        if (finished?.key === key) {
          if (!finished.acknowledged) completedLifecycles.push({ ...life.token });
          continue;
        }
        const agent = nativeAgents.find(agent => agent.agentId === life.agentId);
        const asset = snapshot?.petAssets.find(asset => asset.assetId === agent?.petAssetId);
        const death = asset?.animations.failed;
        const duration = !rendered.has(life.agentId) || input.reducedMotion ? 0
          : life.phase === 'dying' ? death ? death.frames / death.fps * 1000 : OFFICE_WALK_MS
          : life.phase === 'entering' || life.phase === 'leaving' ? OFFICE_WALK_MS : 0;
        let motion = motions.get(life.agentId);
        if (motion?.key !== key) {
          motion = { key, token: life.token, startedAt: now, duration };
          motions.set(life.agentId, motion);
        }
        if (now >= motion.startedAt + (input.reducedMotion ? 0 : motion.duration)) {
          completedLifecycles.push({ ...life.token });
          finishedMotions.set(life.agentId, { key, acknowledged: false });
          motions.delete(life.agentId);
        }
      }
      for (const id of motions.keys()) if (!lifecycle.has(id)) motions.delete(id);
      for (const id of finishedMotions.keys()) if (!lifecycle.has(id)) finishedMotions.delete(id);

      const key = input.meeting ? meetingKey(input.meeting) : '';
      if (pendingMeetingCompletion && JSON.stringify([pendingMeetingCompletion.generation, pendingMeetingCompletion.serial, pendingMeetingCompletion.handoffId]) !== key) pendingMeetingCompletion = null;
      const pair = input.meeting ? [input.meeting.handoff.fromAgentId, input.meeting.handoff.toAgentId] : [];
      const meetingAvailable = connected && state === 'live' && pair.length === 2 && pair.every(eligible);
      if (run && (run.key !== key || !meetingAvailable)) {
        retiredMeeting = run.key;
        // Release the queue so an unavailable pair cannot block unrelated real work.
        if (run.key === key && connected && state === 'live') pendingMeetingCompletion = { ...run.meeting.token };
        run = null;
      }
      if (input.meeting && !meetingAvailable && connected && state === 'live' && retiredMeeting !== key) {
        retiredMeeting = key;
        pendingMeetingCompletion = { ...input.meeting.token };
      }
      const baseline = new Map<string, Point>();
      const locations = new Map<string, OfficePetPlacement['location']>();
      for (const agent of nativeAgents) {
        const id = agent.agentId;
        const life = lifecycle.get(id);
        const location = state === 'ready' ? 'entrance' : state === 'arrivals' || state === 'standup' ? 'standup'
          : agent.runtimeState === 'idle' && life?.phase !== 'sleeping' ? 'rest' : 'home';
        const point = location === 'entrance' ? input.entrances.get(id) : location === 'standup' ? input.standups.get(id)
          : location === 'rest' ? input.rests.get(id) : layout.homes.get(id);
        if (point) {
          let settled = point;
          if (state === 'live' && (life?.phase === 'sleeping' || life?.phase === 'dying')) {
            settled = poseAnchors.get(id) ?? previousPositions.get(id) ?? point;
            poseAnchors.set(id, { ...settled });
          } else poseAnchors.delete(id);
          // Connectivity is not movement evidence. Keep the last settled layout
          // while stale; a real meeting still cancels back to its captured return.
          if (state === 'live' && !connected) settled = previousPositions.get(id) ?? settled;
          baseline.set(id, { ...settled });
          locations.set(id, samePoint(settled, point) ? location : 'family');
        }
        if (attention(agent, snapshot) || reserved.has(id) || !connected) reserved.add(id);
      }
      for (const id of poseAnchors.keys()) if (!rendered.has(id)) poseAnchors.delete(id);
      if (run) for (const [id, point] of run.returns) if (baseline.has(id)) baseline.set(id, point);
      const fixed = new Set([...reserved, ...run?.returns.keys() ?? []]);
      const bounds = { x: 0, y: 0, width: Math.max(layout.width, ...[...baseline.values()].map(point => point.x + geometry.spacing.x / 2)),
        height: Math.max(layout.height, ...[...baseline.values()].map(point => point.y + geometry.spacing.y / 2)) };
      const positions = state === 'live' && connected ? planFamilyProximity({ agents: behaviorAgents, positions: baseline,
        bounds, spacing: geometry.spacing, maxRings: 2, reservedHomes: layout.homes,
        // An idle transition can happen during a meeting. Keep every rest slot
        // free when choosing family positions so captured returns remain safe.
        reservedPoints: [...layout.waterCooler, ...input.rests.values()],
        fixedAgentIds: fixed }).positions : baseline;
      if (!run && input.meeting && meetingAvailable && retiredMeeting !== key) {
        run = { key, meeting: structuredClone(input.meeting), startedAt: now, reducedMotion: input.reducedMotion,
          returns: new Map(pair.map(id => [id, { ...(previousPositions.get(id) ?? positions.get(id)!) }])) };
      }
      let phase: OfficeMeetingPhase = 'none';
      if (run) {
        const elapsed = now - run.startedAt;
        const walk = run.reducedMotion ? 0 : OFFICE_WALK_MS;
        if (elapsed >= walk * 2 + OFFICE_EXCHANGE_MS) {
          pendingMeetingCompletion = { ...run.meeting.token };
          retiredMeeting = run.key;
          run = null;
        } else phase = elapsed < walk ? 'approaching' : elapsed < walk + OFFICE_EXCHANGE_MS ? 'exchanging' : 'returning';
      }
      const checkIn = checkIns.update({ snapshot: snapshot ? { ...snapshot, agents: behaviorAgents } : null, transportConnected: input.transportConnected,
        visibleAgentIds: [...rendered], reservedAgentIds: [...reserved], realHandoffPending: input.realHandoffPending || !!input.meeting }, now);
      const placed: OfficePetPlacement[] = [];
      for (const agent of nativeAgents) {
        const id = agent.agentId;
        const home = layout.homes.get(id), entrance = input.entrances.get(id), standup = input.standups.get(id);
        const normal = positions.get(id);
        if (!home || !entrance || !standup || !normal) continue;
        const life = lifecycle.get(id);
        const asset = snapshot!.petAssets.find(asset => asset.assetId === agent.petAssetId)!;
        let point = run?.returns.get(id) ?? normal;
        let location = locations.get(id)!;
        if (!samePoint(normal, baseline.get(id)!)) location = 'family';
        const participantIndex = run ? [run.meeting.handoff.fromAgentId, run.meeting.handoff.toAgentId].indexOf(id) : -1;
        let animationName = checkInAnimationName(checkIn, id, asset, input.reducedMotion);
        let motion: OfficePetPlacement['motion'] = state === 'arrivals' ? 'arriving' : 'settled';
        if (participantIndex !== -1) {
          if (phase === 'approaching' || phase === 'exchanging') { point = layout.waterCooler[participantIndex]; location = 'water-cooler'; }
          else location = 'home';
          animationName = undefined;
        } else if (life && !attention(agent, snapshot)) {
          if (life.phase === 'leaving') { point = entrance; location = 'entrance'; motion = 'leaving'; }
          if (life.phase === 'entering') motion = 'entering';
          if (life.phase === 'sleeping') animationName = 'waiting';
          else if (life.phase === 'dying') animationName = 'failed';
          else if ((life.phase === 'entering' || life.phase === 'leaving') && !input.reducedMotion) {
            animationName = (life.phase === 'entering' ? point.x < entrance.x : entrance.x < normal.x) ? 'running-left' : 'running-right';
          }
        }
        if (state === 'ready') animationName = 'idle';
        else if (state === 'standup') animationName = 'waving';
        else if (state === 'arrivals') animationName = input.reducedMotion ? 'idle' : standup.x < entrance.x ? 'running-left' : 'running-right';
        if (attention(agent, snapshot)) animationName = undefined;
        // Keep NativePet's genuine-manifest fallback for any absent animation row.
        placed.push({ agent, visualState: visualStates.get(id) ?? agent.runtimeState, home: run?.returns.get(id) ?? normal, entrance, standup, point, location, participantIndex,
          animationName, lifecyclePhase: life?.phase ?? 'unknown', motion });
      }
      previousPositions = new Map(positions);
      // Share the scene clock with motion and waves. Small talk is limited to
      // nearby, observed idle pets and yields immediately to higher priorities.
      const resting = placed.filter(pet => pet.location === 'rest' && pet.agent.runtimeState === 'idle'
        && !attention(pet.agent, snapshot) && !reserved.has(pet.agent.agentId) && pet.motion === 'settled'
        && (pet.lifecyclePhase === 'present' || pet.lifecyclePhase === 'unknown'));
      const candidates = connected && state === 'live' && !input.realHandoffPending && !input.meeting && !checkIn
        ? resting.filter(pet => resting.some(other => other !== pet
          && !!(pet.agent.parentAgentId || other.agent.parentAgentId)
          && Math.hypot(pet.point.x - other.point.x, pet.point.y - other.point.y) <= 150)).map(pet => pet.agent.agentId)
        : [];
      const nextChatterKey = JSON.stringify(candidates);
      if (chatterKey !== nextChatterKey) {
        chatterKey = nextChatterKey;
        chatterStartedAt = now;
        nextChatterAt = now + 1800;
        speech = null;
      }
      if (speech && now >= speech.endsAt) speech = null;
      if (candidates.length && now >= nextChatterAt) {
        speech = { agentId: candidates[Math.floor(Math.random() * candidates.length)],
          text: CHATTER[Math.floor(Math.random() * CHATTER.length)], endsAt: now + 3500 };
        // Keep the original cadence: first at 1.8s, then 9s, 18s, etc.
        // A delayed render emits only one bubble, never a backlog of chatter.
        nextChatterAt = chatterStartedAt + (Math.floor((now - chatterStartedAt) / 9000) + 1) * 9000;
      }
      // Keep completion available until the source consumes it. React can discard
      // a render; generation/token checks make repeated acknowledgements harmless.
      if (pendingMeetingCompletion && connected && state === 'live') completedMeetings.push({ ...pendingMeetingCompletion });
      return { placed, meeting: run?.meeting ?? null, meetingPhase: phase, checkIn,
        speech: speech ? { agentId: speech.agentId, text: speech.text } : null, completedMeetings, completedLifecycles };
    },
    /** Call only from a committed render, after forwarding token completions. */
    acknowledge(frame: OfficeBehaviorFrame) {
      for (const token of frame.completedLifecycles) {
        const finished = finishedMotions.get(token.agentId);
        if (finished?.key === lifecycleKey(token)) finished.acknowledged = true;
      }
      for (const token of frame.completedMeetings) {
        if (pendingMeetingCompletion && token.generation === pendingMeetingCompletion.generation
          && token.serial === pendingMeetingCompletion.serial && token.handoffId === pendingMeetingCompletion.handoffId) pendingMeetingCompletion = null;
      }
    },
  };
}
