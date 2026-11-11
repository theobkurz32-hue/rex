import http from 'node:http';
import { createReadStream, existsSync, openSync, writeFileSync } from 'node:fs';
import { stat } from 'node:fs/promises';
import { resolve, extname, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
const project=fileURLToPath(new URL('..',import.meta.url)),root=resolve(project,'dist'),port=4173;
if(!existsSync(resolve(root,'index.html')))throw new Error('Build ausente. Execute node scripts/run.mjs build.');
if(process.argv.includes('--background')){
  let running=false;try{const r=await fetch(`http://127.0.0.1:${port}/`,{signal:AbortSignal.timeout(1500)});running=r.ok;}catch{}
  if(running){console.log(`Aplicação já acessível em http://127.0.0.1:${port}/`);process.exit(0);}
  const log=openSync(resolve(project,'server.log'),'a');
  const child=spawn(process.execPath,[fileURLToPath(import.meta.url)],{cwd:project,detached:true,windowsHide:true,stdio:['ignore',log,log]});child.unref();writeFileSync(resolve(project,'server.pid'),String(child.pid));
  for(let i=0;i<20;i++){try{const r=await fetch(`http://127.0.0.1:${port}/`,{method:'HEAD',signal:AbortSignal.timeout(500)});if(r.ok){console.log(`Servidor local pronto (PID ${child.pid}): http://127.0.0.1:${port}/`);process.exit(0);}}catch{}await new Promise(r=>setTimeout(r,250));}
  throw new Error('O servidor não respondeu. Consulte server.log.');
}else{
  const mime={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.wasm':'application/wasm','.ifc':'application/octet-stream','.json':'application/json','.png':'image/png','.svg':'image/svg+xml'};
  http.createServer(async(req,res)=>{try{const path=decodeURIComponent(new URL(req.url,'http://localhost').pathname),file=resolve(root,'.'+(path==='/'?'/index.html':path));if(!file.startsWith(root+sep)){res.writeHead(403);res.end();return;}const info=await stat(file);if(!info.isFile()){res.writeHead(404);res.end();return;}res.writeHead(200,{'content-type':mime[extname(file)]??'application/octet-stream','content-length':info.size,'cache-control':'no-cache','x-hotel-rex-server':'1'});if(req.method==='HEAD')res.end();else createReadStream(file).pipe(res);}catch{res.writeHead(404);res.end('Arquivo não encontrado.');}}).listen(port,'127.0.0.1',()=>console.log(`HOTEL REX: http://127.0.0.1:${port}/`));
}
