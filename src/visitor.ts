import * as T from 'three';
import R from '@dimforge/rapier3d-compat';
import {CharacterArt,HumanRig,InteractionArm} from './characters';
import type {Physics} from './physics';

export interface VisitTarget {id:number;key:string;label:string;point:T.Vector3;reach?:number;allowIds?:number[];}

/** A visitor has an animated body and reach gesture, with no combat or AI. */
export class Visitor {
  root=new T.Group();art=new CharacterArt();player=new HumanRig(this.art);arm=new InteractionArm(this.art);
  private physics!:Physics;
  private interaction:{target:VisitTarget;time:number;committed:boolean;commit:()=>void;valid:()=>boolean}|null=null;
  elapsed=0;
  constructor(scene:T.Scene,private camera:T.Camera){this.root.add(this.player.root,this.arm.root);scene.add(this.root);this.root.visible=false;}
  bind(physics:Physics){this.physics=physics;this.player.reset();}
  request(target:VisitTarget,commit:()=>void,valid:()=>boolean){
    if(this.interaction||!valid())return false;
    this.camera.updateMatrixWorld(true);
    const shoulder=new T.Vector3(.19,-.22,-.07).applyMatrix4(this.camera.matrixWorld),delta=target.point.clone().sub(shoulder);
    // Stop the hand before nearby geometry; the player can continue moving.
    const obstruction=this.physics.world.castShape(shoulder,{x:0,y:0,z:0,w:1},delta,new R.Ball(.025),.002,1,true,undefined,undefined,this.physics.capsule,this.physics.body);
    if(obstruction&&obstruction.time_of_impact<.75){const id=this.physics.colliderElement.get(obstruction.collider.handle);if(id!==target.id&&(id==null||!target.allowIds?.includes(id)))return false;}
    this.interaction={target:{...target,point:target.point.clone()},time:0,committed:false,commit,valid};return true;
  }
  step(dt:number){
    this.elapsed+=dt;const action=this.interaction;if(!action)return;
    action.time+=dt;
    if(!action.committed&&action.time>=.26){if(action.valid())action.commit();action.committed=true;}
    if(action.time>=.65)this.interaction=null;
  }
  visual(dt:number,yaw:number,walk:boolean,motion:number){
    this.root.visible=walk;if(!walk||!this.physics?.ready)return;
    this.player.pose(this.physics.feet(),yaw,this.physics.crouched,dt);
    if(this.interaction)this.arm.pose(this.camera,this.interaction.target.point,this.interaction.time/.65);else this.arm.root.visible=false;
    if(motion&&this.physics.grounded)this.camera.position.y+=Math.sin(this.player.phase*2)*.009*motion;
  }
  clear(){this.interaction=null;this.elapsed=0;this.root.visible=false;this.arm.root.visible=false;this.player.reset();}
  get snapshot(){return {elapsed:this.elapsed,interacting:!!this.interaction,bodyVisible:this.root.visible};}
}
