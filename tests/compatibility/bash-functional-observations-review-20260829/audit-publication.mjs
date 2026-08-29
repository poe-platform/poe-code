import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import {gunzipSync} from 'node:zlib';
import assert from 'node:assert/strict';
const home=path.dirname(fileURLToPath(import.meta.url));
const hash=body=>createHash('sha256').update(body).digest('hex');
const decode=body=>JSON.parse(gunzipSync(Buffer.from(body.toString().trim(),'base64'),{maxOutputLength:8388608}));
const inputs=decode(fs.readFileSync(home+'/m02-INPUTS.json.gz.base64'));
const snapshots=decode(fs.readFileSync(home+'/SUPPLEMENTARY-LOCATORS.json.gz.base64'));
const closedSnapshot=snapshots.find(row=>row.filename.endsWith('/CLOSED.json'));
const captureSnapshot=snapshots.find(row=>row.filename.endsWith('/FINAL-CAPTURE.json.gz'));
assert(closedSnapshot.available&&captureSnapshot.available);
const closure=JSON.parse(Buffer.from(closedSnapshot.base64,'base64')),compressed=Buffer.from(captureSnapshot.base64,'base64');
assert.equal(hash(compressed),closure.finalCapture.sha256);assert.equal(compressed.length,closure.finalCapture.bytes);
const final=JSON.parse(gunzipSync(compressed,{maxOutputLength:4194304}));
for(const row of final.files){const body=Buffer.from(row.base64,'base64');assert.equal(body.length,row.bytes);assert.equal(hash(body),row.sha256);}
const get=name=>Buffer.from(final.files.find(row=>row.path===name).base64,'base64');
const state=JSON.parse(get('STATE.json')),events=get('EVENTS.jsonl').toString().trim().split('\n').map(JSON.parse);
assert.equal(state.children.length,13);assert.equal(state.active,0);assert.equal(state.halted,false);assert.equal(events.length,26);
let previous=state.started,bytes=0;
for(const row of state.children){assert(row.started>=previous);assert(row.finished>=row.started&&row.finished<state.deadline);previous=row.finished;for(const key of ['exit','close','stdoutEOF','stderrEOF'])assert.equal(row[key],true);assert.equal(row.status,0);assert.equal(row.signal,null);assert.deepEqual(row.errors,[]);const captured=final.files.filter(file=>file.path.startsWith(String(row.number).padStart(3,'0')+'-')&&/\.(stdout|stderr)$/u.test(file.path)).reduce((sum,file)=>sum+file.bytes,0);assert.equal(captured,row.bytes);bytes+=captured;const pair=events.filter(event=>event.row.number===row.number);assert.deepEqual(pair.map(event=>event.event),['ENROLLED','RETIRED']);assert.deepEqual(pair[1].row,row);}
assert.equal(bytes,3918);assert.equal(closure.totalNewKnownStarts,38+state.children.length);assert.equal(closure.activeOwnedChildren,0);assert.equal(closure.closedAt-closure.preflightStarted,closure.elapsedInclusiveMs);assert(closure.closedAt<closure.outerInclusiveDeadline&&closure.closedAt<closure.entryDeadline&&closure.closedAt<closure.fixedGrantDeadline);
const inventory=JSON.parse(fs.readFileSync(home+'/m01-INVENTORY.json'));const oldArchive=inputs.find(row=>row.oid===inventory.find(item=>item.path.endsWith('/actual-v1/ADMIN-CAPTURE.json.gz.base64')).oid);const old=decode(Buffer.from(oldArchive.body,'base64'));
const changed=[];for(const file of old.files){const next=final.files.find(row=>row.path===file.path);assert(next);if(next.sha256!==file.sha256)changed.push(file.path);else assert.equal(next.base64,file.base64);}
assert.deepEqual(changed,['EVENTS.jsonl','STATE.json']);
const oldState=JSON.parse(Buffer.from(old.files.find(row=>row.path==='STATE.json').base64,'base64'));assert.deepEqual(state.children.slice(0,8),oldState.children);
const result={created:new Date().toISOString(),qualification:'Freshly acquired supplementary closure; now byte-sealed here, NOT part of original664 publication',archiveSha256:hash(compressed),closureSha256:closedSnapshot.sha256,adminChildren:13,firstEightMatchImmutableArchive:true,allExitCloseBothEOF:true,adminStdoutStderrBytes:bytes,totalNewKnownStarts:51,existingCoordinator:1,reportedKnownPeak:3,activeOwned:0,closedAt:closure.closedAt,closedUTC:new Date(closure.closedAt).toISOString(),inclusiveMs:closure.elapsedInclusiveMs,deadlineUTC:new Date(closure.outerInclusiveDeadline).toISOString(),limits:closure.limits,transitiveCensus:'NOT_OBSERVED',ownerExit:'author-recorded tool response, not owner-group census',targetExecutions:0};
fs.writeFileSync(home+'/PUBLICATION-AUDIT.json',JSON.stringify(result,null,2)+'\n',{flag:'wx'});console.log(JSON.stringify(result));
