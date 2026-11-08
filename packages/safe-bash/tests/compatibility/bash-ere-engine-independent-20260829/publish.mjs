import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import assert from 'node:assert/strict';
const root=path.dirname(new URL(import.meta.url).pathname);
const capture=fs.openSync(path.join(root,'PUBLICATION.capture.data'),'wx',0o600);
const digest=bytes=>crypto.createHash('sha256').update(bytes).digest('hex');
try{
  fs.writeSync(capture,JSON.stringify({event:'start',at:new Date().toISOString(),role:'DATA-only publication'})+'\n');
  const result=JSON.parse(fs.readFileSync(path.join(root,'ACTUAL-01/RESULT.json')));
  assert.ok(Date.now()<result.started+3600000);
  const old=JSON.parse(fs.readFileSync(path.join(root,'EVIDENCE.json')));
  const handoff=fs.readFileSync(path.join(root,'HANDOFF.md'),'utf8');
  const corrections=[['group entry lines147–150','group entry lines145–148'],['publication lines174–179','publication lines165–169']];
  let original=handoff;
  for(const [before,after] of corrections){assert.equal(original.split(after).length,2);original=original.replace(after,before);}
  assert.equal(digest(original),old.files.find(row=>row.path==='HANDOFF.md').sha256);
  const seal=JSON.parse(fs.readFileSync(path.join(root,'SEAL.json')));
  const value={at:new Date().toISOString(),actualElapsedThroughPublicationMs:Date.now()-result.started,source:result.source,presealCommit:'5caf8e2d',initialEvidenceSha256:digest(fs.readFileSync(path.join(root,'EVIDENCE.json'))),summarySha256:digest(fs.readFileSync(path.join(root,'SUMMARY.json'))),reportOverride:{path:'HANDOFF.md',beforeSha256:digest(original),sha256:digest(handoff),bytes:Buffer.byteLength(handoff),corrections},sourceModules:seal.sources.length,compilerDeclarationClosureFiles:seal.tools.length,processes:{preparationKnown:47,actualRuntimeOwner:1,actualRuntimeChildren:27,actualRetiredChildren:27,knownActualThroughThisPublication:37,reservedFinalGitAndMetadataStarts:5,qualifiedFinalKnownCeiling:42,authorizedActualCeiling:128,peakKnown:2,notOSWideCensus:true},remainingActiveOwnedProcesses:0,retainedWork:'ACTUAL-01/work (known regular files, no active child)',qualifications:['no native observations','no Shell or Worker activation','no package root import/npm install','R02 SOURCE-only','original reviewer seal failure preserved']};
  fs.writeFileSync(path.join(root,'PUBLICATION.json'),JSON.stringify(value,null,2)+'\n',{mode:0o600,flag:'wx'});
  fs.writeSync(capture,JSON.stringify({event:'complete',sha256:digest(fs.readFileSync(path.join(root,'PUBLICATION.json')))})+'\n');
  console.log(JSON.stringify(value));
}catch(error){fs.writeSync(capture,JSON.stringify({event:'refused',error:String(error?.stack??error)})+'\n');process.exitCode=1;}
finally{fs.fsyncSync(capture);fs.closeSync(capture);}
