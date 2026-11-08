import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { encode, readDocument, readConfig } from '../../../executor-v7-r2/records.mjs';
import { dataObject, denseArray, hashString, nonnegative } from '../../../executor-v7-r2/schema.mjs';
import { childLedgerData, envelopeData, authorityReceiptData } from '../../../executor-v7-r2/contracts.mjs';
import { parseTransport } from '../../../executor-v7/transport.mjs';
import { qualify } from '../../../executor-v4/predicates.mjs';
import { baseRoot, acceptedAdmission, originalRecipe, digest, requireThat, verifySuccessor, home } from './profile.mjs';

const own = (value, keys, optional = []) => { const row = dataObject(value, keys, optional); requireThat(row, 'SEMANTIC_SCHEMA'); return row; };
const list = (value, count) => { const rows = denseArray(value, count); requireThat(rows && rows.length === count, 'SEMANTIC_COUNT'); return rows; };
const equal = (left, right) => encode(left).equals(encode(right));
function bytes(value, observed, cap) {
  requireThat(typeof value === 'string' && nonnegative(observed) && observed <= cap && value.length <= 4 * Math.ceil(cap / 3), 'SEMANTIC_CAPTURE_BOUND');
  const result = Buffer.from(value,'base64');
  requireThat(result.length === observed && result.toString('base64') === value, 'SEMANTIC_CAPTURE_BYTES');
  return result;
}
export function supervisorData(value, { legacy = false, exitCode = 0 } = {}) {
  const row = own(value, ['pid','exit','close','reaped','failures','signals','records','captureBytes','stdout','stderr','rawRecords','natural']);
  requireThat(Number.isSafeInteger(row.pid) && row.pid > 0 && row.reaped === true && row.natural === (exitCode === 0), 'SEMANTIC_RETIREMENT');
  for (const name of ['exit','close']) { const disposition = own(row[name],['code','signal']); requireThat(disposition.code === exitCode && disposition.signal === null, 'SEMANTIC_DISPOSITION'); }
  list(row.failures,0); list(row.signals,0);
  const counts = own(row.captureBytes,['stdout','stderr','records']);
  const cap = legacy ? 8388608 : 65536;
  const stdout = bytes(row.stdout,counts.stdout,cap), stderr = bytes(row.stderr,counts.stderr,cap), raw = bytes(row.rawRecords,counts.records,262144);
  requireThat(!legacy || stdout.length + stderr.length <= 8388608, 'SEMANTIC_LEGACY_COMBINED');
  const records = parseTransport(raw);
  requireThat(equal(row.records,records), 'SEMANTIC_TRANSPORT_RECONCILIATION');
  return { row, stdout, stderr, records };
}
function authorities(records, declared, metadata, syntheticOnly, only = false) {
  const envelope = envelopeData(declared);
  requireThat(envelope, 'SEMANTIC_AUTH_ENVELOPE');
  const receipts = list(metadata,2);
  const observed = records.filter(row => row.kind === 'authority-observed');
  requireThat(observed.length === 2 && (!only || records.length === 3), 'SEMANTIC_AUTH_COUNT');
  for (let index=0;index<2;index++) {
    const event = own(observed[index],['sequence','kind','receipt']);
    const reference = index === 0 ? envelope.review : envelope.grant;
    requireThat(event.sequence === index && authorityReceiptData(event.receipt,index+1,reference,syntheticOnly) && authorityReceiptData(receipts[index],index+1,reference,syntheticOnly) && equal(event.receipt,receipts[index]), 'SEMANTIC_AUTH_WITNESS');
  }
}
function accounting(value) {
  const row = own(value,['enrolled','attempted','launched','closed','unknownAcquisitions','allChildrenReaped','unsafe']);
  requireThat(['enrolled','attempted','launched','closed'].every(key => row[key] === 99) && row.unknownAcquisitions === 0 && row.allChildrenReaped === true && row.unsafe === false, 'SEMANTIC_ACCOUNTING');
  return row;
}
export function assessSemanticTerminal(receipt, root, { syntheticOnly = false } = {}) {
  try {
    const header = own(receipt, ['pid','exit','close','reaped','failures','signals','records','captureBytes','stdout','stderr','rawRecords','natural']);
    const disposition = own(header.exit,['code','signal']);
    const parsed = supervisorData(header, { exitCode: disposition.code });
    requireThat([0,1].includes(parsed.row.exit.code) && parsed.stderr.length === 0, 'SEMANTIC_COORDINATOR_EXIT');
    const terminal = own(JSON.parse(parsed.stdout.toString('utf8')),['schema','mode','runId','status','unsafe','exitCode','primary','result','execCounts','caseCounts','launchAccounting','children','failures','historicalScoresUnchanged']);
    requireThat(terminal.schema === 'BOUNDED_SEMANTIC_TERMINAL_V1' && terminal.mode === 'cohort' && terminal.status === 'COHORT_COMPLETED' && terminal.unsafe === false && terminal.exitCode === parsed.row.exit.code && terminal.historicalScoresUnchanged === true, 'SEMANTIC_TERMINAL');
    requireThat(typeof terminal.runId === 'string' && /^[a-z0-9-]{1,64}$/.test(terminal.runId) && path.basename(root) === terminal.runId, 'SEMANTIC_RUN_ID');
    const primary = own(terminal.primary,['present','undefinedValue']); requireThat(primary.present === false && primary.undefinedValue === false,'SEMANTIC_PRIMARY'); list(terminal.failures,0);
    const reference = own(terminal.result,['path','bytes','sha256','mode']);
    requireThat(reference.path === 'RESULT.json' && nonnegative(reference.bytes) && reference.bytes <=262144 && reference.mode ===420 && hashString(reference.sha256) && fs.lstatSync(path.join(root,reference.path)).size === reference.bytes,'SEMANTIC_RESULT_REFERENCE');
    const artifact = own(readDocument(root,reference.path,reference.sha256),['mode','runId','productCohortCalls','setupCalls','rows','unsafe','historicalScoresUnchanged','status','cleanupErrors','authorizationMetadata','recipe','acceptedAdmission','authorizationReferences','authorityClass','stagedSha256','cohort','actualUniqueSemanticSpecs','comparisonIsAdditiveNotHistoricalRescore','tail','launchAccounting','allChildrenReaped','plannedOperations','evidence','selectedPrimary','children','requiresNaturalWorkers','semanticProtocol','execCounts','caseCounts']);
    requireThat(artifact.mode === 'cohort' && artifact.runId === terminal.runId && artifact.status === terminal.status && artifact.unsafe === false && artifact.semanticProtocol === 'SEMANTIC_RESULT_V1' && artifact.requiresNaturalWorkers === true && artifact.allChildrenReaped === true && artifact.actualUniqueSemanticSpecs ===33 && artifact.comparisonIsAdditiveNotHistoricalRescore ===true && artifact.historicalScoresUnchanged ===true && artifact.recipe === verifySuccessor() && hashString(artifact.stagedSha256),'SEMANTIC_ARTIFACT');
    list(artifact.rows,0);list(artifact.cleanupErrors,0);requireThat(equal(own(artifact.selectedPrimary,['present']),{present:false}),'SEMANTIC_SELECTED_PRIMARY');
    requireThat(artifact.authorityClass === (syntheticOnly ? 'SYNTHETIC_ONLY' : 'COMMITTED_ROOT_REVIEW'),'SEMANTIC_AUTH_CLASS');
    requireThat(equal(own(artifact.acceptedAdmission,['path','sha256']),acceptedAdmission),'SEMANTIC_ADMISSION_REFERENCE');
    const admitted = readDocument(path.dirname(path.resolve(baseRoot,'../../../..',acceptedAdmission.path)), 'RESULT.json',acceptedAdmission.sha256);
    requireThat(admitted.admissionQualified ===true && admitted.unsafe ===false && admitted.recipe ===originalRecipe && admitted.stagedSha256 ===artifact.stagedSha256,'SEMANTIC_ADMISSION_STATUS');
    const staged=readDocument(path.dirname(path.resolve(baseRoot,'../../../..',acceptedAdmission.path)),'STAGED.json',artifact.stagedSha256,2097152);
    authorities(parsed.records,artifact.authorizationReferences,artifact.authorizationMetadata,syntheticOnly,true);
    requireThat(equal(accounting(terminal.launchAccounting),accounting(artifact.launchAccounting)),'SEMANTIC_ACCOUNTING_MATCH');
    const final = own(parsed.records.at(-1),['sequence','kind','report']);
    const finalReport = own(final.report,['mode','runId','status','unsafe','result','children','allChildrenReaped']);
    requireThat(final.kind==='final' && finalReport.mode===terminal.mode && finalReport.runId===terminal.runId && finalReport.status===terminal.status && finalReport.unsafe===false && finalReport.children===99 && finalReport.allChildrenReaped===true && equal(finalReport.result,reference),'SEMANTIC_FINAL_WITNESS');
    const plan=JSON.parse(fs.readFileSync(path.join(baseRoot,'OPERATION-PLAN.json'))).cohort;
    const source=path.resolve(baseRoot,'..');
    const specimens=new Map([...JSON.parse(fs.readFileSync(path.join(source,'LEGACY-RECIPES.json'))).rows.map(row=>row.recipe),...JSON.parse(fs.readFileSync(path.join(source,'WORKFLOWS.json'))).rows].map(row=>[row.id,row]));
    const actualChildren=list(artifact.children,99), terminalChildren=list(terminal.children,99), planned=list(artifact.plannedOperations,99), tail=list(artifact.tail,99);
    const cohort=own(artifact.cohort,['rows','unsafe']);requireThat(cohort.unsafe===false,'SEMANTIC_UNSAFE_COHORT');const rows=list(cohort.rows,99);
    let setups=0, passed=0, failed=0, unqualified=0;
    for(let index=0;index<99;index++) {
      const operation=plan[index], child=childLedgerData(actualChildren[index],index+1), summary=own(terminalChildren[index],['ordinal','pid','group','exit','close','reaped','persisted']);
      requireThat(child && child.kind==='case' && child.operationId===operation.id && child.operationOrdinal===operation.ordinal,'SEMANTIC_OPERATION');
      requireThat(Object.keys(summary).every(key=>equal(summary[key],child[key])),'SEMANTIC_CHILD_MATCH');
      requireThat(equal(own(planned[index],['id','launch']),{id:operation.id,launch:index+1}),'SEMANTIC_OPERATION_TABLE');
      const config=readConfig(root,'child-'+String(index+1).padStart(3,'0')+'.json',child.configSha);
      requireThat(config.kind==='case' && config.operationId===operation.id && config.operationOrdinal===operation.ordinal && config.launchOrdinal===index+1 && config.view?.name===operation.layout && config.specimen?.id===operation.caseId && digest(Buffer.from(JSON.stringify(config.specimen)))===operation.specimenSha256 && equal(config.authorization.review,artifact.authorizationReferences.review) && equal(config.authorization.grant,artifact.authorizationReferences.grant),'SEMANTIC_CONFIG_BINDING');
      requireThat(equal(config.view,staged.views[operation.layout]) && config.authorization.phase==='cohort' && config.authorization.runId===terminal.runId && config.authorization.outputRoot===root,'SEMANTIC_VIEW_AND_CONTEXT');
      const observed=supervisorData(readDocument(root,'child-'+String(index+1).padStart(3,'0')+'.receipt.json',child.receiptSha),{legacy:!operation.caseId.startsWith('W')});
      requireThat(observed.row.pid===child.pid,'SEMANTIC_CHILD_PID');
      const childFinal=own(observed.records.at(-1),['sequence','kind','report','cleanupErrors','late','authorityMetadata']);list(childFinal.cleanupErrors,0);list(childFinal.late,0);
      const report=childFinal.report;requireThat(report && typeof report==='object' && !Array.isArray(report),'SEMANTIC_CHILD_REPORT');
      authorities(observed.records,artifact.authorizationReferences,childFinal.authorityMetadata,syntheticOnly);
      requireThat(equal(report.authorityMetadata,childFinal.authorityMetadata),'SEMANTIC_WORKER_AUTHORITY');
      const operationEvents=observed.records.filter(event=>event.kind==='worker-operation-authorized');
      requireThat(operationEvents.length===1 && dataObject(operationEvents[0],['sequence','kind','operationId','operationOrdinal','launchOrdinal']) && operationEvents[0].operationId===operation.id && operationEvents[0].operationOrdinal===operation.ordinal && operationEvents[0].launchOrdinal===index+1,'SEMANTIC_OPERATION_WITNESS');
      const loads=own(report.loads,['count','evaluated','denied','entryResolutions','consumerResolutions']);list(loads.denied,0);
      const witnesses=observed.records.filter(event=>event.kind==='nextLoad');requireThat(witnesses.length>0 && loads.count===witnesses.length && loads.evaluated===true,'SEMANTIC_LOAD_COUNT');
      const inventory=new Map(config.view.files.map(row=>[row.path,row]));
      for(const value of witnesses){const witness=own(value,['sequence','kind','path','format','bytes','sha256','evaluationProven','origin']);const entry=inventory.get(witness.path);requireThat(entry && witness.bytes===entry.bytes && witness.sha256===entry.sha256 && ['module','commonjs','json'].includes(witness.format) && witness.evaluationProven===false && ['actual-nextLoad-source','authenticated-CJS-source-supplied-to-runtime'].includes(witness.origin),'SEMANTIC_LOAD_BINDING');}
      const entryResolution=list(loads.entryResolutions,1)[0],consumerResolution=list(loads.consumerResolutions,1)[0];
      const consumerURL=pathToFileURL(path.join(config.view.root,config.view.consumerPath)).href;
      requireThat(entryResolution.accepted===true && entryResolution.parentURL===pathToFileURL(path.join(home,'worker.mjs')).href && entryResolution.url===consumerURL && consumerResolution.accepted===true && consumerResolution.parentURL===consumerURL && consumerResolution.specifier===config.view.engine,'SEMANTIC_ENTRY_EDGES');
      for(const [kind,resolution]of [['consumer-entry-resolution',entryResolution],['consumer-resolution',consumerResolution]]){const events=observed.records.filter(event=>event.kind===kind);requireThat(events.length===1 && equal(Object.fromEntries(Object.entries(events[0]).filter(([key])=>key!=='sequence')),resolution),'SEMANTIC_EDGE_WITNESS');}
      requireThat(observed.records.filter(event=>event.kind==='consumer-evaluated' && event.engine===config.view.engine).length===1,'SEMANTIC_CONSUMER_EVALUATION');
      if(config.view.engine==='just-bash'){const bootstrap=own(report.bootstrap,['profile','opened','revoked','consumed','nativeDelegations','violations','callerAuthenticated','stockNodeCapabilities']);requireThat(bootstrap.profile==='JUST_BASH_3_4_2_UNAVAILABLE_BOOTSTRAP_V1' && bootstrap.opened===true && bootstrap.revoked===true && bootstrap.consumed===2 && bootstrap.nativeDelegations===0 && bootstrap.callerAuthenticated===false && bootstrap.stockNodeCapabilities===false,'SEMANTIC_BOOTSTRAP');list(bootstrap.violations,0);const queries=observed.records.filter(event=>event.kind==='bootstrap-unavailable');requireThat(queries.length===2 && queries.every((event,index)=>event.query===['module','worker_threads'][index] && event.slot===index+1 && event.nativeDelegation===false),'SEMANTIC_BOOTSTRAP_WITNESS');}else requireThat(report.bootstrap===null,'SEMANTIC_TARGET_BOOTSTRAP');
      const expectedSetup=operation.layout==='baseline-installed'?0:1;
      requireThat(report.setup?.execCalls===expectedSetup && report.setup.settled===true && (expectedSetup===0 || report.setup.emptySource===true && report.setup.dispatches===0 && report.setup.namespaceUnchanged===true),'SEMANTIC_SETUP');setups+=expectedSetup;
      requireThat(Array.isArray(report.cleanupErrors) && report.cleanupErrors.length===0 && report.resources?.descriptors===0,'SEMANTIC_WORKER_CLEANUP');
      if(report.result)report.result={...report.result,stdoutBase64:observed.row.stdout,stderrBase64:observed.row.stderr,stdout:observed.stdout.toString(),stderr:observed.stderr.toString()};
      const specimen=specimens.get(operation.caseId);requireThat(specimen && digest(Buffer.from(JSON.stringify(specimen)))===operation.specimenSha256,'SEMANTIC_SPECIMEN');
      const assessment=qualify(specimen,report,observed.row,true,operation.layout==='baseline-installed'?'just-bash':'virtual-bash');requireThat(assessment.safe===true,'SEMANTIC_CASE_UNSAFE');
      const expected={id:operation.caseId,...assessment,status:assessment.status??(assessment.pass?'QUALIFIED':'ORDINARY_ASSERTION_FAILED')};
      requireThat(equal(rows[index],expected),'SEMANTIC_ASSESSMENT_REPLAY');
      requireThat(equal(own(tail[index],['id','status']),{id:operation.ordinal+':'+operation.layout+':'+operation.caseId,status:expected.status}),'SEMANTIC_TAIL');
      if(assessment.pass===true)passed++;else if(assessment.pass===false)failed++;else {requireThat(operation.caseId==='W07' && operation.layout==='baseline-installed' && assessment.semanticCredit===false && assessment.nonExecutionCredit===false,'SEMANTIC_UNQUALIFIED_SCOPE');unqualified++;}
    }
    const calls={semantic:99,emptySetup:66,C11:0,total:165}, counts={completed:99,passed,failed,unqualified,unrun:0};
    requireThat(setups===66 && artifact.productCohortCalls===99 && artifact.setupCalls===66 && equal(own(terminal.execCounts,Object.keys(calls)),calls) && equal(own(artifact.execCounts,Object.keys(calls)),calls),'SEMANTIC_CALL_COUNTS');
    requireThat(equal(own(terminal.caseCounts,Object.keys(counts)),counts) && equal(own(artifact.caseCounts,Object.keys(counts)),counts),'SEMANTIC_CASE_COUNTS');
    requireThat(terminal.exitCode===(failed?1:0),'SEMANTIC_EXIT_RECONCILIATION');
    return {protocolQualified:true,semanticAllQualified:failed===0 && unqualified===0,caseCounts:counts,execCounts:calls,scope:'Frozen semantic profiles; W03 telemetry remains partial; W07 never receives unsupported credit',error:null};
  } catch(error) { return {protocolQualified:false,semanticAllQualified:false,error:{code:typeof error?.code==='string'?error.code.slice(0,80):null,message:typeof error?.message==='string'?error.message.slice(0,512):null}}; }
}
