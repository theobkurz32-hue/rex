import RAPIER from '@dimforge/rapier3d-compat';
import * as T from 'three';
import { BimModel, breathe } from './model';
import type { Doors, DoorLeaf } from './doors';
import {canSimplifyCollider,furnitureColliderGeometry} from './collision-detail';
export const CHARACTER={height:1.75,eye:1.65,radius:.25,crouchHeight:1.1,crouchEye:1,walk:1.4,run:3,gravity:9.81,step:.26,snap:.3};
export class Physics {
  world!:RAPIER.World;controller!:RAPIER.KinematicCharacterController;body!:RAPIER.RigidBody;capsule!:RAPIER.Collider;
  colliderElement=new Map<number,number>();ready=false;active=false;crouched=false;grounded=false;vy=0;safe=new T.Vector3();safeLevel:number|null=null;height=CHARACTER.height;collisions=0;
  actors=new Set<RAPIER.Collider>();
  colliderStats={sourceTriangles:0,collisionTriangles:0,simplifiedParts:0};
  private doorBodies=new Map<DoorLeaf,{body:RAPIER.RigidBody;collider:RAPIER.Collider}>();
  async init(model:BimModel,progress:(n:number,total:number)=>void,doors?:Doors,options={lightweightFurniture:false}){
    await RAPIER.init();this.world=new RAPIER.World({x:0,y:-CHARACTER.gravity,z:0});this.world.timestep=1/60;
    this.colliderStats={sourceTriangles:0,collisionTriangles:0,simplifiedParts:0};const proxies=new Map<T.BufferGeometry,T.BufferGeometry>();
    let n=0;for(const [id,allParts] of model.byElement){
      const parts=allParts.filter(p=>!doors?.moving.has(p)).map(p=>{
        const source=model.geometry.get(p.key)!;let geometry=source;this.colliderStats.sourceTriangles+=source.getIndex()!.count/3;
        if(options.lightweightFurniture&&canSimplifyCollider(model.elements.get(id),source)){if(!proxies.has(source))proxies.set(source,furnitureColliderGeometry(source));geometry=proxies.get(source)!;this.colliderStats.simplifiedParts++;}
        this.colliderStats.collisionTriangles+=geometry.getIndex()!.count/3;return {part:p,geometry};
      });
      let nv=0,ni=0;for(const {geometry:g} of parts){nv+=g.getAttribute('position').count;ni+=g.getIndex()!.count;}
      if(!ni)continue;const positions=new Float32Array(nv*3),indices=new Uint32Array(ni);let vi=0,ii=0;const v=new T.Vector3();
      for(const {part:p,geometry:g} of parts){const a=g.getAttribute('position'),ix=g.getIndex()!,m=new T.Matrix4().fromArray(p.matrix);for(let i=0;i<a.count;i++){v.fromBufferAttribute(a,i).applyMatrix4(m);v.toArray(positions,(vi+i)*3);}const flip=m.determinant()<0;for(let i=0;i<ix.count;i+=3){indices[ii++]=ix.getX(i)+vi;indices[ii++]=ix.getX(i+(flip?2:1))+vi;indices[ii++]=ix.getX(i+(flip?1:2))+vi;}vi+=a.count;}
      const collider=this.world.createCollider(RAPIER.ColliderDesc.trimesh(positions,indices).setFriction(.7));this.colliderElement.set(collider.handle,id);
      if(++n%12===0){progress(n,model.byElement.size);await breathe();}
    }
    if(doors)for(const door of doors.items.values())for(const leaf of door.leaves){
      const vertices:number[]=[],indices:number[]=[];
      for(let j=0;j<leaf.parts.length;j++){
        const p=leaf.parts[j],g=model.geometry.get(p.key)!,a=g.getAttribute('position'),ix=g.getIndex()!,offset=vertices.length/3,m=leaf.originals[j];
        this.colliderStats.sourceTriangles+=ix.count/3;this.colliderStats.collisionTriangles+=ix.count/3;
        for(let i=0;i<a.count;i++){const v=new T.Vector3().fromBufferAttribute(a,i).applyMatrix4(m).sub(leaf.pivot);vertices.push(v.x,v.y,v.z);}
        const flip=m.determinant()<0;
        for(let i=0;i<ix.count;i+=3)indices.push(ix.getX(i)+offset,ix.getX(i+(flip?2:1))+offset,ix.getX(i+(flip?1:2))+offset);
      }
      const body=this.world.createRigidBody(RAPIER.RigidBodyDesc.kinematicPositionBased().setTranslation(leaf.pivot.x,leaf.pivot.y,leaf.pivot.z));
      const collider=this.world.createCollider(RAPIER.ColliderDesc.trimesh(new Float32Array(vertices),new Uint32Array(indices)).setFriction(.7),body);
      this.doorBodies.set(leaf,{body,collider});this.colliderElement.set(collider.handle,door.id);
    }
    this.body=this.world.createRigidBody(RAPIER.RigidBodyDesc.kinematicPositionBased().setTranslation(0,-10000,0));
    this.capsule=this.world.createCollider(RAPIER.ColliderDesc.capsule((this.height-2*CHARACTER.radius)/2,CHARACTER.radius),this.body);
    this.controller=this.world.createCharacterController(.015);this.controller.enableAutostep(CHARACTER.step,.23,false);this.controller.enableSnapToGround(CHARACTER.snap);this.controller.setMaxSlopeClimbAngle(Math.PI/4);this.controller.setMinSlopeSlideAngle(Math.PI/3);this.controller.setSlideEnabled(true);
    for(const geometry of proxies.values())geometry.dispose();this.world.step();this.capsule.setEnabled(false);this.ready=true;
  }
  doorHit(origin:T.Vector3,direction:T.Vector3,reach:number){
    if(!this.ready)return null;
    const hit=this.world.castRay(new RAPIER.Ray(origin,direction),reach,true,undefined,undefined,this.capsule,this.body);
    return hit?this.colliderElement.get(hit.collider.handle)??null:null;
  }
  trace(origin:T.Vector3,direction:T.Vector3,reach:number){
    if(!this.ready)return null;
    const hit=this.world.castRay(new RAPIER.Ray(origin,direction),reach,true,undefined,undefined,this.capsule,this.body);
    if(!hit)return null;const id=this.colliderElement.get(hit.collider.handle);
    return id==null?null:{id,distance:hit.timeOfImpact,point:origin.clone().addScaledVector(direction,hit.timeOfImpact)};
  }
  moveDoor(leaves:DoorLeaf[],transforms:T.Matrix4[]){
    const poses=leaves.map((leaf,i)=>({entry:this.doorBodies.get(leaf)!,position:leaf.pivot.clone().applyMatrix4(transforms[i]),rotation:new T.Quaternion().setFromRotationMatrix(transforms[i])}));
    for(const {entry,position,rotation} of poses){
      if(this.active&&entry.collider.shape.intersectsShape(position,rotation,this.capsule.shape,this.capsule.translation(),this.capsule.rotation()))return false;
      for(const actor of this.actors)if(actor.isEnabled()&&entry.collider.shape.intersectsShape(position,rotation,actor.shape,actor.translation(),actor.rotation()))return false;
    }
    for(const {entry,position,rotation} of poses){entry.body.setTranslation(position,true);entry.body.setRotation(rotation,true);entry.body.setNextKinematicTranslation(position);entry.body.setNextKinematicRotation(rotation);}
    this.world.propagateModifiedBodyPositionsToColliders();
    return true;
  }
  clearAt(feet:T.Vector3,height=CHARACTER.height){const center={x:feet.x,y:feet.y+height/2+.025,z:feet.z};return !this.world.intersectionWithShape(center,{x:0,y:0,z:0,w:1},new RAPIER.Capsule((height-2*CHARACTER.radius)/2,CHARACTER.radius),undefined,undefined,this.capsule,this.body);}
  supportAt(x:number,z:number,top:number,bottom:number,storey:number|null,model:BimModel){
    const ray=new RAPIER.Ray({x,y:top,z},{x:0,y:-1,z:0}),hits:RAPIER.RayColliderIntersection[]=[];
    this.world.intersectionsWithRay(ray,top-bottom,false,h=>{hits.push(h);return true;},undefined,undefined,this.capsule,this.body);
    hits.sort((a,b)=>a.timeOfImpact-b.timeOfImpact);
    for(const h of hits){if(h.normal.y<.7)continue;const element=this.colliderElement.get(h.collider.handle);const type=element?model.elements.get(element)?.type:'';if(!/Slab|Stair|Ramp|Footing|Covering|BuildingElementProxy/.test(type??''))continue;if(storey!=null&&model.elements.get(element!)?.storey!==storey)continue;
      const feet=new T.Vector3(x,top-h.timeOfImpact+.03,z);
      if(!this.clearAt(feet))continue;
      // Five contacts prevent spawning balanced on an edge or inside an opening.
      let supported=true;for(const [dx,dz] of [[.18,0],[-.18,0],[0,.18],[0,-.18]]){const r=new RAPIER.Ray({x:x+dx,y:feet.y+.05,z:z+dz},{x:0,y:-1,z:0});const v=this.world.castRayAndGetNormal(r,.2,false,undefined,undefined,this.capsule,this.body);if(!v||v.normal.y<.65){supported=false;break;}}
      if(supported)return feet;
    }return null;
  }
  async findEntry(model:BimModel,level:number|null,near?:T.Vector3){
    if(!this.ready)return null;
    if(near){const f=this.supportAt(near.x,near.z,near.y+.15,near.y-2.5,level,model);if(f)return f;}
    const candidates=[...model.byElement.keys()].filter(id=>{const e=model.elements.get(id);return (level==null||e?.storey===level)&&/Slab|StairFlight|Ramp/.test(e?.type??'');});
    candidates.sort((a,b)=>{const aa=model.elementBounds(a).getSize(new T.Vector3()),bb=model.elementBounds(b).getSize(new T.Vector3());return bb.x*bb.z-aa.x*aa.z;});
    let tries=0;for(const id of candidates){const b=model.elementBounds(id);for(const [u,v] of [[.5,.5],[.3,.3],[.7,.7],[.3,.7],[.7,.3],[.15,.5],[.85,.5],[.5,.15],[.5,.85]]){const p=this.supportAt(T.MathUtils.lerp(b.min.x,b.max.x,u),T.MathUtils.lerp(b.min.z,b.max.z,v),b.max.y+.2,b.min.y-.15,level,model);if(p)return p;if(++tries%30===0)await breathe();}}
    return null;
  }
  teleport(feet:T.Vector3,level:number|null){if(!this.clearAt(feet))return false;this.height=CHARACTER.height;this.crouched=false;this.capsule.setShape(new RAPIER.Capsule((this.height-2*CHARACTER.radius)/2,CHARACTER.radius));this.capsule.setEnabled(true);this.body.setTranslation({x:feet.x,y:feet.y+this.height/2,z:feet.z},true);this.body.setNextKinematicTranslation(this.body.translation());this.world.step();this.safe.copy(feet);this.safeLevel=level;this.vy=0;this.grounded=false;this.active=true;return true;}
  suspend(){this.active=false;if(this.capsule)this.capsule.setEnabled(false);}
  /** Move a passenger with a platform, keeping all external shaft collisions. */
  carry(delta:T.Vector3,excluded:Set<RAPIER.Collider>){
    if(!this.ready||!this.active)return false;
    const position=this.body.translation(),target={x:position.x+delta.x,y:position.y+delta.y,z:position.z+delta.z};
    const filter=(collider:RAPIER.Collider)=>collider.handle!==this.capsule.handle&&!excluded.has(collider);
    const hit=this.world.castShape(position,this.body.rotation(),delta,this.capsule.shape,.001,1,true,undefined,undefined,this.capsule,this.body,filter);
    if(hit&&hit.time_of_impact<.99)return false;
    if(this.world.intersectionWithShape(target,this.body.rotation(),this.capsule.shape,undefined,undefined,this.capsule,this.body,filter))return false;
    // Platform motion must preserve relative jump/gravity state; otherwise a
    // held jump would be re-triggered every frame by a forced grounded flag.
    this.body.setTranslation(target,true);this.body.setNextKinematicTranslation(target);this.safe.add(delta);this.world.propagateModifiedBodyPositionsToColliders();return true;
  }
  recover(){return this.teleport(this.safe,this.safeLevel);}
  feet(){const p=this.body.translation();return new T.Vector3(p.x,p.y-this.height/2,p.z);}
  crouch(wanted:boolean){if(wanted===this.crouched)return;const feet=this.feet(),h=wanted?CHARACTER.crouchHeight:CHARACTER.height;if(!wanted&&!this.clearAt(feet,h))return;this.crouched=wanted;this.height=h;this.capsule.setShape(new RAPIER.Capsule((h-2*CHARACTER.radius)/2,CHARACTER.radius));this.body.setTranslation({x:feet.x,y:feet.y+h/2,z:feet.z},true);this.body.setNextKinematicTranslation(this.body.translation());this.world.step();}
  step(dx:number,dz:number,jump:boolean,crouch:boolean,dt=1/60){if(!this.active)return;
    this.crouch(crouch);if(jump&&this.grounded)this.vy=3;this.vy=Math.max(-35,this.vy-CHARACTER.gravity*dt);
    this.controller.computeColliderMovement(this.capsule,{x:dx*dt,y:this.vy*dt,z:dz*dt},undefined,undefined,c=>c.handle!==this.capsule.handle);
    const delta=this.controller.computedMovement(),p=this.body.translation();this.body.setNextKinematicTranslation({x:p.x+delta.x,y:p.y+delta.y,z:p.z+delta.z});this.world.step();this.grounded=this.controller.computedGrounded();this.collisions=this.controller.numComputedCollisions();if(this.grounded&&this.vy<0)this.vy=0;if(this.vy>0&&delta.y<this.vy*dt*.5)this.vy=0;
    if(this.grounded&&this.clearAt(this.feet(),this.height))this.safe.copy(this.feet());
  }
  eye(){return this.feet().add(new T.Vector3(0,this.crouched?CHARACTER.crouchEye:CHARACTER.eye,0));}
  dispose(){this.ready=false;this.active=false;this.colliderElement.clear();this.doorBodies.clear();this.actors.clear();this.world?.free();}
}
