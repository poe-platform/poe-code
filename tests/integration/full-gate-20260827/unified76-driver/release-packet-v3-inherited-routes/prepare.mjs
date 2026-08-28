import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {existsSync,lstatSync,readFileSync,realpathSync} from 'node:fs';
import {dirname,join,resolve} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {gunzipSync} from 'node:zlib';

const here=dirname(fileURLToPath(import.meta.url)),root=resolve(here,'../../../../..');
const shipping='tests/integration/full-gate-20260827/unified76-driver/launcher-v3/';
const source='96daebc077381fb63ab6447a26ab707ce790ff25';
const review='5bec6231de149d00ae707bfc0ca914d6ee6e1e0a';
const previous='d9dd698a33421b197ee15432a6606ad91dd06c63';
const candidate='f5e9fc49b6abb38e180cc9de16c95fced102ff75';
const sha=value=>createHash('sha256').update(value).digest('hex');
const normalized=value=>sha(JSON.stringify(value));
const read=path=>readFileSync(join(root,path));
let gitMetadataCommands=0;
const git=(...args)=>{gitMetadataCommands++;return execFileSync('/Applications/Xcode.app/Contents/Developer/usr/bin/git',['--no-replace-objects',...args],{cwd:root,timeout:10000,maxBuffer:12*1024*1024});};
function bound(path,revision){
  assert.ok(!path.split('/').some(name=>name.toLowerCase()==='agents.md'));
  const bytes=read(path),stat=lstatSync(join(root,path));assert.ok(stat.isFile()&&!stat.isSymbolicLink()&&stat.size<12*1024*1024);
  assert.deepEqual(bytes,git('show',revision+':'+path));
  const [mode,type,blob]=git('ls-tree',revision,'--',path).toString().trim().split(/\s+/u);assert.equal(type,'blob');assert.equal(stat.mode&0o777,Number.parseInt(mode,8)&0o777);
  return{path,revision,blob,mode,bytes:bytes.length,sha256:sha(bytes)};
}
export async function prepare(){
  for(const file of ['PACKET.json','VALIDATION.json','ROOT-RECEIPT.template.json'])assert.equal(existsSync(join(here,file)),false,'append-only packet already exists');
  const previousPath='tests/integration/full-gate-20260827/unified76-driver/release-packet-v2-final-routes/PACKET.json';
  const previousBinding=bound(previousPath,previous),old=JSON.parse(read(previousPath));assert.equal(normalized(old),'7e40e84c099d8eaa2e9bc4c1cc73274b4a174d699737f34b7015eb4eb706ec70');
  const seal=JSON.parse(read(shipping+'DRIVER.json'));assert.equal(normalized(seal),'2db94b8bf54405e5713b103bd677c873fcc0b153454b3deed13ee8ab4e90583e');
  const files=[bound(shipping+'DRIVER.json',source),...Object.keys(seal.files).map(file=>bound(shipping+file,source))];assert.equal(files.length,38);
  for(const entry of files.slice(1))assert.equal(entry.sha256,seal.files[entry.path.slice(shipping.length)]);
  const previousFiles=new Map(old.driver.files.map(entry=>[entry.path,entry]));assert.deepEqual([...previousFiles.keys()].sort(),files.map(entry=>entry.path).sort());
  const identical=files.filter(entry=>{const prior=previousFiles.get(entry.path);return ['sha256','blob','bytes','mode'].every(key=>entry[key]===prior[key]);});
  const changed=files.filter(entry=>!identical.includes(entry));assert.equal(identical.length,35);assert.deepEqual(changed.map(entry=>entry.path.slice(shipping.length)).sort(),['DRIVER.json','execute.mjs','tool-routing.mjs']);
  const unpack=name=>JSON.parse(gunzipSync(Buffer.from(read(shipping+name).toString().trim(),'base64'),{maxOutputLength:12*1024*1024}));
  const profile=unpack('PROFILE.json.gz.base64'),external=unpack('EXTERNAL.json.gz.base64'),receipt=JSON.parse(read(shipping+'CANDIDATE.json'));
  assert.equal(normalized(profile),old.profile.normalizedSha256);assert.equal(profile.candidate,candidate);assert.equal(seal.candidate,candidate);
  assert.equal(normalized(profile.cleanup),old.profile.cleanupNormalizedSha256);
  for(const[name,expected]of [['INSTRUCTION-PROJECTION.json',old.projection.normalizedSha256],['TOOL-ROUTES.json',old.tools.routesNormalizedSha256]])assert.equal(normalized(JSON.parse(read(shipping+name))),expected);
  assert.deepEqual(external.tools,old.tools.readableTools);assert.deepEqual(external.native.assets,old.tools.nativeAssets);
  assert.equal(sha(git('cat-file','commit',candidate)),receipt.rawCommitSha256);assert.equal(git('rev-parse',candidate+'^{tree}').toString().trim(),receipt.tree);assert.equal(git('rev-parse',candidate+':src').toString().trim(),receipt.sourceTree);
  for(const entry of receipt.changes)assert.equal(sha(git('show',candidate+':'+entry.path)),entry.afterSha256);
  const helper=bound('tests/integration/full-gate-20260827/combined-8670ebe8/prerequisites.mjs',candidate);assert.equal(helper.sha256,'60ae62f6bab6e0348288cd04a6f69c551ce13769bd7ea9e47fb251b9a9dfa2db');
  const proofFiles=old.independent.proofFiles.map(entry=>{assert.deepEqual(bound(entry.path,entry.revision),entry);return entry;});
  const proofRoot='tests/integration/full-gate-20260827/unified76-driver-independent/';
  const proofSets=[
    ['7fd7c7aee3902e8a8a0cc66460858e8ea6966e13','release-packet-v11/',['HANDOFF.md','RECEIPT.json']],
    ['99684045c7bbd0ea40e1eb2f15271cfef8c626e0','scoped-env-v13/review-v1/',['HANDOFF.md','FINAL.json','RESULTS.json','ARTIFACTS.json']],
    [review,'scoped-env-v13/review-v2/',['HANDOFF.md','FINAL.json','RESULTS.json','ARTIFACTS.json','OUTER-CAPTURE.json']],
    ['13c50ab58b76423e53f0e49da859dff584343fe9','scoped-env-v13/review-v2/',['RECIPE.json']],
  ];
  for(const[revision,prefix,names]of proofSets)for(const name of names)proofFiles.push(bound(proofRoot+prefix+name,revision));
  const output='/tmp/full-gate-unified76-f5-scopedenv-20260828-r2';
  const authorizationFile='/tmp/unified76-release-f5-scopedenv-20260828-r2.json';
  for(const path of [output,authorizationFile])assert.equal(existsSync(path),false,'future launch destination already exists');
  const packet=structuredClone(old);packet.schema='unified76-release-packet/3-inherited-routes';packet.createdAt=new Date().toISOString();packet.executionAuthorized=false;packet.fullGateLaunched=false;
  packet.supersedes={packet:previousBinding,normalizedSha256:normalized(old),consumedAuthorization:'8e6b40ecd2cec2b6dcaf2ce80c0cff477d39e6eb',failedAttempt:'df89d474bb863b3815f6e81f81917dcef4227779',originalPhases:0,totalPhases:14,originalEpermTarget:'UNKNOWN',qualification:'Old launch consumed authorization; retained roots/raw failure/absent private postguard unchanged. No old GO transfers.'};
  packet.driver={source,implementationCommit:'02a5060019bccdd2a64f9811812104ba09d2aaee',normalizedSha256:normalized(seal),files,byteIdenticalInheritedFiles:identical,changedFiles:changed.map(after=>({before:previousFiles.get(after.path),after}))};
  packet.product.fixtureReceipt=files.find(entry=>entry.path.endsWith('/CANDIDATE.json'));packet.helper=helper;
  packet.independent={acceptedCommit:review,qualificationCommit:'99684045c7bbd0ea40e1eb2f15271cfef8c626e0',recipeCommit:'13c50ab58b76423e53f0e49da859dff584343fe9',priorAcceptedCommit:old.independent.acceptedCommit,priorMetadataCommit:'7fd7c7aee3902e8a8a0cc66460858e8ea6966e13',proofFiles,newPacketMetadataReview:'PENDING',qualification:'Root-accepted scoped inherited-route review, not gate release. Old97c/7fd evidence applies only to enumerated35 byte-identical shipping members; changed3 newly reviewed. No complete-prerequisites/privateState/A10/pack/fullgate replay.',cohorts:{original:{pass:30,harnessFail:2,unexecuted:1,unchanged:true},new:{pass:14,fail:0,unexecuted:0,originalAuthorityObligations:2,separateAdapterCases:2,otherControls:10},unsupported:'E03.3 all-nonempty ambient GIT restoration remains inadmissible/unexecuted; admission refusal and present-empty restoration are separate controls.',actual:'Two shipping-fenced bare-Git reads and coordinator exit0; pre-dispatch route resolution and actual outcomes, NOT kernel exec trace. Original EPERM target UNKNOWN.'}};
  packet.policies.release='AWAITING new packet metadata review and fresh explicit ROOT_RELEASE_UNIFIED76. One run only after release; no prior/consumed GO, retries, permission widening or mutable overlays. Unknown route/guard/cleanup failure => nonzero HOLD.';
  packet.policies.inheritedRoutes='Three-key process-local cooperating scope, complete awaited prerequisites plus both outer private guards; fresh route validation, exact restoration, overlap/drift rejection, multiple-error retention and poisoned unrestored state. Settlement/disconnection is not detached-child closure; explicit nested environments unchanged.';
  packet.launch={...old.launch,output,physicalOutput:output.replace('/tmp/','/private/tmp/'),authorizationFile,args:['--candidate',candidate,'--run',output,'--release',authorizationFile,'--committed-archive'],supervisorOutputPattern:'<physical parent tmpdir>/unified76-supervisor-*; bind actual path in fresh outer receipt',preRunStatus:'NOT AUTHORIZED; destinations absent at preparation; no output/authorization created.'};
  packet.verification={newArchive:false,instructionBodiesCopied:false,productBuilds:0,productExecutions:0,privateReads:false,nativeOracleExecutions:0,gateToolProbes:0,gitMetadataCommands,metadataOnly:true,toolsRehashed:false,qualification:'Read-only Git metadata/blob queries and bounded JSON/hash checks. No tool/oracle probe, setup, native/control replay, build, pack or private access. Actual shipping admission must recheck current external identities after fresh root release.'};
  const template={action:'AWAITING_FRESH_ROOT_RELEASE',candidate,driverSha256:packet.driver.normalizedSha256,profileSha256:packet.profile.normalizedSha256,packageSha256:packet.product.expectedPackageSha256,public74:true,public75:true,public76:true,independentDriverAccepted:true,authorization:'',independentEvidence:review+' scoped acceptance with99684045 qualifications;97c081ec/7fd7c7ae only enumerated unchanged bindings. NEW packet metadata review still pending.',packetSha256:normalized(packet),evidenceBindings:proofFiles,qualification:'Invalid until fresh explicit root authorization for this exact committed packet plus its new independent metadata seal; not a transferable old GO or consumed-token mechanism.'};
  const {requireRelease,parse}=await import(pathToFileURL(join(root,shipping+'admission.mjs')));
  assert.throws(()=>requireRelease(template,seal,profile));const parsed=parse(packet.launch.args);assert.equal(parsed.execute,true);assert.equal(parsed.output,packet.launch.output);
  assert.throws(()=>requireRelease({...template,action:'ROOT_RELEASE_UNIFIED76',authorization:'SHAPE-CONTROL-ONLY',driverSha256:old.driver.normalizedSha256},seal,profile));
  assert.equal(packet.phases.length,14);assert.equal(packet.profile.defaultCount,76);assert.equal(packet.profile.classifiedMts,192);assert.equal(packet.profile.canonicalPaths,632);assert.equal(packet.profile.cleanupInputs,256);assert.equal(packet.tools.nativeAssets.length,51);
  const validation={at:new Date().toISOString(),normalizedPacketSha256:normalized(packet),shippingFiles:38,unchangedShippingFiles:35,changedShippingFiles:3,proofFiles:proofFiles.length,helperSha256:helper.sha256,templateRejected:true,oldDriverReceiptRejected:true,launchArgumentsParsedOnly:true,futurePathsAbsent:true,productUnchanged:true,fullGateLaunched:false,metadataOnly:true,gitMetadataCommands,toolsRehashed:false,qualification:'Static preparation only; no new release authorization or actual admission run. DRIVER/profile hashes are parsed-object hashes, raw hashes are separately bound.'};
  const filesToWrite={'PACKET.json':packet,'ROOT-RECEIPT.template.json':template,'VALIDATION.json':validation};
  console.log('*** Begin Patch');for(const[name,value]of Object.entries(filesToWrite))console.log('*** Add File: '+join(here,name).slice(root.length+1)+'\n'+JSON.stringify(value,null,2).split('\n').map(line=>'+'+line).join('\n'));console.log('*** End Patch');
}
if(process.argv[1]&&realpathSync(process.argv[1])===fileURLToPath(import.meta.url)){assert.deepEqual(process.argv.slice(2),['--emit-metadata-patch']);await prepare();}
