import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import assert from 'node:assert/strict';
import {SourceTextModule} from 'node:vm';
const root=path.dirname(new URL(import.meta.url).pathname),parent=path.dirname(root);
const hash=bytes=>crypto.createHash('sha256').update(bytes).digest('hex');
const read=file=>{const stat=fs.lstatSync(file);assert(stat.isFile()&&!stat.isSymbolicLink()&&stat.size<=4194304);const bytes=fs.readFileSync(file);assert.equal(bytes.length,stat.size);return bytes;};
const write=(name,value)=>fs.writeFileSync(root+'/'+name,typeof value==='string'?value:JSON.stringify(value,null,2)+'\n',{flag:'wx',mode:0o600});
const sealBytes=read(parent+'/v4/EXECUTION-SEAL.json');assert.equal(sealBytes.length,351213);assert.equal(hash(sealBytes),'ea3c82e4192729f4cbd2172e9548d5e21da3d4e3d8ccbfbfa7ad591a47736301');const seal=JSON.parse(sealBytes);
const source=read(parent+'/v4/cell-v4.mjs').toString(),dispatch=read(parent+'/v4/dispatch.mjs').toString();
assert.equal(hash(Buffer.from(dispatch)),seal.controller.find(row=>row.path.endsWith('/dispatch.mjs')).sha256);
const catalog=JSON.parse(read(seal.layouts[0].manifest.path));const cellPin=catalog.rows.find(row=>row.path==='harness/cell.mjs');assert.equal(hash(Buffer.from(source)),cellPin.sha256);
const start=source.indexOf('  const cell = JSON.parse('),end=source.indexOf('} catch (error) { primaryFailed = true;');assert(start>0&&end>start);
const body=source.slice(start,end);
let imports=source.slice(0,source.indexOf('const [cellPath, capturePath]'));
imports=imports.replace("import { boundFile, terminalOutcome } from './guards.mjs';","import { boundFile } from './guards.mjs';");
const prefix=imports+`import { createEventWriter, createFailureLedger, describeFailures, FINAL_AUDIT_BYTES } from './event-writer.mjs';
import { finalizeCell } from './finalize-cell.mjs';
const [cellPath, capturePath] = process.argv.slice(2);
const failures = createFailureLedger();
const audit = createEventWriter({ descriptor: 2, byteLimit: FINAL_AUDIT_BYTES, close() {} });
let writer;
const emit = row => writer.emit(row);
let observer;
let arrays;
let shell;
let cellId;
try {
  writer = createEventWriter({ descriptor: fs.openSync(capturePath, 'wx', 0o600) });
  emit({ event: 'startup', pid: process.pid, execPath: process.execPath });
`;
const suffix=`} catch (error) {
  failures.record(error, 'body');
  try { writer?.emit({ event: 'failure', failure: describeFailures(failures.snapshot()) }); }
  catch (reason) { failures.record(reason, 'failure-event'); }
} finally {
  const final = await finalizeCell({
    failures, writer, audit, id: cellId, workers: observer?.rows ?? [],
    actions: [
      { phase: 'shell-dispose', run: () => shell?.dispose() },
      { phase: 'array-settle', run: () => arrays?.settle() },
      { phase: 'worker-retirement', run: () => observer?.assertRetired() },
      { phase: 'array-restore', run: () => arrays?.restore() },
      { phase: 'worker-restore', run: () => observer?.restore() },
    ],
  });
  process.exitCode = final.exitCode;
}
`;
const cell=prefix+body+suffix;
let nextDispatch=dispatch;
const before="    const result = terminals[0];";
assert.equal(dispatch.split(before).length,2);
const replacement=`    const result = terminals[0];
    const startups = records.filter(row => row.event === 'startup');
    if (startups.length !== 1 || records[0] !== startups[0] || records.at(-1) !== result || startups[0].pid !== receipt.pid || startups[0].execPath !== seal.node.path) throw new Error('cell startup/terminal capture continuity');
    const auditLines = bounded(cell.stderr, cell.childCapture).toString('utf8').split('\\n').filter(line => line.startsWith('{"event":"cell-final",'));
    if (auditLines.length !== 1) throw new Error('final close-audit missing/duplicate');
    const audit = JSON.parse(auditLines[0]);
    if (audit.id !== cell.originalId || audit.status !== result.status || audit.retired !== true || audit.failure?.present !== (audit.status === 'FAIL')) throw new Error('final close-audit status/identity');
    const writer = audit.eventWriter;
    if (!writer || writer.failed !== false || writer.closed !== true || writer.byteLimit !== cell.childCapture || writer.admitted !== raw.length || writer.written !== raw.length) throw new Error('event capture incomplete/cap/close failure');`;
nextDispatch=nextDispatch.replace(before,replacement);
nextDispatch=nextDispatch.replace("grant.action !== 'execute-core70-v4'","grant.action !== 'execute-core70-v7'");
for(const [name,text]of [['cell.mjs',cell],['dispatch.mjs',nextDispatch]])new SourceTextModule(text,{identifier:name});
const patch='*** Begin Patch\n'+[['cell.mjs',cell],['dispatch.mjs',nextDispatch]].map(([name,text])=>'*** Add File: '+root+'/'+name+'\n'+text.trimEnd().split('\n').map(line=>'+'+line).join('\n')+'\n').join('')+'*** End Patch\n';write('INTEGRATION.patch',patch);
const layouts=[];let staticBytes=0;
for(const layout of seal.layouts){const bytes=read(layout.manifest.path);assert.equal(hash(bytes),layout.manifest.sha256);const manifest=JSON.parse(bytes);const sum=manifest.rows.reduce((total,row)=>total+row.size,0);assert(Number.isSafeInteger(sum));staticBytes+=sum;layouts.push({name:layout.name,manifest:layout.manifest,files:manifest.rows.length,bytes:sum,cells:layout.cells.length,privateAssets:layout.privateAssets});}
const MiB=1048576,eventBytes=210*262144,pipeBytes=210*262144;
const components={retainedAndFreshLayoutCopies:staticBytes*2+MiB,uniqueCellEvents:eventBytes,uniqueCellPipesIncludingFinalAudits:pipeBytes,coordinatorCapture:8*MiB,administrativeToolCaptures:8*MiB,publicationTails:4*MiB,generatedBindingsManifestsMetadata:16*MiB,onePublicationCopyOfAllCaptures:eventBytes+pipeBytes+20*MiB,archivedPackage:seal.archive.size,extraMetadataReserve:8*MiB};
const logicalMaximum=Object.values(components).reduce((sum,value)=>sum+value,0);assert(logicalMaximum<512*MiB);
const captureMaximum=eventBytes+pipeBytes+20*MiB;assert(captureMaximum<=128*MiB);
write('BINDING-RECIPE.json',{status:'SOURCE_REPAIR_NOT_MATERIALIZED_RUNTIME',frozenExecutionSealSha256:hash(sealBytes),sourceTree:seal.sourceTree,archive:seal.archive,definitions:{path:parent+'/v4/CASES-v4.json',sha256:hash(read(parent+'/v4/CASES-v4.json')),count:70,layoutCells:210},priorCellSha256:hash(Buffer.from(source)),newCellSha256:hash(Buffer.from(cell)),priorDispatchSha256:hash(Buffer.from(dispatch)),newDispatchSha256:hash(Buffer.from(nextDispatch)),unchangedBody:{bytes:Buffer.byteLength(body),sha256:hash(Buffer.from(body)),startAnchor:'  const cell = JSON.parse(',endAnchor:'} catch (error) { primaryFailed = true;'},newModules:['event-writer.mjs','finalize-cell.mjs'],requiredNextBinding:'copy exact new harness modules into newly owned layout copies and regenerate only paths/manifests/controller seals; never mutate v4/v6 roots; reauthenticate same product files before imports',layouts,productExecuted:false,Workers:0});
write('WORKING-BOUND.json',{domain:'prospective logical regular-file bytes, not allocated blocks/RSS/Git internal storage',components,logicalMaximum,limit:512*MiB,captureMaximum,captureLimit:128*MiB,sourceBasis:'all frozen layout row sizes; twice for old/new copies; exact per-cell event and combined pipe reservations; fixed metadata/tool/publication ceilings; immutable inventory must admit copied bytes before materialization',conditions:['No arbitrary additional files or duplicate evidence copies','Only declared bounded write roles','Git object/index/internal storage explicitly outside this logical budget','No raw whole executable copies; stream tool hashes','Existing old roots remain immutable'],runtimeAuthority:false});
write('SOURCE-PREPARATION.json',{at:new Date().toISOString(),phase:'SOURCE_DATA_ONLY',patchSha256:hash(Buffer.from(patch)),bodySha256:hash(Buffer.from(body)),staticBytes,logicalMaximum,captureMaximum,Workers:0,product:0});
console.log(JSON.stringify({patchSha256:hash(Buffer.from(patch)),bodySha256:hash(Buffer.from(body)),staticBytes,logicalMaximum,captureMaximum,layouts:layouts.map(row=>({name:row.name,bytes:row.bytes})),at:new Date().toISOString()}));
