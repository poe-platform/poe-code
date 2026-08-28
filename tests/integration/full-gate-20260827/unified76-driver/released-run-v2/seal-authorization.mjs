import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {existsSync,lstatSync,readFileSync,writeFileSync} from 'node:fs';
import {dirname,resolve} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';

const here=dirname(fileURLToPath(import.meta.url)),root=resolve(here,'../../../../..');
const packetPath='tests/integration/full-gate-20260827/unified76-driver/release-packet-v3-inherited-routes/PACKET.json';
const packetCommit='52e83606dc41297a20cbeb3e0fc4ecf703bb242d';
const metadataReview='7ecfe4538beb1cbdc2beef7e7b6d055b187ea580';
const driverReview='5bec6231de149d00ae707bfc0ca914d6ee6e1e0a';
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const git=(...args)=>execFileSync('/Applications/Xcode.app/Contents/Developer/usr/bin/git',['--no-replace-objects',...args],{cwd:root,timeout:10000,maxBuffer:8*1024*1024});
const read=path=>readFileSync(resolve(root,path));
assert.deepEqual(process.argv.slice(2),['--seal-fresh-root-message']);
for(const name of ['ROOT-AUTHORIZATION.json','AUTHENTICATION.json'])assert.equal(existsSync(resolve(here,name)),false);
const packetBytes=read(packetPath);assert.deepEqual(packetBytes,git('show',packetCommit+':'+packetPath));
const packet=JSON.parse(packetBytes);assert.equal(sha(JSON.stringify(packet)),'6cc921ca044fed1b84546bb824f1ab7fc545119c7a5f8ecefd272b23dcd61195');
const bindings=[];
for(const entry of [...packet.driver.files,...packet.independent.proofFiles]){
  const stat=lstatSync(resolve(root,entry.path));assert.ok(stat.isFile()&&!stat.isSymbolicLink());assert.equal(stat.mode&0o777,Number.parseInt(entry.mode,8)&0o777);
  const bytes=read(entry.path);assert.equal(sha(bytes),entry.sha256);assert.deepEqual(bytes,git('show',entry.revision+':'+entry.path));bindings.push(entry);
}
for(const name of ['HANDOFF.md','RECEIPT.json']){
  const path='tests/integration/full-gate-20260827/unified76-driver-independent/release-packet-v14/'+name,bytes=read(path);
  assert.deepEqual(bytes,git('show',metadataReview+':'+path));bindings.push({path,revision:metadataReview,bytes:bytes.length,sha256:sha(bytes)});
}
const receipt={
  action:'ROOT_RELEASE_UNIFIED76',candidate:packet.product.candidate,driverSha256:packet.driver.normalizedSha256,
  profileSha256:packet.profile.normalizedSha256,packageSha256:packet.product.expectedPackageSha256,routesSha256:packet.tools.routesNormalizedSha256,
  public74:true,public75:true,public76:true,independentDriverAccepted:true,
  authorization:"THIS fresh root user message on August 28, 2026 beginning 'FRESH ROOT AUTHORIZATION — ROOT_RELEASE_UNIFIED76', accepting final packet review7ecfe4538beb1cbdc2beef7e7b6d055b187ea580, explicitly authorizes ONE full14-phase attempt EXACTLY packet52e83606dc41297a20cbeb3e0fc4ecf703bb242d normalized6cc921ca044fed1b84546bb824f1ab7fc545119c7a5f8ecefd272b23dcd61195. Candidatef5e9fc49b6abb38e180cc9de16c95fced102ff75; driver2db94b8bf54405e5713b103bd677c873fcc0b153454b3deed13ee8ab4e90583e; profile8c9363ea17f6a319acc783b1e7ec2a4d4dc0a00529692b9f2331f60571ab149f; packagec109372f90b1bd19bcf756cf993bb2976fb52b75fe0c92a1cf96dab4c229b5cd; public74/public75/public76/independentDriverAccepted=true. Seal actual receipt atomically, then execute release-packet-v3-inherited-routes/LAUNCH.md:80 exactly once at /tmp/full-gate-unified76-f5-scopedenv-20260828-r2. Shipping external/tool preflight precedes its authorization check, which must precede materialization/worker dispatch. Bounds setup600s/phase<=1800s/outer25805s/cleanup5s,256MiB phase/4GiB aggregate,13 supervised phases plus final sweep remain unchanged. NO retries, wider permissions, new routes, mutable overlays or inherited GO. Original8e6b/df89 remains consumed0/14 failure with unknown EPERM target. Preserve E03.3 unsupported, priorA10/protection bound not fresh, exact instruction projection/OS fence/privatebb23 read-only regular copies/pre-post guards and foreign staging. Ordinary assertions aggregate only after clean/integrity-safe settlement; unknown route/writer/cleanup/integrity failure stops dependent work without ambient fallback. No XAN/new-feature injection into fixed76. Keep all raw failed artifacts, no silent reset. One-shot root policy, not a token mechanism or hard-kernel-drain claim.",
  independentEvidence:driverReview+':tests/integration/full-gate-20260827/unified76-driver-independent/scoped-env-v13/review-v2/HANDOFF.md; '+metadataReview+':tests/integration/full-gate-20260827/unified76-driver-independent/release-packet-v14/HANDOFF.md; composed with99684045c7bbd0ea40e1eb2f15271cfef8c626e0 original30PASS/2harnessFAIL/1UNEXECUTED unchanged. New14PASS includes2E10 obligations+2separate adapter cases+10controls, not14new product cases. E03.3 unsupported; actual shipping-fenced reads/coordinator0 are not kernel exec trace. Prior97c081ec/7fd7c7ae evidence only for enumerated35 unchanged shipping members; priorA10/protection/package proof bound, not freshly rerun.',
  sealedAt:new Date().toISOString(),packetCommit,packetRawSha256:sha(packetBytes),packetSha256:sha(JSON.stringify(packet)),packetNormalizedSha256:sha(JSON.stringify(packet)),
  evidenceBindings:packet.independent.proofFiles,bindingRecords:bindings,
  attempt:{limit:1,retryAuthorized:false,consumedTokenMechanism:false,output:packet.launch.output,externalReceipt:packet.launch.authorizationFile,priorConsumedAuthorization:'8e6b40ecd2cec2b6dcaf2ce80c0cff477d39e6eb'},
};
const shipping='tests/integration/full-gate-20260827/unified76-driver/launcher-v3/';
const {requireRelease,verifyDriverSeal}=await import(pathToFileURL(resolve(root,shipping+'admission.mjs')));
const {readProfile}=await import(pathToFileURL(resolve(root,shipping+'profile.mjs')));
requireRelease(receipt,verifyDriverSeal(),readProfile());
assert.equal(existsSync(packet.launch.output),false);assert.equal(existsSync(packet.launch.authorizationFile),false);
const bytes=Buffer.from(JSON.stringify(receipt,null,2)+'\n');writeFileSync(packet.launch.authorizationFile,bytes,{flag:'wx',mode:0o600});assert.deepEqual(readFileSync(packet.launch.authorizationFile),bytes);
const authentication={at:new Date().toISOString(),receiptSha256:sha(bytes),packetCommit,metadataReview,driverReview,records:bindings.length,requireReleaseShapeCheck:'passed; not shipping admission or external tool probe',externalReceipt:packet.launch.authorizationFile,outputStillAbsent:!existsSync(packet.launch.output),fullGateLaunches:0,qualification:'Fresh root message plus pinned committed evidence. Actual run still performs external preflight before its receipt check; no cryptographic consumed-token mechanism.'};
console.log('*** Begin Patch');
for(const[name,value]of [['ROOT-AUTHORIZATION.json',receipt],['AUTHENTICATION.json',authentication]])console.log('*** Add File: '+resolve(here,name).slice(root.length+1)+'\n'+JSON.stringify(value,null,2).split('\n').map(line=>'+'+line).join('\n'));
console.log('*** End Patch');
