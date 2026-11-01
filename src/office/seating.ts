import type { Point } from './layout';

// Centers of the actual chair cushions in the 1000px-wide office artwork.
export const DESK_SEATS: readonly Point[] = [
  { x: 218, y: 119 }, { x: 286, y: 119 },
  { x: 216, y: 272 }, { x: 286, y: 272 },
  { x: 212, y: 349 }, { x: 284, y: 349 },
  { x: 694, y: 72 }, { x: 762, y: 72 },
  { x: 694, y: 151 }, { x: 762, y: 151 },
  { x: 692, y: 275 }, { x: 762, y: 275 },
  { x: 695, y: 351 }, { x: 767, y: 351 },
];
export const REST_SEATS: readonly Point[] = [
  { x: 130, y: 493 }, { x: 262, y: 493 },
  { x: 737, y: 493 }, { x: 871, y: 493 },
  { x: 880, y: 106 }, { x: 929, y: 108 }, { x: 966, y: 142 },
  { x: 882, y: 299 }, { x: 927, y: 302 }, { x: 948, y: 345 },
];

/** Stable occupied seats; departed occupants release seats without moving others. */
export function createSeatAssignments(kind: 'desk' | 'rest') {
  const seats = kind === 'desk' ? DESK_SEATS : REST_SEATS;
  const slots = new Map<string, number>();
  return (ids: readonly string[]): Map<string, Point> => {
    const present = new Set(ids);
    for (const id of slots.keys()) if (!present.has(id)) slots.delete(id);
    const taken = new Set(slots.values());
    for (const id of ids) if (!slots.has(id)) {
      let index = 0;
      while (taken.has(index)) index++;
      slots.set(id, index); taken.add(index);
    }
    return new Map(ids.map(id => {
      const index = slots.get(id)!;
      const extra = index - seats.length;
      const point = seats[index] ?? { x: 1070 + (extra % 4) * 100, y: (kind === 'desk' ? 110 : 490) + Math.floor(extra / 4) * 100 };
      return [id, { ...point }];
    }));
  };
}
