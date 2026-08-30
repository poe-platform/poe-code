import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { regular, put, sha, census, verify } from './common.mjs';
import { controller } from '../../../shell/indexed-arrays-independent-20260828/s06-successor-v1/preparation-v4/controller.mjs';
import { deadline } from '../../../shell/indexed-arrays-independent-20260828/s06-successor-v1/preparation-v4/deadline.mjs';
const here = path.dirname(fileURLToPath(import.meta.url)), repo = path.resolve(here, '../../../..'), clock = deadline(600000);
let budget, report; const apps = [];
try {
  const [expected, label] = process.argv.slice(2), sealBytes = regular(path.join(here, 'SEAL.json')); assert.equal(sha(sealBytes), expected);
  const seal = JSON.parse(sealBytes); assert.equal(label, seal.label); assert.equal(process.execPath, seal.node.path); assert.equal(process.version, seal.node.version);
  const integrity = () => { clock.check('integrity'); assert.equal(sha(regular(seal.node.path)), seal.node.sha256); for (const row of seal.roles) { const filename = path.join(repo, row.path); assert.equal(sha(regular(filename)), row.sha256); assert.equal(fs.lstatSync(filename).mode & 0o777, row.mode); } for (const tree of [...seal.protectedTrees, ...apps]) verify(tree); clock.check('integrity-complete'); };
  integrity(); const work = path.join(here, 'RUN-' + label); assert.equal(fs.existsSync(work), false); fs.mkdirSync(work);
  report = { scope: 'observer only, no candidate import or284-group run', seal: expected, work, phases: [], complete: false, unsafeStop: false };
  budget = controller(work, seal.policy, { node: { path: seal.node.path }, git: { path: '/Library/Developer/CommandLineTools/usr/bin/git' } }, integrity, clock);
  for (const name of ['records', 'app', 'home', 'tmp']) { fs.mkdirSync(path.join(work, name)); budget.registerStorage(name, path.join(work, name), seal.policy.maxWorkingBytes); }
  const app = path.join(work, 'app'), author = path.join(path.dirname(here), 'observer-qualification-v8');
  for (const name of seal.appNames) { const bytes = regular(path.join(author, name)); const binding = seal.bindings.find(row => row.path === path.relative(repo, path.join(author, name))); assert.equal(sha(bytes), binding.sha256); put(path.join(app, name), bytes); }
  for (const name of ['bootstrap.mjs', 'counter.mjs']) put(path.join(app, name), regular(path.join(here, name)));
  const tree = { root: app, entries: census(app) }; apps.push(tree);
  const files = Object.fromEntries(Object.entries(tree.entries).filter(([, row]) => !row.directory).map(([name, row]) => [path.join(app, name), row]));
  const manifest = { root: app, node: seal.node, files, builtins: ['node:assert/strict', 'node:fs/promises', 'node:zlib', 'node:crypto', 'node:events'] };
  const receipt = await budget.record('manifest', manifest);
  const controls = JSON.parse(regular(path.join(app, 'CONTROLS.json')));
  let serial = 0;
  for (const entry of seal.childEntries) {
    const child = await budget.child('product', seal.node.path, ['--permission', '--allow-fs-read=' + app, '--allow-fs-read=' + receipt.path, '--allow-fs-read=' + seal.node.path, path.join(app, 'bootstrap.mjs'), receipt.path, receipt.sha256, entry], { cwd: app, env: { PATH: '', UV_THREADPOOL_SIZE: '1', TZ: 'UTC', LC_ALL: 'C', HOME: path.join(work, 'home'), TMPDIR: path.join(work, 'tmp') }, timeoutMs: 60000, maxBytes: 4 * 1024 * 1024 });
    const rows = child.stdout.split('\n').filter(Boolean).map(line => JSON.parse(line));
    const original = entry === 'worker.mjs';
    const cases = rows.filter(row => row.kind === (original ? 'case' : 'independent'));
    const summaries = rows.filter(row => row.kind === (original ? 'summary' : 'independent-summary'));
    assert.equal(summaries.length, 1, 'mandatory completed child summary'); const summary = summaries[0];
    assert.equal(summary.executed, cases.length);
    const identifiers = original ? [...controls.real, ...controls.synthetic, ...controls.data].map(row => row.id) : ['I01-deferred-return', 'I02-cross-resource-reason', 'I03-falsy-cleanup-promise', 'I04-writer-promise-not-flags', 'I05-naive-iterator-hook'];
    assert.deepEqual(cases.map(row => row.id), identifiers.slice(0, cases.length));
    assert.ok(!cases.some(row => row.safety || row.cleanupFailure), 'observer cleanup/safety stop');
    if (original) { assert.equal(summary.syntheticTimersPending, 0); assert.equal(summary.childSpawns, 0); } else assert.equal(summary.notifications, 0);
    assert.equal(summary.candidateImports, 0);
    const accepted = cases.length === identifiers.length && cases.every(row => row.passed);
    assert.equal(child.code, accepted ? 0 : 1, 'actual exit agrees, not late nonzero-allPASS');
    const loads = rows.filter(row => row.kind === 'load'); assert.ok(loads.some(row => row.path === path.join(app, 'observer.mjs'))); assert.ok(loads.some(row => row.path === path.join(app, 'retirement.mjs')));
    await budget.record('observations-' + ++serial, { entry, accepted, cases, summary, loads }); report.phases.push({ entry, accepted, cases: cases.length, passed: cases.filter(row => row.passed).length }); budget.ordinary(entry, accepted);
  }
  assert.equal(budget.children.length, 2); report.complete = true;
} catch (reason) { if (report) { report.unsafeStop = true; report.error = String(reason?.stack ?? reason); } else { console.error(String(reason?.stack ?? reason)); process.exitCode = 78; } }
finally { if (budget && report) { try { const result = await budget.finalize(report, () => ({ finalCensuses: ['app', 'home', 'tmp'].map(name => ({ root: path.join(report.work, name), entries: census(path.join(report.work, name)) })) }), value => new Promise((resolve, reject) => process.stdout.write(JSON.stringify(value) + '\n', error => error ? reject(error) : resolve()))); clock.check('coordinator-exit'); process.exitCode = result.unsafeStop ? 78 : result.accepted ? 0 : 1; } catch (reason) { console.error(String(reason?.stack ?? reason)); process.exitCode = 78; } } }
