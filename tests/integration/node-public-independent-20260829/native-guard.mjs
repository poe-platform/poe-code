import fs from 'node:fs';
import {registerHooks} from 'node:module';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
const base=fileURLToPath(new URL('.',import.meta.url));
const manifest=JSON.parse(fs.readFileSync(base+'manifest.json','utf8'));
const rows=new Map(manifest.map(row=>[row.path,row]));let count=0;
function bound(url){const filename=fileURLToPath(url),row=rows.get(filename);if(!row)throw Error('NATIVE_UNBOUND '+filename);const stat=fs.lstatSync(filename);if(!stat.isFile()||stat.isSymbolicLink()||stat.size!==row.bytes)throw Error('NATIVE_SIZE');const body=fs.readFileSync(filename);if(createHash('sha256').update(body).digest('hex')!==row.sha256)throw Error('NATIVE_HASH');return{row,body};}
registerHooks({
 resolve(specifier,context,next){if(specifier.startsWith('node:')){const importer=bound(context.parentURL);if(!importer.row.builtins.includes(specifier))throw Error('NATIVE_BUILTIN_EDGE');return next(specifier,context);}const result=next(specifier,context);if(result.url.startsWith('file:'))bound(result.url);if(specifier==='virtual-bash'||specifier==='virtual-bash/commands/node')fs.writeSync(2,'@@NATIVE_RESOLVE '+JSON.stringify({specifier,url:result.url,native:true})+'\n');return result;},
 load(url,context,next){if(url.startsWith('node:'))return next(url,context);const selected=bound(url);if(++count>2048)throw Error('NATIVE_LOAD_CAP');fs.writeSync(2,'@@NATIVE_LOAD '+JSON.stringify({path:fileURLToPath(url),sha256:selected.row.sha256})+'\n');return{format:'module',source:selected.body,shortCircuit:true};}
});
