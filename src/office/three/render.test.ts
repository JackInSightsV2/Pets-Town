import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as T from 'three';
import { buildVenue } from './venue';
import { createVenueDisplay } from './render';

test('batched display preserves room bounds and triangles while keeping walls separate', () => {
  const {room,walls:sourceWalls}=buildVenue();
  const {display,walls}=createVenueDisplay(room,sourceWalls);
  const stats=(root:T.Object3D)=>{let calls=0,vertices=0;root.traverse(o=>{if(o instanceof T.Mesh){calls++;vertices+=o.geometry.index?.count??o.geometry.attributes.position.count;}});return {calls,vertices};};
  const original=stats(room),batched=stats(display);
  assert.equal(batched.vertices,original.vertices);
  assert.ok(batched.calls<original.calls/10);
  const a=new T.Box3().setFromObject(room),b=new T.Box3().setFromObject(display);
  assert.ok(a.min.distanceTo(b.min)<.00001 && a.max.distanceTo(b.max)<.00001);
  assert.ok(walls.children.length>0);
  assert.equal(sourceWalls.visible,true);
  walls.visible=false;
  assert.equal(sourceWalls.visible,true,'display toggles must not remove walls from the exported room');
});
