import { useEffect, useState, useSyncExternalStore } from 'react';
import type { HandoffStore } from '../client/handoffs';
import type { OfficeAgent, OfficeSnapshot } from '../shared/contract';
import { OfficeScene } from './OfficeScene';
import { NativePet } from './NativePet';
import { attentionFor, connectionView, hasFixtureData, isWaiting, nativeAssetFor, stateLabels, timeLabel } from './view-model';
import './styles.css';
import './groups.css';
import './inspector.css';
import { buildAgentGroups } from '../office/layout';
import { officeGeometry } from '../office/environment';

type PresentationAction = 'start' | 'skip' | 'reset';
interface AppProps { store: HandoffStore; onPresentationAction(action: PresentationAction): Promise<void> }

function Mark({ small = false }: { small?: boolean }) {
  return <span className={`brand-mark ${small ? 'small' : ''}`} aria-hidden="true"><svg viewBox="0 0 32 32"><path d="M5 25V12L16 5l11 7v13H5Z"/><path d="M11 25V15h10v10M9 12h14M16 5v5"/></svg></span>;
}

function Status({ agent }: { agent: OfficeAgent }) {
  return <span className={`status-pill state-${agent.runtimeState}`}><span className="status-dot" />{stateLabels[agent.runtimeState]}</span>;
}

function AgentRow({ agent, snapshot, selected, onSelect, childRequests = 0 }: { agent: OfficeAgent; snapshot: OfficeSnapshot; selected: boolean; onSelect(): void; childRequests?: number }) {
  const attention = attentionFor(agent, snapshot);
  const asset = nativeAssetFor(agent, snapshot.petAssets);
  return <button type="button" className={`agent-card ${selected ? 'is-selected' : ''} ${agent.parentAgentId ? 'is-subagent' : ''}`} data-testid={`agent-button-${agent.agentId}`} aria-label={`Select ${agent.displayName}`} aria-pressed={selected} onClick={onSelect}>
    <span className="agent-portrait" aria-hidden="true">{asset ? <NativePet asset={asset} state={agent.runtimeState} size={41} /> : <span className="agent-monogram">{agent.displayName.slice(0, 2).toUpperCase()}</span>}</span>
    <span className="agent-card-content"><span className="agent-card-name">{agent.parentAgentId && <span className="subagent-arrow" aria-label="Subagent">↳</span>}{agent.displayName}</span><span className="agent-card-role">{agent.role ?? 'Role not available'}</span><Status agent={agent} /></span>
    <span className="agent-card-trailing">{attention.count > 0 && <span className="attention-badge" data-testid={`attention-${agent.agentId}`} aria-label={`${attention.count} unresolved ${attention.count === 1 ? 'request' : 'requests'}`}>!<span>{attention.count}</span></span>}{childRequests > 0 && <span className="group-attention" aria-label={`${childRequests} pending requests or waiting signals from hidden subagents`}>+{childRequests} !</span>}<span className="selection-arrow" aria-hidden="true">↗</span></span>
  </button>;
}

function Inspector({ agent, snapshot, stale, selectedMissing }: { agent: OfficeAgent | null; snapshot: OfficeSnapshot | null; stale: boolean; selectedMissing: boolean }) {
  if (!agent || !snapshot) return <aside className="inspector inspector-empty" data-testid="agent-inspector" aria-label="Agent inspection">
    <div className="inspector-topline"><span className="eyebrow">THE INSIDE STORY</span><span className="panel-index">02 / INSPECT</span></div>
    <div className="inspection-placeholder"><span className="inspection-symbol" aria-hidden="true">↖</span><h2>{selectedMissing ? 'Agent not in this snapshot' : 'Meet your workmates.'}</h2><p>{selectedMissing ? 'The selected identity is preserved. Its latest details are unavailable from the current source.' : 'Select a pet or an agent in the roster to see what it is working on and where it needs you.'}</p><div className="placeholder-rule"/><span>Real activity. A little more personality.</span></div>
    <div className="inspector-bottom-note">Your agents keep working in Codex.</div>
  </aside>;
  const attention = attentionFor(agent, snapshot);
  const waitingWithoutDetails = (isWaiting(agent) && attention.requests.length === 0) || attention.missingCount > 0;
  const project = snapshot.projects.find(project => project.projectId === agent.projectId);
  const asset = nativeAssetFor(agent, snapshot.petAssets);
  return <aside className="inspector" data-testid="agent-inspector" aria-label={`Inspecting ${agent.displayName}`}>
    <div className="inspector-topline"><span className="eyebrow">THE INSIDE STORY</span><span className="panel-index">02 / INSPECT</span></div>
    <div className="inspector-identity"><div className="inspector-portrait">{asset ? <NativePet asset={asset} state={agent.runtimeState} size={70} /> : <span className="identity-placeholder" aria-hidden="true">{agent.displayName.slice(0, 2).toUpperCase()}</span>}</div><div><span className="eyebrow">{agent.parentAgentId ? 'SUBAGENT' : 'MAIN AGENT'}</span><h2 data-testid="selected-agent-name">{agent.displayName}</h2><p>{agent.role ?? 'Role not available'}</p></div></div>
    <div className="inspector-status"><Status agent={agent} />{attention.count > 0 && <span className="request-count">{attention.count} needs {attention.count === 1 ? 'a reply' : 'attention'}</span>}</div>
    <div className="inspector-chat-action">{snapshot.source === 'codex' ? <a className="open-chat-link" data-testid="open-chat" href={`codex://threads/${encodeURIComponent(agent.agentId)}`} aria-label={`Open ${agent.displayName} in Codex`}>Open chat <span aria-hidden="true">↗</span></a> : <p className="muted-note">Fixture agents do not have a Codex chat.</p>}</div>
    {stale && <div className="inline-notice stale-notice" data-testid="stale-agent-data"><strong>Last observed state</strong><p>The source is unavailable. This agent's current state may have changed.</p></div>}
    {agent.runtimeState === 'error' && <div className="inline-notice error-notice" role="status" data-testid="agent-error"><strong>This agent reported an error.</strong><p>This is an agent state, separate from the office connection. Check its original Codex conversation for details.</p></div>}
    <section className="inspector-section"><div className="section-heading"><h3>On the desk</h3><span className="section-symbol" aria-hidden="true">↗</span></div><p className="task-text" data-testid="agent-task">{agent.task ?? 'Current task not available from this source.'}</p><dl className="agent-facts"><div><dt>Project</dt><dd>{project?.displayName ?? 'Project details unavailable'}</dd></div><div><dt>Last observed</dt><dd><time dateTime={agent.lastObservedAt ?? undefined}>{timeLabel(agent.lastObservedAt)}</time></dd></div></dl></section>
    <section className="inspector-section requests-section" aria-labelledby="requests-heading"><div className="section-heading"><h3 id="requests-heading">Needs your attention</h3><span className={`section-count ${attention.count ? 'has-requests' : ''}`}>{attention.count}</span></div>
      {attention.requests.map(request => <article className="request-card" key={request.requestId} data-testid={`request-${request.requestId}`}><div className="request-topline"><span className="request-type">{request.kind === 'approval' ? 'Approval requested' : request.kind === 'user-input' ? 'Input requested' : 'Pending request'}</span><time dateTime={request.createdAt}>{timeLabel(request.createdAt)}</time></div><p>{request.prompt ?? 'The request is pending, but its details are unavailable from this source.'}</p>{request.options.length > 0 && <ul className="request-options" aria-label="Observed request options">{request.options.map(option => <li key={option.id}><strong>{option.label}</strong>{option.description && <span>{option.description}</span>}</li>)}</ul>}<span className="request-persistence">Stays open until resolved in Codex</span></article>)}
      {waitingWithoutDetails && <div className="inline-notice waiting-notice" data-testid="waiting-details-unavailable"><strong>{attention.missingCount ? 'Request details unavailable' : 'Waiting · details unavailable'}</strong><p>{attention.missingCount ? 'An unresolved request was observed, but the source has not supplied its prompt.' : 'Codex reports that this agent is waiting. No question or approval details are available from this source.'}</p></div>}
      {attention.count === 0 && !isWaiting(agent) && <p className="muted-note" data-testid="no-pending-requests">No outstanding request observed.</p>}
      {(attention.count > 0 || isWaiting(agent)) && <p className="muted-note">Continue in the original Codex chat. This office updates when the request is resolved there.</p>}
    </section>
    <section className="inspector-section activity-section"><div className="section-heading"><h3>Recent activity</h3><span className="activity-live-dot"/></div>{agent.recentActivity.length ? <ol className="activity-list" data-testid="recent-activity">{agent.recentActivity.slice(0, 12).map(activity => <li key={activity.activityId}><span className="activity-timeline-dot"/><div><p>{activity.summary || 'Activity description not available.'}</p><div className="activity-meta"><time dateTime={activity.occurredAt}>{timeLabel(activity.occurredAt)}</time><span>{activity.kind === 'running-command' ? 'command' : activity.kind.replaceAll('-', ' ')}</span>{activity.source === 'fixture' && <span className="mini-fixture-label">Fixture</span>}</div></div></li>)}</ol> : <p className="muted-note">No recent visible activity supplied by this source.</p>}</section>
    <div className="inspector-bottom-note">Selection and scene controls do not change agent work.</div>
  </aside>;
}

export function App({ store, onPresentationAction }: AppProps) {
  const state = useSyncExternalStore(store.subscribe, store.getState, store.getState);
  const meetings = useSyncExternalStore(store.subscribeMeetings, store.getMeetingState, store.getMeetingState);
  const { snapshot, selectedAgentId } = state;
  const [showSubagents, setShowSubagents] = useState(true);
  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(() => new Set());
  const [pendingAction, setPendingAction] = useState<PresentationAction | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const connection = connectionView(state);
  const fixture = hasFixtureData(snapshot);
  const selectedAgent = snapshot?.agents.find(agent => agent.agentId === selectedAgentId) ?? null;
  const agents = snapshot?.agents ?? [];
  const groups = buildAgentGroups(agents.filter(agent => agent.runtimeState !== 'closed'));
  const visibleAgents = groups.flatMap(group => [
    ...(group.parent && (showSubagents || !group.parent.parentAgentId) ? [group.parent] : []),
    ...(showSubagents ? (expandedGroups.has(group.key) ? group.children : group.children.slice(0, 3)) : []),
  ]);
  const visibleIds = new Set(visibleAgents.map(agent => agent.agentId));
  const attentionCount = (agent: OfficeAgent) => snapshot ? Math.max(attentionFor(agent, snapshot).count, isWaiting(agent) ? 1 : 0) : 0;
  const toggleGroup = (key: string) => setExpandedGroups(previous => { const next = new Set(previous); if (next.has(key)) next.delete(key); else next.add(key); return next; });
  const visiblePetIds = JSON.stringify(visibleAgents.filter(agent => agent.runtimeState !== 'closed' && snapshot && nativeAssetFor(agent, snapshot.petAssets)).map(agent => agent.agentId));
  useEffect(() => { store.setVisibleAgents(JSON.parse(visiblePetIds) as string[]); }, [store, visiblePetIds]);
  const hiddenWithRequests = agents.filter(agent => !visibleIds.has(agent.agentId) && attentionCount(agent) > 0);
  const attentionTotal = agents.reduce((total, agent) => total + attentionCount(agent), 0);
  const activeCount = agents.filter(agent => agent.runtimeState !== 'closed').length;
  const projectIds = [...new Set([...snapshot?.projects.map(project => project.projectId) ?? [], ...agents.map(agent => agent.projectId)])];
  const presentation = snapshot?.presentation.state ?? 'ready';
  const canControl = !!snapshot?.controlToken && state.transport.status === 'connected' && !pendingAction;
  useEffect(() => {
    const select = (event: Event) => {
      const detail: unknown = (event as CustomEvent<unknown>).detail;
      if (detail && typeof detail === 'object' && 'agentId' in detail && typeof detail.agentId === 'string') store.selectAgent(detail.agentId);
    };
    window.addEventListener('petstown:select-agent', select);
    return () => window.removeEventListener('petstown:select-agent', select);
  }, [store]);
  async function act(action: PresentationAction) {
    setActionError(null); setPendingAction(action);
    try { await onPresentationAction(action); }
    catch (error) { setActionError(error instanceof Error ? error.message : 'The presentation could not be updated.'); }
    finally { setPendingAction(null); }
  }
  return <div className="app-shell" data-testid="office-app">
    <header className="site-header"><a className="brand" href="#office" aria-label="PetsTown office"><Mark/><span>PetsTown<span className="brand-period">.</span></span></a><div className="header-center">A LITTLE OFFICE FOR BIG IDEAS</div><div className={`connection-chip tone-${connection.tone}`} data-testid="connection-status" role="status"><span className="connection-dot"/>{connection.label}</div></header>
    {fixture && <div className="fixture-banner" data-testid="fixture-banner" role="status"><span className="fixture-icon" aria-hidden="true">D</span><strong>Fixture / Development Data</strong><span>Agent activity is for development. Pet artwork is genuine; this is not a live Codex session.</span></div>}
    {(connection.stale || state.error || (snapshot && (snapshot.connection.status === 'unsupported' || (snapshot.source === 'codex' && !!snapshot.connection.message)))) && <div className={`connection-notice tone-${connection.tone}`} data-testid="connection-notice"><span aria-hidden="true">↻</span><div><strong>{connection.stale ? 'Updates unavailable — showing the last observed state.' : connection.label}</strong><p>{state.error ?? connection.detail}</p></div></div>}
    <main id="office"><div className="page-intro"><div><div className="eyebrow intro-eyebrow"><span/> WELCOME TO YOUR WORKDAY</div><h1>Good work. <em>Good company.</em></h1><p>Your existing Codex agents, with a little room to roam.</p></div><div className="office-counts"><div><strong>{String(activeCount).padStart(2, '0')}</strong><span>in the office</span></div><span className="count-divider"/><div className={attentionTotal ? 'count-attention' : ''}><strong>{String(attentionTotal).padStart(2, '0')}</strong><span>need attention</span></div></div></div>
      <div className="workspace"><div className="office-column"><section className="office-panel" aria-labelledby="office-heading"><div className="office-toolbar"><div><span className="panel-index">01 / THE FLOOR</span><h2 id="office-heading">The shared office <span className="presentation-badge" data-testid="presentation-state">{presentation === 'ready' ? 'Ready when you are' : presentation === 'arrivals' ? 'Arrivals' : presentation === 'standup' ? 'Standup' : 'Live view'}</span></h2></div><div className="presentation-actions">{presentation === 'ready' ? <button className="primary-button" type="button" data-testid="start-day" disabled={!canControl} onClick={() => void act('start')}>{pendingAction === 'start' ? 'Starting…' : 'Start the day'}<span aria-hidden="true">↗</span></button> : <>{snapshot?.presentation.canSkip && <button className="primary-button" type="button" data-testid="skip-standup" disabled={!canControl} onClick={() => void act('skip')}>Skip to live office<span aria-hidden="true">→</span></button>}<button className="quiet-button" type="button" data-testid="reset-scene" disabled={!canControl} onClick={() => void act('reset')}><span aria-hidden="true">↻</span> Reset scene</button></>}</div></div>
        {actionError && <p className="action-error" role="alert">{actionError}</p>}
        <OfficeScene geometry={officeGeometry} snapshot={snapshot} selectedAgentId={selectedAgentId} visibleAgents={visibleAgents} onSelectAgent={store.selectAgent} meeting={meetings.active} onMeetingComplete={store.completeMeeting} hiddenHandoffCount={meetings.hiddenSignals.length}/>
        <div className="office-footnote"><span><span className="footnote-square"/> One shared space. Every project welcome.</span><span>Start, skip and reset change the scene only.</span></div>
      </section>
      {presentation === 'standup' && <section className="standup-summary" data-testid="standup-summary" aria-label="Observed standup updates"><span className="eyebrow">AROUND THE ROOM</span><h2>A quick check-in.</h2><p>Current tasks from the source. Work continues during the standup. {agents.filter(agent => agent.parentAgentId && agent.runtimeState !== 'closed').length} subagents observed.</p><div>{agents.filter(agent => !agent.parentAgentId).map(agent => <button type="button" key={agent.agentId} onClick={() => store.selectAgent(agent.agentId)}><strong>{agent.displayName}</strong><span>{agent.task ?? 'Current task not available.'}</span></button>)}</div></section>}
      <section className="roster-section" aria-labelledby="roster-heading"><div className="roster-heading"><div><span className="eyebrow">THE PEOPLE BEHIND THE PETS</span><h2 id="roster-heading">Around the office <span>{activeCount}</span></h2></div><label className="toggle-control"><input type="checkbox" checked={showSubagents} onChange={event => setShowSubagents(event.target.checked)} aria-label="Show subagents"/><span className="toggle-track" aria-hidden="true"/>Show subagents</label></div>
        {hiddenWithRequests.length > 0 && <div className="hidden-attention" data-testid="hidden-subagent-attention"><strong>Hidden agents still need you</strong><div>{hiddenWithRequests.map(agent => <button type="button" key={agent.agentId} data-testid={`inspect-hidden-${agent.agentId}`} onClick={() => store.selectAgent(agent.agentId)}>! {agent.displayName}<span>Inspect →</span></button>)}</div></div>}
        {groups.length === 0 ? <div className="roster-empty" data-testid="empty-agent-roster"><span className="empty-roster-icon" aria-hidden="true">⌁</span><div><h3>{state.transport.status === 'connecting' ? 'Opening the office…' : 'No active agents in this view'}</h3><p>{snapshot?.capabilities.observeAgents.reason ?? 'The roster will fill when the local bridge reports existing Codex agents.'}</p></div></div> : projectIds.map((projectId, projectIndex) => {
          const projectGroups = groups.filter(group => group.projectId === projectId);
          if (!projectGroups.length) return null;
          const projectAgents = projectGroups.flatMap(group => [...(group.parent ? [group.parent] : []), ...group.children]);
          const project = snapshot?.projects.find(project => project.projectId === projectId);
          return <div className="project-group" key={projectId}><div className="project-heading"><span className={`project-dot project-color-${projectIndex % 4}`}/><h3>{project?.displayName ?? 'Project details unavailable'}</h3><span>{projectAgents.length} {projectAgents.length === 1 ? 'agent' : 'agents'}</span>{project?.cwd && <code title={project.cwd}>{project.cwd}</code>}</div>
            {projectGroups.map(group => {
              const children = group.children.filter(agent => visibleIds.has(agent.agentId));
              const hidden = group.children.filter(agent => !visibleIds.has(agent.agentId));
              const needsAttention = hidden.reduce((sum, agent) => sum + attentionCount(agent), 0);
              const rows = [...(group.parent && visibleIds.has(group.parent.agentId) ? [group.parent] : []), ...children];
              return <div className="agent-family" key={group.key} data-testid={`agent-group-${group.parent?.agentId ?? group.key}`}>
                {(group.children.length > 0 || group.unparented) && <div className="agent-family-heading">
                  <span>{group.unparented ? <span data-testid="unobserved-parent">Parent not observed</span> : `${group.parent?.displayName ?? 'Agent'} and subagents`} · {group.children.length} {group.children.length === 1 ? 'subagent' : 'subagents'}</span>
                  {needsAttention > 0 && <span className="family-attention" role="status">! {needsAttention} need attention</span>}
                  {showSubagents && group.children.length > 3 && <button type="button" data-testid={`group-toggle-${group.parent?.agentId ?? group.key}`} aria-expanded={expandedGroups.has(group.key)} onClick={() => toggleGroup(group.key)}>{expandedGroups.has(group.key) ? 'Show fewer subagents' : `Show all ${group.children.length} subagents`}</button>}
                  {!showSubagents && group.children.length > 0 && <span>Subagents hidden</span>}
                </div>}
                <div className="agent-grid">{rows.map(agent => <AgentRow key={agent.agentId} agent={agent} snapshot={snapshot!} selected={selectedAgentId === agent.agentId} onSelect={() => store.selectAgent(agent.agentId)} childRequests={agent.agentId === group.parent?.agentId ? needsAttention : 0}/>)}</div>
              </div>;
            })}
          </div>;
        })}
      </section><footer className="office-footer"><span><Mark small/> MADE FOR THE WAY YOU WORK</span><span>Observed in Codex. At home in PetsTown.</span></footer></div>
      <Inspector agent={selectedAgent} snapshot={snapshot} stale={connection.stale} selectedMissing={!!selectedAgentId && !selectedAgent}/>
      </div>
    </main>
  </div>;
}
