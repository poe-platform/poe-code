import assert from 'node:assert/strict';
import {spawn, spawnSync} from 'node:child_process';
import {createHash, randomUUID} from 'node:crypto';
import {copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync, unlinkSync, writeFileSync} from 'node:fs';
import {dirname, join} from 'node:path';
import {fileURLToPath, pathToFileURL} from 'node:url';
import {gunzipSync} from 'node:zlib';
import childProcess from 'node:child_process';
import fileSystem from 'node:fs';
import {syncBuiltinESMExports} from 'node:module';
import {createToolPath, inspectLinkage, prepareInspection, rejectToolSelection, toolRoutes, verifyGitClosure, verifyToolFile, verifyToolPath} from '../tool-routing.mjs';
import {createInstructionFence, instructionFenceInvocation, renderInstructionFence, validateInstructionFence} from '../os-instruction-fence.mjs';
import {verifyDriverSeal} from '../admission.mjs';
import {supervise} from '../supervise.mjs';
import {cleanGitEnvironment} from '../transport.mjs';
import {stageTypingHelper} from './helper-stage.mjs';

assert.deepEqual(process.argv.slice(2), ['--run-controls']);
const directory = dirname(fileURLToPath(import.meta.url));
const launcher = dirname(directory);
const repository = join(launcher, '../../../../..');
const node = '/Users/kjopek/.nvm/versions/node/v24.11.1/bin/node';
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const save = (path, value) => writeFileSync(path, JSON.stringify(value, null, 2) + '\n', {flag: 'wx'});
const outer = realpathSync(mkdtempSync('/private/tmp/unified76-route-controls-'));
const source = verifyDriverSeal();
const profile = JSON.parse(gunzipSync(Buffer.from(readFileSync(join(launcher, 'PROFILE.json.gz.base64'), 'utf8').trim(), 'base64')));
const external = JSON.parse(gunzipSync(Buffer.from(readFileSync(join(launcher, 'EXTERNAL.json.gz.base64'), 'utf8').trim(), 'base64')));
verifyToolFile(external.tools.find(entry => entry.origin === node));
const rows = [], resources = [], result = {startedAt: new Date().toISOString(), source, controlsSha256: sha(readFileSync(join(directory, 'CONTROLS.json'))), rows, builds: 0, fullGatePhases: 0};
let envelope, binding, environment, foreign;
async function test(id, body) {
  const row = {id, startedAt: new Date().toISOString()}; rows.push(row);
  try { row.evidence = await body(); row.status = 'PASS'; } catch (error) { row.status = 'FAIL'; row.error = error.stack; process.exitCode = 1; }
  row.finishedAt = new Date().toISOString(); save(join(outer, id + '.json'), row);
}
async function run(label, program, options = {}) {
  const args = ['--input-type=module', '-e', program];
  const env = options.env ?? environment;
  const invocation = instructionFenceInvocation(envelope, node, args, env, {preserveEnvironment: options.env === undefined});
  const receipt = await supervise(invocation.executable, invocation.args, {cwd: envelope.roots[0].path, env: invocation.env, stdout: join(outer, label + '.stdout'), stderr: join(outer, label + '.stderr'), timeoutMs: 15000, maxOutputBytes: 1024 * 1024, observeSockets: true});
  assert.equal(receipt.closed, true); assert.deepEqual(receipt.survivors, []);
  if (!options.nonclean) { assert.equal(receipt.clean, true); assert.equal(receipt.status, 0, readFileSync(join(outer, label + '.stderr'), 'utf8')); assert.deepEqual(receipt.signals, []); }
  return {receipt, stdout: readFileSync(join(outer, label + '.stdout'), 'utf8'), stderr: readFileSync(join(outer, label + '.stderr'), 'utf8'), invocation};
}
try {
  await test('R01', () => {
    const outputs = [];
    for (const target of toolRoutes().inspectionTargets) {
      const output = inspectLinkage(target, {});
      const expected = target === '/usr/bin/sandbox-exec' ? JSON.parse(readFileSync(join(launcher, 'OS-INSTRUCTION-FENCE.json'))).linkage : external.linkage.find(entry => entry.origin === target).stdout;
      assert.equal(output.stdout, expected); assert.equal(output.invocation.receipt.admittedBeforeExecution, true); assert.deepEqual(output.invocation.args, ['-L', target]);
      outputs.push(output);
    }
    return outputs;
  });
  if (rows.at(-1).status !== 'PASS') throw Error('inspector positive failed; dependent execution held');
  envelope = createInstructionFence('/tmp/unified76-build-types-review-routes-' + process.pid + '-' + randomUUID().slice(0, 8));
  resources.push(envelope.roots[0].path, envelope.roots[1].path);
  binding = createToolPath(envelope.roots[0].path);
  environment = {...cleanGitEnvironment({PATH: binding.path, HOME: join(envelope.roots[0].path, 'home'), TMPDIR: join(envelope.roots[0].path, 'tmp'), TMP: join(envelope.roots[0].path, 'tmp'), TEMP: join(envelope.roots[0].path, 'tmp')}), GIT_EXEC_PATH: binding.gitCore.origin};
  verifyToolPath(binding, environment);
  save(join(outer, 'SETUP.json'), {envelope, binding, environment});
  await test('R02', () => {
    const expected = toolRoutes().inspector;
    assert.throws(() => verifyToolFile({...expected, sha256: '0'.repeat(64)}), /tool bytes changed/);
    assert.throws(() => verifyToolFile({...expected, mode: 0o700}));
    assert.throws(() => verifyToolFile({...expected, physical: expected.origin + '-missing'}));
    assert.throws(() => verifyToolFile({...expected, origin: join(outer, 'missing')}), /ENOENT/);
    const route = join(binding.path, 'git'); unlinkSync(route); symlinkSync('/usr/bin/git', route);
    try { assert.throws(() => verifyToolPath(binding, environment)); } finally { unlinkSync(route); symlinkSync(toolRoutes().git, route); }
    verifyToolPath(binding, environment);
    for (const mutate of [copy => { copy.external.inspection.invocation.receipt.binary.sha256 = '0'.repeat(64); }, copy => { copy.external.inspection.invocation.args[0] = '--not-approved'; }]) {
      const copy = structuredClone(envelope); mutate(copy); assert.throws(() => validateInstructionFence(copy));
    }
    return {negativeChecks: 7, qualification: 'Hash/missing/route negatives do not execute a replacement; two envelope negatives freshly inspect the approved binary before rejecting altered stable bindings.'};
  });
  await test('R03', () => {
    assert.throws(() => prepareInspection('/bin/sh', {}), /unlisted inspection target/);
    assert.throws(() => prepareInspection('/tmp/unknown-tool', {}), /unlisted inspection target/);
    const path = join(binding.path, 'undeclared'); symlinkSync(toolRoutes().git, path);
    try { assert.throws(() => verifyToolPath(binding, environment)); } finally { unlinkSync(path); }
    const native = join(envelope.roots[0].path, 'native-path-control'); mkdirSync(native);
    const withNative = {...environment, PATH: native + ':' + binding.path};
    verifyToolPath(binding, withNative, native);
    writeFileSync(join(native, 'git'), 'unexecuted shadow');
    try { assert.throws(() => verifyToolPath(binding, withNative, native), /unbound native PATH entry/); } finally { unlinkSync(join(native, 'git')); }
    return {negativeChecks: 4, nativePrestageEmptyAdmitted: true, qualification: 'Declared route/target admission, including extra native PATH entries, not a universal arbitrary-process allowlist. Mandatory native completeness remains the separate unchanged native staging check.'};
  });
  await test('R04', () => {
    const keys = ['DEVELOPER_DIR', 'TOOLCHAINS', 'SDKROOT', 'SDK_DIR', 'XCODE_DEVELOPER_DIR_PATH', 'xcrun_nocache', 'xcrun_log', 'DYLD_LIBRARY_PATH', 'LD_PRELOAD'];
    for (const key of keys) assert.throws(() => rejectToolSelection({[key]: '/not-admitted'}), error => error.exitCode === 78);
    assert.throws(() => verifyToolPath(binding, {...environment, PATH: binding.path + ':/usr/bin'}));
    assert.throws(() => verifyToolPath(binding, {...environment, GIT_EXEC_PATH: '/tmp/unbound-helper'}));
    return {keys, finitePath: environment.PATH, negativeChecks: keys.length + 2};
  });
  await test('R05', async () => {
    const root = join(envelope.roots[0].path, 'typing-helper'); mkdirSync(root);
    const staged = await stageTypingHelper({root, repository, profile, environment, git: toolRoutes().git});
    save(join(outer, 'HELPER-INPUTS.json'), staged);
    const module = pathToFileURL(join(root, 'scripts/typecheck-inputs.mjs')).href;
    const program = `import assert from 'node:assert/strict';import child from 'node:child_process';import {syncBuiltinESMExports}from'node:module';import{realpathSync}from'node:fs';const calls=[];const original=child.execFileSync;child.execFileSync=function(file,args,options){const value=original.call(this,file,args,options);calls.push({file,args,cwd:options.cwd,route:realpathSync(process.env.PATH+'/git'),bytes:value.length});return value;};syncBuiltinESMExports();const helper=await import(${JSON.stringify(module)});const value=helper.verifyTypecheckInputs(${JSON.stringify(root)});assert.equal(calls.length,1);assert.equal(calls[0].file,'git');assert.deepEqual(calls[0].args,['ls-files','-z']);console.log(JSON.stringify({calls,value}));`;
    const probe = await run('typing-helper', program);
    assert.equal(JSON.parse(probe.stdout).calls[0].route, toolRoutes().git);
    verifyToolPath(binding, environment);
    return {staged: {files: staged.physicalFiles, bytes: staged.bytes, indexedPaths: staged.indexedPaths}, ...probe};
  });
  await test('R06', async () => {
    const git = toolRoutes().git;
    const program = `import assert from'node:assert/strict';import{spawnSync}from'node:child_process';const results=[];for(const[file,args]of[[${JSON.stringify(git)},['--exec-path']],['/bin/sh',['-c','exec "$1" --exec-path','declared',${JSON.stringify(git)}]]]){const r=spawnSync(file,args,{env:{},encoding:'utf8',timeout:5000});assert.equal(r.status,0,r.stderr);assert.equal(r.stdout.trim(),${JSON.stringify(binding.gitCore.origin)});results.push({file,args,status:r.status,stdout:r.stdout});}const rejected=spawnSync('git',['--version'],{env:{},encoding:'utf8',timeout:5000});assert.ok(rejected.error||rejected.status!==0);console.log(JSON.stringify({results,undeclared:{status:rejected.status,error:rejected.error?.code}}));`;
    return await run('empty-environment', program, {env: {}});
  });
  await test('R07', async () => {
    const copy = join(envelope.roots[0].path, 'metadata-negative'); mkdirSync(copy);
    copyFileSync(join(launcher, 'tool-routing.mjs'), join(copy, 'tool-routing.mjs'));
    const metadata = toolRoutes(); metadata.systemReferences.push('/tmp/not-approved-library');
    save(join(copy, 'TOOL-ROUTES.json'), metadata);
    const program = `import assert from'node:assert/strict';const{verifyInspector}=await import(${JSON.stringify(pathToFileURL(join(copy, 'tool-routing.mjs')).href)});assert.throws(()=>verifyInspector({}),error=>error.exitCode===78&&error.cause?.code==='ERR_ASSERTION');console.log('extra-reference refused before host/inspector execution');`;
    const probe = await run('extra-reference', program);
    assert.equal(external.linkage.flatMap(row => row.dependencies).length, 11);
    const original = fileSystem.lstatSync;
    fileSystem.lstatSync = function(path, ...args) { return original.call(this, path === '/usr/lib/libc++.1.dylib' ? toolRoutes().inspector.physical : path, ...args); };
    syncBuiltinESMExports();
    try { assert.throws(() => prepareInspection('/usr/bin/tar', {}), /new readable library/); }
    finally { fileSystem.lstatSync = original; syncBuiltinESMExports(); }
    return {originalReferences: 11, sandboxReferences: 2, inspectorReferences: 2, injectedReadableReferenceRefused: true, qualification: 'Readable-path fault is injected in this test process; no system library was created or edited.', ...probe};
  });
  await test('R08', () => {
    const observed = rows.find(row => row.id === 'R01').evidence;
    for (const row of observed) {
      assert.throws(() => assert.equal(row.stdout, row.stdout.replace(/\n\t[^\n]+/, '')));
      assert.throws(() => assert.equal('', row.stdout));
    }
    const original = childProcess.spawnSync;
    let corrupted = 0;
    childProcess.spawnSync = function(file, args, options) {
      const result = original.call(this, file, args, options);
      if (file === toolRoutes().inspector.physical) { corrupted++; return {...result, stdout: ''}; }
      return result;
    };
    syncBuiltinESMExports();
    try { assert.throws(() => inspectLinkage('/usr/bin/tar', {}), /linkage output changed or missing/); }
    finally { childProcess.spawnSync = original; syncBuiltinESMExports(); }
    assert.equal(corrupted, 1);
    return {actualOutputs: observed.length, missingOrChangedOutputControls: observed.length * 2, actualInspectorOutputFaults: corrupted, qualification: 'One additional approved inspector executes; test-process transport then discards stdout. The shipping inspection seam must refuse, with unchanged pinned expected linkage.'};
  });
  await test('R09', async () => {
    const program = `import assert from'node:assert/strict';import{spawnSync}from'node:child_process';import{writeFileSync,mkdirSync,readFileSync}from'node:fs';const root=${JSON.stringify(join(envelope.roots[0].path, 'ordinary-git'))};mkdirSync(root);const invoke=args=>{const r=spawnSync('git',args,{cwd:root,env:process.env,encoding:null,timeout:5000});assert.equal(r.status,0,r.stderr.toString());return r.stdout;};invoke(['init','--quiet','--template=']);writeFileSync(root+'/ordinary.txt','ordinary\\n');invoke(['add','ordinary.txt']);const tree=invoke(['write-tree']).toString().trim();const archive=invoke(['archive','--format=tar',tree]);assert.ok(archive.includes(Buffer.from('ordinary.txt')));assert.ok(!archive.includes(Buffer.from('AGENTS.md')));console.log(JSON.stringify({tree,bytes:archive.length,content:readFileSync(root+'/ordinary.txt','utf8')}));`;
    return await run('ordinary-git', program);
  });
  await test('R10', async () => {
    const paths = toolRoutes().deniedSelectorExecutables;
    const program = `import assert from'node:assert/strict';import{spawnSync}from'node:child_process';const rows=[];for(const path of ${JSON.stringify(paths)}){const r=spawnSync(path,['--version'],{env:{},encoding:'utf8',timeout:5000});assert.equal(r.error?.code,'EPERM',path+': '+r.stderr);rows.push({path,error:r.error.code,status:r.status});}console.log(JSON.stringify(rows));`;
    return await run('selector-denials', program, {env: {}});
  });
  await test('R11', async () => {
    const outside = join(outer, 'outside.txt'); writeFileSync(outside, 'preserved');
    const profileText = renderInstructionFence(envelope);
    for (const fragment of ['(deny file-write* file-link)', '(deny file-write* file-link (regex #', '(allow file-write-data (literal "/dev/null"))']) assert.ok(profileText.includes(fragment));
    const program = `import assert from'node:assert/strict';import{symlinkSync,renameSync,writeFileSync,readFileSync}from'node:fs';const root=${JSON.stringify(envelope.roots[0].path)},outside=${JSON.stringify(outside)};symlinkSync(outside,root+'/inert');renameSync(root+'/inert',root+'/renamed');assert.equal(readFileSync(root+'/renamed','utf8'),'preserved');for(const path of[root+'/renamed',root+'/AGENTS.md',root+'/AgEnTs.Md'])assert.throws(()=>writeFileSync(path,'ordinary'),error=>error.code==='EPERM'||error.code==='EACCES');writeFileSync(root+'/ordinary-output','allowed');console.log('inert-reference allowed; resolved writes denied; ordinary output allowed');`;
    const probe = await run('write-policy', program);
    assert.equal(readFileSync(outside, 'utf8'), 'preserved');
    return probe;
  });
  await test('R12', async () => {
    foreign = spawn(node, ['-e', 'process.stdin.resume()'], {stdio: ['pipe', 'pipe', 'pipe']});
    const closed = new Promise(resolve => foreign.once('close', (status, signal) => resolve({status, signal})));
    const program = `import{spawn}from'node:child_process';const child=spawn(process.execPath,['-e','setTimeout(()=>{},10000)'],{stdio:'ignore'});child.unref();console.log(child.pid);`;
    const probe = await run('owned-abandonment', program, {nonclean: true});
    assert.equal(probe.receipt.clean, false); assert.ok(probe.receipt.signals.length); assert.deepEqual(probe.receipt.survivors, []);
    assert.equal(foreign.exitCode, null); foreign.stdin.end(); const final = await closed; assert.deepEqual(final, {status: 0, signal: null}); foreign = undefined;
    return {expectedNonclean: true, foreignClosed: final, ...probe};
  });
} catch (error) { result.setupError = error.stack; process.exitCode = 1; }
finally {
  if (foreign) { foreign.stdin.end(); await new Promise(resolve => foreign.once('close', resolve)); }
  const cleanup = [];
  for (const path of resources.reverse()) { assert.ok(path.startsWith('/private/tmp/unified76-')); rmSync(path, {recursive: true, force: true}); cleanup.push({path, absent: !existsSync(path)}); }
  result.cleanup = cleanup;
  result.finishedAt = new Date().toISOString(); result.pass = rows.filter(row => row.status === 'PASS').length; result.fail = rows.filter(row => row.status === 'FAIL').length; result.notExecuted = 12 - rows.length;
  result.shippingUnchanged = JSON.stringify(verifyDriverSeal()) === JSON.stringify(source);
  result.helperScriptSha256 = sha(readFileSync(join(directory, 'helper-stage.mjs'))); result.runnerSha256 = sha(readFileSync(fileURLToPath(import.meta.url)));
  save(join(outer, 'REPORT.json'), result); console.log(JSON.stringify({outer, pass: result.pass, fail: result.fail, notExecuted: result.notExecuted, setupError: result.setupError, fullGatePhases: 0}));
}
