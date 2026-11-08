import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { addEvidence, owned, compare, sha256 } from './replay/review.mjs';
import { containedJob } from './replay/watchdog.mjs';

const parent=owned.replace(/\/replay$/,'');
const [stageLabel,destination]=process.argv.slice(2);
assert(stageLabel&&destination&&/^[a-z0-9-]+$/.test(destination));
assert(!existsSync(`${parent}/${destination}`));
const stage=JSON.parse(readFileSync(`${owned}/${stageLabel}/stage.json`));
const frozen=JSON.parse(readFileSync(`${parent}/freeze/independent-native.json`));
const nine=JSON.parse(readFileSync(`${parent}/freeze/nine-unchanged.json`));
const runtime=JSON.parse(readFileSync(`${parent}/freeze/runtime-binding.json`));
const rows=[];
for(const [cohort,inputs] of [['nine',nine],['independent-native',frozen.rows]])for(const input of inputs){
  const outer=await containedJob(pathToFileURL(resolve(owned,'runtime-driver.mjs')).href,{installed:stage.installed,mode:'native',argv:input.argv,environment:frozen.environment});
  const envelope=outer.value?.value;
  const actual=envelope?.result;
  const zeroWorkers=!(envelope?.events??[]).some(event=>event.type==='workerStart');
  const comparison=actual?compare(input.expected,actual):{strict:false,semantic:false,diagnostic:false};
  rows.push({cohort,id:input.id??input.expected.id,argv:input.argv,expected:input.expected,actual,comparison,zeroWorkers,activeBeforeSafetyCleanup:envelope?.activeBeforeSafetyCleanup,outer,classification:input.classification??null});
}
const controls=[];
for(const input of runtime.cases){
  const outer=await containedJob(pathToFileURL(resolve(parent,'runtime-driver.mjs')).href,{installed:stage.installed,input});
  const actual=outer.value?.value;
  let passed=Boolean(actual&&actual.activeBeforeSafetyCleanup===0&&!actual.events.includes('workerStart'));
  const stdout=actual&&Buffer.from(actual.stdoutBase64,'base64').toString();
  const stderr=actual&&Buffer.from(actual.stderrBase64,'base64').toString();
  if(input.preabort)passed&&=actual.rejected&&actual.exactReasonIdentity&&stdout===''&&stderr==='';
  else if(input.expectedError)passed&&=actual.rejected&&actual.error?.name==='RangeError'&&actual.error?.message===input.expectedError&&stdout===''&&stderr==='';
  else if(input.id==='literal-command-binding')passed&&=actual.status===2&&stderr==="expr: syntax error: unexpected argument 'x'\n"&&stdout==='';
  else {passed&&=actual.status===input.expectedStatus&&stderr===input.expectedStderr;passed&&=input.stdoutPrefix?stdout.startsWith(input.stdoutPrefix):stdout==='';}
  controls.push({id:input.id,input,actual,passed,outer});
}
const report={candidate:stage.commit,installed:stage.installed,sourceTreeSha256:stage.sourceTreeSha256,installedArtifactSha256:stage.installedArtifactSha256,driverSha256:sha256(readFileSync(`${parent}/runtime-driver.mjs`)),rows,controls,summary:{nineStrict:rows.filter(row=>row.cohort==='nine'&&row.comparison.strict).length,nineTotal:9,independentStrict:rows.filter(row=>row.cohort==='independent-native'&&row.comparison.strict).length,independentTotal:26,runtimePassed:controls.filter(row=>row.passed).length,runtimeTotal:controls.length,workers:rows.filter(row=>!row.zeroWorkers).length},classification:stageLabel.startsWith('baseline')?'NEW BASELINE EXECUTION ONLY; zero new candidate acceptance':'NEW EXACT ARCHIVED CANDIDATE EXECUTION; not full GNU parity'};
addEvidence(`${owned}/${destination}/independent.json`,report);
console.log(JSON.stringify(report.summary));
