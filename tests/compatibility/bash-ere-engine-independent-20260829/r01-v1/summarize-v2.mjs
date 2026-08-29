import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import assert from 'node:assert/strict';
const own=path.resolve('tests/compatibility/bash-ere-engine-independent-20260829/r01-v1');
const digest=bytes=>crypto.createHash('sha256').update(bytes).digest('hex');
function read(file,expected,max=16777216){const stat=fs.lstatSync(file);assert.ok(stat.isFile()&&!stat.isSymbolicLink()&&stat.size<=max);const bytes=fs.readFileSync(file);assert.equal(bytes.length,stat.size);if(expected)assert.equal(digest(bytes),expected);return bytes;}
const bootstrap=JSON.parse(read(path.join(own,'raw/actual-bootstrap.stdout')).toString('utf8'));
assert.equal(bootstrap.resultSha256,'016d3d567661c1a24505e48e08671d7eddfd2ab34261b5440c701e65248a422f');assert.equal(bootstrap.code,0);
const result=JSON.parse(read(bootstrap.sourceResult,bootstrap.resultSha256).toString('utf8'));
const ordinary=result.rows.filter(row=>!row.mutated&&!row.role.endsWith('-restored'));
const groups=ordinary.flatMap(row=>row.observed.rows.map(item=>({layout:row.role.split('-')[0],cohort:row.kind,id:item.id,pass:item.pass,role:row.role,sourceCommit:'72187e5abc1179883f85a63e1ef558f2e141c542'})));
assert.equal(groups.length,426);assert.equal(groups.filter(row=>row.cohort!=='novel').length,354);assert.ok(groups.every(row=>row.pass));
assert.equal(new Set(groups.map(row=>`${row.layout}/${row.cohort}/${row.id}`)).size,426);
const originalIds=['I01-parent-optional-reset','I02-parent-alternative-reset','I03-nested-parent-reset','I04-manual-example','I05-finite-parent-reset','I06-parent-zero-iteration','I23-finite-reset-property'];
const layouts=['source','installed','moved'].map(layout=>{
 const selected=groups.filter(row=>row.layout===layout),policy=selected.filter(row=>row.cohort==='policy');
 const retainedOriginals=policy.filter(row=>originalIds.includes(row.id));assert.deepEqual(retainedOriginals.map(row=>row.id),originalIds);
 const cohorts=Object.fromEntries(['author','checkpoint','empty','policy','reporting','novel'].map(kind=>[kind,selected.filter(row=>row.cohort===kind).length]));
 assert.deepEqual(cohorts,{author:66,checkpoint:8,empty:4,policy:24,reporting:16,novel:24});
 const native=selected.filter(row=>row.cohort==='reporting'&&/^N\d\d$/.test(row.id));assert.equal(native.length,12);
 return{layout,groups:selected.length,cohorts,originalR01:retainedOriginals.map(row=>row.id),nativeVisible:native.map(row=>row.id),r02Overlap:78,r02UnchangedAssertions:77,r02VersionedE12:1};
});
assert.equal(result.types.length,3);assert.ok(result.types.every(row=>row.pass&&row.positive===0&&row.negative===2));
for(const row of result.types)assert.deepEqual(row.diagnostics,[2345,2339,2322]);
assert.equal(result.receipts.filter(row=>/-types-(positive|negative)$/.test(row.role)).length,6);
assert.equal(result.mutants.length,4);assert.ok(result.mutants.every(row=>row.loaded&&row.killed&&row.restored));assert.equal(result.guards.length,2);assert.ok(result.guards.every(row=>row.refused));
assert.equal(result.children,33);assert.equal(result.active,0);assert.ok(result.receipts.every(row=>row.closed&&!row.signal));assert.equal(new Set(result.receipts.map(row=>row.pid)).size,33);
const declarations=result.declarations;assert.equal(declarations.length,5);
const captures=[];for(const name of fs.readdirSync(path.dirname(bootstrap.sourceResult)).sort())if(/\.(?:stdout|stderr)$/.test(name)){const file=path.join(path.dirname(bootstrap.sourceResult),name),bytes=read(file,undefined,67108864);captures.push({file,bytes:bytes.length,sha256:digest(bytes)});}
const output={verdict:'ACCEPT_SCOPED_PURE_ENGINE',sourceCommit:'72187e5abc1179883f85a63e1ef558f2e141c542',evidenceCommit:'b337bada7d2dddf83c3ce7c82b86377844306575',presealCommit:'f16d4a4eaa9a2d7acb93fc3d2d258feee675f40c',result:bootstrap,layouts,groups:426,originalCandidateGroups:354,novelGroups:72,typeGroups:6,typePairRecords:3,intendedNegativeDiagnostics:9,types:result.types,declarations,mutants:result.mutants,guards:result.guards,children:33,closed:33,active:0,knownExecutionStarts:36,peakKnown:3,captureBytes:bootstrap.totalCapture,workingBytes:result.workBytes,coordinatorElapsedMs:result.elapsedMs,captures,publicationTime:new Date().toISOString(),qualification:'No native, transport, Worker, Shell, guest, public-export or global-Budget integration acceptance; native-visible projections and instrumented admission controls retain their distinct roles.',summaryRevision:{original:'summarize.mjs/raw/summarize.stderr',changes:['Exact descriptive I01-I06/I23 IDs replace incorrectly assumed bare IDs','Three type pair records represent six compiler groups; all nine diagnostic codes remain exact'],newProductExecutions:0}};
fs.writeFileSync(path.join(own,'GROUP-MAP.json'),JSON.stringify(groups,null,2)+'\n',{flag:'wx',mode:0o600});
fs.writeFileSync(path.join(own,'FINAL-RESULT.json'),JSON.stringify(output,null,2)+'\n',{flag:'wx',mode:0o600});
console.log(JSON.stringify({verdict:output.verdict,layouts:output.layouts,groups:426,typeGroups:6,negativeDiagnostics:9,mutants:output.mutants.map(row=>({id:row.id,killed:row.killed,restored:row.restored})),guards:output.guards.map(row=>row.id),captures:captures.length,coordinatorElapsedMs:output.coordinatorElapsedMs,publicationTime:output.publicationTime}));
