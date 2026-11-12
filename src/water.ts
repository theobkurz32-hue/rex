import * as T from 'three';
import R from '@dimforge/rapier3d-compat';
import type {BimModel} from './model';
import type {Physics} from './physics';
import type {Doors,Door,DoorLeaf} from './doors';
import type {Part} from './types';

export interface WaterTarget {id:number;key:string;point:T.Vector3;label:string;kind:'water';reach:number;}
interface Fixture {id:number;kind:'tap'|'shower';outlet:T.Vector3;point:T.Vector3;impact:T.Vector3;mount:T.Vector3;direction:T.Vector3;on:boolean;control:T.Group|null;knob:T.Mesh|null;}
interface Stream {root:T.Group;jet:T.Mesh;splash:T.Mesh;drops:T.Points;positions:Float32Array;fixture:Fixture|null;}
const UP=new T.Vector3(0,1,0),DOWN=new T.Vector3(0,-1,0),MAX_FLOWS=4,DROPS=36;
const flat=(s:string)=>(s??'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase();

/** Original bathroom fixtures, operational shower controls and a bounded water pool. */
export class WaterFixtures {
  root=new T.Group();
  private model!:BimModel;private physics!:Physics;private doors!:Doors;
  private fixtures=new Map<number,Fixture>();private boxes:Door[]=[];private unsupportedBoxes:number[]=[];
  private streams:Stream[]=[];private chosen:Fixture[]=[];private time=0;private refresh=0;
  private cameraPosition=new T.Vector3();private look=new T.Vector3();private direction=new T.Vector3();private vector=new T.Vector3();
  private jetGeometry=new T.CylinderGeometry(1,1,1,6,1,true);
  private splashGeometry=new T.RingGeometry(.65,1,16);
  private plateGeometry=new T.CylinderGeometry(.035,.035,.008,16);
  private knobGeometry=new T.BoxGeometry(.012,.032,.012);
  private metal=new T.MeshStandardMaterial({color:'#c5cdd0',metalness:.8,roughness:.24});
  private dropMaterial=new T.PointsMaterial({color:'#d7f2f8',size:.014,transparent:true,opacity:.65,depthWrite:false,sizeAttenuation:true});
  private jetMaterial=new T.MeshBasicMaterial({color:'#c4e9ee',transparent:true,opacity:.42,depthWrite:false,toneMapped:false});
  private splashMaterial=new T.MeshBasicMaterial({color:'#d7f1f4',transparent:true,opacity:.25,depthWrite:false,side:T.DoubleSide,toneMapped:false});
  constructor(){
    this.root.name='Água e registros do hotel';
    for(let i=0;i<MAX_FLOWS;i++){
      const root=new T.Group(),jet=new T.Mesh(this.jetGeometry,this.jetMaterial),splash=new T.Mesh(this.splashGeometry,this.splashMaterial);
      const positions=new Float32Array(DROPS*3),geometry=new T.BufferGeometry();geometry.setAttribute('position',new T.BufferAttribute(positions,3));
      const drops=new T.Points(geometry,this.dropMaterial);drops.frustumCulled=false;jet.raycast=splash.raycast=drops.raycast=()=>{};
      splash.rotation.x=-Math.PI/2;root.add(jet,drops,splash);root.visible=false;this.root.add(root);this.streams.push({root,jet,splash,drops,positions,fixture:null});
    }
  }
  prepare(model:BimModel,doors:Doors){
    this.model=model;this.doors=doors;this.fixtures.clear();this.boxes=[];this.unsupportedBoxes=[];
    for(const [id,parts] of model.byElement){
      const element=model.elements.get(id),name=flat(element?.name??'');
      if(/box reto|shower enclosure|box de chuveiro/.test(name)){this.prepareBox(id,parts);continue;}
      const kind=/chuveiro|shower|ducha/.test(name)?'shower':/torneira|misturador.*lavatorio|faucet/.test(name)?'tap':null;
      if(!kind||!parts.length)continue;
      const whole=model.elementBounds(id),info=parts.map(part=>({part,box:this.partBox(part)})),outlet=this.findOutlet(info,kind,whole);
      const mount=this.findMount(info,outlet,kind),direction=outlet.clone().sub(mount);direction.y=0;
      if(direction.lengthSq()<.00001)direction.set(0,0,1);else direction.normalize();
      const fixture:Fixture={id,kind,outlet,point:kind==='tap'?whole.getCenter(new T.Vector3()):mount.clone(),impact:outlet.clone().addScaledVector(DOWN,kind==='tap'?.25:2),mount,direction,on:false,control:null,knob:null};
      if(kind==='shower'){
        // The IFC includes heads, but no separately named wall register. Add a
        // small operational control beside its actual pipe mount, not in midair.
        const group=new T.Group(),plate=new T.Mesh(this.plateGeometry,this.metal),knob=new T.Mesh(this.knobGeometry,this.metal);
        knob.position.y=.021;group.quaternion.setFromUnitVectors(UP,direction);plate.raycast=knob.raycast=()=>{};group.add(plate,knob);group.visible=false;this.root.add(group);fixture.control=group;fixture.knob=knob;
      }
      this.fixtures.set(id,fixture);
    }
  }
  private partBox(part:Part,basis?:T.Matrix4){
    const g=this.model.geometry.get(part.key)!,matrix=new T.Matrix4().fromArray(part.matrix);if(basis)matrix.premultiply(basis);
    const box=new T.Box3(),a=g.getAttribute('position'),ix=g.getIndex()!,v=new T.Vector3();
    for(let i=0;i<ix.count;i++)box.expandByPoint(v.fromBufferAttribute(a,ix.getX(i)).applyMatrix4(matrix));return box;
  }
  private findOutlet(parts:{part:Part;box:T.Box3}[],kind:'tap'|'shower',whole:T.Box3){
    let selected=parts[0],score=-Infinity,aerator=false;
    if(kind==='shower'){
      const lower=whole.min.y+(whole.max.y-whole.min.y)*.65;
      for(const p of parts){const s=p.box.getSize(new T.Vector3()),c=p.box.getCenter(new T.Vector3());if(c.y<lower||Math.min(s.x,s.z)<.035||Math.max(s.x,s.z)>.4)continue;const value=s.x*s.z/Math.max(.004,s.y);if(value>score){score=value;selected=p;}}
    }else if(parts.length>20){
      // Multi-part mixers include two side handles and a central spout. Their
      // aerator is a small, nearly horizontal disc near the top, not a handle.
      for(const p of parts){const s=p.box.getSize(new T.Vector3()),c=p.box.getCenter(new T.Vector3());if(c.y<whole.max.y-.06||s.y>.015||Math.min(s.x,s.z)<.01||Math.max(s.x,s.z)>.06||Math.max(s.x,s.z)/Math.min(s.x,s.z)>2.5)continue;const value=s.x*s.z/Math.max(.001,s.y);if(value>score){score=value;selected=p;aerator=true;}}
    }else{
      const upright=whole.max.y-whole.min.y>.15;
      for(const p of parts){const g=this.model.geometry.get(p.part.key)!,n=g.getIndex()!.count,c=p.box.getCenter(new T.Vector3()),value=upright?c.y:n;if(value>score){score=value;selected=p;}}
    }
    const mount=this.findMount(parts,selected.box.getCenter(new T.Vector3()),kind),forward=selected.box.getCenter(new T.Vector3()).sub(mount);forward.y=0;
    if(forward.lengthSq()<.00001){const s=whole.getSize(new T.Vector3());forward.set(s.x>s.z?1:0,0,s.x>s.z?0:1);}forward.normalize();
    const a=this.model.geometry.get(selected.part.key)!.getAttribute('position'),ix=this.model.geometry.get(selected.part.key)!.getIndex()!,matrix=new T.Matrix4().fromArray(selected.part.matrix);
    const p=new T.Vector3(),q=new T.Vector3(),r=new T.Vector3(),normal=new T.Vector3(),edge=new T.Vector3(),center=new T.Vector3(),candidates:{point:T.Vector3;score:number}[]=[];
    let best=-Infinity;const mirrored=matrix.determinant()<0;
    for(let i=0;i<ix.count;i+=3){p.fromBufferAttribute(a,ix.getX(i)).applyMatrix4(matrix);q.fromBufferAttribute(a,ix.getX(i+1)).applyMatrix4(matrix);r.fromBufferAttribute(a,ix.getX(i+2)).applyMatrix4(matrix);normal.subVectors(q,p).cross(edge.subVectors(r,p)).normalize();if(mirrored)normal.negate();if(normal.y>-.45)continue;center.copy(p).add(q).add(r).multiplyScalar(1/3);const value=kind==='tap'&&!aerator?center.dot(forward):-center.y;best=Math.max(best,value);candidates.push({point:center.clone(),score:value});}
    const result=new T.Vector3();let n=0;for(const candidate of candidates)if(candidate.score>best-.009){result.add(candidate.point);n++;}
    if(n)result.divideScalar(n);else{selected.box.getCenter(result);result.y=selected.box.min.y;}
    result.y-=.006;return result;
  }
  private findMount(parts:{part:Part;box:T.Box3}[],outlet:T.Vector3,kind:'tap'|'shower'){
    if(kind==='shower'){
      let candidate=parts[0],best=-Infinity;
      for(const p of parts){const s=p.box.getSize(new T.Vector3()),c=p.box.getCenter(new T.Vector3()),length=Math.max(s.x,s.z);if(s.y>.12||Math.min(s.x,s.z)>.07||length<.1||length>.65)continue;const score=length+c.y*.001;if(score>best){best=score;candidate=p;}}
      const box=candidate.box,center=box.getCenter(new T.Vector3()),axis=box.max.x-box.min.x>box.max.z-box.min.z?'x':'z';center[axis]=Math.abs(box.min[axis]-outlet[axis])>Math.abs(box.max[axis]-outlet[axis])?box.min[axis]:box.max[axis];return center;
    }
    let selected=parts[0],best=Infinity;
    for(const p of parts){const s=p.box.getSize(new T.Vector3()),n=this.model.geometry.get(p.part.key)!.getIndex()!.count;if(s.length()>.25)continue;const value=n;if(value<best){best=value;selected=p;}}
    return selected.box.getCenter(new T.Vector3());
  }
  private prepareBox(id:number,parts:Part[]){
    if(this.doors.items.has(id))return;
    const glass=parts.filter(p=>p.color[3]<.65).map(part=>({part,box:this.partBox(part)})).filter(p=>{const s=p.box.getSize(new T.Vector3());return s.y>1.2&&Math.min(s.x,s.z)<.06&&Math.max(s.x,s.z)>.25;});
    if(glass.length<2){this.unsupportedBoxes.push(id);return;}
    // Wider glass owns the rollers and handle in the Roldana family. The
    // narrower glass and the complete top/side frame remain fixed.
    glass.sort((a,b)=>Math.max(b.box.max.x-b.box.min.x,b.box.max.z-b.box.min.z)-Math.max(a.box.max.x-a.box.min.x,a.box.max.z-a.box.min.z));
    const panel=glass[0],g=this.model.geometry.get(panel.part.key)!,local=g.boundingBox!.getSize(new T.Vector3()),matrix=new T.Matrix4().fromArray(panel.part.matrix);let axis=new T.Vector3(),width=0;
    for(let i=0;i<3;i++){const column=new T.Vector3().setFromMatrixColumn(matrix,i),value=local.getComponent(i)*column.length();if(Math.abs(column.clone().normalize().y)<.01&&value>width){axis.copy(column).normalize();width=value;}}
    if(width<.3){this.unsupportedBoxes.push(id);return;}
    const normal=new T.Vector3().crossVectors(axis,UP).normalize(),basis=new T.Matrix4().makeBasis(axis,UP,normal),inverse=basis.clone().invert(),boxes=new Map(parts.map(p=>[p,this.partBox(p,inverse)])),whole=new T.Box3();for(const b of boxes.values())whole.union(b);
    const panelBox=boxes.get(panel.part)!,fixedBox=boxes.get(glass[1].part)!,panelCenter=panelBox.getCenter(new T.Vector3()),fixedCenter=fixedBox.getCenter(new T.Vector3());
    const fixedLeft=fixedCenter.x<whole.getCenter(new T.Vector3()).x,closedX=fixedLeft?whole.max.x-width/2:whole.min.x+width/2,shift=closedX-panelCenter.x;
    if(Math.abs(shift)<.12){this.unsupportedBoxes.push(id);return;}
    const owned=parts.filter(p=>{if(p===panel.part)return true;if(p.color[3]<.65)return false;const b=boxes.get(p)!,s=b.getSize(new T.Vector3()),c=b.getCenter(new T.Vector3());return s.y<.28&&s.x<.26&&s.z<.12&&c.x>panelBox.min.x-.035&&c.x<panelBox.max.x+.035&&Math.abs(c.z-panelCenter.z)<.07;});
    const translation=new T.Matrix4().makeTranslation(axis.clone().multiplyScalar(shift));
    const leaf:DoorLeaf={parts:owned,originals:owned.map(p=>translation.clone().multiply(new T.Matrix4().fromArray(p.matrix))),pivot:panel.box.getCenter(new T.Vector3()).addScaledVector(axis,shift),slide:axis.clone().multiplyScalar(-shift),angle:0};
    const door:Door={id,kind:'slide',category:'shower',leaves:[leaf],normal,center:panel.box.getCenter(new T.Vector3()),progress:1,target:1,blocked:false};
    this.doors.items.set(id,door);for(const p of owned)this.doors.moving.set(p,leaf);this.boxes.push(door);
  }
  bind(physics:Physics){
    this.physics=physics;
    for(const door of this.boxes)physics.moveDoor(door.leaves,door.leaves.map(leaf=>this.doors.transform(leaf,door.progress)));
    for(const fixture of this.fixtures.values()){
      const ray=new R.Ray({x:fixture.outlet.x,y:fixture.outlet.y-.012,z:fixture.outlet.z},DOWN),hit=physics.world.castRayAndGetNormal(ray,3.5,true,undefined,undefined,physics.capsule,physics.body,c=>physics.colliderElement.get(c.handle)!==fixture.id);
      if(hit&&hit.timeOfImpact>.03)fixture.impact.set(fixture.outlet.x,fixture.outlet.y-.012-hit.timeOfImpact,fixture.outlet.z);
      else fixture.impact.copy(fixture.outlet).addScaledVector(DOWN,fixture.kind==='tap'?.22:2.05);
      if(fixture.kind==='tap')this.basinImpact(fixture);
      if(fixture.kind==='shower'){fixture.point.copy(fixture.mount).addScaledVector(fixture.direction,.035);fixture.point.y=fixture.impact.y+1.12;fixture.control!.position.copy(fixture.point);}
    }
  }
  private basinImpact(fixture:Fixture){
    let basin:number|null=null,best=.8;
    for(const [id,e]of this.model.elements){if(!/cuba|pia|basin|sink/.test(flat(e.name??''))||/tapete/.test(flat(e.name??''))||!this.model.byElement.has(id))continue;const b=this.model.elementBounds(id),c=b.getCenter(new T.Vector3());if(c.y>fixture.outlet.y+.1||c.y<fixture.outlet.y-.9)continue;const d=Math.hypot(c.x-fixture.outlet.x,c.z-fixture.outlet.z);if(d<best){best=d;basin=id;}}
    if(basin==null)return;
    const ray=new T.Raycaster(fixture.outlet.clone(),DOWN,.005,.9),scratch=new T.Mesh(),hits:T.Intersection[]=[];
    for(const p of this.model.byElement.get(basin)!){scratch.geometry=this.model.geometry.get(p.key)!;scratch.matrixWorld.fromArray(p.matrix);scratch.raycast(ray,hits);}
    hits.sort((a,b)=>a.distance-b.distance);if(hits.length)fixture.impact.copy(hits[0].point);
  }
  target(camera:T.Camera):WaterTarget|null {
    if(!this.physics?.ready||this.model.inspection())return null;
    camera.getWorldPosition(this.cameraPosition);camera.getWorldDirection(this.look);let selected:Fixture|null=null,best=Infinity;
    for(const fixture of this.fixtures.values()){
      if(!this.model.visible.has(fixture.id))continue;this.direction.subVectors(fixture.point,this.cameraPosition);const distance=this.direction.length();if(distance>1.5||distance<.05)continue;this.direction.divideScalar(distance);const alignment=this.direction.dot(this.look);if(alignment<.85)continue;
      const obstruction=this.physics.world.castRay(new R.Ray(this.cameraPosition,this.direction),Math.max(0,distance-.07),true,undefined,undefined,this.physics.capsule,this.physics.body);
      if(obstruction&&this.physics.colliderElement.get(obstruction.collider.handle)!==fixture.id)continue;
      const score=distance+(1-alignment)*3;if(score<best){best=score;selected=fixture;}
    }
    if(!selected)return null;return {id:selected.id,key:`water:${selected.id}`,kind:'water',reach:1.5,point:selected.point,label:`${selected.on?'Fechar':'Abrir'} ${selected.kind==='tap'?'torneira':'chuveiro'}`};
  }
  interact(key:string){const fixture=this.fixtures.get(Number(key.replace(/^water:/,'')));if(!fixture)return false;fixture.on=!fixture.on;if(fixture.knob)fixture.knob.rotation.y=fixture.on?Math.PI/3:0;this.refresh=0;return true;}
  update(dt:number,camera:T.Camera,active:boolean){
    if(!this.model)return;if(active)this.time+=Math.min(dt,.1);this.refresh-=dt;
    if(this.refresh<=0){this.refresh=.12;camera.getWorldPosition(this.cameraPosition);this.chosen.length=0;
      for(const fixture of this.fixtures.values()){
        const distance=fixture.outlet.distanceToSquared(this.cameraPosition),visible=this.model.visible.has(fixture.id)&&(this.model.clip==null||fixture.outlet.y<=this.model.clip)&&distance<64&&Math.abs(fixture.outlet.y-this.cameraPosition.y)<3;
        if(fixture.control)fixture.control.visible=visible&&distance<25;
        if(!fixture.on||!visible)continue;let at=this.chosen.length;for(let i=0;i<this.chosen.length;i++)if(distance<this.chosen[i].outlet.distanceToSquared(this.cameraPosition)){at=i;break;}if(at<MAX_FLOWS){this.chosen.splice(at,0,fixture);if(this.chosen.length>MAX_FLOWS)this.chosen.length=MAX_FLOWS;}
      }
      for(let i=0;i<this.streams.length;i++){this.streams[i].fixture=this.chosen[i]??null;this.streams[i].root.visible=!!this.chosen[i];}
    }
    for(const stream of this.streams){const fixture=stream.fixture;if(!fixture)continue;const length=Math.max(.03,fixture.outlet.y-fixture.impact.y),shower=fixture.kind==='shower';stream.root.position.copy(fixture.outlet);stream.jet.visible=!shower;stream.jet.position.y=-length/2;stream.jet.scale.set(.0045,length,.0045);stream.splash.position.set(0,-length+.004,0);const ripple=.024+(this.time*1.3%1)*.025;stream.splash.scale.setScalar(shower?.09:ripple);
      for(let i=0;i<DROPS;i++){const phase=(i*.61803398875+this.time*(shower?1.25:2.3))%1,angle=i*2.39996323,radius=shower?Math.sqrt((i*.754877666)%1)*(.025+phase*.10):.0035;stream.positions[i*3]=Math.cos(angle)*radius;stream.positions[i*3+1]=-phase*length;stream.positions[i*3+2]=Math.sin(angle)*radius;}(stream.drops.geometry.getAttribute('position')as T.BufferAttribute).needsUpdate=true;
    }
  }
  get snapshot(){return {faucets:[...this.fixtures.values()].filter(f=>f.kind==='tap').length,showers:[...this.fixtures.values()].filter(f=>f.kind==='shower').length,boxes:this.boxes.length,unsupportedBoxes:[...this.unsupportedBoxes],visibleFlows:this.streams.filter(s=>s.root.visible).length,maxFlows:MAX_FLOWS,fixtures:[...this.fixtures.values()].map(f=>({id:f.id,kind:f.kind,on:f.on,outlet:f.outlet.toArray(),point:f.point.toArray(),impact:f.impact.toArray()})),boxStates:this.boxes.map(d=>({id:d.id,progress:d.progress,target:d.target,movingParts:d.leaves.reduce((n,l)=>n+l.parts.length,0)}))};}
  dispose(){for(const stream of this.streams)stream.drops.geometry.dispose();this.root.clear();this.fixtures.clear();this.boxes=[];this.streams=[];this.jetGeometry.dispose();this.splashGeometry.dispose();this.plateGeometry.dispose();this.knobGeometry.dispose();this.metal.dispose();this.dropMaterial.dispose();this.jetMaterial.dispose();this.splashMaterial.dispose();}
}
