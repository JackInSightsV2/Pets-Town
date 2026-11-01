import * as T from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

/** Batch the static display while retaining separate, editable objects for GLB export. */
export function createVenueDisplay(source: T.Group, sourceWalls: T.Group) {
  source.updateWorldMatrix(true, true);
  const display = new T.Group();
  const walls = new T.Group();
  display.add(walls);
  const batches = new Map<T.Object3D, Map<T.Material, { geometries: T.BufferGeometry[]; lines: boolean }>>();
  batches.set(display, new Map()); batches.set(walls, new Map());
  source.traverse(object => {
    let parent: T.Object3D | null = object;
    let isWall = false;
    while(parent) { if(parent === sourceWalls) isWall = true; parent = parent.parent; }
    const target = isWall ? walls : display;
    if(object instanceof T.PointLight) {
      const light = object.clone(); light.position.setFromMatrixPosition(object.matrixWorld); target.add(light);
    }
    if(!(object instanceof T.Mesh || object instanceof T.LineSegments)) return;
    if(Array.isArray(object.material)) throw new Error('Venue batches require one material per object.');
    const geometry = object.geometry.index ? object.geometry.toNonIndexed() : object.geometry.clone();
    for(const attribute of Object.keys(geometry.attributes)) if(!['position','normal'].includes(attribute)) geometry.deleteAttribute(attribute);
    geometry.applyMatrix4(object.matrixWorld);
    const group = batches.get(target)!;
    let batch = group.get(object.material);
    if(!batch) { batch = { geometries: [], lines: object instanceof T.LineSegments }; group.set(object.material, batch); }
    batch.geometries.push(geometry);
  });
  for(const [target, materials] of batches) for(const [material, batch] of materials) {
    const geometry = mergeGeometries(batch.geometries, false);
    if(!geometry) throw new Error('Unable to batch the venue geometry.');
    for(const sourceGeometry of batch.geometries) sourceGeometry.dispose();
    const object = batch.lines ? new T.LineSegments(geometry,material) : new T.Mesh(geometry,material);
    object.castShadow = !batch.lines; object.receiveShadow = !batch.lines; target.add(object);
  }
  return {display, walls};
}
