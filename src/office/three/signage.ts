import * as T from "three";
import { venueLayout } from "./layout";

type Point = [number, number];
type Panel = { group: T.Group; width: number; height: number };
const colours = { paper: 0xf5f0df, ink: 0x202627, purple: 0x9273c9,
  blue: 0x278add, green: 0x61b344, orange: 0xf38628, pale: 0xdedbd4 };

/** Photo-referenced signs drawn as editable geometry. No photos or raster textures. */
export function buildVenueSignage() {
  const root = new T.Group();
  root.name = "Photo_referenced_event_signage";
  const materials = new Map<number, T.MeshStandardMaterial>();
  function mesh(name: string, geometry: T.BufferGeometry, colour: number, parent: T.Object3D) {
    if (!materials.has(colour)) materials.set(colour,
      new T.MeshStandardMaterial({ color: colour, roughness: 0.95, side: T.DoubleSide }));
    const object = new T.Mesh(geometry, materials.get(colour)!);
    object.name = name;
    object.receiveShadow = true;
    parent.add(object);
    return object;
  }
  function box(parent: T.Object3D, name: string, w: number, h: number, d: number,
    x: number, y: number, z: number, colour: number) {
    const object = mesh(name, new T.BoxGeometry(w, h, d), colour, parent);
    object.position.set(x, y, z);
    return object;
  }
  function panel(name: string, x: number, z: number, width: number,
    height: number, bottom: number, rotation: number): Panel {
    const group = new T.Group(); group.name = name;
    group.position.set(x, bottom, z); group.rotation.y = rotation; root.add(group);
    box(group, "Ivory_banner_fabric", width, height, 0.025, 0, height / 2, 0, colours.paper);
    return { group, width, height };
  }
  // Clip artwork to the fabric, including circles cropped by the printed edge.
  function polygon(p: Panel, name: string, points: Point[], colour: number, depth = 0.017) {
    for (const [axis, edge, direction] of [[0, -p.width / 2, 1], [0, p.width / 2, -1],
      [1, 0, 1], [1, p.height, -1]]) {
      const clipped: Point[] = [];
      for (let i = 0; i < points.length; i++) {
        const a = points[i], b = points[(i + 1) % points.length];
        const ain = (a[axis] - edge) * direction >= 0, bin = (b[axis] - edge) * direction >= 0;
        if (ain) clipped.push(a);
        if (ain !== bin) {
          const t = (edge - a[axis]) / (b[axis] - a[axis]);
          clipped.push([a[0] + t * (b[0] - a[0]), a[1] + t * (b[1] - a[1])]);
        }
      }
      points = clipped;
    }
    if (points.length < 3) return;
    const shape = new T.Shape(points.map(([x, y]) => new T.Vector2(x, y)));
    const object = mesh(name, new T.ShapeGeometry(shape), colour, p.group);
    object.position.z = depth;
  }
  function disk(p: Panel, x: number, y: number, r: number, colour: number, depth = 0.017) {
    polygon(p, "Printed_circle", Array.from({ length: 48 }, (_, i) =>
      [x + r * Math.cos(i * Math.PI / 24), y + r * Math.sin(i * Math.PI / 24)]), colour, depth);
  }
  function stroke(p: Panel, points: Point[], width: number, colour = colours.ink) {
    for (let i = 1; i < points.length; i++) {
      const [ax, ay] = points[i - 1], [bx, by] = points[i];
      const length = Math.hypot(bx - ax, by - ay);
      const dx = (by - ay) / length * width / 2, dy = (ax - bx) / length * width / 2;
      polygon(p, "Printed_mark", [[ax + dx, ay + dy], [ax - dx, ay - dy],
        [bx - dx, by - dy], [bx + dx, by + dy]], colour, 0.022);
    }
  }
  function ring(p: Panel, x: number, y: number, radius: number, width: number, colour = colours.ink) {
    stroke(p, Array.from({ length: 33 }, (_, i) =>
      [x + radius * Math.cos(i * Math.PI / 16), y + radius * Math.sin(i * Math.PI / 16)]), width, colour);
  }
  function face(p: Panel, x: number, y: number, r: number, kind: number) {
    const c = [colours.purple, colours.blue, colours.green, colours.orange, colours.ink, colours.pale][kind];
    disk(p, x, y, r, c);
    const ink = kind === 4 ? colours.paper : colours.ink;
    for (const side of [-1, 1]) {
      const ex = x + side * r * 0.47, ey = y + (kind === 2 ? 0.45 : -0.08) * r;
      const s = r * 0.22, w = r * 0.075;
      if (kind === 0) ring(p, ex, ey, s, w, ink);
      if (kind === 1) stroke(p, [[ex + side * s, ey + s], [ex - side * s, ey], [ex + side * s, ey - s]], w, ink);
      if (kind === 2 || kind === 5) {
        stroke(p, [[ex - s, ey], [ex + s, ey]], w, ink);
        stroke(p, [[ex, ey - s], [ex, ey + s]], w, ink);
        if (kind === 5) stroke(p, [[ex - s * .7, ey - s * .7], [ex + s * .7, ey + s * .7]], w, ink);
      }
      if (kind === 3) stroke(p, [[ex - s, ey], [ex + s, ey], [ex + s, ey - s * .7]], w, ink);
      if (kind === 4) stroke(p, [[ex - s, ey - s], [ex, ey + s], [ex + s, ey - s]], w, ink);
    }
  }
  // Simple outline lettering also reproduces the taped HELP DESK sign.
  const glyphs: Record<string, Point[][]> = {
    H: [[[0,0],[0,1]],[[.6,0],[.6,1]],[[0,.5],[.6,.5]]],
    E: [[[.6,0],[0,0],[0,1],[.6,1]],[[0,.5],[.5,.5]]],
    L: [[[0,1],[0,0],[.6,0]]], P: [[[0,0],[0,1],[.45,1],[.6,.85],[.6,.65],[.45,.5],[0,.5]]],
    D: [[[0,0],[0,1],[.4,1],[.6,.8],[.6,.2],[.4,0],[0,0]]],
    S: [[[.6,.95],[.1,1],[0,.85],[0,.6],[.6,.4],[.6,.15],[.5,0],[0,.05]]],
    K: [[[0,0],[0,1]],[[.6,1],[0,.45],[.6,0]]],
    O: [[[.15,0],[0,.2],[0,.8],[.15,1],[.45,1],[.6,.8],[.6,.2],[.45,0],[.15,0]]],
    A: [[[0,0],[.3,1],[.6,0]],[[.12,.4],[.48,.4]]], I: [[[.3,0],[.3,1]]],
    p: [[[0,-.23],[0,.7],[.43,.7],[.6,.55],[.6,.15],[.43,0],[0,0]]],
    e: [[[0,.35],[.6,.35],[.6,.55],[.45,.7],[.15,.7],[0,.5],[0,.15],[.15,0],[.55,0]]],
    n: [[[0,0],[0,.7]],[[0,.5],[.2,.7],[.45,.7],[.6,.5],[.6,0]]],
  };
  function text(p: Panel, value: string, y: number, height: number, width = .055) {
    const length = (value.length * .82 - .22) * height;
    for (let i = 0; i < value.length; i++) for (const path of glyphs[value[i]] ?? [])
      stroke(p, path.map(([x, yy]) => [-length / 2 + (i * .82 + x) * height, y + yy * height]), height * width);
  }
  const b = venueLayout.backdrop;
  const backdrop = panel("Circle_faces_wall_backdrop", b.x, b.z, b.width, b.height, .09, b.rotation);
  // Staggered multiscale circles follow the photographed wall's colour and expression pattern.
  const circles = [
    [-.48,.94,.11,0],[-.33,.91,.085,3],[-.15,.94,.10,1],[0,.99,.1,3],[.13,.91,.055,5],[.26,.99,.12,2],[.45,.97,.12,4],
    [-.47,.65,.06,5],[-.33,.7,.1,4],[-.17,.7,.1,2],[.02,.68,.12,0],[.2,.66,.1,1],[.38,.72,.1,3],
    [-.49,.4,.09,0],[-.35,.48,.085,1],[-.2,.5,.035,2],[-.12,.38,.105,1],[.08,.42,.09,3],[.27,.4,.12,2],[.47,.4,.095,1],
    [-.48,.12,.09,3],[-.32,.13,.1,2],[-.16,.15,.08,2],[.04,.15,.12,0],[.25,.09,.08,4],[.43,.11,.1,3],
    [-.25,.94,.025,2],[-.43,.31,.035,5],[-.24,.63,.025,3],[.12,.83,.03,4],[.46,.57,.04,5],[.35,.24,.04,2],
    [-.05,.54,.027,2],[.48,.85,.025,2],[-.16,.02,.04,5],[.18,.57,.025,5],
  ];
  for (const [x, y, r, kind] of circles) face(backdrop, x * b.width, y * b.height, r * b.width, kind);
  for (const side of [-1, 1])
    box(backdrop.group, "Backdrop_stabiliser", .12, .035, .5, side * (b.width / 2 - .12), -.055, 0, 0x92948b);

  for (const [i, z] of [-6.15, -2.05].entries()) {
    const p = panel(`OpenAI_stage_rollup_${i + 1}`, 4.25, z, .62, 1.65, .06, -Math.PI / 2);
    if (i === 0) {
      text(p, "OpenAI", 1.48, .12, .075);
      face(p, -.17, .94, .13, 0); face(p, .31, 1, .21, 4);
      face(p, -.32, .59, .16, 3); face(p, .04, .66, .065, 2);
      face(p, .32, .52, .17, 5); face(p, -.08, .29, .22, 2);
      face(p, .27, .17, .17, 1);
    } else {
      face(p, -.18, 1.46, .47, 0);
      text(p, "OpenAI", .77, .12, .075);
      disk(p, .15, .1, .5, 0xc9b4dd);
      ring(p, -.25, .25, .07, .018);
      stroke(p, [[.17,.37],[.06,.3],[.17,.23]], .025);
    }
    for (const y of [0, p.height])
      box(p.group, "Rollup_aluminium_rail", .65, .025, .05, 0, y, 0, 0xa9aaa2);
    for (const side of [-1, 1])
      box(p.group, "Rollup_foot", .04, .025, .4, side * .21, -.025, 0, 0x8c908b);
  }
  const h = venueLayout.helpSign;
  const sign = panel("Help_desk_banner", h.x, h.z, h.width, h.height, 1.8, h.rotation);
  text(sign, "HELP DESK", .13, .29, .055);
  for (const y of [.015, h.height - .015])
    box(sign.group, "Black_taped_hem", h.width, .022, .04, 0, y, 0, colours.ink);
  for (const side of [-1, 1]) {
    box(sign.group, "Help_sign_stand", .025, 2.4, .025, side * (h.width / 2 + .13), -.6, -.03, colours.ink);
    box(sign.group, "Help_sign_stand_foot", .12, .035, .48, side * (h.width / 2 + .13), -1.78, -.03, colours.ink);
    box(sign.group, "Sign_clip", .045, .07, .055, side * h.width * .43, h.height, .01, colours.ink);
  }
  box(sign.group, "Help_sign_crossbar", h.width + .29, .025, .025, 0, h.height + .06, -.03, colours.ink);
  return root;
}
