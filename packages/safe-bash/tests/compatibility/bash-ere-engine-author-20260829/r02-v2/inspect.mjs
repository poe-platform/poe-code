import {open,lstat,readFile,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {dirname,resolve,join} from 'node:path';
import {fileURLToPath} from 'node:url';
const own=dirname(fileURLToPath(import.meta.url)),root=resolve(own,'../../../..');
const outer=await open(join(own,'PREP.outer.jsonl'),'wx');
await outer.write(JSON.stringify({start:new Date().toISOString(),pid:process.pid,productExecution:false})+'\n');
try {
  const inputs=[];
  for(const path of ['tests/compatibility/bash-ere-checkpoint-independent-20260829/REPORT.md','tests/compatibility/bash-ere-checkpoint-independent-20260829/novel.mjs','src/commands/regex-execution/ere/syntax.ts']) {
    const absolute=join(root,path),stat=await lstat(absolute); if(!stat.isFile()||stat.isSymbolicLink()||stat.size>65536)throw new Error('text admission');
    const bytes=await readFile(absolute); inputs.push({path:absolute,size:bytes.length,mode:stat.mode&511,sha256:createHash('sha256').update(bytes).digest('hex')});
    console.log(`---${path}---\n${bytes.toString('utf8')}`);
  }
  await writeFile(join(own,'INSPECTION.json'),JSON.stringify(inputs,null,2)+'\n',{flag:'wx'});
}catch(error){await outer.write(JSON.stringify({failure:String(error)})+'\n');process.exitCode=1;}finally{await outer.close();}
