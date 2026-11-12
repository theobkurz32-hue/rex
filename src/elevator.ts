import * as T from 'three';
import R from '@dimforge/rapier3d-compat';
import type { BimModel } from './model';
import { CHARACTER, type Physics } from './physics';
import type { Door, DoorLeaf, Doors } from './doors';
import type { Part } from './types';

type LiftState='idle'|'opening'|'closing'|'moving'|'blocked';
interface Stop {id:number;storey:number|null;label:string;y:number;u:number;v:number;door:Door;button:T.Vector3;}
interface ClipVertex {p:T.Vector3;n:T.Vector3;}
export interface ElevatorTarget {key:string;id:number;point:T.Vector3;label:string;reach:number;allowIds?:number[];}

/** Operational cabin fitted to the existing IFC lift landings. The original IFC
 * remains unchanged: only scene instances crossing the explicitly mapped shaft
 * receive an opening, and every other triangle is retained. */
export class Elevator {
  root=new T.Group();
  private model!:BimModel;private doors!:Doors;private physics:Physics|null=null;
  private stops:Stop[]=[];private currentIndex=0;private destinationIndex=0;private state:LiftState='idle';
  private doorProgress=0;private doorTarget=0;private travelRequested=false;private panelOpen=false;
  private basis=new T.Matrix4();private rotation=new T.Quaternion();private axis=new T.Vector3(1,0,0);private normal=new T.Vector3(0,0,1);
  private u=0;private front=0;private width=1.34;private depth=1.74;private height=2.08;private y=0;private speed=0;
  private cabin=new T.Group();private cabinDoors:T.Mesh[]=[];private body:R.RigidBody|null=null;private leafBodies:R.RigidBody[]=[];private leafColliders:R.Collider[]=[];
  private colliders=new Set<R.Collider>();private geometries=new Set<T.BufferGeometry>();private materials=new Set<T.Material>();
  private cutKeys:number[]=[];private originalParts:{part:Part;replacements:Part[]}[]=[];private key=-2000000;
  private adaptation={cutElements:[] as number[],cutParts:0,intersectedTriangles:0,removedTriangles:0,shaftBounds:[] as number[],sourceLandings:[] as number[],operationalCabin:true};
  private status='Elevador pronto';private lastRiding=false;private controllerLimited=false;

  get available(){return this.stops.length>1;}
  get snapshot(){return {available:this.available,state:this.state,current:this.stops[this.currentIndex]?.id??null,destination:this.stops[this.destinationIndex]?.id??null,y:this.y,doorProgress:this.doorProgress,inside:this.inside(),riding:this.lastRiding,cabinCenter:this.center().toArray(),insideBounds:this.insideBounds(),stops:this.stops.map(s=>({id:s.id,storey:s.storey,label:s.label,y:s.y})),adaptation:this.adaptation,status:this.status};}
  get panel(){return {visible:this.panelOpen&&this.inside(),floors:this.stops.map(s=>({id:s.id,label:s.label})),current:this.stops[this.currentIndex]?.id??null,moving:this.state==='moving'||this.state==='closing',status:this.status};}
  closePanel(){this.panelOpen=false;}

  prepare(model:BimModel,doors:Doors){
    this.dispose();this.model=model;this.doors=doors;this.key=-2000000;
    const candidates=[...model.elements.values()].filter(e=>/lift assembly|elevador|elevator/i.test(e.name??''));
    for(const e of candidates){
      const parts=model.byElement.get(e.id)??[],boxes=new Map(parts.map(p=>[p,this.partBounds(p)]));
      const panels=parts.filter(p=>{const s=boxes.get(p)!.getSize(new T.Vector3());return s.y>1.8&&s.y<2.5&&Math.min(s.x,s.z)<.11&&Math.max(s.x,s.z)>.30&&Math.max(s.x,s.z)<.7;});
      if(panels.length!==2)continue;
      if(!this.stops.length){const size=boxes.get(panels[0])!.getSize(new T.Vector3());this.axis.set(size.x>size.z?1:0,0,size.x>size.z?0:1);this.normal.crossVectors(this.axis,new T.Vector3(0,1,0));this.basis.makeBasis(this.axis,new T.Vector3(0,1,0),this.normal);this.rotation.setFromRotationMatrix(this.basis);}
      const b=new T.Box3();panels.forEach(p=>b.union(boxes.get(p)!));const c=b.getCenter(new T.Vector3()),u=c.dot(this.axis),v=c.dot(this.normal);
      // Reject unrelated shafts rather than joining them across the building.
      if(this.stops.length&&(Math.abs(u-this.stops[0].u)>.35||Math.abs(v-this.stops[0].v)>.15))continue;
      const leaves:DoorLeaf[]=panels.sort((a,b)=>boxes.get(a)!.getCenter(new T.Vector3()).dot(this.axis)-boxes.get(b)!.getCenter(new T.Vector3()).dot(this.axis)).map((p,i)=>({parts:[p],originals:[new T.Matrix4().fromArray(p.matrix)],pivot:boxes.get(p)!.getCenter(new T.Vector3()),slide:this.axis.clone().multiplyScalar(i? .43:-.43),angle:0}));
      const door:Door={id:e.id,kind:'slide',category:'elevator',leaves,normal:this.normal.clone(),center:c,progress:0,target:0,blocked:false};
      doors.items.set(e.id,door);leaves.forEach(l=>l.parts.forEach(p=>doors.moving.set(p,l)));
      const button=parts.map(p=>boxes.get(p)!).filter(b=>b.getSize(new T.Vector3()).y<.4).sort((a,b)=>b.getSize(new T.Vector3()).y-a.getSize(new T.Vector3()).y)[0]?.getCenter(new T.Vector3())??c.clone();
      this.stops.push({id:e.id,storey:e.storey,label:'',y:b.min.y+.03,u,v,door,button});
    }
    this.stops.sort((a,b)=>a.y-b.y);this.stops.forEach((s,i)=>s.label=model.meta.levels.find(l=>l.id===s.storey)?.name??(i===0?'Térreo':`${i}º andar`));
    if(!this.available)return;
    this.u=this.stops.reduce((n,s)=>n+s.u,0)/this.stops.length;this.front=this.stops.reduce((n,s)=>n+s.v,0)/this.stops.length-.07;
    this.y=this.stops[0].y;this.currentIndex=this.destinationIndex=0;this.adaptation.sourceLandings=this.stops.map(s=>s.id);
    const shaft=new T.Box3();
    for(const u of [this.u-this.width/2-.045,this.u+this.width/2+.045])for(const v of [this.front-this.depth-.045,this.front+.11])for(const y of [this.stops[0].y-.18,this.stops[this.stops.length-1].y+this.height+.08])shaft.expandByPoint(this.axis.clone().multiplyScalar(u).addScaledVector(this.normal,v).setY(y));
    this.adaptation.shaftBounds=[...shaft.min.toArray(),...shaft.max.toArray()];this.cutShaft(shaft);this.buildCabin();this.placeCabin();
  }

  private partBounds(p:Part){const g=this.model.geometry.get(p.key)!,b=new T.Box3(),m=new T.Matrix4().fromArray(p.matrix),v=new T.Vector3(),a=g.getAttribute('position');for(let i=0;i<a.count;i++)b.expandByPoint(v.fromBufferAttribute(a,i).applyMatrix4(m));return b;}
  private center(){return this.axis.clone().multiplyScalar(this.u).addScaledVector(this.normal,this.front-this.depth/2).setY(this.y);}
  private local(point:T.Vector3){return new T.Vector3(point.dot(this.axis)-this.u,point.y-this.y,point.dot(this.normal)-(this.front-this.depth/2));}
  private insideBounds(){const c=this.center();return {center:c.toArray(),halfWidth:this.width/2-.07,halfDepth:this.depth/2-.07,floor:this.y,height:this.height};}
  private inside(full=false){if(!this.physics?.active||!this.available)return false;const p=this.local(this.physics.feet()),margin=full?(this.physics.capsule.shape as R.Capsule).radius+.025:.025;return Math.abs(p.x)<this.width/2-margin&&Math.abs(p.z)<this.depth/2-margin&&p.y>-.16&&p.y<(full?.34:this.height-.2);}

  /** Exact triangle subtraction, retaining fragments outside the shaft rectangle. */
  private cutShaft(shaft:T.Box3){
    const changed=new Set<number>();
    for(const p of [...this.model.parts]){
      const e=this.model.elements.get(p.id);if(!/IfcSlab|IfcCovering/.test(e?.type??''))continue;
      const b=this.partBounds(p);if(!b.intersectsBox(shaft))continue;
      const g=this.model.geometry.get(p.key)!,position=g.getAttribute('position'),normal=g.getAttribute('normal'),ix=g.getIndex()!,matrix=new T.Matrix4().fromArray(p.matrix),normalMatrix=new T.Matrix3().getNormalMatrix(matrix),flip=matrix.determinant()<0;
      const vertices:number[]=[],normals:number[]=[],indices:number[]=[];let touched=0,fullyRemoved=0;
      const push=(polygon:ClipVertex[])=>{for(let j=1;j<polygon.length-1;j++){const tri=[polygon[0],polygon[j],polygon[j+1]],base=vertices.length/3;for(const v of tri){vertices.push(v.p.x,v.p.y,v.p.z);normals.push(v.n.x,v.n.y,v.n.z);}indices.push(base,base+1,base+2);}};
      for(let i=0;i<ix.count;i+=3){
        const triangle=[0,flip?2:1,flip?1:2].map(j=>{const index=ix.getX(i+j);return {p:new T.Vector3().fromBufferAttribute(position,index).applyMatrix4(matrix),n:new T.Vector3().fromBufferAttribute(normal,index).applyNormalMatrix(normalMatrix)};});
        const tb=new T.Box3().setFromPoints(triangle.map(v=>v.p));if(!tb.intersectsBox(shaft)){push(triangle);continue;}
        let remaining=triangle;const outside:ClipVertex[][]=[];
        for(const [axis,bound,sign] of [['x',shaft.min.x,1],['x',shaft.max.x,-1],['z',shaft.min.z,1],['z',shaft.max.z,-1]] as const){
          if(!remaining.length)break;const inside:ClipVertex[]=[],out:ClipVertex[]=[];
          for(let j=0;j<remaining.length;j++){
            const a=remaining[j],b=remaining[(j+1)%remaining.length],da=(a.p[axis]-bound)*sign,db=(b.p[axis]-bound)*sign,ai=da>=-1e-8,bi=db>=-1e-8;
            (ai?inside:out).push(a);
            if(ai!==bi){const t=da/(da-db),v={p:a.p.clone().lerp(b.p,t),n:a.n.clone().lerp(b.n,t).normalize()};inside.push(v);out.push(v);}
          }
          if(out.length>=3)outside.push(out);remaining=inside;
        }
        if(remaining.length>=3){touched++;if(!outside.length)fullyRemoved++;}
        outside.forEach(push);
      }
      if(!touched)continue;
      const replacements:Part[]=[];
      if(indices.length){const geometry=new T.BufferGeometry();geometry.setAttribute('position',new T.Float32BufferAttribute(vertices,3));geometry.setAttribute('normal',new T.Float32BufferAttribute(normals,3));geometry.setIndex(indices);geometry.computeBoundingBox();geometry.computeBoundingSphere();const key=this.key--;this.model.geometry.set(key,geometry);this.cutKeys.push(key);replacements.push({...p,key,matrix:new T.Matrix4().toArray()});}
      const at=this.model.parts.indexOf(p);this.model.parts.splice(at,1,...replacements);const owned=this.model.byElement.get(p.id)!;owned.splice(owned.indexOf(p),1,...replacements);this.originalParts.push({part:p,replacements});
      this.adaptation.cutParts++;this.adaptation.intersectedTriangles+=touched;this.adaptation.removedTriangles+=fullyRemoved;changed.add(p.id);
    }
    this.adaptation.cutElements=[...changed];
  }

  private material(parameters:T.MeshStandardMaterialParameters){const m=new T.MeshStandardMaterial(parameters);this.materials.add(m);return m;}
  private box(size:number[],position:number[],material:T.Material,parent=this.cabin){const geometry=new T.BoxGeometry(...size as [number,number,number]);this.geometries.add(geometry);const mesh=new T.Mesh(geometry,material);mesh.position.fromArray(position);parent.add(mesh);return mesh;}
  private buildCabin(){
    this.root.add(this.cabin);this.cabin.quaternion.copy(this.rotation);
    const metal=this.material({color:'#cec9bc',roughness:.45,metalness:.62}),dark=this.material({color:'#303b3d',roughness:.82}),gold=this.material({color:'#ad8751',metalness:.65,roughness:.4}),light=this.material({color:'#fff0d4',emissive:'#fff0d4',emissiveIntensity:1.25,roughness:.8});
    this.box([this.width,.08,this.depth],[0,-.04,0],dark);this.box([this.width,.04,this.depth],[0,this.height,0],metal);
    this.box([.04,this.height,this.depth],[-this.width/2,this.height/2,0],metal);this.box([.04,this.height,this.depth],[this.width/2,this.height/2,0],metal);this.box([this.width,this.height,.04],[0,this.height/2,-this.depth/2],metal);
    for(const x of [-1,1]){this.box([.22,this.height,.045],[x*(this.width/2-.11),this.height/2,this.depth/2],metal);this.box([.018,.025,this.depth*.8],[x*(this.width/2-.045),1.03,-.04],gold);}
    this.box([this.width*.8,.015,.05],[0,this.height-.04,-this.depth*.32],light);this.box([this.width*.8,.015,.05],[0,this.height-.04,this.depth*.32],light);
    this.cabinDoors=[this.box([.42,2.02,.035],[-.21,1.01,this.depth/2-.02],metal),this.box([.42,2.02,.035],[.21,1.01,this.depth/2-.02],metal)];
    this.box([.015,.30,.17],[this.width/2-.035,1.18,this.depth/2-.25],dark);this.box([.018,.045,.07],[this.width/2-.047,1.19,this.depth/2-.25],gold);
  }

  bind(physics:Physics){
    this.physics=physics;if(!this.available)return;
    // Parked support is fixed: Rapier's character controller can otherwise
    // repeatedly hit the lip of a stationary kinematic floor. Travel switches
    // it to a position-based kinematic body and carries the rider incrementally.
    this.body=physics.world.createRigidBody(R.RigidBodyDesc.fixed().setTranslation(...this.center().toArray() as [number,number,number]).setRotation(this.rotation));
    const add=(x:number,y:number,z:number,hx:number,hy:number,hz:number)=>{const c=physics.world.createCollider(R.ColliderDesc.cuboid(hx,hy,hz).setTranslation(x,y,z).setFriction(.8),this.body!);this.colliders.add(c);physics.colliderElement.set(c.handle,this.stops[0].id);};
    const floorGeometry=new T.BoxGeometry(this.width,.08,this.depth),floor=physics.world.createCollider(R.ColliderDesc.trimesh(new Float32Array(floorGeometry.getAttribute('position').array),new Uint32Array(floorGeometry.getIndex()!.array)).setTranslation(0,-.04,0).setFriction(.8),this.body);this.colliders.add(floor);physics.colliderElement.set(floor.handle,this.stops[0].id);floorGeometry.dispose();
    add(0,this.height,0,this.width/2,.02,this.depth/2);add(-this.width/2,this.height/2,0,.02,this.height/2,this.depth/2);add(this.width/2,this.height/2,0,.02,this.height/2,this.depth/2);add(0,this.height/2,-this.depth/2,this.width/2,this.height/2,.02);
    add(-this.width/2+.11,this.height/2,this.depth/2,.11,this.height/2,.0225);add(this.width/2-.11,this.height/2,this.depth/2,.11,this.height/2,.0225);
    for(let i=0;i<2;i++){const p=this.center().add(this.axis.clone().multiplyScalar(i?.21:-.21)).addScaledVector(this.normal,this.depth/2-.02).add(new T.Vector3(0,1.01,0)),body=physics.world.createRigidBody(R.RigidBodyDesc.kinematicPositionBased().setTranslation(...p.toArray() as [number,number,number]).setRotation(this.rotation)),collider=physics.world.createCollider(R.ColliderDesc.cuboid(.21,1.01,.0175),body);this.leafBodies.push(body);this.leafColliders.push(collider);this.colliders.add(collider);physics.colliderElement.set(collider.handle,this.stops[0].id);}
    physics.world.propagateModifiedBodyPositionsToColliders();
  }

  target(camera:T.Camera):ElevatorTarget|null {
    if(!this.available||!this.physics?.active||this.model.inspection())return null;
    camera.updateMatrixWorld(true);const eye=camera.getWorldPosition(new T.Vector3()),look=camera.getWorldDirection(new T.Vector3());
    if(this.inside()){
      const point=this.center().addScaledVector(this.axis,this.width/2-.06).addScaledVector(this.normal,this.depth/2-.25).add(new T.Vector3(0,1.2,0)),d=point.clone().sub(eye);
      if(d.length()<1.65&&d.normalize().dot(look)>.15)return {key:'panel',id:this.stops[this.currentIndex].id,point,label:this.state==='moving'?'Elevador em movimento':'Escolher andar',reach:1.65,allowIds:this.stops.map(s=>s.id)};
      return null;
    }
    let result:ElevatorTarget|null=null,best=Infinity;
    for(const s of this.stops){const point=s.door.center.clone();point.y=T.MathUtils.clamp(eye.y,s.y+.25,s.y+1.85);const d=point.clone().sub(eye),distance=d.length();if(distance>1.7||distance>=best||d.normalize().dot(look)<.5)continue;best=distance;const here=s.id===this.stops[this.currentIndex].id&&Math.abs(this.y-s.y)<.015;result={key:`call:${s.id}`,id:s.id,point,label:here&&this.doorProgress>.6?'Fechar elevador':'Chamar / abrir elevador',reach:1.7};}
    return result;
  }
  interact(key:string){if(key==='panel'){if(!this.inside())return false;this.panelOpen=true;return true;}if(key.startsWith('call:'))return this.call(Number(key.slice(5)));return false;}
  call(id:number){const i=this.stops.findIndex(s=>s.id===id);if(i<0||!this.physics||this.state==='moving')return false;this.panelOpen=false;
    if(i===this.currentIndex&&Math.abs(this.y-this.stops[i].y)<.015){this.travelRequested=false;this.doorTarget=this.doorProgress>.5?0:1;this.state=this.doorTarget?'opening':'closing';this.status=this.doorTarget?'Abrindo portas':'Fechando portas';return true;}
    if(this.inside()){this.status='Use o painel da cabine para escolher o andar';return false;}
    this.destinationIndex=i;this.travelRequested=true;this.doorTarget=0;this.state='closing';this.status=`Elevador a caminho de ${this.stops[i].label}`;return true;
  }
  selectFloor(id:number){const i=this.stops.findIndex(s=>s.id===id);if(i<0||!this.physics||!this.inside(true)||this.state==='moving'){this.status='Entre completamente na cabine para viajar';return false;}this.panelOpen=false;this.destinationIndex=i;this.travelRequested=Math.abs(this.y-this.stops[i].y)>.015;this.doorTarget=this.travelRequested?0:1;this.state=this.travelRequested?'closing':'opening';this.status=this.travelRequested?`Fechando portas · ${this.stops[i].label}`:'Abrindo portas';return true;}

  private placeCabin(){this.cabin.position.copy(this.center());this.cabinDoors.forEach((door,i)=>door.position.x=(i?1:-1)*(.21+.43*this.doorProgress));if(!this.physics||!this.body)return;const p=this.center();this.body.setTranslation(p,true);this.body.setNextKinematicTranslation(p);
    this.leafBodies.forEach((body,i)=>{const position=p.clone().addScaledVector(this.axis,(i?1:-1)*(.21+.43*this.doorProgress)).addScaledVector(this.normal,this.depth/2-.02).add(new T.Vector3(0,1.01,0));body.setTranslation(position,true);body.setNextKinematicTranslation(position);});this.physics.world.propagateModifiedBodyPositionsToColliders();}
  private advanceDoors(dt:number){
    const stop=this.stops[this.currentIndex],next=T.MathUtils.clamp(this.doorProgress+Math.sign(this.doorTarget-this.doorProgress)*dt/.7,0,1);if(next===this.doorProgress)return true;
    const transforms=stop.door.leaves.map(l=>this.doors.transform(l,next));
    for(let i=0;i<this.leafColliders.length;i++){const position=this.center().addScaledVector(this.axis,(i?1:-1)*(.21+.43*next)).addScaledVector(this.normal,this.depth/2-.02).add(new T.Vector3(0,1.01,0));if(this.physics!.active&&this.leafColliders[i].shape.intersectsShape(position,this.rotation,this.physics!.capsule.shape,this.physics!.capsule.translation(),this.physics!.capsule.rotation())){this.doorTarget=1;this.travelRequested=false;this.state='opening';this.status='Afaste-se das portas para fechar';return false;}}
    if(!this.physics!.moveDoor(stop.door.leaves,transforms)){this.doorTarget=1;this.travelRequested=false;this.state='opening';this.status='Passagem ocupada · portas reabrindo';return false;}
    stop.door.leaves.forEach((leaf,i)=>leaf.parts.forEach((part,j)=>this.model.setPartMatrix(part,transforms[i].clone().multiply(leaf.originals[j]))));
    this.doorProgress=next;stop.door.progress=stop.door.target=next;this.model.finishMovingParts(new Set([stop.id]));this.placeCabin();return true;
  }
  update(dt:number,active=true){
    if(!this.available||!this.physics?.ready)return;this.root.visible=!this.model.inspection();if(this.state==='moving'&&this.inside())this.limitController();else this.restoreController();if(!active)return;dt=Math.min(Math.max(0,dt),.05);this.lastRiding=false;
    if(this.doorProgress!==this.doorTarget){this.advanceDoors(dt);return;}
    if(this.state==='opening'){this.state='idle';this.status=`${this.stops[this.currentIndex].label} · portas abertas`;}
    if(this.state==='closing'){
      if(this.travelRequested){if(this.doorProgress!==0)return;this.state='moving';this.body?.setBodyType(R.RigidBodyType.KinematicPositionBased,true);this.speed=0;this.status=`${this.stops[this.destinationIndex].y>this.y?'Subindo':'Descendo'} · ${this.stops[this.destinationIndex].label}`;}
      else{this.state='idle';this.status='Portas fechadas';}
    }
    if(this.state!=='moving')return;
    const destination=this.stops[this.destinationIndex].y,distance=destination-this.y;
    if(Math.abs(distance)<.001){this.y=destination;this.restoreController();this.body?.setBodyType(R.RigidBodyType.Fixed,true);this.currentIndex=this.destinationIndex;this.travelRequested=false;this.state='opening';this.doorTarget=1;this.speed=0;this.status=`Chegou: ${this.stops[this.currentIndex].label}`;this.placeCabin();return;}
    const riding=this.inside();if(riding)this.limitController();else this.restoreController();this.speed=Math.min(1.3,this.speed+1.1*dt,Math.sqrt(2*1.1*Math.abs(distance)));const dy=Math.sign(distance)*Math.min(Math.abs(distance),this.speed*dt),delta=new T.Vector3(0,dy,0);
    if(riding&&!this.physics.carry(delta,this.colliders)){this.state='blocked';this.restoreController();this.body?.setBodyType(R.RigidBodyType.Fixed,true);this.speed=0;this.status='Movimento interrompido por uma obstrução';return;}
    this.y+=dy;this.lastRiding=riding;this.placeCabin();
  }
  private limitController(){if(!this.controllerLimited&&this.physics?.ready){this.physics.controller.disableAutostep();this.physics.controller.disableSnapToGround();this.controllerLimited=true;}}
  private restoreController(){if(this.controllerLimited&&this.physics?.ready){this.physics.controller.enableAutostep(CHARACTER.step,.23,false);this.physics.controller.enableSnapToGround(CHARACTER.snap);}this.controllerLimited=false;}
  dispose(){
    this.restoreController();
    if(this.physics?.ready){for(const c of this.colliders)this.physics.colliderElement.delete(c.handle);if(this.body)this.physics.world.removeRigidBody(this.body);for(const b of this.leafBodies)this.physics.world.removeRigidBody(b);}
    if(this.doors)for(const s of this.stops){this.doors.items.delete(s.id);for(const leaf of s.door.leaves)leaf.parts.forEach(p=>this.doors.moving.delete(p));}
    if(this.model){for(const item of this.originalParts){for(const p of item.replacements){const at=this.model.parts.indexOf(p);if(at>=0)this.model.parts.splice(at,1);}this.model.parts.push(item.part);const owned=this.model.byElement.get(item.part.id);if(owned){for(const p of item.replacements){const at=owned.indexOf(p);if(at>=0)owned.splice(at,1);}owned.push(item.part);}}for(const key of this.cutKeys){this.model.geometry.get(key)?.dispose();this.model.geometry.delete(key);}}
    for(const g of this.geometries)g.dispose();for(const m of this.materials)m.dispose();this.root.clear();this.cabin=new T.Group();this.cabinDoors=[];this.stops=[];this.physics=null;this.body=null;this.leafBodies=[];this.leafColliders=[];this.colliders.clear();this.geometries.clear();this.materials.clear();this.cutKeys=[];this.originalParts=[];this.doorProgress=this.doorTarget=0;this.travelRequested=false;this.panelOpen=false;this.state='idle';this.lastRiding=false;this.adaptation={cutElements:[],cutParts:0,intersectedTriangles:0,removedTriangles:0,shaftBounds:[],sourceLandings:[],operationalCabin:true};
  }
}
