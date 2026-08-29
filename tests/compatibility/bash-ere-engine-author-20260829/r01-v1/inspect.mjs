import { open, lstat, readFile, writeFile, readdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { dirname, resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';
const own=dirname(fileURLToPath(import.meta.url)),root=resolve(own,'../../../..');
const outer=await open(join(own,'INSPECTION.outer.jsonl'),'wx');
await outer.write(JSON.stringify({started:new Date().toISOString(),pid:process.pid,role:'source-data-only',runtime:0})+'\n');
try{
 const rows=[];
 for(const name of ['types','errors','limits','syntax','matcher']){
  const path=join(root,'src/commands/regex-execution/ere',name+'.ts'),stat=await lstat(path);
  if(!stat.isFile()||stat.isSymbolicLink()||stat.size>65536)throw new Error('source admission');
  const bytes=await readFile(path);rows.push({path,size:bytes.length,mode:stat.mode&511,sha256:createHash('sha256').update(bytes).digest('hex')});
  if(name==='matcher'||name==='types')console.log('\nSOURCE '+name+'\n'+bytes.toString('utf8'));
 }
 const directories=['tests/compatibility/bash-ere-engine-author-20260829/r02-v2','tests/compatibility/bash-ere-engine-independent-20260829','tests/compatibility/bash-ere-checkpoint-independent-20260829','tests/compatibility'];
 for(const directory of directories){const names=await readdir(join(root,directory));console.log(JSON.stringify({directory,names:directory==='tests/compatibility'?names.filter(name=>name.includes('ere')):names}));}
 await writeFile(join(own,'BASELINE-SOURCE.json'),JSON.stringify(rows,null,2)+'\n',{flag:'wx'});
}catch(error){await outer.write(JSON.stringify({failure:String(error?.stack??error)})+'\n');process.exitCode=1;}finally{await outer.close();}
