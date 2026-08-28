import assert from 'node:assert/strict';
import {readFileSync,writeFileSync,mkdirSync,copyFileSync,fstatSync} from 'node:fs';
import {join} from 'node:path';
import {pathToFileURL} from 'node:url';
const supplied=JSON.parse(readFileSync(process.argv[2]));
const load=name=>import(pathToFileURL(join(supplied.driver,name)).href);
const {openFencedWorker}=await load('fenced-supervisor.mjs');
const scope=openFencedWorker();
const root=scope.envelope.roots[0].path,output=scope.envelope.roots[1].path;
const temporary=join(root,'component');mkdirSync(temporary);mkdirSync(join(temporary,'harness'));
const input={...supplied,root,output};writeFileSync(join(root,'input.json'),JSON.stringify(input));
copyFileSync(supplied.probe,join(root,'probe.mjs'));
copyFileSync(supplied.guard,join(temporary,'harness','guard.mjs'));
writeFileSync(join(temporary,'harness','expected.json'),'{}');
const {createBuildAudit}=await load('build-types.mjs');const audit=createBuildAudit(root,temporary);
const {createPhaseRunner}=await load('phase-runner.mjs');
const report={phases:[]},completed=[];
const environment={PATH:'/usr/bin:/bin',HOME:join(root,'home'),TMPDIR:join(root,'tmp'),TMP:join(root,'tmp'),TEMP:join(root,'tmp'),LANG:'C',LC_ALL:'C',FULL_GATE_ROOT:root,FULL_GATE_SOURCE:root,FULL_GATE_EXPECTED:join(temporary,'harness','expected.json'),FULL_GATE_TOOL_ROOTS:'[]'};
const phase=createPhaseRunner({completed,report,source:root,output,environment,guard:join(temporary,'harness','guard.mjs'),verify:async()=>assert.equal(readFileSync(join(root,'probe.mjs'),'utf8'),readFileSync(supplied.probe,'utf8')),requireOrdered:(actual,next)=>assert.equal(next,supplied.phases[actual.length]),audit,supervision:scope.supervise});
for(const label of supplied.phases){const row=await phase(label,[join(root,'probe.mjs'),join(root,'input.json'),label],root,0,20000);if(row.status!==0)throw Error('Independent probe failed: '+label);}
const descriptors=[];for(let descriptor=0;descriptor<128;descriptor++){try{const stat=fstatSync(descriptor);descriptors.push({descriptor,regular:stat.isFile(),device:stat.dev,inode:stat.ino});assert.ok(!(stat.isFile()&&stat.dev===input.canaryIdentity.device&&stat.ino===input.canaryIdentity.inode));}catch(error){if(error.code!=='EBADF')throw error;}}
writeFileSync(join(output,'INDEPENDENT-WORKER.json'),JSON.stringify({report,descriptors,componentOnly:true,fullGate:false},null,2));
if(process.connected)process.disconnect();
