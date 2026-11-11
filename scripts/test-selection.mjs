import { build } from 'vite';
import { createRequire } from 'node:module';
import { readFile, writeFile } from 'node:fs/promises';
import assert from 'node:assert/strict';
import * as T from 'three';
const require=createRequire(import.meta.url),IFC=require('web-ifc');
await build({configFile:false,logLevel:'error',build:{outDir:'.selection-runtime',lib:{entry:{model:'src/model.ts'},formats:['es']},rolldownOptions:{external:['three','three-mesh-bvh']}}});
const {BimModel}=await import('../.selection-runtime/model.js');
const api=new IFC.IfcAPI();await api.Init();api.SetLogLevel(IFC.LogLevel.LOG_LEVEL_OFF);
const bytes=new Uint8Array(await readFile('reference/hotel-rex.ifc'));
const m=api.OpenModel(bytes,{COORDINATE_TO_ORIGIN:true});const model=new BimModel(),elements=[],known=new Set();
const results=[];
for(const [type,name] of [[IFC.IFCDOOR,'IfcDoor'],[IFC.IFCSLAB,'IfcSlab'],[IFC.IFCSTAIRFLIGHT,'IfcStairFlight']]){
 const vector=api.GetLineIDsWithType(m,type);for(let k=0;k<vector.size();k++){const id=vector.get(k),flat=api.GetFlatMesh(m,id),definitions=[],parts=[];
 for(let j=0;j<flat.geometries.size();j++){const p=flat.geometries.get(j),key=p.geometryExpressID;if(!known.has(key)){const g=api.GetGeometry(m,key),vertices=api.GetVertexArray(g.GetVertexData(),g.GetVertexDataSize()).slice(),indices=api.GetIndexArray(g.GetIndexData(),g.GetIndexDataSize()).slice();g.delete();if(!indices.length)continue;known.add(key);definitions.push({key,vertices,indices});}parts.push({id,key,matrix:Array.from(p.flatTransformation),color:[p.color.x,p.color.y,p.color.z,p.color.w]});}
 if(parts.length){const l=api.GetLine(m,id);elements.push({id,type:name,name:l.Name?.value,guid:l.GlobalId?.value,storey:null});model.add(definitions,parts);break;}}
}
model.setMeta({elements});await model.finalize(()=>{});await model.buildBVH();
for(const e of elements){model.isolation=e.id;model.updateVisibility();let found=null;
 for(const p of model.byElement.get(e.id)){const g=model.geometry.get(p.key),a=g.getAttribute('position'),ix=g.getIndex(),m=new T.Matrix4().fromArray(p.matrix);for(let i=0;i<ix.count;i+=3){const v=[0,1,2].map(j=>new T.Vector3().fromBufferAttribute(a,ix.getX(i+j)).applyMatrix4(m)),n=v[1].clone().sub(v[0]).cross(v[2].clone().sub(v[0]));if(n.length()<1e-7)continue;n.normalize();const c=v[0].clone().add(v[1]).add(v[2]).divideScalar(3);found=model.hit(new T.Raycaster(c.clone().addScaledVector(n,.02),n.negate(),0,.1));if(found)break;}if(found)break;}
 assert.equal(found?.id,e.id);assert.equal(api.GetLine(m,found.id).GlobalId?.value,e.guid);model.hidden.add(e.id);model.updateVisibility();assert.equal(model.visible.has(e.id),false);model.restore();assert.ok(model.visible.has(e.id));results.push({type:e.type,id:e.id,guid:e.guid,hit:found.point.toArray(),properties:(await api.properties.getPropertySets(m,e.id,true)).length});
}
assert.equal(results.length,3);model.dispose();api.CloseModel(m);
// Independent IFC fixture exercises the parser's centimetre normalization and its default Y-up output.
const fixture=`ISO-10303-21;
HEADER;FILE_DESCRIPTION(('ViewDefinition [CoordinationView]'),'2;1');FILE_NAME('unit-test.ifc','2026-11-11T00:00:00',(''),(''),'test','test','');FILE_SCHEMA(('IFC2X3'));ENDSEC;
DATA;
#1=IFCCARTESIANPOINT((0.,0.,0.));
#2=IFCAXIS2PLACEMENT3D(#1,$,$);
#3=IFCGEOMETRICREPRESENTATIONCONTEXT($,'Model',3,0.00001,#2,$);
#4=IFCSIUNIT(*,.LENGTHUNIT.,.CENTI.,.METRE.);
#5=IFCUNITASSIGNMENT((#4));
#6=IFCPROJECT('0AAAAAAAAAAAAAAAAAAAAA',$,'Fixture',$,$,$,$,(#3),#5);
#7=IFCLOCALPLACEMENT($,#2);
#8=IFCDIRECTION((0.,0.,1.));
#9=IFCCARTESIANPOINT((0.,0.));
#10=IFCAXIS2PLACEMENT2D(#9,$);
#11=IFCRECTANGLEPROFILEDEF(.AREA.,$,#10,200.,100.);
#12=IFCEXTRUDEDAREASOLID(#11,#2,#8,300.);
#13=IFCSHAPEREPRESENTATION(#3,'Body','SweptSolid',(#12));
#14=IFCPRODUCTDEFINITIONSHAPE($,$,(#13));
#15=IFCBUILDINGELEMENTPROXY('0BBBBBBBBBBBBBBBBBBBBB',$,'Test box',$,$,#7,#14,$,$);
ENDSEC;END-ISO-10303-21;`;
const u=api.OpenModel(new TextEncoder().encode(fixture),{COORDINATE_TO_ORIGIN:false});let box=new T.Box3();api.StreamAllMeshes(u,flat=>{for(let i=0;i<flat.geometries.size();i++){const p=flat.geometries.get(i),g=api.GetGeometry(u,p.geometryExpressID),v=api.GetVertexArray(g.GetVertexData(),g.GetVertexDataSize()),matrix=new T.Matrix4().fromArray(p.flatTransformation);for(let k=0;k<v.length;k+=6)box.expandByPoint(new T.Vector3(v[k],v[k+1],v[k+2]).applyMatrix4(matrix));g.delete();}});const dimensions=box.getSize(new T.Vector3());assert.ok(Math.abs(dimensions.x-2)<1e-5);assert.ok(Math.abs(dimensions.y-3)<1e-5);assert.ok(Math.abs(dimensions.z-1)<1e-5);api.CloseModel(u);
await writeFile('evidence/selection-tests.json',JSON.stringify({pass:true,selection:results,centimetreFixture:{declared:[200,100,300],metreYUp:dimensions.toArray()}},null,2));console.log(JSON.stringify({pass:true,selection:results,centimetreFixture:dimensions.toArray()},null,2));
