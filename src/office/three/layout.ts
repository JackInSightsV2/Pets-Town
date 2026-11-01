/** Layout traced from the original GLB in an orthographic view after a -53° Y rotation.
 * Values preserve scan units; physical metres have not been calibrated.
 * Stage/table rectangles are supported by horizontal mesh surfaces. The incomplete
 * northwest edge and floor holes are closed approximately; see the layout notes.
 */
export const venueLayout = {
  rotationDegrees: -53,
  boundary: [
    [-8, -7.5],
    [-6, -8.2],
    [-2.2, -8.2],
    [-2.2, -8.6],
    [-0.4, -8.6],
    [-0.4, -9.2],
    [2.85, -9.2],
    [4.8, -8.2],
    [5, -5.7],
    [4.8, 1.1],
    [7.9, 1.1],
    [7.9, 6.8],
    [7.7, 7.8],
    [5.8, 7.8],
    [5.8, 6.8],
    [-3.2, 6.8],
    [-3.2, 7.05],
    [-5.5, 7.05],
    [-5.5, 2.2],
    [-8.8, 2.2],
    [-8.8, 1.1],
    [-10.2, 0.9],
    [-10.2, -0.2],
    [-8, -0.2],
  ],
  stage: {
    x: 3.75,
    z: -4,
    width: 2.5,
    depth: 2.5,
  },
  tables: [
    {
      x: -2.75,
      z: -6.2,
      width: 0.8,
      length: 2.65,
      rotation: 0,
    },
    {
      x: -3.3,
      z: -2.5,
      width: 0.8,
      length: 2.5,
      rotation: 0,
    },
    {
      x: -6.5,
      z: -2.65,
      width: 0.85,
      length: 2.3,
      rotation: 1.57079632679,
    },
    {
      x: -1.8,
      z: 1.25,
      width: 0.9,
      length: 2.6,
      rotation: 1.57079632679,
    },
    {
      x: 1.5,
      z: 4.9,
      width: 0.75,
      length: 2.3,
      rotation: 0,
    },
    {
      x: 3.4,
      z: 4.95,
      width: 0.75,
      length: 2.25,
      rotation: 0,
    },
  ],
  // Requested additions: these do not replace the six scan-traced tables.
  extraTables: [
    { x: -6.35, z: -6.9, width: 0.8, length: 2.15, rotation: Math.PI / 2 },
    { x: -6.35, z: -4.65, width: 0.8, length: 2.15, rotation: Math.PI / 2 },
  ],
  // Photo-informed fixtures; placement follows Elliott's stage-facing directions.
  backdrop: { x: -4.85, z: 4.55, width: 2.55, height: 1.95, rotation: Math.PI / 2 },
  helpDesk: { x: 6.65, z: 5.8, width: 1.65, depth: 0.75, rotation: -Math.PI / 2 },
  helpSign: { x: 7.1, z: 1.95, width: 1.85, height: 0.54, rotation: -Math.PI / 4 },
  stageDesk: { x: 3.6, z: -1.8, width: 0.9, depth: 0.7, rotation: -Math.PI / 2 },
};
export const audienceSeats = [-0.65, 0.7].flatMap((x) =>
  [-6.35, -5.7, -5.05, -4.4, -3.75].map((z) => ({ x, z })),
);
export const meetingPoints = [
  { x: 4.7, z: 3 },
  { x: 5.5, z: 3 },
];
export function insideVenue(p: { x: number; z: number }) {
  const polygon = venueLayout.boundary;
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const a = polygon[i],
      b = polygon[j];
    if (
      a[1] > p.z !== b[1] > p.z &&
      p.x < ((b[0] - a[0]) * (p.z - a[1])) / (b[1] - a[1]) + a[0]
    )
      inside = !inside;
  }
  return inside;
}
