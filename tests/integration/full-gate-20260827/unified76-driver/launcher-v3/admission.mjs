import assert from 'node:assert/strict';
import {readFileSync,realpathSync,lstatSync} from 'node:fs';
import {resolve,join} from 'node:path';
import {pathToFileURL} from 'node:url';
import {directory,repository,candidate,sha,blob,git} from './common.mjs';
import {readProfile,validateProfile} from './profile.mjs';
import {parseArgs} from './policy.mjs';
import {requireEligibilityRelease} from './historical-eligibility.mjs';

export const order=['safejs-availability','cold-typecheck','typecheck-all','benchmark-types','env-source-binding','canonical','current-consumers','pack','public-runtime','public-types','negative-types','missing-root','missing-contracts','final-sweep'];
export const runtimeFiles=['CANDIDATE.json','PROFILE.json.gz.base64','PROFILE-RECEIPT.json','CLEANUP.json','EXTERNAL.json.gz.base64','EXTERNAL-RECEIPT.json','common.mjs','profile.mjs','admission.mjs','inventory.mjs','run.mjs','worker.mjs','supervise.mjs','execute.mjs','policy.mjs','transport.mjs','external.mjs','external-admission.mjs','built-consumers.mjs','consumer-admission.mjs','tap.mjs','public.mjs','consumer.mts.fixture','negative.mts.fixture','build-audit.mjs','build-types.mjs','phase-runner.mjs','process-observer.mjs','review-build-types.mjs','review-build-types-worker.mjs','projection.mjs','INSTRUCTION-PROJECTION.json'];
runtimeFiles.push('os-instruction-fence.mjs','fenced-supervisor.mjs','OS-INSTRUCTION-FENCE.json');
runtimeFiles.push('tool-routing.mjs','TOOL-ROUTES.json');
runtimeFiles.push('historical-eligibility.mjs','ELIGIBILITY.json','maintained-prerequisites.mjs');
export function requireOrdered(completed,next){assert.equal(next,order[completed.length],'phase omitted or reordered');assert.deepEqual(completed,order.slice(0,completed.length));}
export function canonicalArguments(profile){return ['--import','tsx','--test','--test-reporter=tap',`--test-concurrency=${profile.testConcurrency}`,...profile.canonicalFiles];}
export function requireCanonicalArguments(args,profile){assert.deepEqual(args,canonicalArguments(profile),'canonical discovery, TAP and concurrency are mandatory');}
export function parse(args){
  return parseArgs(args);
}
export function requireRelease(receipt,seal,profile){
  requireEligibilityRelease(receipt,profile);
  assert.equal(receipt.action,'ROOT_RELEASE_UNIFIED76');assert.equal(receipt.candidate,candidate.candidate);assert.equal(receipt.driverSha256,sha(JSON.stringify(seal)));
  assert.equal(receipt.profileSha256,sha(JSON.stringify(profile)));assert.equal(receipt.packageSha256,candidate.expectedPackageSha256);
  assert.equal(receipt.public74,true);assert.equal(receipt.public75,true);assert.equal(receipt.public76,true);assert.equal(receipt.independentDriverAccepted,true);
  assert.match(receipt.authorization,/\S/u);assert.match(receipt.independentEvidence,/\S/u);
}
export function verifyDriverSeal(){
  const seal=JSON.parse(readFileSync(join(directory,'DRIVER.json')));
  assert.deepEqual(Object.keys(seal.files).sort(),runtimeFiles.slice().sort(),'driver closure may not omit or add executable bindings');
  for(const[path,expected]of Object.entries(seal.files)){const file=join(directory,path);const stat=lstatSync(file);assert.ok(stat.isFile()&&!stat.isSymbolicLink());assert.equal(sha(readFileSync(file)),expected,path);}
  assert.equal(seal.candidate,candidate.candidate);return seal;
}
export async function admission(profile=readProfile(),environment=process.env){
  validateProfile(profile);
  for(const[path,expected]of Object.entries(profile.support))assert.equal(sha(readFileSync(join(repository,path))),expected,`external driver support differs from fixed product: ${path}`);
  const runtime=await import(pathToFileURL(join(repository,'tests/integration/full-gate-20260827/runtime-profile-20260827/profile.mjs')));
  const preflight=await import(pathToFileURL(join(repository,'tests/integration/full-gate-20260827/preflight-repair/preflight.mjs')));
  const observed=runtime.inspectRuntime();const native=preflight.assessNative(profile.native,repository,environment);
  const issues=[...native.issues];if(!observed.supported)issues.push({kind:'runtime-unqualified',runtime:observed});
  if(realpathSync(process.execPath)!==observed.identity.path||process.version!==observed.identity.version)issues.push({kind:'launcher-child-runtime-mismatch'});
  if(process.platform!==profile.platform||process.arch!==profile.arch)issues.push({kind:'host-profile'});
  return{candidate:profile.candidate,tree:profile.tree,mode:'explicit committed archive independent of unrelated live modifications',runtime:observed,native,issues,status:issues.length?'preflight-rejected-before-suite':'preflight-admitted-not-product-acceptance',environment:profile.environment,suiteLaunched:false};
}
