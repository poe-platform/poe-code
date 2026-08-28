import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { regular, put, sha, objectHash, census } from './common.mjs';
import { inspectData } from './data.mjs';
import { controller } from '../../../shell/indexed-arrays-independent-20260828/s06-successor-v1/preparation-v4/controller.mjs';
import { deadline } from '../../../shell/indexed-arrays-independent-20260828/s06-successor-v1/preparation-v4/deadline.mjs';
const here = path.dirname(fileURLToPath(import.meta.url)), repo = path.resolve(here, '../../../..'), clock = deadline(1200000);
let budget, report; const appTrees = []; let inputError;
try {
  const [expected, label] = process.argv.slice(2), sealBytes = regular(path.join(here, 'SEAL.json')); assert.equal(sha(sealBytes), expected); const seal = JSON.parse(sealBytes); assert.equal(label, seal.label); assert.equal(process.execPath, seal.node.path);
  const integrity = () => {
    clock.check('integrity-start'); for (const tool of [seal.node, seal.git, seal.ps]) assert.equal(sha(regular(tool.path)), tool.sha256);
    for (const row of [...seal.files, ...seal.executableRoles]) { const filename = path.join(repo, row.path), bytes = regular(filename); assert.equal(sha(bytes), row.sha256, row.path); assert.equal(bytes.length, row.bytes); assert.equal(fs.statSync(filename).mode & 0o777, row.mode); }
    assert.deepEqual(census(seal.protectedAuthor.root), seal.protectedAuthor.entries);
    for (const tree of appTrees) assert.deepEqual(census(tree.root), tree.entries); clock.check('integrity-finish');
  };
  integrity(); const work = path.join(here, 'RUN-' + label); assert.equal(fs.existsSync(work), false); fs.mkdirSync(work);
  report = { scope: 'pure P16 CODE/DATA/synthetic only; no run02', work, sealSha256: expected, complete: false, unsafeStop: false, phases: [] };
  const gitInput = Buffer.from(seal.requests.map(row => row.expression + '\n').join(''));
  budget = controller(work, seal.policy, { node: { path: seal.node.path }, git: { path: seal.git.path } }, integrity, clock, { supervisorHooks: {
    spawn(executable, args, options) { if (executable === seal.git.path) { assert.deepEqual(args, seal.git.args); return spawn(executable, args, { ...options, stdio: ['pipe','pipe','pipe'] }); } return spawn(executable, args, options); },
    afterSpawn(owner) { if (owner.role === 'git') { owner.child.stdin.on('error', reason => { inputError = reason; }); owner.child.stdin.end(gitInput); } },
  } });
  for (const name of ['records','app','home','tmp']) { fs.mkdirSync(path.join(work, name)); budget.registerStorage(name, path.join(work, name), seal.policy.maxWorkingBytes); }
  const environment = { PATH: '', HOME: path.join(work, 'home'), TMPDIR: path.join(work, 'tmp'), LC_ALL: 'C', TZ: 'UTC', GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: '/dev/null', GIT_OPTIONAL_LOCKS: '0' };
  const git = await budget.child('git', seal.git.path, seal.git.args, { cwd: repo, env: environment, timeoutMs: 60000, maxBytes: 32 * 1024 * 1024 });
  assert.equal(inputError, undefined); assert.equal(git.code, 0); assert.equal(git.stderr, '');
  const bytes = Buffer.from(git.stdout), authenticated = []; let offset = 0;
  for (const request of seal.requests) {
    assert.match(request.expression, /^[a-f0-9]{40}:[^\0\r\n]+$/);
    const end = bytes.indexOf(10, offset), header = /^([a-f0-9]{40}) blob ([0-9]+)$/.exec(bytes.subarray(offset, end).toString()); assert.ok(header, request.expression);
    const length = Number(header[2]), content = bytes.subarray(end + 1, end + 1 + length); assert.equal(content.length, length); assert.equal(bytes[end + 1 + length], 10); offset = end + 2 + length;
    assert.equal(objectHash('blob', content), header[1]); assert.equal(content.length, request.bytes); assert.equal(sha(content), request.sha256, request.expression); authenticated.push({ ...request, oid: header[1] });
  }
  assert.equal(offset, bytes.length); await budget.record('AUTHENTICATION', { rows: authenticated, storedRequests: authenticated.length, gitPid: git.pid, rawReceiptPersistedBeforeParse: true, nullRolesRequested: 0, derivedObjectRequested: false, gitDescendants: 'no surviving process group; no continuous transient descendant census; disable flags are not a census' });
  const author = path.join(repo, seal.author), data = inspectData(repo, author);
  await budget.record('DATA', { rows: data.rows, details: data.details, passed: data.passed, total: data.total, allPassed: data.allPassed }); report.phases.push({ name: 'DATA', passed: data.passed, total: data.total }); budget.ordinary('DATA', data.allPassed);
  assert.ok(data.rows.filter(row => /^(?:D01|D02|D03|D04|D11|D12|D15|D16)-/.test(row.id)).every(row => row.passed), 'DATA_AUTHORITY_STOP');
  const app = path.join(work, 'app');
  for (const name of ['stage-helper.mjs','qualify-data.mjs']) put(path.join(app, name), regular(path.join(author, name)));
  for (const name of ['bootstrap.mjs','worker.mjs']) put(path.join(app, name), regular(path.join(here, name)));
  put(path.join(app, 'INPUT.json'), Buffer.from(JSON.stringify(data.workerInput) + '\n'));
  const tree = { root: app, entries: census(app) }; appTrees.push(tree);
  const modules = Object.fromEntries(Object.entries(tree.entries).filter(([name]) => name.endsWith('.mjs')).map(([name, binding]) => [path.join(app, name), binding]));
  const manifest = await budget.record('MODULES', { node: seal.node, entry: path.join(app, 'worker.mjs'), modules, builtins: ['node:assert/strict','node:fs','node:vm'] });
  const synthetic = await budget.child('product', seal.node.path, ['--permission','--allow-fs-read=' + app,'--allow-fs-read=' + manifest.path,'--allow-fs-read=' + seal.node.path,path.join(app, 'bootstrap.mjs'),manifest.path,manifest.sha256], { cwd: app, env: environment, timeoutMs: 120000, maxBytes: 16 * 1024 * 1024 });
  const parsed = synthetic.stdout.split('\n').filter(Boolean).map(line => JSON.parse(line)), summaries = parsed.filter(row => row.kind === 'summary'), original = parsed.filter(row => row.kind === 'original'), observations = parsed.filter(row => row.kind === 'independent'), loads = parsed.filter(row => row.kind === 'load');
  assert.equal(summaries.length, 1); assert.equal(original.length, 1); assert.equal(synthetic.stderr, ''); assert.deepEqual(summaries[0].originalCounts, [9,7,5]); assert.equal(summaries[0].independent, 22); assert.equal(observations.length, 22); assert.equal(loads.length, 3); assert.deepEqual(loads.map(row => path.basename(row.path)).sort(), ['qualify-data.mjs','stage-helper.mjs','worker.mjs']);
  assert.equal(synthetic.code, summaries[0].pass ? 0 : 1, 'late nonzero/all-PASS is not acceptance'); assert.equal(summaries[0].workerStarts, 0); assert.equal(summaries[0].supervisorImports, 0);
  await budget.record('SYNTHETIC', { original: original[0], independent: observations, summary: summaries[0], loads }); budget.ordinary('synthetic', summaries[0].pass); report.phases.push({ name: 'synthetic', original: summaries[0].originalCounts, independent: 22, pass: summaries[0].pass });
  report.details = data.details; report.complete = true;
} catch (reason) { if (report) { report.unsafeStop = true; report.error = String(reason?.stack ?? reason); } else { console.error(String(reason?.stack ?? reason)); process.exitCode = 78; } }
finally {
  if (budget && report) try {
    const terminal = await budget.finalize(report, () => ({ finalCensuses: ['app','home','tmp'].map(name => ({ root: path.join(report.work, name), entries: census(path.join(report.work, name)) })), processQualification: 'two direct children planned; serial owned process groups, no Worker/product; ps snapshots not dispatched; no OS-global/transient descendant census' }), value => new Promise((resolve, reject) => process.stdout.write(JSON.stringify(value) + '\n', error => error ? reject(error) : resolve())));
    clock.check('outer-exit'); process.exitCode = terminal.unsafeStop ? 78 : terminal.accepted ? 0 : 1;
  } catch (reason) { console.error(String(reason?.stack ?? reason)); process.exitCode = 78; }
}
