import { useLayoutEffect, useRef, useState } from 'react';
import type { OfficeAgent, OfficeSnapshot } from '../shared/contract';
import { attentionFor, stateLabels, timeLabel } from './view-model';
import './pet-details.css';

interface PetDetailsProps {
  agent: OfficeAgent;
  snapshot: OfficeSnapshot;
  anchor: { x: number; y: number };
  stale: boolean;
  onClose(): void;
}

export function petDetailsPosition(
  anchor: { x: number; y: number },
  size: { width: number; height: number },
  viewport: { width: number; height: number },
) {
  const margin = 12;
  const gap = 18;
  const above = anchor.y - size.height - gap;
  const preferredTop = above >= margin ? above : anchor.y + gap;
  return {
    left: Math.max(margin, Math.min(anchor.x - size.width / 2, viewport.width - size.width - margin)),
    top: Math.max(margin, Math.min(preferredTop, viewport.height - size.height - margin)),
  };
}

export function PetDetails({ agent, snapshot, anchor, stale, onClose }: PetDetailsProps) {
  const panel = useRef<HTMLElement>(null);
  const [position, setPosition] = useState({ left: 12, top: 12 });
  const task = agent.task?.trim();
  const requests = attentionFor(agent, snapshot).requests.filter(request =>
    request.prompt?.trim() || request.options.some(option => option.label.trim()),
  );
  const latestActivity = agent.recentActivity.reduce<(typeof agent.recentActivity)[number] | null>((latest, activity) => {
    if (!activity.summary.trim()) return latest;
    if (!latest) return activity;
    const nextTime = Date.parse(activity.occurredAt);
    const latestTime = Date.parse(latest.occurredAt);
    return Number.isFinite(nextTime) && (!Number.isFinite(latestTime) || nextTime > latestTime) ? activity : latest;
  }, null);

  useLayoutEffect(() => {
    const element = panel.current;
    if (!element) return;
    const place = () => {
      const rect = element.getBoundingClientRect();
      const next = petDetailsPosition(anchor, rect, { width: window.innerWidth, height: window.innerHeight });
      setPosition(previous => previous.left === next.left && previous.top === next.top ? previous : next);
    };
    place();
    const observer = new ResizeObserver(place);
    observer.observe(element);
    window.addEventListener('resize', place);
    return () => {
      observer.disconnect();
      window.removeEventListener('resize', place);
    };
  }, [anchor.x, anchor.y]);

  return <aside
    ref={panel}
    className="pet-details"
    style={position}
    data-testid="agent-inspector"
    role="dialog"
    aria-label={agent.displayName}
    onClick={event => event.stopPropagation()}
    onPointerDown={event => event.stopPropagation()}
  >
    <div className="pet-details-identity">
      <div>
        <h2 data-testid="selected-agent-name">{agent.displayName}</h2>
        <p className={`pet-details-status state-${agent.runtimeState}`}>
          <span aria-hidden="true" />{stateLabels[agent.runtimeState]}
          {stale ? <span className="pet-details-stale" data-testid="stale-agent-data">Last observed</span> : null}
        </p>
      </div>
      <button className="pet-details-close" type="button" onClick={onClose} aria-label="Close pet details">×</button>
    </div>
    {task ? <p className="pet-details-task" data-testid="agent-task">{task}</p> : null}
    {latestActivity ? <div className="pet-details-activity" data-testid="recent-activity">
      <p>{latestActivity.summary}</p>
      {Number.isFinite(Date.parse(latestActivity.occurredAt)) ? <time dateTime={latestActivity.occurredAt}>{timeLabel(latestActivity.occurredAt)}</time> : null}
      {latestActivity.source === 'fixture' ? <span className="pet-details-fixture">Fixture</span> : null}
    </div> : null}
    {requests.map(request => <div className="pet-details-request" key={request.requestId} data-testid={`request-${request.requestId}`}>
      {request.prompt?.trim() ? <p>{request.prompt}</p> : null}
      {request.options.some(option => option.label.trim()) ? <ul>
        {request.options.filter(option => option.label.trim()).map(option => <li key={option.id}>
          <span>{option.label}</span>{option.description?.trim() ? <small>{option.description}</small> : null}
        </li>)}
      </ul> : null}
    </div>)}
    {snapshot.source === 'codex' ? <a
      className="pet-details-open"
      data-testid="open-chat"
      href={`codex://threads/${encodeURIComponent(agent.agentId)}`}
      aria-label={`Open ${agent.displayName} in Codex`}
    >Open chat <span aria-hidden="true">↗</span></a> : null}
  </aside>;
}
