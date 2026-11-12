import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
const require=createRequire(import.meta.url);
process.chdir(fileURLToPath(new URL('..',import.meta.url)));
const command=process.argv[2]??'dev';
const vite=join(dirname(require.resolve('vite/package.json')),'bin/vite.js');
const tsc=join(dirname(require.resolve('typescript/package.json')),'bin/tsc');
function run(args){return new Promise((resolve,reject)=>{const child=spawn(process.execPath,args,{stdio:'inherit',windowsHide:true});child.on('error',reject);child.on('exit',code=>code===0?resolve():reject(new Error(`Comando terminou com código ${code}`)));});}
if(command==='build'){await run([tsc,'--noEmit']);await run(['scripts/prepare-hotel-scene.mjs']);await run([vite,'build']);}
else if(command==='dev'){await run(['scripts/prepare-hotel-scene.mjs']);await run([vite,'--host','127.0.0.1','--port','5173','--strictPort']);}
else if(command==='preview')await run([vite,'preview','--host','127.0.0.1','--port','4173','--strictPort']);
else throw new Error('Use node scripts/run.mjs dev | build | preview');
