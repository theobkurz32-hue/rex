/// <reference lib="webworker" />
import * as IFC from 'web-ifc';
import { Matrix4, Vector3 } from 'three';
import type { Metadata, ElementInfo, Part, GeometryData } from './types';
const scope=self as unknown as DedicatedWorkerGlobalScope;
let api:IFC.IfcAPI, model=-1;
const diagnostics={count:0,samples:[] as string[]};
for(const method of ['log','error'] as const){const original=console[method].bind(console);console[method]=(...a:unknown[])=>{if(String(a[0]).includes('[WEB-IFC]')){diagnostics.count++;if(diagnostics.samples.length<12)diagnostics.samples.push(a.join(' '));}else original(...a);};}
const send=(data:unknown, transfer:Transferable[]=[])=>scope.postMessage(data,transfer);
const val=(v:any):any=>v?.value??null;
const serializable=(v:any):any=>{if(v==null||typeof v!=='object')return v;if(Array.isArray(v))return v.map(serializable);const out:Record<string,unknown>={};for(const k of Object.keys(v))out[k]=serializable(v[k]);if('value' in v)out.value=v.value;return out;};
const list=(type:number)=>{const v=api.GetLineIDsWithType(model,type); return Array.from({length:v.size()},(_,i)=>v.get(i));};
const line=(id:number,recursive=false):any=>api.GetLine(model,id,recursive);
function placementMatrix(placement:any):Matrix4 {
  if(!placement)return new Matrix4();
  const p=typeof placement.value==='number'?line(placement.value):placement;
  const parent=p.PlacementRelTo?placementMatrix(p.PlacementRelTo):new Matrix4();if(!p.RelativePlacement)return parent;
  const a=line(p.RelativePlacement.value),xyz=line(a.Location.value).Coordinates.map(val);
  const z=a.Axis?new Vector3().fromArray(line(a.Axis.value).DirectionRatios.map(val)).normalize():new Vector3(0,0,1);
  const x=a.RefDirection?new Vector3().fromArray([...line(a.RefDirection.value).DirectionRatios.map(val),0].slice(0,3)).normalize():new Vector3(1,0,0);
  const y=new Vector3().crossVectors(z,x).normalize();x.crossVectors(y,z).normalize();const local=new Matrix4().makeBasis(x,y,z);local.setPosition(xyz[0]??0,xyz[1]??0,xyz[2]??0);return parent.multiply(local);
}
function metadata():Metadata {
  const project=line(list(IFC.IFCPROJECT)[0]);
  const units=project?.UnitsInContext?line(project.UnitsInContext.value).Units.map((u:any)=>line(u.value)):[];
  const length=units.find((u:any)=>val(u.UnitType)==='LENGTHUNIT');
  const prefix=val(length?.Prefix), name=val(length?.Name);
  const factors:Record<string,number>={NANO:1e-9,MICRO:1e-6,MILLI:.001,CENTI:.01,DECI:.1,DECA:10,HECTO:100,KILO:1000,MEGA:1e6};
  const unitScale=(u:any):number=>{if(val(u?.Name)==='METRE')return factors[val(u.Prefix)]??1;if(u?.ConversionFactor){const conversion=line(u.ConversionFactor.value),base=line(conversion.UnitComponent.value);return Number(val(conversion.ValueComponent))*unitScale(base);}throw new Error('Unidade de comprimento não reconhecida. Não é seguro ativar a navegação em escala humana.');};
  const unitFactor=unitScale(length);
  const parents=new Map<number,number>();
  for(const id of list(IFC.IFCRELCONTAINEDINSPATIALSTRUCTURE)) {const r=line(id);for(const o of r.RelatedElements??[]) parents.set(o.value,r.RelatingStructure.value);}
  for(const id of list(IFC.IFCRELAGGREGATES)) {const r=line(id);for(const o of r.RelatedObjects??[]) if(!parents.has(o.value)) parents.set(o.value,r.RelatingObject.value);}
  const levels=list(IFC.IFCBUILDINGSTOREY).map(id=>{const l=line(id);const p=placementMatrix(l.ObjectPlacement);return {id,name:val(l.Name)??`Nível #${id}`,elevation:val(l.Elevation)==null?null:Number(val(l.Elevation))*unitFactor,worldY:Math.abs(p.elements[10])>.999?p.elements[14]*unitFactor:null};}).sort((a,b)=>(a.worldY??0)-(b.worldY??0));
  const levelIds=new Set(levels.map(l=>l.id));
  const storey=(id:number)=>{const seen=new Set<number>();let p=parents.get(id);while(p&&!seen.has(p)){if(levelIds.has(p))return p;seen.add(p);p=parents.get(p);}return null;};
  const doorTypes=new Map<number,string>();
  for(const id of list(IFC.IFCRELDEFINESBYTYPE)){const r=line(id),t=line(r.RelatingType.value);if(t.type===IFC.IFCDOORSTYLE||t.type===IFC.IFCDOORTYPE||t.type===IFC.IFCWINDOWSTYLE||t.type===IFC.IFCWINDOWTYPE)for(const o of r.RelatedObjects??[])doorTypes.set(o.value,val(t.OperationType)??'NOTDEFINED');}
  const types=api.GetAllTypesOfModel(model); const elements:ElementInfo[]=[];const counts:Record<string,number>={};
  for(const t of types){const ids=list(t.typeID);counts[t.typeName]=ids.length;if(!api.IsIfcElement(t.typeID))continue;for(const id of ids){const l=line(id);elements.push({id,type:t.typeName,name:val(l.Name),guid:val(l.GlobalId),storey:storey(id),...(t.typeID===IFC.IFCDOOR?{door:{width:Number(val(l.OverallWidth))*unitFactor,height:Number(val(l.OverallHeight))*unitFactor,operation:doorTypes.get(id)??'NOTDEFINED'}}:t.typeID===IFC.IFCWINDOW?{window:{width:Number(val(l.OverallWidth))*unitFactor,height:Number(val(l.OverallHeight))*unitFactor,operation:doorTypes.get(id)??'NOTDEFINED'}}:{})});}}
  return {schema:api.GetModelSchema(model),unit:`${prefix?prefix+' / ':''}${name??'Unidade não suportada'}`,unitFactor,levels,elements,counts,spatial:Object.fromEntries(parents),header:api.GetHeaderLine(model,IFC.FILE_NAME)};
}
async function load(data:ArrayBuffer, wasm:string) {
  api=new IFC.IfcAPI();api.SetWasmPath(wasm,true);await api.Init(undefined,true);api.SetLogLevel(IFC.LogLevel.LOG_LEVEL_ERROR);
  send({kind:'stage',stage:'leitura',message:'Interpretando entidades IFC no worker…'});
  model=api.OpenModel(new Uint8Array(data),{COORDINATE_TO_ORIGIN:true,CIRCLE_SEGMENTS:24,MEMORY_LIMIT:2147483648});
  if(model<0)throw new Error('O parser não abriu o arquivo IFC. Verifique o formato e a memória disponível.');
  send({kind:'stage',stage:'propriedades',message:'Lendo unidades, categorias e relações espaciais…'});
  const meta=metadata();send({kind:'metadata',meta});
  send({kind:'stage',stage:'geometria',message:'Triangulando a geometria real do IFC…'});
  const known=new Set<number>(), rendered=new Set<number>();let parts:Part[]=[], definitions:GeometryData[]=[], transfers:Transferable[]=[];let n=0,triangles=0;
  const flush=()=>{send({kind:'geometry',parts,definitions,processed:n},transfers);parts=[];definitions=[];transfers=[];};
  api.StreamAllMeshes(model,mesh=>{
    for(let i=0;i<mesh.geometries.size();i++){
      const p=mesh.geometries.get(i),key=p.geometryExpressID;
      if(!known.has(key)){
        const g=api.GetGeometry(model,key);const vertices=api.GetVertexArray(g.GetVertexData(),g.GetVertexDataSize()).slice();const indices=api.GetIndexArray(g.GetIndexData(),g.GetIndexDataSize()).slice();g.delete();
        if(!indices.length)continue;
        definitions.push({key,vertices,indices});transfers.push(vertices.buffer,indices.buffer);known.add(key);
      }
      parts.push({id:mesh.expressID,key,matrix:Array.from(p.flatTransformation),color:[p.color.x,p.color.y,p.color.z,p.color.w]});rendered.add(mesh.expressID);n++;
      if(parts.length>=80)flush();
    }
  });flush();
  let errors:unknown=[];try{errors=(api as any).GetAndClearErrors?.(model)??[];}catch{}
  const audit={coordination:api.GetCoordinationMatrix(model),geometryElements:rendered.size,parts:n,triangles,empty:meta.elements.filter(e=>!rendered.has(e.id)).map(e=>e.id),errors:diagnostics,parserScale:1};
  send({kind:'complete',audit});
}
scope.onmessage=async({data})=>{
  try {
    if(data.kind==='load') await load(data.buffer,data.wasm);
    if(data.kind==='properties'){
      const id=data.id;
      const props=await api.properties.getPropertySets(model,id,true);
      const materials=await api.properties.getMaterialsProperties(model,id,true);
      const type=await api.properties.getTypeProperties(model,id,true);
      send({kind:'properties',id,properties:serializable(line(id)),psets:serializable(props),materials:serializable(materials),type:serializable(type)});
    }
    if(data.kind==='dispose'&&model>=0){api.CloseModel(model);model=-1;scope.close();}
  } catch(e){send({kind:'error',message:e instanceof Error?e.message:String(e),property:data.kind==='properties'});}
};
