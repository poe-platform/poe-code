import fs from 'node:fs';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {pathToFileURL} from 'node:url';
const root="/Users/kjopek/Workspace/safe-bash/tests/compatibility/bash-function-keyword-author-20260829/k08-harness-v2",work="/private/tmp/safe-bash-k08-preexec-v2-1O68JM";const seal=JSON.parse(fs.readFileSync(root+'/FIXTURE-SEAL.json'));
for(const [name,pin]of Object.entries(seal.files)){const raw=fs.readFileSync(root+'/'+name);assert.equal(raw.length,pin.bytes);assert.equal(createHash('sha256').update(raw).digest('hex'),pin.sha256);}
const {runDirect}=await import(pathToFileURL(root+'/direct-child.mjs'));const {pinExecutable}=await import(pathToFileURL(root+'/auth.mjs'));pinExecutable(seal.node);
const controller=new AbortController(),ledger={starts:0,maximum:1,active:0,stopped:false,captureBytes:0,captureMaximum:65536,rows:[]},started=Date.now();
const timer=setTimeout(()=>controller.abort(0),300);let child;
try{child=await runDirect({id:'harmless-owned-drain',node:seal.node,args:seal.childArgs,cwd:work,env:seal.childEnv,capture:work+'/fixture-capture/child',timeoutMs:5000,bodyDeadline:started+6000,finalDeadline:started+8000,signal:controller.signal},ledger);}finally{clearTimeout(timer);}
const observation={schema:'k08-harness-v2-owned-drain-fixture',row:child.row,primaryPresent:child.primary.present,primaryIsZero:Object.is(child.primary.reason,0),ledger,started,finished:Date.now(),qualification:'One fixed harmless Node child; injected owner cancellation, actual childTERM/KILL/exit/close/EOF. Not actual product or external ownerTERM proof.'};
process.stdout.write(JSON.stringify(observation)+'\n');
assert.equal(child.primary.present,true);assert.ok(Object.is(child.primary.reason,0));assert.equal(child.row.knownOutstanding,0);assert.equal(child.row.exit,true);assert.equal(child.row.close,true);assert.equal(child.row.stdoutEOF,true);assert.equal(child.row.stderrEOF,true);assert.equal(child.row.capturesQualified,true);assert.equal(child.row.forced,true);assert.equal(child.row.captures.find(row=>row.kind==='stdout').base64,'UkVBRFkK');assert.deepEqual(child.row.signals.map(row=>row.signal),['SIGTERM','SIGKILL']);assert.equal(ledger.active,0);
