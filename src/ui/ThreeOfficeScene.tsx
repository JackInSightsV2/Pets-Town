import { useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import type { OfficeSceneProps } from "./OfficeScene";
import { createVenueScene } from "../office/three/scene";
import "./three-office.css";
import { celebrationPhase, withCelebrationAgents } from "../office/three/celebration";
import { isDemoAgent, withDemoAgents } from "../office/three/demo";
import { useSceneLifecycles, useCompleteSceneLifecycle } from "./useOfficeBehavior";

export function ThreeOfficeScene(
  props: OfficeSceneProps & {
    onUse2D?(): void;
    onClearSelection?(): void;
    embedded?: boolean;
    celebrationId?: string;
    connectionLabel?: string;
    connectionStale?: boolean;
  },
) {
  const lifecycles = useSceneLifecycles();
  const onLifecycleComplete = useCompleteSceneLifecycle();
  const [demo, setDemo] = useState(true);
  const [demoStep, setDemoStep] = useState(0);
  const [demoSelected, setDemoSelected] = useState<string | null>(null);
  const [celebration, setCelebration] = useState<{ id: string; started: number } | null>(null);
  const [celebrationElapsed, setCelebrationElapsed] = useState(0);
  const seenCelebrations = useRef(new Set<string>());
  const localCelebration = useRef(0);
  const phase = celebration ? celebrationPhase(celebrationElapsed) : 'idle';
  const startCelebration = (id: string) => {
    setDemo(false); setDemoSelected(null); setCelebrationElapsed(0);
    setCelebration({ id, started: performance.now() });
  };
  useEffect(() => {
    const id = props.celebrationId;
    if (!id || seenCelebrations.current.has(id)) return;
    seenCelebrations.current.add(id);
    startCelebration(id);
  }, [props.celebrationId]);
  useEffect(() => {
    if (!celebration) return;
    const timer = window.setInterval(() => {
      const elapsed = performance.now() - celebration.started;
      setCelebrationElapsed(elapsed);
      if (celebrationPhase(elapsed) === 'idle') { setCelebration(null); setDemoSelected(null); }
    }, 100);
    return () => window.clearInterval(timer);
  }, [celebration]);
  useEffect(() => {
    if (!demo) return;
    const timer = window.setInterval(() => setDemoStep(step => step + 1), 8000);
    return () => window.clearInterval(timer);
  }, [demo]);
  const demoView = useMemo(() => phase !== 'idle' ? withCelebrationAgents(props.snapshot, phase)
    : demo ? withDemoAgents(props.snapshot, demoStep) : null, [demo, demoStep, props.snapshot, phase]);
  const demoPet = demoView?.agents.find(agent => agent.agentId === demoSelected);
  const sceneProps = { ...props, lifecycles, onLifecycleComplete, demoStep: phase === 'idle' ? demoStep : 0,
    celebration: celebration && phase !== 'idle' ? { id: celebration.id, phase } : undefined,
    snapshot: demoView?.snapshot ?? props.snapshot,
    visibleAgents: demoView ? [...props.visibleAgents, ...demoView.agents] : props.visibleAgents,
    selectedAgentId: demoSelected ?? props.selectedAgentId,
    onSelectAgent: (id: string, point?: { x: number; y: number }) => {
      if (isDemoAgent(id)) { setDemoSelected(id); props.onClearSelection?.(); }
      else { setDemoSelected(null); props.onSelectAgent(id, point); }
    },
  };
  const host = useRef<HTMLDivElement>(null),
    labels = useRef<HTMLDivElement>(null);
  const engine = useRef<ReturnType<typeof createVenueScene> | null>(null);
  const latest = useRef(sceneProps);
  latest.current = sceneProps;
  const [error, setError] = useState<string | null>(null),
    [explore, setExplore] = useState(false),
    [walls, setWalls] = useState(true),
    [exporting, setExporting] = useState(false);
  useEffect(() => {
    try {
      const scene = createVenueScene(host.current!, labels.current!, setError);
      engine.current = scene;
      scene.sync(latest.current);
      return () => {
        scene.dispose();
        engine.current = null;
      };
    } catch {
      setError(
        "3D graphics are unavailable in this browser. Reload or use a browser with WebGL enabled.",
      );
    }
  }, []);
  useEffect(() => {
    engine.current?.sync(sceneProps);
  }, [props, lifecycles, onLifecycleComplete, demoView, demoSelected, demoStep, celebration, phase]);
  const count = props.visibleAgents.filter(
    (a) => a.runtimeState !== "closed",
  ).length;
  return (
    <section
      className="three-office"
      data-testid="office-scene"
      data-renderer="three"
      data-demo={demo}
      data-celebration={phase}
      aria-label="3D shared pet office"
      onPointerDown={(event) => event.stopPropagation()}
    >
      <div className="venue-render" ref={host} />
      <div className="venue-labels" ref={labels} />
      <header className="venue-title">
        <span className="venue-wordmark">
          PetsTown<span>.</span>
        </span>
        <span className="venue-subtitle">
          THE VENUE · {count} OBSERVED {count === 1 ? "PET" : "PETS"}
        </span>
        {demoView && <span className="venue-demo-badge" data-testid="demo-badge">Demo · 8 simulated pets{phase !== 'idle' ? ` · ${phase}` : ''}</span>}
        <span
          className={`venue-source ${props.connectionStale ? "is-stale" : ""}`}
        >
          {props.connectionLabel}
        </span>
      </header>
      <nav className="venue-controls" aria-label="Room controls">
        <button aria-pressed={demo} onClick={() => { setCelebration(null); setDemo(!demo); setDemoSelected(null); }}>Demo {demo ? "on" : "off"}</button>
        <button onClick={() => startCelebration(`local:${++localCelebration.current}`)}>Celebrate</button>
        {celebration && <button onClick={() => { setCelebration(null); setDemoSelected(null); }}>Stop celebration</button>}
        <button onClick={() => engine.current?.home()}>Home view</button>
        <button onClick={() => engine.current?.top()}>Top view</button>
        <button
          aria-pressed={walls}
          onClick={() => {
            setWalls(!walls);
            engine.current?.walls(!walls);
          }}
        >
          Walls {walls ? "on" : "off"}
        </button>
        <button
          disabled={!sceneProps.selectedAgentId}
          onClick={() => engine.current?.focus()}
        >
          Find pet
        </button>
        <button
          aria-pressed={explore}
          onClick={() => {
            setExplore(!explore);
            engine.current?.setExplore(!explore);
          }}
        >
          Explore {explore ? "on" : "off"}
        </button>
        {!props.embedded && <button
          disabled={exporting || !!error}
          onClick={async () => {
            setExporting(true);
            try {
              await engine.current?.exportRoom();
            } catch {
              setError("Room export failed. Please retry.");
            } finally {
              setExporting(false);
            }
          }}
        >
          {exporting ? "Exporting…" : "Export room"}
        </button>}
        {props.onUse2D && <button onClick={props.onUse2D}>2D view</button>}

      </nav>
      {error && (
        <div className="venue-notice" role="alert">
          {error}
          {props.onUse2D && <button onClick={props.onUse2D}>Open 2D office</button>}
        </div>
      )}
      {!count && !demoView && !error && (
        <div className="venue-empty">
          <strong>The room is ready.</strong>
          <p>
            Connected Codex pets will appear here.
            <br />
            Drag to explore the venue.
          </p>
        </div>
      )}
      {props.meeting && (
        <div className="venue-handoff" role="status">
          <small>OBSERVED HANDOFF · WATER COOLER</small>
          <p>
            {props.meeting.handoff.summary ||
              "Handoff observed; summary unavailable."}
          </p>
        </div>
      )}
      {phase === 'cheering' && <div className="venue-confetti" data-testid="celebration-confetti" aria-label="Demo celebration">
        <strong className="venue-celebration-banner">Nice work, team! 🎉</strong>
        {Array.from({ length: 40 }, (_, index) => <i key={index} aria-hidden="true" style={{
          '--confetti-x': `${(index * 37) % 100}%`, '--confetti-delay': `${(index % 8) * -0.18}s`,
          '--confetti-colour': ['#ef9460', '#8e7bc6', '#5c9b78', '#e6bd4c', '#5da2cb'][index % 5],
          '--confetti-drift': `${((index * 19) % 180) - 90}px`,
        } as CSSProperties} />)}
      </div>}
      {demoPet && <aside className="venue-demo-details" data-testid="demo-details" aria-label="Demo pet details">
        <button aria-label="Close demo details" onClick={() => setDemoSelected(null)}>×</button>
        <strong>{demoPet.displayName}</strong><small>Simulated teammate · no real work is running</small>
        <p>{demoPet.task}</p>
      </aside>}
      <footer className="venue-help">
        {explore
          ? "Select a pet, then click clear floor to explore. This moves its avatar only."
          : "Drag to orbit · scroll to zoom · right-drag to pan · click a pet to inspect"}
        <span>Venue-inspired 3D reconstruction</span>
      </footer>
    </section>
  );
}
