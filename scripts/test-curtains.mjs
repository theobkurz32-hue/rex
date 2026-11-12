import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {build} from 'vite';
import * as T from 'three';
await build({configFile:false,logLevel:'error',build:{outDir:'.test-runtime/curtains',emptyOutDir:true,lib:{entry:{curtains:'src/curtains.ts',model:'src/model.ts',doors:'src/doors.ts',physics:'src/physics.ts',cache:'src/scene-cache.ts'},formats:['es']},rolldownOptions:{external:['three','three-mesh-bvh','@dimforge/rapier3d-compat','fflate']}}});
const {Curtains}=await import('../.test-runtime/curtains/curtains.js'),{BimModel}=await import('../.test-runtime/curtains/model.js'),{Doors}=await import('../.test-runtime/curtains/doors.js'),{Physics}=await import('../.test-runtime/curtains/physics.js'),{decodeSceneChunk,unpackGzip}=await import('../.test-runtime/curtains/cache.js');
const definitions=[],parts=[],elements=[];let nextKey=1;
function part(id,size,center,color=[.88,.88,.88,.59]){
  const geometry=new T.BoxGeometry(...size),position=geometry.getAttribute('position'),normal=geometry.getAttribute('normal'),vertices=new Float32Array(position.count*6);
  for(let i=0;i<position.count;i++)vertices.set([position.getX(i),position.getY(i),position.getZ(i),normal.getX(i),normal.getY(i),normal.getZ(i)],i*6);
  const matrix=new T.Matrix4().makeBasis(new T.Vector3(1,0,0),new T.Vector3(0,0,-1),new T.Vector3(0,1,0));matrix.setPosition(...center);
  const entry={id,key:nextKey++,matrix:matrix.toArray(),color};definitions.push({key:entry.key,vertices,indices:new Uint32Array(geometry.index.array)});parts.push(entry);geometry.dispose();return entry;
}
elements.push({id:1,type:'IfcSlab',name:'Piso',storey:null},{id:2,type:'IfcFurnishingElement',name:'Cortina de tecido',storey:null});
part(1,[8,8,.2],[0,-.1,0],[.5,.5,.5,1]);
const rail=part(2,[2.5,.04,.04],[0,2.56,0],[.7,.6,.5,1]);
const left=part(2,[1,.1,2.4],[-.55,1.3,0]),right=part(2,[1,.1,2.4],[.55,1.3,0]);
const ring=part(2,[.03,.03,.08],[-.1,2.54,0]);
const model=new BimModel();model.setMeta({elements,levels:[]});model.add(definitions,parts);const doors=new Doors(),curtains=new Curtains();
const originals=new Map(parts.map(p=>[p,[...p.matrix]])),sourceParts=parts.length;
curtains.prepare(model,doors);assert.equal(curtains.snapshot.count,1);assert.equal(curtains.snapshot.panels,2);assert.ok(doors.moving.has(left)&&doors.moving.has(right)&&doors.moving.has(ring));assert.ok(!doors.moving.has(rail));assert.equal(doors.items.size,0);assert.equal(model.parts.length,sourceParts);
await model.finalize(()=>{});const physics=new Physics();await physics.init(model,()=>{},doors,{lightweightFurniture:true});curtains.bind(physics);
assert.equal(physics.doorHit(new T.Vector3(-.55,1.3,1),new T.Vector3(0,0,-1),2),null,'No invisible old fabric barrier may remain');
assert.equal(physics.doorHit(new T.Vector3(0,2.56,1),new T.Vector3(0,0,-1),2),2,'The fixed rail remains a physical object');
const material=model.materials.find(m=>String(m.userData.finish).startsWith('curtain-cloth|'));assert.ok(material);
const shader={uniforms:{},vertexShader:'#include <common>\n#include <begin_vertex>',fragmentShader:''};material.onBeforeCompile(shader,null);assert.match(shader.vertexShader,/rexClothHem/);assert.match(shader.vertexShader,/rexCurtainBreeze/);assert.match(shader.vertexShader,/rexClothNear/);assert.equal(shader.uniforms.rexCurtainTime.value,0);
const camera=new T.PerspectiveCamera();camera.position.set(0,1.6,1);camera.lookAt(0,1.3,0);camera.updateMatrixWorld(true);
const target=curtains.target(camera);assert.equal(target?.key,'curtain:2');assert.match(target.label,/Abrir/);assert.ok(!curtains.interact('curtain:999'));assert.ok(curtains.interact(target.key));
const clothWidth=()=>model.geometry.get(left.key).boundingBox.clone().applyMatrix4(new T.Matrix4().fromArray(left.matrix)).getSize(new T.Vector3()).x;
const closedWidth=clothWidth();for(let i=0;i<60;i++)curtains.update(1/60,camera,true);
assert.equal(curtains.snapshot.items[0].progress,1);assert.ok(Math.abs(clothWidth()/closedWidth-.18)<1e-6,'Fabric gathers to 18% of its original width');assert.deepEqual(rail.matrix,originals.get(rail),'Opening never moves the rail');assert.equal(model.parts.length,sourceParts,'Opening animates original parts instead of adding duplicate fabric');
const wind=shader.uniforms.rexCurtainTime.value;curtains.update(.1,camera,false);assert.equal(shader.uniforms.rexCurtainTime.value,wind,'Pause stops wind');
curtains.interact('curtain:2');for(let i=0;i<60;i++)curtains.update(1/60,camera,true);for(const p of parts)for(let i=0;i<16;i++)assert.ok(Math.abs(p.matrix[i]-originals.get(p)[i])<1e-7,'Closing restores all original matrices');
curtains.dispose();assert.equal(doors.moving.size,0);physics.dispose();model.dispose();

const scene=JSON.parse(readFileSync('public/models/scene/manifest.json')),hotel=new BimModel();hotel.setMeta(scene.meta);
for(const chunk of scene.chunks){const data=decodeSceneChunk(unpackGzip(readFileSync('public/models/scene/'+chunk.file)));hotel.add(data.definitions,data.parts);}
const hash=()=>{const digest=createHash('sha256');for(const g of hotel.geometry.values()){for(const array of [g.getAttribute('position').data.array,g.index.array])digest.update(Buffer.from(array.buffer,array.byteOffset,array.byteLength));}return digest.digest('hex');};
const source=hash(),hotelDoors=new Doors(),hotelCurtains=new Curtains(),hotelParts=hotel.parts.length;
const curtainIDs=[...hotel.elements.values()].filter(e=>/cortina|curtain/i.test(e.name??'')&&hotel.byElement.has(e.id));
const matrixByPart=new Map(hotel.parts.map(p=>[p,[...p.matrix]]));hotelCurtains.prepare(hotel,hotelDoors);
assert.equal(curtainIDs.length,50);assert.equal(hotelCurtains.snapshot.count,50);assert.equal(hotelCurtains.snapshot.panels,85);assert.equal(hotel.parts.length,hotelParts);assert.equal(hash(),source,'Preparing curtains never changes source positions, normals or triangles');
await hotel.finalize(()=>{});const ids=hotelCurtains.snapshot.items.map(item=>item.id);for(const id of ids)assert.ok(hotelCurtains.interact('curtain:'+id));
for(let i=0;i<10;i++)hotelCurtains.update(.1,camera,true);
assert.ok(hotelCurtains.snapshot.items.every(item=>item.progress===1));
let moving=0,fixed=0;
for(const e of curtainIDs)for(const p of hotel.byElement.get(e.id)){
  if(hotelDoors.moving.has(p)){moving++;assert.notDeepEqual(p.matrix,matrixByPart.get(p));}
  else{fixed++;assert.deepEqual(p.matrix,matrixByPart.get(p));}
}
assert.ok(fixed>=50*2,'Every real curtain retains its rail and end caps');assert.ok(moving>85);
for(const id of ids)hotelCurtains.interact('curtain:'+id);for(let i=0;i<10;i++)hotelCurtains.update(.1,camera,true);
for(const e of curtainIDs)for(const p of hotel.byElement.get(e.id))for(let i=0;i<16;i++)assert.ok(Math.abs(p.matrix[i]-matrixByPart.get(p)[i])<1e-7);
assert.equal(hash(),source);console.log(JSON.stringify({pass:true,declaredCurtains:52,curtains:50,panels:85,movingParts:moving,fixedHardware:fixed,checks:['original-source-arrays','no-duplicate-fabric','all-real-curtains-open-close','rail-endcaps-fixed','gather-within-rail','soft-fabric-no-ghost-collider','GPU-wind-hems-and-distance','pause-freezes-wind']}));hotelCurtains.dispose();hotel.dispose();
