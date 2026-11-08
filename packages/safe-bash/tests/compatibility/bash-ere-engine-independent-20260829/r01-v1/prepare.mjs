import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {spawnSync} from 'node:child_process';
const repo=process.cwd(),own=path.join(repo,'tests/compatibility/bash-ere-engine-independent-20260829/r01-v1'),closure=path.join(own,'closure');
const sha=bytes=>crypto.createHash('sha256').update(bytes).digest('hex');
let total=0;
function bytes(file,expected,maximum=16777216){const stat=fs.lstatSync(file);if(!stat.isFile()||stat.isSymbolicLink()||stat.size>maximum)throw new Error(`regular size ${file}`);const descriptor=fs.openSync(file,fs.constants.O_RDONLY|fs.constants.O_NOFOLLOW);let value;try{const opened=fs.fstatSync(descriptor);if(stat.dev!==opened.dev||stat.ino!==opened.ino||stat.size!==opened.size)throw new Error('inode');value=fs.readFileSync(descriptor);}finally{fs.closeSync(descriptor);}if(value.length!==stat.size||expected&&sha(value)!==expected)throw new Error(`hash ${file}`);total+=value.length;if(total>134217728)throw new Error('aggregate preparation read cap');return value;}
function text(file,expected){return new TextDecoder('utf8',{fatal:true}).decode(bytes(file,expected));}
function identity(file){const stat=fs.lstatSync(file);if(!stat.isFile()||stat.isSymbolicLink()||stat.size>134217728)throw new Error('tool regular bound');const digest=crypto.createHash('sha256'),descriptor=fs.openSync(file,'r'),buffer=Buffer.alloc(65536);let count=0;try{let read;while((read=fs.readSync(descriptor,buffer,0,buffer.length,null))!==0){count+=read;if(count>stat.size)throw new Error('tool growing');digest.update(buffer.subarray(0,read));}}finally{fs.closeSync(descriptor);}if(count!==stat.size)throw new Error('tool size');return{path:file,size:count,mode:stat.mode&511,sha256:digest.digest('hex')};}
const original=JSON.parse(text(path.join(own,'inputs/SEAL.json.data'),'c87cadc0ca841bc3c07bd4110fbce3419b696ecae331ed433bc7bb1a0f5945b0'));
if(JSON.stringify(identity(original.node.path))!==JSON.stringify(original.node)||process.execPath!==original.node.path)throw new Error('Node tool identity');
const admission=JSON.parse(text(path.join(own,'ADMISSION.json'))),base=JSON.parse(text(path.join(own,'inputs/BASELINE-SOURCE.json.data')));
const mappings=[];fs.mkdirSync(closure,{recursive:false});
function project(row,sourceOverride){if(!row.path.startsWith(repo+'/')||row.path.includes('/../'))throw new Error('projection domain');const source=sourceOverride??row.path;const value=bytes(source,row.sha256);if(value.length!==row.size)throw new Error('row size');if(!sourceOverride&&(fs.lstatSync(source).mode&511)!==row.mode)throw new Error('source mode');const destination=path.join(closure,path.relative(repo,row.path));fs.mkdirSync(path.dirname(destination),{recursive:true});if(fs.existsSync(destination)){if(sha(bytes(destination))!==row.sha256)throw new Error('overlap');}else{fs.writeFileSync(destination,value,{flag:'wx',mode:row.mode});fs.chmodSync(destination,row.mode);}mappings.push({source:row.path,destination,sha256:row.sha256,size:row.size,sourceMode:sourceOverride?'stored-Git-100644':row.mode,projectedMode:row.mode});return{...row,path:destination};}
const seal={...original,node:original.node};
seal.sources=original.sources.map(row=>{const stored=admission.selected.find(item=>item.path===path.relative(repo,row.path));if(!stored||stored.sha256!==row.sha256||stored.mode!=='100644')throw new Error('candidate source mapping');return project(row,path.join(repo,stored.copy));});
seal.originals=original.originals.map(row=>project(row));
seal.fixtures=original.fixtures.map(row=>project(row));
seal.tools=original.tools.map(row=>project(row));
seal.compiler=path.join(closure,path.relative(repo,original.compiler));
const unchanged=original.sources.filter(row=>!row.path.endsWith('/matcher.ts')).map(row=>{const old=base.find(item=>item.path===row.path);if(JSON.stringify(row)!==JSON.stringify(old))throw new Error('unchanged four');return row.sha256;});
const old=base.find(row=>row.path.endsWith('/matcher.ts')),oldOutput=path.join(own,'raw/baseline-matcher.stdout'),oldError=path.join(own,'raw/baseline-matcher.stderr');
const stdout=fs.openSync(oldOutput,'wx',0o600),stderr=fs.openSync(oldError,'wx',0o600);let child;try{child=spawnSync('/usr/bin/git',['-c','core.fsmonitor=false','cat-file','blob',`${original.engineBaseline}:src/commands/regex-execution/ere/matcher.ts`],{stdio:['ignore',stdout,stderr],timeout:10000});}finally{fs.closeSync(stdout);fs.closeSync(stderr);}if(child.status!==0||child.signal||child.error)throw new Error('baseline Git retirement');
const oldText=text(oldOutput,old.sha256),newText=text(path.join(own,'inputs/engine-matcher.ts.data'),original.sources.find(row=>row.path.endsWith('/matcher.ts')).sha256);
const helper=newText.slice(newText.indexOf('async function resetDescendants('),newText.indexOf('export async function matchEre'));
let reverted=newText.replace(helper,'').replace('          const captures = node.child.captured ? await resetDescendants(node.child, state.captures, ledger, signal) : state.captures;\n','').replace('next: close })), captures, state.histories);','next: close })), state.captures, state.histories);');
if(reverted!==oldText)throw new Error('one-file delta exceeds reset helper and call');
const authorOwn=path.join(closure,'tests/compatibility/bash-ere-engine-author-20260829/r01-v1'),runner=path.join(authorOwn,'runner.mjs');
let code=text(runner);const changes=[];
function change(before,after){if(code.split(before).length!==2)throw new Error(`unique rewrite ${before}`);code=code.replace(before,after);changes.push({before,after});}
change("if(kind==='author'){", "if(kind==='novel'){args=[join(own,'novel.mjs'),directory];expected=24;}else if(kind==='author'){");
change("['author','checkpoint','empty','policy','reporting']", "['author','checkpoint','empty','policy','reporting','novel']");
change("assert.equal(receipts.length,28,'SAFETY child census')", "assert.equal(receipts.length,33,'SAFETY child census')");
change("  for(const spec of transforms){", "  transforms.push({id:'M04-reset-precharge',kind:'reporting',selection:'R03-copy-admission',change:async()=>{const needle='ledger.charge(\"allocationUnits\", previous.length + 3, signal);';assert.equal(original.split(needle).length,2);return original.replace(needle,'');}});\n  for(const spec of transforms){");
change('await writing;await stdout.close();await stderr.close();','await writing;await stdout.sync();await stderr.sync();await stdout.close();await stderr.close();');
fs.writeFileSync(runner,code);const novel=path.join(authorOwn,'novel.mjs');fs.copyFileSync(path.join(own,'novel.mjs'),novel);fs.chmodSync(novel,0o644);
seal.fixtures=seal.fixtures.map(row=>row.path===runner?identity(runner):row);seal.fixtures.push(identity(novel));
fs.writeFileSync(path.join(authorOwn,'SEAL.json'),JSON.stringify(seal,null,2)+'\n',{flag:'wx',mode:0o644});
const review={sourceCommit:'72187e5abc1179883f85a63e1ef558f2e141c542',authorSealSha256:'c87cadc0ca841bc3c07bd4110fbce3419b696ecae331ed433bc7bb1a0f5945b0',baseline:original.engineBaseline,unchanged,exactRevertedMatcherEqual:true,matcherSha256:sha(Buffer.from(newText)),changes,mappings,node:original.node,compiler:seal.compiler,runner:identity(runner),seal:identity(path.join(authorOwn,'SEAL.json')),novel:identity(novel),tools:seal.tools.length,fixtures:seal.fixtures.length,sources:seal.sources.length,knownMetadataChild:{pid:child.pid,status:child.status,signal:child.signal},totalPreparationBytes:total,completed:new Date().toISOString(),executionPlan:{authorGroups:354,novelGroups:72,layoutGroups:426,runtimeCohorts:18,typeGroups:6,negativeDiagnostics:9,mutantFamilies:4,mutantAndRestoreChildren:8,bindingRefusals:2,buildChildren:1,executionChildren:33,maximumChildren:40,coordinatorMinutes:30,overallMinutes:35,perCaseMilliseconds:30000,buildMilliseconds:120000,peak:2,coordinatorCaptureBytes:67108864,coordinatorWorkingBytes:536870912}};
fs.writeFileSync(path.join(own,'PRESEAL.json'),JSON.stringify(review,null,2)+'\n',{flag:'wx',mode:0o600});console.log(JSON.stringify({...review,mappings:review.mappings.length,changes:review.changes.map(row=>row.before)}));
