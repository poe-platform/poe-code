import assert from 'node:assert/strict';
import {readFileSync,readdirSync,mkdtempSync,writeFileSync} from 'node:fs';
import {execFileSync,spawnSync} from 'node:child_process';
import {gzipSync} from 'node:zlib';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {candidate,directory,repository,sha,save,blob} from './common.mjs';
import {readProfile} from './profile.mjs';
import {verifyDriverSeal} from './admission.mjs';

assert.equal(process.argv.length,3,'capture-evidence.mjs INPUT_RECEIPT_JSON');
const inputs=JSON.parse(readFileSync(process.argv[2])),output=mkdtempSync(join(tmpdir(),'unified76-capture-'));
assert.match(inputs.driverCommit,/^[a-f0-9]{40}$/u);assert.equal(execFileSync('git',['rev-parse',`${inputs.driverCommit}^{commit}`],{cwd:repository,encoding:'utf8'}).trim(),inputs.driverCommit);
const raw={};
const add=(label,file)=>{const bytes=readFileSync(file);assert.equal(Object.hasOwn(raw,label),false);raw[label]={path:file,bytes:bytes.length,sha256:sha(bytes),base64:bytes.toString('base64')};};
for(const[label,path]of Object.entries(inputs.files))add(label,path);
for(const[label,path]of Object.entries(inputs.directories))for(const name of readdirSync(path).filter(name=>name.endsWith('.json')))add(label+'/'+name,join(path,name));
const json=label=>JSON.parse(Buffer.from(raw[label].base64,'base64'));
const fixture=json('fixture-initial'),followup=json('fixture-followup'),controls=json('controls-final'),inventory=json('inventory-final'),packages=json('package-v2/REPORT.json');
for(const[path,expected]of Object.entries(controls.sourceBindings))assert.equal(sha(readFileSync(join(directory,path))),expected,path);
const revised=[...fixture.commands.filter(row=>row.label.startsWith('revised-')).map(row=>({label:row.label,...row.accounting.counts})),{label:'revised-4-followup',...followup.accounting.counts}];
const original=fixture.commands.filter(row=>row.label.startsWith('original-')).map(row=>({label:row.label,...row.accounting.counts}));
const sum=rows=>rows.reduce((result,row)=>{for(const key of ['pass','fail','skipped','todo','cancelled'])result[key]=(result[key]??0)+row[key];return result;},{});
const profile=readProfile(),seal=verifyDriverSeal();
for(const[path,expected]of Object.entries(seal.files))assert.equal(sha(execFileSync('git',['--no-replace-objects','show',`${inputs.driverCommit}:tests/integration/full-gate-20260827/unified76-driver/${path}`],{cwd:repository,maxBuffer:16*1024*1024})),expected,path);
const ancestry={};for(const revision of ['eba049535d154f4e028f57ffd8efd7622b2239ca','618d8967009117547ab476256bc6eb0a9463309a','fbbe1ef793b7434871403125efbeb46624a8e081','073d39c6c49d5ee24172706e02179dd6da484483','e422ad06b3470477b7f9323c89289d2963a00407','373437cf','0902f3c5']){const result=spawnSync('git',['--no-replace-objects','merge-base','--is-ancestor',revision,candidate.candidate],{cwd:repository});assert.ok([0,1].includes(result.status));ancestry[revision]=result.status===0;}
const payload=Buffer.from(JSON.stringify(raw)),compressed=gzipSync(payload,{level:9}).toString('base64')+'\n';
const summary={schema:1,capturedAt:new Date().toISOString(),candidate:candidate.candidate,tree:candidate.tree,sourceTree:candidate.sourceTree,driverCommit:inputs.driverCommit,driverSha256:sha(JSON.stringify(seal)),profileSha256:sha(JSON.stringify(profile)),profileEncodedSha256:sha(readFileSync(join(directory,'PROFILE.json.gz.base64'))),cleanupSha256:sha(readFileSync(join(directory,'CLEANUP.json'))),packageManifestSha256:sha(blob('package.json')),tarballSha256:fixture.packageSha256,expectedTarballSha256:candidate.expectedPackageSha256,ancestry,
 fixture:{original,revised,originalTotal:sum(original),revisedTotal:sum(revised),initialReportStatus:fixture.result,remaining:'inspection first registry case fails at definitions.length73; unique count73 and exact old trailing list remain unreached, not changed without approval',source:'actual same rebuilt product, one process per file; revised fourth consumer separately completed after initial harness stopped'},
 controls:{pass:controls.rows.filter(row=>row.status==='PASS').length,fail:controls.rows.filter(row=>row.status==='FAIL').length},inventory:{pass:inventory.rows.filter(row=>row.status==='PASS').length,fail:inventory.rows.filter(row=>row.status==='FAIL').length},packageControls:{pass:packages.rows.filter(row=>row.status==='PASS').length,fail:packages.rows.filter(row=>row.status==='FAIL').length,original:'6/7 author path-alias permission launch error retained; physical-root v2 is7/7'},
 bindings:{nativeBase:49,nativeExtensions:2,nativeObserved:controls.actualNative.native.assets.length,nativeIssues:controls.actualNative.issues,canonical:profile.canonicalFiles.length,classifiedMts:profile.classifiedMts.length,cleanup:Object.keys(profile.cleanup.files).length},
 raw:{encodedSha256:sha(compressed),payloadSha256:sha(payload),artifacts:Object.keys(raw).length,payloadBytes:payload.length},fullGateLaunched:false,sourceTypecheckAllExecuted:false,public74_75_76IndependentlyAcceptedByThisTask:false,privateCheckoutAccessed:false,release:'HOLD_PUBLIC_AND_DRIVER_REVIEW_AND_ROOT_RELEASE',qualification:'author infrastructure and four-fixture/package measurements only; original histories and partial/failed attempts retained'};
assert.equal(summary.tarballSha256,summary.expectedTarballSha256);assert.equal(summary.controls.fail,0);assert.equal(summary.inventory.fail,0);assert.equal(summary.packageControls.fail,0);
for(const entry of fixture.inputs)assert.equal(sha(readFileSync(join(fixture.root,'source',entry.path))),entry.sha256,entry.path);
summary.fixture.finalSelectedSourceInputsUnchanged=true;
writeFileSync(join(output,'RAW.json.gz.base64'),compressed,{flag:'wx'});save(join(output,'AUTHOR-EVIDENCE.json'),summary);save(join(output,'RAW-INDEX.json'),Object.fromEntries(Object.entries(raw).map(([name,{path,bytes,sha256}])=>[name,{path,bytes,sha256}])));
console.log(JSON.stringify({output,...summary}));
