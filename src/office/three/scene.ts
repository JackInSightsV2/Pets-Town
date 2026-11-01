import * as T from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { GLTFExporter } from "three/addons/exporters/GLTFExporter.js";
import type { OfficeSceneProps } from "../../ui/OfficeScene";
import type { LifecycleToken, SpriteLifecycle } from "../lifecycle/controller";
import type { OfficeAgent, PetAsset } from "../../shared/contract";
import {
  animationFor,
  attentionFor,
  isWaiting,
  nativeAssetFor,
  stateLabels,
} from "../../ui/view-model";
import { buildVenue } from "./venue";
import { createVenueDisplay } from "./render";
import { advancePoint } from "./movement";
import { meetingPoints } from "./layout";
import {
  createVenuePlacement,
  floorPath,
  nearestFloor,
  walkable,
  type FloorPoint,
} from "./navigation";

export interface VenueSceneProps extends OfficeSceneProps {
  lifecycles?: readonly SpriteLifecycle[];
  onLifecycleComplete?: (token: LifecycleToken) => unknown;
}
interface Pet {
  lifecycle?: SpriteLifecycle;
  lifecycleKey: string;
  lifecycleSince: number;
  completedKey: string;
  agent: OfficeAgent;
  asset: PetAsset;
  sprite: T.Sprite;
  texture: T.Texture;
  ring: T.Mesh;
  label: HTMLButtonElement;
  position: T.Vector3;
  target: FloorPoint;
  path: FloorPoint[];
  loaded: boolean;
  assetKey: string;
}
export function createVenueScene(
  host: HTMLElement,
  labels: HTMLElement,
  onError: (message: string) => void,
) {
  const renderer = new T.WebGLRenderer({
    antialias: true,
    alpha: false,
    preserveDrawingBuffer: true,
  });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = T.PCFShadowMap;
  renderer.shadowMap.autoUpdate = false;
  renderer.shadowMap.needsUpdate = true;
  renderer.outputColorSpace = T.SRGBColorSpace;
  renderer.toneMapping = T.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.08;
  host.append(renderer.domElement);
  renderer.domElement.setAttribute(
    "aria-label",
    "Interactive 3D venue. Drag to orbit, scroll to zoom. Select pets using their labels.",
  );
  renderer.domElement.tabIndex = 0;
  const scene = new T.Scene();
  scene.background = new T.Color("#f3efe3");
  const camera = new T.OrthographicCamera(-14, 14, 11, -11, 0.1, 120);
  const controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;
  controls.dampingFactor = 0.09;
  controls.minZoom = 0.55;
  controls.maxZoom = 3;
  controls.maxPolarAngle = Math.PI / 2.25;
  controls.minPolarAngle = 0.12;
  controls.target.set(0, 0, 0);
  const ambient = new T.HemisphereLight(0xfff2da, 0x898371, 1.75);
  scene.add(ambient);
  const sun = new T.DirectionalLight(0xfff1d8, 2.5);
  sun.position.set(-6, 16, 3);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  Object.assign(sun.shadow.camera, {
    left: -16,
    right: 16,
    top: 16,
    bottom: -16,
    near: 1,
    far: 55,
  });
  sun.shadow.normalBias = 0.04;
  sun.shadow.radius = 2.5;
  sun.shadow.bias = -0.0001;
  scene.add(sun);
  const ground = new T.Mesh(
    new T.PlaneGeometry(160, 160),
    new T.MeshStandardMaterial({ color: 0xf3efe3, roughness: 1 }),
  );
  ground.rotation.x = -Math.PI / 2;
  ground.position.y = -0.45;
  ground.receiveShadow = true;
  scene.add(ground);
  const { room, walls: sourceWalls } = buildVenue();
  const {display, walls} = createVenueDisplay(room, sourceWalls);
  scene.add(display);
  const pets = new Map<string, Pet>();
  const placement = createVenuePlacement();
  const overrides = new Map<string, FloorPoint>();
  let props: VenueSceneProps = {
    snapshot: null,
    visibleAgents: [],
    selectedAgentId: null,
    onSelectAgent() {},
  };
  let reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  let disposed = false;
  let frame = 0;
  let last = performance.now();
  let explore = false;
  let meeting: {
    key: string;
    phase: "approach" | "exchange" | "return" | "done";
    since: number;
  } | null = null;
  const media = window.matchMedia("(prefers-reduced-motion: reduce)");
  const motion = (e: MediaQueryListEvent) => {
    reduced = e.matches;
  };
  media.addEventListener("change", motion);
  function home() {
    camera.position.set(-16, 25, 32);
    controls.target.set(-0.5, 0.4, 0.5);
    camera.zoom = 1.12;
    camera.updateProjectionMatrix();
    controls.update();
  }
  function top() {
    camera.position.set(0, 35, 0.01);
    controls.target.set(0, 0, 0);
    camera.zoom = 1;
    camera.updateProjectionMatrix();
    controls.update();
  }
  function resize() {
    const w = host.clientWidth,
      h = host.clientHeight;
    if (!w || !h) return;
    const span = Math.max(22, (27 * h) / w);
    camera.left = (-span * w) / h / 2;
    camera.right = (span * w) / h / 2;
    camera.top = span / 2;
    camera.bottom = -span / 2;
    camera.updateProjectionMatrix();
    renderer.setSize(w, h);
  }
  const observer = new ResizeObserver(resize);
  observer.observe(host);
  resize();
  home();
  function select(id: string) {
    const p = pets.get(id);
    if (!p) return;
    const r = p.label.getBoundingClientRect();
    props.onSelectAgent(id, { x: r.left + r.width / 2, y: r.bottom });
  }
  function remove(p: Pet) {
    scene.remove(p.sprite, p.ring);
    p.sprite.material.dispose();
    p.texture.dispose();
    p.ring.geometry.dispose();
    (p.ring.material as T.Material).dispose();
    p.label.remove();
  }
  function add(agent: OfficeAgent, asset: PetAsset) {
    const texture = new T.Texture();
    texture.colorSpace = T.SRGBColorSpace;
    texture.minFilter = T.LinearFilter;
    texture.magFilter = T.NearestFilter;
    texture.generateMipmaps = false;
    texture.repeat.set(1 / asset.columns, 1 / asset.rows);
    const material = new T.SpriteMaterial({
      map: texture,
      transparent: true,
      alphaTest: 0.06,
      depthWrite: false,
      toneMapped: false,
    });
    const sprite = new T.Sprite(material);
    sprite.center.set(0.5, 0.08);
    const height =
      (1.35 * (asset.height / asset.rows)) / (asset.width / asset.columns);
    sprite.scale.set(1.35, height, 1);
    sprite.visible = false;
    sprite.userData.agentId = agent.agentId;
    scene.add(sprite);
    const ring = new T.Mesh(
      new T.RingGeometry(0.32, 0.4, 32),
      new T.MeshBasicMaterial({
        color: 0x6b8d72,
        transparent: true,
        opacity: 0.7,
        side: T.DoubleSide,
      }),
    );
    ring.rotation.x = -Math.PI / 2;
    scene.add(ring);
    const label = document.createElement("button");
    label.type = "button";
    label.className = "venue-pet-label scene-agent";
    label.dataset.testid = `scene-agent-${agent.agentId}`;
    label.onclick = (e) => {
      e.stopPropagation();
      select(agent.agentId);
    };
    label.onpointerdown = (e) => e.stopPropagation();
    labels.append(label);
    const origin = nearestFloor({ x: -8.7, z: 0.4 });
    const p: Pet = {
      agent,
      asset,
      lifecycleKey: "", lifecycleSince: performance.now(), completedKey: "",
      sprite,
      texture,
      ring,
      label,
      position: new T.Vector3(origin.x, 0.06, origin.z),
      target: origin,
      path: [],
      loaded: false,
      assetKey: `${asset.assetId}:${asset.imageUrl}`,
    };
    pets.set(agent.agentId, p);
    const image = new Image();
    image.crossOrigin = "anonymous";
    image.onload = () => {
      if (disposed || pets.get(agent.agentId) !== p) return;
      if (image.width !== asset.width || image.height !== asset.height) {
        label.dataset.petLoad = "failed";
        return;
      }
      texture.image = image;
      texture.needsUpdate = true;
      p.loaded = true;
      sprite.visible = true;
      label.dataset.petLoad = "loaded";
    };
    image.onerror = () => {
      if (!disposed) label.dataset.petLoad = "failed";
    };
    label.dataset.petLoad = "loading";
    image.src = asset.imageUrl;
    return p;
  }
  function setTarget(p: Pet, target: FloorPoint) {
    if (Math.hypot(p.target.x - target.x, p.target.z - target.z) < 0.01) return;
    p.target = target;
    p.path = floorPath({ x: p.position.x, z: p.position.z }, target);
  }
  function sync(next: VenueSceneProps) {
    props = next;
    const lifecycles = new Map(next.lifecycles?.map(life => [life.agentId, life]));
    const candidates = [...next.visibleAgents];
    for (const agent of next.snapshot?.agents ?? []) {
      if (lifecycles.get(agent.agentId)?.phase === "dying" && !candidates.some(row => row.agentId === agent.agentId)) candidates.push(agent);
    }
    const visible = candidates.filter(agent => {
      const life = lifecycles.get(agent.agentId);
      return life?.visible !== false && (agent.runtimeState !== "closed" || life?.phase === "dying");
    });
    placement.map(next.snapshot?.agents ?? []);
    const ids = new Set(
      visible
        .map((a) => a.agentId),
    );
    for (const [id, p] of pets)
      if (!ids.has(id)) {
        remove(p);
        pets.delete(id);
        overrides.delete(id);
      }
    for (const agent of visible) {
      const asset = nativeAssetFor(agent, next.snapshot?.petAssets ?? []);
      if (!asset) continue;
      let p = pets.get(agent.agentId);
      if (p && p.assetKey !== `${asset.assetId}:${asset.imageUrl}`) {
        remove(p);
        pets.delete(agent.agentId);
        p = undefined;
      }
      p ??= add(agent, asset);
      p.agent = agent;
      p.lifecycle = lifecycles.get(agent.agentId);
      const key = p.lifecycle?.token ? JSON.stringify(p.lifecycle.token) : "";
      if (key !== p.lifecycleKey) {
        p.lifecycleKey = key;
        p.lifecycleSince = performance.now();
        p.completedKey = "";
        if (p.lifecycle?.phase === "dying" || p.lifecycle?.phase === "sleeping") {
          p.path = [];
          p.target = { x: p.position.x, z: p.position.z };
        }
      }
      const width = agent.parentAgentId ? 0.54 : 0.81;
      p.sprite.scale.set(
        width,
        (width * (asset.height / asset.rows)) / (asset.width / asset.columns),
        1,
      );
      const alert =
        next.snapshot &&
        (attentionFor(agent, next.snapshot).count > 0 || isWaiting(agent));
      p.label.replaceChildren();
      if (alert) {
        const badge = document.createElement("span");
        badge.textContent = "! ";
        badge.setAttribute("aria-label", "Unresolved request");
        p.label.append(badge);
      }
      p.label.append(document.createTextNode(agent.displayName));
      p.label.title = `${agent.displayName} · ${stateLabels[agent.runtimeState]}`;
      p.label.setAttribute(
        "aria-label",
        `Inspect ${agent.displayName}, ${stateLabels[agent.runtimeState]}`,
      );
      p.label.setAttribute(
        "aria-pressed",
        String(next.selectedAgentId === agent.agentId),
      );
      p.label.dataset.lifecyclePhase = p.lifecycle?.phase ?? "unknown";
      p.label.dataset.petWidth = String(width);
      const sleeping = !alert && (p.lifecycle?.phase === "sleeping" || (agent.runtimeState === "idle" && !["dying", "entering", "leaving"].includes(p.lifecycle?.phase ?? "")));
      p.label.dataset.idleSleep = String(sleeping);
      if (sleeping) {
        const sleep = document.createElement("span");
        sleep.textContent = " z z";
        sleep.setAttribute("aria-label", "Sleeping");
        sleep.className = "venue-sleep";
        p.label.append(sleep);
      }
      p.label.dataset.state = agent.runtimeState;
      p.label.dataset.runtimeState = agent.runtimeState;
    }
    const current = next.meeting;
    const valid =
      current &&
      next.observerConnected !== false && next.snapshot?.connection.status === "connected" &&
      next.snapshot?.presentation.state === "live" &&
      [current.handoff.fromAgentId, current.handoff.toAgentId].every(
        (id) =>
          pets.has(id) &&
          (!pets.get(id)!.lifecycle || ["present", "unknown"].includes(pets.get(id)!.lifecycle!.phase)) &&
          !["closed", "error"].includes(pets.get(id)!.agent.runtimeState),
      );
    if (!valid) meeting = null;
    else {
      const key = JSON.stringify(current.token);
      if (meeting?.key !== key) {
        meeting = { key, phase: "approach", since: performance.now() };
        overrides.delete(current.handoff.fromAgentId);
        overrides.delete(current.handoff.toAgentId);
      }
    }
  }
  function destination(p: Pet, index: number): FloorPoint {
    if (p.lifecycle?.phase === "dying" || p.lifecycle?.phase === "sleeping" || props.observerConnected === false || props.snapshot?.connection.status !== "connected")
      return { x: p.position.x, z: p.position.z };
    if (p.lifecycle?.phase === "leaving") return nearestFloor({ x: -8.7, z: 0.4 });
    const id = p.agent.agentId,
      state = props.snapshot?.presentation.state;
    if (meeting && props.meeting && meeting.phase !== "done") {
      const pair = [
        props.meeting.handoff.fromAgentId,
        props.meeting.handoff.toAgentId,
      ];
      const i = pair.indexOf(id);
      if (i !== -1 && meeting.phase !== "return")
        return nearestFloor(meetingPoints[i]);
    }
    if (overrides.has(id)) return overrides.get(id)!;
    if (state === "ready")
      return nearestFloor({
        x: -7 + (index % 5) * 0.8,
        z: 6 - Math.floor(index / 5) * 0.8,
      });
    if (state === "arrivals" || state === "standup")
      return nearestFloor({
        x: 0.5 + Math.cos(index * 2.4) * (1 + index * 0.1),
        z: 0.7 + Math.sin(index * 2.4) * (1 + index * 0.1),
      });
    if (p.agent.runtimeState === "idle")
      return nearestFloor({
        x: 5 + (index % 3) * 0.7,
        z: 4 + Math.floor(index / 3) * 0.7,
      });
    return placement.homes.get(id) ?? nearestFloor({ x: 0, z: 0 });
  }
  const projected = new T.Vector3();
  function tick(now: number) {
    if (disposed) return;
    frame = requestAnimationFrame(tick);
    const dt = Math.max(0, Math.min((now - last) / 1000, 0.07));
    last = now;
    controls.update();
    let i = 0;
    for (const p of pets.values()) {
      const target = destination(p, i++);
      setTarget(p, target);
      let moving = p.path.length > 0;
      let dx = 0;
      if (reduced) {
        p.position.set(target.x, 0.06, target.z);
        p.path = [];
        moving = false;
      } else if (moving) {
        const next = p.path[0];
        dx = next.x - p.position.x;
        const advanced = advancePoint({ x: p.position.x, z: p.position.z }, next, dt);
        p.position.set(advanced.x, 0.06, advanced.z);
        if (advanced.arrived) p.path.shift();
      }
      const phase = p.lifecycle?.phase;
      const visualState = p.lifecycle?.status === "started" && p.agent.runtimeState === "unknown" ? "working" : p.agent.runtimeState;
      const lifecycleAnimation = phase === "dying" ? "failed" : phase === "sleeping" ? "waiting" : null;
      const anim = lifecycleAnimation && p.asset.animations[lifecycleAnimation]
        ? p.asset.animations[lifecycleAnimation]
        : moving
        ? (p.asset.animations[dx < 0 ? "running-left" : "running-right"] ??
          animationFor(p.asset, visualState))
        : props.snapshot?.presentation.state === "standup"
          ? (p.asset.animations.waving ??
            animationFor(p.asset, visualState))
          : animationFor(p.asset, visualState);
      const elapsed = now - p.lifecycleSince;
      const f = reduced ? 0 : phase === "dying"
        ? Math.min(anim.frames - 1, Math.floor(elapsed / 1000 * anim.fps))
        : Math.floor((now / 1000) * anim.fps) % anim.frames;
      p.label.dataset.animation = lifecycleAnimation ?? (moving ? "running" : "");
      const finished = phase === "dying" ? elapsed >= (reduced ? 100 : anim.frames / anim.fps * 1000)
        : (phase === "entering" || phase === "leaving") && !moving;
      if (finished && p.lifecycle?.token && p.completedKey !== p.lifecycleKey && props.observerConnected !== false && props.snapshot?.connection.status === "connected") {
        p.completedKey = p.lifecycleKey;
        props.onLifecycleComplete?.(p.lifecycle.token);
      }
      p.texture.offset.set(
        f / p.asset.columns,
        1 - (anim.row + 1) / p.asset.rows,
      );
      p.sprite.position.copy(p.position);
      p.ring.position.set(p.position.x, 0.035, p.position.z);
      p.ring.visible = props.selectedAgentId === p.agent.agentId;
      (p.ring.material as T.MeshBasicMaterial).color.set(
        isWaiting(p.agent) ? 0xc2793f : 0x517f66,
      );
      projected.copy(p.position);
      projected.y += 1.15;
      projected.project(camera);
      const w = host.clientWidth,
        h = host.clientHeight;
      p.label.style.transform = `translate(-50%,-100%) translate(${(projected.x * 0.5 + 0.5) * w}px,${(-projected.y * 0.5 + 0.5) * h}px)`;
      p.label.style.visibility =
        projected.z > 1 ||
        Math.abs(projected.x) > 1.15 ||
        Math.abs(projected.y) > 1.15
          ? "hidden"
          : "visible";
      p.label.dataset.location =
        meeting &&
        props.meeting &&
        [
          props.meeting.handoff.fromAgentId,
          props.meeting.handoff.toAgentId,
        ].includes(p.agent.agentId)
          ? "water-cooler"
          : "floor";
    }
    if (meeting && props.meeting && meeting.phase !== "done") {
      const pair = [
        pets.get(props.meeting.handoff.fromAgentId),
        pets.get(props.meeting.handoff.toAgentId),
      ];
      const arrived = pair.every(
        (p) =>
          p &&
          Math.hypot(p.position.x - p.target.x, p.position.z - p.target.z) <
            0.1,
      );
      if (meeting.phase === "approach" && arrived) {
        meeting.phase = "exchange";
        meeting.since = now;
      } else if (meeting.phase === "exchange" && now - meeting.since > 4000) {
        meeting.phase = "return";
      } else if (meeting.phase === "return" && arrived) {
        meeting.phase = "done";
        props.onMeetingComplete?.(props.meeting.token);
      }
    }
    renderer.render(scene, camera);
  }
  frame = requestAnimationFrame(tick);
  let pointer: { x: number; y: number } | null = null;
  const ray = new T.Raycaster();
  const plane = new T.Plane(new T.Vector3(0, 1, 0), 0);
  const hit = new T.Vector3();
  const down = (e: PointerEvent) => {
    pointer = { x: e.clientX, y: e.clientY };
  };
  const up = (e: PointerEvent) => {
    if (
      !pointer ||
      Math.hypot(pointer.x - e.clientX, pointer.y - e.clientY) > 5
    )
      return;
    const rect = renderer.domElement.getBoundingClientRect();
    ray.setFromCamera(
      new T.Vector2(
        ((e.clientX - rect.left) / rect.width) * 2 - 1,
        (-(e.clientY - rect.top) / rect.height) * 2 + 1,
      ),
      camera,
    );
    const found = ray
      .intersectObjects([...pets.values()].map((p) => p.sprite))
      .find((h) => h.object.visible);
    if (found) {
      select(found.object.userData.agentId);
      return;
    }
    if (
      explore &&
      props.selectedAgentId &&
      ray.ray.intersectPlane(plane, hit) &&
      walkable({ x: hit.x, z: hit.z })
    )
      overrides.set(
        props.selectedAgentId,
        nearestFloor({ x: hit.x, z: hit.z }),
      );
  };
  renderer.domElement.addEventListener("pointerdown", down);
  renderer.domElement.addEventListener("pointerup", up);
  const keyboard = (e: KeyboardEvent) => {
    if (e.key === "Home") {
      home();
      return;
    }
    if (["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(e.key)) {
      e.preventDefault();
      const spherical = new T.Spherical().setFromVector3(
        camera.position.clone().sub(controls.target),
      );
      spherical.theta +=
        e.key === "ArrowLeft" ? 0.12 : e.key === "ArrowRight" ? -0.12 : 0;
      spherical.phi = T.MathUtils.clamp(
        spherical.phi +
          (e.key === "ArrowUp" ? -0.1 : e.key === "ArrowDown" ? 0.1 : 0),
        0.12,
        Math.PI / 2.25,
      );
      camera.position
        .copy(controls.target)
        .add(new T.Vector3().setFromSpherical(spherical));
      controls.update();
    }
    if (e.key === "+" || e.key === "-") {
      camera.zoom = T.MathUtils.clamp(
        camera.zoom * (e.key === "+" ? 1.1 : 0.9),
        0.55,
        3,
      );
      camera.updateProjectionMatrix();
    }
  };
  renderer.domElement.addEventListener("keydown", keyboard);
  const lost = (e: Event) => {
    e.preventDefault();
    onError("The 3D graphics context was lost. Use the 2D view or reload.");
  };
  renderer.domElement.addEventListener("webglcontextlost", lost);
  return {
    sync,
    home,
    top,
    setExplore(value: boolean) {
      explore = value;
      if (!value) overrides.clear();
    },
    walls(value: boolean) {
      walls.visible = value;
      renderer.shadowMap.needsUpdate = true;
    },
    focus() {
      const p = props.selectedAgentId && pets.get(props.selectedAgentId);
      if (p) {
        const offset = camera.position.clone().sub(controls.target);
        controls.target.copy(p.position);
        camera.position.copy(p.position).add(offset);
        camera.zoom = 1.8;
        camera.updateProjectionMatrix();
      }
    },
    async exportRoom() {
      const result = await new GLTFExporter().parseAsync(room, {
        binary: true,
        onlyVisible: false,
      });
      const blob = new Blob([result as ArrayBuffer], {
        type: "model/gltf-binary",
      });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = "pets-town-cartoon-venue.glb";
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    },
    dispose() {
      disposed = true;
      cancelAnimationFrame(frame);
      observer.disconnect();
      media.removeEventListener("change", motion);
      controls.dispose();
      renderer.domElement.removeEventListener("pointerdown", down);
      renderer.domElement.removeEventListener("pointerup", up);
      renderer.domElement.removeEventListener("webglcontextlost", lost);
      renderer.domElement.removeEventListener("keydown", keyboard);
      for (const p of pets.values()) remove(p);
      scene.traverse((o) => {
        if (o instanceof T.Mesh || o instanceof T.LineSegments) {
          o.geometry.dispose();
          for (const m of Array.isArray(o.material) ? o.material : [o.material])
            m.dispose();
        }
      });
      room.traverse(o=>{if(o instanceof T.Mesh || o instanceof T.LineSegments)o.geometry.dispose();});
      renderer.dispose();
      renderer.domElement.remove();
    },
  };
}
