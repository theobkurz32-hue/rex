import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {build} from 'vite';
import * as T from 'three';

await build({configFile:false,logLevel:'error',build:{outDir:'.test-runtime/elevator',emptyOutDir:true,lib:{entry:{elevator:'src/elevator.ts',model:'src/model.ts',physics:'src/physics.ts',doors:'src/doors.ts',cache:'src/scene-cache.ts'},formats:['es']},rolldownOptions:{external:['three','three-mesh-bvh','@dimforge/rapier3d-compat','fflate']}}});
const {Elevator}=await import('../.test-runtime/elevator/elevator.js');
const {BimModel}=await import('../.test-runtime/elevator/model.js');
const {Physics,CHARACTER}=await import('../.test-runtime/elevator/physics.js');CHARACTER.radius=.20;
const {Doors}=await import('../.test-runtime/elevator/doors.js');
const {decodeSceneChunk,unpackGzip}=await import('../.test-runtime/elevator/cache.js');

const model=new BimModel(),definitions=[],parts=[],elements=[],levels=[{id:1,name:'Térreo',worldY:0,elevation:0},{id:2,name:'Primeiro',worldY:3,elevation:3},{id:3,name:'Segundo',worldY:6,elevation:6}];
let nextKey=1;
function box(id,type,name,size,position,storey){
  if(!elements.some(e=>e.id===id))elements.push({id,type,name,storey,guid:String(id)});
  const geometry=new T.BoxGeometry(...size),p=geometry.getAttribute('position'),n=geometry.getAttribute('normal'),vertices=new Float32Array(p.count*6);
  for(let i=0;i<p.count;i++)vertices.set([p.getX(i),p.getY(i),p.getZ(i),n.getX(i),n.getY(i),n.getZ(i)],i*6);
  const key=nextKey++;definitions.push({key,vertices,indices:new Uint32Array(geometry.getIndex().array)});parts.push({id,key,matrix:new T.Matrix4().makeTranslation(...position).toArray(),color:[.85,.85,.85,1]});geometry.dispose();
}
for(const level of levels){
  const y=level.worldY,id=100+level.id;
  box(10+level.id,'IfcSlab','Piso contínuo com vão operacional',[10,.1,6],[0,y-.05,0],level.id);
  box(id,'IfcBuildingElementProxy',`Lift Assembly:8 Person:${level.id}`,[.39,2.01,.05],[-.195,y+1.005,-.075],level.id);
  box(id,'IfcBuildingElementProxy',`Lift Assembly:8 Person:${level.id}`,[.39,2.01,.05],[.195,y+1.005,-.075],level.id);
  box(id,'IfcBuildingElementProxy',`Lift Assembly:8 Person:${level.id}`,[.08,2.104,.219],[-.444,y+1.052,-.05],level.id);
  box(id,'IfcBuildingElementProxy',`Lift Assembly:8 Person:${level.id}`,[.08,2.104,.219],[.444,y+1.052,-.05],level.id);
  box(id,'IfcBuildingElementProxy',`Lift Assembly:8 Person:${level.id}`,[.968,.094,.219],[0,y+2.057,-.05],level.id);
  box(id,'IfcBuildingElementProxy',`Lift Assembly:8 Person:${level.id}`,[.15,.25,.006],[.59,y+1,.108],level.id);
}
model.setMeta({elements,levels,unitFactor:1,spatial:{},schema:'IFC4',unit:'METRE',counts:{},header:{}});model.add(definitions,parts);
const doors=new Doors();doors.prepare(model);const elevator=new Elevator();elevator.prepare(model,doors);
// Remaining physical acceptance assertions are appended once the implementation's
// observable contract is finalized. This fixture intentionally supplies continuous
// source slabs, so a valid lift has to cut a shaft instead of passing through them.
assert.equal(elevator.snapshot.available,true,'The three aligned landing assemblies must form an operational lift');
assert.equal(elevator.snapshot.stops.length,3);
assert.ok(elevator.snapshot.adaptation.cutParts>=3,'Continuous source slabs must be cut only within the shaft');
assert.ok(elevator.snapshot.adaptation.cutElements.every(id=>[11,12,13].includes(id)));
// A triangle crossing the shaft must be split, not discarded by its center.
// Integrate the retained top faces: only the rectangle inside the shaft is lost.
const cutBounds=elevator.snapshot.adaptation.shaftBounds,expectedTopArea=60-(cutBounds[3]-cutBounds[0])*(cutBounds[5]-cutBounds[2]);
for(const id of [11,12,13]){
  let area=0;
  for(const part of model.byElement.get(id)){
    const geometry=model.geometry.get(part.key),position=geometry.getAttribute('position'),normal=geometry.getAttribute('normal'),ix=geometry.getIndex(),matrix=new T.Matrix4().fromArray(part.matrix);
    for(let i=0;i<ix.count;i+=3){if(normal.getY(ix.getX(i))<.99)continue;const a=new T.Vector3().fromBufferAttribute(position,ix.getX(i)).applyMatrix4(matrix),b=new T.Vector3().fromBufferAttribute(position,ix.getX(i+1)).applyMatrix4(matrix),c=new T.Vector3().fromBufferAttribute(position,ix.getX(i+2)).applyMatrix4(matrix);area+=new T.Vector3().crossVectors(b.sub(a),c.sub(a)).length()/2;}
  }
  assert.ok(Math.abs(area-expectedTopArea)<1e-5,'Every original floor face outside the shaft remains intact');
}
// Original, shared IFC buffers remain untouched after the operational adaptation.
for(const d of definitions){const g=model.geometry.get(d.key);if(g){const a=g.getAttribute('position');for(let i=0;i<a.count;i++){assert.equal(a.getX(i),d.vertices[i*6]);assert.equal(a.getY(i),d.vertices[i*6+1]);assert.equal(a.getZ(i),d.vertices[i*6+2]);}}}
await model.finalize(()=>{});
const physics=new Physics();await physics.init(model,()=>{},doors);
const baseBodies=physics.world.bodies.len();elevator.bind(physics);
const stops=elevator.snapshot.stops,first=stops[0],last=stops[stops.length-1];
assert.equal(elevator.snapshot.current,first.id);
function tick(frames,paused=false){for(let i=0;i<frames;i++){if(!paused){if(physics.active)physics.step(0,0,false,false);else physics.world.step();}elevator.update(1/60,!paused);}}
function until(predicate,limit=1200){for(let i=0;i<limit;i++){tick(1);if(predicate())return i;}throw new Error('Elevator did not reach the requested state: '+JSON.stringify(elevator.snapshot));}
const shaft=elevator.snapshot.adaptation.shaftBounds;
assert.ok(Array.isArray(shaft)&&shaft.length===6);
const x=(shaft[0]+shaft[3])/2,doorZ=shaft[5];
assert.ok(physics.teleport(new T.Vector3(x,first.y+.03,doorZ+.8),first.storey));
for(let i=0;i<100;i++){elevator.update(1/60,true);physics.step(0,-1.4,false,false);}
assert.ok(physics.feet().z>doorZ+.15,'A closed landing door must stop the capsule before the shaft');
assert.equal(elevator.call(first.id),true);until(()=>elevator.snapshot.doorProgress>.999);
for(let i=0;i<70;i++){elevator.update(1/60,true);physics.step(0,-1.2,false,false);}
assert.ok(elevator.snapshot.inside,'The player must physically enter the cabin through the open landing');
assert.ok(Math.abs(physics.feet().y-first.y)<.12,'The cabin floor supports the player');
assert.equal(elevator.selectFloor(last.id),true);
assert.notEqual(elevator.snapshot.state,'moving','A floor request must first close the doors');
let movingSamples=0,previousPlayerY=physics.feet().y,pausedChecked=false,nearWallSamples=0,airborneSamples=0,maxRelativeJump=0;
// A valid tighter contact offset allows the capsule to rest beyond the entry
// margin. That margin must not be reused to decide who is riding the platform.
physics.controller.setOffset(.002);
for(let i=0;i<1200;i++){
  if(elevator.snapshot.state==='moving'||elevator.snapshot.state==='closing'){physics.step(movingSamples<100?.9:movingSamples<140?-.7:0,0,movingSamples>=140&&movingSamples<280,movingSamples>=140&&movingSamples<280);elevator.update(1/60,true);}else tick(1);const s=elevator.snapshot,playerY=physics.feet().y;
  assert.ok(Math.abs(playerY-previousPlayerY)<.12,'The rider must move continuously instead of teleporting between floors: '+JSON.stringify({playerY,previousPlayerY,movingSamples,state:s.state,feet:physics.feet().toArray(),cabY:s.y,crouched:physics.crouched,vy:physics.vy}));previousPlayerY=playerY;
  if(s.state==='moving'){
    movingSamples++;const relativeY=playerY-s.y;maxRelativeJump=Math.max(maxRelativeJump,relativeY);if(Math.abs(physics.feet().x-s.cabinCenter[0])>.4451){nearWallSamples++;assert.ok(s.riding,'A passenger beside the cabin wall remains carried');}if(relativeY>.34){airborneSamples++;assert.ok(s.riding,'A crouched jumping passenger remains inside the moving cabin');}assert.ok(relativeY<.6,'Holding jump must not reset vertical velocity every frame');assert.ok(s.doorProgress<.001,'Every journey starts only with doors closed');
    if(!pausedChecked){const y=s.y,p=physics.feet().clone();tick(30,true);assert.equal(elevator.snapshot.y,y);assert.ok(physics.feet().distanceTo(p)<1e-8);physics.suspend();elevator.update(0,false);assert.ok(physics.controller.autostepEnabled(),'Suspending the visitor restores normal stair controls even while paused');physics.active=true;physics.capsule.setEnabled(true);elevator.update(0,false);assert.equal(physics.controller.autostepEnabled(),false,'Returning to the moving cabin restores passenger control limits');pausedChecked=true;}
  }
  if(s.current===last.id&&s.doorProgress>.999)break;
  if(i===1199)throw new Error('Passenger ride did not finish');
}
assert.ok(movingSamples>60,'The trip must include a substantial moving interval');assert.ok(nearWallSamples>20,'The passenger must actually reach the cabin wall during travel: '+JSON.stringify({nearWallSamples,airborneSamples,maxRelativeJump,movingSamples}));assert.ok(airborneSamples>0&&maxRelativeJump>.34,'Crouched jump exercises the occupied cabin volume beyond the entry height limit: '+JSON.stringify({nearWallSamples,airborneSamples,maxRelativeJump,movingSamples}));
physics.controller.setOffset(.015);for(let i=0;i<35;i++){physics.step(-.7,0,false,false);elevator.update(1/60,true);}
assert.equal(elevator.snapshot.current,last.id);assert.ok(Math.abs(physics.feet().y-last.y)<.12);
// Walk onto the real landing, then summon the empty cabin elsewhere: the
// visitor remains on that floor while the cabin travels without a passenger.
for(let i=0;i<100;i++){elevator.update(1/60,true);physics.step(0,1.2,false,false);}
assert.equal(elevator.snapshot.inside,false);assert.equal(elevator.selectFloor(first.id),false);
const outsideY=physics.feet().y;assert.equal(elevator.call(first.id),true);
until(()=>{assert.ok(physics.controller.autostepEnabled(),'Calling an empty cabin must not disable stair movement outside');return elevator.snapshot.current===first.id&&elevator.snapshot.doorProgress>.999;});
assert.ok(Math.abs(physics.feet().y-outsideY)<.10,'An outside visitor must never be carried by a called lift');
assert.equal(elevator.call(last.id),true);until(()=>elevator.snapshot.current===last.id&&elevator.snapshot.doorProgress>.999);
assert.ok(physics.teleport(new T.Vector3(x,last.y+.03,doorZ-.03),last.storey));tick(2);
elevator.call(first.id);tick(120);
assert.ok(Math.abs(elevator.snapshot.y-last.y)<.01,'A visitor standing across the doorway must prevent departure');
assert.ok(elevator.snapshot.doorProgress>.02,'Closing doors must not clip a capsule standing in the threshold');
elevator.dispose();assert.equal(physics.world.bodies.len(),baseBodies,'Disposal must release the added cabin rigid bodies');
assert.doesNotThrow(()=>elevator.update(1/60,true));physics.dispose();model.dispose();

// Decode the prepared hotel once, without interpreting the 220 MB IFC or
// allocating a second whole-building physics world.
const manifest=JSON.parse(readFileSync('public/models/scene/manifest.json'));
const hotel=new BimModel();hotel.setMeta(manifest.meta);
for(const c of manifest.chunks){const d=decodeSceneChunk(unpackGzip(readFileSync('public/models/scene/'+c.file)));hotel.add(d.definitions,d.parts);}
const hotelDoors=new Doors();hotelDoors.prepare(hotel);const actual=new Elevator();actual.prepare(hotel,hotelDoors);
assert.equal(actual.snapshot.available,true);assert.equal(actual.snapshot.stops.length,7,'All seven original lift landing assemblies must be mapped');
assert.ok(actual.snapshot.stops.every((s,i,a)=>i===0||s.y>a[i-1].y+2.5));
assert.ok(actual.snapshot.adaptation.cutParts>0);
const selected=new Set(actual.snapshot.stops.map(s=>s.id));assert.equal(selected.size,7);
assert.ok(actual.snapshot.adaptation.cutElements.every(id=>/Slab/.test(hotel.elements.get(id)?.type??'')),'Only slabs inside the actual shaft may receive an operational opening');
// Exercise the real hotel collision world, including its original shaft walls,
// duplicate slab instances and all non-lift building obstacles.
await hotel.finalize(()=>{});
const realPhysics=new Physics();await realPhysics.init(hotel,()=>{},hotelDoors,{lightweightFurniture:true});actual.bind(realPhysics);
const realStops=actual.snapshot.stops,landing=realStops[1],sb=actual.snapshot.adaptation.shaftBounds;
const cx=actual.snapshot.cabinCenter[0],frontZ=sb[5];
assert.ok(realPhysics.teleport(new T.Vector3(cx,landing.y+.06,frontZ+.7),landing.storey),'Hotel landing must have a clear standing position');
function realTick(frames){for(let i=0;i<frames;i++){realPhysics.step(0,0,false,false);actual.update(1/60,true);}}
function realUntil(predicate,limit=2400){for(let i=0;i<limit;i++){realTick(1);if(predicate())return i;if(actual.snapshot.state==='blocked')throw new Error('Real hotel lift encountered geometry: '+JSON.stringify({snapshot:actual.snapshot,feet:realPhysics.feet().toArray()}));}throw new Error('Real hotel lift timed out: '+JSON.stringify(actual.snapshot));}
assert.ok(actual.call(landing.id));realUntil(()=>actual.snapshot.current===landing.id&&actual.snapshot.doorProgress>.999);
for(let i=0;i<90;i++){realPhysics.step(0,-1.1,false,false);actual.update(1/60,true);}
assert.ok(actual.snapshot.inside,'Hotel visitor must physically walk into the original landing doorway');
const realTrips=[];
for(const destination of [...realStops.slice(2),realStops[0],landing]){
  assert.ok(actual.selectFloor(destination.id),'Inside passenger must be allowed to choose '+destination.label);
  let previous=realPhysics.feet().y;
  realUntil(()=>{const feet=realPhysics.feet();assert.ok(Math.abs(feet.y-previous)<.10,'Real hotel rider moves in small continuous increments');previous=feet.y;return actual.snapshot.current===destination.id&&actual.snapshot.doorProgress>.999;});
  assert.ok(Math.abs(realPhysics.feet().y-destination.y)<.1,'Hotel capsule arrives supported at '+destination.label);
  realTrips.push({id:destination.id,y:actual.snapshot.y,feet:realPhysics.feet().toArray()});
}
const shaftAdaptation=actual.snapshot.adaptation;actual.dispose();realPhysics.dispose();
console.log(JSON.stringify({pass:true,riderRegression:{nearWallSamples,airborneSamples,maxRelativeJump,movingSamples},stops:realStops,realTrips,adaptation:shaftAdaptation,checks:['source-assemblies','shaft-only-adaptation','exact-retained-floor-area','closed-door-collision','walk-into-cabin','close-before-travel','continuous-carry','carry-near-wall','carry-crouched-jump','outside-and-suspended-stair-controls','pause','multi-floor-trip','outside-caller-not-carried','threshold-safety','dispose','real-hotel-seven-stops','real-hotel-physical-trips-up-and-down']}));
actual.dispose();hotel.dispose();
