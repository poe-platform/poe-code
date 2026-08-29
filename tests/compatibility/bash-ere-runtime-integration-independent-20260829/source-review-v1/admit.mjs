import fs from 'node:fs';
import crypto from 'node:crypto';
import {spawnSync} from 'node:child_process';
const own='tests/compatibility/bash-ere-runtime-integration-independent-20260829/source-review-v1';
const candidate='e013f817fd7700c59a144c395c80dc25856e4157',prior='27cf475704b1fef96d0923a23369b6578464b062';
const sha=(bytes,algorithm='sha256')=>crypto.createHash(algorithm).update(bytes).digest('hex');
const rows=[],children=[];
function add(name,ref){rows.push({name,ref});}
add('core-catalog',`${prior}:tests/compatibility/bash-ere-runtime-integration-design-20260829/CORE-SOURCE.json.data`);
for(const name of ['BINDINGS.json','SEAL.json','CASEMAP.json','PRESEAL.md'])add(`author-${name}`,`${candidate}:tests/compatibility/bash-ere-runtime-integration-author-20260829/${name}`);
for(const name of ['parser','conditional','runtime','shell'])add(`candidate-${name}`,`${candidate}:src/shell/${name}.ts`);
for(const name of ['parser','conditional','runtime','shell','cancellation','cleanup','arrays/bindings','arrays/state','arrays/ledger'])add(`baseline-${name.replace('/','-')}`,`${prior}:tests/compatibility/bash-ere-runtime-integration-design-20260829/selected/src__shell__${name.replaceAll('/','__')}.ts.data`);
for(const name of ['types','errors','limits','syntax','matcher'])add(`engine-${name}`,`72187e5abc1179883f85a63e1ef558f2e141c542:src/commands/regex-execution/ere/${name}.ts`);
for(const name of ['root','protocol','owner','accounting','worker','validation','wire'])add(`transport-${name}`,`02782056c436c9f2a8319f73a9eb8e2b4b5aebd5:src/commands/regex-execution/ere/transport/${name}.ts`);
add('references',`${prior}:tests/compatibility/bash-ere-runtime-integration-design-20260829/docs/references.data`);
add('hosts',`${prior}:tests/compatibility/bash-ere-runtime-integration-design-20260829/docs/hosts.data`);
add('control-policy',`e158a9382071db465da3dab66dadea9f85fc2174:tests/compatibility/bash-ere-runtime-integration-design-20260829/error-control-flow/HANDOFF.md`);
function git(label,args,input){const stdout=fs.openSync(`${own}/raw/${label}.stdout`,'wx',0o600),stderr=fs.openSync(`${own}/raw/${label}.stderr`,'wx',0o600);let result;try{result=spawnSync('/usr/bin/git',['-c','core.fsmonitor=false',...args],{input,stdio:['pipe',stdout,stderr],timeout:15000});}finally{fs.closeSync(stdout);fs.closeSync(stderr);}children.push({label,pid:result.pid,status:result.status,signal:result.signal,error:result.error?.message});if(result.status!==0||result.signal||result.error)throw new Error(`Git ${label} retirement`);const file=`${own}/raw/${label}.stdout`,stat=fs.lstatSync(file);if(!stat.isFile()||stat.size>8388608)throw new Error('capture bound');return fs.readFileSync(file);}
const metadata=git('metadata',['cat-file','--batch-check'],Buffer.from(rows.map(row=>row.ref).join('\n')+'\n')).toString('ascii').trimEnd().split('\n');
if(metadata.length!==rows.length||rows.length>48)throw new Error('metadata count');
let total=0;
for(let index=0;index<rows.length;index++){const record=/^([a-f0-9]{40}) blob (\d+)$/.exec(metadata[index]);if(!record)throw new Error(`explicit input unavailable: ${rows[index].ref}`);Object.assign(rows[index],{blob:record[1],size:Number(record[2])});total+=Number(record[2]);if(Number(record[2])>1048576||total>4194304)throw new Error('source size cap');}
const raw=git('blobs',['cat-file','--batch'],Buffer.from(rows.map(row=>row.blob).join('\n')+'\n'));let offset=0;
fs.mkdirSync(`${own}/inputs`,{recursive:true});
for(const row of rows){const newline=raw.indexOf(10,offset);if(raw.subarray(offset,newline).toString('ascii')!==`${row.blob} blob ${row.size}`)throw new Error('blob framing');const bytes=raw.subarray(newline+1,newline+1+row.size);if(raw[newline+row.size+1]!==10||sha(Buffer.concat([Buffer.from(`blob ${row.size}\0`),bytes]),'sha1')!==row.blob)throw new Error('blob content');row.sha256=sha(bytes);row.copy=`${own}/inputs/${row.name}.data`;fs.writeFileSync(row.copy,bytes,{flag:'wx',mode:0o600});offset=newline+row.size+2;}
if(offset!==raw.length)throw new Error('trailing bytes');
const catalogRow=rows.find(row=>row.name==='core-catalog');if(catalogRow.sha256!=='12a5806df9ea13eb66e99bec1f0c0c3198bfeb76da012559d943a4d874070fc4')throw new Error('CORE catalog identity');
const decode=name=>{const row=rows.find(row=>row.name===name),bytes=fs.readFileSync(row.copy);if(sha(bytes)!==row.sha256)throw new Error('immutable copied source');return new TextDecoder('utf8',{fatal:true}).decode(bytes);};
const catalog=JSON.parse(decode('core-catalog'));if(catalog.inputs.length!==293||catalog.computedTree!=='bf079ada185a79aec864b068f3738ddc5520822e')throw new Error('CORE composition');
for(const row of rows.filter(row=>row.name.startsWith('baseline-'))){const name=row.name.slice(9).replace('arrays-','arrays/'),binding=catalog.inputs.find(item=>item.path===`src/shell/${name}.ts`);if(!binding||binding.sha256!==row.sha256)throw new Error('CORE selected source');}
const casemap=JSON.parse(decode('author-CASEMAP.json'));const bindings=JSON.parse(decode('author-BINDINGS.json')),seal=JSON.parse(decode('author-SEAL.json'));
const result={candidate,baseline:catalog.computedTree,totalBytes:total,rows,children,caseMapTopKeys:Object.keys(casemap),bindingsTopKeys:Object.keys(bindings),sealTopKeys:Object.keys(seal),completed:new Date().toISOString(),targetExecutions:0};
fs.writeFileSync(`${own}/ADMISSION.json`,JSON.stringify(result,null,2)+'\n',{flag:'wx',mode:0o600});
console.log(JSON.stringify({...result,rows:rows.map(row=>({name:row.name,blob:row.blob,size:row.size,sha256:row.sha256}))},null,2));
