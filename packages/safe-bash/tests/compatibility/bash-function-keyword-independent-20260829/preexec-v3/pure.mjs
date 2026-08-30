import fs from 'node:fs';
import assert from 'node:assert/strict';
import {fileURLToPath} from 'node:url';
import {replay} from './author-pure.mjs';
import {replayPrior} from './prior-eight.mjs';
import {readPinned,hash} from './frozen/auth.mjs';
import {collect} from './frozen/collector-core.mjs';
import {caseArguments} from './frozen/profile.mjs';
import {validateCanonicalRole} from './frozen/canonical.mjs';
const root=fileURLToPath(new URL('.',import.meta.url));const stat=fs.lstatSync(root+'STATE.json');assert.ok(stat.isFile()&&stat.size<32768);const state=JSON.parse(fs.readFileSync(root+'STATE.json'));
const author=[],prior=[];replay(state.work,state,root+'frozen',author);replayPrior(state,prior);
const readiness=[],ledger={starts:1,maximum:3,active:0,stopped:false,captureBytes:0,captureMaximum:4194304,rows:[]};
for(const item of state.roles){const role=JSON.parse(readPinned(item.rolePath,item.rolePin));validateCanonicalRole(state.work,role,item.env);const child=await collect({id:role.id,node:state.node,args:caseArguments(role),cwd:role.app,env:item.env,capture:item.capture,timeoutMs:5000,bodyDeadline:state.deadline-10000,finalDeadline:state.deadline},ledger);readiness.push(child.row);if(!child.row.qualified)break;assert.equal(child.row.status,0);assert.equal(child.row.captures.find(row=>row.kind==='stdout').base64,item.expectedStdoutBase64);assert.equal(child.row.captures.find(row=>row.kind==='stderr').base64,item.expectedStderrBase64);const traceStat=fs.lstatSync(role.trace);assert.ok(traceStat.isFile()&&traceStat.size<65536);const bytes=fs.readFileSync(role.trace);const events=bytes.toString().trim().split('\n').map(line=>JSON.parse(line));assert.equal(events.filter(row=>row.event==='permission-admitted').length,1);assert.equal(events.filter(row=>row.event==='synchronous-hooks-installed').length,1);child.row.trace={bytes:bytes.length,sha256:hash(bytes),events};}
const result={author,prior,readiness,ledger,productImports:0,workerStarts:0};fs.writeFileSync(root+'RESULT.json',JSON.stringify(result,null,2)+'\n',{flag:'wx'});console.log(JSON.stringify({authorPassed:author.length,priorPassed:prior.filter(row=>row.pass).length,priorTotal:prior.length,readinessQualified:readiness.filter(row=>row.qualified).length}));if(prior.some(row=>!row.pass)||readiness.length!==2||readiness.some(row=>!row.qualified))process.exitCode=1;
