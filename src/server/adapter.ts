import type { OfficeEvent, OfficeSnapshot } from '../shared/contract.js';
import { emptySnapshot } from '../shared/contract.js';

/** Observation only. Events are normalized; bridge replaces source ordering with its own epoch/seq. */
export interface OfficeAdapter {
  initialSnapshot(): OfficeSnapshot | Promise<OfficeSnapshot>;
  subscribe(listener: (event: OfficeEvent) => void): () => void;
  stop(): void | Promise<void>;
}
export function createUnsupportedAdapter(): OfficeAdapter {
  return { initialSnapshot: () => emptySnapshot(), subscribe: () => () => {}, stop() {} };
}
