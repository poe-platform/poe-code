import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import assert from 'node:assert/strict';
const root=path.dirname(new URL(import.meta.url).pathname);
const hash=bytes=>crypto.createHash('sha256').update(bytes).digest('hex');
function regular(file){const stat=fs.lstatSync(file);assert(stat.isFile()&&!stat.isSymbolicLink()&&stat.size<=16777216);const bytes=fs.readFileSync(file);assert.equal(bytes.length,stat.size);return{path:file,bytes:bytes.length,sha256:hash(bytes)};}
try{
const captures=[],owners=[],children=[];
for(const mode of ['old-publication','prepare','seal','cohort','report']){
 const stdout='/tmp/native26-review-v2-'+mode+'-20260829.stdout',stderr='/tmp/native26-review-v2-'+mode+'-20260829.stderr';captures.push(regular(stdout),regular(stderr));
 const output=JSON.parse(fs.readFileSync(stdout,'utf8')),capture=output.capture;
 assert(capture.startsWith('/tmp/native26-review-v2-'+mode+'-'));
 const rows=fs.readFileSync(capture+'/events.jsonl','utf8').trim().split('\n').map(line=>JSON.parse(line));
 const start=rows.find(row=>row.event==='owner-start'),end=rows.find(row=>row.event==='owner-complete');assert(start&&end&&start.pid===end.pid&&end.code===0);owners.push({mode,pid:start.pid,start:start.at,end:end.at});
 for(const enrolled of rows.filter(row=>row.event==='enrolled')){const closed=rows.find(row=>row.event==='close'&&row.pid===enrolled.pid);assert(closed&&closed.spawnSeen&&closed.exitSeen&&closed.signal===null&&!closed.errorPresent&&!closed.timedOut);children.push({mode,label:enrolled.label,pid:enrolled.pid,close:closed});}
 for(const name of fs.readdirSync(capture).sort())captures.push(regular(capture+'/'+name));
}
for(const stem of ['bootstrap','accounting-patch','accounting-revision'])for(const stream of ['stdout','stderr'])captures.push(regular('/tmp/native26-review-v2-'+stem+'-20260829.'+stream));
const fixtures=['normal','ignore-term'].map(name=>JSON.parse(fs.readFileSync(root+'/raw/lifecycle-'+name+'.json','utf8')));for(const row of fixtures)assert(row.exit&&row.close&&row.retired&&row.group.state==='absent');
const totalCaptureBytes=captures.reduce((total,pin)=>total+pin.bytes,0);assert(totalCaptureBytes<=67108864);
const result={schema:'native26-review-v2-known-role-accounting',at:new Date().toISOString(),owners,managedChildren:children,fixtures:fixtures.map(row=>({id:row.id,pid:row.pid,exit:row.exit,close:row.close,retired:row.retired,group:row.group})),administrativeRoles:[{name:'bootstrap exec apply_patch',count:1,pidRecorded:false},{name:'initial owner syntax Node child before old-publication exec',count:1,pidRecorded:false},{name:'accounting exec apply_patch initial and revision',count:2,pidRecorded:false},{name:'this metadata helper',count:1,pid:process.pid},{name:'metadata helper syntax Node child',count:1,pidRecorded:false}],knownRolesThroughThisHelper:owners.length+children.length+fixtures.length+6,remainingPlannedRoles:[{name:'publication owner',count:1},{name:'publication Git stage/commit/status',count:3},{name:'final bounded file reader',count:1}],allExpectedKnownRolesAtHandoff:owners.length+children.length+fixtures.length+11,roleBudget:64,peakDirect:3,peakCeiling:4,controllerProcesses:1,fixtureProcesses:2,Bash:0,Workers:0,asyncLoaders:0,observedCaptureBytesBeforeFinalPublication:totalCaptureBytes,captures,qualifications:['role tally includes invocation and explicit utilities, not toolcall census','initial syntax/apply_patch PIDs not recorded; successful tool completion observed','no full transitive/tool-wrapper/OS global census claimed; reserved headroom not observed processes','publication and final reader are prospective here; final external publication journal/return completes their observations','fresh native owner-group policy is source/control-qualified only; no native execution']};
assert(result.allExpectedKnownRolesAtHandoff<=64);fs.writeFileSync(root+'/ACCOUNTING.json',JSON.stringify(result,null,2)+'\n',{flag:'wx',mode:0o600});console.log(JSON.stringify({known:result.knownRolesThroughThisHelper,plannedFinal:result.allExpectedKnownRolesAtHandoff,captureBytes:totalCaptureBytes}));
}catch(reason){console.error(reason);process.exitCode=1;}
