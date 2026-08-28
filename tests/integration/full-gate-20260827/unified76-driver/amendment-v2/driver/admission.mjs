import assert from 'node:assert/strict';
import {readFileSync,realpathSync,lstatSync} from 'node:fs';
import {resolve,join} from 'node:path';
import {pathToFileURL} from 'node:url';
import {directory,repository,candidate,sha,blob,git} from './common.mjs';
import {readProfile,validateProfile} from './profile.mjs';

export const order=['safejs-availability','cold-typecheck','typecheck-all','benchmark-types','env-source-binding','canonical','current-consumers','pack','public-runtime','public-types','negative-types','missing-root','missing-contracts','final-sweep'];
export const runtimeFiles=['CANDIDATE.json','PROFILE.json.gz.base64','PROFILE-RECEIPT.json','common.mjs','profile.mjs','admission.mjs','inventory.mjs','run.mjs','public.mjs','consumer.mts.fixture','negative.mts.fixture'];
export function requireOrdered(completed,next){assert.equal(next,order[completed.length],'phase omitted or reordered');assert.deepEqual(completed,order.slice(0,completed.length));}
export function canonicalArguments(profile){return ['--import','tsx','--test','--test-reporter=tap',`--test-concurrency=${profile.testConcurrency}`,...profile.canonicalFiles];}
export function requireCanonicalArguments(args,profile){assert.deepEqual(args,canonicalArguments(profile),'canonical discovery, TAP and concurrency are mandatory');}
export function parse(args){
  assert.ok(args.length===3||args.length===7,'--candidate FULL_SHA --inspect OR --candidate FULL_SHA --execute NEW_DIRECTORY --release ROOT_RECEIPT --committed-archive');
  assert.equal(args[0],'--candidate');assert.equal(args[1],candidate.candidate);
  if(args.length===3){assert.equal(args[2],'--inspect');return{execute:false,candidate:args[1]};}
  assert.equal(args[2],'--execute');assert.equal(args[4],'--release');assert.equal(args[6],'--committed-archive');return{execute:true,candidate:args[1],output:resolve(args[3]),release:resolve(args[5])};
}
export function requireRelease(receipt,seal,profile){
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
  if(process.platform!==profile.platform||process.arch!==profile.arch)issues.push({kind:'host-profile'});
  return{candidate:profile.candidate,tree:profile.tree,mode:'explicit committed archive independent of unrelated live modifications',runtime:observed,native,issues,status:issues.length?'preflight-rejected-before-suite':'preflight-admitted-not-product-acceptance',environment:profile.environment,suiteLaunched:false};
}
