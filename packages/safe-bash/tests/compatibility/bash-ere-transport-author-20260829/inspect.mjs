import {open,lstat,readFile,writeFile,readdir} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {dirname,resolve,join} from 'node:path';
import {fileURLToPath} from 'node:url';
const own=dirname(fileURLToPath(import.meta.url)),root=resolve(own,'../../..');
const outer=await open(join(own,'INSPECTION.outer.jsonl'),'wx');
await outer.write(JSON.stringify({start:new Date().toISOString(),pid:process.pid,productExecution:false})+'\n');
try {
  const records=[];
  const paths=['tests/compatibility/bash-ere-transport-design-20260829/README.md','tests/compatibility/bash-ere-transport-design-20260829/DECISIONS-v2.md','tests/compatibility/bash-ere-transport-design-20260829/ROOT-RATIFICATION-v1.md'];
  for(const path of paths){const absolute=join(root,path),stat=await lstat(absolute);if(!stat.isFile()||stat.isSymbolicLink()||stat.size>131072)throw new Error('text admission');const bytes=await readFile(absolute);records.push({path,size:bytes.length,mode:stat.mode&511,sha256:createHash('sha256').update(bytes).digest('hex')});console.log(JSON.stringify(records.at(-1)));}
  console.log(JSON.stringify({designFiles:await readdir(join(root,'tests/compatibility/bash-ere-transport-design-20260829'))}));
  await writeFile(join(own,'INSPECTION.json'),JSON.stringify(records,null,2)+'\n',{flag:'wx'});
}catch(error){await outer.write(JSON.stringify({failure:String(error?.stack??error)})+'\n');process.exitCode=1;}finally{await outer.close();}
