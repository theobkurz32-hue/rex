import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {build} from 'vite';
import * as T from 'three';
await build({configFile:false,logLevel:'error',build:{outDir:'.test-runtime/water',lib:{entry:{water:'src/water.ts',model:'src/model.ts',physics:'src/physics.ts',doors:'src/doors.ts',cache:'src/scene-cache.ts'},formats:['es']},rolldownOptions:{external:['three','three-mesh-bvh','@dimforge/rapier3d-compat','fflate']}}});
const {WaterFixtures}=await import('../.test-runtime/water/water.js'),{BimModel}=await import('../.test-runtime/water/model.js'),{Physics}=await import('../.test-runtime/water/physics.js'),{Doors}=await import('../.test-runtime/water/doors.js'),{decodeSceneChunk,unpackGzip}=await import('../.test-runtime/water/cache.js');
const base='public/models/scene/',manifest=JSON.parse(readFileSync(base+'manifest.json')),hotel=new BimModel();hotel.setMeta(manifest.meta);
for(const chunk of manifest.chunks){const {definitions,parts}=decodeSceneChunk(unpackGzip(readFileSync(base+chunk.file)));hotel.add(definitions,parts);}
const originalMatrices=createHash('sha256').update(JSON.stringify(hotel.parts.map(p=>p.matrix))).digest('hex'),hotelDoors=new Doors(),hotelWater=new WaterFixtures();hotelWater.prepare(hotel,hotelDoors);
const real=hotelWater.snapshot;
assert.equal(real.faucets,32);assert.equal(real.showers,41);assert.equal(real.boxes,24);assert.deepEqual(real.unsupportedBoxes,[]);
assert.equal(createHash('sha256').update(JSON.stringify(hotel.parts.map(p=>p.matrix))).digest('hex'),originalMatrices,'Prepare must preserve the exported pose before interactions');
for(const f of real.fixtures){assert.ok(f.outlet.every(Number.isFinite));const bounds=hotel.elementBounds(f.id);assert.ok(bounds.clone().expandByScalar(.03).containsPoint(new T.Vector3(...f.outlet)),`Outlet ${f.id} must be on the actual fixture`);}
for(const id of [2983241,2983257])assert.ok(real.fixtures.find(f=>f.id===id).outlet[1]>16.7,'Upright tap emits from the upper spout, not its base');
assert.ok(real.fixtures.find(f=>f.id===3468042).outlet[1]>4.2,'Multipart mixer emits from its actual aerator');
for(const box of real.boxStates){const d=hotelDoors.items.get(box.id),parts=hotel.byElement.get(box.id);assert.equal(d.progress,1);assert.ok(d.leaves[0].slide.length()>.2);assert.ok(d.leaves[0].parts.length<parts.length,'Fixed track and fixed glass stay static');assert.ok(d.leaves[0].parts.some(p=>p.color[3]<.65));}
console.log('REAL IFC WATER',JSON.stringify({faucets:real.faucets,showers:real.showers,boxes:real.boxes,unsupported:real.unsupportedBoxes}));hotelWater.dispose();hotel.dispose();

const model=new BimModel(),definitions=[],parts=[],elements=[];let key=1;
function add(id,type,name,geometry,position,rotation=0,color=[.8,.8,.8,1]){
 const p=geometry.getAttribute('position'),n=geometry.getAttribute('normal'),vertices=new Float32Array(p.count*6);for(let i=0;i<p.count;i++)vertices.set([p.getX(i),p.getY(i),p.getZ(i),n.getX(i),n.getY(i),n.getZ(i)],i*6);
 const matrix=new T.Matrix4().makeRotationY(rotation);matrix.setPosition(...position);definitions.push({key,vertices,indices:new Uint32Array(geometry.getIndex().array)});parts.push({id,key:key++,matrix:matrix.toArray(),color});if(!elements.some(e=>e.id===id))elements.push({id,type,name,guid:String(id),storey:1});geometry.dispose();
}
add(1,'IfcSlab','Floor',new T.BoxGeometry(14,.2,14),[0,-.1,0]);
add(2,'IfcBuildingElementProxy','Cuba de apoio',new T.BoxGeometry(.5,.04,.4),[0,.8,0]);
add(10,'IfcFlowTerminal','Torneira de parede',new T.BoxGeometry(.12,.04,.24),[0,1,-.05]);
add(10,'IfcFlowTerminal','Torneira de parede',new T.BoxGeometry(.015,.015,.02),[0,1,-.18]);
add(20,'IfcFlowTerminal','Chuveiro de Parede',new T.BoxGeometry(.03,.03,.3),[2,2.15,-.1]);
add(20,'IfcFlowTerminal','Chuveiro de Parede',new T.CylinderGeometry(.06,.06,.01,16),[2,2.1,.025]);
add(21,'IfcWall','Parede do chuveiro',new T.BoxGeometry(2,3,.1),[2,1.5,-.3]);
// Original Roldana pose: moving pane overlaps fixed glass, leaving entry open.
add(30,'IfcFurnishingElement','Blocks_Box Reto com Roldana Interna',new T.BoxGeometry(.568,2,.008),[-2.28,1.15,0],0,[.9,.95,.95,.15]);
add(30,'IfcFurnishingElement','Blocks_Box Reto com Roldana Interna',new T.BoxGeometry(.478,2,.008),[-2.235,1.15,.018],0,[.9,.95,.95,.15]);
add(30,'IfcFurnishingElement','Blocks_Box Reto com Roldana Interna',new T.BoxGeometry(1,.025,.03),[-2.5,2.16,0]);
add(30,'IfcFurnishingElement','Blocks_Box Reto com Roldana Interna',new T.BoxGeometry(.025,2,.025),[-3,1.15,0]);
add(30,'IfcFurnishingElement','Blocks_Box Reto com Roldana Interna',new T.BoxGeometry(.03,.13,.03),[-2.5,1.15,-.02]);
for(let i=0;i<5;i++)add(100+i,'IfcFlowTerminal',`Torneira ${i}`,new T.BoxGeometry(.04,.04,.2),[i*.4-1,1,2]);
model.setMeta({schema:'IFC4',unit:'METRE',unitFactor:1,levels:[{id:1,name:'Teste',elevation:0,worldY:0}],elements,counts:{},spatial:{},header:{}});model.add(definitions,parts);
const water=new WaterFixtures(),doors=new Doors();water.prepare(model,doors);await model.finalize(()=>{});const physics=new Physics();await physics.init(model,()=>{},doors,{lightweightFurniture:true});water.bind(physics);
const camera=new T.PerspectiveCamera(70,1,.035,100);camera.position.set(0,1.65,1);camera.lookAt(0,1,-.05);camera.updateMatrixWorld(true);
assert.ok(water.target(camera)?.key==='water:10');assert.ok(water.interact('water:10'));water.update(.016,camera,true);assert.equal(water.snapshot.visibleFlows,1);
const tap=water.snapshot.fixtures.find(f=>f.id===10);assert.ok(Math.abs(tap.impact[1]-.82)<.025,'Faucet water terminates on the basin surface');assert.ok(tap.outlet[2]>-.08,'Faucet nozzle is at the end away from wall mount');
let positions=water.root.children.find(c=>c.visible)?.children.find(c=>c.isPoints)?.geometry.getAttribute('position').array;
assert.ok(positions);const paused=Array.from(positions);water.update(.1,camera,false);assert.deepEqual(Array.from(positions),paused,'Pause freezes flowing drops');
for(let i=0;i<5;i++)water.interact(`water:${100+i}`);water.update(.2,camera,true);assert.equal(water.snapshot.visibleFlows,4,'Effects use a bounded four-source pool');
for(const group of water.root.children.filter(c=>c.visible)){const points=group.children.find(c=>c.isPoints);if(!points)continue;const a=points.geometry.getAttribute('position').array;for(let i=1;i<a.length;i+=3)assert.ok(a[i]<=0&&a[i]>-3.5);}
// A structural wall between viewer and fixture must suppress contextual action.
camera.position.set(2,1.65,-1);camera.lookAt(water.snapshot.fixtures.find(f=>f.id===20).point[0],water.snapshot.fixtures.find(f=>f.id===20).point[1],water.snapshot.fixtures.find(f=>f.id===20).point[2]);camera.updateMatrixWorld(true);assert.equal(water.target(camera),null,'Cannot operate water through wall');
const shower=water.snapshot.fixtures.find(f=>f.id===20);assert.ok(shower.point[1]>1&&shower.point[1]<1.3,'Shower register is at reachable height, not the high head');
const box=doors.items.get(30);assert.ok(box);assert.equal(box.progress,1);const fixed=parts.filter(p=>p.id===30&&!doors.moving.has(p)).map(p=>[p,[...p.matrix]]),moving=box.leaves[0].parts[0],initial=[...moving.matrix];
// Closing is a real physical move. The fixed frame remains unchanged.
box.target=0;for(let i=0;i<40;i++)doors.update(model,physics,1/60,()=>{});assert.equal(box.progress,0);assert.notDeepEqual(moving.matrix,initial);for(const [p,original]of fixed)assert.deepEqual(p.matrix,original);
box.target=1;for(let i=0;i<40;i++)doors.update(model,physics,1/60,()=>{});assert.equal(box.progress,1);for(let i=0;i<16;i++)assert.ok(Math.abs(moving.matrix[i]-initial[i])<1e-6);
// Toggle off, hide distant effects and free the shared resources.
water.interact('water:10');assert.equal(water.snapshot.fixtures.find(f=>f.id===10).on,false);camera.position.set(100,10,100);water.update(.2,camera,true);assert.equal(water.snapshot.visibleFlows,0);water.dispose();assert.equal(water.root.children.length,0);physics.dispose();model.dispose();
console.log(JSON.stringify({pass:true,checks:['real-fixture-mapping','actual-outlet-positions','tap-water-on-off','basin-termination','four-source-budget','paused-effects','no-through-wall-action','reachable-shower-register','original-box-glass','moving-collider-roundtrip','fixed-frames','distant-culling','resource-disposal']}));
