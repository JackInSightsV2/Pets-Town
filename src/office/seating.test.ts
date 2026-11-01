import test from 'node:test';
import assert from 'node:assert/strict';
import { createSeatAssignments, DESK_SEATS, REST_SEATS } from './seating';

test('seat assignments survive reordering and departures without moving remaining pets', () => {
  const seats = createSeatAssignments('desk');
  const before = seats(['parent', 'child', 'other']);
  const after = seats(['other', 'child', 'new']);
  assert.deepEqual(after.get('child'), before.get('child'));
  assert.deepEqual(after.get('other'), before.get('other'));
  assert.deepEqual(after.get('new'), DESK_SEATS[0]);
});
test('capacity overflow gets distinct furnished positions and rest never uses a desk', () => {
  const desks = createSeatAssignments('desk')(Array.from({length:30}, (_,i)=>String(i)));
  assert.equal(new Set([...desks.values()].map(p=>`${p.x}:${p.y}`)).size,30);
  assert.ok([...desks.values()].slice(DESK_SEATS.length).every(p=>p.x>1000));
  const rest = createSeatAssignments('rest')(['idle']);
  assert.deepEqual(rest.get('idle'), REST_SEATS[0]);
  assert.ok(!DESK_SEATS.some(p=>p.x===REST_SEATS[0].x && p.y===REST_SEATS[0].y));
});
