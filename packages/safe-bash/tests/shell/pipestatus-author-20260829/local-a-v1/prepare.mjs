import fs from 'node:fs';
import {createHash} from 'node:crypto';
import {spawnSync} from 'node:child_process';
const repo='/Users/kjopek/Workspace/safe-bash',own=repo+'/tests/shell/pipestatus-author-20260829/local-a-v1';
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
function read(filename){const stat=fs.lstatSync(filename);if(!stat.isFile()||stat.isSymbolicLink()||stat.size>1048576)throw Error('SOURCE_BOUND');return fs.readFileSync(filename);}
const child=spawnSync('/usr/bin/git',['-c','gc.auto=0','-c','maintenance.auto=false','show','2e6d59787df9d1949d9e342fbd2769cb76240651:src/shell/runtime.ts'],{cwd:repo,encoding:null,maxBuffer:1048576,timeout:10000});
fs.writeFileSync(own+'/BASE.stderr',child.stderr??Buffer.alloc(0),{flag:'wx'});if(child.error||child.signal||child.status!==0)throw Error('BASE_GIT');
const base=child.stdout,current=read(repo+'/src/shell/runtime.ts');fs.writeFileSync(own+'/runtime-base.data',base,{flag:'wx'});
const scripts=JSON.parse(read(own+'/cases.json'));
const previous=JSON.parse(read(repo+'/tests/shell/pipestatus-author-20260829/preexec-v1/SEAL-v2.json'));
if(scripts[0].script!==previous.cases.find(row=>row.id==='R17').script)throw Error('R17_FIXTURE_DRIFT');
const names=['PRESEAL.md','cases.json','prepare.mjs','pure.mjs'];
const files=names.map(name=>{const filename=own+'/'+name,bytes=read(filename);return {path:filename,bytes:bytes.length,sha256:hash(bytes)};});
const seal={baseCommit:'2e6d59787df9d1949d9e342fbd2769cb76240651',base:{path:own+'/runtime-base.data',bytes:base.length,sha256:hash(base)},source:{path:repo+'/src/shell/runtime.ts',bytes:current.length,sha256:hash(current)},files,groups:20,fullRuntimeExecutions:0,compilerCalls:0};
fs.writeFileSync(own+'/SEAL.json',JSON.stringify(seal,null,2)+'\n',{flag:'wx'});console.log(JSON.stringify(seal.source));
