import * as T from 'three';
import type { ElementInfo } from './types';

// Dense furniture is an obstacle to a human capsule. Enclose each original part,
// retaining the gaps between parts and the full IFC shape for display/queries.
export function canSimplifyCollider(element:ElementInfo|undefined,geometry:T.BufferGeometry){
  if(!element||geometry.getIndex()!.count/3<=600)return false;
  const name=(element.name??'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase();
  if(/parede|wall|piso|floor|laje|slab|escada|stair|pilar|column|viga|beam|rampa|ramp|cobert|estrutura|porta|door|janela|window/.test(name))return false;
  return /IfcFurnishingElement|IfcFlowTerminal/.test(element.type)||element.type==='IfcBuildingElementProxy'&&/cuba|fogao|espelho|vaso|palmeira|planta|cortina|cadeira|mesa|armario|cama|sofa|bancada|geladeira|televis|luminaria|torneira|chuveiro/.test(name);
}

export function furnitureColliderGeometry(source:T.BufferGeometry){
  if(!source.boundingBox)source.computeBoundingBox();
  const box=source.boundingBox!.clone(),center=box.getCenter(new T.Vector3()),size=box.getSize(new T.Vector3());
  size.set(Math.max(.002,size.x),Math.max(.002,size.y),Math.max(.002,size.z));box.setFromCenterAndSize(center,size);
  const vertices=new Float32Array(24);
  for(let i=0;i<8;i++)vertices.set([i&1?box.max.x:box.min.x,i&2?box.max.y:box.min.y,i&4?box.max.z:box.min.z],i*3);
  const geometry=new T.BufferGeometry();geometry.setAttribute('position',new T.BufferAttribute(vertices,3));
  geometry.setIndex([0,2,1,1,2,3,4,5,6,5,7,6,0,1,4,1,5,4,2,6,3,3,6,7,0,4,2,2,4,6,1,3,5,3,7,5]);
  return geometry;
}
