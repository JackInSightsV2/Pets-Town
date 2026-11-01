import * as T from "three";
import { RoundedBoxGeometry } from "three/addons/geometries/RoundedBoxGeometry.js";
import { desks } from "./navigation";

/** Clean editable scene objects; contains no scan data, photos or pet artwork. */
export function buildVenue() {
  const room = new T.Group();
  room.name = "PetsTown_Venue";
  const colors = {
    floor: 0xd3c7b1,
    edge: 0xb19c7e,
    wood: 0xc99660,
    dark: 0x373e3d,
    metal: 0x495550,
    green: 0x7e987c,
    clay: 0xb97051,
    wall: 0xba9571,
    leaf: 0x608258,
  };
  const mats = new Map<number, T.MeshStandardMaterial>();
  function mat(color: number) {
    if (!mats.has(color))
      mats.set(color, new T.MeshStandardMaterial({ color, roughness: 0.88 }));
    return mats.get(color)!;
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
    round = 0.03,
    parent: T.Object3D = room,
  ) {
    const m = new T.Mesh(
      round
        ? new RoundedBoxGeometry(
            w,
            h,
            d,
            2,
            Math.min(round, w / 3, h / 3, d / 3),
          )
        : new T.BoxGeometry(w, h, d),
      mat(color),
    );
    m.name = name;
    m.position.set(x, y, z);
    m.castShadow = true;
    m.receiveShadow = true;
    parent.add(m);
    return m;
  }
  function cyl(
    name: string,
    r1: number,
    r2: number,
    h: number,
    x: number,
    y: number,
    z: number,
    color: number,
    parent: T.Object3D = room,
  ) {
    const m = new T.Mesh(new T.CylinderGeometry(r1, r2, h, 12), mat(color));
    m.name = name;
    m.position.set(x, y, z);
    m.castShadow = true;
    m.receiveShadow = true;
    parent.add(m);
    return m;
  }
  const floor = new T.Shape();
  floor.moveTo(-9, -7);
  floor.lineTo(3, -7);
  floor.lineTo(3, -2);
  floor.lineTo(9, -2);
  floor.lineTo(9, 7);
  floor.lineTo(-9, 7);
  floor.closePath();
  const geo = new T.ExtrudeGeometry(floor, {
    depth: 0.3,
    bevelEnabled: true,
    bevelSegments: 1,
    steps: 1,
    bevelSize: 0.08,
    bevelThickness: 0.06,
  });
  geo.rotateX(Math.PI / 2);
  geo.translate(0, -0.04, 0);
  const slab = new T.Mesh(geo, mat(colors.floor));
  slab.name = "Continuous_floor";
  slab.receiveShadow = true;
  room.add(slab);
  // Subtle concrete tile seams, each segment contained by the stepped footprint.
  for (let x = -8; x <= 8; x += 2)
    box(
      "Floor_joint",
      0.012,
      0.006,
      x < 3 ? 14 : 9,
      x,
      0.007,
      x < 3 ? 0 : 2.5,
      0xc3b8a4,
      0,
    );
  for (let z = -6; z <= 6; z += 2)
    box(
      "Floor_joint",
      z < -2 ? 12 : 18,
      0.006,
      0.012,
      z < -2 ? -3 : 0,
      0.008,
      z,
      0xc3b8a4,
      0,
    );
  const walls = new T.Group();
  walls.name = "Cutaway_walls";
  room.add(walls);
  box("Back_wall", 12, 3.6, 0.18, -3, 1.8, -7, colors.dark, 0.02, walls);
  box("Recess_wall", 0.18, 3.6, 5, 3, 1.8, -4.5, colors.dark, 0.02, walls);
  box("Wing_wall", 6, 3.1, 0.18, 6, 1.55, -2, colors.dark, 0.02, walls);
  box("Right_wall", 0.18, 1.1, 9, 9, 0.55, 2.5, colors.wall, 0.02, walls);
  box("Front_brick_wall", 14, 0.6, 0.18, 2, 0.3, 7, colors.wall, 0.02, walls);
  box("Left_low_wall", 0.18, 0.7, 14, -9, 0.35, 0, colors.wall, 0.02, walls);
  for (let i = 0; i < 47; i++)
    cyl(
      "Curtain_fold",
      0.15,
      0.15,
      3.45,
      -8.8 + i * 0.245,
      1.73,
      -6.82,
      i % 2 ? 0x3e4542 : 0x454b48,
      walls,
    );
  for (let i = 0; i < 23; i++)
    cyl(
      "Side_curtain_fold",
      0.14,
      0.14,
      2.95,
      3.25 + i * 0.245,
      1.48,
      -1.82,
      i % 2 ? 0x3e4542 : 0x454b48,
      walls,
    );
  for (const x of [-8.8, -3, 2.8]) {
    box("Timber_column", 0.2, 3.9, 0.23, x, 1.95, -6.55, colors.wood);
    box("Wall_lamp", 0.1, 0.4, 0.12, x, 2.6, -6.36, 0xffd79a);
  }
  box("Stage", 3.5, 0.34, 2.4, 0.6, 0.17, -5, 0x665d50, 0.07);
  box("Stage_step", 1.6, 0.16, 0.35, 0.6, 0.08, -3.65, 0x7a6b58);
  box("Projection_screen", 3.2, 1.75, 0.08, 0.6, 2.3, -6.55, 0xe7e3cf);
  box("Lectern_base", 0.55, 0.1, 0.45, 0.6, 0.4, -4.7, colors.wood);
  box("Lectern_stem", 0.12, 0.8, 0.12, 0.6, 0.82, -4.7, colors.wood);
  const lectern = box(
    "Lectern_top",
    0.65,
    0.08,
    0.44,
    0.6,
    1.25,
    -4.7,
    colors.wood,
  );
  lectern.rotation.x = 0.18;
  for (const x of [-1.6, 2.4]) {
    box("Speaker", 0.42, 1.1, 0.4, x, 0.55, -5.9, colors.dark);
    for (const y of [0.25, 0.7]) {
      const s = cyl("Speaker_cone", 0.13, 0.13, 0.02, x, y, -5.69, 0x252b29);
      s.rotation.x = Math.PI / 2;
    }
  }
  function plant(x: number, z: number, size = 1) {
    const g = new T.Group();
    g.name = "Potted_plant";
    g.position.set(x, 0, z);
    g.scale.setScalar(size);
    room.add(g);
    cyl("Terracotta_pot", 0.26, 0.2, 0.45, 0, 0.23, 0, colors.clay, g);
    cyl("Soil", 0.23, 0.23, 0.025, 0, 0.46, 0, 0x4f4b38, g);
    for (let i = 0; i < 7; i++) {
      const a = (i * Math.PI * 2) / 7;
      const stem = cyl(
        "Stem",
        0.022,
        0.028,
        0.65,
        Math.cos(a) * 0.09,
        0.75,
        Math.sin(a) * 0.09,
        0x516840,
        g,
      );
      stem.rotation.z = Math.sin(a) * 0.35;
      const leaf = new T.Mesh(
        new T.IcosahedronGeometry(0.3, 1),
        mat(i % 2 ? colors.leaf : 0x879b5f),
      );
      leaf.scale.set(0.5, 1.6, 0.7);
      leaf.position.set(
        Math.cos(a) * 0.22,
        1 + (i % 3) * 0.12,
        Math.sin(a) * 0.22,
      );
      leaf.rotation.z = Math.cos(a) * 0.5;
      leaf.castShadow = true;
      g.add(leaf);
    }
  }
  function chair(
    x: number,
    z: number,
    rotation: number,
    color: number,
    parent: T.Object3D,
  ) {
    const g = new T.Group();
    g.name = "Chair";
    g.position.set(x, 0, z);
    g.rotation.y = rotation;
    parent.add(g);
    box("Seat", 0.48, 0.12, 0.46, 0, 0.48, 0, color, 0.06, g);
    box("Back", 0.48, 0.48, 0.1, 0, 0.76, 0.2, color, 0.06, g);
    for (const a of [-0.18, 0.18])
      for (const b of [-0.16, 0.16])
        box("Chair_leg", 0.045, 0.43, 0.045, a, 0.22, b, colors.metal, 0.01, g);
  }
  desks.forEach((p, i) => {
    const g = new T.Group();
    g.name = `Worktable_${i + 1}`;
    g.position.set(p.x, 0, p.z);
    room.add(g);
    box("Oak_desktop", 1.5, 0.13, 2.2, 0, 0.88, 0, colors.wood, 0.07, g);
    for (const x of [-0.6, 0.6])
      for (const z of [-0.9, 0.9])
        box("Desk_leg", 0.08, 0.82, 0.08, x, 0.41, z, colors.metal, 0.015, g);
    for (const side of [-1, 1])
      for (const z of [-0.65, 0.65]) {
        chair(
          side * 1.02,
          z,
          (side * Math.PI) / 2,
          i % 2 ? colors.clay : colors.green,
          g,
        );
        box(
          "Laptop_base",
          0.43,
          0.025,
          0.3,
          side * 0.39,
          0.965,
          z,
          0x909e94,
          0.015,
          g,
        );
        const screen = box(
          "Laptop_screen",
          0.43,
          0.29,
          0.025,
          side * 0.39,
          1.1,
          z - 0.14,
          colors.dark,
          0.015,
          g,
        );
        screen.rotation.x = -0.12;
        box(
          "Laptop_display",
          0.37,
          0.22,
          0.012,
          side * 0.39,
          1.1,
          z - 0.119,
          0x8cae9a,
          0.005,
          g,
        );
        cyl(
          "Mug",
          0.06,
          0.055,
          0.12,
          side * 0.5,
          1.01,
          z + 0.3,
          colors.clay,
          g,
        );
      }
    plant(p.x, p.z, 0.35);
  });
  box("Sofa_base", 3.5, 0.45, 1.4, 6.4, 0.28, 4.8, 0x637e72, 0.15);
  box("Sofa_back", 3.5, 0.8, 0.25, 6.4, 0.8, 5.35, 0x78907e, 0.1);
  for (const x of [4.8, 8])
    box("Sofa_arm", 0.3, 0.6, 1.4, x, 0.65, 4.8, 0x78907e, 0.1);
  for (const x of [5.3, 6.4, 7.5])
    box("Sofa_cushion", 1, 0.18, 1, x, 0.61, 4.7, 0x97a58b, 0.08);
  box("Lounge_rug", 4.5, 0.018, 3.8, 6.4, 0.025, 4, 0xb47d60, 0.04);
  box("Coffee_table", 1.4, 0.12, 0.8, 6.3, 0.48, 3, colors.wood, 0.12);
  for (const x of [5.8, 6.8])
    box("Coffee_leg", 0.09, 0.45, 0.5, x, 0.23, 3, colors.metal);
  box("Coffee_counter", 2.2, 0.95, 1.1, 7.4, 0.48, -0.9, colors.wood, 0.05);
  box("Countertop", 2.3, 0.09, 1.18, 7.4, 1, -0.9, 0xe5dbbd);
  box("Coffee_machine", 0.55, 0.5, 0.4, 7.8, 1.3, -0.95, colors.metal);
  box("Coffee_cabinet", 0.45, 0.28, 0.3, 6.8, 1.16, -0.95, 0xd4bb91);
  box("Water_cooler", 0.65, 1, 0.65, 4.7, 0.5, -0.9, 0xe7e5d7, 0.07);
  const jug = cyl("Water_jug", 0.23, 0.25, 0.45, 4.7, 1.2, -0.9, 0x7eafbd);
  box("Cooler_tap", 0.11, 0.09, 0.1, 4.7, 0.77, -0.53, colors.dark);
  for (const [x, z, s] of [
    [-8, -5.9, 1.1],
    [2, -2.4, 1],
    [8.1, 6, 1.2],
    [-8, 5.7, 1.3],
    [3.7, -0.8, 0.8],
  ])
    plant(x, z, s);
  const rug = new T.Mesh(new T.CircleGeometry(1.6, 48), mat(0xb5946f));
  rug.name = "Standup_rug";
  rug.rotation.x = -Math.PI / 2;
  rug.position.set(0.5, 0.025, 0.7);
  rug.receiveShadow = true;
  room.add(rug);
  return { room, walls };
}
