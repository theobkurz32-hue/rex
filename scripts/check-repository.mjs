import { readFile, readdir, stat } from 'node:fs/promises';
import { resolve, relative } from 'node:path';
import { gunzipSync } from 'node:zlib';
import { createHash } from 'node:crypto';
const manifest=JSON.parse(await readFile('public/models/manifest.json','utf8'));
const compressed=await readFile('public/models/'+manifest.file),restored=gunzipSync(compressed);
if(compressed.length>=100*1024*1024)throw new Error('O modelo compactado ultrapassa o limite de arquivo do GitHub.');
if(restored.length!==manifest.originalBytes||createHash('sha256').update(restored).digest('hex')!==manifest.sha256)throw new Error('O modelo compactado não reproduz o IFC original.');
const root=resolve('dist');async function scan(dir){for(const item of await readdir(dir,{withFileTypes:true})){const path=resolve(dir,item.name);if(item.isDirectory())await scan(path);else if((await stat(path)).size>100*1024*1024)throw new Error('Asset não compactado no build: '+relative(root,path));}}
await scan(root);for(const file of ['index.html','wasm/web-ifc.wasm','models/'+manifest.file])await stat(resolve(root,file));
console.log('Build e modelo íntegros. Maior asset do modelo:',compressed.length,'bytes. Sem arquivos de 100 MiB no build.');
