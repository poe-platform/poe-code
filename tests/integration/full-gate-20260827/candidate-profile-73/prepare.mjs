import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { lstatSync, mkdirSync, readFileSync, readdirSync, realpathSync, writeFileSync } from 'node:fs';
import { basename, dirname, join, posix, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const directory=dirname(fileURLToPath(import.meta.url));
const repository=resolve(directory,'../../../..');
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const git=args=>execFileSync('git',['--no-replace-objects',...args],{cwd:repository,maxBuffer:64*1024*1024,env:{...process.env,GIT_OPTIONAL_LOCKS:'0'}});
const text=args=>git(args).toString().trim();
const blob=(candidate,path)=>git(['show',`${candidate}:${path}`]);
const exact=candidate=>{assert.match(candidate,/^[a-f0-9]{40}$/u,'explicit full committed candidate required; HEAD is not a candidate receipt');assert.equal(text(['rev-parse','--verify',`${candidate}^{commit}`]),candidate);};
function nativeExtensions(candidate,paths) {
  const extensions=[];
  if(paths.includes('tests/commands/expr/oracle.ts'))extensions.push({name:'expr',origin:'tests/commands/metadata-stress/.oracle/coreutils-9.7/src/expr',sha256:'e8a4e2b58a33d2ad6bfa9eb8a4ed5f62775ab9ceac4b9421680c98973fd9109c',executable:true,authority:'GNU9.7 author oracle; independent source/profile acceptance remains external',target:'snapshot:tests/commands/metadata-stress/.oracle/coreutils-9.7/src/expr'});
  if(paths.includes('tests/commands/du/native-profile.json'))extensions.push({name:'du',origin:'tests/commands/metadata-stress/.oracle/coreutils-9.7/src/du',sha256:JSON.parse(blob(candidate,'tests/commands/du/native-profile.json')).binarySha256,executable:true,authority:'GNU9.7 author oracle; live presence and profile acceptance remain explicit',target:'snapshot:tests/commands/metadata-stress/.oracle/coreutils-9.7/src/du'});
  return extensions;
}

export function prepare(candidate, output) {
  exact(candidate);
  const destination=join(realpathSync(dirname(resolve(output))),basename(output));
  assert.ok(!destination.startsWith(repository+'/')&&destination!==repository,'profile capture must be outside the live repository');
  const tree=text(['rev-parse',`${candidate}^{tree}`]);
  const entries=git(['ls-tree','-rz',candidate]).toString().split('\0').filter(Boolean).map(row=>{
    const split=row.indexOf('\t'),[mode,type,object]=row.slice(0,split).split(' '),path=row.slice(split+1);
    assert.equal(type,'blob');assert.ok(['100644','100755','120000'].includes(mode));return{path,mode,blob:object};
  });
  const paths=entries.map(entry=>entry.path),configs=new Set();
  const visit=path=>{if(configs.has(path))return;configs.add(path);const config=JSON.parse(blob(candidate,path));if(config.extends)visit(posix.normalize(posix.join(posix.dirname(path),config.extends)));};visit('tsconfig.build.json');
  const selected=[...paths.filter(path=>path.startsWith('src/')),'package.json','package-lock.json',...configs,'tests/shell/invocation-cleanup-public.test.ts','tests/shell-stress/invocation-cleanup-runtime/public-worker.mjs','tests/shell-stress/invocation-cleanup-runtime/migration/binding.ts'].sort((left,right)=>left.localeCompare(right));
  assert.equal(new Set(selected).size,selected.length);
  const files=Object.fromEntries(selected.map(path=>{assert.ok(entries.find(entry=>entry.path===path)?.mode!=='120000','cleanup input must not be a symlink');return[path,sha(blob(candidate,path))];}));
  const cleanup={format:'public-cleanup-committed-v1',revision:candidate,tree,files};
  const originalPolicy=JSON.parse(blob('6699804ace9f5522aa67be6a017a8008bfc09f30','tests/integration/full-gate-20260827/combined-8670ebe8/policy.json'));
  const native=originalPolicy.native.map(asset=>asset.name==='rg'?{...asset,originEnv:'RG_NATIVE_BIN'}:asset);
  const extensions=nativeExtensions(candidate,paths);
  const policy={...originalPolicy,candidate,candidateTree:tree,scope:'DRAFT explicit committed candidate profile; not root approval, launch or whole-product acceptance',canonicalFiles:paths.filter(path=>/^tests\/.*\.test\.ts$/u.test(path)&&!path.startsWith('tests/commands/regex-execution/continuation/artifacts/native/')).sort(),scopeInputs:entries,native:[...native,...extensions],testConcurrency:2};
  const metadata=JSON.parse(blob(candidate,'package.json'));
  assert.deepEqual(metadata.dependencies??{},{});
  const candidateReceipt={candidate,tree,sourceTree:text(['rev-parse',`${candidate}:src`]),bindings:Object.entries(files).map(([path,sha256])=>({path,sha256})),package:metadata,wholeGateLaunched:false,approval:'PENDING_ROOT_COHORT_AND_INDEPENDENT_HARNESS_REVIEW'};
  const inventory=JSON.parse(blob(candidate,'tests/plugins/qualified-current-release/inventory.json'));
  const classified=new Set(inventory.entries.map(entry=>entry.path));
  const blockers={unclassifiedMts:paths.filter(path=>path.endsWith('.mts')&&!classified.has(path)),sourceReviews:'Not inferred from ancestry or HEAD; root must supply the chosen accepted/qualified cohort',launchDriver:'Historical runner remains8670-bound; successor binding is not applied automatically',nativeExtensions:extensions.map(asset=>asset.name),mandatoryProbe:'Node24 guarded feature/permissions/TAP and additional native prerequisites still required'};
  mkdirSync(destination);
  const data={'CANDIDATE.json':JSON.stringify(candidateReceipt,null,2)+'\n','policy.json':JSON.stringify(policy,null,2)+'\n','cleanup-expected.json':JSON.stringify(cleanup,null,2)+'\n','public.mjs':readFileSync(join(directory,'public.mjs')),'consumer.mts.fixture':readFileSync(join(directory,'consumer.mts.fixture'))};
  for(const [name,value]of Object.entries(data))writeFileSync(join(destination,name),value,{flag:'wx'});
  const receipt={candidate,tree,approval:candidateReceipt.approval,launched:false,canonicalFiles:policy.canonicalFiles.length,cleanupInputs:selected.length,nativeBaseAssets:native.length,nativeExtensionAssets:extensions.length,packageManifestSha256:sha(blob(candidate,'package.json')),files:Object.fromEntries(Object.entries(data).map(([name,value])=>[name,sha(value)])),blockers};
  writeFileSync(join(destination,'RECEIPT.json'),JSON.stringify(receipt,null,2)+'\n',{flag:'wx'});
  return receipt;
}
export function verifyPrepared(directory,candidate) {
  exact(candidate);assert.ok(lstatSync(directory).isDirectory()&&!lstatSync(directory).isSymbolicLink());assert.ok(lstatSync(join(directory,'RECEIPT.json')).isFile());
  const receipt=JSON.parse(readFileSync(join(directory,'RECEIPT.json')));
  assert.equal(receipt.approval,'PENDING_ROOT_COHORT_AND_INDEPENDENT_HARNESS_REVIEW');assert.equal(receipt.launched,false);
  assert.equal(receipt.candidate,candidate);assert.equal(receipt.tree,text(['rev-parse',`${candidate}^{tree}`]));
  assert.deepEqual(Object.keys(receipt.files).sort(),['CANDIDATE.json','policy.json','cleanup-expected.json','public.mjs','consumer.mts.fixture'].sort());
  assert.deepEqual(readdirSync(directory).sort(),[...Object.keys(receipt.files),'RECEIPT.json'].sort(),'unexpected profile entries');
  for(const [path,expected]of Object.entries(receipt.files)){assert.ok(lstatSync(join(directory,path)).isFile());assert.equal(sha(readFileSync(join(directory,path))),expected,path);}
  const cleanup=JSON.parse(readFileSync(join(directory,'cleanup-expected.json')));assert.equal(cleanup.revision,candidate);assert.equal(cleanup.tree,receipt.tree);
  const paths=git(['ls-tree','-r','--name-only','-z',candidate]).toString().split('\0').filter(Boolean);
  const configs=new Set();const visit=path=>{if(configs.has(path))return;configs.add(path);const config=JSON.parse(blob(candidate,path));if(config.extends)visit(posix.normalize(posix.join(posix.dirname(path),config.extends)));};visit('tsconfig.build.json');
  const expected=[...paths.filter(path=>path.startsWith('src/')),'package.json','package-lock.json',...configs,'tests/shell/invocation-cleanup-public.test.ts','tests/shell-stress/invocation-cleanup-runtime/public-worker.mjs','tests/shell-stress/invocation-cleanup-runtime/migration/binding.ts'].sort();
  assert.deepEqual(Object.keys(cleanup.files).sort(),expected,'cleanup membership must match committed inputs');
  for(const [path,expected]of Object.entries(cleanup.files))assert.equal(sha(blob(candidate,path)),expected,path);
  const policy=JSON.parse(readFileSync(join(directory,'policy.json')));assert.equal(policy.candidate,candidate);assert.equal(policy.candidateTree,receipt.tree);
  const base=JSON.parse(blob('6699804ace9f5522aa67be6a017a8008bfc09f30','tests/integration/full-gate-20260827/combined-8670ebe8/policy.json'));
  assert.deepEqual(policy.native.slice(0,base.native.length),base.native.map(asset=>asset.name==='rg'?{...asset,originEnv:'RG_NATIVE_BIN'}:asset),'native49 must retain accepted bytes and explicit recovered origin');
  assert.deepEqual(policy.native.slice(base.native.length),nativeExtensions(candidate,paths),'candidate native extensions may not be omitted or rebound');
  assert.equal(policy.testConcurrency,2);
  assert.deepEqual(policy.canonicalFiles,paths.filter(path=>/^tests\/.*\.test\.ts$/u.test(path)&&!path.startsWith('tests/commands/regex-execution/continuation/artifacts/native/')).sort());
  const expectedScope=git(['ls-tree','-rz',candidate]).toString().split('\0').filter(Boolean).map(row=>{const split=row.indexOf('\t'),[mode,,object]=row.slice(0,split).split(' ');return{path:row.slice(split+1),mode,blob:object};});
  assert.deepEqual(policy.scopeInputs,expectedScope,'policy may not silently omit source/artifact inputs');
  const selected=JSON.parse(readFileSync(join(directory,'CANDIDATE.json')));assert.equal(selected.candidate,candidate);assert.equal(selected.tree,receipt.tree);assert.deepEqual(selected.package,JSON.parse(blob(candidate,'package.json')));
  assert.equal(selected.sourceTree,text(['rev-parse',`${candidate}:src`]));assert.equal(selected.wholeGateLaunched,false);assert.equal(selected.approval,receipt.approval);
  assert.deepEqual(selected.bindings,Object.entries(cleanup.files).map(([path,sha256])=>({path,sha256})));
  for(const name of ['public.mjs','consumer.mts.fixture'])assert.equal(sha(readFileSync(join(directory,name))),sha(readFileSync(join(dirname(fileURLToPath(import.meta.url)),name))),'public smoke template binding');
  return receipt;
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href){
  assert.equal(process.argv.length,6,'prepare.mjs --candidate FULL_SHA --output NEW_EXTERNAL_DIRECTORY');assert.equal(process.argv[2],'--candidate');assert.equal(process.argv[4],'--output');
  console.log(JSON.stringify(prepare(process.argv[3],process.argv[5])));
}
