import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {resolve,join} from 'node:path';
import {createHash} from 'node:crypto';
import {build,version} from 'esbuild';
import {reserveSqliteCallbackSlots,sqliteUnicodeCallback} from './native-assets.ts';
const [sourceArgument,outputArgument]=process.argv.slice(2);
if(!sourceArgument||!outputArgument||process.argv.length!==4)throw new Error('Usage: npm run prepare:native -- SOURCE_PACKAGE OUTPUT_DIRECTORY');
const source=resolve(sourceArgument),output=resolve(outputArgument);
const manifest=JSON.parse(await readFile(new URL('../src/native/sources.json',import.meta.url),'utf8'));
if(version!==manifest.tools.esbuild)throw new Error('Pinned esbuild version differs');
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const sources=new Map();
for(const [path,expected] of Object.entries(manifest.sources)){
 const bytes=await readFile(join(source,path));if(sha(bytes)!==expected)throw new Error('Pinned SQLite source differs: '+path);sources.set(path,bytes);
}
const bundle=await build({entryPoints:[join(source,'src/FacadeVFS.js')],bundle:true,write:false,minify:true,format:'esm',platform:'neutral',target:'es2022',metafile:true});
for(const input of Object.keys(bundle.metafile.inputs))if(!Object.keys(manifest.sources).some(path=>resolve(input)===join(source,path)))throw new Error('Unpinned SQLite source dependency: '+input);
const artifacts=new Map([
 ['native.mjs',sources.get('dist/wa-sqlite-async.mjs')],
 ['native.wasm',reserveSqliteCallbackSlots(sources.get('dist/wa-sqlite-async.wasm'),64)],
 ['callback.wasm',sqliteUnicodeCallback()],
 ['vfs.mjs',bundle.outputFiles[0].contents],
 ['LICENSE',sources.get('LICENSE')],
]);
const encoded=[artifacts.get('native.wasm'),artifacts.get('callback.wasm')].map(bytes=>JSON.stringify(Buffer.from(bytes).toString('base64')));
artifacts.set('node-assets.mjs',Buffer.from("import {Buffer} from 'node:buffer';\nexport const modules = await Promise.all(["+encoded.map(value=>"WebAssembly.compile(Buffer.from("+value+", 'base64'))").join(',')+"]);\n"));
await mkdir(output,{recursive:true});
for(const [name,bytes] of artifacts)await writeFile(join(output,name),bytes);
const report={...manifest,artifacts:Object.fromEntries([...artifacts].map(([name,bytes])=>[name,{bytes:bytes.length,sha256:sha(bytes)}]))};
await writeFile(join(output,'sources.json'),JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify(report.artifacts));
