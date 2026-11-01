import { useEffect, useRef, useState } from "react";
import type { OfficeSceneProps } from "./OfficeScene";
import { createVenueScene } from "../office/three/scene";
import "./three-office.css";
import { useSceneLifecycles, useCompleteSceneLifecycle } from "./useOfficeBehavior";

export function ThreeOfficeScene(
  props: OfficeSceneProps & {
    onUse2D?(): void;
    embedded?: boolean;
    connectionLabel?: string;
    connectionStale?: boolean;
  },
) {
  const lifecycles = useSceneLifecycles();
  const onLifecycleComplete = useCompleteSceneLifecycle();
  const sceneProps = { ...props, lifecycles, onLifecycleComplete };
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
  }, [props, lifecycles, onLifecycleComplete]);
  const count = props.visibleAgents.filter(
    (a) => a.runtimeState !== "closed",
  ).length;
  return (
    <section
      className="three-office"
      data-testid="office-scene"
      data-renderer="three"
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
          THE VENUE · {count} {count === 1 ? "PET" : "PETS"}
        </span>
        <span
          className={`venue-source ${props.connectionStale ? "is-stale" : ""}`}
        >
          {props.connectionLabel}
        </span>
      </header>
      <nav className="venue-controls" aria-label="Room controls">
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
          disabled={!props.selectedAgentId}
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
      {!count && !error && (
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
      <footer className="venue-help">
        {explore
          ? "Select a pet, then click clear floor to explore. This moves its avatar only."
          : "Drag to orbit · scroll to zoom · right-drag to pan · click a pet to inspect"}
        <span>Venue-inspired 3D reconstruction</span>
      </footer>
    </section>
  );
}
