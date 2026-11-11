import { mkdir, copyFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
const require = createRequire(import.meta.url);
const dir = dirname(require.resolve('web-ifc'));
await mkdir('public/wasm', {recursive:true});
await copyFile(join(dir,'web-ifc.wasm'), 'public/wasm/web-ifc.wasm');
console.log('WASM web-ifc copiado. Rapier compat inclui seu WASM no bundle local.');
