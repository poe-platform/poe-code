import {readFileSync,lstatSync,writeSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {registerHooks} from 'node:module';
const manifestPath=fileURLToPath(new URL('../load-manifest.json',import.meta.url));
const stat=lstatSync(manifestPath);if(!stat.isFile()||stat.isSymbolicLink()||stat.size>2097152)throw new Error('AUTHOR_LOAD_MANIFEST_ADMISSION');
const manifest=JSON.parse(readFileSync(manifestPath,'utf8'));const files=new Map(manifest.files.map(row=>[row.path,row]));let records=0;
function bound(url){const path=fileURLToPath(url);const row=files.get(path);if(!row)throw new Error('AUTHOR_LOAD_UNLISTED '+path);const stat=lstatSync(path);if(!stat.isFile()||stat.isSymbolicLink()||stat.size!==row.bytes||stat.size>262144)throw new Error('AUTHOR_LOAD_SIZE '+path);const body=readFileSync(path);const sha=createHash('sha256').update(body).digest('hex');if(sha!==row.sha256)throw new Error('AUTHOR_LOAD_HASH '+path);return {path,row,body};}
function resolve(specifier,context,next){
  if(specifier.startsWith('node:')){if(!context.parentURL?.startsWith('file:'))throw new Error('AUTHOR_LOAD_BUILTIN_ORIGIN');const importer=bound(context.parentURL);if(!importer.row.builtins.includes(specifier))throw new Error('AUTHOR_LOAD_BUILTIN_EDGE');return next(specifier,context);}
  if(!(specifier.startsWith('./')||specifier.startsWith('../')||specifier.startsWith('/')||specifier.startsWith('file:')))throw new Error('AUTHOR_LOAD_PACKAGE_FALLBACK');
  const url=specifier.startsWith('file:')?new URL(specifier):specifier.startsWith('/')?pathToFileURL(specifier):new URL(specifier,context.parentURL);
  if(url.search||url.hash)throw new Error('AUTHOR_LOAD_QUERY');bound(url.href);return next(specifier,context);
}
function load(url,context,next){
  if(url.startsWith('node:'))return next(url,context);
  const item=bound(url);if(++records>2048)throw new Error('AUTHOR_LOAD_COUNT');const line='@@NODE_LOAD '+JSON.stringify({path:item.path,bytes:item.row.bytes,sha256:item.row.sha256})+'\n';const buffer=Buffer.from(line);let offset=0;while(offset<buffer.length){const written=writeSync(2,buffer,offset,buffer.length-offset);if(written===0)throw new Error('AUTHOR_LOAD_CAPTURE_ZERO');offset+=written;}
  return {format:'module',source:item.body,shortCircuit:true};
}
if(typeof registerHooks!=='function')throw new Error('AUTHOR_SYNC_HOOK_UNAVAILABLE');
registerHooks({resolve,load});
