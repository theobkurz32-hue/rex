import {build} from 'vite';
import * as T from 'three';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';

await build({configFile:false,logLevel:'error',build:{outDir:'.test-runtime/quality',lib:{entry:{quality:'src/quality.ts',model:'src/model.ts',cache:'src/scene-cache.ts'},formats:['es']},rolldownOptions:{external:['three','three-mesh-bvh','fflate']}}});
const {Quality}=await import('../.test-runtime/quality/quality.js');
const {BimModel}=await import('../.test-runtime/quality/model.js');
const {decodeSceneChunk,unpackGzip}=await import('../.test-runtime/quality/cache.js');
const modes=['auto','low','medium','high'];
const mobile=new Quality(true,3);
for(const [width,height] of [[320,568],[390,844],[844,390],[768,1024],[1536,2048]]){
  mobile.setViewport(width,height);
  for(let i=0;i<120;i++){
    mobile.set(modes[i%4]);
    assert.equal(mobile.shadows,false);
    assert.equal(mobile.reducedGeometry,true);
    assert.ok(mobile.lightQuality<1,'Mobile must not allocate the nearby point-light pass');
    assert.ok(mobile.ratio<=1&&mobile.ratio>0);
    assert.ok(width*height*mobile.ratio**2<=mobile.pixelBudget+.01,'Drawing buffer must stay within the mobile budget');
  }
}
mobile.setViewport(390,844);mobile.set('auto');
for(let i=0;i<200;i++)mobile.sample(.1,true);
assert.ok(mobile.ratio>=.6&&mobile.ratio<=.7);
for(let i=0;i<4000;i++)mobile.sample(1/120,true);
assert.ok(mobile.ratio<=1&&mobile.ratio>=.6);
for(const dt of [NaN,Infinity,-1,0])mobile.sample(dt,true);
assert.ok(Number.isFinite(mobile.ratio));
mobile.setViewport(NaN,Infinity);mobile.set('invalid');
assert.equal(mobile.mode,'auto');assert.ok(Number.isFinite(mobile.ratio));
const desktop=new Quality(false,2);desktop.setViewport(3840,2160);desktop.set('high');
assert.equal(desktop.shadows,true);assert.equal(desktop.reducedGeometry,false);
assert.ok(3840*2160*desktop.ratio**2<=desktop.pixelBudget+.01);

// Build the actual hotel on the mobile path. Its original arrays stay available
// for BIM/measurement while only the chosen render geometry reserves GPU memory.
const manifest=JSON.parse(readFileSync('public/models/scene/manifest.json'));
const model=new BimModel();model.setMobileSafe(true);model.setMeta(manifest.meta);
for(const chunk of manifest.chunks){const decoded=decodeSceneChunk(unpackGzip(readFileSync('public/models/scene/'+chunk.file)));model.add(decoded.definitions,decoded.parts);}
const sourceHash=()=>{
  const h=createHash('sha256');
  for(const geometry of model.geometry.values()){
    const a=geometry.getAttribute('position').data.array,i=geometry.index.array;
    h.update(new Uint8Array(a.buffer,a.byteOffset,a.byteLength));h.update(new Uint8Array(i.buffer,i.byteOffset,i.byteLength));
  }
  return h.digest('hex');
};
const before=sourceHash();await model.prepareRenderDetail();await model.finalize(()=>{});
assert.equal(model.usesMobileBuffers,true);
assert.ok(model.allocationStats.allocatedVertices<model.allocationStats.sourceVertices);
assert.ok(model.allocationStats.allocatedIndices<model.allocationStats.sourceIndices*.9);
let copies=0;
for(const batch of model.batches){
  const original=batch.mesh.setGeometryAt.bind(batch.mesh);
  batch.mesh.setGeometryAt=(...args)=>{copies++;return original(...args);};
}
const allocations=JSON.stringify(model.allocationStats);
for(let i=0;i<160;i++){mobile.set(modes[i%4]);model.setRenderDetail(mobile.reducedGeometry);model.setRenderDetail(false);}
assert.equal(copies,0,'Changing quality or diagnostics must not copy/reallocate mobile geometries');
assert.equal(model.lowDetail,true);assert.equal(JSON.stringify(model.allocationStats),allocations);
assert.equal(sourceHash(),before,'Mobile quality changes cannot alter the IFC source');
assert.equal(model.setMobileSafe(false),true,'An existing mobile scene keeps its fixed buffer plan');

// A continuously animated part can extend culling bounds without scanning the
// whole building or rebuilding selection meshes on every wind/elevator tick.
const part=model.parts.find(p=>model.visible.has(p.id)),batch=model.batches.find(b=>b.parts.includes(part));
model.select(part.id);const selected=[...model.selection.children];
let globalBoundsScans=0;
batch.mesh.computeBoundingBox=()=>{globalBoundsScans++;throw Error('Unexpected full bounds scan');};
batch.mesh.computeBoundingSphere=()=>{globalBoundsScans++;throw Error('Unexpected full bounds scan');};
const sourceMatrix=new T.Matrix4().fromArray(part.matrix);
for(let i=0;i<40;i++){
  const matrix=new T.Matrix4().makeTranslation(Math.sin(i)*2,i*.15,Math.cos(i)*2).multiply(sourceMatrix);
  model.setPartMatrix(part,matrix);model.finishMovingParts(new Set([part.id]));
  const bounds=model.geometry.get(part.key).boundingBox.clone().applyMatrix4(matrix);
  for(let corner=0;corner<8;corner++){
    const point=new T.Vector3(corner&1?bounds.max.x:bounds.min.x,corner&2?bounds.max.y:bounds.min.y,corner&4?bounds.max.z:bounds.min.z);
    assert.ok(batch.mesh.boundingSphere.containsPoint(point));
  }
}
assert.equal(globalBoundsScans,0);assert.deepEqual(model.selection.children,selected);
for(const mesh of model.selection.children){assert.equal(mesh.matrixAutoUpdate,false);assert.deepEqual(mesh.matrix.elements,mesh.userData.part.matrix);}
const report={pass:true,mobilePixelBudget:mobile.pixelBudget,allocation:model.allocationStats,renderCopiesOnQualityChange:copies,globalBoundsScansOnAnimation:globalBoundsScans,checks:['portrait-landscape-pixel-budget','no-mobile-shadows','adaptive-resolution-bounds','mobile-fixed-reduced-buffers','original-IFC-preserved','quality-toggle-stress','animated-culling-bounds','selection-reuse']};
model.dispose();console.log(JSON.stringify(report));
