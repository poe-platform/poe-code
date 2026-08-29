import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
const repo='/Users/kjopek/Workspace/safe-bash';
const scope=path.join(repo,'tests/integration/agent-bash-coherent-author-20260829/stage-a');
const prior=path.join(scope,'../v2');
const digest=bytes=>crypto.createHash('sha256').update(bytes).digest('hex');
function read(filename,maximum=1048576,expected) {
  const metadata=fs.lstatSync(filename); assert.ok(metadata.isFile()&&!metadata.isSymbolicLink()&&metadata.size<=maximum);
  if(expected)assert.equal(metadata.size,expected.bytes);
  const bytes=fs.readFileSync(filename); assert.equal(bytes.length,metadata.size);
  if(expected)assert.equal(digest(bytes),expected.sha256);return bytes;
}
const sourceBytes=read(path.join(prior,'SOURCE.json'));
assert.equal(digest(sourceBytes),'ef0b79dbd30cebec3f8b939a98928b9441947ff4be724e5031b2ee03925f26ae');
const source=JSON.parse(sourceBytes);assert.equal(source.inputs.length,309);
const toolsBytes=read(path.join(prior,'TOOLS.json'));
const tools=JSON.parse(toolsBytes);
const captures=path.join(scope,'capture');
let children=0;
function git(args,input) {
 const label='inspect-git-'+children++;const stdout=fs.openSync(path.join(captures,label+'.stdout'),'wx'),stderr=fs.openSync(path.join(captures,label+'.stderr'),'wx');let result;
 try{result=spawnSync('/usr/bin/git',args,{cwd:repo,env:{PATH:'/usr/bin:/bin',GIT_OPTIONAL_LOCKS:'0',HOME:'/tmp'},input,stdio:['pipe',stdout,stderr],timeout:10000});}finally{fs.closeSync(stdout);fs.closeSync(stderr);}
 fs.appendFileSync(path.join(captures,'inspect-events.jsonl'),JSON.stringify({args,pid:result.pid,status:result.status,signal:result.signal,error:result.error?.code})+'\n');
 assert.equal(result.status,0);assert.equal(result.signal,null);assert.equal(result.error,undefined);return read(path.join(captures,label+'.stdout'),1048576);
}
git(['status','--porcelain=v1','-z','--untracked-files=no']);git(['diff','--cached','--name-only','-z']);
const selected=source.inputs.filter(row=>['package.json','tsconfig.build.json','tsconfig.json'].includes(row.path));
const metadata=git(['cat-file','--batch-check=%(objectname) %(objecttype) %(objectsize)'],selected.map(row=>row.blob).join('\n')+'\n').toString().trim().split('\n');
metadata.forEach((line,index)=>assert.equal(line,`${selected[index].blob} blob ${selected[index].bytes}`));
const batch=git(['cat-file','--batch'],selected.map(row=>row.blob).join('\n')+'\n');let offset=0;const objects={};
for(const row of selected){const end=batch.indexOf(10,offset);assert.equal(batch.subarray(offset,end).toString(),`${row.blob} blob ${row.bytes}`);const body=batch.subarray(end+1,end+1+row.bytes);assert.equal(digest(body),row.sha256);assert.equal(batch[end+1+row.bytes],10);objects[row.path]=JSON.parse(body);offset=end+row.bytes+2;}assert.equal(offset,batch.length);
const result={started:new Date().toISOString(),sourceTree:source.computedTree,sourceInputs:source.inputs.length,toolsBytes:toolsBytes.length,toolsSha256:digest(toolsBytes),tools,objects,children,productExecutions:0};
fs.writeFileSync(path.join(scope,'INSPECTION.json'),JSON.stringify(result,null,2)+'\n',{flag:'wx'});
console.log(JSON.stringify({sourceTree:result.sourceTree,sourceInputs:309,toolsTopKeys:Object.keys(tools),packages:Object.fromEntries(Object.entries(tools.packages).map(([name,value])=>[name,{version:value.version,rows:value.rows.length}])),objects,children},null,2));
