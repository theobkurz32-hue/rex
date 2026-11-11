export interface ElementInfo { id:number; type:string; name:string|null; guid:string|null; storey:number|null; door?:{width:number;height:number;operation:string}; window?:{width:number;height:number;operation:string}; }
export interface Level { id:number; name:string; elevation:number|null; worldY:number|null; }
export interface GeometryData { key:number; vertices:Float32Array; indices:Uint32Array; }
export interface Part { id:number; key:number; matrix:number[]; color:number[]; }
export interface Metadata { schema:string; unit:string; unitFactor:number; levels:Level[]; elements:ElementInfo[]; counts:Record<string,number>; spatial:Record<number,number>; header:unknown; }
export interface ModelAudit { coordination:number[]; bounds:number[]; geometryElements:number; parts:number; triangles:number; empty:number[]; errors:unknown; parserScale:number; }
export type Mode='orbit'|'walk'|'fly';
