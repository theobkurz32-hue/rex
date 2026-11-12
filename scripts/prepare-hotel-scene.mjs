// Build-only extraction: Safari loads these original IFC arrays without keeping
// the 220 MB STEP source and the IFC parser's WASM heap in its web process.
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { createReadStream, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createGunzip, gzipSync, gunzipSync } from 'node:zlib';
import { build } from 'vite';

const require = createRequire(import.meta.url);
const project = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const sourceManifest = JSON.parse(readFileSync(join(project, 'public/models/manifest.json'), 'utf8'));
const sourcePath = join(project, 'public/models', sourceManifest.file);
const target = join(project, 'public/models/scene');
const temporary = target + '.building-' + process.pid;
const parserVersion = JSON.parse(readFileSync(join(dirname(require.resolve('web-ifc')), 'package.json'), 'utf8')).version;
const parserSettings = { COORDINATE_TO_ORIGIN: true, CIRCLE_SEGMENTS: 24, MEMORY_LIMIT: 2147483648 };
const sha256 = data => createHash('sha256').update(data).digest('hex');
const generatorHash = sha256(Buffer.concat([
  readFileSync(new URL(import.meta.url)), readFileSync(join(project, 'src/ifc.worker.ts')),
]));
const propertiesBase = 'properties/' + generatorHash.slice(0, 16) + '/';
const report = message => console.info('Hotel estático: ' + message);

// Always validate provenance, including when a prior build can be reused.
const sourceHash = createHash('sha256');
let sourceBytes = 0;
for await (const data of createReadStream(sourcePath).pipe(createGunzip())) {
  sourceHash.update(data); sourceBytes += data.length;
}
const sourceSha256 = sourceHash.digest('hex');
if (sourceSha256 !== sourceManifest.sha256 || sourceBytes !== sourceManifest.originalBytes) {
  throw new Error('O IFC original não corresponde ao manifesto de origem; cache não gerado.');
}
function reusable() {
  try {
    const saved = JSON.parse(readFileSync(join(target, 'manifest.json'), 'utf8'));
    if (saved.version !== 1 || saved.sourceSha256 !== sourceSha256 || saved.parserVersion !== parserVersion || saved.generatorHash !== generatorHash) return false;
    if (JSON.stringify(saved.parserSettings) !== JSON.stringify(parserSettings) || !saved.chunks?.length || !saved.propertyBuckets?.length) return false;
    for (const entry of [...saved.chunks, ...saved.propertyBuckets]) {
      if (entry.file.includes('..') || entry.file.startsWith('/')) return false;
      const bytes = readFileSync(join(target, entry.file));
      if (bytes.length !== entry.bytes || sha256(bytes) !== entry.sha256) return false;
    }
    return saved;
  } catch { return false; }
}
const prior = reusable();
if (prior) {
  report(`cache validado e reutilizado (${prior.chunks.length} blocos; ${prior.propertyBuckets.length} grupos BIM).`);
  process.exit(0);
}

const started = performance.now();
rmSync(temporary, { recursive: true, force: true });
mkdirSync(join(temporary, propertiesBase), { recursive: true });
const chunks = [], propertyBuckets = [];
const known = new Set();
const geometryHash = createHash('sha256'), partsHash = createHash('sha256');
let meta, audit, failure, pendingProperty;
let parts = [], definitions = [], binaryBytes = 0, partBytes = 0, geometryBytes = 0, partCount = 0;
const chunkLimit = 4 * 1024 * 1024;
function writeCompressed(file, raw, extra = {}) {
  const compressed = gzipSync(raw, { level: 9 });
  const digest = sha256(compressed);
  if (file.endsWith('.bin.gz')) file = file.replace('.bin.gz', '-' + digest.slice(0, 16) + '.bin.gz');
  writeFileSync(join(temporary, file), compressed);
  return { file, bytes: compressed.length, rawBytes: raw.length, sha256: digest, ...extra };
}
function flush() {
  if (!parts.length && !definitions.length) return;
  const header = Buffer.from(JSON.stringify({
    parts, definitions: definitions.map(d => ({ key: d.key, vertexLength: d.vertices.length, indexLength: d.indices.length })),
  }));
  const offset = (4 + header.length + 3) & ~3;
  const raw = Buffer.alloc(offset + binaryBytes);
  raw.writeUInt32LE(header.length, 0); header.copy(raw, 4);
  let cursor = offset;
  for (const d of definitions) {
    for (const array of [d.vertices, d.indices]) {
      Buffer.from(array.buffer, array.byteOffset, array.byteLength).copy(raw, cursor);
      cursor += array.byteLength;
    }
  }
  chunks.push(writeCompressed(`chunk-${String(chunks.length).padStart(3, '0')}.bin.gz`, raw));
  parts = []; definitions = []; binaryBytes = 0; partBytes = 0;
}
const scope = {
  close() {},
  postMessage(data) {
    if (data.kind === 'error') { failure = new Error(data.message); return; }
    if (data.kind === 'metadata') { meta = data.meta; report(`${meta.elements.length} elementos BIM, ${meta.levels.length} níveis.`); }
    if (data.kind === 'complete') { audit = data.audit; flush(); }
    if (data.kind === 'properties') { pendingProperty = data; }
    if (data.kind !== 'geometry') return;
    for (const definition of data.definitions) {
      if (known.has(definition.key)) throw new Error(`Geometria duplicada: ${definition.key}`);
      known.add(definition.key);
      const sizes = Buffer.alloc(12);
      sizes.writeUInt32LE(definition.key, 0); sizes.writeUInt32LE(definition.vertices.length, 4); sizes.writeUInt32LE(definition.indices.length, 8);
      geometryHash.update(sizes);
      for (const array of [definition.vertices, definition.indices]) geometryHash.update(Buffer.from(array.buffer, array.byteOffset, array.byteLength));
      const bytes = definition.vertices.byteLength + definition.indices.byteLength;
      if (binaryBytes + partBytes + bytes > chunkLimit) flush();
      definitions.push(definition); binaryBytes += bytes; geometryBytes += bytes;
    }
    parts.push(...data.parts); partCount += data.parts.length;
    for (const part of data.parts) partsHash.update(JSON.stringify(part));
    partBytes += Buffer.byteLength(JSON.stringify(data.parts));
    if (binaryBytes + partBytes >= chunkLimit) flush();
  },
};
const previousSelf = globalThis.self;
const consoleMethods = { log: console.log, error: console.error };
try {
  // The very same importer supplies metadata, door operations, transforms,
  // triangulation diagnostics and property payloads for both loading paths.
  const runtime = join(project, '.test-runtime/hotel-scene-export');
  await build({ configFile: false, logLevel: 'error', build: {
    outDir: runtime, emptyOutDir: true,
    lib: { entry: { worker: join(project, 'src/ifc.worker.ts') }, formats: ['es'] },
    rolldownOptions: { external: ['three', 'web-ifc'] },
  } });
  globalThis.self = scope;
  await import(new URL('../.test-runtime/hotel-scene-export/worker.js', import.meta.url));
  const data = gunzipSync(readFileSync(sourcePath));
  // Node's wasm filename differs from the browser filename; Init resolves it
  // from the package directory while preserving the importer's single thread.
  await scope.onmessage({ data: { kind: 'load', buffer: data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength), wasm: dirname(require.resolve('web-ifc')) + '/' } });
  if (failure) throw failure;
  if (!meta || !audit || !chunks.length) throw new Error('Importação terminou sem metadados, auditoria ou geometria.');
  if (partCount !== audit.parts) throw new Error('Partes geométricas incompletas no cache.');
  report(`${known.size} geometrias únicas, ${partCount} partes; exportando propriedades declaradas…`);

  let bucket = -1, properties = {}, propertyCount = 0;
  const flushProperties = () => {
    if (bucket < 0) return;
    propertyBuckets.push(writeCompressed(`${propertiesBase}${bucket}.json.gz`, Buffer.from(JSON.stringify(properties)), { bucket, count: Object.keys(properties).length }));
    properties = {};
  };
  const ids = [...new Set(meta.elements.map(e => e.id))].sort((a, b) => a - b);
  for (const id of ids) {
    const nextBucket = Math.floor(id / 1000);
    if (nextBucket !== bucket) { flushProperties(); bucket = nextBucket; }
    pendingProperty = null;
    await scope.onmessage({ data: { kind: 'properties', id } });
    if (failure) throw failure;
    if (!pendingProperty || pendingProperty.id !== id) throw new Error(`Propriedades ausentes para #${id}.`);
    const { kind, ...payload } = pendingProperty;
    properties[id] = payload;
    if (++propertyCount % 1000 === 0) report(`${propertyCount} propriedades exportadas.`);
  }
  flushProperties();
  await scope.onmessage({ data: { kind: 'dispose' } });
  const manifest = {
    version: 1, sourceSha256, parserVersion, generatorHash, parserSettings,
    filename: sourceManifest.sourceName, meta, audit, chunks, propertiesBase, propertyBuckets,
    counts: { geometries: known.size, geometryBytes, parts: partCount, properties: propertyCount },
    geometrySha256: geometryHash.digest('hex'), partsSha256: partsHash.digest('hex'),
  };
  writeFileSync(join(temporary, 'manifest.json'), JSON.stringify(manifest));
  rmSync(target, { recursive: true, force: true }); renameSync(temporary, target);
  const compressed = chunks.reduce((n, c) => n + c.bytes, 0);
  const bim = propertyBuckets.reduce((n, c) => n + c.bytes, 0);
  report(`gerado em ${((performance.now() - started) / 1000).toFixed(1)} s: ${chunks.length} blocos, ${(compressed / 1e6).toFixed(2)} MB comprimidos de geometria/partes; ${(bim / 1e6).toFixed(2)} MB de propriedades em ${propertyBuckets.length} grupos sob demanda.`);
} catch (error) {
  rmSync(temporary, { recursive: true, force: true });
  throw error;
} finally {
  globalThis.self = previousSelf;
  Object.assign(console, consoleMethods);
}
