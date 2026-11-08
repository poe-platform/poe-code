import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
const own=path.dirname(fileURLToPath(import.meta.url));
const source='/tmp/core-public-pilot-review-20260829';
const hash=bytes=>crypto.createHash('sha256').update(bytes).digest('hex');
fs.mkdirSync(own+'/raw');const rows=[];
for(const name of ['startup.stdout','startup.stderr','inspect.stdout','inspect.stderr','core.stdout','core.stderr','stop-edit.stdout','stop-edit.stderr']){const filename=source+'/'+name;const stat=fs.lstatSync(filename);assert.ok(stat.isFile()&&!stat.isSymbolicLink()&&stat.size<1048576);const bytes=fs.readFileSync(filename);fs.writeFileSync(own+'/raw/'+name,bytes,{flag:'wx'});rows.push({path:name,bytes:bytes.length,sha256:hash(bytes)});}
const missing=[];for(const name of ['schedule.stdout','schedule.stderr']){let absent=false;try{fs.lstatSync(source+'/'+name);}catch(error){if(error.code==='ENOENT')absent=true;else throw error;}missing.push({path:name,absent});}
const receipt={utc:new Date().toISOString(),verdict:'HOLD_REVIEWER_STARTUP_CAPTURE_STOP',candidate:'a3a6330f36534753e18dfb6d3a429d6b41117570',assignedProfile:'446f44cea9091ce59a12c5591bc1d6e91049003848bef33bd75f520c98728aa6',completeCandidateAdmission:false,authorControlsExecuted:0,novelControlsExecuted:0,productImports:0,Workers:0,managedChildren:0,observedFailedNodeExit:1,failedDiagnosticCapture:'tool transcript only; not reconstructed',priorCapturedFiles:rows,failedLocalCapturePaths:missing,knownConservativeIncludingPublicationReadout:14,maximumKnownOS:36,peak:2,retirement:'inspection/tool commands returned; no spawned owned child or Worker; no global census',activeOwnedChildren:0};
fs.writeFileSync(own+'/STOP-RECEIPT.json',JSON.stringify(receipt,null,2)+'\n',{flag:'wx'});
const relative=path.relative(process.cwd(),own);for(const args of [['add','--',relative],['commit','--only','-m','test: preserve CORE public pilot reviewer startup capture stop','--',relative],['status','--porcelain','--',relative],['rev-parse','HEAD']]){const child=spawnSync('/usr/bin/git',['-c','gc.auto=0','-c','maintenance.auto=false',...args],{stdio:['ignore',1,2]});assert.equal(child.status,0);}
console.log(JSON.stringify({utc:new Date().toISOString(),verdict:receipt.verdict,receiptSha256:hash(fs.readFileSync(own+'/STOP-RECEIPT.json')),priorCapturedBytes:rows.reduce((sum,row)=>sum+row.bytes,0),failedLocalCapturePaths:missing,activeOwnedChildren:0}));
