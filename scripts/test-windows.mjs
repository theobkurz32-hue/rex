import { build } from 'vite';
import { createRequire } from 'node:module';
import { readFile } from 'node:fs/promises';
import { gunzipSync } from 'node:zlib';
import assert from 'node:assert/strict';
import * as T from 'three';
const require=createRequire(import.meta.url), IFC=require('web-ifc');
await build({configFile:false,logLevel:'error',build:{outDir:'.test-runtime/windows',lib:{entry:{model:'src/model.ts',physics:'src/physics.ts',doors:'src/doors.ts',windows:'src/windows.ts'},formats:['es']},rolldownOptions:{external:['three','three-mesh-bvh','@dimforge/rapier3d-compat']}}});
const {BimModel}=await import('../.test-runtime/windows/model.js');
const {Physics}=await import('../.test-runtime/windows/physics.js');
const {Doors}=await import('../.test-runtime/windows/doors.js');
const {prepareWindows}=await import('../.test-runtime/windows/windows.js');
const api=new IFC.IfcAPI();await api.Init();api.SetLogLevel(IFC.LogLevel.LOG_LEVEL_OFF);
const m=api.OpenModel(gunzipSync(await readFile('public/models/hotel-rex.ifc.gz')),{COORDINATE_TO_ORIGIN:true});
const model=new BimModel(), known=new Set(),elements=[],types=new Map();
const rels=api.GetLineIDsWithType(m,IFC.IFCRELDEFINESBYTYPE);
for(let i=0;i<rels.size();i++){const r=api.GetLine(m,rels.get(i)),t=api.GetLine(m,r.RelatingType.value);for(const o of r.RelatedObjects??[])types.set(o.value,t.OperationType?.value??'NOTDEFINED');}
const ids=api.GetLineIDsWithType(m,IFC.IFCWINDOW);
for(let i=0;i<ids.size();i++){
 const id=ids.get(i),l=api.GetLine(m,id),flat=api.GetFlatMesh(m,id),definitions=[],parts=[];
 for(let j=0;j<flat.geometries.size();j++){
  const p=flat.geometries.get(j),key=p.geometryExpressID;
  if(!known.has(key)){const g=api.GetGeometry(m,key),vertices=api.GetVertexArray(g.GetVertexData(),g.GetVertexDataSize()).slice(),indices=api.GetIndexArray(g.GetIndexData(),g.GetIndexDataSize()).slice();g.delete();if(!indices.length)continue;known.add(key);definitions.push({key,vertices,indices});}
  parts.push({id,key,matrix:Array.from(p.flatTransformation),color:[p.color.x,p.color.y,p.color.z,p.color.w]});
 }
 elements.push({id,type:'IfcWindow',name:l.Name?.value,guid:l.GlobalId?.value,storey:null,window:{width:l.OverallWidth?.value,height:l.OverallHeight?.value,operation:types.get(id)}});model.add(definitions,parts);
}
api.CloseModel(m);model.setMeta({elements});
const doors=new Doors();const report=prepareWindows(model,doors);console.log(JSON.stringify(report));
assert.equal(doors.items.size,98,`Unsupported: ${report.unsupported}`);
assert.deepEqual(report.unsupported,[]);assert.equal(report.virtualVentilation.length,15);
assert.equal([...doors.items.values()].filter(d=>d.kind==='tilt').length,17);
assert.equal([...doors.items.values()].filter(d=>d.kind==='slide').length,81);
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
 if(door.kind==='swing'||door.kind==='double')door.leaves.forEach((l,i)=>assert.equal(l.angle,-angles[i],'Other side must open away from viewer'));
 for(let i=0;i<40;i++)doors.update(model,physics,1/60,()=>assert.fail('Unexpected block'));
 doors.toggle(door,viewer);for(let i=0;i<40;i++)doors.update(model,physics,1/60,()=>assert.fail('Unexpected block'));
 assert.equal(door.progress,0);
}

// Original glass, timber and metal geometry is unchanged; only matrices move.
for(const d of doors.items.values()){
 if(d.kind==='tilt')for(const l of d.leaves){assert.ok(l.axis&&Math.abs(l.axis.y)<1e-8,'Tilting windows must use a horizontal hinge axis');assert.ok(l.pivot.clone().applyMatrix4(doors.transform(l,1)).distanceTo(l.pivot)<1e-7,'Hinge must stay fixed');}
 const p=d.leaves[0].parts.find(p=>p.color[3]<.5);assert.ok(p,`Window ${d.id} has a moving glass pane`);const g=model.geometry.get(p.key),center=g.boundingBox.getCenter(new T.Vector3()).applyMatrix4(new T.Matrix4().fromArray(p.matrix));
 const origin=center.clone().addScaledVector(d.normal,.2),direction=d.normal.clone().negate();
 physics.world.step();assert.equal(physics.doorHit(origin,direction,.5),d.id,'Closed glazing has collision');
 doors.toggle(d,origin);for(let i=0;i<40;i++){doors.update(model,physics,1/60,()=>assert.fail('Unexpected collision'));physics.world.step();}
 const visual=new T.Matrix4().fromArray(p.matrix),opened=g.boundingBox.getCenter(new T.Vector3()).applyMatrix4(visual);
 const n=d.normal.clone().applyAxisAngle(d.leaves[0].axis??new T.Vector3(0,1,0),d.leaves[0].slide.lengthSq()?0:d.leaves[0].angle);
 assert.equal(physics.doorHit(opened.clone().addScaledVector(n,.08),n.clone().negate(),.16),d.id,'Open sash has collision');
 if(d.kind==='slide')assert.notEqual(physics.doorHit(origin,direction,.5),d.id,'Glass clears its original aperture');
 const selected=model.hit(new T.Raycaster(opened.clone().addScaledVector(n,.04),n.clone().negate(),0,.08));assert.equal(selected?.id,d.id,'Selection follows moved glazing');
 doors.toggle(d,origin);for(let i=0;i<40;i++)doors.update(model,physics,1/60,()=>assert.fail('Unexpected collision'));
}
assert.ok(model.materials.some(m=>m.userData.finish==='glass'&&m.opacity===.24&&!m.depthWrite));
model.setTransparency(true);model.setTransparency(false);assert.ok(model.materials.filter(m=>m.userData.finish==='glass').every(m=>!m.depthWrite));
model.dispose();physics.dispose();console.log(JSON.stringify({pass:true,windows:98,sliding:81,tilting:17,checks:['fixed-frames','roundtrip','mirrored-instances','horizontal-tilt','moved-colliders','open-aperture','selection','glass-transparency']}));
