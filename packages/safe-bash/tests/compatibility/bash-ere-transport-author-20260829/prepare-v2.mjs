import { open, readFile, writeFile, lstat } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
const own=dirname(fileURLToPath(import.meta.url));
const outer=await open(join(own,'PREPARE-v2.outer.jsonl'),'wx');
await outer.write(JSON.stringify({started:new Date().toISOString(),pid:process.pid,role:'source-only exact helper versioning'})+'\n');
try{
  const path=join(own,'typecheck.mjs'),stat=await lstat(path);
  if(!stat.isFile()||stat.isSymbolicLink()||stat.size>32768)throw new Error('helper admission');
  const bytes=await readFile(path),seal=JSON.parse(await readFile(join(own,'SEAL.json'),'utf8'));
  const expected=seal.fixtures.find(row=>row.path===path);
  if(!expected||expected.size!==bytes.length||expected.sha256!==createHash('sha256').update(bytes).digest('hex'))throw new Error('helper identity');
  let source=bytes.toString('utf8');
  const replacements=[
    ["phase==='seal'","phase==='seal-v2'"], ["phase!=='seal'","phase!=='seal-v2'"], ["phase==='types'","phase==='types-v2'"],
    ["/^TYPE-0[1-2]$/","/^TYPE-02$/"], ["'SEAL.outer.jsonl'","'SEAL-v2.outer.jsonl'"], ["'SEAL.json'","'SEAL-v2.json'"],
    ["'SEAL-RESULT.json'","'SEAL-v2-RESULT.json'"],
    ["'PRESEAL.md','typecheck.mjs'","'PRESEAL.md','typecheck-v2.mjs','REVISION-v2.md'"],
  ];
  for(const [from,to]of replacements){if(!source.includes(from))throw new Error('version delta missing '+from);source=source.split(from).join(to);}
  await writeFile(join(own,'typecheck-v2.mjs'),source,{flag:'wx'});
  await outer.write(JSON.stringify({changes:replacements,sha256:createHash('sha256').update(source).digest('hex'),runtimeImports:0})+'\n');
}catch(error){await outer.write(JSON.stringify({failure:String(error?.stack??error)})+'\n');process.exitCode=1;}finally{await outer.close();}
