import * as T from 'three';
import R from '@dimforge/rapier3d-compat';
import {breathe,type BimModel} from './model';
import type {Physics} from './physics';
import type {Doors} from './doors';
export interface NavEdge {to:number;door:number|null;cost:number;}
export interface NavNode {id:number;x:number;z:number;position:T.Vector3;edges:NavEdge[];}
const rotation={x:0,y:0,z:0,w:1};
export class Navigation {
  nodes:NavNode[]=[];columns=new Map<string,NavNode[]>();ready=false;cancelled=false;cell=.5;
  private origin=new T.Vector3();
  async build(model:BimModel,physics:Physics,doors:Doors,progress:(n:number)=>void){
    this.origin.copy(model.bounds.min);const size=model.bounds.getSize(new T.Vector3());
    const nx=Math.ceil(size.x/this.cell),nz=Math.ceil(size.z/this.cell),shape=new R.Capsule(.45,.26);
    const skip=(c:R.Collider)=>c!==physics.capsule&&!physics.actors.has(c)&&!doors.items.has(physics.colliderElement.get(c.handle)??-1);
    for(let x=0;x<=nx;x++)for(let z=0;z<=nz;z++){
      if(this.cancelled)return;
      const wx=this.origin.x+x*this.cell,wz=this.origin.z+z*this.cell,hits:{y:number;id:number}[]=[];
      physics.world.intersectionsWithRay(new R.Ray({x:wx,y:model.bounds.max.y+1,z:wz},{x:0,y:-1,z:0}),size.y+2,false,h=>{
        const id=physics.colliderElement.get(h.collider.handle),type=model.elements.get(id??-1)?.type??'';
        if(h.normal.y>.7&&/Slab|Stair|Ramp|Covering/.test(type))hits.push({y:model.bounds.max.y+1-h.timeOfImpact+.035,id:id!});return true;
      },undefined,undefined,physics.capsule,physics.body,skip);
      hits.sort((a,b)=>a.y-b.y);let previous=-Infinity;
      for(const h of hits){
        if(h.y-previous<.18)continue;
        const center={x:wx,y:h.y+.96,z:wz};
        if(physics.world.intersectionWithShape(center,rotation,shape,undefined,undefined,physics.capsule,physics.body,skip))continue;
        let supported=true;
        for(const [dx,dz] of [[.07,0],[-.07,0],[0,.07],[0,-.07]]){
          const r=new R.Ray({x:wx+dx,y:h.y+.12,z:wz+dz},{x:0,y:-1,z:0}),hit=physics.world.castRayAndGetNormal(r,.45,false,undefined,undefined,physics.capsule,physics.body,skip);
          if(!hit||hit.normal.y<.65){supported=false;break;}
        }
        if(!supported)continue;
        const node:NavNode={id:this.nodes.length,x,z,position:new T.Vector3(wx,h.y,wz),edges:[]};this.nodes.push(node);
        const key=`${x},${z}`;if(!this.columns.has(key))this.columns.set(key,[]);this.columns.get(key)!.push(node);previous=h.y;
      }
      if((x*(nz+1)+z)%32===0){progress(.65*(x*(nz+1)+z)/((nx+1)*(nz+1)));await breathe();}
    }
    if(this.cancelled)return;
    // Seed each real tread as well as the broad floor grid. A floor-sized grid
    // alone misses narrow treads and would disconnect otherwise valid stairs.
    for(const e of model.elements.values())if(/StairFlight|Ramp/.test(e.type))for(const part of model.byElement.get(e.id)??[]){
      const geometry=model.geometry.get(part.key)!,a=geometry.getAttribute('position'),indices=geometry.getIndex()!,matrix=new T.Matrix4().fromArray(part.matrix);
      for(let i=0;i<indices.count;i+=3){
        const v=[0,1,2].map(j=>new T.Vector3().fromBufferAttribute(a,indices.getX(i+j)).applyMatrix4(matrix));
        const normal=v[1].clone().sub(v[0]).cross(v[2].clone().sub(v[0])).normalize();if(Math.abs(normal.y)<.85)continue;
        const center=v[0].clone().add(v[1]).add(v[2]).divideScalar(3);
        const hit=physics.world.castRayAndGetNormal(new R.Ray({x:center.x,y:center.y+.08,z:center.z},{x:0,y:-1,z:0}),.18,false,undefined,undefined,physics.capsule,physics.body,skip);
        if(!hit||hit.normal.y<.7)continue;center.y=center.y+.08-hit.timeOfImpact+.035;
        if(physics.world.intersectionWithShape({x:center.x,y:center.y+.96,z:center.z},rotation,shape,undefined,undefined,physics.capsule,physics.body,skip))continue;
        const x=Math.round((center.x-this.origin.x)/this.cell),z=Math.round((center.z-this.origin.z)/this.cell),key=`${x},${z}`,column=this.columns.get(key)??[];
        if(column.some(n=>n.position.distanceTo(center)<.1))continue;
        const node:NavNode={id:this.nodes.length,x,z,position:center,edges:[]};this.nodes.push(node);column.push(node);this.columns.set(key,column);
      }
    }
    // Centerline samples make narrow doorways usable even when their IFC
    // placement falls between grid cells. No additional floor is invented.
    for(const door of doors.items.values())if(door.category!=='window')for(const offset of [-1,-.65,-.3,0,.3,.65,1]){
      const p=door.center.clone().addScaledVector(door.normal,offset),base=model.elementBounds(door.id).min.y;
      const hit=physics.world.castRayAndGetNormal(new R.Ray({x:p.x,y:base+.25,z:p.z},{x:0,y:-1,z:0}),.6,false,undefined,undefined,physics.capsule,physics.body,skip);
      if(!hit||hit.normal.y<.7)continue;const type=model.elements.get(physics.colliderElement.get(hit.collider.handle)??-1)?.type??'';if(!/Slab|Stair|Ramp/.test(type))continue;
      p.y=base+.25-hit.timeOfImpact+.035;
      if(physics.world.intersectionWithShape({x:p.x,y:p.y+.96,z:p.z},rotation,shape,undefined,undefined,physics.capsule,physics.body,skip))continue;
      const x=Math.round((p.x-this.origin.x)/this.cell),z=Math.round((p.z-this.origin.z)/this.cell),key=`${x},${z}`,column=this.columns.get(key)??[];
      if(column.some(n=>n.position.distanceTo(p)<.03))continue;
      const node:NavNode={id:this.nodes.length,x,z,position:p,edges:[]};this.nodes.push(node);column.push(node);this.columns.set(key,column);
    }
    const doorPlanes=[...doors.items.values()].filter(d=>d.category!=='window').map(d=>{const bounds=model.elementBounds(d.id),size=bounds.getSize(new T.Vector3());return {door:d,width:model.elements.get(d.id)?.door?.width||(Math.abs(d.normal.z)*size.x+Math.abs(d.normal.x)*size.z),bounds};});
    // Swept capsules reject corners and walls. Closed door edges remain explicit
    // portals: an AI must approach and open them before using the edge.
    for(const node of this.nodes){
      if(this.cancelled)return;
      for(const [dx,dz] of [[0,0],[1,0],[-1,0],[0,1],[0,-1],[1,1],[-1,1],[1,-1],[-1,-1]])for(const next of this.columns.get(`${node.x+dx},${node.z+dz}`)??[]){
        if(next.id<=node.id||Math.hypot(node.position.x-next.position.x,node.position.z-next.position.z)>this.cell*1.6||Math.abs(node.position.y-next.position.y)>.56)continue;
        const y=Math.max(node.position.y,next.position.y)+1.04;
        const start={x:node.position.x,y,z:node.position.z},velocity={x:next.position.x-node.position.x,y:0,z:next.position.z-node.position.z};
        if(physics.world.castShape(start,rotation,velocity,shape,.01,1,true,undefined,undefined,physics.capsule,physics.body,skip))continue;
        const hit=physics.world.castShape(start,rotation,velocity,shape,.01,1,true,undefined,undefined,physics.capsule,physics.body,c=>!physics.actors.has(c));
        const element=hit?physics.colliderElement.get(hit.collider.handle):null;
        let portal=element!=null&&doors.items.get(element)?.category!=='window'&&doors.items.has(element)?element:null;
        // Portal identity belongs to the original opening, not the leaf's current
        // collider pose. A door may be open during graph generation and close later.
        for(const {door,width,bounds} of doorPlanes){
          const ax=node.position.x-door.center.x,az=node.position.z-door.center.z,bx=next.position.x-door.center.x,bz=next.position.z-door.center.z;
          const da=ax*door.normal.x+az*door.normal.z,db=bx*door.normal.x+bz*door.normal.z,denominator=da-db;
          if(Math.min(da,db)>.32||Math.max(da,db)<-.32)continue;const t=Math.abs(denominator)>1e-7?T.MathUtils.clamp(da/denominator,0,1):.5;
          const cx=ax+(bx-ax)*t,cz=az+(bz-az)*t,lateral=cx*door.normal.z-cz*door.normal.x,height=node.position.y+(next.position.y-node.position.y)*t+.8;
          if(Math.abs(lateral)<=width*.5+.02&&height>=bounds.min.y&&height<=bounds.max.y){portal=door.id;break;}
        }
        if(element!=null&&doors.items.get(element)?.category==='window')continue;
        const cost=node.position.distanceTo(next.position);
        node.edges.push({to:next.id,door:portal,cost});next.edges.push({to:node.id,door:portal,cost});
      }
      if(node.id%128===0){progress(.65+.35*node.id/Math.max(1,this.nodes.length));await breathe();}
    }
    if(this.cancelled)return;this.ready=true;progress(1);
  }
  nearest(position:T.Vector3,maxDistance=1.3){
    const x=Math.round((position.x-this.origin.x)/this.cell),z=Math.round((position.z-this.origin.z)/this.cell);let best:NavNode|null=null,d=maxDistance*maxDistance;
    for(let i=-2;i<=2;i++)for(let j=-2;j<=2;j++)for(const n of this.columns.get(`${x+i},${z+j}`)??[]){const dy=Math.abs(n.position.y-position.y);if(dy>.8)continue;const v=n.position.distanceToSquared(position);if(v<d){d=v;best=n;}}
    return best;
  }
  path(from:NavNode,to:NavNode,doors:Doors,avoid?:Map<string,number>){
    if(from.id===to.id)return [from.id];
    const open:{id:number;score:number}[]=[{id:from.id,score:0}],cost=new Map([[from.id,0]]),parent=new Map<number,number>(),closed=new Set<number>();
    const push=(item:{id:number;score:number})=>{open.push(item);let i=open.length-1;while(i>0){const p=(i-1)>>1;if(open[p].score<=item.score)break;open[i]=open[p];i=p;}open[i]=item;};
    const pop=()=>{const first=open[0],last=open.pop()!;if(open.length){let i=0;while(i*2+1<open.length){let child=i*2+1;if(child+1<open.length&&open[child+1].score<open[child].score)child++;if(open[child].score>=last.score)break;open[i]=open[child];i=child;}open[i]=last;}return first;};
    for(let tries=0;open.length&&tries<5000;tries++){
      const {id}=pop();if(closed.has(id))continue;if(id===to.id){const path=[id];while(parent.has(path[0]))path.unshift(parent.get(path[0])!);return path;}closed.add(id);
      for(const edge of this.nodes[id].edges){if(avoid?.has(`${id}:${edge.to}`))continue;const door=edge.door!=null?doors.items.get(edge.door):null;const nextCost=cost.get(id)!+edge.cost+(door&&door.progress<.85?1.2:0);
        if(nextCost>=(cost.get(edge.to)??Infinity))continue;cost.set(edge.to,nextCost);parent.set(edge.to,id);push({id:edge.to,score:nextCost+this.nodes[edge.to].position.distanceTo(to.position)});
      }
    }return [];
  }
  dispose(){this.cancelled=true;this.nodes=[];this.columns.clear();this.ready=false;}
}
