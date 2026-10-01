import {readFile,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {gzipSync} from 'node:zlib';
import {createRequire} from 'node:module';
import {build} from 'esbuild';
import {unzipSync} from 'fflate';
import {meterPythonWasm} from './meter-python.mjs';
const require=createRequire(import.meta.url);
const root=new URL('../',import.meta.url);
const wasm=gzipSync(meterPythonWasm(await readFile(require.resolve('@antonz/python-wasi/dist/python.wasm'))),{level:9}).toString('base64');
const files={};
for(const entry of JSON.parse(await readFile(new URL('vendor/python/manifest.json',root),'utf8'))){
 const bytes=await readFile(new URL('vendor/python/'+entry.file,root));
 if(createHash('sha256').update(bytes).digest('hex')!==entry.sha256)throw new Error('Python wheel digest mismatch: '+entry.file);
 for(const [path,data] of Object.entries(unzipSync(bytes))){
  if(path.endsWith('/'))continue;
  if(path.split('/').some(part=>part==='..'||part===''))throw new Error('Invalid wheel member');
  if(files[path])throw new Error('Duplicate wheel member: '+path);
  files[path]=Buffer.from(data).toString('base64');
 }
}
const libraries=gzipSync(JSON.stringify(files),{level:9}).toString('base64');
const result=await build({entryPoints:[new URL('src/python-wasi-worker.ts',root).pathname],bundle:true,platform:'neutral',format:'esm',target:'es2022',write:false,external:['node:worker_threads'],define:{PYTHON_WASM:JSON.stringify(wasm),PYTHON_LIBRARIES:JSON.stringify(libraries)}});
await writeFile(new URL('dist/python-worker-source.js',root),'export const source = '+JSON.stringify(result.outputFiles[0].text)+';\n');
await writeFile(new URL('dist/python-worker-source.d.ts',root),'export declare const source: string;\n');
