import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { gunzipSync } from 'node:zlib';
import { createHash } from 'node:crypto';
const manifest=JSON.parse(await readFile('public/models/manifest.json','utf8'));
const bytes=gunzipSync(await readFile('public/models/'+manifest.file));
if(createHash('sha256').update(bytes).digest('hex')!==manifest.sha256)throw new Error('SHA-256 do IFC restaurado não confere.');
await mkdir('reference',{recursive:true});await writeFile('reference/hotel-rex.ifc',bytes);
console.log('IFC restaurado e SHA-256 validado:',bytes.length,'bytes.');
