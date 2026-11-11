import * as T from 'three';
/** Vertex clustering for dense decorative IFC meshes. Collision geometry is never changed. */
export function simplifyDecorativeGeometry(source:T.BufferGeometry){
  const indices=source.getIndex(),position=source.getAttribute('position'),normal=source.getAttribute('normal');
  if(!indices||indices.count<1800||!normal)return null;
  source.computeBoundingBox();const diagonal=source.boundingBox!.getSize(new T.Vector3()).length();
  const cell=T.MathUtils.clamp(diagonal/75,.001,.015),buckets=new Map<string,number>(),map=new Uint32Array(position.count);
  const vertices:number[]=[],normals:number[]=[],counts:number[]=[];
  for(let i=0;i<position.count;i++){
    const x=position.getX(i),y=position.getY(i),z=position.getZ(i),nx=normal.getX(i),ny=normal.getY(i),nz=normal.getZ(i);
    const key=`${Math.round(x/cell)},${Math.round(y/cell)},${Math.round(z/cell)}/${Math.round(nx*4)},${Math.round(ny*4)},${Math.round(nz*4)}`;
    let id=buckets.get(key);if(id==null){id=counts.length;buckets.set(key,id);vertices.push(0,0,0);normals.push(0,0,0);counts.push(0);}map[i]=id;counts[id]++;
    vertices[id*3]+=x;vertices[id*3+1]+=y;vertices[id*3+2]+=z;normals[id*3]+=nx;normals[id*3+1]+=ny;normals[id*3+2]+=nz;
  }
  const output:number[]=[];for(let i=0;i<indices.count;i+=3){const a=map[indices.getX(i)],b=map[indices.getX(i+1)],c=map[indices.getX(i+2)];if(a!==b&&b!==c&&a!==c)output.push(a,b,c);}
  if(output.length<3||output.length>indices.count*.85)return null;
  for(let i=0;i<counts.length;i++){vertices[i*3]/=counts[i];vertices[i*3+1]/=counts[i];vertices[i*3+2]/=counts[i];const length=Math.hypot(normals[i*3],normals[i*3+1],normals[i*3+2])||1;normals[i*3]/=length;normals[i*3+1]/=length;normals[i*3+2]/=length;}
  const g=new T.BufferGeometry();g.setAttribute('position',new T.Float32BufferAttribute(vertices,3));g.setAttribute('normal',new T.Float32BufferAttribute(normals,3));g.setIndex(output);
  // Original bounds prevent a detail change from prematurely culling an object.
  g.boundingBox=source.boundingBox!.clone();g.boundingSphere=source.boundingBox!.getBoundingSphere(new T.Sphere());g.userData.maxDisplacement=Math.sqrt(3)*cell;
  return g;
}
