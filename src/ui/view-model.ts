import type { OfficeAgent, OfficeSnapshot, PetAsset, RuntimeState } from '../shared/contract';
import type { OfficeClientState } from '../client/store';

export const REPLY_EXPLANATION = 'In-office replies are not available yet. Reply in the original Codex conversation; this office will update when the request is resolved.';

export const stateLabels: Record<RuntimeState, string> = {
  working: 'Working', idle: 'Idle', 'waiting-for-input': 'Waiting for input',
  'waiting-for-approval': 'Waiting for approval', error: 'Agent error', closed: 'Session closed', unknown: 'State unavailable',
};

export function attentionFor(agent: OfficeAgent, snapshot: OfficeSnapshot) {
  const requests = snapshot.pendingRequests.filter(request => request.agentId === agent.agentId);
  const ids = new Set([...agent.pendingRequestIds, ...requests.map(request => request.requestId)]);
  return { requests, count: ids.size, missingCount: [...ids].filter(id => !requests.some(request => request.requestId === id)).length };
}

export function isWaiting(agent: OfficeAgent) {
  return agent.runtimeState === 'waiting-for-input' || agent.runtimeState === 'waiting-for-approval';
}

export function hasFixtureData(snapshot: OfficeSnapshot | null) {
  return snapshot?.source === 'fixture' || !!snapshot?.agents.some(agent => agent.recentActivity.some(activity => activity.source === 'fixture'));
}

export function connectionView(state: OfficeClientState) {
  if (state.transport.status === 'connecting') return { label: 'Connecting to office', tone: 'quiet', stale: !!state.snapshot, detail: state.transport.message ?? 'Looking for the local Codex bridge.' };
  if (state.transport.status !== 'connected') return {
    label: state.transport.status === 'reconnecting' ? 'Reconnecting' : 'Connection lost', tone: 'warning', stale: !!state.snapshot,
    detail: state.transport.message ?? 'The office cannot receive updates. Existing agents may still be working.',
  };
  const connection = state.snapshot?.connection;
  if (!connection || connection.status === 'unsupported') return { label: 'No Codex adapter', tone: 'quiet', stale: false, detail: connection?.message ?? 'No supported agent source is connected.' };
  if (connection.status !== 'connected') return { label: connection.status === 'reconnecting' ? 'Source reconnecting' : 'Source disconnected', tone: 'warning', stale: true, detail: connection.message ?? 'The last observed state is shown. This does not mean agents have stopped.' };
  return { label: hasFixtureData(state.snapshot) ? 'Development stream' : 'Connected to Codex', tone: 'positive', stale: false, detail: connection.message ?? 'Showing observed agent activity.' };
}

export function nativeAssetFor(agent: OfficeAgent, assets: PetAsset[]): PetAsset | null {
  const asset = assets.find(candidate => candidate.assetId === agent.petAssetId);
  if (!asset || !['chatgpt', 'codex'].includes(asset.origin) || !asset.imageUrl ||
      !Number.isInteger(asset.columns) || asset.columns < 1 || !Number.isInteger(asset.rows) || asset.rows < 1 ||
      !Number.isFinite(asset.width) || asset.width <= 0 || !Number.isFinite(asset.height) || asset.height <= 0) return null;
  const animations = Object.values(asset.animations);
  if (!animations.length || animations.some(animation => !Number.isInteger(animation.row) || animation.row < 0 || animation.row >= asset.rows ||
    !Number.isInteger(animation.frames) || animation.frames < 1 || animation.frames > asset.columns || !Number.isFinite(animation.fps) || animation.fps <= 0)) return null;
  return asset;
}

export function animationFor(asset: PetAsset, state: RuntimeState) {
  const choices = state === 'error' ? ['failed', 'idle'] : state.startsWith('waiting-') ? ['waiting', 'idle'] : state === 'working' ? ['review', 'working', 'idle'] : ['idle'];
  const name = choices.find(choice => asset.animations[choice]) ?? Object.keys(asset.animations)[0];
  return asset.animations[name];
}

export function timeLabel(timestamp: string | null) {
  if (!timestamp || Number.isNaN(Date.parse(timestamp))) return 'Time unavailable';
  return new Intl.DateTimeFormat(undefined, { hour: '2-digit', minute: '2-digit', second: '2-digit' }).format(new Date(timestamp));
}
