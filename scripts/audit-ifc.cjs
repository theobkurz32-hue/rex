const fs=require('fs'); const IFC=require('web-ifc');
const file=process.argv[2]||'reference/hotel-rex.ifc';
(async()=>{
 const api=new IFC.IfcAPI(); await api.Init(); api.SetLogLevel(IFC.LogLevel.LOG_LEVEL_ERROR);
 const diagnostics={count:0,samples:[]};const originalLog=console.log;for(const method of ['log','error']){const orig=console[method];console[method]=(...a)=>{if(String(a[0]).includes('[WEB-IFC]')){diagnostics.count++;if(diagnostics.samples.length<12)diagnostics.samples.push(a.join(' '));}else orig(...a);};}
 const start=Date.now();const m=api.OpenModel(fs.readFileSync(file),{COORDINATE_TO_ORIGIN:true,CIRCLE_SEGMENTS:24,MEMORY_LIMIT:2147483648});
 const ids=t=>{const v=api.GetLineIDsWithType(m,t);return Array.from({length:v.size()},(_,i)=>v.get(i));};
 const counts={};for(const t of api.GetAllTypesOfModel(m))if(api.IsIfcElement(t.typeID)||t.typeID===IFC.IFCBUILDINGSTOREY)counts[t.typeName]=ids(t.typeID).length;
 const storeys=ids(IFC.IFCBUILDINGSTOREY).map(id=>api.GetLine(m,id));
 const project=api.GetLine(m,ids(IFC.IFCPROJECT)[0],true);
 const min=[Infinity,Infinity,Infinity],max=[-Infinity,-Infinity,-Infinity];const rendered=new Set();let parts=0,triangles=0;const sample=[];
 api.StreamAllMeshes(m,mesh=>{for(let k=0;k<mesh.geometries.size();k++){const p=mesh.geometries.get(k),g=api.GetGeometry(m,p.geometryExpressID);const v=api.GetVertexArray(g.GetVertexData(),g.GetVertexDataSize());const ix=api.GetIndexArray(g.GetIndexData(),g.GetIndexDataSize());const a=p.flatTransformation;for(let i=0;i<v.length;i+=6){for(let d=0;d<3;d++){const c=a[d]*v[i]+a[4+d]*v[i+1]+a[8+d]*v[i+2]+a[12+d];min[d]=Math.min(min[d],c);max[d]=Math.max(max[d],c);}}triangles+=ix.length/3;parts++;rendered.add(mesh.expressID);if(sample.length<3) sample.push({id:mesh.expressID,matrix:a});g.delete();}});
 const empty=[];for(const t of api.GetAllTypesOfModel(m))if(api.IsIfcElement(t.typeID))for(const id of ids(t.typeID))if(!rendered.has(id))empty.push({id,type:t.typeName});
 const output={file,bytes:fs.statSync(file).size,schema:api.GetModelSchema(m),header:api.GetHeaderLine(m,IFC.FILE_NAME),units:project.UnitsInContext,counts,storeys,rendered:rendered.size,parts,triangles,min,max,dimensions:max.map((v,i)=>v-min[i]),coordination:api.GetCoordinationMatrix(m),diagnostics,empty,sample,seconds:(Date.now()-start)/1000};
 fs.mkdirSync('evidence',{recursive:true});fs.writeFileSync('evidence/ifc-audit.json',JSON.stringify(output,null,2));console.log(JSON.stringify({...output,storeys:storeys.map(s=>({id:s.expressID,name:s.Name?.value,elevation:s.Elevation?.value})),sample:undefined},null,2)); api.CloseModel(m);
})();
