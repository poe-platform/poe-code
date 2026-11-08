import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as url from 'node:url';
import {createHash} from 'node:crypto';
import {stripTypeScriptTypes} from 'node:module';
import {SourceTextModule, SyntheticModule, createContext, runInContext} from 'node:vm';

const root = '/Users/kjopek/Workspace/safe-bash';
const base = 'tests/integration/full-gate-20260827/unified76-driver/';
const owned = 'tests/integration/full-gate-20260827/unified76-driver-independent/r3-repair-v20/';
const node = '/Users/kjopek/.nvm/versions/node/v24.11.1/bin/node';
const git = '/Applications/Xcode.app/Contents/Developer/usr/bin/git';
const gitCore = '/Applications/Xcode.app/Contents/Developer/usr/libexec/git-core';
const npm = '/Users/kjopek/.nvm/versions/node/v22.22.2/lib/node_modules/npm/bin/npm-cli.js';
const gitHash = '10f9c1df894525ae4c7454258febab6d3d25071062b42cb48dbb1842cdffd2a9';
const npmHash = '8e5f6f3429f8cdbe693cdc29904e9d5a7b127a494bd15c804bd54c7403bfcbe7';
const digest = bytes => createHash('sha256').update(bytes).digest('hex');
const blob = bytes => createHash('sha1').update(`blob ${bytes.length}\0`).update(bytes).digest('hex');
const started = Date.now();
const results = [], calls = [], modules = [], reads = new Map();
let totalBytes = 0, readCount = 0, operations = 0, evaluations = 0;
assert.equal(process.cwd(), root);
assert.equal(process.execPath, node);
fs.writeFileSync(path.join(root, owned, 'RUN-CLAIM.json'), JSON.stringify({startedAt:new Date(started).toISOString(), pid:process.pid, command:process.argv, node:process.version})+'\n', {flag:'wx'});
const watchdog = setTimeout(() => {
  fs.writeFileSync(path.join(root,owned,'RESULTS.json'),JSON.stringify({status:'HARNESS_TIMEOUT',results,calls,elapsedMs:Date.now()-started,actualChildren:0})+'\n',{flag:'wx'});
  process.stderr.write('independent cohort exceeded 15s\n');
  process.exit(124);
}, 15000);
function bounded() {
  assert(Date.now() - started < 15000, 'elapsed budget');
  assert(operations <= 50000 && calls.length <= 160 && evaluations <= 160 && results.length <= 140, 'operation budget');
}
function read(relative) {
  assert(allowedReads.has(relative), `undeclared read ${relative}`);
  assert(++readCount <= 240 && reads.size <= 120);
  const filename = path.join(root, relative), stat = fs.lstatSync(filename);
  assert(stat.isFile() && !stat.isSymbolicLink() && stat.size <= 4*1024*1024);
  assert.equal(fs.realpathSync(filename), filename);
  const bytes = fs.readFileSync(filename);
  totalBytes += bytes.length;
  assert(totalBytes <= 16*1024*1024);
  const record = {path:relative, bytes:bytes.length, mode:stat.mode & 0o777, sha256:digest(bytes), blob:blob(bytes)};
  if(reads.has(relative)) assert.equal(record.sha256, reads.get(relative).sha256, 'changed during review');
  reads.set(relative, record);
  return bytes;
}
const sourcePaths = [
  'tests/commands/table-text-stress/support.ts',
  'tests/commands/table-text-stress/shared-stdin-fix/support.ts',
  'tests/fs/mount/identity-authority-review/implementation/public-comparison.test.ts',
  base+'launcher-v3/execute.mjs',
  'tests/commands/diff-patch-stress/editflows/helpers.ts',
  'tests/integration/s3-http-exports/verify.mjs',
  'tests/plugins/qualified-current-release-native-data/helpers.ts',
  'tests/commands/search-stress/safety.test.ts',
  'tests/commands/search-stress/streaming.test.ts',
  'tests/commands/diff-patch-stress/gnu-target/oracle.ts',
  'tests/commands/diff-patch-stress/gnu-auxiliary/helpers.ts',
  'tests/commands/diff-patch-stress/gnu-target-followup/helpers.ts',
  'tests/commands/stream-inspection/oracle.ts',
  'tests/shell-stress/helpers.ts',
  base+'launcher-v3/DRIVER.json',
];
const extra = {
  [base+'r3-repair-v1/SOURCE-CANDIDATE.json']:'52ce672369a0b37f515fc37b7c6bd5b6a2933bc4',
  [base+'r3-repair-v1/EVIDENCE-SEAL.json']:'407f8ef6f96c16b62d15a441fef058eb4d4d350b',
  [base+'r3-tool-closure-v1/SEAL.json']:'458f43129ef2bed20ff396720e805e9c823f6775',
  ['tests/commands/table-text-stress/frozen-corpus.json']:'a75ee5c4a12f9c83ffb92841365191a9de34f5b5',
  ['tests/commands/search-stress/harness.ts']:'f3d35ec00766263a804fc4b52abfb4ce8c0c45e7',
  ['tests/commands/search-stress/pipelines.test.ts']:'6b949c63f57f0f8596447d099fd5a96a5cd7d9e3',
  [base+'launcher-v3/build-audit.mjs']:'1f7389579d9cb04812b81a05b238387c7736ed66',
  [base+'launcher-v3/build-types.mjs']:'f9cf36f20696032c607910df66922a0674ec300d',
};
const allowedReads = new Set([...sourcePaths, ...Object.keys(extra), base+'launcher-v3/TOOL-ROUTES.json', owned+'review.mjs', owned+'CRITERIA.md']);
const sources = new Map();
function finite(value, depth = 0) {
  assert(depth <= 12);
  if(value === null || value === undefined || typeof value === 'string' || typeof value === 'boolean') return value;
  if(typeof value === 'number') { assert(Number.isFinite(value)); return value; }
  assert.equal(typeof value, 'object', 'data-only value');
  const keys = Reflect.ownKeys(value);
  assert(keys.length <= 1024 && keys.every(key => typeof key === 'string'));
  if(Array.isArray(value)) {
    const length = Object.getOwnPropertyDescriptor(value, 'length');
    assert(length && 'value' in length && Number.isSafeInteger(length.value) && length.value <= 1024);
    assert.equal(keys.length, length.value + 1, 'array extras or holes');
    const result = [];
    for(let index = 0; index < length.value; index++) {
      const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
      assert(descriptor && 'value' in descriptor, 'array own data');
      result.push(finite(descriptor.value, depth+1));
    }
    return result;
  }
  const result = {};
  for(const key of keys.sort()) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    assert(descriptor && 'value' in descriptor, 'object own data');
    Object.defineProperty(result, key, {value:finite(descriptor.value, depth+1), enumerable:true});
  }
  return result;
}
function same(actual, expected) { assert.deepEqual(finite(actual), finite(expected)); }
const comparisonAssert = Object.assign((...args) => assert(...args), assert, {deepEqual:same, deepStrictEqual:same});
function failure(error) { return {name:error?.name ?? typeof error, message:error?.message ?? String(error)}; }
async function check(id, role, operation) {
  bounded();
  try { const observed = await operation(); results.push({id, role, status:'PASS', observed:observed ?? null}); }
  catch(error) { results.push({id, role, status:error?.harness ? 'HARNESS_ERROR' : 'FAIL', error:failure(error), observed:error?.observed ?? null}); }
}
function forbidden(label) { return () => { throw Object.assign(new Error('undeclared synthetic effect: '+label), {harness:true}); }; }
async function caught(operation) { try { await operation(); return undefined; } catch(error) { return error; } }
function identity(actual, expected, observed) {
  if(actual !== expected) throw Object.assign(new Error('primary thrown identity not preserved'), {observed:{...observed, actual:failure(actual), expected:failure(expected)}});
}
function memory(options = {}) {
  const entries = new Map([['/gate', null], ['/gate/tmp', null], ['/gate/tmp/ordinary-foreign', Buffer.from('CANARY')]]);
  const events = [], created = [];
  let serial = 0;
  function event(operation, filename) { operations++; bounded(); events.push({operation,path:filename}); }
  function contents(filename, encoding) {
    event('read', filename);
    if(options.readError) throw options.readError;
    const bytes = entries.get(filename);
    assert(Buffer.isBuffer(bytes), `missing fake file ${filename}`);
    return encoding ? bytes.toString(encoding) : Buffer.from(bytes);
  }
  function remove(filename, settings) {
    event('rm', filename);
    assert(created.includes(filename), 'removal must target exact acquired root');
    assert.equal(settings.recursive, true);
    if(options.rmError) throw options.rmError;
    for(const key of entries.keys()) if(key === filename || key.startsWith(filename+'/')) entries.delete(key);
  }
  function mkdir(filename) { event('mkdir', filename); entries.set(filename, null); }
  function mkdtemp(prefix) {
    event('mkdtemp', prefix);
    if(options.acquireError && created.length === 1) throw options.acquireError;
    const filename = prefix+'S'+(++serial);
    assert(!entries.has(filename)); entries.set(filename, null); created.push(filename);
    if(options.foreignParent && created.length === 1) entries.set(filename+'/ordinary-foreign', Buffer.from('FOREIGN'));
    return filename;
  }
  function write(filename, bytes) {
    event('write', filename);
    if(options.writeError) throw options.writeError;
    entries.set(filename, Buffer.from(bytes));
    assert(entries.size <= 1024 && [...entries.values()].reduce((sum, item) => sum+(item?.length ?? 0),0) <= 8*1024*1024);
  }
  function readdir(filename, settings) {
    event('readdir', filename);
    const names = [...entries.keys()].filter(key => key.startsWith(filename+'/') && !key.slice(filename.length+1).includes('/')).map(key => key.slice(filename.length+1));
    return settings?.withFileTypes ? names.map(name => ({name,isDirectory:()=>entries.get(filename+'/'+name)===null,isFile:()=>Buffer.isBuffer(entries.get(filename+'/'+name))})) : names;
  }
  function rmdir(filename) {
    event('rmdir', filename);
    assert(created.includes(filename));
    if([...entries.keys()].some(key => key.startsWith(filename+'/'))) throw Object.assign(new Error('nonempty owned parent'), {code:'ENOTEMPTY'});
    entries.delete(filename);
  }
  const sync = {existsSync:filename=>entries.has(filename), mkdtempSync:mkdtemp, mkdirSync:mkdir, readFileSync:contents, readdirSync:readdir, writeFileSync:write, rmSync:remove, realpathSync:filename=>filename,
    lstatSync:forbidden('lstat'), statSync:forbidden('stat'), accessSync:forbidden('access'), constants:{X_OK:1}, copyFileSync:forbidden('copy'), cpSync:forbidden('cp'), symlinkSync:forbidden('symlink'), renameSync:forbidden('rename')};
  const async = {mkdtemp:async prefix=>mkdtemp(prefix),mkdir:async filename=>mkdir(filename),readFile:async(...args)=>contents(...args),readdir:async(...args)=>readdir(...args),writeFile:async(...args)=>write(...args),rmdir:async filename=>rmdir(filename),rm:async(...args)=>{if(options.rmWait) await options.rmWait; return remove(...args);}};
  return {entries,events,created,sync,async,canary:()=>assert.equal(entries.get('/gate/tmp/ordinary-foreign')?.toString(),'CANARY')};
}
const exportsByModule = {
  'node:fs':['existsSync','mkdtempSync','mkdirSync','readFileSync','readdirSync','writeFileSync','rmSync','realpathSync','lstatSync','statSync','accessSync','constants','copyFileSync','cpSync','symlinkSync','renameSync'],
  'node:fs/promises':['mkdtemp','mkdir','readFile','readdir','rm','rmdir','writeFile'],
  'node:child_process':['spawnSync','spawn','execFileSync'],
  '../../../src/shell/index.js':['Shell'], '../../../src/commands/index.js':['standardCommands'],
  '../../../src/fs/memory/index.js':['createMemoryFileSystem'], '../../../src/commands/table-text/index.js':['tableTextCommands'],
  '../../table-text/helpers.js':['runTable'], '../support.js':['product'],
  '../../../../src/contracts/index.js':['toByteSource'], '../../../../src/commands/diff-patch/index.js':['createDiffPatchCommands'], '../../../../src/fs/memory/index.js':['MemoryFileSystem'], '../gnu-target/oracle.js':['oraclePath'],
  './cases.js':['nativeCases','appleDifferenceCases'], './process.js':['isolatedSpawn'],
  './harness.js':['bounded','directory','native','text','virtual'],
  './common.mjs':['candidate','directory','repository','copyDependencies','blob','sha','save','node24','npm','git','copySelection'],
  './profile.mjs':['readProfile'], './admission.mjs':['admission','requireRelease','verifyDriverSeal','requireOrdered','canonicalArguments','requireCanonicalArguments'],
  './inventory.mjs':['capture','createTreeGuard','requireBuildDelta','verifyArchive'], './policy.mjs':['BOUNDS','gateVerdict','enforceCharge'],
  './transport.mjs':['extractCommitted','transferHistory','cleanGitEnvironment'], './external-admission.mjs':['verifyExternal','externalReceipt'],
  './tool-routing.mjs':['createToolPath','verifyToolPath','createInheritedHelperRoute'], './external.mjs':['fileIdentity'],
  './built-consumers.mjs':['renderBuiltConsumerRunner','renderConsumerEntry'], './tap.mjs':['accountFile'], './supervise.mjs':['supervise'],
  './consumer-admission.mjs':['verifyConsumerSelection'], './build-types.mjs':['createBuildAudit','runBuildTypes','readBuildAudit'], './phase-runner.mjs':['createPhaseRunner'],
  './projection.mjs':['assertNoInstructionCopyTree'], './maintained-prerequisites.mjs':['createPrerequisiteReceipt','prerequisites'], 'node:stream/promises':['pipeline'],
};
async function load(relative, options = {}) {
  assert([sourcePaths[0],sourcePaths[1],sourcePaths[3],sourcePaths[4],sourcePaths[6],sourcePaths[7],sourcePaths[8],sourcePaths[9],sourcePaths[12],sourcePaths[13],base+'launcher-v3/build-audit.mjs'].includes(relative));
  assert(++evaluations <= 160);
  const registered = [], fake = options.memory ?? memory();
  const environment = options.environment ?? {PATH:'/gate/native:/gate/tools',TMPDIR:'/gate/tmp',FULL_GATE_ROOT:'/gate',NODE_TEST_CONTEXT:'child',KEEP:'yes'};
  const processStub = {env:{...environment},execPath:node,version:'v24.11.1',platform:'darwin',arch:'arm64',argv:options.argv ?? [node,'/synthetic/entry'],cwd:()=>options.cwd ?? root,pid:101,ppid:100};
  const context = createContext({Buffer,URL,TextEncoder,TextDecoder,process:processStub,console:{log:forbidden('console'),error:forbidden('console')},performance});
  const dispatch = (...args) => {
    assert(options.dispatch, 'no synthetic dispatch admitted here');
    const [executable, argv, settings] = args;
    const record = {module:relative,executable,argv:finite(argv),cwd:settings.cwd ?? null,env:finite(settings.env ?? {}),inputHex:Buffer.from(settings.input ?? '').toString('hex'),timeout:settings.timeout,maxBuffer:settings.maxBuffer ?? null,argv0:settings.argv0 ?? null};
    calls.push(record); bounded();
    return options.dispatch(...args);
  };
  const text = sources.get(relative);
  assert.equal(typeof text, 'string');
  const transformed = relative.endsWith('.ts') ? stripTypeScriptTypes(text,{mode:'strip'}) : text;
  const subject = new SourceTextModule(transformed,{context,identifier:url.pathToFileURL(path.join(root,relative)).href,initializeImportMeta:meta=>{meta.url=url.pathToFileURL(path.join(root,relative)).href;},importModuleDynamically:forbidden('dynamic import')});
  const imports = [];
  await subject.link(specifier => {
    imports.push(specifier);
    let values;
    if(specifier === 'node:assert/strict') values = {default:comparisonAssert};
    else if(specifier === 'node:path') values = {...path};
    else if(specifier === 'node:url') values = {...url};
    else if(specifier === 'node:os') values = {tmpdir:()=>options.tmpdir ?? '/gate/tmp'};
    else if(specifier === 'node:crypto') values = {createHash:options.createHash ?? createHash,randomUUID:()=> 'synthetic-uuid'};
    else if(specifier === 'node:test') values = {default:(name,callback)=>registered.push({name,callback})};
    else {
      const names = exportsByModule[specifier]; assert(names, `undeclared import ${specifier}`);
      values = Object.fromEntries(names.map(name=>[name,forbidden(specifier+':'+name)]));
      if(specifier === 'node:fs') Object.assign(values,fake.sync);
      if(specifier === 'node:fs/promises') Object.assign(values,fake.async);
      if(specifier === 'node:child_process') values.spawnSync = dispatch;
      if(specifier === './process.js') values.isolatedSpawn = dispatch;
      if(specifier === './cases.js') Object.assign(values,{nativeCases:[],appleDifferenceCases:[]});
      if(specifier === './common.mjs') Object.assign(values,{sha:digest});
    }
    Object.assign(values, options.imports?.[specifier] ?? {});
    return new SyntheticModule(Object.keys(values),function(){for(const [name,value] of Object.entries(values))this.setExport(name,value);},{context,identifier:'synthetic:'+specifier});
  });
  await subject.evaluate({timeout:1000});
  modules.push({path:relative,sha256:digest(text),transformedSha256:digest(transformed),imports,role:'WHOLE_MODULE_STUB'});
  return {namespace:subject.namespace,registered,fake,processStub,context};
}
const childResult = (status = 0) => ({status,signal:null,error:undefined,stdout:Buffer.from('stub-out'),stderr:Buffer.from('stub-err')});

try {
  await check('D01-committed-seals-and-selected-source', 'DATA', () => {
    for(const [relative, expected] of Object.entries(extra)) {const bytes=read(relative);assert.equal(blob(bytes),expected);sources.set(relative,bytes.toString());}
    for(const [directory,expectedCount] of [['r3-repair-v1',7],['r3-tool-closure-v1',8]]) {
      const seal=JSON.parse(sources.get(base+directory+'/'+(directory==='r3-repair-v1'?'EVIDENCE-SEAL.json':'SEAL.json')));
      assert.equal(seal.files.length,expectedCount); assert.equal(new Set(seal.files.map(entry=>entry.path)).size,expectedCount);
      for(const entry of seal.files) {assert.equal(path.posix.dirname(entry.path),base+directory);allowedReads.add(entry.path);const bytes=read(entry.path);assert.equal(bytes.length,entry.bytes);assert.equal(digest(bytes),entry.sha256);sources.set(entry.path,bytes.toString());}
    }
    const selected=JSON.parse(sources.get(base+'r3-repair-v1/SOURCE-CANDIDATE.json'));
    same(selected.selectedFiles.map(entry=>entry.path),sourcePaths);
    for(const entry of selected.selectedFiles) {const bytes=read(entry.path);assert.equal(digest(bytes),entry.sha256);assert.equal(blob(bytes),entry.blob);assert.equal(bytes.length,entry.bytes);assert.equal(reads.get(entry.path).mode,entry.mode);sources.set(entry.path,bytes.toString());}
    return {selected:15,authorSealMembers:7,toolSealMembers:8,protectedOriginalRoots:'committed tree bindings only; no root-content rehash'};
  });
  assert(results[0].status === 'PASS','binding failure forbids VM cohort');
  await check('D02-five-tools-calls-aliases-OS-pairs','DATA',()=>{
    const profile=JSON.parse(sources.get(base+'r3-tool-closure-v1/SUCCESSOR-PROFILE.json'));
    const inspection=JSON.parse(sources.get(base+'r3-tool-closure-v1/INSPECTION.json'));
    const recipe=JSON.parse(sources.get(base+'r3-tool-closure-v1/CALLS.json'));
    const expected=[['cut','/usr/bin/cut'],['sort','/usr/bin/sort'],['tee','/usr/bin/tee'],['xargs','/usr/bin/xargs'],['cat','/bin/cat']];
    same(profile.tools.map(tool=>[tool.name,tool.origin]),expected);
    same(profile.pendingOSMetadataPairs.map(pair=>[pair.tool,pair.library,pair.observedError,pair.fileSha256]),expected.map(([,target])=>[target,'/usr/lib/libSystem.B.dylib','ENOENT',null]));
    const routeBytes=read(base+'launcher-v3/TOOL-ROUTES.json'); assert.equal(digest(routeBytes),profile.previousRoutes.rawSha256);
    const routes=JSON.parse(routeBytes); assert.equal(Object.keys(routes.aliases).length,18);
    same(profile.prospectiveAliases,{...routes.aliases,...Object.fromEntries(expected)});
    same(profile.explicitRouteDiff,expected.map(([name,target])=>({op:'add',path:'/aliases/'+name,value:target})));
    assert.equal(profile.aliasCount,23);assert.equal(profile.readableDependency.origin,'/usr/lib/dyld');assert.equal(inspection.library.sha256,null);
    for(const tool of inspection.inspected) {const proposed=profile.tools.find(entry=>entry.name===tool.name);same([proposed.origin,proposed.physical,proposed.sha256,proposed.bytes,proposed.mode],[tool.origin,tool.physical,tool.sha256,tool.bytes,tool.mode]);assert(tool.links.every(entry=>entry.kind!=='symlink'));for(const slice of tool.slices)same(slice.references.map(entry=>[entry.kind,entry.path]),[[14,'/usr/lib/dyld'],[12,'/usr/lib/libSystem.B.dylib']]);}
    same(recipe.calls.map(entry=>entry.scriptIndex),[0,1,2,3,5]);
    same(recipe.calls.map(entry=>entry.id),['tap-line-54560','tap-line-54588','tap-line-54616','tap-line-54644','tap-line-54680']);
    const pipeline=sources.get('tests/commands/search-stress/pipelines.test.ts');
    for(const call of recipe.calls) assert(pipeline.includes(JSON.stringify(call.script)));
    for(const [filename,contents] of Object.entries(recipe.files)) {assert(pipeline.includes(JSON.stringify(filename)));assert(pipeline.includes(JSON.stringify(contents)));}
    same(recipe.calls[1].qualifiedExpectedOperands,['src/a.ts','src/space name.ts']);
    assert.equal(profile.futureControls.executed,0);assert.equal(profile.futureControls.actualScriptsExecuted,0);
    return {pairs:5,qualification:'ROOT-ratified OS-METADATA ONLY',missingImageHash:null,actualImageReads:0,future20Actual:'UNRUN',actualScripts:0};
  });
  await check('S01-source-overlay-route-and-cleanup-boundaries','SOURCE',()=>{
    const execute=sources.get(sourcePaths[3]),s3=sources.get(sourcePaths[5]),shell=sources.get(sourcePaths[13]);
    assert(execute.includes("await phase('benchmark-types',benchmark.args,benchmark.cwd)"));
    assert(execute.includes("assert.equal(readBuildAudit(audit).length,1"));
    assert(sources.get(base+'launcher-v3/build-types.mjs').includes("assert.equal(events.length,1"));
    assert(s3.includes('PATH: process.env.PATH ?? ""'));assert(s3.includes('executionArgs = [cli, ...args]'));assert(s3.includes('GIT_EXEC_PATH: "'+gitCore+'"'));
    assert(shell.includes('files: hostSnapshot(directory)'));assert(!shell.includes('sh-thd'));
    for(const index of [10,11]) {const source=sources.get(sourcePaths[index]);assert(source.includes('withNativeScratch(temporary => spawnSync('));assert(source.includes('TMPDIR: temporary'));}
    const mount=sources.get(sourcePaths[2]);assert(mount.indexOf('context.after(async () =>')<mount.indexOf('directory = await mkdtemp'));assert(mount.includes('finally { await rmdir(scratch); }'));
    return {fixtureOverlay:13,shippingDriverFiles:2,S3:'SOURCE ONLY; top-level acquisition not run',mount:'SOURCE ONLY; no product callback run',auxiliaryAndFollowup:'SOURCE callsite preservation only',historical632:'immutable, not executed'};
  });
  const realm=createContext({});
  const expectedRole={role:'xargs-child',path:'/bin/cat',args:['src/a.ts','src/space name.ts']};
  const valid=runInContext('({role:"xargs-child",path:"/bin/cat",args:["src/a.ts","src/space name.ts"]})',realm);
  await check('V01-cross-realm-exact-data','SYNTHETIC',()=>same(valid,expectedRole));
  let accessorReads=0;
  const badRoles=[{...expectedRole,role:'shell'},{...expectedRole,path:'/usr/bin/cat'},{...expectedRole,args:[...expectedRole.args].reverse()},{...expectedRole,args:['src/a.ts src/space name.ts']},{...expectedRole,extra:1},{...expectedRole,args:Array(2)},Object.defineProperty({...expectedRole},'role',{get(){accessorReads++;throw new Error('accessor ran');}}),{...expectedRole,args:Object.assign([...expectedRole.args],{extra:1})},{...expectedRole,args:[...expectedRole.args,undefined]}];
  for(const [index,value] of badRoles.entries())await check('V'+String(index+2).padStart(2,'0')+'-reject-malformed-role','SYNTHETIC',()=>{assert.throws(()=>same(value,expectedRole));assert.equal(accessorReads,0);});
  const corpus=JSON.parse(sources.get('tests/commands/table-text-stress/frozen-corpus.json'));
  await check('T01-table71-call-env-input-owned-cleanup','STUB',async()=>{
    assert.equal(corpus.length,71);
    const fake=memory(),loaded=await load(sourcePaths[0],{memory:fake,dispatch:()=>childResult()});
    for(const row of corpus) {
      const fixture=row.fixture, outcome=await loaded.namespace.native(fixture),call=calls.at(-1);
      assert.equal(call.executable,loaded.namespace.oracle+'/src/'+fixture.command);same(call.argv,fixture.args);assert.equal(call.inputHex,fixture.stdinHex);
      same(call.env,{LC_ALL:'C',PATH:'/usr/bin:/bin'});assert.equal(call.timeout,5000);assert.equal(call.maxBuffer,16*1024*1024);
      same(outcome,{exitCode:0,stdoutHex:Buffer.from('stub-out').toString('hex'),stderrHex:Buffer.from('stub-err').toString('hex'),files:fixture.files});
      assert(!fake.entries.has(call.cwd));fake.canary();
    }
    return {fixtureCount:71,stubDispatches:71,oracleSemanticPasses:0,foreignCanary:'preserved',fixtureBytes:'unchanged'};
  });
  const fixture=corpus[0].fixture;
  for(const mode of ['write','spawn','cleanup-only','primary-plus-cleanup','late-cleanup'])await check('T02-'+mode,'STUB',async()=>{
    const primary=new Error('PRIMARY-'+mode),cleanup=new Error('CLEANUP-'+mode);
    let release;
    const pending=mode==='late-cleanup'?new Promise(resolve=>{release=resolve;}):undefined;
    const fake=memory({writeError:mode==='write'?primary:undefined,rmError:mode==='cleanup-only'||mode==='primary-plus-cleanup'?cleanup:undefined,rmWait:pending});
    const loaded=await load(sourcePaths[0],{memory:fake,dispatch:()=>{if(mode==='spawn'||mode==='primary-plus-cleanup')throw primary;return childResult();}});
    let settled=false;const outcome=caught(()=>loaded.namespace.native(fixture)).then(error=>{settled=true;return error;});
    if(pending){for(let turn=0;turn<20;turn++)await Promise.resolve();assert.equal(settled,false);release();}
    const error=await outcome;fake.canary();
    const observation={cleanupAttempted:fake.events.some(entry=>entry.operation==='rm'),remainingOwned:fake.created.filter(entry=>fake.entries.has(entry)),foreign:'preserved'};
    if(mode==='primary-plus-cleanup')identity(error,primary,observation);
    else if(mode==='write'||mode==='spawn')identity(error,primary,observation);
    else if(mode==='cleanup-only')identity(error,cleanup,observation);
    else assert.equal(error,undefined);
    return observation;
  });
  for(const mode of ['success','foreign-parent','child-acquisition','primary-plus-foreign'])await check('T03-shared-'+mode,'STUB',async()=>{
    const primary=new Error('SHARED-PRIMARY');
    const fake=memory({foreignParent:mode.includes('foreign'),acquireError:mode==='child-acquisition'?primary:undefined});
    const loaded=await load(sourcePaths[1],{memory:fake,dispatch:()=>{if(mode==='primary-plus-foreign')throw primary;return childResult();}});
    const error=await caught(()=>loaded.namespace.native(fixture));fake.canary();
    if(mode.includes('foreign'))assert.equal(fake.entries.get(fake.created[0]+'/ordinary-foreign')?.toString(),'FOREIGN');
    assert(!fake.events.some(entry=>entry.operation==='rm'&&entry.path===fake.created[0]));
    const observed={operations:fake.events.filter(entry=>['rm','rmdir'].includes(entry.operation)),foreignRetained:mode.includes('foreign')};
    if(mode==='primary-plus-foreign')identity(error,primary,observed);
    else if(mode==='foreign-parent')assert.equal(error?.code,'ENOTEMPTY');
    else if(mode==='child-acquisition')identity(error,primary,observed);
    else assert.equal(error,undefined);
    return observed;
  });
  for(const mode of ['success','throw','outside','primary-plus-cleanup'])await check('P01-patch-scratch-'+mode,'STUB',async()=>{
    const primary=new Error('PATCH-PRIMARY'),cleanup=new Error('PATCH-CLEANUP');
    const fake=memory({rmError:mode==='primary-plus-cleanup'?cleanup:undefined});let invoked=0;
    const loaded=await load(sourcePaths[9],{memory:fake,tmpdir:mode==='outside'?'/unowned/tmp':undefined});
    const error=await caught(()=>loaded.namespace.withNativeScratch(temporary=>{invoked++;assert(temporary.startsWith('/gate/tmp/'));if(mode==='throw'||mode==='primary-plus-cleanup')throw primary;return 4;}));
    fake.canary();
    if(mode==='outside'){assert(error);assert.equal(invoked,0);assert.equal(fake.created.length,0);}
    else if(mode==='throw'||mode==='primary-plus-cleanup')identity(error,primary,{cleanupAttempts:fake.events.filter(entry=>entry.operation==='rm').length});
    else assert.equal(error,undefined);
    return {invoked,cleanup:fake.events.filter(entry=>entry.operation==='rm')};
  });
  for(const mode of ['success-canary','outside','primary-plus-cleanup'])await check('H01-shell-'+mode,'STUB',async()=>{
    const primary=new Error('SHELL-PRIMARY'),cleanup=new Error('SHELL-CLEANUP');
    const fake=memory({rmError:mode==='primary-plus-cleanup'?cleanup:undefined});let dispatches=0;
    const loaded=await load(sourcePaths[13],{memory:fake,tmpdir:mode==='outside'?'/unowned/tmp':undefined,dispatch:(executable,args,settings)=>{
      dispatches++;assert.equal(executable,'/bin/bash');same(args,['--noprofile','--norc','-c','printf test','shell-stress']);assert.notEqual(settings.cwd,settings.env.TMPDIR);assert.equal(settings.env.HOME,settings.cwd);assert.equal(settings.env.VALUE,'kept');
      if(mode==='primary-plus-cleanup')throw primary;
      fake.entries.set(settings.cwd+'/sh-thd-ordinary',Buffer.from('VISIBLE'));fake.entries.set(settings.env.TMPDIR+'/scratch-only',Buffer.from('SCRATCH'));return childResult();
    }});
    let result;const error=await caught(async()=>{result=await loaded.namespace.runBash({name:'independent',script:'printf test',stdin:'input',initialFiles:{ordinary:'original'},env:{VALUE:'kept'}});});
    fake.canary();
    if(mode==='outside'){assert(error);assert.equal(dispatches,0);}
    else if(mode==='primary-plus-cleanup')identity(error,primary,{removals:fake.events.filter(entry=>entry.operation==='rm')});
    else {assert.equal(error,undefined);assert.equal(result.files['sh-thd-ordinary'].base64,Buffer.from('VISIBLE').toString('base64'));assert(!Object.hasOwn(result.files,'scratch-only'));assert.equal(fake.created.filter(entry=>fake.entries.has(entry)).length,0);}
    return {dispatches,separateScratch:true,semanticFilter:false};
  });
  for(const mode of ['success','primary-plus-cleanup'])await check('H02-stream-'+mode,'STUB',async()=>{
    const primary=new Error('STREAM-PRIMARY'),cleanup=new Error('STREAM-CLEANUP'),fake=memory({rmError:mode==='primary-plus-cleanup'?cleanup:undefined});
    const loaded=await load(sourcePaths[12],{memory:fake,dispatch:(executable,args,settings)=>{assert.equal(executable,'/synthetic/stream');same(args,['--literal']);assert.equal(settings.argv0,'original-argv0');assert.notEqual(settings.cwd,settings.env.TMPDIR);if(mode==='primary-plus-cleanup')throw primary;return childResult(7);}});
    let result;const error=await caught(()=>{result=loaded.namespace.capture({id:'synthetic',command:'fold',args:['--literal'],stdinHex:'00ff',files:{input:'0102'}},'/synthetic/stream','original-argv0');});
    fake.canary();
    if(mode==='primary-plus-cleanup')identity(error,primary,{removals:fake.events.filter(entry=>entry.operation==='rm')});
    else {assert.equal(error,undefined);assert.equal(result.status,7);assert.equal(result.stdoutHex,Buffer.from('stub-out').toString('hex'));}
  });
  for(const family of ['git','npm'])for(const mode of ['positive','wrong-hash','wrong-realpath'])await check('R01-'+family+'-'+mode,'STUB',async()=>{
    const target=family==='git'?git:npm,expectedHash=family==='git'?gitHash:npmHash,fake=memory();let dispatches=0;
    fake.sync.lstatSync=filename=>{assert.equal(filename,target);return {isFile:()=>true,isSymbolicLink:()=>false,size:family==='git'?3704880:54,mode:0o755};};
    fake.sync.readFileSync=filename=>{assert.equal(filename,target);return Buffer.from('synthetic identity');};
    fake.sync.realpathSync=filename=>mode==='wrong-realpath'&&filename===target?'/wrong':filename;
    const loaded=await load(family==='git'?sourcePaths[4]:sourcePaths[6],{memory:fake,createHash:()=>({update(){return this;},digest:()=>mode==='wrong-hash'?'wrong':expectedHash}),dispatch:(executable,args,settings)=>{dispatches++;assert.equal(executable,family==='git'?git:node);same(args,family==='git'?['apply','--check','-']:[npm,'run','typecheck']);if(family==='git'){assert.equal(settings.env.GIT_EXEC_PATH,gitCore);assert.equal(settings.env.GIT_OPTIONAL_LOCKS,'0');assert.equal(settings.input,'patch bytes');}else{same(settings.env,{PATH:'/gate/native:/gate/tools',TMPDIR:'/gate/tmp',FULL_GATE_ROOT:'/gate',KEEP:'yes'});}return childResult(9);}});
    let result;const error=await caught(()=>{result=family==='git'?loaded.namespace.native('/owned/fixture','git',['apply','--check','-'],'patch bytes'):loaded.namespace.run('/owned/fixture','npm',['run','typecheck']);});
    assert.equal(dispatches,mode==='positive'?1:0);if(mode==='positive'){assert.equal(error,undefined);assert.equal(result.status,9);}else assert(error);
    assert.equal(loaded.processStub.env.NODE_TEST_CONTEXT,'child');
    return {dispatches,actualToolReads:0,identity:'synthetic only',nonzeroPreserved:mode==='positive'?9:null};
  });
  for(const mode of ['positive','missing','wrong-hash','wrong-version'])await check('C01-root-compiler-'+mode,'STUB',async()=>{
    const files=['typescript/package.json','typescript/bin/tsc','typescript/lib/tsc.js','typescript/lib/_tsc.js'];
    const bytes=files.map((filename,index)=>Buffer.from(index===0?JSON.stringify({version:mode==='wrong-version'?'0.0.0':'5.9.3'}):'synthetic compiler '+filename));
    const records=files.map((filename,index)=>({path:filename,kind:'file',bytes:bytes[index].length,mode:0o644,sha256:digest(bytes[index])}));
    if(mode==='missing')records.pop();if(mode==='wrong-hash')records[2].sha256='wrong';
    const fake=memory();const indexFor=filename=>{const index=files.indexOf(filename.replace('/candidate/node_modules/',''));assert(index>=0);return index;};
    fake.sync.lstatSync=filename=>({isFile:()=>true,isSymbolicLink:()=>false,size:bytes[indexFor(filename)].length,mode:0o644});
    fake.sync.readFileSync=filename=>bytes[indexFor(filename)];
    const loaded=await load(sourcePaths[3],{memory:fake,imports:{'./external-admission.mjs':{externalReceipt:()=>({report:{directories:{main:{entries:records}}}})}}});
    let result;const error=await caught(()=>{result=loaded.namespace.benchmarkTypeInvocation('/candidate');});
    if(mode==='positive'){assert.equal(error,undefined);same(result.args,['/candidate/node_modules/typescript/bin/tsc','--noEmit','-p','tsconfig.json']);assert.equal(result.cwd,'/candidate/benchmarks');assert.equal(result.bindings.length,4);}else assert(error);
    return {actualCompilerInvocations:0,selection:mode==='positive'?finite(result):'refused'};
  });
  for(const production of [false,true])await check('C02-build-counter-'+(production?'production':'benchmark'),'STUB',async()=>{
    const fake=memory();const writes=[];
    fake.sync.writeFileSync=(filename,bytes)=>writes.push({filename,body:JSON.parse(bytes)});
    await load(base+'launcher-v3/build-audit.mjs',{memory:fake,cwd:production?'/candidate':'/candidate/benchmarks',argv:[node,'/candidate/node_modules/typescript/bin/tsc',...(production?['-p','tsconfig.build.json']:['--noEmit','-p','tsconfig.json'])],environment:{UNIFIED76_BUILD_AUDIT:'/audit',UNIFIED76_BUILD_SOURCE:'/candidate',UNIFIED76_BUILD_NONCE:'synthetic'}});
    assert.equal(writes.length,production?1:0);return {syntheticAuditWrites:writes.length,actualBuilds:0};
  });
  for(const [index,count] of [[7,10],[8,6]])for(const mode of ['success','wrong-output','nonzero-with-pass','late-pass-timeout'])await check('R02-reporter-'+count+'-'+mode,'STUB',async()=>{
    const reason=new Error('ETIMEDOUT late # pass '+count);let dispatches=0;
    const loaded=await load(sourcePaths[index],{imports:{'./harness.js':{directory:'/synthetic/search',text:value=>Buffer.from(value,'base64').toString(),bounded:(executable,args,input,cwd,timeout)=>{
      dispatches++;assert.equal(executable,node);same(args,count===10?['--import','tsx','--test','--test-reporter=tap','/synthetic/search/safety-cases.ts']:['--unhandled-rejections=strict','--import','tsx','--test','--test-reporter=tap','--experimental-test-isolation=none','/synthetic/search/streaming-cases.ts']);assert.equal(input,'');assert.equal(cwd,'/synthetic/search');assert.equal(timeout,count===10?5000:120000);
      if(mode==='late-pass-timeout')throw reason;
      return {code:mode==='nonzero-with-pass'?1:0,stdout:Buffer.from(mode==='wrong-output'?'✔ apparently passed':'# pass '+count+'\n').toString('base64'),stderr:''};
    }}});
    const error=await caught(()=>loaded.registered[0].callback());assert.equal(dispatches,1);
    if(mode==='success')assert.equal(error,undefined);else if(mode==='late-pass-timeout')identity(error,reason,{});else assert(error);
    return {dispatches,otherRegisteredTestsRun:0,actualChildren:0};
  });
  await check('D03-protected-read-set-postcheck','DATA',()=>{
    const before=[...reads.values()];for(const record of before)assert.equal(digest(read(record.path)),record.sha256);
    return {originalReadPaths:before.length,newEntryDetection:false,qualification:'finite read-set comparison only; Git protected-tree checks recorded separately'};
  });
} catch(error) {
  results.push({id:'COHORT-FATAL',role:'HARNESS',status:'HARNESS_ERROR',error:failure(error)});
} finally {
  clearTimeout(watchdog);
  const summary={checks:results.length,pass:results.filter(row=>row.status==='PASS').length,fail:results.filter(row=>row.status==='FAIL').length,harnessErrors:results.filter(row=>row.status==='HARNESS_ERROR').length,skip:0};
  const report={schema:1,startedAt:new Date(started).toISOString(),endedAt:new Date().toISOString(),elapsedMs:Date.now()-started,runtime:{path:process.execPath,version:process.version},summary,results,sourceBindings:[...reads.values()],modules,calls,budgets:{readCount,totalBytes,operations,evaluations,recordingDispatches:calls.length},execution:{actualChildProcesses:0,actualTools:0,actualCompiler:0,actualBuild:0,actualProduct:0,actualGate:0,privateAccess:0,oldRootCleanup:0,authorHarnessRuns:0,future20Actual:0},closure:{ownedChildProcesses:0,ownedRealScratchRoots:0,watchdogCleared:true,allAwaitedReviewCasesSettled:true},qualification:'Source/data/whole-module synthetic-stub only. Original R3 19425P132F7skip6of14, 928 captures and 286 additions remain historical. Primary-loss failures are not waived.'};
  const serialized=JSON.stringify(report,null,2)+'\n';assert(Buffer.byteLength(serialized)<=1024*1024);
  fs.writeFileSync(path.join(root,owned,'RESULTS.json'),serialized,{flag:'wx'});
  process.stdout.write(JSON.stringify(summary)+'\n');
  process.exitCode=summary.fail||summary.harnessErrors?1:0;
}
