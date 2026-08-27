import assert from 'node:assert/strict';
import { spawnSync, execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { probeConsumerPermission, consumerPermissionArgs } from '../../../scripts/verify-current-consumers.mjs';

const repository = fileURLToPath(new URL('../../../', import.meta.url));
const output = resolve(process.argv[2]);
assert.ok(output.startsWith('/tmp/') && !existsSync(output));
const temporary = realpathSync(mkdtempSync('/tmp/safe-bash-permission-controls-'));
const digest = bytes => createHash('sha256').update(bytes).digest('hex');
const candidate = '8670ebe8f0d39966c2de2638780437398e5f8490';
const packagePath = '/tmp/safe-bash-package-8670-20260827-v1/virtual-bash-0.0.0.tgz';
const report = { candidate, source: {}, profiles: [], controls: [], failures: [], privateAccess: false, fullConsumerInventoryExecuted: false };
const scripts = ['scripts/verify-current-consumers.mjs', 'scripts/verify-qualified-release.mjs'];
for (const path of scripts) report.source[path] = digest(readFileSync(join(repository, path)));
function check(name, operation) {
  try { operation(); report.controls.push({ name, status: 'pass' }); }
  catch (error) { report.controls.push({ name, status: 'fail' }); report.failures.push({ name, message: error.message, stack: error.stack }); }
}
function prepare(name) {
  const directory = join(temporary, name), root = join(directory, 'source');
  mkdirSync(join(root, 'src'), { recursive: true });
  writeFileSync(join(root, 'src/index.ts'), execFileSync('git', ['show', candidate + ':src/index.ts'], { cwd: repository }));
  return { directory, root, steps: [] };
}
function execute(executable, args, cwd) {
  const result = spawnSync(executable, args, { cwd, encoding: 'utf8', timeout: 20000, env: { PATH: '/usr/bin:/bin', LC_ALL: 'C', TZ: 'UTC' } });
  return { executable, args, cwd, status: result.status, signal: result.signal, error: result.error?.message, stdout: result.stdout, stderr: result.stderr };
}
const profiles = [
  { executable: '/Users/kjopek/.nvm/versions/node/v22.22.2/bin/node', version: 'v22.22.2', sha256: '5c899797c4eb8f1db5563eea56538342ddb3e9276ee1b04a5a1f0f1023d2b011' },
  { executable: '/Users/kjopek/.nvm/versions/node/v24.11.1/bin/node', version: 'v24.11.1', sha256: '4255a388254ca4319e2f95f1da375d5deaddf25baf9c7c85070b67f9543b15d0' },
];
try {
  const packageBytes = readFileSync(packagePath);
  report.packageSha256 = digest(packageBytes);
  assert.equal(report.packageSha256, '96d8256f3d763caa5442ba27b44e6b1f586d82d83d07d7d10369bed12426b5c1');
  for (const profile of profiles) {
    const context = prepare(profile.version);
    assert.equal(digest(readFileSync(profile.executable)), profile.sha256);
    const admission = probeConsumerPermission(context, profile.executable);
    const record = { ...profile, admission, executions: [] }; report.profiles.push(record);
    check(profile.version + ': actual binary identity and behavior select stable permission flag', () => {
      assert.equal(admission.flag, '--permission'); assert.equal(admission.supported, true);
      assert.equal(admission.identity.version, profile.version); assert.equal(admission.sha256, profile.sha256);
      assert.deepEqual(admission.probes.map(row => row.status), [0, 0, 1]);
    });
    const consumer = join(context.directory, 'consumer'), packages = join(consumer, 'node_modules');
    mkdirSync(packages, { recursive: true });
    execFileSync('/usr/bin/tar', ['-xf', packagePath, '-C', packages]);
    renameSync(join(packages, 'package'), join(packages, 'virtual-bash'));
    const filename = join(consumer, 'positive.mjs'), forbidden = join(context.root, 'src/index.ts');
    writeFileSync(filename, `import assert from 'node:assert/strict'; import {readFileSync,writeFileSync} from 'node:fs'; import {Shell,agentCommands,MemoryFileSystem} from 'virtual-bash';
const fs=new MemoryFileSystem(); const shell=new Shell({fs}).use(agentCommands());
try { const result=await shell.exec("printf 'alpha\\nbeta\\n' | head -n 1 > /out; cat /out"); assert.equal(result.exitCode,0); assert.equal(result.stdout,'alpha\\n'); assert.equal(result.stderr,''); assert.equal(new TextDecoder().decode(await fs.readFile('/out')),'alpha\\n');
assert.throws(()=>readFileSync(${JSON.stringify(forbidden)}),{code:'ERR_ACCESS_DENIED',permission:'FileSystemRead'});
assert.throws(()=>writeFileSync(${JSON.stringify(join(consumer, 'must-not-exist'))},'no'),{code:'ERR_ACCESS_DENIED',permission:'FileSystemWrite'});
console.log(JSON.stringify({version:process.version,executable:process.execPath,pipeline:true,vfs:true,sourceDenied:true,hostWriteDenied:true})); } finally { await shell.dispose(); }
`);
    const args = consumerPermissionArgs(admission, consumer, true);
    const positive = execute(admission.executable, [...args, filename], consumer); record.executions.push({ name: 'packed-positive', ...positive });
    check(profile.version + ': actual packed public pipeline and VFS with denied host read/write', () => {
      assert.equal(positive.status, 0, positive.stderr); assert.equal(positive.signal, null); assert.equal(positive.error, undefined);
      assert.deepEqual(JSON.parse(positive.stdout), { version: profile.version, executable: profile.executable, pipeline: true, vfs: true, sourceDenied: true, hostWriteDenied: true });
      assert.equal(existsSync(join(consumer, 'must-not-exist')), false);
    });
    const denied = execute(admission.executable, [...consumerPermissionArgs(admission, consumer), '--input-type=module', '-e', `import {readFileSync} from 'node:fs'; readFileSync(${JSON.stringify(forbidden)});`], consumer); record.executions.push({ name: 'uncaught-source-denial', ...denied });
    check(profile.version + ': uncaught source denial executes, not unknown-option refusal', () => { assert.equal(denied.status, 1); assert.match(denied.stderr, /ERR_ACCESS_DENIED/); assert.ok(denied.stderr.includes(forbidden)); });
    const unguarded = execute(admission.executable, [...args.slice(1), filename], consumer); record.executions.push({ name: 'permission-removal-mutant', ...unguarded });
    check(profile.version + ': flag-only removal refuses startup with exact missing-option code', () => { assert.equal(unguarded.status, 1); assert.match(unguarded.stderr, /ERR_MISSING_OPTION/); });
    const unfenced = execute(admission.executable, ['--unhandled-rejections=strict', filename], consumer); record.executions.push({ name: 'all-permissions-removal-mutant', ...unfenced });
    check(profile.version + ': full permission-removal mutant executes and fails public source denial', () => { assert.equal(unfenced.status, 1); assert.match(unfenced.stderr, /Missing expected exception/); });
    const widened = execute(admission.executable, [admission.flag, `--allow-fs-read=${context.directory}`, '--allow-worker', '--unhandled-rejections=strict', filename], consumer); record.executions.push({ name: 'scope-widening-mutant', ...widened });
    check(profile.version + ': actual scope-widening mutant fails public source assertion', () => { assert.equal(widened.status, 1); assert.match(widened.stderr, /Missing expected exception/); });
    check(profile.version + ': per-launch changed-hash admission refused78', () => { assert.throws(() => consumerPermissionArgs({ ...admission, sha256: '0'.repeat(64) }, consumer, true), { exitCode: 78 }); });
    check(profile.version + ': unsupported admission refused78', () => { assert.throws(() => consumerPermissionArgs({ ...admission, supported: false }, consumer), { exitCode: 78 }); });
    check(profile.version + ': worker/strict flags retained and read grant not broadened', () => { assert.deepEqual(args, ['--permission', `--allow-fs-read=${consumer}`, '--allow-worker', '--unhandled-rejections=strict']); assert.throws(() => consumerPermissionArgs(admission, consumer + '/*'), { exitCode: 78 }); });
    assert.equal(digest(readFileSync(profile.executable)), profile.sha256);
  }
  for (const kind of ['no-mode', 'unknown-option', 'permissive', 'wrong-resource', 'fake-code9']) {
    const context = prepare(kind), executable = join(context.directory, 'fake-node');
    const body = `#!${profiles[1].executable}
const args=process.argv.slice(2), mode=${JSON.stringify(kind)};
if(args.some(arg=>arg.includes('allowedNodeEnvironmentFlags'))) console.log(JSON.stringify({executable:${JSON.stringify(executable)},version:'negative-control',flags:mode==='no-mode'?[]:['--permission']}));
else if(mode==='unknown-option') { console.error('bad option: --permission'); process.exitCode=9; }
else if(args.some(arg=>arg.includes('writeDenied:true'))) console.log(JSON.stringify({executable:${JSON.stringify(executable)},version:'negative-control',read:true,writeDenied:true}));
else { console.error('ERR_ACCESS_DENIED FileSystemRead wrong-resource'); process.exitCode=mode==='permissive'?0:mode==='fake-code9'?9:1; }
`;
    writeFileSync(executable, body); chmodSync(executable, 0o755);
    check(kind + ': truthful admission refusal78 without consumer execution', () => {
      assert.throws(() => probeConsumerPermission(context, executable), { exitCode: 78 });
      assert.equal(context.permissionAdmission.supported, false);
    });
    report.profiles.push({ negative: kind, admission: context.permissionAdmission });
  }
  const source = readFileSync(join(repository, scripts[0]), 'utf8'), caller = readFileSync(join(repository, scripts[1]), 'utf8');
  check('source policy: actual-child admission precedes build', () => { assert.ok(source.indexOf('const permission = probeConsumerPermission(report)') < source.indexOf('step(report, "current-consumers-build"')); });
  check('source policy: current and aggregate CLI preserve refusal78', () => { assert.match(source, /finish\(report, error.exitCode === 78 \? 78 : 1, error\)/); assert.match(caller, /if \(error.exitCode === 78\) throw error/); assert.match(caller, /finish\(report, error.exitCode === 78 \? 78 : 1, error\)/); });
  check('source policy: exact final denial and runtime result coverage retained', () => { assert.match(source, /assert.equal\(denied.status, 1\)/); assert.match(source, /assert.match\(denied.stderr, \/ERR_ACCESS_DENIED\/u\)/); assert.match(source, /validateRuntimeResults\(consumerGroups, report.currentConsumers.groups\)/); });
  for (const path of scripts) assert.equal(digest(readFileSync(join(repository, path))), report.source[path]);
  assert.equal(digest(readFileSync(packagePath)), report.packageSha256);
} catch (error) { report.failures.push({ message: error.message, stack: error.stack }); }
finally {
  rmSync(temporary, { recursive: true, force: true }); report.temporaryRemoved = !existsSync(temporary);
  report.status = report.failures.length === 0 ? 'author-controls-pass-independent-review-pending' : 'author-controls-failed';
  writeFileSync(output, JSON.stringify(report, null, 2) + '\n', { flag: 'wx' });
  console.log(JSON.stringify({ status: report.status, controls: report.controls.length, failures: report.failures, output, temporaryRemoved: report.temporaryRemoved }));
  if (report.failures.length) process.exitCode = 1;
}
