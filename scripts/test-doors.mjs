import { build } from 'vite';
import { createRequire } from 'node:module';
import { readFile } from 'node:fs/promises';
import { gunzipSync } from 'node:zlib';
import assert from 'node:assert/strict';
import * as T from 'three';
const require=createRequire(import.meta.url), IFC=require('web-ifc');
await build({configFile:false,logLevel:'error',build:{outDir:'.test-runtime/doors',lib:{entry:{model:'src/model.ts',physics:'src/physics.ts',doors:'src/doors.ts'},formats:['es']},rolldownOptions:{external:['three','three-mesh-bvh','@dimforge/rapier3d-compat']}}});
const {BimModel}=await import('../.test-runtime/doors/model.js');
const {Physics}=await import('../.test-runtime/doors/physics.js');
const {Doors}=await import('../.test-runtime/doors/doors.js');
const api=new IFC.IfcAPI();await api.Init();api.SetLogLevel(IFC.LogLevel.LOG_LEVEL_OFF);
const m=api.OpenModel(gunzipSync(await readFile('public/models/hotel-rex.ifc.gz')),{COORDINATE_TO_ORIGIN:true});
const model=new BimModel(), known=new Set(),elements=[],types=new Map();
const rels=api.GetLineIDsWithType(m,IFC.IFCRELDEFINESBYTYPE);
for(let i=0;i<rels.size();i++){const r=api.GetLine(m,rels.get(i)),t=api.GetLine(m,r.RelatingType.value);for(const o of r.RelatedObjects??[])types.set(o.value,t.OperationType?.value??'NOTDEFINED');}
const ids=api.GetLineIDsWithType(m,IFC.IFCDOOR);
for(let i=0;i<ids.size();i++){
 const id=ids.get(i),l=api.GetLine(m,id),flat=api.GetFlatMesh(m,id),definitions=[],parts=[];
 for(let j=0;j<flat.geometries.size();j++){
  const p=flat.geometries.get(j),key=p.geometryExpressID;
  if(!known.has(key)){const g=api.GetGeometry(m,key),vertices=api.GetVertexArray(g.GetVertexData(),g.GetVertexDataSize()).slice(),indices=api.GetIndexArray(g.GetIndexData(),g.GetIndexDataSize()).slice();g.delete();if(!indices.length)continue;known.add(key);definitions.push({key,vertices,indices});}
  parts.push({id,key,matrix:Array.from(p.flatTransformation),color:[p.color.x,p.color.y,p.color.z,p.color.w]});
 }
 elements.push({id,type:'IfcDoor',name:l.Name?.value,guid:l.GlobalId?.value,storey:null,door:{width:l.OverallWidth?.value,height:l.OverallHeight?.value,operation:types.get(id)}});model.add(definitions,parts);
}
api.CloseModel(m);model.setMeta({elements});
const doors=new Doors();doors.prepare(model);
assert.equal(doors.items.size,78,`Unsupported: ${doors.unsupported}`);
assert.deepEqual(doors.unsupported,[]);
assert.equal([...doors.items.values()].filter(d=>d.kind==='double').length,2);
assert.equal([...doors.items.values()].filter(d=>d.kind==='slide').length,1);
await model.finalize(()=>{});await model.buildBVH();
const physics=new Physics();await physics.init(model,()=>{},doors);
const original=new Map(model.parts.map(p=>[p,[...p.matrix]]));
const changed=(p)=>p.matrix.some((v,i)=>Math.abs(v-original.get(p)[i])>1e-6);
for(const door of doors.items.values()){
 const viewer=door.center.clone().addScaledVector(door.normal,1);
 doors.toggle(door,viewer);for(let i=0;i<40;i++)doors.update(model,physics,1/60,()=>assert.fail('Unexpected block'));
 assert.equal(door.progress,1);assert.ok(door.leaves.every(l=>l.parts.some(changed)));
 const frame=model.byElement.get(door.id).filter(p=>!doors.moving.has(p));assert.ok(frame.length);assert.ok(frame.every(p=>!changed(p)),'Frame must remain fixed');
 // Physical poses and visible vertices must agree, including mirrored instances.
 for(const leaf of door.leaves){const matrix=doors.transform(leaf,1);for(let j=0;j<leaf.parts.length;j++){const actual=new T.Matrix4().fromArray(leaf.parts[j].matrix),expected=matrix.clone().multiply(leaf.originals[j]);assert.ok(actual.elements.every((n,i)=>Math.abs(n-expected.elements[i])<1e-8));}}
 doors.toggle(door,viewer);for(let i=0;i<40;i++)doors.update(model,physics,1/60,()=>assert.fail('Unexpected block'));
 assert.equal(door.progress,0);assert.ok(model.byElement.get(door.id).every(p=>!changed(p)));
 const angles=door.leaves.map(l=>l.angle);
 doors.toggle(door,door.center.clone().addScaledVector(door.normal,-1));
 if(door.kind!=='slide')door.leaves.forEach((l,i)=>assert.equal(l.angle,-angles[i],'Other side must open away from viewer'));
 for(let i=0;i<40;i++)doors.update(model,physics,1/60,()=>assert.fail('Unexpected block'));
 doors.toggle(door,viewer);for(let i=0;i<40;i++)doors.update(model,physics,1/60,()=>assert.fail('Unexpected block'));
 assert.equal(door.progress,0);
}
// Use a real single-leaf door, isolated from unrelated IFC doors, for passage tests.
const door=doors.items.get(9809), leaf=door.leaves[0];
const panel=leaf.parts.find(p=>model.geometry.get(p.key).boundingBox.getSize(new T.Vector3()).length()>1);
const g=model.geometry.get(panel.key),closed=g.boundingBox.getCenter(new T.Vector3()).applyMatrix4(new T.Matrix4().fromArray(panel.matrix));
const origin=closed.clone().addScaledVector(door.normal,.8),dir=door.normal.clone().negate();
assert.equal(physics.doorHit(origin,dir,2),door.id,'Closed leaf must be solid');
assert.equal(physics.doorHit(origin.clone().addScaledVector(door.normal,3),dir,2),null,'Out of reach');
const camera=new T.PerspectiveCamera();camera.position.copy(origin);camera.lookAt(closed);camera.updateMatrixWorld();
assert.equal(doors.target(model,physics,camera)?.id,door.id);
model.hidden.add(door.id);model.updateVisibility();assert.equal(doors.target(model,physics,camera),null);model.restore();
doors.toggle(door,origin);for(let i=0;i<40;i++){doors.update(model,physics,1/60,()=>{});physics.world.step();}
assert.notEqual(physics.doorHit(origin,dir,1.5),door.id,'No invisible closed leaf collider');
const open=g.boundingBox.getCenter(new T.Vector3()).applyMatrix4(new T.Matrix4().fromArray(panel.matrix));
const openedNormal=door.normal.clone().applyAxisAngle(new T.Vector3(0,1,0),leaf.angle);
assert.equal(physics.doorHit(open.clone().addScaledVector(openedNormal,.4),openedNormal.clone().negate(),.6),door.id,'Open leaf keeps collision');
const visual=model.hit(new T.Raycaster(open.clone().addScaledVector(openedNormal,.15),openedNormal.clone().negate(),0,.3));assert.equal(visual?.id,door.id,'Selection follows open leaf');
// The capsule crosses the actual doorway after opening, and a closing leaf
// stops before intersecting it. No floor or movement shortcuts are used here.
const feet=closed.clone();feet.y=model.elementBounds(door.id).min.y+.05;
assert.ok(physics.clearAt(feet),'Doorway must be clear when open');
physics.body.setTranslation({x:closed.x,y:feet.y+physics.height/2,z:closed.z},true);physics.body.setNextKinematicTranslation(physics.body.translation());physics.capsule.setEnabled(true);physics.active=true;physics.world.step();
let blocked=0;doors.toggle(door,origin);for(let i=0;i<40;i++)doors.update(model,physics,1/60,()=>blocked++);
assert.ok(blocked>0,'Closing leaf must stop for player');assert.ok(door.progress>0);assert.equal(door.target,door.progress);
physics.suspend();doors.toggle(door,origin);for(let i=0;i<40;i++)doors.update(model,physics,1/60,()=>{});
// Obstructions in front of a door must win over the door itself.
const R=(await import('@dimforge/rapier3d-compat')).default;
const wall=physics.world.createCollider(R.ColliderDesc.cuboid(.3,.3,.3).setTranslation(origin.x,origin.y,origin.z));physics.colliderElement.set(wall.handle,-123);physics.world.step();
assert.equal(doors.target(model,physics,camera),null);
model.dispose();physics.dispose();assert.equal(physics.ready,false);assert.equal(physics.colliderElement.size,0);
console.log(JSON.stringify({pass:true,doors:78,swing:75,double:2,slide:1,checks:['open-close-all','fixed-frames','mirrored-transforms','visible-physics-sync','closed-collision','open-passage','open-leaf-collision','selection','reach','occlusion','hidden-doors','player-block','dispose']},null,2));
