import * as T from 'three';
import { appearanceFor, createFinishMaterial } from './appearance';
import {simplifyDecorativeGeometry} from './render-detail';
import { acceleratedRaycast, computeBoundsTree, disposeBoundsTree } from 'three-mesh-bvh';
import type { GeometryData, Part, Metadata, ElementInfo } from './types';
(T.BufferGeometry.prototype as any).computeBoundsTree=computeBoundsTree;
(T.BufferGeometry.prototype as any).disposeBoundsTree=disposeBoundsTree;
T.Mesh.prototype.raycast=acceleratedRaycast;
export const breathe=()=>new Promise<void>(r=>setTimeout(r,0));
export interface RenderBatch {mesh:T.BatchedMesh; parts:Part[]; matrices:T.Matrix4[];geometryIds:Map<number,number>;}
export class BimModel {
  root=new T.Group(); selection=new T.Group(); edges=new T.Group(); bounds=new T.Box3();
  geometry=new Map<number,T.BufferGeometry>(); parts:Part[]=[]; batches:RenderBatch[]=[]; elements=new Map<number,ElementInfo>();
  byElement=new Map<number,Part[]>(); materials:T.MeshStandardMaterial[]=[]; meta!:Metadata;
  renderDetail=new Map<number,T.BufferGeometry>();lowDetail=true;detailStats={sourceTriangles:0,reducedTriangles:0,geometries:0};
  allocationStats={sourceVertices:0,sourceIndices:0,allocatedVertices:0,allocatedIndices:0};
  private mobileSafe=false;
  private partInstances=new Map<Part,{batch:RenderBatch;index:number}>();
  private movingBatches=new Set<RenderBatch>();
  private movedBox=new T.Box3();private movedSphere=new T.Sphere();
  visible=new Set<number>(); hidden=new Set<number>(); isolation:number|null=null; filterType='';filterLevel:number|null=null;clip:number|null=null;
  setMeta(meta:Metadata){this.meta=meta;for(const e of meta.elements)this.elements.set(e.id,e);}
  // Buffer capacities are a per-import decision. Never expand mobile GPU buffers
  // in response to a settings toggle after the scene is already in use.
  setMobileSafe(enabled=true){if(!this.batches.length){this.mobileSafe=enabled;if(enabled)this.lowDetail=true;}return this.mobileSafe;}
  get usesMobileBuffers(){return this.mobileSafe;}
  private renderGeometry(key:number){return (this.mobileSafe||this.lowDetail?this.renderDetail.get(key):undefined)??this.geometry.get(key)!;}
  add(definitions:GeometryData[],parts:Part[]){
    for(const d of definitions){const g=new T.BufferGeometry();const data=new T.InterleavedBuffer(d.vertices,6);g.setAttribute('position',new T.InterleavedBufferAttribute(data,3,0));g.setAttribute('normal',new T.InterleavedBufferAttribute(data,3,3));g.setIndex(new T.BufferAttribute(d.indices,1));g.computeBoundingBox();g.computeBoundingSphere();this.geometry.set(d.key,g);}
    this.parts.push(...parts);
    for(const p of parts){if(!this.byElement.has(p.id))this.byElement.set(p.id,[]);this.byElement.get(p.id)!.push(p);}
  }
  async prepareRenderDetail(){
    const candidates=new Map<number,boolean>();
    for(const p of this.parts){const e=this.elements.get(p.id),allowed=/FurnishingElement|BuildingElementProxy|FlowTerminal/.test(e?.type??'')&&!/pilar|viga|laje|parede|escada|ramp|cobert|estrutura/i.test(e?.name??'');candidates.set(p.key,(candidates.get(p.key)??true)&&allowed);}
    let n=0;for(const [key,allowed] of candidates){if(allowed){const source=this.geometry.get(key)!,reduced=simplifyDecorativeGeometry(source);if(reduced)this.renderDetail.set(key,reduced);}if(++n%80===0)await breathe();}
    for(const p of this.parts){this.detailStats.sourceTriangles+=this.geometry.get(p.key)!.getIndex()!.count/3;this.detailStats.reducedTriangles+=(this.renderDetail.get(p.key)??this.geometry.get(p.key))!.getIndex()!.count/3;}
    this.detailStats.geometries=this.renderDetail.size;
  }
  setRenderDetail(reduced:boolean){
    if(this.mobileSafe)reduced=true;
    if(this.lowDetail===reduced)return;this.lowDetail=reduced;
    for(const b of this.batches)for(const [key,id] of b.geometryIds){if(!this.renderDetail.has(key))continue;const geometry=reduced?this.renderDetail.get(key)??this.geometry.get(key)!:this.geometry.get(key)!;b.mesh.setGeometryAt(id,geometry);}
  }
  async finalize(progress:(n:number,total:number)=>void){
    if(this.mobileSafe)this.lowDetail=true;
    const groups=new Map<string,Part[]>();
    for(const p of this.parts){const key=appearanceFor(this.elements.get(p.id),p).key;if(!groups.has(key))groups.set(key,[]);groups.get(key)!.push(p);}
    const colorCache=new Map<string,T.MeshStandardMaterial>();let n=0;
    for(const allParts of groups.values()){
      // Bounded batches reuse equal IFC geometries and combine different geometries with the same material.
      const bins:Part[][]=[];let bin:Part[]=[],keys=new Set<number>(),vertices=0,indices=0;
      for(const p of allParts){const g=this.mobileSafe?this.renderGeometry(p.key):this.geometry.get(p.key);if(!g)continue;const extra=keys.has(p.key)?0:g.getAttribute('position').count;if(bin.length&&(vertices+extra>350000||bin.length>=4096)){bins.push(bin);bin=[];keys=new Set();vertices=0;indices=0;}if(!keys.has(p.key)){vertices+=g.getAttribute('position').count;indices+=g.getIndex()!.count;keys.add(p.key);}bin.push(p);}if(bin.length)bins.push(bin);
      for(const parts of bins){
      const f=appearanceFor(this.elements.get(parts[0].id),parts[0]),key=f.key;let material=colorCache.get(key);
      if(!material){material=createFinishMaterial(f);colorCache.set(key,material);this.materials.push(material);}
      const unique=[...new Set(parts.map(p=>p.key))],sourceVertices=unique.reduce((s,k)=>s+this.geometry.get(k)!.getAttribute('position').count,0),sourceIndices=unique.reduce((s,k)=>s+this.geometry.get(k)!.getIndex()!.count,0);
      const maxVertices=this.mobileSafe?unique.reduce((s,k)=>s+this.renderGeometry(k).getAttribute('position').count,0):sourceVertices,maxIndices=this.mobileSafe?unique.reduce((s,k)=>s+this.renderGeometry(k).getIndex()!.count,0):sourceIndices;
      this.allocationStats.sourceVertices+=sourceVertices;this.allocationStats.sourceIndices+=sourceIndices;this.allocationStats.allocatedVertices+=maxVertices;this.allocationStats.allocatedIndices+=maxIndices;
      const mesh=new T.BatchedMesh(parts.length,maxVertices,maxIndices,material),matrices=parts.map(p=>new T.Matrix4().fromArray(p.matrix)),geometryIds=new Map<number,number>();
      for(const k of unique){const original=this.geometry.get(k)!;const geometryId=mesh.addGeometry(this.mobileSafe?this.renderGeometry(k):original);geometryIds.set(k,geometryId);if(!this.mobileSafe&&this.lowDetail&&this.renderDetail.has(k))mesh.setGeometryAt(geometryId,this.renderDetail.get(k)!);}
      parts.forEach((p,i)=>{const instance=mesh.addInstance(geometryIds.get(p.key)!);mesh.setMatrixAt(instance,matrices[i]);this.visible.add(p.id);this.bounds.union(this.geometry.get(p.key)!.boundingBox!.clone().applyMatrix4(matrices[i]));});
      mesh.userData.batch=this.batches.length;mesh.castShadow=true;mesh.receiveShadow=true;mesh.computeBoundingSphere();this.root.add(mesh);const batch={mesh,parts,matrices,geometryIds};this.batches.push(batch);parts.forEach((p,index)=>this.partInstances.set(p,{batch,index}));
      const scratch=new T.Mesh(this.geometry.get(parts[0].key)!,material);mesh.raycast=(ray,hits)=>{for(let i=0;i<parts.length;i++){if(!mesh.getVisibleAt(i))continue;scratch.geometry=this.geometry.get(parts[i].key)!;scratch.matrixWorld.copy(matrices[i]);const found:T.Intersection[]=[];scratch.raycast(ray,found);for(const h of found){h.object=mesh;(h as any).batchId=i;hits.push(h);}}};
      await breathe();
      }
      progress(++n,groups.size);
    }
    this.root.updateMatrixWorld(true);
  }
  async buildBVH(){let n=0;for(const g of this.geometry.values()){if(g.getIndex()!.count>90)computeBoundsTree.call(g,{indirect:true});if(++n%80===0)await breathe();}}
  setPartMatrix(part:Part,matrix:T.Matrix4){
    const instance=this.partInstances.get(part);if(!instance)return;
    matrix.toArray(part.matrix);instance.batch.matrices[instance.index].copy(matrix);
    const mesh=instance.batch.mesh;mesh.setMatrixAt(instance.index,matrix);
    // Continuous interactions must not scan the whole 4096-instance batch twice
    // per frame. Conservative bounds keep every pose without a global rebuild.
    this.movedBox.copy(this.geometry.get(part.key)!.boundingBox!).applyMatrix4(matrix);
    mesh.boundingBox?.union(this.movedBox);this.movedBox.getBoundingSphere(this.movedSphere);mesh.boundingSphere?.union(this.movedSphere);
    this.movingBatches.add(instance.batch);
  }
  finishMovingParts(ids:Set<number>){
    this.movingBatches.clear();
    if(ids.has(this.selection.userData.id))for(const child of this.selection.children){const mesh=child as T.Mesh,part=mesh.userData.part as Part|undefined;if(part){mesh.matrix.fromArray(part.matrix);mesh.matrixWorldNeedsUpdate=true;}}
    // Existing edge overlays follow the same IFC part matrices.
    for(const child of this.edges.children){const part=child.userData.part as Part|undefined;if(part&&ids.has(part.id)){child.matrix.fromArray(part.matrix);child.matrixWorldNeedsUpdate=true;}}
  }
  updateVisibility(){
    this.visible.clear();
    for(const b of this.batches){b.parts.forEach((p,i)=>{const e=this.elements.get(p.id);const show=!this.hidden.has(p.id)&&(this.isolation==null||this.isolation===p.id)&&(!this.filterType||e?.type===this.filterType)&&(this.filterLevel==null||e?.storey===this.filterLevel);b.mesh.setVisibleAt(i,show);if(show)this.visible.add(p.id);});}
    this.selection.visible=this.isolation==null&&this.hidden.size===0||this.selection.userData.id&&this.visible.has(this.selection.userData.id);
    this.clearEdges();
  }
  restore(){this.hidden.clear();this.isolation=null;this.filterType='';this.filterLevel=null;this.clip=null;this.setClip(null);this.updateVisibility();}
  inspection(){return this.hidden.size>0||this.isolation!=null||!!this.filterType||this.filterLevel!=null||this.clip!=null;}
  setClip(height:number|null){this.clip=height;const planes=height==null?[]:[new T.Plane(new T.Vector3(0,-1,0),height)];for(const m of this.materials){m.clippingPlanes=planes;m.clipShadows=true;m.needsUpdate=true;}this.selection.traverse(o=>{const m=(o as T.Mesh).material as T.Material;if(m){m.clippingPlanes=planes;m.needsUpdate=true;}});}
  setTransparency(on:boolean){for(const m of this.materials){if(m.userData.original==null)m.userData.original=m.opacity;m.opacity=on?.28:m.userData.original;m.transparent=m.opacity<.99;m.depthWrite=!on&&m.opacity>=.99;m.needsUpdate=true;}}
  select(id:number|null){
    this.clearGroup(this.selection);this.selection.userData.id=id;if(id==null)return;
    for(const p of this.byElement.get(id)??[]){const g=this.geometry.get(p.key)!;const material=new T.MeshBasicMaterial({color:0xf0b766,transparent:true,opacity:.55,depthTest:true,depthWrite:false,side:T.DoubleSide,polygonOffset:true,polygonOffsetFactor:-2,polygonOffsetUnits:-2,clippingPlanes:this.clip==null?[]:[new T.Plane(new T.Vector3(0,-1,0),this.clip)]});const mesh=new T.Mesh(g,material);mesh.matrix.fromArray(p.matrix);mesh.matrixAutoUpdate=false;mesh.userData.part=p;mesh.raycast=()=>{};this.selection.add(mesh);}
  }
  elementBounds(id:number){const box=new T.Box3();for(const p of this.byElement.get(id)??[])box.union(this.geometry.get(p.key)!.boundingBox!.clone().applyMatrix4(new T.Matrix4().fromArray(p.matrix)));return box;}
  hit(ray:T.Raycaster){const hits=ray.intersectObjects(this.root.children,false);for(const h of hits){const batch=this.batches[h.object.userData.batch],id=batch?.parts[(h as any).batchId??0]?.id;if(id&&this.visible.has(id)&&(this.clip==null||h.point.y<=this.clip+.001))return {...h,id};}return null;}
  clearEdges(){this.clearGroup(this.edges,true);}
  async showEdges(){this.clearEdges();let n=0;for(const p of this.parts){if(!this.visible.has(p.id))continue;const g=new T.EdgesGeometry(this.geometry.get(p.key)!,35);const l=new T.LineSegments(g,new T.LineBasicMaterial({color:0x152735,transparent:true,opacity:.3,clippingPlanes:this.clip==null?[]:[new T.Plane(new T.Vector3(0,-1,0),this.clip)]}));l.applyMatrix4(new T.Matrix4().fromArray(p.matrix));l.matrixAutoUpdate=false;l.userData.part=p;this.edges.add(l);if(++n%180===0)await breathe();}}
  clearGroup(group:T.Group,disposeGeometry=false){for(const o of [...group.children]){group.remove(o);const a=o as T.Mesh;if(disposeGeometry)a.geometry?.dispose();if(Array.isArray(a.material))a.material.forEach(m=>m.dispose());else a.material?.dispose();}}
  dispose(){this.clearGroup(this.selection);this.clearEdges();for(const g of this.renderDetail.values())g.dispose();this.renderDetail.clear();for(const g of this.geometry.values()){disposeBoundsTree.call(g);g.dispose();}for(const b of this.batches)b.mesh.dispose();for(const m of this.materials)m.dispose();this.root.clear();this.partInstances.clear();this.movingBatches.clear();this.geometry.clear();this.parts=[];this.batches=[];this.byElement.clear();this.elements.clear();}
}
