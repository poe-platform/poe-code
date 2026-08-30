import fs from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import assert from 'node:assert/strict';

const root = '/Users/kjopek/Workspace/safe-bash';
const home = path.dirname(fileURLToPath(import.meta.url));
const digest = bytes => createHash('sha256').update(bytes).digest('hex');
const read = async filename => {
  const info = await fs.lstat(filename);
  assert(info.isFile() && !info.isSymbolicLink() && info.size <= 262144);
  return fs.readFile(filename);
};
const json = async name => JSON.parse(await read(path.join(home, name)));
const same = (actual, expected) => assert.deepEqual(actual, expected);
const verify = async row => {
  const filename = path.isAbsolute(row.path) ? row.path : path.join(root, row.path);
  assert(!filename.split(path.sep).some(name => name.toLowerCase() === 'agents.md'));
  const info = await fs.lstat(filename);
  assert(info.isFile() && !info.isSymbolicLink());
  same(info.size, row.bytes);
  same(info.mode & 4095, row.mode);
  const hash = createHash('sha256');
  for await (const bytes of createReadStream(filename, { highWaterMark: 65536 })) hash.update(bytes);
  same(hash.digest('hex'), row.sha256);
};
const sealBytes = await read(path.join(home, 'PRESEAL.json'));
assert(process.argv.length === 3 && digest(sealBytes) === process.argv[2]);
const seal = JSON.parse(sealBytes);
for (const row of seal.files) await verify({ ...row, path: path.join(home, row.path) });
const bindings = await json('BINDINGS.json');
const plan = await json('SEMANTIC-PLAN.json');
const census = await json('CENSUS-AND-LIMITS.json');
const fairness = await json('FAIRNESS.json');
const sourceRoot = path.join(root, 'tests/comparison/breadth-continuation-20260828');
const readSource = async name => (await read(path.join(sourceRoot, name))).toString();
const schedule = JSON.parse(await readSource('executor-preparation-v1/SCHEDULE.json'));
const operations = JSON.parse(await readSource('executor-v7-r3/OPERATION-PLAN.json'));
const specimens = [...JSON.parse(await readSource('LEGACY-RECIPES.json')).rows.map(row => row.recipe), ...JSON.parse(await readSource('WORKFLOWS.json')).rows];
const results = [];
const check = async (id, body) => {
  try { const details = await body(); results.push({ id, pass: true, details: details ?? null }); }
  catch (error) { results.push({ id, pass: false, code: error.code ?? null, message: String(error.message).slice(0,2048) }); }
};
await check('D01', async () => {
  for (const row of [...bindings.selectedSource, ...bindings.retainedReceipts, ...bindings.extra, ...bindings.tools]) await verify(row);
  return { selected: bindings.selectedSource.length, retained: bindings.retainedReceipts.length, whole416Rerun: false };
});
const validateSchedule = rows => {
  same(rows.length, 99);
  for (const [index, row] of rows.entries()) {
    const specimen = specimens.find(value => value.id === row.id);
    const operation = operations.cohort[index];
    same(row.ordinal, index + 1);
    same(row.layout, ['target-installed','baseline-installed','target-moved'][index % 3]);
    same(row.id, operation.caseId);
    same(row.recipeSha256, digest(Buffer.from(JSON.stringify(specimen))));
    same(operation.specimenSha256, row.recipeSha256);
  }
};
await check('D02', async () => {
  validateSchedule(schedule.rows);
  same(new Set(schedule.rows.map(row => row.id)).size, 33);
  for (const row of plan.rows) {
    const specimen = specimens.find(value => value.id === row.id);
    same(row.expectedSha256, digest(Buffer.from(JSON.stringify(specimen.expected))));
  }
  same(plan.projectionSha256, digest(Buffer.from(JSON.stringify({ limits:operations.limits, command:operations.command, phase:'cohort', operations:operations.cohort }))));
});
await check('D03', async () => {
  const altered = structuredClone(specimens[0]); altered.script += ' altered';
  assert.notEqual(digest(Buffer.from(JSON.stringify(altered))), schedule.rows[0].recipeSha256);
  const duplicate = structuredClone(schedule.rows); duplicate[1] = duplicate[0];
  assert.throws(() => validateSchedule(duplicate));
});
await check('D04', async () => {
  same(plan.rows.reduce((sum,row) => sum+row.semanticExecCalls,0),99);
  same(plan.rows.reduce((sum,row) => sum+row.setupExecCalls,0),66);
  same(plan.engineCalls.futureTotal,165); same(plan.engineCalls.historicalCombinedPlan,167);
  same(plan.engineCalls.futureC11,0); same(plan.engineCalls.creditHistoricalCallsAsNew,false);
});
await check('D05', async () => {
  same(census.processes.length,322); same(new Set(census.processes.map(row=>row.id)).size,322);
  same(census.runtimeProcesses,3+99+2+198); same(census.totalPlanned,census.runtimeProcesses+20);
  assert(census.totalPlanned>128); same(census.peakRoute.length,5);
});
await check('D06', async () => {
  const source = await readSource('executor-v7-r3/launch.mjs');
  assert(source.includes("requireThat(phase === 'admission'"));
  assert(source.indexOf("requireThat(phase === 'admission'")<source.indexOf('const recipe = authenticatePacket(root)'));
  return { sourceOnly:true, actualLauncherExecutions:0, cohortRouteBlocked:true };
});
await check('D07', async () => {
  const source = await readSource('executor-v7-r2/report.mjs');
  for (const marker of ["row.mode !== 'admission'", "row.status !== 'ADMISSION_ACCEPTED'", 'artifact.productCohortCalls !== 0', "OPERATION-PLAN.json', import.meta.url))).admission"]) assert(source.includes(marker));
  return { sourceOnly:true, actualCollectorExecutions:0, cohortAssessmentBlocked:true };
});
await check('D08', async () => {
  const envelope = await json('ROOT-GRANT.TEMPLATE.json'); const auth = await json('AUTH.TEMPLATE.json');
  same(envelope.active,false); same(auth.active,false); same(auth.proposedAUTH.grant.commit,null);
  const required=['role','phase','attempts','runId','outputRoot','recipeSha256','reviewSha256','planSha256','bootstrapProfile','reportProtocol','candidate','packSha256','command','acceptedAdmission'];
  const validate = value => {
    same(Object.keys(value),required); same(value.phase,'cohort'); same(value.attempts,1);
    same(value.candidate,bindings.candidate); same(value.packSha256,bindings.packSha256);
    same(value.planSha256,plan.projectionSha256); same(Object.keys(value.acceptedAdmission),['path','sha256']);
  };
  validate(envelope.proposedGrant);
  assert.throws(()=>validate({...envelope.proposedGrant,candidate:'0'.repeat(40)}));
  assert.throws(()=>validate({...envelope.proposedGrant,extra:true}));
  return { independentDataSchemaOnly:true, runtimeAuthorizationNotExecuted:true };
});
await check('D09', async () => {
  const mapping=await json('OWNER-LITERAL-MAP.json');
  await verify(mapping.oldOwner);
  let source=(await read(mapping.oldOwner.path)).toString();
  for(const change of mapping.changes){same(source.split(change.old).length,2);source=source.replace(change.old,change.new);}
  same(source,(await read(path.join(home,'owner-proposed.mjs.data'))).toString());
  same(digest(Buffer.from(source)),mapping.newOwnerSha256);same(mapping.changes.length,2);
});
await check('D10', async () => {
  const capture=census.capture;
  same(capture.bodyBytes+capture.collectorBytes+capture.outerBytes+capture.administrationBytes,257*1048576);
  same(capture.rawWorkerSuccessfulCeilingsSumBytes,69*(8388608+262144)+30*(65536*2+262144));
  assert(capture.rawWorkerSuccessfulCeilingsSumBytes>capture.totalBytes);
  same(capture.guaranteed99CompletionWithinAggregate,false);
});
await check('D11', async () => {
  const indexRow=bindings.retainedReceipts.find(row=>row.path.endsWith('/admission-20260829-v7r3-02/STAGED.json'));
  const index=JSON.parse(await read(path.join(root,indexRow.path)));
  const parts=[];
  for(const row of index.parts){const filename=path.join(root,path.dirname(indexRow.path),row.path);await verify({...row,path:filename});parts.push(await read(filename));}
  const bytes=Buffer.concat(parts);same(bytes.length,index.bytes);same(digest(bytes),index.sha256);
  const staged=JSON.parse(bytes);same(Object.keys(staged.views).sort(),['baseline-installed','target-installed','target-moved']);
  same(bindings.wholeCurrentStageReauthentication,false);
  return { retainedMetadataOnly:true, freshStageLoads:0 };
});
await check('D12', async () => {
  same(fairness.W07.comparatorSemanticCredit,false);same(fairness.W07.comparatorNonExecutionCredit,false);
  same(fairness.W03.completeTelemetryQualified,false);same(fairness.namespaces.targetTotalEntries,68);same(fairness.namespaces.comparatorTotalEntries,255);
  for(const suffix of ['semantic-20260829-v7r3-01','semantic-20260829-v7r3-01-supervision']) await assert.rejects(fs.lstat(path.join(sourceRoot,'executor-v7-r3/runs',suffix)),{code:'ENOENT'});
});
const report={schema:'SEMANTIC_PREPARATION_DATA_RESULTS_V1',attempt:1,presealSha256:process.argv[2],cases:results.length,passed:results.filter(row=>row.pass).length,failed:results.filter(row=>!row.pass).length,rows:results,engineCalls:0,workers:0,C11:0,semantics:0,children:0,runtimeReadiness:'HOLD_SOURCE_GATES_AND_ROOT_DECISIONS'};
const reportBytes=Buffer.from(JSON.stringify(report,null,2)+'\n');
assert(reportBytes.length<=65536);
const handle=await fs.open(path.join(home,'DATA-RESULT.json'),'wx',0o600);
try{await handle.writeFile(reportBytes);await handle.sync();}finally{await handle.close();}
process.stdout.write(JSON.stringify({cases:report.cases,passed:report.passed,failed:report.failed,engineCalls:0,reference:'DATA-RESULT.json',sha256:digest(reportBytes)})+'\n');
process.exitCode=report.failed?1:0;
