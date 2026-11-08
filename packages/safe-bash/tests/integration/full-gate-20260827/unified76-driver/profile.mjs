import assert from 'node:assert/strict';
import {gunzipSync,gzipSync} from 'node:zlib';
import {mkdtempSync,readFileSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {candidate,directory,entries,blob,sha,save,verifyAssembly} from './common.mjs';

export const supportPaths=[
  'tests/integration/full-gate-20260827/account.mjs',
  'tests/integration/full-gate-20260827/supervise.mjs',
  'tests/integration/full-gate-20260827/preflight-repair/preflight.mjs',
  'tests/integration/full-gate-20260827/preflight-repair/policy.json',
  'tests/integration/full-gate-20260827/runtime-profile-20260827/profile.mjs',
  'tests/integration/full-gate-20260827/integrity-73/tree.mjs',
  'tests/integration/full-gate-20260827/combined-8670ebe8/prerequisites.mjs',
  'tests/integration/full-gate-20260827/combined-8670ebe8/import-guard.mjs',
  'tests/integration/full-gate-20260827/combined-8670ebe8/committed-archive.mjs',
  'tests/integration/full-gate-20260827/combined-b494675c/inspect.mjs',
];
export async function generateProfile() {
  verifyAssembly();
  const helper='tests/integration/full-gate-20260827/candidate-profile-73/prepare.mjs';
  const absolute=resolve(directory,'../../../..',helper);
  assert.equal(sha(readFileSync(absolute)),sha(blob(helper)));
  const {prepare}=await import(pathToFileURL(absolute));
  const temporary=mkdtempSync(join(tmpdir(),'unified76-profile-'));
  prepare(candidate.candidate,join(temporary,'draft'));
  const draft=JSON.parse(readFileSync(join(temporary,'draft/policy.json')));
  const tree=entries(),cleanup=JSON.parse(readFileSync(join(temporary,'draft/cleanup-expected.json')));
  const inventory=JSON.parse(blob('tests/plugins/qualified-current-release/inventory.json'));
  const mts=tree.filter(entry=>entry.path.endsWith('.mts'));
  assert.equal(tree.length,37397);assert.equal(draft.canonicalFiles.length,632);assert.equal(mts.length,192);assert.equal(Object.keys(cleanup.files).length,256);assert.equal(draft.native.length,51);
  for(const entry of mts)assert.equal(inventory.entries.filter(row=>row.path===entry.path).length,1,entry.path);
  const policy={schema:1,candidate:candidate.candidate,tree:candidate.tree,sourceTree:candidate.sourceTree,
    platform:'darwin',arch:'arm64',testConcurrency:2,reporter:'tap',defaultCount:76,
    expectedPackageSha256:candidate.expectedPackageSha256,
    closure:{kind:'complete committed-tree conservative runtime-input superset, not compact typing selection',entries:tree.length,bytes:tree.reduce((sum,entry)=>sum+entry.bytes,0),storedArchive:false,streamedAtExecution:true,qualification:'Historical canonical audits read captured data and Git history. No claim that a smaller static-import selection is complete; all committed tree blobs and ancestor Git objects are retained in isolated temporary storage.'},
    scopeInputs:tree,canonicalFiles:draft.canonicalFiles,native:draft.native,environment:draft.environment,
    historicalBindings:draft.historicalBindings,blockedWriters:draft.blockedWriters,
    cleanup,classifiedMts:mts.map(entry=>({...entry,classification:inventory.entries.find(row=>row.path===entry.path)})),
    support:Object.fromEntries(supportPaths.map(path=>[path,sha(blob(path))])),
    sourceBindings:Object.fromEntries(tree.filter(entry=>entry.path.startsWith('src/')).map(entry=>[entry.path,sha(blob(entry.path))])),
    packageManifestSha256:sha(blob('package.json')),inventorySha256:sha(blob('tests/plugins/qualified-current-release/inventory.json')),
    release:'HOLD_PUBLIC_AND_DRIVER_REVIEW',wholeGateLaunched:false};
  const data=Buffer.from(JSON.stringify(policy));const encoded=gzipSync(data,{level:9}).toString('base64')+'\n';
  return{policy,encoded,receipt:{candidate:policy.candidate,tree:policy.tree,profileSha256:sha(data),encodedSha256:sha(encoded),canonical:632,mts:192,cleanup:256,nativeBase:49,nativeExtensions:2,sourceFiles:Object.keys(policy.sourceBindings).length,closure:policy.closure,temporary}};
}
export function readProfile() {
  const encoded=readFileSync(join(directory,'PROFILE.json.gz.base64'));
  const receipt=JSON.parse(readFileSync(join(directory,'PROFILE-RECEIPT.json')));
  assert.equal(sha(encoded),receipt.encodedSha256);const bytes=gunzipSync(Buffer.from(encoded.toString().trim(),'base64'));assert.equal(sha(bytes),receipt.profileSha256);
  const profile=JSON.parse(bytes);validateProfile(profile);return profile;
}
export function validateProfile(profile) {
  verifyAssembly();assert.equal(profile.candidate,candidate.candidate);assert.equal(profile.tree,candidate.tree);
  assert.equal(profile.sourceTree,candidate.sourceTree);assert.deepEqual(profile.scopeInputs,entries());
  assert.equal(profile.packageManifestSha256,sha(blob('package.json')));
  assert.deepEqual(JSON.parse(blob('package.json')).dependencies??{},{});
  const paths=profile.scopeInputs.map(entry=>entry.path);
  assert.deepEqual(profile.canonicalFiles,paths.filter(path=>/^tests\/.*\.test\.ts$/u.test(path)&&!path.startsWith('tests/commands/regex-execution/continuation/artifacts/native/')).sort());
  assert.equal(profile.canonicalFiles.length,632);assert.equal(profile.testConcurrency,2);assert.equal(profile.reporter,'tap');assert.equal(profile.defaultCount,76);
  const inventory=JSON.parse(blob('tests/plugins/qualified-current-release/inventory.json'));
  assert.equal(profile.inventorySha256,sha(blob('tests/plugins/qualified-current-release/inventory.json')));
  assert.deepEqual(profile.classifiedMts,profile.scopeInputs.filter(entry=>entry.path.endsWith('.mts')).map(entry=>({...entry,classification:inventory.entries.find(row=>row.path===entry.path)})));
  assert.equal(profile.classifiedMts.length,192);assert.ok(profile.classifiedMts.every(entry=>entry.classification));
  assert.equal(profile.cleanup.revision,candidate.candidate);assert.equal(profile.cleanup.tree,candidate.tree);
  const expectedCleanup=[...paths.filter(path=>path.startsWith('src/')),'package.json','package-lock.json','tsconfig.json','tsconfig.build.json','tests/shell/invocation-cleanup-public.test.ts','tests/shell-stress/invocation-cleanup-runtime/public-worker.mjs','tests/shell-stress/invocation-cleanup-runtime/migration/binding.ts'].sort();
  assert.deepEqual(Object.keys(profile.cleanup.files).sort(),expectedCleanup);assert.equal(expectedCleanup.length,256);
  for(const [path,expected]of Object.entries(profile.cleanup.files))assert.equal(sha(blob(path)),expected,path);
  assert.deepEqual(Object.keys(profile.sourceBindings).sort(),paths.filter(path=>path.startsWith('src/')).sort());
  for(const[path,expected]of Object.entries(profile.sourceBindings))assert.equal(sha(blob(path)),expected,path);
  assert.deepEqual(Object.keys(profile.support).sort(),supportPaths.slice().sort());
  for(const[path,expected]of Object.entries(profile.support))assert.equal(sha(blob(path)),expected,path);
  assert.equal(profile.expectedPackageSha256,candidate.expectedPackageSha256);assert.equal(profile.native.length,51);
  const original=JSON.parse(blob('tests/integration/full-gate-20260827/combined-8670ebe8/policy.json','6699804ace9f5522aa67be6a017a8008bfc09f30'));
  assert.deepEqual(profile.native.slice(0,49),original.native.map(asset=>asset.name==='rg'?{...asset,originEnv:'RG_NATIVE_BIN'}:asset));
  assert.deepEqual(profile.native.slice(49).map(({name,sha256})=>({name,sha256})),[{name:'expr',sha256:'e8a4e2b58a33d2ad6bfa9eb8a4ed5f62775ab9ceac4b9421680c98973fd9109c'},{name:'du',sha256:JSON.parse(blob('tests/commands/du/native-profile.json')).binarySha256}]);
  assert.deepEqual(profile.environment,original.environment);assert.deepEqual(profile.historicalBindings,original.historicalBindings);assert.deepEqual(profile.blockedWriters,original.blockedWriters);
  return profile;
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href){
  assert.equal(process.argv[2],'--generate-external');const result=await generateProfile();
  writeFileSync(join(result.receipt.temporary,'PROFILE.json.gz.base64'),result.encoded,{flag:'wx'});save(join(result.receipt.temporary,'PROFILE-RECEIPT.json'),result.receipt);console.log(JSON.stringify(result.receipt));
}
