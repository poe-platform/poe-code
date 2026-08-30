import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { cpSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { gzipSync, gunzipSync } from 'node:zlib';
import { isDeepStrictEqual } from 'node:util';

const scope=dirname(fileURLToPath(import.meta.url)),root=resolve(scope,'../../../..');
const candidate='96146732cc7e17a67797389de5b83d14b29b41bf';
const previousCandidate='e192662d2fda90104ab5a7e59c9b5c88bf5838c3';
const previousReview='05b3c3dc5667e82a278c3a79c62a807897aa2176';
const author='tests/shell-stress/diagnostic-profiles/pin-migration';
const controlPath=author+'/binding.test.ts',bindingPath=author+'/current-binding.ts';
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
const git=args=>execFileSync('/usr/bin/git',args,{cwd:root,maxBuffer:64*1024*1024,timeout:20000});
const show=(commit,path)=>git(['show',`${commit}:${path}`]);
const read=name=>JSON.parse(readFileSync(join(scope,name)));
function save(name,value){
  const destination=join(scope,name);assert.equal(existsSync(destination),false,'Append-only evidence');
  execFileSync('apply_patch',[],{cwd:root,input:`*** Begin Patch\n*** Add File: ${relative(root,destination)}\n${JSON.stringify(value,null,2).split('\n').map(line=>'+'+line).join('\n')}\n*** End Patch\n`,maxBuffer:64*1024*1024});
}
assert.equal(existsSync(join(scope,'v2-execution.json')),false);
const historyPaths=git(['ls-tree','-r','--name-only',previousReview,relative(root,scope)]).toString().trim().split('\n');
assert.equal(historyPaths.length,15);
function historyGuard(){return Object.fromEntries(historyPaths.map(path=>{const bytes=readFileSync(join(root,path));assert.deepEqual(bytes,show(previousReview,path),path);return[path,hash(bytes)];}));}
const historyBefore=historyGuard(),previous=read('execution.json'),remaining=read('remaining-execution.json');
const inputProof=Object.fromEntries(Object.entries(previous.inputProof).map(([path,old])=>{const bytes=show(candidate,path);return[path,{previousBlob:old.blob,previousSha256:old.sha256,blob:git(['rev-parse',`${candidate}:${path}`]).toString().trim(),sha256:hash(bytes),unchanged:hash(bytes)===old.sha256}];}));
const changed=Object.entries(inputProof).filter(([,proof])=>!proof.unchanged).map(([path])=>path);
assert.deepEqual(changed,[controlPath]);assert.equal(Object.keys(inputProof).length,237);
const sourceConfigDiff=git(['diff',previousCandidate,candidate,'--','src','package.json','package-lock.json','tsconfig.json','tsconfig.build.json']).toString();assert.equal(sourceConfigDiff,'');
const sourcePaths=git(['ls-tree','-r','--name-only',candidate,'src']).toString().trim().split('\n');
assert.deepEqual(sourcePaths,Object.keys(inputProof).filter(path=>path.startsWith('src/')).sort());
const oldControl=show(previousCandidate,controlPath).toString(),newControl=show(candidate,controlPath).toString();
const matcher=`function hashFailure(path: string, expected: string, bytes: Uint8Array): (error: unknown) => boolean {
  return error => {
    assert.ok(error instanceof assert.AssertionError);
    assert.equal(error.message.split("\\n")[0], \`Current fixture/helper binding changed: \${path}\`);
    assert.equal(error.code, "ERR_ASSERTION");
    assert.equal(error.operator, "strictEqual");
    assert.equal(error.expected, expected);
    assert.equal(error.actual, createHash("sha256").update(bytes).digest("hex"));
    return true;
  };
}

`;
const expectedControl=oldControl.replace('function withCopiedInputs',matcher+'function withCopiedInputs')
  .replace('}, { message: `Current fixture/helper binding changed: ${driver.path}` });','}, hashFailure(driver.path, driver.currentSha256, readFileSync(destination)));')
  .replace('{ message: "Current fixture/helper binding changed: tests/shell-stress/cases.ts" }','hashFailure("tests/shell-stress/cases.ts", sources["tests/shell-stress/cases.ts"]!, readFileSync(destination))');
assert.equal(newControl,expectedControl,'Unexpected control-body/fixture/expectation delta');
const oldRunner=show(previousCandidate,author+'/run.mjs').toString(),newRunner=show(candidate,author+'/run.mjs').toString();
assert.equal(newRunner,oldRunner.replace("const output = join(scope, 'execution');","const outputName = process.argv[3] ?? 'execution';\nassert.match(outputName, /^execution(?:-[a-z0-9-]+)?$/u, 'Use a fresh execution evidence leaf');\nconst output = join(scope, outputName);"));
const carriedRuns=[];
for(const capture of [previous,remaining])for(const run of capture.runs.filter(run=>run.label!=='six-binding-controls')){
  const bytes=gunzipSync(Buffer.from(run.trace.gzipBase64,'base64'));assert.equal(hash(bytes),run.trace.sha256);
  const loads=bytes.toString().trim().split('\n').map(line=>JSON.parse(line)).filter(event=>event.kind==='load');
  assert.equal(loads.some(load=>load.path.endsWith('/'+controlPath)),false);
  for(const load of loads){assert.ok(load.valid);const path=relative(capture.project,load.path);if(inputProof[path])assert.equal(inputProof[path].sha256,load.after,path);}
  carriedRuns.push({label:run.label,counts:run.counts,status:run.child.status,hookFailures:run.hookFailures,nativeSpawns:run.nativeSpawns,virtualSpawns:run.virtualSpawns,publicIndexLoads:run.publicIndexLoads,traceSha256:run.trace.sha256,changedControlLoaded:false});
}
function tree(directory){const result={};for(const entry of readdirSync(directory,{withFileTypes:true})){const path=join(directory,entry.name);if(entry.isDirectory())Object.assign(result,tree(path));else{assert.ok(entry.isFile()&&!lstatSync(path).isSymbolicLink());result[path]=hash(readFileSync(path));}}return result;}
function toolsGuard(){return Object.fromEntries(Object.entries(previous.tools).map(([name,tool])=>{const actual=tree(tool.source);assert.deepEqual(actual,tool.before,name);return[name,actual];}));}
const toolsBefore=toolsGuard();assert.equal(hash(readFileSync(process.execPath)),previous.node.sha256);assert.equal(process.version,previous.node.version);
function nativeGuard(){return previous.nativeBefore.map(profile=>{assert.equal(hash(readFileSync(profile.executable)),profile.sha256);return{...profile,realpath:realpathSync(profile.executable)};});}
const nativeBefore=nativeGuard();
const helper='tests/shell-stress/current-shell/support.mjs',helperCommit='303d18449c6e01bae4f33dada2f2022f95a56d49';
assert.deepEqual(readFileSync(join(root,helper)),show(helperCommit,helper));
const {runChild}=await import('../../current-shell/support.mjs');
const scratch=realpathSync(mkdtempSync(join(tmpdir(),'safe-bash-diagnostic-pin-v2-'))),project=join(scratch,'project'),temporary=join(scratch,'tmp');mkdirSync(project);mkdirSync(temporary);
for(const[path,proof]of Object.entries(inputProof)){const bytes=show(candidate,path);assert.equal(hash(bytes),proof.sha256);mkdirSync(dirname(join(project,path)),{recursive:true});writeFileSync(join(project,path),bytes);}
for(const[name,tool]of Object.entries(previous.tools)){const target=join(project,'node_modules',name);cpSync(tool.source,target,{recursive:true,force:false,errorOnExist:true});for(const[path,expected]of Object.entries(tool.before))assert.equal(hash(readFileSync(join(target,relative(tool.source,path)))),expected);}
const tracer=join(project,'pin-review-trace.mjs');writeFileSync(tracer,show(previousReview,relative(root,scope)+'/trace.mjs'));
const initial=tree(project);for(const[path,proof]of Object.entries(inputProof))assert.equal(initial[join(project,path)],proof.sha256);
const live=()=>({head:git(['rev-parse','HEAD']).toString().trim(),status:git(['status','--short']).toString(),index:git(['diff','--cached','--raw','-z']).toString('base64')});
const liveBefore=live(),startedAt=new Date().toISOString(),runs=[];
async function run(label){
  const before=tree(project),policy=join(scratch,label+'-policy.json'),trace=join(scratch,label+'-trace.jsonl');
  writeFileSync(policy,JSON.stringify({files:before,esbuild:join(project,'node_modules',`@esbuild/${process.platform}-${process.arch}`,'bin/esbuild')}));
  const env={PATH:'/usr/bin:/bin',HOME:temporary,TMPDIR:temporary,LANG:'C',LC_ALL:'C',TZ:'UTC',TSX_DISABLE_CACHE:'1',CURRENT_SHELL_IMPORT_TRACE:'',PIN_REVIEW_POLICY:policy,PIN_REVIEW_TRACE:trace,NODE_OPTIONS:`--import=${pathToFileURL(tracer).href}`,GIT_DIR:git(['rev-parse','--absolute-git-dir']).toString().trim(),GIT_WORK_TREE:project};
  const args=['--import','tsx','--test','--test-reporter=tap',controlPath];
  const child=await runChild(process.execPath,args,{cwd:project,env,deadline:30000});
  const after=tree(project),raw=existsSync(trace)?readFileSync(trace):Buffer.alloc(0),events=raw.toString().trim().split('\n').filter(Boolean).map(line=>JSON.parse(line)),loads=events.filter(event=>event.kind==='load');
  const invalid=loads.filter(load=>!load.valid||load.before!==before[load.path]||load.after!==after[load.path]);
  const text=Buffer.from(child.stdout,'base64').toString(),counts=Object.fromEntries(['tests','pass','fail','cancelled','skipped','todo'].map(key=>[key,Number(text.match(new RegExp(`^# ${key} (\\d+)$`,'mu'))?.[1]??-1)]));
  const launches=events.filter(event=>event.kind==='spawn'),caseLaunches=launches.filter(event=>nativeBefore.some(profile=>profile.executable===event.command)||event.args?.some(arg=>arg.endsWith('/virtual-child.ts')));
  const result={label,args,env,child,counts,before,after,trace:{sha256:hash(raw),bytes:raw.length,gzipBase64:gzipSync(raw).toString('base64')},loads:loads.length,invalid,caseLaunches,guard:isDeepStrictEqual(before,after)&&loads.length>0&&invalid.length===0&&!child.timedOut&&!child.overflow&&!child.groupAlive};
  runs.push(result);assert.ok(result.guard);assert.equal(caseLaunches.length,0);
  console.log(JSON.stringify({label,counts,status:child.status,guard:result.guard}));return result;
}
let failure=null,mutation=null;
try{
  const actual=await run('final-six-controls');assert.equal(actual.child.status,0);assert.deepEqual(actual.counts,{tests:6,pass:6,fail:0,cancelled:0,skipped:0,todo:0});
  const path=join(project,bindingPath),original=readFileSync(path),source=original.toString();
  const line=source.split('\n').find(line=>line.includes('assert.equal(actual, expected,'));assert.ok(line);
  const changedSource=source.replace(line,`    try {\n${line}\n    } catch (error) {\n      if (error instanceof assert.AssertionError) error.code = "PIN_REVIEW_WRONG_CODE";\n      throw error;\n    }`);
  mutation={path:bindingPath,beforeSha256:hash(original),mutatedSha256:hash(changedSource),before:line,after:changedSource.slice(changedSource.indexOf('    try {')),purpose:'Keep exact path/message/hash rejection, corrupt only AssertionError.code; final matcher must reject nonmatching error instead of accepting any throw.'};
  try{writeFileSync(path,changedSource);const negative=await run('wrong-error-code-negative');assert.equal(negative.child.status,1);assert.deepEqual(negative.counts,{tests:6,pass:3,fail:3,cancelled:0,skipped:0,todo:0});assert.ok(Buffer.from(negative.child.stdout,'base64').toString().includes('PIN_REVIEW_WRONG_CODE'));}
  finally{writeFileSync(path,original);}
}catch(error){failure={name:error.name,message:error.message,stack:error.stack};}
const endpoint=tree(project),historyAfter=historyGuard(),toolsAfter=toolsGuard(),nativeAfter=nativeGuard();
const evidence={candidate,previousCandidate,previousReview,authorThread:'01a04314-dda5-7233-a841-0bc7a1533906',authorEvidenceNotUsed:'e0aa2d2314de815dcf2773889c5a46ae2d04ed8e',startedAt,finishedAt:new Date().toISOString(),scratch,project,sourceConfigDiff,delta:git(['diff',previousCandidate,candidate,'--',controlPath,author+'/run.mjs']).toString(),inputProof,changedInputPaths:changed,exactControlTransform:true,exactRunnerTransform:true,historyBefore,historyAfter,toolsBefore,toolsAfter,nativeBefore,nativeAfter,node:{path:process.execPath,version:process.version,sha256:hash(readFileSync(process.execPath))},initial,endpoint,endpointStable:isDeepStrictEqual(initial,endpoint),carriedRuns,carriedRawHashes:Object.fromEntries(['execution.json','remaining-execution.json','observations.json'].map(name=>[name,hash(readFileSync(join(scope,name)))])),freshNativeExecutions:0,freshProductExecutions:0,runs,mutation,liveBefore,liveAfter:live(),driverSha256:hash(readFileSync(fileURLToPath(import.meta.url))),failure};
save('v2-execution.json',evidence);
rmSync(scratch,{recursive:true,force:true});
save('v2-cleanup.json',{scratch,removed:!existsSync(scratch),ownedRunnerGroupsAbsent:runs.every(run=>!run.child.groupAlive),noNativeOrProductCaseLaunches:runs.every(run=>run.caseLaunches.length===0),rawSha256:hash(readFileSync(join(scope,'v2-execution.json')))});
if(failure)throw new Error(failure.message);
