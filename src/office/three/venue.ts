import * as T from "three";
import { RoundedBoxGeometry } from "three/addons/geometries/RoundedBoxGeometry.js";
import { desks } from "./navigation";
import { venueLayout, insideVenue, audienceSeats } from "./layout";
import { buildVenueSignage } from "./signage";

/** Editable reconstruction of the illustrated scan study. No photographic assets. */
export function buildVenue() {
  const room = new T.Group();
  room.name = "PetsTown_Venue";
  const walls = new T.Group();
  walls.name = "Cutaway_walls";
  room.add(walls);
  const palette = {
    wood: 0xb98246,
    edge: 0x674a30,
    metal: 0x45463c,
    curtain: 0x353638,
    brick: 0xad8051,
    floor: 0xcfc0a3,
    sage: 0x81916b,
    clay: 0xb9693c,
  };
  let seed = 721;
  const random = () => {
    seed = (Math.imul(seed, 1664525) + 1013904223) | 0;
    return (seed >>> 0) / 4294967296;
  };
  const materials = new Map<number, T.MeshStandardMaterial>();
  const material = (color: number) => {
    if (!materials.has(color))
      materials.set(
        color,
        new T.MeshStandardMaterial({ color, roughness: 0.9 }),
      );
    return materials.get(color)!;
  };
  const ink = new T.LineBasicMaterial({
    color: 0x44392c,
    transparent: true,
    opacity: 0.42,
  });
  const outline = (mesh: T.Mesh) => {
    const lines = new T.LineSegments(
      new T.EdgesGeometry(mesh.geometry, 35),
      ink,
    );
    lines.name = "Illustrated_edge";
    mesh.add(lines);
  };
  function mesh(
    name: string,
    geo: T.BufferGeometry,
    color: number,
    parent: T.Object3D = room,
    edge = false,
  ) {
    const item = new T.Mesh(geo, material(color));
    item.name = name;
    item.castShadow = true;
    item.receiveShadow = true;
    parent.add(item);
    if (edge) outline(item);
    return item;
  }
  function box(
    name: string,
    w: number,
    h: number,
    d: number,
    x: number,
    y: number,
    z: number,
    color: number,
    parent: T.Object3D = room,
    r = 0.025,
    edge = true,
  ) {
    const item = mesh(
      name,
      r
        ? new RoundedBoxGeometry(w, h, d, 1, Math.min(r, w / 4, h / 4, d / 4))
        : new T.BoxGeometry(w, h, d),
      color,
      parent,
      edge && w + h + d > 1,
    );
    item.position.set(x, y, z);
    return item;
  }
  function cylinder(
    name: string,
    rt: number,
    rb: number,
    h: number,
    x: number,
    y: number,
    z: number,
    color: number,
    parent: T.Object3D = room,
  ) {
    const item = mesh(
      name,
      new T.CylinderGeometry(rt, rb, h, 12),
      color,
      parent,
    );
    item.position.set(x, y, z);
    return item;
  }
  function group(
    name: string,
    x: number,
    z: number,
    rotation = 0,
    parent: T.Object3D = room,
  ) {
    const g = new T.Group();
    g.name = name;
    g.position.set(x, 0, z);
    g.rotation.y = rotation;
    parent.add(g);
    return g;
  }
  function rod(
    name: string,
    a: T.Vector3,
    b: T.Vector3,
    r: number,
    color: number,
    parent: T.Object3D,
  ) {
    const item = mesh(
      name,
      new T.CylinderGeometry(r, r, a.distanceTo(b), 6),
      color,
      parent,
    );
    item.position.copy(a).add(b).multiplyScalar(0.5);
    item.quaternion.setFromUnitVectors(
      new T.Vector3(0, 1, 0),
      b.clone().sub(a).normalize(),
    );
    return item;
  }
  // The stepped right wing and two projecting entrances are the room's silhouette.
  const footprint = venueLayout.boundary;
  const shape = new T.Shape(footprint.map(([x, z]) => new T.Vector2(x, z)));
  const slabGeo = new T.ExtrudeGeometry(shape, {
    depth: 0.27,
    bevelEnabled: true,
    bevelSegments: 1,
    steps: 1,
    bevelSize: 0.055,
    bevelThickness: 0.035,
  });
  slabGeo.rotateX(Math.PI / 2);
  slabGeo.translate(0, -0.035, 0);
  mesh("Venue_floor_slab", slabGeo, 0xb7aa91, room, true);
  // Warm, slightly varied stone tiles. Individual solid objects remain editable in GLB.
  const floorColors = [
    0xd2c4a9, 0xcebea0, 0xd4c6ae, 0xcab99c, 0xd0c1a5, 0xd7c9af,
  ];
  for (let row = 0; row < 18; row++)
    for (let col = 0; col < 19; col++) {
      const x = -10.5 + col,
        z = -9.5 + row;
      if (
        ![
          [-0.5, -0.5],
          [0.5, -0.5],
          [0.5, 0.5],
          [-0.5, 0.5],
        ].every(([dx, dz]) => insideVenue({ x: x + dx, z: z + dz }))
      )
        continue;
      box(
        "Stone_floor_tile",
        0.987,
        0.028,
        0.987,
        x,
        0.018,
        z,
        floorColors[Math.floor(random() * floorColors.length)],
        room,
        0.012,
        false,
      );
      if (random() > 0.55) {
        const patch = mesh(
          "Stone_variation",
          new T.CircleGeometry(0.1 + random() * 0.2, 5),
          floorColors[Math.floor(random() * floorColors.length)],
        );
        patch.rotation.x = -Math.PI / 2;
        patch.scale.y = 0.2 + random() * 0.3;
        patch.position.set(
          x + (random() - 0.5) * 0.6,
          0.036,
          z + (random() - 0.5) * 0.6,
        );
        patch.castShadow = false;
      }
    }
  for (const [x, z, w, d] of [
    [-9, 0.35, 2, 1],
    [-4.35, 6.95, 2.3, 0.3],
    [6.85, 7.3, 1.7, 0.9],
  ])
    box("Entrance_threshold", w, 0.04, d, x, -0.01, z, 0xbcae93, room);

  // A cloth surface with continuous folds, a dark upper rail, and irregular lower hem.
  function curtain(
    name: string,
    length: number,
    x: number,
    z: number,
    rotation = 0,
    height = 3.45,
  ) {
    const g = group(name, x, z, rotation, walls);
    const n = Math.ceil(length * 20),
      v: number[] = [],
      indices: number[] = [];
    for (let i = 0; i <= n; i++) {
      const u = i / n;
      const depth =
        0.09 +
        Math.cos(u * length * Math.PI * 6) * 0.075 +
        Math.cos(u * length * 5) * 0.012;
      const hem = 0.035 + Math.sin(u * 25) * 0.018;
      v.push(
        -length / 2 + u * length,
        hem,
        depth,
        -length / 2 + u * length,
        height,
        depth,
      );
    }
    for (let i = 0; i < n; i++) {
      const a = i * 2;
      indices.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
    }
    const geo = new T.BufferGeometry();
    geo.setAttribute("position", new T.Float32BufferAttribute(v, 3));
    geo.setIndex(indices);
    geo.computeVertexNormals();
    const cloth = mesh("Heavy_charcoal_curtain", geo, palette.curtain, g);
    (cloth.material as T.MeshStandardMaterial).side = T.DoubleSide;
    (cloth.material as T.MeshStandardMaterial).emissive.setHex(0x45454b);
    (cloth.material as T.MeshStandardMaterial).emissiveIntensity = 0.32;
    box(
      "Curtain_top_rail",
      length + 0.08,
      0.13,
      0.19,
      0,
      height + 0.025,
      0,
      0x2c2d2c,
      g,
    );
    for (let i = -length / 2 + 0.1; i < length / 2; i += 0.29)
      cylinder(
        "Curtain_ring",
        0.045,
        0.045,
        0.035,
        i,
        height + 0.09,
        0.06,
        0x706b5e,
        g,
      );
  }
  function curtainBetween(a: number[], b: number[], height = 3.35) {
    const dx = b[0] - a[0],
      dz = b[1] - a[1];
    curtain(
      "Measured_curtain_wall",
      Math.hypot(dx, dz),
      (a[0] + b[0]) / 2,
      (a[1] + b[1]) / 2,
      -Math.atan2(dz, dx),
      height,
    );
  }
  for (let i = 1; i < 11; i++)
    curtainBetween(footprint[i], footprint[i + 1], i > 8 ? 3 : 3.35);
  // Left boundary is a lower cutaway, with a taller rear post and two entrance openings.
  function post(x: number, z: number, h = 3.6, parent: T.Object3D = walls) {
    box(
      "Oak_structural_post",
      0.24,
      h,
      0.27,
      x,
      h / 2,
      z,
      palette.wood,
      parent,
      0.035,
    );
    box(
      "Post_shadow_edge",
      0.035,
      h - 0.1,
      0.29,
      x + 0.09,
      h / 2,
      z,
      0x78532e,
      parent,
      0.006,
      false,
    );
    for (let i = 0; i < 3; i++) {
      const streak = box(
        "Timber_grain",
        0.009,
        h * (0.28 + random() * 0.35),
        0.006,
        x - 0.07 + i * 0.06,
        h * (0.3 + random() * 0.3),
        z + 0.139,
        0x916436,
        parent,
        0,
        false,
      );
      streak.rotation.z = (random() - 0.5) * 0.02;
    }
    box("Post_foot", 0.31, 0.13, 0.34, x, 0.065, z, 0x635640, parent);
  }
  for (const [x, z] of footprint.slice(1, 12)) post(x, z, 3.45);
  for (const z of [-6.5, -3.8, -0.2]) post(-8, z, 2.15);
  // Brick courses, mortar joints and cap stones make the entrance walls legible.
  function brickWall(
    name: string,
    length: number,
    height: number,
    x: number,
    z: number,
    rotation = 0,
  ) {
    const g = group(name, x, z, rotation, walls);
    box(
      "Mortar_core",
      length,
      height,
      0.24,
      0,
      height / 2,
      0,
      0x8c775d,
      g,
      0.018,
      false,
    );
    const rows = Math.floor(height / 0.2),
      colors = [0xa87b4c, 0xb58a58, 0xb08351, 0xbb9160, 0xa77949];
    for (let row = 0; row < rows; row++)
      for (let at = -length / 2; at < length / 2;) {
        const width = Math.min(
          at === -length / 2 && row % 2 ? 0.28 : 0.56,
          length / 2 - at,
        );
        box(
          "Individual_brick",
          Math.max(0.02, width - 0.018),
          0.18,
          0.27,
          at + width / 2,
          0.1 + row * 0.2,
          0,
          colors[Math.floor(random() * colors.length)],
          g,
          0.012,
          false,
        );
        at += width;
      }
    box(
      "Brick_wall_cap",
      length + 0.05,
      0.09,
      0.32,
      0,
      height + 0.025,
      0,
      0xc39a66,
      g,
    );
    return g;
  }
  brickWall("Measured_front_brick_wall", 9, 1.4, 1.3, 6.8);
  brickWall("Measured_left_front_return", 4.85, 1.1, -5.5, 4.625, Math.PI / 2);
  brickWall("Left_cutaway_boundary", 7.3, 0.7, -8, -3.85, Math.PI / 2);
  for (const [x, z] of [
    [-5.5, 7.05],
    [-3.2, 6.8],
    [-8, -0.2],
    [-10.2, -0.2],
    [-8.8, 2.2],
  ])
    post(x, z, 1.6);
  box(
    "Front_blackboard_frame",
    4.2,
    1.15,
    0.12,
    1.3,
    1.05,
    6.98,
    0x4d4c3b,
    walls,
  );
  const board = box(
    "Front_blackboard",
    4.02,
    0.98,
    0.035,
    1.3,
    1.05,
    7.06,
    0x27443e,
    walls,
  );
  (board.material as T.MeshStandardMaterial).emissive.setHex(0x233c33);
  (board.material as T.MeshStandardMaterial).emissiveIntensity = 0.3;
  box(
    "Side_entrance_gate",
    0.08,
    0.95,
    0.85,
    -10.15,
    0.5,
    0.4,
    0x746e5a,
    walls,
  );
  // Pendant wall lamps: warm glass, metal brackets and a small local light.
  function lamp(x: number, z: number, y = 2.6, rotation = 0) {
    const g = group("Warm_wall_lamp", x, z, rotation, walls);
    rod(
      "Lamp_arm",
      new T.Vector3(0, y, 0.04),
      new T.Vector3(0, y, 0.33),
      0.024,
      0x675336,
      g,
    );
    const light = cylinder(
      "Amber_glass",
      0.065,
      0.09,
      0.3,
      0,
      y - 0.17,
      0.33,
      0xffcc75,
      g,
    );
    const glow = new T.MeshStandardMaterial({
      color: 0xffd68c,
      emissive: 0xffb340,
      emissiveIntensity: 0.65,
      roughness: 0.55,
    });
    light.material = glow;
    cylinder("Lamp_cap", 0.1, 0.1, 0.045, 0, y, 0.33, 0x685236, g);
    cylinder("Lamp_base", 0.1, 0.08, 0.04, 0, y - 0.34, 0.33, 0x685236, g);
    const point = new T.PointLight(0xffbd59, 2.5, 2.2, 1.8);
    point.position.set(0, y - 0.15, 0.5);
    g.add(point);
  }
  lamp(-2.2, -8, 2.65);
  lamp(-0.4, -9, 2.65);
  lamp(4.7, 0.8, 2.55, -Math.PI / 2);
  lamp(7.7, 1.3, 2.45);
  lamp(-7.8, -3.8, 1.9, Math.PI / 2);
  // The platform footprint is traced from the scan's horizontal stage surface.
  const stage = group(
    "Measured_presentation_stage",
    venueLayout.stage.x,
    venueLayout.stage.z,
  );
  box("Stage_dark_plinth", 2.5, 0.23, 2.5, 0, 0.125, 0, 0x504b42, stage, 0.025);
  for (let i = 0; i < 8; i++)
    box(
      "Stage_timber_board",
      2.48,
      0.045,
      0.3,
      0,
      0.26,
      -1.08 + i * 0.31,
      [0x6e6252, 0x746756, 0x695f52][i % 3],
      stage,
      0.006,
      false,
    );
  box("Stage_step", 0.28, 0.12, 0.9, -1.39, 0.06, 0.55, 0x88775e, stage);
  const screen = group("Projection_screen", 4.62, -4, -Math.PI / 2);
  box("Screen_frame", 3.25, 1.8, 0.09, 0, 2.15, 0, 0x5c594b, screen);
  box(
    "Screen_fabric",
    3.13,
    1.68,
    0.04,
    0,
    2.15,
    0.065,
    0xf0e4bd,
    screen,
    0.008,
  );
  const lectern = group("Oak_lectern", 3.05, -3.25, -Math.PI / 2);
  box("Lectern_foot", 0.48, 0.07, 0.4, 0, 0.3, 0, 0xb08043, lectern);
  box("Lectern_column", 0.12, 0.78, 0.1, 0, 0.72, 0, palette.wood, lectern);
  const top = box(
    "Lectern_top",
    0.6,
    0.065,
    0.38,
    0,
    1.15,
    0,
    0xc99654,
    lectern,
  );
  top.rotation.x = -0.2;
  function speaker(x: number, z: number, rotation = 0) {
    const g = group("PA_speaker", x, z, rotation);
    box("Speaker_cabinet", 0.43, 1.4, 0.4, 0, 0.7, 0, 0x3c3d36, g, 0.035);
    for (const y of [0.38, 0.95]) {
      const cone = cylinder(
        "Speaker_driver",
        0.12,
        0.12,
        0.02,
        0,
        y,
        0.215,
        0x242924,
        g,
      );
      cone.rotation.x = Math.PI / 2;
      const ring = mesh(
        "Speaker_driver_rim",
        new T.TorusGeometry(0.12, 0.012, 5, 16),
        0x5c5a49,
        g,
      );
      ring.position.set(0, y, 0.23);
    }
  }
  speaker(4.65, -6.25, -Math.PI / 2);
  speaker(2.85, -2.2, -Math.PI / 2);
  speaker(7.6, 6.5);
  // Leaf clusters use thin tapered leaves and visible stems, not oversized round blobs.
  const leafGeo = new T.SphereGeometry(1, 7, 5);
  function plant(
    x: number,
    z: number,
    size = 1,
    y = 0,
    parent: T.Object3D = room,
    kind = 0,
  ) {
    const g = group("Potted_foliage", x, z, 0, parent);
    g.position.y = y;
    g.scale.setScalar(size);
    cylinder("Terracotta_pot", 0.23, 0.17, 0.36, 0, 0.19, 0, 0xb56f3e, g);
    cylinder("Pot_lip", 0.25, 0.25, 0.065, 0, 0.36, 0, 0xc58a54, g);
    cylinder("Pot_soil", 0.218, 0.218, 0.02, 0, 0.397, 0, 0x494635, g);
    for (let i = 0; i < (kind ? 18 : 13); i++) {
      const a = i * 2.399,
        b = 0.54 + (i % 4) * 0.19;
      const reach = 0.18 + (i % 3) * 0.065;
      const end = new T.Vector3(Math.cos(a) * reach, b, Math.sin(a) * reach);
      rod("Plant_stem", new T.Vector3(0, 0.39, 0), end, 0.012, 0x62713b, g);
      const leaf = mesh(
        "Tapered_green_leaf",
        leafGeo,
        [0x6e8539, 0x819848, 0x567136, 0x91a352][i % 4],
        g,
      );
      leaf.position
        .copy(end)
        .add(new T.Vector3(Math.cos(a) * 0.075, 0.04, Math.sin(a) * 0.075));
      leaf.scale.set(0.105, 0.26 + (i % 3) * 0.035, 0.028);
      leaf.rotation.set(Math.sin(a) * 0.6, a, Math.cos(a) * -0.55);
      const vein = rod(
        "Leaf_midvein",
        leaf.position.clone().add(new T.Vector3(0, -0.15, 0)),
        leaf.position.clone().add(new T.Vector3(0, 0.15, 0)),
        0.005,
        0xa1ad63,
        g,
      );
      vein.rotation.copy(leaf.rotation);
    }
  }
  function vine(x: number, z: number, height: number, rotation = 0) {
    const g = group("Trailing_wall_plant", x, z, rotation, walls);
    for (let strand = 0; strand < 3; strand++)
      for (let i = 0; i < 9; i++) {
        const y = height - i * 0.12;
        const xx = Math.sin(i * 0.9 + strand) * 0.065 + strand * 0.13;
        const leaf = mesh(
          "Trailing_leaf",
          leafGeo,
          [0x677d37, 0x829444, 0x98a651][(i + strand) % 3],
          g,
        );
        leaf.scale.set(0.075, 0.13, 0.025);
        leaf.position.set(xx, y, 0.07 + Math.sin(i) * 0.025);
        leaf.rotation.z = (i % 2 ? 1 : -1) * 0.65;
      }
  }
  for (const x of [-2.5, 1.5, 5]) vine(x, 7, 1.55);
  vine(-5.65, 6.2, 1.3, Math.PI / 2);
  function rug(
    name: string,
    w: number,
    d: number,
    x: number,
    z: number,
    color: number,
    parent: T.Object3D = room,
  ) {
    box(name, w, 0.014, d, x, 0.041, z, color, parent, 0.025, false);
    const trim = 0xb9b294;
    for (const zz of [-d / 2 + 0.09, d / 2 - 0.09])
      box(
        "Rug_woven_border",
        w - 0.16,
        0.005,
        0.022,
        x,
        0.052,
        z + zz,
        trim,
        parent,
        0,
        false,
      );
    for (const xx of [-w / 2 + 0.09, w / 2 - 0.09])
      box(
        "Rug_woven_border",
        0.022,
        0.005,
        d - 0.16,
        x + xx,
        0.052,
        z,
        trim,
        parent,
        0,
        false,
      );
  }
  function chair(
    x: number,
    z: number,
    rotation: number,
    color: number,
    parent: T.Object3D,
  ) {
    const g = group("Dining_chair", x, z, rotation, parent);
    for (const a of [-0.2, 0.2])
      for (const b of [-0.18, 0.18]) {
        const leg = box(
          "Chair_timber_leg",
          0.06,
          0.43,
          0.065,
          a,
          0.22,
          b,
          0x775535,
          g,
          0.012,
          false,
        );
        leg.rotation.z = a * 0.14;
      }
    box("Padded_chair_seat", 0.5, 0.11, 0.48, 0, 0.49, 0, color, g, 0.07);
    const back = box(
      "Curved_chair_back",
      0.5,
      0.46,
      0.09,
      0,
      0.76,
      0.22,
      color,
      g,
      0.07,
    );
    back.rotation.x = -0.1;
    for (const a of [-0.2, 0.2])
      box(
        "Chair_back_support",
        0.045,
        0.4,
        0.05,
        a,
        0.64,
        0.2,
        0x80613e,
        g,
        0.01,
        false,
      );
  }
  function laptop(x: number, z: number, rotation: number, parent: T.Object3D) {
    const g = group("Laptop", x, z, rotation, parent);
    g.position.y = 0.86;
    box("Laptop_keyboard", 0.38, 0.025, 0.28, 0, 0.02, 0, 0x9b9c8d, g, 0.014);
    const panel = box(
      "Laptop_lid",
      0.38,
      0.25,
      0.024,
      0,
      0.15,
      -0.135,
      0x545d55,
      g,
      0.012,
    );
    panel.rotation.x = -0.15;
    box(
      "Laptop_display",
      0.32,
      0.195,
      0.008,
      0,
      0.15,
      -0.113,
      0xa3b8a6,
      g,
      0.005,
      false,
    );
    box(
      "Laptop_trackpad",
      0.09,
      0.003,
      0.055,
      0,
      0.036,
      0.06,
      0x7c8980,
      g,
      0.004,
      false,
    );
    for (let i = 0; i < 3; i++)
      box(
        "Keyboard_row",
        0.28,
        0.003,
        0.012,
        0,
        0.037,
        -0.05 + i * 0.026,
        0x727b73,
        g,
        0,
        false,
      );
  }
  function mug(x: number, z: number, parent: T.Object3D) {
    cylinder("Ceramic_mug", 0.053, 0.05, 0.11, x, 0.93, z, 0xd2ba80, parent);
    cylinder(
      "Coffee_surface",
      0.041,
      0.041,
      0.004,
      x,
      0.987,
      z,
      0x4c3928,
      parent,
    );
    const handle = mesh(
      "Mug_handle",
      new T.TorusGeometry(0.038, 0.01, 5, 8),
      0xd2ba80,
      parent,
    );
    handle.position.set(x + 0.055, 0.94, z);
  }
  desks.forEach((p, i) => {
    const name = i < venueLayout.tables.length
      ? `Measured_worktable_${i + 1}`
      : `Added_rear_left_worktable_${i - venueLayout.tables.length + 1}`;
    const g = group(name, p.x, p.z, p.rotation);
    g.scale.y = 0.88;
    box(
      "Shared_table_top",
      p.width,
      0.11,
      p.length,
      0,
      0.79,
      0,
      0xc89556,
      g,
      0.055,
    );
    for (let board = 0; board < 3; board++)
      box(
        "Oak_top_plank",
        p.width / 3 - 0.008,
        0.015,
        p.length - 0.035,
        -p.width / 3 + (board * p.width) / 3,
        0.852,
        0,
        [0xc28e4e, 0xc9975b, 0xbe8848, 0xd09e60][board],
        g,
        0.008,
        false,
      );
    for (const x of [-p.width / 2 + 0.1, p.width / 2 - 0.1])
      for (const z of [-p.length / 2 + 0.2, p.length / 2 - 0.2])
        box("Table_square_leg", 0.1, 0.76, 0.1, x, 0.38, z, 0x705132, g, 0.014);
    box(
      "Table_long_stretcher",
      0.07,
      0.09,
      p.length - 0.5,
      0,
      0.22,
      0,
      0x85633e,
      g,
    );
    const seats = Math.max(2, Math.floor(p.length / 1.05));
    for (const side of [-1, 1])
      for (let j = 0; j < seats; j++) {
        const z = -p.length / 2 + ((j + 0.5) * p.length) / seats;
        chair(
          side * (p.width / 2 + 0.3),
          z,
          side === -1 ? -Math.PI / 2 : Math.PI / 2,
          [palette.sage, palette.clay, 0xc3b897, 0x6f8669][
            (j + (side + 1) + i) % 4
          ],
          g,
        );
        laptop(
          side * p.width * 0.24,
          z,
          side === -1 ? -Math.PI / 2 : Math.PI / 2,
          g,
        );
        mug(side * p.width * 0.3, z + 0.3, g);
        box(
          "Notebook",
          0.17,
          0.025,
          0.22,
          side * p.width * 0.24,
          0.878,
          z - 0.28,
          0xdfd0ac,
          g,
          0.007,
          false,
        );
      }
    for (let z = -p.length / 2 + 0.65; z < p.length / 2; z += 1.5)
      plant(0, z, 0.25, 0.87, g);
    box(
      "Table_book_stack",
      0.24,
      0.11,
      0.3,
      0.04,
      0.93,
      p.length * 0.28,
      0x667a65,
      g,
      0.012,
    );
  });
  function shelving(x: number, z: number, w: number, h: number, rotation = 0) {
    const g = group("Oak_open_shelving", x, z, rotation);
    box("Cabinet_back", w, h, 0.08, 0, h / 2, -0.25, 0x725236, g);
    for (const xx of [-w / 2, w / 2])
      box("Cabinet_upright", 0.09, h, 0.65, xx, h / 2, 0, palette.wood, g);
    for (const yy of [0.12, h * 0.5, h])
      box("Cabinet_shelf", w + 0.1, 0.08, 0.67, 0, yy, 0, 0xbc8a4f, g);
    for (let slot = 0; slot < Math.floor(w / 0.55); slot++) {
      const xx = -w / 2 + 0.32 + slot * 0.55;
      box(
        "Shelf_storage_basket",
        0.4,
        0.26,
        0.4,
        xx,
        0.3,
        0.05,
        [0x8d7d5d, 0xa28c63, 0x7b8068][slot % 3],
        g,
        0.025,
      );
      for (let j = 0; j < 4; j++)
        box(
          "Shelf_book",
          0.065,
          0.22 + random() * 0.1,
          0.23,
          xx - 0.12 + j * 0.07,
          h * 0.5 + 0.17,
          0.07,
          [0x687762, 0xbbaa80, 0xa4724d, 0x54645c][j],
          g,
          0.008,
          false,
        );
    }
    plant(-w * 0.25, 0, 0.48, h + 0.05, g);
    box("Shelf_book_stack", 0.42, 0.09, 0.3, w * 0.25, h + 0.1, 0, 0xd1c39d, g);
  }
  // The central rows in the source are audience chairs, not worktables.
  for (const seat of audienceSeats)
    chair(seat.x, seat.z, -Math.PI / 2, 0x555d50, room);
  // Storage/equipment volumes follow the visible scan clusters. Decorative planting is stylistic.
  shelving(0.8, -8.65, 1.7, 0.85);
  const counter = group("Measured_side_counter", -6.5, -0.85);
  box("Counter_body", 2.3, 0.7, 0.8, 0, 0.35, 0, 0x4e5048, counter);
  box("Counter_top", 2.3, 0.09, 0.85, 0, 0.76, 0, 0x53594d, counter);
  shelving(6.5, 1.55, 2.65, 0.8);
  for (const [x, w] of [
    [6, 0.65],
    [7.1, 0.75],
  ]) {
    box("Equipment_case", w, 0.3, 0.5, x, 1, 1.55, 0x6c6a59);
    box("Equipment_case_lid", w + 0.04, 0.035, 0.53, x, 1.17, 1.55, 0xc6bea4);
    box("Equipment_front_panel", w - 0.08, 0.16, 0.02, x, 1, 1.82, 0x444c42);
  }
  const island = group("Measured_equipment_island", 6.9, 2.9, Math.PI / 4);
  box("Equipment_cabinet", 0.9, 0.8, 0.85, 0, 0.4, 0, 0x635d48, island);
  box("Equipment_oak_top", 1, 0.08, 0.95, 0, 0.85, 0, 0xc89556, island);
  plant(-0.25, 0, 0.3, 0.9, island);
  // One small functional prop supports PetsTown's existing water-cooler meeting.
  box("Water_cooler", 0.5, 0.95, 0.5, 5.65, 0.48, 2.25, 0xd9d3bb);
  cylinder("Water_jug", 0.18, 0.2, 0.37, 5.65, 1.14, 2.25, 0x85a7a3);
  box("Cooler_tap", 0.09, 0.08, 0.08, 5.65, 0.75, 2.54, 0x48594d);
  for (const [x, z, size] of [
    [-1.6, -8.25, 0.85],
    [2.6, -8.6, 1],
    [4.35, -7.2, 0.8],
    [7.5, 1.75, 0.9],
    [7.4, 4.2, 0.7],
    [-5.15, 6.5, 0.8],
    [-3, 6.45, 0.7],
  ])
    plant(x, z, size);
  room.add(buildVenueSignage());
  for (const [name, p] of [
    ["Help_desk", venueLayout.helpDesk],
    ["Stage_AV_desk", venueLayout.stageDesk],
  ] as const) {
    const g = group(name, p.x, p.z, p.rotation);
    box("Black_desk_top", p.width, 0.07, p.depth, 0, 0.9, 0, 0x303331, g);
    box("Black_desk_front", p.width, 0.85, 0.055, 0, 0.44, p.depth / 2, 0x282c2b, g);
    for (const side of [-1, 1]) {
      box("Desk_side_panel", 0.055, 0.85, p.depth, side * p.width / 2, 0.44, 0, 0x323633, g);
      box("Desk_front_frame", 0.045, 0.88, 0.075, side * (p.width / 2 - 0.035), 0.45, p.depth / 2, 0x171c1b, g);
    }
    // The photographs show black portable desks with laptops and mesh upper panels.
    for (let y = 0.63; y < 0.84; y += 0.045)
      box("Desk_grille", p.width - 0.12, 0.013, 0.012, 0, y, p.depth / 2 + 0.032, 0x636760, g, 0, false);
    const devices = new T.Group();
    devices.position.y = 0.075;
    g.add(devices);
    laptop(-p.width * 0.18, -0.03, Math.PI, devices);
    if (name === "Help_desk") laptop(p.width * 0.24, -0.03, Math.PI, devices);
  }
  return { room, walls };
}
