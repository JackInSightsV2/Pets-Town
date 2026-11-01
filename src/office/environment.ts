import type { OfficeGeometry } from './layout';

/** Elliot can supply floor areas and waypoints here without changing agent mapping. */
export const officeGeometry: Partial<OfficeGeometry> = {
  canvas: { width: 1000, height: 1000 * 941 / 1672 },
  entrance: { x: 500, y: 525 },
  standup: { x: 500, y: 260 },
  waterCooler: [{ x: 550, y: 145 }, { x: 610, y: 145 }],
};
