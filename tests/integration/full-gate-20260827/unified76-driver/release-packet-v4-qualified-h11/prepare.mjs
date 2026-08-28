import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {existsSync,lstatSync,readFileSync,realpathSync} from 'node:fs';
import {dirname,join,resolve} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {gunzipSync} from 'node:zlib';

const here=dirname(fileURLToPath(import.meta.url));
const root=resolve(here,'../../../../..');
const prefix='tests/integration/full-gate-20260827/unified76-driver/';
const shipping=prefix+'launcher-v3/';
const reviewPrefix='tests/integration/full-gate-20260827/unified76-driver-independent/';
const source='f03c260269dfd8ee10666f7fd2560655f8e14a38';
const eligibilitySource='e35d83ca97f6aa4f32b2cb8542f5e711458f6aeb';
const review='652b76f4af9a03ba1fe0d8f90ca5128463f9e34b';
const previous='52e83606dc41297a20cbeb3e0fc4ecf703bb242d';
const candidate='f5e9fc49b6abb38e180cc9de16c95fced102ff75';
const sha=value=>createHash('sha256').update(value).digest('hex');
const normalized=value=>sha(JSON.stringify(value));
const read=path=>readFileSync(join(root,path));
let gitMetadataCommands=0;
const git=(...args)=>{
  gitMetadataCommands++;
  return execFileSync('/Applications/Xcode.app/Contents/Developer/usr/bin/git',['--no-replace-objects',...args],{cwd:root,timeout:10000,maxBuffer:12*1024*1024});
};
function bound(path,revision){
  assert.ok(!path.split('/').some(name=>name.toLowerCase()==='agents.md'));
  const stat=lstatSync(join(root,path));
  assert.ok(stat.isFile()&&!stat.isSymbolicLink()&&stat.size<12*1024*1024);
  const bytes=read(path);
  assert.deepEqual(bytes,git('show',revision+':'+path));
  const [mode,type,blob]=git('ls-tree',revision,'--',path).toString().trim().split(/\s+/u);
  assert.equal(type,'blob');
  assert.equal(stat.mode&0o777,Number.parseInt(mode,8)&0o777);
  return {path,revision,blob,mode,bytes:bytes.length,sha256:sha(bytes)};
}
function compareBindings(files,previousFiles){
  const prior=new Map(previousFiles.map(entry=>[entry.path,entry]));
  const identical=[],changed=[],added=[];
  for(const after of files){
    const before=prior.get(after.path);
    if(!before)added.push(after);
    else if(['blob','mode','bytes','sha256'].every(key=>before[key]===after[key]))identical.push(after);
    else changed.push({before,after});
    prior.delete(after.path);
  }
  assert.equal(prior.size,0,'no prior shipping member may disappear');
  return {identical,changed,added};
}
export async function prepare(){
  for(const file of ['PACKET.json','VALIDATION.json','ROOT-RECEIPT.template.json'])assert.equal(existsSync(join(here,file)),false,'append-only metadata already exists');
  const previousPath=prefix+'release-packet-v3-inherited-routes/PACKET.json';
  const previousBinding=bound(previousPath,previous),old=JSON.parse(read(previousPath));
  assert.equal(normalized(old),'6cc921ca044fed1b84546bb824f1ab7fc545119c7a5f8ecefd272b23dcd61195');
  const seal=JSON.parse(read(shipping+'DRIVER.json'));
  assert.equal(normalized(seal),'aca88337d644351888659e4364f0610da0219eb3697de45fa808b509bfbc3424');
  const files=[bound(shipping+'DRIVER.json',source),...Object.keys(seal.files).map(file=>bound(shipping+file,source))];
  assert.equal(files.length,41);
  for(const entry of files.slice(1))assert.equal(entry.sha256,seal.files[entry.path.slice(shipping.length)]);
  const authorBinding=bound(prefix+'supervisor-fault-v1/SOURCE-CANDIDATE.json','89c735fcdfe6e09bc88bb41535bad421e7e0cbd9');
  const author=JSON.parse(read(authorBinding.path));
  assert.deepEqual(files.map(({revision,...entry})=>entry).sort((left,right)=>left.path.localeCompare(right.path)),author.files.slice().sort((left,right)=>left.path.localeCompare(right.path)));
  const compared=compareBindings(files,old.driver.files);
  assert.equal(compared.identical.length,31);assert.equal(compared.changed.length,7);assert.equal(compared.added.length,3);
  assert.deepEqual(compared.changed.map(row=>row.after.path.slice(shipping.length)).sort(),['DRIVER.json','admission.mjs','execute.mjs','policy.mjs','profile.mjs','run.mjs','supervise.mjs']);
  assert.deepEqual(compared.added.map(row=>row.path.slice(shipping.length)).sort(),['ELIGIBILITY.json','historical-eligibility.mjs','maintained-prerequisites.mjs']);
  const oldEligibilityFiles=files.map(entry=>{
    const bytes=git('show',eligibilitySource+':'+entry.path);
    const [mode,type,blob]=git('ls-tree',eligibilitySource,'--',entry.path).toString().trim().split(/\s+/u);
    assert.equal(type,'blob');return {path:entry.path,revision:eligibilitySource,blob,mode,bytes:bytes.length,sha256:sha(bytes)};
  });
  const h11Compared=compareBindings(files,oldEligibilityFiles);
  assert.equal(h11Compared.identical.length,39);assert.equal(h11Compared.added.length,0);
  assert.deepEqual(h11Compared.changed.map(row=>row.after.path.slice(shipping.length)).sort(),['DRIVER.json','supervise.mjs']);
  const {readProfile}=await import(pathToFileURL(join(root,shipping+'profile.mjs')));
  const {requireRelease,parse,verifyDriverSeal}=await import(pathToFileURL(join(root,shipping+'admission.mjs')));
  const {PHASES,BOUNDS}=await import(pathToFileURL(join(root,shipping+'policy.mjs')));
  assert.deepEqual(verifyDriverSeal(),seal);
  const profile=readProfile();
  assert.equal(normalized(profile),'fa6731eec6b41915f3f56affa9cdf29e7352a10e939bb0f1fe1b9d675caa7510');
  const {historicalEligibility,...strict}=profile;
  assert.equal(normalized(strict),old.profile.normalizedSha256);
  assert.equal(normalized(historicalEligibility),'519ac40f0239bf363586c5144bbe7f0f3c72c786f42abbc2d1d9ffb004ba2cf6');
  assert.equal(historicalEligibility.profile,'unified76-historical-file-authority-20260828-v1');
  assert.equal(historicalEligibility.admissionProbesRepeated,false);
  assert.deepEqual(historicalEligibility.obligations.map(row=>[row.id,row.status,row.nativeParity]),[['NA-2755','UNSUPPORTED_HOST_OPERATION','UNQUALIFIED'],['NA-6755','UNSUPPORTED_HOST_OPERATION','UNQUALIFIED']]);
  assert.equal(normalized(profile.cleanup),old.profile.cleanupNormalizedSha256);
  const external=JSON.parse(gunzipSync(Buffer.from(read(shipping+'EXTERNAL.json.gz.base64').toString().trim(),'base64'),{maxOutputLength:12*1024*1024}));
  assert.deepEqual(external.tools,old.tools.readableTools);assert.deepEqual(external.native.assets,old.tools.nativeAssets);
  for(const [name,expected]of [['INSTRUCTION-PROJECTION.json',old.projection.normalizedSha256],['TOOL-ROUTES.json',old.tools.routesNormalizedSha256]])assert.equal(normalized(JSON.parse(read(shipping+name))),expected);
  const candidateReceipt=JSON.parse(read(shipping+'CANDIDATE.json'));
  assert.equal(sha(git('cat-file','commit',candidate)),candidateReceipt.rawCommitSha256);
  assert.equal(git('rev-parse',candidate+'^{tree}').toString().trim(),candidateReceipt.tree);
  assert.equal(git('rev-parse',candidate+':src').toString().trim(),candidateReceipt.sourceTree);
  for(const entry of candidateReceipt.changes)assert.equal(sha(git('show',candidate+':'+entry.path)),entry.afterSha256);
  const helper=bound('tests/integration/full-gate-20260827/combined-8670ebe8/prerequisites.mjs',candidate);
  assert.equal(helper.sha256,'60ae62f6bab6e0348288cd04a6f69c551ce13769bd7ea9e47fb251b9a9dfa2db');
  const proofFiles=old.independent.proofFiles.map(entry=>{assert.deepEqual(bound(entry.path,entry.revision),entry);return entry;});
  const sets=[
    ['aea233274c5cdf5cff7bd667cd6c038eb6550ffb','historical-eligibility-v16/review-v1/',['HANDOFF.md','BINDINGS.json','EVIDENCE.json','STATIC.json','cohort-01/RESULTS.json']],
    ['77f80adc35877da619ff16881b6155d9bb9d17cb','historical-eligibility-v16/gap-mapping-v2/',['ASSESSMENT.md']],
    ['fb6f048d801935d7ebd79ff412f93c9eb387eb88','supervisor-repair-v17/',['HANDOFF.md','BINDINGS.json','RESULTS.json']],
    ['1a5c1dcf44ec7e719e43f4b6f8268bab81a02965','supervisor-repair-v17/continuation-v2/',['AUDIT.md','RECIPE.json','RECIPE.md','compare.mjs']],
    [review,'supervisor-repair-v17/continuation-v2/',['HANDOFF.md','BINDINGS.json','RESULTS.json','CHILDREN.json','cohort-01.json']],
  ];
  for(const [revision,directory,names]of sets)for(const name of names)proofFiles.push(bound(reviewPrefix+directory+name,revision));
  const consumedEvidence=[bound(prefix+'released-run-v2/HANDOFF.md','55db52a45e583017fba50c02ad64bddce2feb251')];
  const output='/tmp/full-gate-unified76-f5-historical-h11-20260828-r3';
  const authorizationFile='/tmp/unified76-release-f5-historical-h11-20260828-r3.json';
  for(const path of [output,authorizationFile])assert.equal(existsSync(path),false,'future destination already exists');
  const packet=structuredClone(old);
  packet.schema='unified76-release-packet/4-qualified-historical-h11';
  packet.createdAt=new Date().toISOString();packet.executionAuthorized=false;packet.fullGateLaunched=false;
  packet.supersedes={packet:previousBinding,normalizedSha256:normalized(old),consumedAttempts:[old.supersedes,{consumedAuthorization:'c222e17c4cbcc6bcb9da8a77414b90af3c465d88',failedAttempt:'55db52a45e583017fba50c02ad64bddce2feb251',originalPhases:0,totalPhases:14,denialOrigin:'UNKNOWN',qualification:'Historical native file authority failures retained, not repeated or rescored.'}],evidence:consumedEvidence,qualification:'Both prior authorizations consumed. No prior GO transfers.'};
  packet.driver={source,eligibilitySource,normalizedSha256:normalized(seal),files,authorBinding,comparisonWithPreviousPacket:compared,h11ComparisonWithEligibilitySource:h11Compared};
  packet.product.fixtureReceipt=files.find(entry=>entry.path.endsWith('/CANDIDATE.json'));packet.helper=helper;
  packet.profile={...old.profile,normalizedSha256:normalized(profile),strictNormalizedSha256:normalized(strict),eligibilityProfile:historicalEligibility.profile,historicalEligibilitySha256:normalized(historicalEligibility),historicalEligibility};
  packet.independent={acceptedCommit:review,recipeCommit:'1a5c1dcf44ec7e719e43f4b6f8268bab81a02965',eligibilityReview:'aea233274c5cdf5cff7bd667cd6c038eb6550ffb',gapMapping:'77f80adc35877da619ff16881b6155d9bb9d17cb',proofFiles,prior:old.independent,newPacketMetadataReview:'PENDING',qualification:'H11 complete linked module and actual fenced owned children, not full-phase IPC/private/fullgate. Prior route/protection/A10 evidence bound only to enumerated unchanged bytes; changed composition is not certified by old passes.',cohorts:{eligibility:{pass:38,fail:0,unexecuted:2,unchanged:true},originalSupervisor:{pass:15,harnessFail:1,unexecuted:2,artifactsPreserved:505,unchanged:true},newH11:{actualChildren:3,comparatorControls:22,collectorChecks:6,coordinatorExit:0,outerRescue:0,kill:0},H06:'SOURCEQUALIFIED; actual dual-private-error UNEXECUTED; primary and private guard error retained only IF terminal persistence succeeds. No durable capture guarantee on save failure.'}};
  packet.policies.release='AWAITING new independent metadata review and fresh ROOT_RELEASE_UNIFIED76. One qualified attempt only after release; no old GO, retries, widening or overlays. Unknown routes/writers/guards/cleanup failure halt dependent work. Historical obligations force nonzero, never strict/all-qualified green.';
  packet.policies.eligibility='NA-2755/NA-6755 are historical August28 file-operation evidence only; no repeated admission probes. Every other mandatory native/tool/group/private/projection/order check remains strict. All632 canonical paths/bodies remain unchanged, unfiltered and unskipped; any canonical setid operation stays under the unchanged fence with its raw outcome. No Node/directory/symbolic-mode inference or automatic failure deduction; Node22 characterization vs24 gap remains separate.';
  packet.policies.H06=packet.independent.cohorts.H06;
  packet.policies.H11='Ordered typed faults preserve null/undefined and raw cause identity in-process, not across serialization; unknown observation stays nonclean. Bounded known-owned teardown is not hard kernel drain, universal descendant or full-phase IPC proof.';
  packet.launch={...old.launch,output,physicalOutput:output.replace('/tmp/','/private/tmp/'),authorizationFile,args:['--candidate',candidate,'--run',output,'--release',authorizationFile,'--committed-archive'],preRunStatus:'NOT AUTHORIZED; new destinations absent; no output, actual authorization or materialization created.'};
  packet.verdict={successfulRuntimeStatus:'QUALIFIED_DIAGNOSTIC_UNQUALIFIED_NATIVE',otherStatus:'HOLD_OR_QUALIFIED_RED',allRuntimePassAggregateExit:1,admissionRefusalExit:78,qualification:'Exit1 alone is not acceptance; require exact inner/outer verdicts, all14 raw phases, lifecycle, guards and unsupported ledger. No raw fail/skip/TODO/cancel count deductions or automatic test attribution. Missing data remains unknown/unexecuted.'};
  assert.deepEqual(PHASES.map(([name,expectedStatus])=>({name,expectedStatus})),packet.phases);
  for(const [key,value]of Object.entries(BOUNDS))assert.equal(packet.bounds[key],value,key);
  assert.equal(packet.phases.length,14);assert.equal(packet.profile.defaultCount,76);assert.equal(packet.profile.canonicalPaths,632);assert.equal(packet.profile.classifiedMts,192);assert.equal(packet.profile.cleanupInputs,256);assert.equal(packet.tools.nativeAssets.length,51);
  packet.verification={metadataOnly:true,newArchive:false,instructionBodiesCopied:false,productBuilds:0,productExecutions:0,privateReads:false,nativeOracleExecutions:0,gateToolProbes:0,gitMetadataCommands,toolsRehashed:false,qualification:'Read-only Git metadata/blob queries and JSON/hash checks only. No setup, native controls, private copies, phase admission or process supervision. Tool/dependency identities require fresh shipping verification after future root release.'};
  const template={action:'AWAITING_FRESH_ROOT_RELEASE',candidate,driverSha256:normalized(seal),profileSha256:normalized(profile),packageSha256:packet.product.expectedPackageSha256,public74:true,public75:true,public76:true,independentDriverAccepted:true,eligibilityProfile:historicalEligibility.profile,historicalEligibilitySha256:normalized(historicalEligibility),acceptsUnqualifiedHistoricalNative:true,authorization:'',independentEvidence:`${review} scoped H11 acceptance; aea23327/77f80adc H06 and historical qualifications; 5bec6231/99684045 and prior97c081ec/7fd7c7ae only enumerated unchanged bindings. NEW packet metadata review PENDING.`,packetSha256:normalized(packet),evidenceBindings:proofFiles,qualification:'Invalid template. Future fresh root message must name this committed packet/hash, metadata-review seal and qualified nonzero profile. This is not a consumed-token mechanism or inherited authorization.'};
  assert.throws(()=>requireRelease(template,seal,profile));
  const shapeOnly={...template,action:'ROOT_RELEASE_UNIFIED76',authorization:'METADATA-SHAPE-CONTROL-ONLY-NOT-AUTHORIZATION'};
  requireRelease(shapeOnly,seal,profile);
  const mutations=[{action:'AWAITING_FRESH_ROOT_RELEASE'},{authorization:''},{independentEvidence:''},{driverSha256:old.driver.normalizedSha256},{profileSha256:old.profile.normalizedSha256},{eligibilityProfile:undefined},{historicalEligibilitySha256:'0'.repeat(64)},{acceptsUnqualifiedHistoricalNative:false},{candidate:'0'.repeat(40)},{packageSha256:'0'.repeat(64)},{independentDriverAccepted:false}];
  for(const mutation of mutations)assert.throws(()=>requireRelease({...shapeOnly,...mutation},seal,profile));
  const parsed=parse(packet.launch.args);assert.equal(parsed.execute,true);assert.equal(parsed.output,output);
  const validation={at:new Date().toISOString(),metadataOnly:true,normalizedPacketSha256:normalized(packet),shippingBindings:41,unchangedFromE35:39,changedFromE35:2,unchangedFromPreviousPacket:31,changedFromPreviousPacket:7,addedSincePreviousPacket:3,proofFiles:proofFiles.length,templateRefused:true,positiveReceiptShapeOnly:1,negativeReceiptShapes:mutations.length,launchArgumentsParsedOnly:true,futurePathsAbsent:true,fullGateLaunched:false,canonicalPathsUnchanged:632,classifiedMts:192,cleanupInputs:256,nativeIdentities:51,gitMetadataCommands,toolsRehashed:false,actualH06Executed:false,qualification:'Shape checks never call admission/main/execute, supervise, materialize or authorize release. Evidence-string truth is a separate metadata/root-review obligation; source admission does not authenticate those prose assertions.'};
  const documents={'PACKET.json':packet,'ROOT-RECEIPT.template.json':template,'VALIDATION.json':validation};
  console.log('*** Begin Patch');
  for(const [name,value]of Object.entries(documents))console.log('*** Add File: '+join(here,name).slice(root.length+1)+'\n'+JSON.stringify(value,null,2).split('\n').map(line=>'+'+line).join('\n'));
  console.log('*** End Patch');
}
if(process.argv[1]&&realpathSync(process.argv[1])===fileURLToPath(import.meta.url)){
  assert.deepEqual(process.argv.slice(2),['--emit-metadata-patch']);await prepare();
}
