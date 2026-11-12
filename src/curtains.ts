import * as T from 'three';
import type { BimModel } from './model';
import type { Doors, DoorLeaf, Door } from './doors';
import type { Physics } from './physics';
import type { Part } from './types';

interface ClothPart extends Part {curtainCloth?:boolean;curtainHemMin?:number;curtainHemMax?:number;}
interface PanelPart {part:Part;original:T.Matrix4;cloth:boolean;center:T.Vector3;}
interface Panel {parts:PanelPart[];pivot:number;baseGrab:T.Vector3;grab:T.Vector3;leaf:DoorLeaf;}
interface Curtain {id:number;basis:T.Matrix4;inverse:T.Matrix4;panels:Panel[];progress:number;target:number;center:T.Vector3;}
export interface CurtainTarget {id:number;key:string;label:string;point:T.Vector3;}

/** The IFC cloth gathers on its own rail. Fabric is soft, not a rigid wall;
 * walls, glazing and frames retain their normal physical collision. */
export class Curtains {
  root=new T.Group();
  private model:BimModel|null=null;
  private doors:Doors|null=null;
  private items=new Map<number,Curtain>();
  private windowDoors:Door[]=[];
  private time={value:0};
  private breeze={value:[new T.Vector4(),new T.Vector4(),new T.Vector4(),new T.Vector4()]};
  private breezeAge=1;
  private patched:{material:T.Material;compile:T.Material['onBeforeCompile'];key:T.Material['customProgramCacheKey']}[]=[];
  private direction=new T.Vector3();
  private delta=new T.Vector3();
  private transform=new T.Matrix4();
  private translation=new T.Matrix4();
  private moved=new Set<number>();

  prepare(model:BimModel,doors:Doors){
    this.dispose();this.model=model;this.doors=doors;
    for(const [id,parts] of model.byElement){
      if(!/cortina|curtain/i.test(model.elements.get(id)?.name??''))continue;
      const entries=parts.map(part=>({part,geometry:model.geometry.get(part.key)!,matrix:new T.Matrix4().fromArray(part.matrix)}));
      // All real hotel cloth panels use local Z vertically; infer the horizontal
      // rail from a tall panel rather than assuming a world X/Z orientation.
      const candidates=entries.filter(entry=>{
        const size=entry.geometry.boundingBox!.getSize(new T.Vector3()),axes=[0,1,2].map(i=>new T.Vector3().setFromMatrixColumn(entry.matrix,i));
        const vertical=axes.findIndex(axis=>Math.abs(axis.clone().normalize().y)>.99);if(vertical<0)return false;
        const horizontal=axes.map((axis,index)=>size.getComponent(index)*axis.length()).filter((_,index)=>index!==vertical);
        return size.getComponent(vertical)*axes[vertical].length()>.6&&Math.max(...horizontal)>.25&&Math.min(...horizontal)<.35;
      });
      if(!candidates.length)continue;
      const first=candidates[0],localSize=first.geometry.boundingBox!.getSize(new T.Vector3());
      const columns=[0,1,2].map(i=>new T.Vector3().setFromMatrixColumn(first.matrix,i));
      let horizontal=-1,width=0;
      for(let i=0;i<3;i++){const length=localSize.getComponent(i)*columns[i].length();if(Math.abs(columns[i].clone().normalize().y)<.02&&length>width){width=length;horizontal=i;}}
      if(horizontal<0)continue;
      const axis=columns[horizontal].normalize(),normal=new T.Vector3().crossVectors(axis,new T.Vector3(0,1,0)).normalize();
      const basis=new T.Matrix4().makeBasis(axis,new T.Vector3(0,1,0),normal),inverse=basis.clone().invert();
      const bounds=new Map(entries.map(entry=>[entry.part,entry.geometry.boundingBox!.clone().applyMatrix4(inverse.clone().multiply(entry.matrix))]));
      const fabrics=candidates.filter(entry=>{const size=bounds.get(entry.part)!.getSize(new T.Vector3());return size.y>.6&&size.x>.25&&size.z<.35;});
      if(!fabrics.length)continue;
      const whole=new T.Box3();for(const entry of fabrics)whole.union(bounds.get(entry.part)!);
      const middle=whole.getCenter(new T.Vector3()).x;
      const curtain:Curtain={id,basis,inverse,panels:[],progress:0,target:0,center:whole.getCenter(new T.Vector3()).applyMatrix4(basis)};
      const assigned=new Set<Part>();
      for(const entry of fabrics){
        const box=bounds.get(entry.part)!,center=box.getCenter(new T.Vector3()),left=center.x<=middle;
        const pivot=left?box.min.x:box.max.x;
        const group=[entry,...entries.filter(other=>{
          if(other===entry||fabrics.includes(other)||assigned.has(other.part))return false;
          const b=bounds.get(other.part)!,size=b.getSize(new T.Vector3()),c=b.getCenter(new T.Vector3());
          const difference=other.part.color.slice(0,3).reduce((sum,value,index)=>sum+Math.abs(value-entry.part.color[index]),0);
          return size.x<.16&&size.y<.2&&size.z<.16&&Math.abs(c.y-box.max.y)<.18&&c.x>=box.min.x-.03&&c.x<=box.max.x+.03&&difference<.2;
        })];
        const owned=group.map(other=>{
          assigned.add(other.part);const cloth=other===entry;
          if(cloth){const flagged=other.part as ClothPart;flagged.curtainCloth=true;flagged.curtainHemMin=other.geometry.boundingBox!.min.z;flagged.curtainHemMax=other.geometry.boundingBox!.max.z;}
          return {part:other.part,original:other.matrix.clone(),cloth,center:new T.Vector3().setFromMatrixPosition(other.matrix)};
        });
        const leaf:DoorLeaf={parts:owned.map(item=>item.part),originals:owned.map(item=>item.original),pivot:new T.Vector3(pivot,center.y,center.z).applyMatrix4(basis),slide:new T.Vector3(),angle:0};
        // Excluding these parts before physics.init removes the old solid cloth
        // collider, instead of leaving an invisible barrier after opening it.
        for(const item of owned)doors.moving.set(item.part,leaf);
        const baseGrab=new T.Vector3(left?box.max.x:box.min.x,Math.min(box.max.y-.2,box.min.y+1.3),center.z).applyMatrix4(basis);
        curtain.panels.push({parts:owned,pivot,baseGrab,grab:baseGrab.clone(),leaf});
      }
      this.items.set(id,curtain);
    }
    this.windowDoors=[...doors.items.values()].filter(door=>door.category==='window');
  }

  bind(_physics:Physics){
    if(!this.model)return;
    for(const material of this.model.materials){
      const finish=String(material.userData.finish??'');if(!finish.startsWith('curtain-cloth|'))continue;
      const [, ,low,high]=finish.split('|'),compile=material.onBeforeCompile,key=material.customProgramCacheKey;
      this.patched.push({material,compile,key});
      material.onBeforeCompile=(shader,renderer)=>{
        compile.call(material,shader,renderer);
        shader.uniforms.rexCurtainTime=this.time;shader.uniforms.rexCurtainBreeze=this.breeze;
        shader.uniforms.rexCurtainHem={value:new T.Vector2(Number(low),Number(high))};
        shader.vertexShader=shader.vertexShader.replace('#include <common>',`#include <common>
          uniform float rexCurtainTime;
          uniform vec4 rexCurtainBreeze[4];
          uniform vec2 rexCurtainHem;`);
        shader.vertexShader=shader.vertexShader.replace('#include <begin_vertex>',`#include <begin_vertex>
          vec4 rexClothPoint = vec4(transformed,1.0);
          #ifdef USE_BATCHING
            rexClothPoint = batchingMatrix * rexClothPoint;
          #endif
          #ifdef USE_INSTANCING
            rexClothPoint = instanceMatrix * rexClothPoint;
          #endif
          vec3 rexClothWorld = (modelMatrix * rexClothPoint).xyz;
          float rexClothNear = 1.0 - smoothstep(5.0,9.0,distance(cameraPosition,rexClothWorld));
          float rexClothWind = 0.005;
          for(int rexWindIndex=0;rexWindIndex<4;rexWindIndex++) {
            rexClothWind += rexCurtainBreeze[rexWindIndex].w * (1.0-smoothstep(0.5,3.0,distance(rexCurtainBreeze[rexWindIndex].xyz,rexClothWorld))) * 0.016;
          }
          float rexClothHem = clamp((rexCurtainHem.y-position.z)/max(0.2,rexCurtainHem.y-rexCurtainHem.x),0.0,1.0);
          float rexClothWave = sin(rexCurtainTime*1.45+rexClothWorld.x*1.8+rexClothWorld.z*1.6) + 0.35*sin(rexCurtainTime*2.2+position.x*8.0);
          transformed.y += rexClothWave * rexClothWind * rexClothHem * rexClothNear;`);
      };
      material.customProgramCacheKey=()=> 'rex-curtain-wind-v1';material.needsUpdate=true;
    }
  }

  target(camera:T.Camera):CurtainTarget|null {
    if(!this.model||this.model.inspection())return null;
    camera.getWorldDirection(this.direction);let best:CurtainTarget|null=null,bestScore=Infinity;
    for(const item of this.items.values()){
      if(!this.model.visible.has(item.id))continue;
      for(const panel of item.panels){
        this.delta.subVectors(panel.grab,camera.position);const distance=this.delta.length();
        if(distance>1.55||distance<.05)continue;const dot=this.delta.dot(this.direction)/distance;
        if(dot<.83)continue;const score=distance+(1-dot)*1.5;
        if(score<bestScore){bestScore=score;best={id:item.id,key:`curtain:${item.id}`,label:item.target>.5?'Fechar cortina':'Abrir cortina',point:panel.grab.clone()};}
      }
    }
    return best;
  }

  interact(key:string){const item=this.items.get(Number(key.replace('curtain:','')));if(!item)return false;item.target=item.target>.5?0:1;return true;}

  update(dt:number,camera:T.Camera,active:boolean){
    if(!this.model||!active)return;const step=Math.min(Math.max(dt,0),.1);this.time.value+=step;this.breezeAge+=step;
    if(this.breezeAge>.35){
      this.breezeAge=0;for(const vector of this.breeze.value)vector.w=0;
      const nearest=this.windowDoors.filter(door=>door.progress>.02&&door.center.distanceToSquared(camera.position)<144).sort((a,b)=>a.center.distanceToSquared(camera.position)-b.center.distanceToSquared(camera.position));
      for(let i=0;i<Math.min(4,nearest.length);i++){const door=nearest[i];this.breeze.value[i].set(door.center.x,door.center.y,door.center.z,door.progress);}
    }
    this.moved.clear();
    for(const item of this.items.values()){
      if(item.progress===item.target)continue;
      item.progress=T.MathUtils.clamp(item.progress+Math.sign(item.target-item.progress)*step/.8,0,1);
      const amount=item.progress*item.progress*(3-2*item.progress),scale=1-.82*amount;
      for(const panel of item.panels){
        this.transform.copy(item.basis).multiply(new T.Matrix4().makeTranslation(panel.pivot,0,0)).multiply(new T.Matrix4().makeScale(scale,1,1)).multiply(new T.Matrix4().makeTranslation(-panel.pivot,0,0)).multiply(item.inverse);
        for(const entry of panel.parts){
          if(entry.cloth)this.model.setPartMatrix(entry.part,this.translation.copy(this.transform).multiply(entry.original));
          else {this.delta.copy(entry.center).applyMatrix4(this.transform).sub(entry.center);this.model.setPartMatrix(entry.part,this.translation.makeTranslation(this.delta).multiply(entry.original));}
        }
        panel.grab.copy(panel.baseGrab).applyMatrix4(this.transform);
      }
      this.moved.add(item.id);
    }
    if(this.moved.size)this.model.finishMovingParts(this.moved);
  }

  get snapshot(){return {count:this.items.size,panels:[...this.items.values()].reduce((n,item)=>n+item.panels.length,0),windTime:this.time.value,items:[...this.items.values()].map(item=>({id:item.id,progress:item.progress,target:item.target,panels:item.panels.length,parts:item.panels.reduce((n,panel)=>n+panel.parts.length,0),softFabric:true}))};}

  dispose(){
    if(this.model){
      const ids=new Set<number>();
      for(const item of this.items.values())for(const panel of item.panels)for(const entry of panel.parts){
        if(this.doors?.moving.get(entry.part)===panel.leaf)this.doors.moving.delete(entry.part);
        this.model.setPartMatrix(entry.part,entry.original);ids.add(item.id);
        const part=entry.part as ClothPart;delete part.curtainCloth;delete part.curtainHemMin;delete part.curtainHemMax;
      }
      if(ids.size)this.model.finishMovingParts(ids);
    }
    for(const entry of this.patched){entry.material.onBeforeCompile=entry.compile;entry.material.customProgramCacheKey=entry.key;entry.material.needsUpdate=true;}
    this.patched=[];this.items.clear();this.windowDoors=[];this.root.clear();this.model=null;this.doors=null;this.time.value=0;
    for(const vector of this.breeze.value)vector.set(0,0,0,0);
  }
}
