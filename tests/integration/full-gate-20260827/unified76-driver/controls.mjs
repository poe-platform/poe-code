import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {chmodSync,cpSync,mkdirSync,mkdtempSync,readFileSync,renameSync,rmSync,symlinkSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {dirname,join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {candidate,directory,repository,sha,blob,node24,save,verifyAssembly} from './common.mjs';
import {readProfile,validateProfile} from './profile.mjs';
import {admission,canonicalArguments,parse,order,requireOrdered,requireCanonicalArguments,requireRelease,verifyDriverSeal,runtimeFiles} from './admission.mjs';
import {createTreeGuard} from '../integrity-73/tree.mjs';
import {assessNative} from '../preflight-repair/preflight.mjs';
import {verifyFreshCommittedArchive} from '../combined-8670ebe8/committed-archive.mjs';
import {createHash} from 'node:crypto';

const temporary=mkdtempSync(join(tmpdir(),'unified76-controls-')),rows=[];
const sourceBindings=Object.fromEntries([...runtimeFiles,'controls.mjs'].map(path=>[path,sha(readFileSync(join(directory,path)))]));
const test=(name,run)=>{try{run();rows.push({name,status:'PASS'});}catch(error){rows.push({name,status:'FAIL',error:error.stack});}};
const profile=readProfile(),seal=verifyDriverSeal();
test('exact frozen four-path changes and raw commit accepted',()=>verifyAssembly());
for(const[name,mutate]of [
 ['missing fixture',value=>value.changes.pop()],['extra fixture',value=>value.changes.push({...value.changes[0],path:'src/index.ts'})],
 ['wrong count',value=>value.changes[0].replacements[0][1]='contains 77 including'],['deleted assertion',value=>value.changes[0].replacements[1][1]='void 0'],
 ['changed unrelated bytes',value=>value.changes[0].afterSha256='0'.repeat(64)],['self-derived count',value=>value.changes[0].replacements[1][1]='createAgentCommands().length, createAgentCommands().length'],
 ['raw commit mutation',value=>value.rawCommitBase64=Buffer.from('wrong').toString('base64')],['wrong parent',value=>value.base=value.fixtureSourceCommit],['missing fixture source',value=>value.fixtureSourceCommit='0'.repeat(40)],['wrong tree',value=>value.tree='0'.repeat(40)]
])test(name+' rejected',()=>{const value=structuredClone(candidate);mutate(value);assert.throws(()=>verifyAssembly(value));});
for(const[name,mutate]of [
 ['missing input',value=>value.scopeInputs.pop()],['extra input',value=>value.scopeInputs.push({path:'src/foreign.ts',mode:'100644',blob:'0'.repeat(40),bytes:1})],
 ['modified input',value=>value.scopeInputs[0].blob='0'.repeat(40)],['type changed',value=>value.scopeInputs[0].mode='120000'],
 ['stale cleanup revision',value=>value.cleanup.revision=candidate.base],['missing cleanup',value=>delete value.cleanup.files['src/index.ts']],
 ['package input changed',value=>value.packageManifestSha256='0'.repeat(64)],['unknown mts',value=>value.classifiedMts.push({path:'unknown.mts'})],
 ['canonical omitted',value=>value.canonicalFiles.pop()],['wrong concurrency',value=>value.testConcurrency=6],['non-TAP reporter',value=>value.reporter='spec'],
 ['native omitted',value=>value.native.pop()],['native rebound',value=>value.native[0].sha256='0'.repeat(64)],['cleanup source mismatch',value=>value.cleanup.files['src/index.ts']='0'.repeat(64)]
])test(name+' profile rejected',()=>{const value=structuredClone(profile);mutate(value);assert.throws(()=>validateProfile(value));});
test('pending release is not execution authorization',()=>assert.throws(()=>requireRelease(candidate,seal,profile)));
const release={action:'ROOT_RELEASE_UNIFIED76',candidate:candidate.candidate,driverSha256:sha(JSON.stringify(seal)),profileSha256:sha(JSON.stringify(profile)),packageSha256:candidate.expectedPackageSha256,public74:true,public75:true,public76:true,independentDriverAccepted:true,authorization:'control only, not actual root release',independentEvidence:'control only'};
test('well-formed release schema accepted only as an in-memory control',()=>requireRelease(release,seal,profile));
test('guard removal changes driver binding',()=>{const altered=structuredClone(seal);delete altered.files['admission.mjs'];assert.throws(()=>requireRelease(release,altered,profile));});
test('cleanup removal changes profile binding',()=>{const altered=structuredClone(profile);delete altered.cleanup;assert.throws(()=>requireRelease(release,seal,altered));});
test('missing approval rejected',()=>assert.throws(()=>requireRelease({...release,public76:false},seal,profile)));
test('exact inspect CLI accepted',()=>assert.equal(parse(['--candidate',candidate.candidate,'--inspect']).execute,false));
for(const args of [['--candidate','HEAD','--inspect'],['--candidate',candidate.candidate,'--inspect','--inspect'],['--candidate',candidate.candidate,'--execute','/tmp/x','--release','/tmp/y','--live']])test('unknown/wrong/duplicate CLI '+JSON.stringify(args),()=>assert.throws(()=>parse(args)));
test('canonical TAP and two-file concurrency precede all files',()=>requireCanonicalArguments(canonicalArguments(profile),profile));
test('reporter removal caught',()=>assert.throws(()=>requireCanonicalArguments(canonicalArguments(profile).filter(value=>value!=='--test-reporter=tap'),profile)));
test('phase sequence accepted',()=>{const completed=[];for(const phase of order){requireOrdered(completed,phase);completed.push(phase);}});
test('phase order mutation caught',()=>assert.throws(()=>requireOrdered(['safejs-availability'],'canonical')));
const archive=join(temporary,'archive');mkdirSync(archive);writeFileSync(join(archive,'source.txt'),'source');
const content=Buffer.from('source'),entry={path:'source.txt',mode:'100644',bytes:content.length,blob:createHash('sha1').update(`blob ${content.length}\0`).update(content).digest('hex')};
test('exact fresh archive passes',()=>assert.equal(verifyFreshCommittedArchive(archive,[entry]).count,1));
for(const name of ['file','directory','remove','modify','symlink','mode'])test('archive '+name+' mutation rejected',()=>{
 const target=join(archive,'source.txt');
 if(name==='file')writeFileSync(join(archive,'unexpected'),'x');
 if(name==='directory')mkdirSync(join(archive,'unexpected'));
 if(name==='remove')renameSync(target,join(temporary,'saved'));
 if(name==='modify')writeFileSync(target,'changed');
 if(name==='symlink'){rmSync(target);symlinkSync('../outside',target);}
 if(name==='mode')chmodSync(target,0o755);
 try{assert.throws(()=>verifyFreshCommittedArchive(archive,[entry]));}finally{if(name==='file'||name==='directory')rmSync(join(archive,'unexpected'),{recursive:true});else{rmSync(target,{force:true});writeFileSync(target,'source',{mode:0o644});}}
});
const guarded=join(temporary,'guarded');mkdirSync(guarded);writeFileSync(join(guarded,'input'),'same');mkdirSync(join(guarded,'authorized-build'));const tree=createTreeGuard(guarded);
test('post-setup inventory accepts authorized build',()=>assert.deepEqual(tree.check().changes,[]));
test('post-setup addition rejected',()=>{writeFileSync(join(guarded,'new-artifact'),'x');assert.equal(tree.check().changes[0].kind,'added');rmSync(join(guarded,'new-artifact'));});
const tool=join(temporary,'native');writeFileSync(tool,'native',{mode:0o755});const requirement={name:'control',origin:tool,sha256:sha('native'),executable:true};
test('authenticated native accepted',()=>assert.deepEqual(assessNative([requirement],repository).issues,[]));
test('changed native refused',()=>assert.equal(assessNative([{...requirement,sha256:'0'.repeat(64)}],repository).issues.length,1));
test('missing native refused',()=>assert.equal(assessNative([{...requirement,origin:tool+'missing'}],repository).issues.length,1));
const actual=await admission(profile,{...process.env,RG_NATIVE_BIN:'/private/var/folders/rw/s4cy76hn6v55qrp0dhcbtplc0000gn/T/safe-bash-rg-recovered-gsSpuz/rg',TREE_NATIVE_BIN:'/tmp/safe-bash-tree-external-oracle-TbVJVK/tree'});
test('actual pinned runtime and all49+2 assets present',()=>{assert.deepEqual(actual.issues,[]);assert.equal(actual.native.assets.length,51);});
test('Node22 launcher refused78 before suite',()=>{const result=spawnSync('/Users/kjopek/.nvm/versions/node/v22.22.2/bin/node',[join(directory,'run.mjs'),'--candidate',candidate.candidate,'--inspect'],{encoding:'utf8',timeout:60000,env:{...process.env,RG_NATIVE_BIN:actual.native.assets.find(asset=>asset.name==='rg').origin,TREE_NATIVE_BIN:'/tmp/safe-bash-tree-external-oracle-TbVJVK/tree'}});assert.equal(result.status,78);assert.match(result.stdout,/'?fullGateLaunched"?:false/u);});
test('Node24 permission executes positive and exact source-read denial',()=>{
 const allowed=join(temporary,'permission');mkdirSync(allowed);writeFileSync(join(allowed,'input'),'ok');const forbidden=join(temporary,'outside.txt');writeFileSync(forbidden,'outside');
 const flags=['--permission',`--allow-fs-read=${allowed}`,'--input-type=module','-e'];
 const positive=spawnSync(node24,[...flags,`import{readFileSync}from'node:fs';if(readFileSync(${JSON.stringify(join(allowed,'input'))},'utf8')!=='ok')throw Error('bad');`],{encoding:'utf8'});
 const denied=spawnSync(node24,[...flags,`import{readFileSync}from'node:fs';readFileSync(${JSON.stringify(forbidden)});`],{encoding:'utf8'});
 assert.equal(positive.status,0);assert.equal(denied.status,1);assert.match(denied.stderr,/ERR_ACCESS_DENIED/u);assert.ok(denied.stderr.includes(forbidden));
});
test('author control and driver sources unchanged during bounded run',()=>{for(const[path,expected]of Object.entries(sourceBindings))assert.equal(sha(readFileSync(join(directory,path))),expected,path);});
const result={createdAt:new Date().toISOString(),candidate:candidate.candidate,temporary,scope:'author bounded infrastructure controls; no full gate, no public integration acceptance',sourceBindings,rows,actualNative:actual,fullGateLaunched:false};
save(join(temporary,'REPORT.json'),result);console.log(JSON.stringify({temporary,pass:rows.filter(row=>row.status==='PASS').length,fail:rows.filter(row=>row.status==='FAIL'),fullGateLaunched:false}));if(rows.some(row=>row.status==='FAIL'))process.exitCode=1;
