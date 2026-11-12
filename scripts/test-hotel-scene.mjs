import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { build } from 'vite';
import * as T from 'three';

await build({ configFile: false, logLevel: 'error', build: {
  outDir: '.test-runtime/hotel-scene-check', emptyOutDir: true,
  lib: { entry: { cache: 'src/scene-cache.ts' }, formats: ['es'] },
  rolldownOptions: { external: ['fflate'] },
} });
const { decodeSceneChunk, unpackGzip } = await import('../.test-runtime/hotel-scene-check/cache.js');
const base = 'public/models/scene/';
const manifest = JSON.parse(readFileSync(base + 'manifest.json'));
const source = JSON.parse(readFileSync('public/models/manifest.json'));
assert.equal(manifest.version, 1);
assert.equal(manifest.sourceSha256, source.sha256);
assert.equal(manifest.meta.levels.length, 25);
assert.equal(manifest.filename, source.sourceName);
assert.equal(manifest.meta.unitFactor, 1);
const digest = data => createHash('sha256').update(data).digest('hex');
const geometryHash = createHash('sha256'), partsHash = createHash('sha256');
const geometry = new Map(), elements = new Set(manifest.meta.elements.map(e => e.id));
let parts = 0, geometryBytes = 0, triangles = 0;
const bounds = new T.Box3(), matrix = new T.Matrix4();

// This exercises the JS gzip path even on hosts where DecompressionStream is
// absent, rather than assuming the API available in current desktop Chromium.
const nativeDecompressor = globalThis.DecompressionStream;
try {
  globalThis.DecompressionStream = undefined;
  for (const chunk of manifest.chunks) {
    const compressed = readFileSync(base + chunk.file);
    assert.equal(compressed.length, chunk.bytes);
    assert.equal(digest(compressed), chunk.sha256);
    const bytes = unpackGzip(compressed);
    assert.equal(bytes.length, chunk.rawBytes);
    assert.equal(unpackGzip(bytes), bytes, 'Already decoded HTTP responses are not inflated twice');
    const decoded = decodeSceneChunk(bytes);
    for (const d of decoded.definitions) {
      assert.ok(!geometry.has(d.key), 'A shared IFC geometry must only occur once');
      assert.equal(d.vertices.length % 6, 0); assert.equal(d.indices.length % 3, 0);
      assert.ok(d.indices.length > 0);
      const sizes = Buffer.alloc(12);
      sizes.writeUInt32LE(d.key, 0); sizes.writeUInt32LE(d.vertices.length, 4); sizes.writeUInt32LE(d.indices.length, 8);
      geometryHash.update(sizes);
      for (const array of [d.vertices, d.indices]) geometryHash.update(Buffer.from(array.buffer, array.byteOffset, array.byteLength));
      const box = new T.Box3();
      for (let i = 0; i < d.vertices.length; i += 6) {
        for (let n = 0; n < 6; n++) assert.ok(Number.isFinite(d.vertices[i + n]));
        box.expandByPoint(new T.Vector3(d.vertices[i], d.vertices[i + 1], d.vertices[i + 2]));
      }
      for (const index of d.indices) assert.ok(index < d.vertices.length / 6, 'Faces must refer to an existing vertex');
      geometry.set(d.key, { box, triangles: d.indices.length / 3 });
      geometryBytes += d.vertices.byteLength + d.indices.byteLength;
    }
    for (const part of decoded.parts) {
      assert.ok(elements.has(part.id)); assert.ok(geometry.has(part.key), 'An instance must follow its geometry definition');
      assert.equal(part.matrix.length, 16); assert.ok(part.matrix.every(Number.isFinite));
      assert.equal(part.color.length, 4); assert.ok(part.color.every(Number.isFinite));
      const entry = geometry.get(part.key);
      bounds.union(entry.box.clone().applyMatrix4(matrix.fromArray(part.matrix)));
      triangles += entry.triangles; parts++; partsHash.update(JSON.stringify(part));
    }
    assert.throws(() => decodeSceneChunk(bytes.subarray(0, bytes.length - 1)), 'Truncated geometry cannot be accepted');
  }
} finally { globalThis.DecompressionStream = nativeDecompressor; }
// The exporter hashes the original typed arrays before writing the binary
// format. These comparisons detect altered coordinates, normals, topology,
// expressIDs and transforms in the decoder or serializer.
assert.equal(geometryHash.digest('hex'), manifest.geometrySha256);
assert.equal(partsHash.digest('hex'), manifest.partsSha256);
assert.equal(parts, manifest.audit.parts);
assert.equal(parts, manifest.counts.parts);
assert.equal(geometry.size, manifest.counts.geometries);
assert.equal(geometryBytes, manifest.counts.geometryBytes);
assert.equal(triangles, 7971644, 'The prepared hotel retains the original triangle count');
assert.ok(!bounds.isEmpty());
assert.ok(bounds.max.y - bounds.min.y > 24, 'All hotel storeys retain their original scale');

const propertyIDs = new Set();
let geometryReferences = 0, maxPropertyRaw = 0;
const inspectReferences = value => {
  if (!value || typeof value !== 'object') return;
  if (value.referenciaGeometrica) {
    geometryReferences++; assert.equal(value.expressID, value.value); assert.ok(Number.isInteger(value.type));
    return;
  }
  for (const [key, child] of Object.entries(value)) {
    if (['RepresentationMaps', 'Representation', 'ObjectPlacement'].includes(key) && child != null) {
      for (const ref of Array.isArray(child) ? child : [child]) assert.equal(ref.referenciaGeometrica, true);
    }
    inspectReferences(child);
  }
};
for (const group of manifest.propertyBuckets) {
  const compressed = readFileSync(base + group.file);
  assert.equal(compressed.length, group.bytes); assert.equal(digest(compressed), group.sha256);
  const bytes = unpackGzip(compressed); maxPropertyRaw = Math.max(maxPropertyRaw, bytes.length);
  const properties = JSON.parse(new TextDecoder().decode(bytes));
  assert.equal(Object.keys(properties).length, group.count);
  for (const [id, data] of Object.entries(properties)) {
    assert.ok(!propertyIDs.has(Number(id))); propertyIDs.add(Number(id));
    assert.ok(elements.has(Number(id))); assert.equal(data.id, Number(id));
    assert.equal(Math.floor(data.id / 1000), group.bucket);
    assert.equal(data.properties.expressID, data.id);
    for (const kind of ['psets', 'materials', 'type']) assert.ok(Array.isArray(data[kind]));
    inspectReferences(data);
  }
}
assert.equal(propertyIDs.size, manifest.counts.properties);
assert.deepEqual(propertyIDs, elements, 'Every selectable BIM element retains declared properties');
assert.ok(geometryReferences > 0);
assert.ok(maxPropertyRaw < 1e6, 'BIM lookup must not expand tessellations into huge JSON documents');
assert.throws(() => decodeSceneChunk(new Uint8Array([255, 255, 255, 255])));
console.log(JSON.stringify({ pass: true, chunks: manifest.chunks.length, geometries: geometry.size, parts, triangles, geometryBytes, properties: propertyIDs.size, geometryReferences, maxPropertyRaw, bounds: [...bounds.min.toArray(), ...bounds.max.toArray()], checks: ['source-provenance', 'gzip-without-native-api', 'original-array-fingerprints', 'shared-geometries', 'original-transforms-scale', 'property-coverage', 'semantic-geometric-references', 'truncated-data'] }));
