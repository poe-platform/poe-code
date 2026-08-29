import {open,lstat,readFile,writeFile,readdir} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {dirname,resolve,join} from 'node:path';
import {fileURLToPath} from 'node:url';
const own=dirname(fileURLToPath(import.meta.url)),root=resolve(own,'../../..'),label=process.argv[2];
const outer=await open(join(own,`read-${label}.jsonl`),'wx');
await outer.write(JSON.stringify({pid:process.pid,at:new Date().toISOString(),role:'SOURCE-DATA-only'})+'\n');
try{
 const specs=process.argv.slice(3);for(const spec of specs){const [path,start='1',length='120']=spec.split('::');if(path.includes('AGENTS'))throw new Error('instructions context only');const absolute=join(root,path),stat=await lstat(absolute);if(stat.isDirectory()){console.log(JSON.stringify({path,names:await readdir(absolute)}));continue;}if(!stat.isFile()||stat.isSymbolicLink()||stat.size>512*1024)throw new Error('bounded text admission');const bytes=await readFile(absolute);await outer.write(JSON.stringify({path,size:bytes.length,mode:stat.mode&511,sha256:createHash('sha256').update(bytes).digest('hex')})+'\n');console.log(path+'\n'+bytes.toString('utf8').split('\n').slice(Number(start)-1,Number(start)-1+Number(length)).join('\n'));}
}catch(error){await outer.write(JSON.stringify({failure:String(error?.stack??error)})+'\n');process.exitCode=1;}finally{await outer.close();}
