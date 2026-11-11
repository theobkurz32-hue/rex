import {gunzipSync} from 'node:zlib';import {build} from 'vite';import {createRequire} from 'node:module';import {readFile} from 'node:fs/promises';import * as T from 'three';import assert from 'node:assert/strict';
const require=createRequire(import.meta.url),IFC=require('web-ifc');
await build({configFile:false,logLevel:'error',build:{outDir:'.test-runtime/fullgame',lib:{entry:{model:'src/model.ts',physics:'src/physics.ts',survival:'src/survival.ts',doors:'src/doors.ts'},formats:['es']},rolldownOptions:{external:['three','three/addons/geometries/RoundedBoxGeometry.js','three-mesh-bvh','@dimforge/rapier3d-compat']}}});
const {BimModel}=await import('../.test-runtime/fullgame/model.js');
const {Physics}=await import('../.test-runtime/fullgame/physics.js');
const RAPIER=(await import('@dimforge/rapier3d-compat')).default;
const report={diagnostics:{count:0,samples:[]}};
const originalLog=console.log;for(const method of ['log','error']){const original=console[method];console[method]=(...a)=>{if(String(a[0]).includes('[WEB-IFC]')){report.diagnostics.count++;if(report.diagnostics.samples.length<8)report.diagnostics.samples.push(a.join(' '));}else original(...a);};}
const api=new IFC.IfcAPI();await api.Init();api.SetLogLevel(IFC.LogLevel.LOG_LEVEL_ERROR);
const m=api.OpenModel(gunzipSync(await readFile('public/models/hotel-rex.ifc.gz')),{COORDINATE_TO_ORIGIN:true,CIRCLE_SEGMENTS:24,MEMORY_LIMIT:2147483648});
const ids=t=>{const v=api.GetLineIDsWithType(m,t);return Array.from({length:v.size()},(_,i)=>v.get(i));};
const val=v=>v?.value??null;
const parents=new Map();for(const id of ids(IFC.IFCRELCONTAINEDINSPATIALSTRUCTURE)){const r=api.GetLine(m,id);for(const v of r.RelatedElements)parents.set(v.value,r.RelatingStructure.value);}
for(const id of ids(IFC.IFCRELAGGREGATES)){const r=api.GetLine(m,id);for(const v of r.RelatedObjects)if(!parents.has(v.value))parents.set(v.value,r.RelatingObject.value);}
const levelIds=new Set(ids(IFC.IFCBUILDINGSTOREY));const storey=id=>{const seen=new Set();let p=parents.get(id);while(p&&!seen.has(p)){if(levelIds.has(p))return p;seen.add(p);p=parents.get(p);}return null;};
const elements=[];for(const type of api.GetAllTypesOfModel(m)){if(!api.IsIfcElement(type.typeID))continue;for(const id of ids(type.typeID)){const l=api.GetLine(m,id);elements.push({id,type:type.typeName,name:val(l.Name),guid:val(l.GlobalId),storey:storey(id)});}}
const levels=[...levelIds].map(id=>{const l=api.GetLine(m,id);return {id,name:val(l.Name),elevation:val(l.Elevation),worldY:val(l.Elevation)};});
for(const e of elements)if(e.type==='IfcDoor'){const l=api.GetLine(m,e.id);e.door={width:val(l.OverallWidth),height:val(l.OverallHeight),operation:'NOTDEFINED'};}
const model=new BimModel();model.setMeta({elements,levels});const known=new Set();let triangles=0;
originalLog('Interpretando a geometria real para os testes…');
api.StreamAllMeshes(m,mesh=>{const definitions=[],parts=[];for(let j=0;j<mesh.geometries.size();j++){const p=mesh.geometries.get(j),key=p.geometryExpressID;if(!known.has(key)){const g=api.GetGeometry(m,key),vertices=api.GetVertexArray(g.GetVertexData(),g.GetVertexDataSize()).slice(),indices=api.GetIndexArray(g.GetIndexData(),g.GetIndexDataSize()).slice();g.delete();if(!indices.length)continue;definitions.push({key,vertices,indices});known.add(key);}parts.push({id:mesh.expressID,key,matrix:Array.from(p.flatTransformation),color:[p.color.x,p.color.y,p.color.z,p.color.w]});}model.add(definitions,parts);});
for(const p of model.parts){const g=model.geometry.get(p.key);model.bounds.union(g.boundingBox.clone().applyMatrix4(new T.Matrix4().fromArray(p.matrix)));triangles+=g.getIndex().count/3;}
report.geometry={elements:model.byElement.size,parts:model.parts.length,triangles,bounds:[...model.bounds.min.toArray(),...model.bounds.max.toArray()]};

api.CloseModel(m);
const {Doors}=await import('../.test-runtime/fullgame/doors.js'),{SurvivalGame}=await import('../.test-runtime/fullgame/survival.js');
const doors=new Doors();doors.prepare(model);await model.prepareRenderDetail();console.log('RENDER DETAIL',JSON.stringify(model.detailStats));assert.ok(model.detailStats.reducedTriangles<model.detailStats.sourceTriangles*.85);const physics=new Physics();await physics.init(model,()=>{},doors);
const counts=new Map();for(const e of elements)if(e.type==='IfcDoor'&&/semi-oca/i.test(e.name??''))counts.set(e.storey,(counts.get(e.storey)??0)+1);
console.log('ROOM LEVELS', [...counts].map(([id,n])=>({id,n,name:levels.find(l=>l.id===id)?.name})));
const level=[...counts].sort((a,b)=>b[1]-a[1])[0][0],entry=await physics.findEntry(model,level);assert.ok(entry);physics.teleport(entry,level);console.log('ENTRY',entry.toArray());
const game=new SurvivalGame(new T.Scene(),new T.PerspectiveCamera());game.bind(model,physics,doors);const t=performance.now();await game.prepare(5);console.log('REAL NAV',JSON.stringify({nodes:game.nav.nodes.length,rooms:game.roomMap,zombies:game.zombies.length,seconds:(performance.now()-t)/1000}));assert.ok(game.roomMap.length>0);
const component=new Set([game.nav.nearest(entry).id]),queue=[...component];for(let qi=0;qi<queue.length;qi++)for(const e of game.nav.nodes[queue[qi]].edges)if(!component.has(e.to)){component.add(e.to);queue.push(e.to);}console.log('CONNECTED HEIGHTS',Math.min(...queue.map(i=>game.nav.nodes[i].position.y)),Math.max(...queue.map(i=>game.nav.nodes[i].position.y)),queue.length);
const states=new Set();for(let i=0;i<1200&&!game.dead;i++){game.step(1/60,true,true);physics.step(0,0,false,false);doors.update(model,physics,1/60,()=>{});for(const z of game.zombies)states.add(z.state);}
console.log('REAL STATES', [...states],JSON.stringify(game.snapshot));assert.ok(states.has('openingDoor')&&states.has('exiting'));for(const z of game.zombies)z.collider.setEnabled(false);
const goal=game.nav.nearest(entry),minY=Math.min(...queue.map(i=>game.nav.nodes[i].position.y));let testRoute=[];let testStart;
for(const i of queue){const node=game.nav.nodes[i];if(node.position.y>minY+.25||!physics.clearAt(node.position))continue;const route=game.nav.path(node,goal,doors);if(route.length&&(!testRoute.length||route.length<testRoute.length)){testRoute=route;testStart=node;}}
if(testStart&&entry.y-testStart.position.y>1){
 physics.teleport(testStart.position,null);let pi=1,stuck=0,previous=physics.feet(),rise=0;
 for(let t=0;t<6000&&pi<testRoute.length;t++){
  const feet=physics.feet(),next=game.nav.nodes[testRoute[pi]],previousNode=game.nav.nodes[testRoute[pi-1]],edge=previousNode.edges.find(e=>e.to===next.id),door=edge?.door!=null?doors.items.get(edge.door):null;
  if(door&&door.progress<.9){if(door.target!==1)doors.toggle(door,feet);doors.update(model,physics,1/60,()=>{});physics.step(0,0,false,false);continue;}
  const dx=next.position.x-feet.x,dz=next.position.z-feet.z,length=Math.hypot(dx,dz);
  if(length<.17&&Math.abs(feet.y-next.position.y)<.38){pi++;continue;}
  physics.step(dx/length*1.1,dz/length*1.1,false,false);rise=Math.max(rise,physics.feet().y-testStart.position.y);
  if(feet.distanceTo(previous)<.0002)stuck++;else stuck=0;previous.copy(feet);if(stuck>240)break;
 }
 assert.ok(rise>4.5,'Player must climb the real two-flight stair');
 console.log('REAL STAIRS',JSON.stringify({route:testRoute.length,completed:pi,from:testStart.position.toArray(),to:physics.feet().toArray(),rise,next:game.nav.nodes[testRoute[pi]]?.position.toArray(),collisions:Array.from({length:Math.min(3,physics.controller.numComputedCollisions())},(_,i)=>{const c=physics.controller.computedCollision(i);const id=physics.colliderElement.get(c.collider.handle);return {id,type:model.elements.get(id)?.type,name:model.elements.get(id)?.name};})}));
 const descending=testRoute.slice(0,pi).reverse();let di=1;
 for(let t=0;t<6000&&di<descending.length;t++){const f=physics.feet(),n=game.nav.nodes[descending[di]],dx=n.position.x-f.x,dz=n.position.z-f.z,l=Math.hypot(dx,dz);if(l<.18&&Math.abs(f.y-n.position.y)<.4){di++;continue;}physics.step(dx/l,dz/l,false,false);}
 const descent=entry.y-physics.feet().y;console.log('DESCENT',descent,di,descending.length);assert.ok(descent>4.5,'Player must descend the real stairs');
}
game.dispose();model.dispose();physics.dispose();console.log('PASS real hotel navigation and enemy exit');
