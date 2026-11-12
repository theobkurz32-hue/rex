import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { build } from 'vite';
import * as T from 'three';

await build({ configFile: false, logLevel: 'error', build: {
  outDir: '.test-runtime/mobile-colliders', emptyOutDir: true,
  lib: { entry: { model: 'src/model.ts', physics: 'src/physics.ts', detail: 'src/collision-detail.ts', cache: 'src/scene-cache.ts' }, formats: ['es'] },
  rolldownOptions: { external: ['three', 'three-mesh-bvh', '@dimforge/rapier3d-compat', 'fflate'] },
} });
const { BimModel } = await import('../.test-runtime/mobile-colliders/model.js');
const { Physics } = await import('../.test-runtime/mobile-colliders/physics.js');
const { canSimplifyCollider, furnitureColliderGeometry } = await import('../.test-runtime/mobile-colliders/detail.js');
const { decodeSceneChunk, unpackGzip } = await import('../.test-runtime/mobile-colliders/cache.js');
const definitions = [], parts = [], elements = [];
let nextKey = 1;
function element(id, type, name, shapes) {
  elements.push({ id, type, name, storey: null });
  for (const [geometry, transform] of shapes) {
    const key = nextKey++, position = geometry.getAttribute('position'), normal = geometry.getAttribute('normal');
    const vertices = new Float32Array(position.count * 6);
    for (let i = 0; i < position.count; i++) vertices.set([position.getX(i), position.getY(i), position.getZ(i), normal.getX(i), normal.getY(i), normal.getZ(i)], i * 6);
    definitions.push({ key, vertices, indices: new Uint32Array(geometry.index.array) });
    parts.push({ id, key, matrix: transform.toArray(), color: [.5, .5, .5, 1] });
    geometry.dispose();
  }
}
const translated = (x, y, z) => new T.Matrix4().makeTranslation(x, y, z);
const dense = (x, y, z) => new T.BoxGeometry(x, y, z, 12, 12, 12);
element(1, 'IfcSlab', 'Piso', [[new T.BoxGeometry(20, .2, 20), translated(0, -.1, 0)]]);
// Two separate furniture parts leave a usable gap. Simplifying the whole
// element's bounding box would wrongly close this passage.
element(2, 'IfcFurnishingElement', 'Armário com passagem', [[dense(.5, 1.7, .5), translated(-1, .85, 0)], [dense(.5, 1.7, .5), translated(1, .85, 0)]]);
// The wall itself has a real doorway between its piers and below its lintel.
element(3, 'IfcWallStandardCase', 'Parede com vão', [[dense(1, 2.4, .2), translated(-1.5, 1.2, 2.5)], [dense(1, 2.4, .2), translated(1.5, 1.2, 2.5)], [dense(2, .4, .2), translated(0, 2.2, 2.5)]]);
element(4, 'IfcStairFlight', 'Escada', [[dense(1, .2, .4), translated(-4, .1, 2)], [dense(1, .4, .4), translated(-4, .2, 2.4)]]);
element(5, 'IfcDoor', 'Porta', [[dense(.8, 2.1, .04), translated(7, 1.05, 1)]]);
element(6, 'IfcWindow', 'Janela', [[dense(.8, 1.1, .04), translated(7, 1.5, -1)]]);
const reflected = new T.Matrix4().compose(new T.Vector3(4, 1, 0), new T.Quaternion().setFromAxisAngle(new T.Vector3(0, 1, 0), .6), new T.Vector3(-1.4, 1, .7));
element(7, 'IfcBuildingElementProxy', 'Espelho', [[dense(.5, 1.7, .08), reflected]]);
const fixture = new BimModel(); fixture.setMeta({ elements, levels: [] }); fixture.add(definitions, parts);
const sourceIndices = new Map([...fixture.byElement].map(([id, entries]) => [id, entries.reduce((n, p) => n + fixture.geometry.get(p.key).getIndex().count, 0)]));
function colliderFor(physics, id) {
  const handle = [...physics.colliderElement].find(([, elementID]) => elementID === id)?.[0];
  assert.notEqual(handle, undefined); return physics.world.getCollider(handle);
}
const physics = new Physics(); await physics.init(fixture, () => {}, undefined, { lightweightFurniture: true });
for (const id of [1, 3, 4, 5, 6]) assert.equal(colliderFor(physics, id).shape.indices.length, sourceIndices.get(id), `Architecture #${id} must retain every source face`);
assert.equal(colliderFor(physics, 2).shape.indices.length, 2 * 36);
assert.equal(colliderFor(physics, 7).shape.indices.length, 36);
const reflectedPart = fixture.byElement.get(7)[0], original = fixture.geometry.get(reflectedPart.key);
const proxy = furnitureColliderGeometry(original), expected = new T.Box3().setFromBufferAttribute(proxy.getAttribute('position')).applyMatrix4(reflected);
const actual = new T.Box3().setFromArray(colliderFor(physics, 7).shape.vertices);
assert.ok(actual.min.distanceTo(expected.min) < 1e-6 && actual.max.distanceTo(expected.max) < 1e-6, 'Mirrors, rotation and nonuniform scale must be applied to the collider');
proxy.dispose();
for (const type of ['IfcWall', 'IfcSlab', 'IfcStairFlight', 'IfcDoor', 'IfcWindow']) assert.equal(canSimplifyCollider({ type, name: 'Móvel' }, original), false);
assert.equal(canSimplifyCollider({ type: 'IfcBuildingElementProxy', name: 'Laje estrutural' }, original), false);

assert.ok(physics.teleport(new T.Vector3(-1, .015, -2), null));
for (let i = 0; i < 240; i++) physics.step(0, 1.4, false, false);
assert.ok(physics.feet().z < -.49 && physics.feet().z > -.8, 'A human capsule must stop before dense furniture');
assert.ok(physics.teleport(new T.Vector3(0, .015, -2), null));
for (let i = 0; i < 270; i++) physics.step(0, 1.4, false, false);
assert.ok(physics.feet().z > 3.5, 'The capsule must cross the gap between furniture parts and the real wall doorway');
physics.dispose(); fixture.dispose();

// Measure the actual hotel from the prepared original arrays. No second IFC
// parser, source STEP copy or high-memory desktop physics world is needed.
const scene = JSON.parse(readFileSync('public/models/scene/manifest.json'));
const model = new BimModel(); model.setMeta(scene.meta);
for (const chunk of scene.chunks) {
  const data = decodeSceneChunk(unpackGzip(readFileSync('public/models/scene/' + chunk.file)));
  model.add(data.definitions, data.parts);
}
function sourceDigest() {
  const hash = createHash('sha256');
  for (const geometry of model.geometry.values()) {
    const attributes = [geometry.getAttribute('position').data.array, geometry.getIndex().array];
    for (const array of attributes) hash.update(Buffer.from(array.buffer, array.byteOffset, array.byteLength));
  }
  return hash.digest('hex');
}
const before = sourceDigest();
const hotel = new Physics(); await hotel.init(model, () => {}, undefined, { lightweightFurniture: true });
console.log('HOTEL MOBILE COLLIDERS', JSON.stringify(hotel.colliderStats));
assert.equal(hotel.colliderStats.sourceTriangles, 7971644);
assert.ok(hotel.colliderStats.simplifiedParts > 100);
assert.ok(hotel.colliderStats.collisionTriangles < hotel.colliderStats.sourceTriangles * .5, 'Mobile furniture proxies should remove at least half of the collision faces');
assert.equal(sourceDigest(), before, 'Render, selection and BIM geometry must remain byte-for-byte original');
let architecturalElements = 0;
for (const [id, entries] of model.byElement) {
  if (!/IfcWall|IfcSlab|IfcStair|IfcDoor|IfcWindow/.test(model.elements.get(id).type)) continue;
  const originalFaces = entries.reduce((n, p) => n + model.geometry.get(p.key).getIndex().count, 0);
  assert.equal(colliderFor(hotel, id).shape.indices.length, originalFaces);
  architecturalElements++;
}
console.log(JSON.stringify({ pass: true, ...hotel.colliderStats, architecturalElements, reduction: 1 - hotel.colliderStats.collisionTriangles / hotel.colliderStats.sourceTriangles, checks: ['furniture-blocks-human', 'gaps-between-parts', 'real-doorway', 'mirrored-scaled-collider', 'structural-faces-retained', 'original-source-unchanged', 'full-hotel-collision-budget'] }));
hotel.dispose(); model.dispose();
