import * as T from 'three';
import R from '@dimforge/rapier3d-compat';
import type {BimModel} from './model';
import type {Physics} from './physics';
import type {Doors,Door} from './doors';
import {Navigation,type NavNode} from './navigation';
import {CharacterArt,HumanRig,InteractionArm} from './characters';
import {Vitals,SURVIVAL} from './vitals';
export type ZombieState='waiting'|'approachingDoor'|'openingDoor'|'waitingDoor'|'exiting'|'chasing'|'attacking'|'searching'|'returning'|'reacting';
interface Zombie {
  rig:HumanRig;body:R.RigidBody;collider:R.Collider;controller:R.KinematicCharacterController;
  state:ZombieState;home:number;door:number;path:number[];pathIndex:number;think:number;timer:number;lost:number;cooldown:number;vy:number;yaw:number;last:T.Vector3;lastSeen:T.Vector3;stuck:number;attackDone:boolean;visualAge:number;blocked:Map<string,number>;
}
export class SurvivalGame {
  root=new T.Group();art=new CharacterArt();player=new HumanRig(this.art);arm=new InteractionArm(this.art);vitals=new Vitals();nav=new Navigation();
  zombies:Zombie[]=[];roomMap:{door:number;inside:number;outside:number}[]=[];
  enabled=false;preparing=false;progress=0;spawnFeet=new T.Vector3();noise=0;budget=5;generation=0;
  private model!:BimModel;private physics!:Physics;private doors!:Doors;
  private pool:HumanRig[]=[];private lastActorEnabled=true;private interaction:{door:Door;target:T.Vector3;time:number;committed:boolean}|null=null;
  private eye=new T.Vector3();private direction=new T.Vector3();private pos=new T.Vector3();private destination=new T.Vector3();
  constructor(scene:T.Scene,private camera:T.Camera){this.root.add(this.player.root,this.arm.root);scene.add(this.root);this.root.visible=false;}
  bind(model:BimModel,physics:Physics,doors:Doors){this.model=model;this.physics=physics;this.doors=doors;}
  get dead(){return this.vitals.dead;}
  async prepare(budget:number){
    if(this.preparing)return;this.budget=budget;this.enabled=true;this.vitals.reset();this.spawnFeet.copy(this.physics.feet());
    if(!this.nav.ready){const g=++this.generation;this.preparing=true;try{await this.nav.build(this.model,this.physics,this.doors,p=>this.progress=p);}finally{if(g===this.generation)this.preparing=false;}if(g!==this.generation)return;}
    this.spawn();
  }
  private los(from:T.Vector3,to:T.Vector3,exclude?:R.Collider){
    this.direction.subVectors(to,from);const distance=this.direction.length();if(distance<.02)return true;this.direction.divideScalar(distance);
    return !this.physics.world.castRay(new R.Ray(from,this.direction),Math.max(0,distance-.1),true,undefined,undefined,exclude,this.physics.body,c=>!this.physics.actors.has(c));
  }
  private releaseActors(){
    for(const z of this.zombies){this.physics.actors.delete(z.collider);this.physics.world.removeCharacterController(z.controller);this.physics.world.removeRigidBody(z.body);z.rig.root.visible=false;z.rig.reset();}
    this.zombies=[];
  }
  private spawn(){
    this.releaseActors();this.roomMap=[];const playerNode=this.nav.nearest(this.physics.feet());if(!playerNode)return;
    const candidates:{door:Door;inside:NavNode;outside:NavNode;distance:number}[]=[];
    for(const d of this.doors.items.values()){
      if(d.category==='window'||d.progress>.05||!/semi-oca|room|quarto/i.test(this.model.elements.get(d.id)?.name??''))continue;
      if(Math.abs(d.center.y-1-this.physics.feet().y)>2)continue;
      // Both sides must have real floor, enough clearance and an actual portal edge.
      const portals=this.nav.nodes.flatMap(n=>n.edges.filter(e=>e.door===d.id).map(e=>({a:n,b:this.nav.nodes[e.to]})));
      if(!portals.length)continue;
      let pair:{inside:NavNode;outside:NavNode;distance:number}|null=null;
      for(const portal of portals){
        for(const [inside,outside] of [[portal.a,portal.b],[portal.b,portal.a]]){
          const side=Math.sign(inside.position.clone().sub(d.center).dot(d.normal));
          const farther=this.nav.nearest(inside.position.clone().addScaledVector(d.normal,side*.8));
          if(!farther||farther.position.distanceTo(outside.position)<.5)continue;
          const distance=farther.position.distanceTo(this.physics.feet());if(distance<3.2||distance>18)continue;
          const target=farther.position.clone().add(new T.Vector3(0,1.35,0));
          if(this.los(this.physics.eye(),target))continue;
          const route=this.nav.path(farther,playerNode,this.doors);if(!route.length)continue;
          if(!route.some((n,i)=>i>0&&this.nav.nodes[route[i-1]].edges.some(e=>e.to===n&&e.door===d.id)))continue;
          if(!pair||distance<pair.distance)pair={inside:farther,outside,distance};
        }
      }
      if(pair)candidates.push({door:d,...pair});
    }
    candidates.sort((a,b)=>a.distance-b.distance);
    for(const c of candidates){
      if(this.zombies.length>=this.budget)break;
      if(this.zombies.some(z=>z.last.distanceTo(c.inside.position)<1.5))continue;
      this.roomMap.push({door:c.door.id,inside:c.inside.id,outside:c.outside.id});
      let rig=this.pool[this.zombies.length];if(!rig){rig=new HumanRig(this.art,true);this.pool.push(rig);this.root.add(rig.root);}rig.root.visible=true;rig.reset();
      const p=c.inside.position;rig.pose(p,0,false,0);const body=this.physics.world.createRigidBody(R.RigidBodyDesc.kinematicPositionBased().setTranslation(p.x,p.y+.825,p.z));
      const collider=this.physics.world.createCollider(R.ColliderDesc.capsule(.565,.26).setFriction(.7),body);this.physics.actors.add(collider);
      const controller=this.physics.world.createCharacterController(.02);controller.enableAutostep(.27,.2,false);controller.enableSnapToGround(.25);controller.setSlideEnabled(true);controller.setMaxSlopeClimbAngle(Math.PI/4);
      this.zombies.push({rig,body,collider,controller,state:'waiting',home:c.inside.id,door:c.door.id,path:[],pathIndex:0,think:0,timer:0,lost:0,cooldown:0,vy:0,yaw:0,last:p.clone(),lastSeen:p.clone(),stuck:0,attackDone:false,visualAge:0,blocked:new Map()});
    }
    this.physics.world.step();this.lastActorEnabled=true;
  }
  restart(){
    this.releaseActors();const active=this.physics.active;this.physics.active=false;
    for(const d of this.doors.items.values())d.target=0;
    for(let i=0;i<40;i++)this.doors.update(this.model,this.physics,1/60,()=>{});
    this.physics.active=active;this.physics.teleport(this.spawnFeet,null);this.vitals.reset();this.player.reset();this.interaction=null;this.spawn();
  }
  requestInteraction(d:Door){
    if(this.interaction||this.dead)return false;this.camera.updateMatrixWorld(true);
    this.camera.getWorldDirection(this.direction);const origin=this.camera.getWorldPosition(this.eye);
    const hit=this.physics.world.castRayAndGetNormal(new R.Ray(origin,this.direction),1,true,undefined,undefined,this.physics.capsule,this.physics.body);
    if(!hit||this.physics.colliderElement.get(hit.collider.handle)!==d.id)return false;
    const target=origin.clone().addScaledVector(this.direction,Math.max(0,hit.timeOfImpact-.06));
    const shoulder=new T.Vector3(.19,-.22,-.07).applyMatrix4(this.camera.matrixWorld),delta=target.clone().sub(shoulder),length=delta.length();
    const obstruction=this.physics.world.castShape(shoulder,{x:0,y:0,z:0,w:1},delta,new R.Ball(.035),.01,1,true,undefined,undefined,this.physics.capsule,this.physics.body);
    if(obstruction&&obstruction.time_of_impact<.9)return false;
    if(length>.87)return false;
    this.interaction={door:d,target,time:0,committed:false};return true;
  }
  private replan(z:Zombie,goal:NavNode){const start=this.nav.nearest(this.feet(z));z.path=start?this.nav.path(start,goal,this.doors,z.blocked):[];z.pathIndex=1;}
  feet(z:Zombie){const p=z.body.translation();return this.pos.set(p.x,p.y-.825,p.z);}
  step(dt:number,running:boolean,moving:boolean){
    if(this.interaction){this.interaction.time+=dt;if(this.interaction.time>=.26&&!this.interaction.committed){this.doors.toggle(this.interaction.door,this.camera.position);this.interaction.committed=true;}if(this.interaction.time>.65)this.interaction=null;}
    if(!this.enabled||this.preparing||this.dead)return;
    const player=this.physics.feet(),playerEye=this.physics.eye(),goal=this.nav.nearest(player);let danger=false;this.noise=running&&moving?9:moving?3:0;
    for(const z of this.zombies){
      const feet=this.feet(z).clone(),distance=feet.distanceTo(player);z.timer+=dt;z.cooldown=Math.max(0,z.cooldown-dt);z.think-=dt;
      const seen=distance<13&&Math.abs(feet.y-player.y)<2&&this.los(feet.clone().add(new T.Vector3(0,1.35,0)),playerEye,z.collider);
      if(seen||distance<this.noise){z.lastSeen.copy(player);z.lost=0;}else z.lost+=dt;
      if(distance<8&&z.state!=='waiting')danger=true;
      if(z.state==='waiting'&&(seen||distance<this.noise||distance<5&&Math.abs(feet.y-player.y)<1)){
        z.state='approachingDoor';z.lastSeen.copy(player);z.think=0;
      }
      if(z.state==='waiting'&&distance>25)continue;
      if(z.state==='attacking'){
        if(z.timer>=.45&&!z.attackDone){if(distance<.9&&seen)this.vitals.damage();z.attackDone=true;z.cooldown=SURVIVAL.attackInterval;}
        if(z.timer>.8){z.state='chasing';z.timer=0;}
      }else if(distance<.85&&seen&&z.cooldown===0){z.state='attacking';z.timer=0;z.attackDone=false;}
      if(z.lost>5&&(z.state==='chasing'||z.state==='exiting')){z.state='searching';z.timer=0;}
      if(z.state==='searching'&&z.timer>4){z.state='returning';z.think=0;}
      if(seen&&(z.state==='returning'||z.state==='searching')){z.state='chasing';z.think=0;}
      for(const [edge,expiry] of z.blocked)if(expiry<this.vitals.elapsed)z.blocked.delete(edge);
      if(z.think<=0&&goal&&['approachingDoor','chasing','exiting','searching','returning'].includes(z.state)){
        const target=z.state==='returning'?this.nav.nodes[z.home]:z.state==='searching'||!seen&&distance>=this.noise?this.nav.nearest(z.lastSeen):goal;
        if(target)this.replan(z,target);z.think=distance>15?1.2:.55;
      }
      if(z.state==='returning'&&feet.distanceTo(this.nav.nodes[z.home].position)<.4){z.state='waiting';z.path=[];}
      let vx=0,vz=0;
      if(z.state==='openingDoor'){
        const door=this.doors.items.get(z.door);if(door){const dx=feet.x-door.center.x,dz=feet.z-door.center.z,d=Math.hypot(dx,dz);if(d<.6&&d>.01){vx=dx/d*.8;vz=dz/d*.8;}}
        if(z.timer>=.45){const d=this.doors.items.get(z.door);if(d&&d.target!==1)this.doors.toggle(d,feet);z.state='waitingDoor';z.timer=0;}
      }else if(z.state==='waitingDoor'){
        const d=this.doors.items.get(z.door);if(d&&d.progress>.88){z.state='exiting';z.timer=0;z.think=0;}
        else if(d?.blocked){const dx=feet.x-d.center.x,dz=feet.z-d.center.z,length=Math.hypot(dx,dz);if(length<.7&&length>.01){vx=dx/length*.7;vz=dz/length*.7;}if(z.timer>1){z.state='openingDoor';z.timer=0;}}
        else if(z.timer>3){z.state='reacting';z.timer=0;}
      }else if(z.state==='reacting'){
        if(z.timer>.6){z.state='approachingDoor';z.think=0;}
      }else if(!['waiting','attacking'].includes(z.state)&&z.pathIndex<z.path.length){
        let next=this.nav.nodes[z.path[z.pathIndex]],previous=this.nav.nodes[z.path[z.pathIndex-1]],edge=previous.edges.find(e=>e.to===next.id),d=edge?.door!=null?this.doors.items.get(edge.door):null;
        if(d&&d.progress<.88){
          z.door=d.id;const toDoor=d.center.clone();toDoor.y=feet.y;
          if(toDoor.distanceTo(feet)<1.1){z.state='openingDoor';z.timer=0;}
          else this.destination.copy(previous.position);
        }else{
          this.destination.copy(next.position);
          if(Math.hypot(feet.x-next.position.x,feet.z-next.position.z)<.19&&Math.abs(feet.y-next.position.y)<.4){z.pathIndex++;if(z.state==='exiting')z.state='chasing';}
        }
        if(!['openingDoor','waitingDoor'].includes(z.state)){
          const dx=this.destination.x-feet.x,dz=this.destination.z-feet.z,length=Math.hypot(dx,dz),speed=z.state==='returning'?.9:1.65;
          if(length>.04){vx=dx/length*speed;vz=dz/length*speed;z.yaw=Math.atan2(-vx,-vz);}
        }
      }
      if(seen&&distance<.78){vx=0;vz=0;}
      if(feet.distanceTo(z.last)<.002&&Math.hypot(vx,vz)>.1)z.stuck+=dt;else z.stuck=0;
      if(z.stuck>1.2){if(z.pathIndex>0&&z.pathIndex<z.path.length)z.blocked.set(`${z.path[z.pathIndex-1]}:${z.path[z.pathIndex]}`,this.vitals.elapsed+5);z.think=0;z.stuck=0;z.state='reacting';z.timer=0;}
      z.last.copy(feet);z.vy=Math.max(-25,z.vy-9.81*dt);
      z.controller.computeColliderMovement(z.collider,{x:vx*dt,y:z.vy*dt,z:vz*dt},undefined,undefined,c=>c.handle!==z.collider.handle);
      const delta=z.controller.computedMovement(),p=z.body.translation();z.body.setNextKinematicTranslation({x:p.x+delta.x,y:p.y+delta.y,z:p.z+delta.z});if(z.controller.computedGrounded())z.vy=0;
    }
    this.vitals.step(dt,running,moving,danger);
  }
  visual(dt:number,yaw:number,walk:boolean,motion:number){
    this.root.visible=walk;if(!walk)return;
    this.player.pose(this.physics.feet(),yaw,this.physics.crouched,dt);
    if(this.interaction)this.arm.pose(this.camera,this.interaction.target,this.interaction.time/.65);else this.arm.root.visible=false;
    for(const z of this.zombies){z.visualAge+=dt;const feet=this.feet(z);if(feet.distanceToSquared(this.camera.position)>324&&z.visualAge<.25)continue;const turn=Math.atan2(Math.sin(z.yaw-z.rig.root.rotation.y),Math.cos(z.yaw-z.rig.root.rotation.y));const facing=z.rig.root.rotation.y+turn*(1-Math.exp(-Math.max(dt,.016)*10));z.visualAge=0;z.rig.pose(feet,facing,false,dt,z.state==='openingDoor'?Math.min(1,z.timer/.35):z.state==='waitingDoor'?Math.max(0,1-z.timer/.5):z.state==='attacking'?Math.sin(Math.min(1,z.timer/.8)*Math.PI):0,z.state==='reacting'?1:0);}
    // Position-only bob: aim direction stays precise, and it is optional.
    if(motion&&this.physics.grounded)this.camera.position.y+=Math.sin(this.player.phase*2)*.009*motion;
  }
  setVisible(walk:boolean){
    this.root.visible=walk;if(walk!==this.lastActorEnabled){for(const z of this.zombies)z.collider.setEnabled(walk);this.lastActorEnabled=walk;}
  }
  clearWorld(){
    this.generation++;this.nav.dispose();if(this.physics?.ready)this.releaseActors();this.nav=new Navigation();this.enabled=false;this.preparing=false;this.vitals.reset();this.interaction=null;this.root.visible=false;
  }
  dispose(){this.clearWorld();this.root.removeFromParent();this.art.dispose();}
  get snapshot(){return {enabled:this.enabled,preparing:this.preparing,progress:this.progress,life:this.vitals.life,condition:this.vitals.condition,adrenaline:this.vitals.adrenaline,elapsed:this.vitals.elapsed,navNodes:this.nav.nodes.length,rooms:this.roomMap,zombies:this.zombies.map(z=>({state:z.state,door:z.door,position:z.body.translation(),pathLength:z.path.length}))};}
}
