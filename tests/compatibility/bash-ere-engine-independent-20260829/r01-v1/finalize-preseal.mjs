import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {spawnSync} from 'node:child_process';
const own=path.resolve('tests/compatibility/bash-ere-engine-independent-20260829/r01-v1');
const hash=bytes=>crypto.createHash('sha256').update(bytes).digest('hex');
function read(file,expected,max=1048576){const stat=fs.lstatSync(file);if(!stat.isFile()||stat.isSymbolicLink()||stat.size>max)throw new Error('regular bounded preseal');const bytes=fs.readFileSync(file);if(bytes.length!==stat.size||expected&&hash(bytes)!==expected)throw new Error('preseal hash');return bytes;}
const previous=JSON.parse(read(path.join(own,'PRESEAL.json'))),seal=JSON.parse(read(previous.seal.path,previous.seal.sha256));
const stdout=fs.openSync(path.join(own,'raw/baseline-tree.stdout'),'wx',0o600),stderr=fs.openSync(path.join(own,'raw/baseline-tree.stderr'),'wx',0o600);let child;
try{child=spawnSync('/usr/bin/git',['-c','core.fsmonitor=false','ls-tree','-z',previous.baseline,'--',...['types','errors','limits','syntax','matcher'].map(name=>`src/commands/regex-execution/ere/${name}.ts`)],{stdio:['ignore',stdout,stderr],timeout:10000});}finally{fs.closeSync(stdout);fs.closeSync(stderr);}if(child.status!==0||child.signal||child.error)throw new Error('baseline tree child');
const records=read(path.join(own,'raw/baseline-tree.stdout')).toString('utf8').split('\0').filter(Boolean).map(value=>{const match=/^(100644) blob ([a-f0-9]{40})\t(.+)$/.exec(value);if(!match)throw new Error('baseline source record');return{mode:match[1],blob:match[2],path:match[3]};});
if(records.length!==5)throw new Error('baseline five');
const admission=JSON.parse(read(path.join(own,'ADMISSION.json')));
for(const record of records.filter(row=>!row.path.endsWith('/matcher.ts')))if(admission.selected.find(row=>row.path===record.path)?.blob!==record.blob)throw new Error('unchanged stored blob');
let code=read(previous.runner.path,previous.runner.sha256).toString('utf8');const deadlineChanges=[];
for(const fixture of ['consumer.mts','negative.mts']){const before=`join(location,'${fixture}')],work,120000)`,after=`join(location,'${fixture}')],work,30000)`;if(code.split(before).length!==2)throw new Error('typed deadline exact binding');code=code.replace(before,after);deadlineChanges.push({before,after});}
fs.writeFileSync(previous.runner.path,code);
const runner={...previous.runner,size:Buffer.byteLength(code),sha256:hash(Buffer.from(code))};seal.fixtures=seal.fixtures.map(row=>row.path===runner.path?runner:row);
const fixtures=[];
for(const row of seal.fixtures){const data=read(row.path,row.sha256);if(/\.(mjs|mts)$/.test(row.path)){
const source=data.toString('utf8'),imports=[...source.matchAll(/(?:from\s*|import\s*\()(['"])([^'"\n]+)\1/g)].map(match=>match[2]);
fixtures.push({path:row.path,sha256:row.sha256,imports,role:row.path===runner.path?'coordinator':row.path.endsWith('/inspect.mjs')?'inert-preparation':row.path.endsWith('/runner.mjs')?'inert-prior-coordinator':'runtime-or-type-fixture'});
if(row.path!==runner.path&&!row.path.endsWith('/inspect.mjs')&&!row.path.endsWith('/runner.mjs')&&imports.some(name=>/^node:(?:child_process|worker_threads|net|http|https|tls|vm)$/.test(name)))throw new Error('fixture disallowed capability');
}}
const sealedBytes=Buffer.from(JSON.stringify(seal,null,2)+'\n');fs.writeFileSync(previous.seal.path,sealedBytes);
const ownExecutables=['admit.mjs','novel.mjs','prepare.mjs','finalize-preseal.mjs'].map(name=>{const bytes=read(path.join(own,name));return{name,bytes:bytes.length,sha256:hash(bytes)};});
const result={...previous,runner,seal:{...previous.seal,size:sealedBytes.length,sha256:hash(sealedBytes)},deadlineChanges,fixtures,baselineStoredBlobs:records,metadataChild:{pid:child.pid,status:child.status,signal:child.signal},ownExecutables,argv:[runner.path,'run','ACTUAL-01'],launchCwd:path.dirname(runner.path),launchNode:previous.node.path,completed:new Date().toISOString(),phase:'SOURCE_ONLY_PRESEAL'};
fs.writeFileSync(path.join(own,'FINAL-PRESEAL.json'),JSON.stringify(result,null,2)+'\n',{flag:'wx',mode:0o600});console.log(JSON.stringify({runner:result.runner,seal:result.seal,fixtures:result.fixtures,baselineStoredBlobs:records,argv:result.argv,completed:result.completed}));
