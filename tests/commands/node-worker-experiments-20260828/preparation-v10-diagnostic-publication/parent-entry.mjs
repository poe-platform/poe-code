import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { installGuard, assertClosedInputs } from './load-guard.mjs';

const grant = JSON.parse(readFileSync(new URL('./GRANT.json', import.meta.url), 'utf8'));
const template = JSON.parse(readFileSync(new URL('./GRANT.template.json', import.meta.url), 'utf8'));
if (JSON.stringify(Object.keys(grant)) !== JSON.stringify(Object.keys(template))) throw new Error('grant schema');
if (grant.authorized !== true || grant.phase !== 'worker' || grant.oneShot !== true || grant.runId !== 'RUN-WRQ-CONTINUATION-V10-01' || grant.retries !== 0) throw new Error('fresh ROOT GO required');
for (const [field, path] of [['profileSha256', 'PROFILE.json'], ['caseSha256', 'CASES.json'], ['moduleSha256', 'MODULES.json'], ['toolSha256', 'TOOLS.json'], ['sourceSha256', 'SOURCES.json']]) {
  if (createHash('sha256').update(readFileSync(new URL('./' + path, import.meta.url))).digest('hex') !== grant[field]) throw new Error('grant body binding');
}
if (typeof grant.reviewCommit !== 'string' || !/^[a-f0-9]{40}$/.test(grant.reviewCommit) || grant.reviewDecision !== 'accept-exact-finite-recipe' || grant.compiler !== false) throw new Error('review/compiler role');
assertClosedInputs();
const loads = installGuard('parent');
const { executeCase } = await import('./supervisor.mjs');
const { judgeCase } = await import('./outcome-judge.mjs');
const { publishDiagnostics } = await import('./diagnostic-publication.mjs');
const cases = JSON.parse(readFileSync(new URL('./CASES.json', import.meta.url), 'utf8')).instances;
if (!Array.isArray(grant.selectedInstances) || grant.selectedInstances.length !== 10 || new Set(grant.selectedInstances).size !== grant.selectedInstances.length) throw new Error('finite selection');
const selected = grant.selectedInstances.map(identity => {
  const row = cases.find(candidate => candidate.instance === identity);
  if (!row || !row.candidateImplemented) throw new Error('held/unlisted instance');
  return row;
});
if (selected.reduce((sum, row) => sum + row.guestEvaluations, 0) !== 9) throw new Error('guest ceiling');
if (selected.some((row,index)=>row.instance!==cases[index].instance)) throw Error('exact continuation order');
const outputRoot = new URL('./runtime/RUN-WRQ-CONTINUATION-V10-01/', import.meta.url);
mkdirSync(outputRoot, { recursive: true });
writeFileSync(new URL('CLAIM.json', outputRoot), JSON.stringify({ runId: grant.runId, sourceCommit: grant.sourceCommit }), { flag: 'wx' });
const admissionStarted = performance.now();
let capture = 0;
let session = 0;
let publicationStopped = false;
for (const row of selected) {
  if (performance.now() - admissionStarted >= 120000) throw new Error('total admission clock closed');
  let cleanup;
  let result;
  try { result = await executeCase(row, ++session, callback => { cleanup = callback; }); }
  finally { if (cleanup) await cleanup(); }
  const judgement = judgeCase(row, result.receipt, result.raw, result.identities);
  const publication = await publishDiagnostics(result.raw,result.diagnosticLedger,async diagnosticBytes => {
    const bytes=Buffer.from(JSON.stringify(result.receipt)+'\n');
    const judgementBytes=Buffer.from(JSON.stringify(judgement)+'\n');
    if(bytes.length>65536||judgementBytes.length>65536)throw Error('case publication bounds');
    const total=bytes.length+diagnosticBytes.length+judgementBytes.length;
    if(total>1048576-capture)throw Error('evidence aggregate cap');
    capture+=total;
    writeFileSync(new URL(row.instance+'.json',outputRoot),bytes,{flag:'wx'});
    writeFileSync(new URL(row.instance+'.diagnostic.json',outputRoot),diagnosticBytes,{flag:'wx'});
    writeFileSync(new URL(row.instance+'.judgement.json',outputRoot),judgementBytes,{flag:'wx'});
  });
  if(publication.raw!==result.raw)throw Error('raw identity invariant');
  if(!publication.complete) {
    process.exitCode=1;publicationStopped=true;
    const stop={schema:'diagnostic-publication-stop-v1',rawIdentityPreserved:publication.raw===result.raw,rawCount:result.raw.length,faults:publication.faults.map(record=>({present:record.present,stage:record.stage}))};
    try { await new Promise((resolve,reject)=>process.stderr.write(JSON.stringify(stop)+'\n',error=>error?reject(error):resolve())); }
    catch(value) { publication.faults.push({present:true,value,stage:'diagnostic-stop-capture'}); }
    break;
  }
  if (!judgement.qualified) throw new Error('case outcome mismatch');
  if (!result.receipt.facts.cleanupSettled || !result.receipt.facts.exited) throw new Error('unsettled ownership');
}
if(!publicationStopped) writeFileSync(new URL('LOADS.json', outputRoot), JSON.stringify(loads) + '\n', { flag: 'wx' });
