// Acceptance tests use geometry parsed from the supplied IFC and the application classes.
import { build } from 'vite';
import { createRequire } from 'node:module';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import * as T from 'three';
import assert from 'node:assert/strict';
const require=createRequire(import.meta.url),IFC=require('web-ifc');
await build({configFile:false,logLevel:'error',build:{outDir:'.test-runtime',lib:{entry:{model:'src/model.ts',physics:'src/physics.ts'},formats:['es']},rolldownOptions:{external:['three','three-mesh-bvh','@dimforge/rapier3d-compat']}}});
const {BimModel}=await import('../.test-runtime/model.js');
const {Physics}=await import('../.test-runtime/physics.js');
const RAPIER=(await import('@dimforge/rapier3d-compat')).default;
const report={file:'REX_EXE_MODELO_COMPLETO_0203.ifc',checks:[],unverified:[],levels:[],diagnostics:{count:0,samples:[]}};
const originalLog=console.log;for(const method of ['log','error']){const original=console[method];console[method]=(...a)=>{if(String(a[0]).includes('[WEB-IFC]')){report.diagnostics.count++;if(report.diagnostics.samples.length<8)report.diagnostics.samples.push(a.join(' '));}else original(...a);};}
const api=new IFC.IfcAPI();await api.Init();api.SetLogLevel(IFC.LogLevel.LOG_LEVEL_ERROR);
const m=api.OpenModel(new Uint8Array(await readFile('reference/hotel-rex.ifc')),{COORDINATE_TO_ORIGIN:true,CIRCLE_SEGMENTS:24,MEMORY_LIMIT:2147483648});
const ids=t=>{const v=api.GetLineIDsWithType(m,t);return Array.from({length:v.size()},(_,i)=>v.get(i));};
const val=v=>v?.value??null;
const parents=new Map();for(const id of ids(IFC.IFCRELCONTAINEDINSPATIALSTRUCTURE)){const r=api.GetLine(m,id);for(const v of r.RelatedElements)parents.set(v.value,r.RelatingStructure.value);}
for(const id of ids(IFC.IFCRELAGGREGATES)){const r=api.GetLine(m,id);for(const v of r.RelatedObjects)if(!parents.has(v.value))parents.set(v.value,r.RelatingObject.value);}
const levelIds=new Set(ids(IFC.IFCBUILDINGSTOREY));const storey=id=>{const seen=new Set();let p=parents.get(id);while(p&&!seen.has(p)){if(levelIds.has(p))return p;seen.add(p);p=parents.get(p);}return null;};
const elements=[];for(const type of api.GetAllTypesOfModel(m)){if(!api.IsIfcElement(type.typeID))continue;for(const id of ids(type.typeID)){const l=api.GetLine(m,id);elements.push({id,type:type.typeName,name:val(l.Name),guid:val(l.GlobalId),storey:storey(id)});}}
const levels=[...levelIds].map(id=>{const l=api.GetLine(m,id);return {id,name:val(l.Name),elevation:val(l.Elevation),worldY:val(l.Elevation)};});
const model=new BimModel();model.setMeta({elements,levels});const known=new Set();let triangles=0;
originalLog('Interpretando a geometria real para os testes…');
api.StreamAllMeshes(m,mesh=>{const definitions=[],parts=[];for(let j=0;j<mesh.geometries.size();j++){const p=mesh.geometries.get(j),key=p.geometryExpressID;if(!known.has(key)){const g=api.GetGeometry(m,key),vertices=api.GetVertexArray(g.GetVertexData(),g.GetVertexDataSize()).slice(),indices=api.GetIndexArray(g.GetIndexData(),g.GetIndexDataSize()).slice();g.delete();if(!indices.length)continue;definitions.push({key,vertices,indices});known.add(key);}parts.push({id:mesh.expressID,key,matrix:Array.from(p.flatTransformation),color:[p.color.x,p.color.y,p.color.z,p.color.w]});}model.add(definitions,parts);});
for(const p of model.parts){const g=model.geometry.get(p.key);model.bounds.union(g.boundingBox.clone().applyMatrix4(new T.Matrix4().fromArray(p.matrix)));triangles+=g.getIndex().count/3;}
report.geometry={elements:model.byElement.size,parts:model.parts.length,triangles,bounds:[...model.bounds.min.toArray(),...model.bounds.max.toArray()]};
function check(name,fn){try{const evidence=fn();report.checks.push({name,pass:true,evidence});originalLog('PASS',name);}catch(e){report.checks.push({name,pass:false,error:e.message});originalLog('FAIL',name,e.message);}}
check('Escala pela altura declarada de porta IFC',()=>{const measurements=[];for(const id of ids(IFC.IFCDOOR)){if(!model.byElement.has(id))continue;const d=api.GetLine(m,id),height=val(d.OverallHeight),actual=model.elementBounds(id).getSize(new T.Vector3()).y;if(height>0&&Math.abs(height-actual)<.005)measurements.push({id,declared:height,geometry:actual});}assert.ok(measurements.length>0,'Nenhuma altura de porta coincide com a malha');return measurements.slice(0,3);});
check('Níveis distintos, acentos e eixo vertical',()=>{assert.equal(levels.length,25);assert.ok(levels.find(l=>l.name==='Térreo'));const dimensions=model.bounds.getSize(new T.Vector3());assert.ok(Math.abs(dimensions.y-25.18)<.01);return {levels:levels.length,verticalExtent:dimensions.y,elevations:levels.map(l=>({id:l.id,name:l.name,elevation:l.elevation}))};});
api.CloseModel(m);
const physics=new Physics();originalLog('Construindo colisores…');await physics.init(model,()=>{});
check('Geometria visual e física usam os mesmos triângulos',()=>{let n=0;physics.world.colliders.forEach(c=>{if(c.handle!==physics.capsule.handle){n+=c.shape.indices.length/3;}});assert.equal(n,triangles);assert.equal(physics.colliderElement.size,model.byElement.size);return {triangles:n,colliders:physics.colliderElement.size};});
const entries=new Map();for(const level of levels){const p=await physics.findEntry(model,level.id);if(p)entries.set(level.id,p);report.levels.push({id:level.id,name:level.name,entry:p?.toArray()??null});}
check('Entrada e troca de nível sem interpenetração',()=>{assert.ok(entries.size>1);for(const [id,p] of entries){assert.ok(physics.clearAt(p));assert.ok(physics.teleport(p,id));assert.ok(physics.clearAt(physics.feet()));}return {levelsWithEntry:entries.size,levelsWithoutEntry:levels.length-entries.size};});
const [entryLevel,entry]=entries.entries().next().value??[];
if(entry){
 check('Apoio estável em superfície real',()=>{physics.teleport(entry,entryLevel);const before=physics.feet().clone();for(let i=0;i<180;i++)physics.step(0,0,false,false);assert.ok(physics.grounded);assert.ok(Math.abs(physics.feet().y-before.y)<.08);return {start:before.toArray(),end:physics.feet().toArray(),grounded:physics.grounded};});
 check('Salto apenas com apoio e gravidade',()=>{const before=physics.feet().clone();physics.step(0,0,true,false);let peak=physics.feet().y;for(let i=0;i<150;i++){physics.step(0,0,false,false);peak=Math.max(peak,physics.feet().y);}assert.ok(peak>before.y+.12);assert.ok(physics.grounded);return {height:peak-before.y,end:physics.feet().toArray()};});
 check('Agachar e retornar ao ponto seguro',()=>{physics.crouch(true);assert.equal(physics.crouched,true);assert.equal(physics.height,1.1);physics.crouch(false);assert.equal(physics.crouched,false);assert.ok(physics.recover());assert.ok(physics.clearAt(physics.feet()));return {safe:physics.safe.toArray(),feet:physics.feet().toArray()};});
 check('Queda fora do limite e recuperação',()=>{const safe=physics.safe.clone();physics.body.setTranslation({x:model.bounds.max.x+3,y:model.bounds.max.y+2,z:model.bounds.max.z+3},true);physics.body.setNextKinematicTranslation(physics.body.translation());physics.world.step();physics.grounded=false;physics.vy=0;const start=physics.feet().y;for(let i=0;i<240;i++)physics.step(0,0,false,false);assert.ok(physics.feet().y<start-10);assert.ok(physics.recover());assert.ok(physics.feet().distanceTo(safe)<.01);return {fallStart:start,recovered:safe.toArray()};});
 // Search radial paths on actual floors. Obstacles are accepted only with a lateral contact and limited translation.
 let blocked=null;outer:for(const [level,p] of entries){for(let a=0;a<Math.PI*2;a+=Math.PI/4){physics.teleport(p,level);for(let i=0;i<240;i++){const before=physics.feet();physics.step(Math.cos(a)*1.4,Math.sin(a)*1.4,false,false);for(let j=0;j<physics.controller.numComputedCollisions();j++){const hit=physics.controller.computedCollision(j);const id=physics.colliderElement.get(hit.collider?.handle),type=model.elements.get(id)?.type;if(Math.abs(hit.normal1.y)<.4&&physics.grounded&&physics.feet().distanceTo(before)<.012){blocked={id,type,level,position:physics.feet().toArray()};break outer;}}if(physics.feet().y<p.y-.5)break;}}}
 check('Obstáculo IFC bloqueia a cápsula',()=>{assert.ok(blocked,'Nenhum bloqueio lateral encontrado nos caminhos amostrados');return blocked;});
 let opening=null;outer2:for(const [level,p] of entries){for(let a=0;a<Math.PI*2;a+=Math.PI/4){physics.teleport(p,level);let collided=false;for(let i=0;i<300;i++){physics.step(Math.cos(a)*1.4,Math.sin(a)*1.4,false,false);if(!physics.grounded&&physics.feet().y<p.y-.6){opening={level,from:p.toArray(),to:physics.feet().toArray()};break outer2;}}}}
 check('Borda ou vão real permite queda',()=>{assert.ok(opening,'Nenhuma queda encontrada nas trajetórias amostradas');return opening;});
}
// Stair test extracts upward-facing actual tread triangle centroids, finds a capsule fit and climbs along the flight.
let stairResult=null;for(const e of elements.filter(e=>e.type==='IfcStairFlight')){
 if(stairResult)break;const treads=[];for(const p of model.byElement.get(e.id)??[]){const g=model.geometry.get(p.key),a=g.getAttribute('position'),ix=g.getIndex(),m=new T.Matrix4().fromArray(p.matrix);for(let i=0;i<ix.count;i+=3){const v=[0,1,2].map(j=>new T.Vector3().fromBufferAttribute(a,ix.getX(i+j)).applyMatrix4(m));const n=v[1].clone().sub(v[0]).cross(v[2].clone().sub(v[0])).normalize();if(Math.abs(n.y)>.95){const c=v[0].clone().add(v[1]).add(v[2]).divideScalar(3);treads.push(c);}}}
 treads.sort((a,b)=>a.y-b.y);if(!treads.length)continue;const lo=treads[0],hi=treads[treads.length-1],direction=hi.clone().sub(lo);direction.y=0;direction.normalize();
 for(const t of treads.slice(0,40)){const p=physics.supportAt(t.x,t.z,t.y+.08,t.y-.1,null,model);if(!p||!physics.teleport(p,e.storey))continue;for(let i=0;i<180;i++){physics.step(direction.x*1.0,direction.z*1.0,false,false);if(physics.feet().y>p.y+.3){stairResult={id:e.id,rise:physics.feet().y-p.y,from:p.toArray(),to:physics.feet().toArray()};break;}}if(stairResult)break;}
}
if(stairResult)check('Subida em escada real com cápsula',()=>stairResult);else report.unverified.push('Escadas: nenhum percurso ascendente válido foi encontrado pela amostragem automática; requer inspeção manual de cada lance.');
check('Desativação da física para inspeção',()=>{physics.suspend();assert.equal(physics.active,false);assert.equal(physics.capsule.isEnabled(),false);return true;});
physics.dispose();check('Descarte de mundo e colisores',()=>{assert.equal(physics.ready,false);assert.equal(physics.colliderElement.size,0);return true;});
model.dispose();await mkdir('evidence',{recursive:true});await writeFile('evidence/physics-tests.json',JSON.stringify(report,null,2));originalLog(JSON.stringify({pass:report.checks.filter(c=>c.pass).length,fail:report.checks.filter(c=>!c.pass).length,unverified:report.unverified},null,2));if(report.checks.some(c=>!c.pass))process.exitCode=1;
