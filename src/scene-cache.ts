import { gunzipSync } from 'fflate';
import type { GeometryData, Metadata, Part } from './types';

interface SceneManifest {
  version:number; sourceSha256:string; parserVersion:string; meta:Metadata; audit:any;
  chunks:{file:string;bytes:number;sha256:string}[]; propertiesBase:string;
}

// Hosts may already decode Content-Encoding. Never try to inflate plain bytes twice.
export function unpackGzip(bytes:Uint8Array){return bytes[0]===0x1f&&bytes[1]===0x8b?gunzipSync(bytes):bytes;}

export function decodeSceneChunk(bytes:Uint8Array):{definitions:GeometryData[];parts:Part[]} {
  if(bytes.byteOffset%4)bytes=bytes.slice();
  if(bytes.byteLength<4)throw new Error('Bloco do hotel incompleto. Tente carregar novamente.');
  const view=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength),length=view.getUint32(0,true);
  if(length>bytes.byteLength-4)throw new Error('Cabeçalho do hotel incompleto.');
  const header=JSON.parse(new TextDecoder().decode(bytes.subarray(4,4+length)));
  let offset=Math.ceil((4+length)/4)*4;
  const definitions:GeometryData[]=header.definitions.map((d:{key:number;vertexLength:number;indexLength:number})=>{
    const size=(d.vertexLength+d.indexLength)*4;
    if(!Number.isSafeInteger(size)||size<0||offset+size>bytes.byteLength)throw new Error('Geometria do hotel incompleta.');
    const vertices=new Float32Array(bytes.buffer,bytes.byteOffset+offset,d.vertexLength);offset+=vertices.byteLength;
    const indices=new Uint32Array(bytes.buffer,bytes.byteOffset+offset,d.indexLength);offset+=indices.byteLength;
    return {key:d.key,vertices,indices};
  });
  if(offset!==bytes.byteLength)throw new Error('Tamanho inválido do bloco do hotel.');
  return {definitions,parts:header.parts};
}

export class HotelScene {
  private properties=new Map<number,Promise<Record<string,any>>>();
  private constructor(public manifest:SceneManifest,private base:URL,private signal:AbortSignal){}
  static async open(base:URL,signal:AbortSignal){
    const [response,original]=await Promise.all([fetch(new URL('manifest.json',base),{signal,cache:'no-cache'}),fetch(new URL('../manifest.json',base),{signal,cache:'no-cache'})]);
    if(!response.ok||!original.ok)throw new Error('Não foi possível baixar a versão preparada do hotel. Tente novamente.');
    const manifest:SceneManifest=await response.json(),source=await original.json();
    if(manifest.version!==1||manifest.sourceSha256!==source.sha256||!manifest.chunks?.length)throw new Error('A versão preparada do hotel precisa ser atualizada. Recarregue a página.');
    return new HotelScene(manifest,base,signal);
  }
  private async bytes(file:string){
    const response=await fetch(new URL(file,this.base),{signal:this.signal});
    if(!response.ok)throw new Error(`Não foi possível baixar uma parte do hotel (HTTP ${response.status}). Tente novamente.`);
    return new Uint8Array(await response.arrayBuffer());
  }
  async load(add:(definitions:GeometryData[],parts:Part[])=>void,progress:(done:number,total:number)=>void){
    let done=0;const total=this.manifest.chunks.reduce((n,c)=>n+c.bytes,0);
    // Sequential small buffers keep the IFC source and its parser out of browser memory.
    for(const chunk of this.manifest.chunks){
      const compressed=await this.bytes(chunk.file);
      if(this.signal.aborted)throw new DOMException('Importação substituída','AbortError');
      const {definitions,parts}=decodeSceneChunk(unpackGzip(compressed));add(definitions,parts);
      done+=chunk.bytes;progress(done,total);await new Promise<void>(resolve=>setTimeout(resolve,0));
    }
  }
  async property(id:number){
    const bucket=Math.floor(id/1000);let pending=this.properties.get(bucket);
    if(!pending){
      // Keep at most two property groups; they can be fetched again after eviction.
      if(this.properties.size>=2)this.properties.delete(this.properties.keys().next().value!);
      pending=this.bytes(`${this.manifest.propertiesBase}${bucket}.json.gz`).then(bytes=>JSON.parse(new TextDecoder().decode(unpackGzip(bytes))));
      this.properties.set(bucket,pending);pending.catch(()=>this.properties.delete(bucket));
    }
    const data=(await pending)[id];if(!data)throw new Error('Propriedades não encontradas para este elemento.');return data;
  }
}
