import test from 'node:test';
import assert from 'node:assert/strict';
import { advancePoint } from './movement';

test('an initial RAF timestamp before setup cannot poison a zero-length path step', () => {
  const origin = { x: -8.75, z: 0.5 };
  assert.deepEqual(advancePoint(origin, origin, -0.001), { ...origin, arrived: true });
  assert.deepEqual(advancePoint(origin, { x: -8.5, z: 0.5 }, -0.001), { ...origin, arrived: false });
});

test('movement advances at bounded speed and snaps to a reached point', () => {
  assert.deepEqual(advancePoint({ x: 0, z: 0 }, { x: 1, z: 0 }, 0.02), { x: 0.07, z: 0, arrived: false });
  assert.deepEqual(advancePoint({ x: 0, z: 0 }, { x: 0.01, z: 0 }, 0.02), { x: 0.01, z: 0, arrived: true });
});
