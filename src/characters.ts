import * as T from 'three';
import {RoundedBoxGeometry} from 'three/addons/geometries/RoundedBoxGeometry.js';
const axisY=new T.Vector3(0,1,0), scratch=new T.Vector3();
export class CharacterArt {
  geometries:T.BufferGeometry[]=[];materials:T.Material[]=[];
  private cache=new Map<string,T.BufferGeometry>();private materialCache=new Map<string,T.MeshStandardMaterial>();
  cloth:T.DataTexture;
  constructor(){
    const size=64,data=new Uint8Array(size*size*4);
    for(let y=0;y<size;y++)for(let x=0;x<size;x++){const v=215+((x*37+y*73)%21)+(x%8===0||y%8===0?-15:0),i=(y*size+x)*4;data.set([v,v,v,255],i);}
    this.cloth=new T.DataTexture(data,size,size);this.cloth.wrapS=this.cloth.wrapT=T.RepeatWrapping;this.cloth.repeat.set(3,3);this.cloth.needsUpdate=true;
  }
  material(color:string,cloth=false,roughness=.8){const key=`${color}/${cloth}/${roughness}`;const cached=this.materialCache.get(key);if(cached)return cached;const m=new T.MeshStandardMaterial({color,roughness,map:cloth?this.cloth:null});this.materials.push(m);this.materialCache.set(key,m);return m;}
  geometry(key:string,create:()=>T.BufferGeometry){if(!this.cache.has(key)){const g=create();this.cache.set(key,g);this.geometries.push(g);}return this.cache.get(key)!;}
  box(w:number,h:number,d:number,r=.035){return this.geometry(`b${w},${h},${d}`,()=>new RoundedBoxGeometry(w,h,d,2,Math.min(r,w/3,h/3,d/3)));}
  sphere(){return this.geometry('sphere',()=>new T.SphereGeometry(1,12,8));}
  taper(top:number,bottom:number,length:number){return this.geometry(`t${top},${bottom},${length}`,()=>new T.CylinderGeometry(top,bottom,length,10,1));}
  mesh(parent:T.Object3D,g:T.BufferGeometry,m:T.Material,x=0,y=0,z=0){const mesh=new T.Mesh(g,m);mesh.position.set(x,y,z);mesh.castShadow=true;mesh.receiveShadow=true;parent.add(mesh);return mesh;}
  dispose(){for(const g of this.geometries)g.dispose();for(const m of this.materials)m.dispose();this.cloth.dispose();this.cache.clear();this.materialCache.clear();}
}
export class HumanRig {
  root=new T.Group();upper=new T.Group();head=new T.Group();hips=new T.Group();
  legs:{hip:T.Group;knee:T.Group;shoe:T.Group}[]=[];arms:T.Group[]=[];
  phase=0;private age=0;private previous=new T.Vector3();private initialized=false;
  constructor(public art:CharacterArt){
    const skin=art.material('#bd9679'),shirt=art.material('#465765',true),pants=art.material('#504d43',true),boots=art.material('#242c30',false,.65),sole=art.material('#454d4c'),trim=art.material('#9c9a82'),eye=art.material('#202623');
    this.root.add(this.upper,this.hips);this.upper.position.set(0,0,.18);
    // Tailored jacket with collar, shoulder seams, placket and a sewn pocket.
    art.mesh(this.upper,art.box(.37,.40,.15,.05),shirt,0,1.22);
    art.mesh(this.upper,art.box(.34,.10,.18,.03),pants,0,.94);
    art.mesh(this.upper,art.box(.032,.32,.016,.006),trim,0,1.23,-.102);
    art.mesh(this.upper,art.box(.095,.09,.015,.01),pants,.10,1.29,-.106);
    art.mesh(this.upper,art.box(.25,.045,.2,.01),shirt,0,1.43);
    this.upper.add(this.head);this.head.position.set(0,1.57,0);
    const skull=art.mesh(this.head,art.sphere(),skin);skull.scale.set(.105,.14,.1);
    art.mesh(this.head,art.box(.15,.075,.11,.025),skin,0,-.085,-.025);
    for(const sign of [-1,1]){const socket=art.mesh(this.head,art.sphere(),eye,.041*sign,.018,-.087);socket.scale.set(.028,.024,.016);}
    const nose=art.mesh(this.head,art.sphere(),skin,0,-.012,-.10);nose.scale.set(.022,.035,.026);
    art.mesh(this.head,art.box(.075,.012,.012,.003),eye,0,-.06,-.092);
    for(const sign of [-1,1]){
      const hip=new T.Group(),knee=new T.Group(),shoe=new T.Group();hip.position.set(sign*.105,.86,.11);hip.add(knee);knee.position.y=-.39;knee.add(shoe);shoe.position.y=-.39;this.hips.add(hip);this.legs.push({hip,knee,shoe});
      art.mesh(hip,art.taper(.09,.075,.37),pants,0,-.185);
      art.mesh(knee,art.taper(.074,.055,.35),pants,0,-.175);
      art.mesh(knee,art.box(.11,.045,.10,.008),trim,0,-.32,.0);
      art.mesh(shoe,art.box(.13,.135,.23,.035),boots,0,-.005,-.045);
      art.mesh(shoe,art.box(.14,.025,.25,.008),sole,0,-.065,-.05);
      const arm=new T.Group();arm.position.set(sign*.19,1.37,.08);this.upper.add(arm);this.arms.push(arm);
      art.mesh(arm,art.taper(.071,.054,.30),shirt,0,-.15);
      art.mesh(arm,art.taper(.05,.037,.25),skin,0,-.415,-.025);
      art.mesh(arm,art.box(.075,.095,.035,.012),skin,0,-.57,-.027);
    }
    this.head.traverse(o=>o.layers.set(1));this.arms.forEach(a=>a.visible=false);
  }
  pose(position:T.Vector3,yaw:number,crouched:boolean,dt:number,gesture=0,reaction=0){
    if(!this.initialized){this.previous.copy(position);this.initialized=true;}
    const travelled=Math.min(.2,Math.hypot(position.x-this.previous.x,position.z-this.previous.z));this.previous.copy(position);
    this.phase+=travelled*6.5;this.root.position.copy(position);this.root.rotation.y=yaw;
    this.age+=dt;const hipHeight=crouched?.57:.86;this.upper.position.y=crouched?-.30:0;
    const moving=travelled>1e-5;
    for(let i=0;i<2;i++){
      const phase=this.phase+i*Math.PI,stride=moving?Math.sin(phase)*.16:0,lift=moving?Math.max(0,Math.cos(phase))*.035:0;
      const dy=hipHeight-(.075+lift),length=Math.min(.775,Math.hypot(dy,stride)),bend=Math.acos(T.MathUtils.clamp(length/.78,0,1));
      const angle=Math.atan2(stride,dy),leg=this.legs[i];leg.hip.position.y=hipHeight;leg.hip.rotation.x=angle+bend;leg.knee.rotation.x=-2*bend;leg.shoe.rotation.x=-angle+bend;
      this.arms[i].rotation.x=0;
      this.arms[i].rotation.z=0;
    }
    this.upper.rotation.x=0;this.head.rotation.y=0;
  }
  reset(){this.initialized=false;this.phase=0;this.age=0;}
}
export class InteractionArm {
  root=new T.Group();private upper:T.Mesh;private lower:T.Mesh;private hand=new T.Group();private fingers:T.Group[]=[];
  private a=new T.Vector3();private b=new T.Vector3();private elbow=new T.Vector3();
  constructor(art:CharacterArt){
    const sleeve=art.material('#465765',true),skin=art.material('#bd9679'),nail=art.material('#cfb8a4');
    this.upper=art.mesh(this.root,art.taper(.06,.045,1),sleeve);this.lower=art.mesh(this.root,art.taper(.045,.033,1),skin);this.root.add(this.hand);
    art.mesh(this.hand,art.box(.085,.10,.035,.012),skin);
    for(let i=0;i<4;i++){const finger=new T.Group();finger.position.set((i-1.5)*.021,-.05,0);this.hand.add(finger);this.fingers.push(finger);art.mesh(finger,art.box(.016,.061-i*.004,.020,.006),skin,0,-.025);art.mesh(finger,art.box(.012,.018,.004,.002),nail,0,-.043,-.01);}
    const thumb=art.mesh(this.hand,art.box(.023,.061,.025,.009),skin,.055,-.007);thumb.rotation.z=-.55;
    this.root.visible=false;
  }
  private segment(mesh:T.Mesh,start:T.Vector3,end:T.Vector3){scratch.subVectors(end,start);mesh.position.copy(start).add(end).multiplyScalar(.5);mesh.scale.y=scratch.length();mesh.quaternion.setFromUnitVectors(axisY,scratch.normalize());}
  pose(camera:T.Camera,target:T.Vector3,progress:number){
    this.root.visible=progress>0&&progress<1;if(!this.root.visible)return;
    const reach=Math.sin(Math.PI*progress),shoulder=this.a.set(.19,-.22,-.07).applyMatrix4(camera.matrixWorld);
    const rest=this.b.set(.24,-.38,-.28).applyMatrix4(camera.matrixWorld);rest.lerp(target,reach);
    const delta=scratch.subVectors(rest,shoulder);if(delta.length()>.82)rest.copy(shoulder).addScaledVector(delta.normalize(),.82);
    this.elbow.copy(shoulder).lerp(rest,.5);this.elbow.y-=.15*(1-reach*.5);
    this.segment(this.upper,shoulder,this.elbow);this.segment(this.lower,this.elbow,rest);this.hand.position.copy(rest);this.hand.quaternion.copy(camera.quaternion);
    this.hand.rotation.x-=.5*reach;this.fingers.forEach((f,i)=>f.rotation.x=-.2-reach*(.2+i*.035));
  }
}
