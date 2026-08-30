import assert from 'node:assert/strict';
import {spawnSync, execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {cpSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {dirname, join, resolve} from 'node:path';
import {gunzipSync} from 'node:zlib';
import {fileURLToPath} from 'node:url';
import {copyDependencies} from '../full-gate-20260827/unified76-driver/common.mjs';
import {capture, compare} from '../full-gate-20260827/unified76-driver/inventory.mjs';
import {directoryIdentity} from '../full-gate-20260827/unified76-driver/launcher-v3/external.mjs';
import {account} from '../full-gate-20260827/account.mjs';

const scope = dirname(fileURLToPath(import.meta.url));
const repo = resolve(scope, '../../..');
const candidate = '5137a74ec855a32d8a8860eb66b62eb44d11e290';
const packageSha256 = '13fe54de1cf900d587855e276375fdf72ed1ed0d0e0625cf7ef00730f2bb74c9';
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const sourceEvidence = join(repo, 'tests/integration/combined77-stage2-readiness-20260828/evidence');
const rawIndex = JSON.parse(readFileSync(join(sourceEvidence, 'RAW-INDEX.json')));
const compressed = Buffer.from(readFileSync(join(sourceEvidence, 'RAW.json.gz.base64'), 'utf8'), 'base64');
assert.equal(sha(compressed), rawIndex.compressedSha256);
const raw = gunzipSync(compressed);
assert.equal(sha(raw), rawIndex.uncompressedSha256);
const original = JSON.parse(raw).files.find(row => row.path === 'final/REPORT.json');
assert.ok(original);
const originalBytes = Buffer.from(original.base64, 'base64');
assert.equal(sha(originalBytes), original.sha256);
const proof = JSON.parse(originalBytes);
assert.equal(proof.candidate, candidate);
const tarball = process.argv[2] ?? proof.package.origin;
assert.equal(sha(readFileSync(tarball)), packageSha256);
const readme = readFileSync(join(repo, 'README.md'), 'utf8');
const root = realpathSync(mkdtempSync(join(tmpdir(), 'combined77-doc-smoke-')));
const consumer = join(root, 'moved documentation consumer');
const node22 = proof.tools.node22.physical;
const node24 = proof.tools.node24.physical;
const report = {createdAt: new Date().toISOString(), candidate, packageSha256, root,
  readmeSha256: sha(readme), commands: [], examples: [], priorPackageReportSha256: sha(originalBytes),
  reusedBuiltPackage: true, buildRerun: false, wholeGateLaunched: false, privateEngineExecuted: false};
const save = (path, text) => writeFileSync(path, typeof text === 'string' ? text : JSON.stringify(text, null, 2) + '\n', {flag: 'wx'});
const env = {PATH: dirname(node24) + ':/usr/bin:/bin', HOME: root, TMPDIR: root, LANG: 'C', LC_ALL: 'C', TZ: 'UTC'};
function run(label, executable, args) {
  const result = spawnSync(executable, args, {cwd: consumer, env, encoding: 'utf8', timeout: 90000, maxBuffer: 4 * 1024 * 1024});
  save(join(root, label + '.stdout'), result.stdout ?? '');
  save(join(root, label + '.stderr'), result.stderr ?? '');
  const row = {label, executable, executableSha256: sha(readFileSync(executable)), args,
    status: result.status, signal: result.signal, error: result.error?.message,
    stdoutSha256: sha(result.stdout ?? ''), stderrSha256: sha(result.stderr ?? '')};
  if (args.includes('--test-reporter=tap')) row.accounting = account(result.stdout ?? '');
  report.commands.push(row);
  return result;
}
function requireSuccess(result) {
  assert.equal(result.error, undefined);
  assert.equal(result.signal, null);
  assert.equal(result.status, 0, result.stderr + result.stdout);
}

try {
  for (const key of ['node22', 'node24', 'tar']) assert.equal(sha(readFileSync(proof.tools[key].physical)), proof.tools[key].sha256);
  report.tools = proof.tools;
  report.dependencies = await directoryIdentity(join(repo, 'node_modules'));
  assert.equal(report.dependencies.sha256, proof.dependencies.main.sha256);
  mkdirSync(consumer);
  save(join(consumer, 'package.json'), {private: true, type: 'module'});
  copyDependencies(join(consumer, 'node_modules'));
  const packageRoot = join(consumer, 'node_modules/virtual-bash');
  mkdirSync(packageRoot);
  execFileSync(proof.tools.tar.physical, ['-xf', tarball, '--strip-components=1', '-C', packageRoot], {timeout: 30000});
  const packageBefore = await capture(packageRoot);
  assert.deepEqual(compare(proof.packageFiles, packageBefore), []);
  report.packageFiles = packageBefore;
  assert.deepEqual(JSON.parse(readFileSync(join(packageRoot, 'package.json'))).dependencies ?? {}, {});
  save(join(root, 'README.input.md'), readme);
  cpSync(join(scope, 'no-network.mjs'), join(consumer, 'no-network.mjs'));
  cpSync(join(scope, 'workflows.mts.fixture'), join(consumer, 'workflows.mts'));
  const examples = [...readme.matchAll(/```ts\n([\s\S]*?)```/gu)];
  assert.equal(examples.length, 13);
  const standalone = [];
  const expectedLogs = new Map([
    [1, [['world\n']]], [2, []], [3, [['n:reader\n/bin/tool\nfrom stdin\n']]],
    [4, [['2024-02-29T12:34:56.123Z\n']]], [5, [['new line\nold line\n']]],
    [8, [['600:0\n']]], [9, [[0, 'hello from mock\n']]], [10, [['keep  1\nkeep  3\n']]], [13, []],
  ]);
  const files = [];
  for (const [offset, match] of examples.entries()) {
    const number = offset + 1;
    let text = match[1];
    let role = expectedLogs.has(number) ? 'exact standalone runtime and strict types' : 'strict types; separate contextual workflow';
    if (number === 6) text = 'import {Shell,agentCommands,createMemoryFileSystem} from "virtual-bash";\nconst fs=createMemoryFileSystem();\n' + text + '\nawait shell.dispose();\n';
    if (number === 7) text = 'import {Shell,agentCommands,createMemoryFileSystem} from "virtual-bash";\nconst shell=new Shell({fs:createMemoryFileSystem()}).use(agentCommands());\n' + text + '\nawait shell.dispose();\n';
    if (number === 11) role = 'strict SafeJS injection factory types only; no guest or private engine executed';
    if (number === 12) role = 'strict original HTML example; contextual runtime substitutes explicit mock transport';
    const name = `example-${number}.mts`;
    save(join(consumer, name), text);
    files.push(name);
    report.examples.push({number, line: readme.slice(0, match.index).split('\n').length,
      snippetSha256: sha(match[1]), stagedSha256: sha(text), role});
    if (expectedLogs.has(number)) standalone.push({number, expected: expectedLogs.get(number)});
  }
  save(join(consumer, 'docs-runtime.mjs'), `import assert from 'node:assert/strict';\nimport test from 'node:test';\nconst before={...process.env};\nfor(const row of ${JSON.stringify(standalone)}) await test('exact README TypeScript example '+row.number,async()=>{const logs=[];const original=console.log;try{console.log=(...values)=>logs.push(values);await import('./emitted/example-'+row.number+'.mjs');}finally{console.log=original;}assert.deepEqual(logs,row.expected);assert.deepEqual({...process.env},before);});\n`);
  save(join(consumer, 'run.mjs'), "await import('./docs-runtime.mjs');\nawait import('./emitted/workflows.mjs');\n");
  const compiler = join(consumer, 'node_modules/typescript/bin/tsc');
  const flags = ['--strict', '--exactOptionalPropertyTypes', '--noUncheckedIndexedAccess', '--module', 'NodeNext', '--moduleResolution', 'NodeNext', '--target', 'ES2023', '--lib', 'ES2023', '--types', 'node', '--outDir', 'emitted'];
  requireSuccess(run('strict-public-types', node22, [compiler, ...flags, ...files, 'workflows.mts']));
  const before = await capture(consumer);
  for (const executable of [node22, node24]) {
    const version = executable === node22 ? '22' : '24';
    const permission = [executable === node22 ? '--experimental-permission' : '--permission', `--allow-fs-read=${consumer}`, '--allow-worker', '--unhandled-rejections=strict'];
    requireSuccess(run('readme-' + version, executable, [...permission, '--import', './no-network.mjs', '--test-reporter=tap', 'run.mjs']));
    const fence = run('source-denial-' + version, executable, [...permission, '--input-type=module', '-e', `import{readFileSync}from'node:fs';readFileSync(${JSON.stringify(join(repo, 'src/index.ts'))});`]);
    assert.equal(fence.status, 1);
    assert.match(fence.stderr, /ERR_ACCESS_DENIED/);
    requireSuccess(run('network-trap-control-' + version, executable, [...permission, '--import', './no-network.mjs', '--input-type=module', '-e', "import assert from'node:assert/strict';import https from'node:https';import net from'node:net';for(const action of [()=>https.request('https://docs.example.test'),()=>net.connect(443,'docs.example.test'),()=>fetch('https://docs.example.test')])assert.throws(action,/DOC_SMOKE_EXTERNAL_NETWORK_FORBIDDEN/);console.log('3 traps, no socket opened');"]));
  }
  assert.deepEqual(compare(before, await capture(consumer)), []);
  assert.deepEqual(compare(packageBefore, await capture(packageRoot)), []);
  assert.equal(sha(readFileSync(tarball)), packageSha256);
  assert.equal(sha(readFileSync(join(repo, 'README.md'))), report.readmeSha256);
  assert.equal((await directoryIdentity(join(repo, 'node_modules'))).sha256, report.dependencies.sha256);
  for (const row of report.commands.filter(row => row.accounting)) {
    assert.equal(row.accounting.reconciled, true);
    assert.deepEqual(row.accounting.counts, {pass: 15, fail: 0, skipped: 0, todo: 0, cancelled: 0});
  }
  report.immutable = true;
  report.status = 'SCOPED_README_SMOKE_PASS';
} catch (error) {
  report.status = 'FAIL';
  report.error = error.stack;
  process.exitCode = 1;
} finally {
  report.finishedAt = new Date().toISOString();
  save(join(root, 'REPORT.json'), report);
  console.log(JSON.stringify({root, candidate, packageSha256, readmeSha256: report.readmeSha256, status: report.status,
    commands: report.commands.map(({label, status, accounting}) => ({label, status, counts: accounting?.counts})), error: report.error}));
}
