import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { regular, put, sha, copy, census, verify } from '../common.mjs';
import { here, parent, repo, oldWork, role, rolesIntact, bindRetained, workers, read } from './binding.mjs';
import { controller } from '../../../shell/indexed-arrays-independent-20260828/s06-successor-v1/preparation-v4/controller.mjs';
import { deadline } from '../../../shell/indexed-arrays-independent-20260828/s06-successor-v1/preparation-v4/deadline.mjs';

const clock = deadline(300000);
let budget, report;
const immutable = [];
try {
  const [expected, label] = process.argv.slice(2);
  const sealBytes = regular(path.join(here, 'SEAL.json'));
  assert.equal(sha(sealBytes), expected);
  const seal = JSON.parse(sealBytes);
  assert.equal(label, seal.label);
  const integrity = () => { clock.check('integrity'); rolesIntact(seal.roles); assert.equal(sha(regular(seal.node.origin)), seal.node.sha256); for (const tree of immutable) verify(tree); clock.check('integrity-finished'); };
  integrity();
  assert.equal(process.execPath, seal.node.origin);
  assert.equal(process.version, seal.node.version);
  const bound = bindRetained();
  clock.check('initial-retained-admission');
  const fixture = workers();
  assert.equal(sha(fixture.corrected), seal.correctedWorkerSha256);
  assert.equal(sha(fixture.original), seal.originalWorkerSha256);
  const work = path.join(here, 'RUN-' + label);
  assert.equal(fs.existsSync(work), false);
  fs.mkdirSync(work);
  report = { candidate: seal.candidate, packageSha256: seal.packageSha256, seal: expected, work, phases: [], complete: false, unsafeStop: false };
  budget = controller(work, seal.policy, { node: { path: seal.node.origin }, git: { path: '/Library/Developer/CommandLineTools/usr/bin/git' } }, integrity, clock);
  for (const name of ['records', 'apps', 'home', 'tmp']) { fs.mkdirSync(path.join(work, name)); budget.registerStorage(name, path.join(work, name), name === 'records' ? seal.policy.maxPersistedEvidenceBytes : seal.policy.maxWorkingBytes); }
  function makeApp(name, origin, corrected) {
    const app = path.join(work, 'apps', name);
    fs.mkdirSync(app);
    put(path.join(app, 'package.json'), '{"private":true,"type":"module"}\n');
    copy(path.join(oldWork, 'apps', origin, 'node_modules/virtual-bash'), path.join(app, 'node_modules/virtual-bash'));
    put(path.join(app, 'worker.mjs'), corrected ? fixture.corrected : fixture.original);
    put(path.join(app, 'CASES-independent.json'), regular(path.join(parent, 'CASES.json')));
    return app;
  }
  let serial = 0;
  async function execute(label, app, negative = false) {
    const tree = { root: app, entries: census(app) };
    const files = Object.fromEntries(Object.entries(tree.entries).filter(([, row]) => !row.directory).map(([name, row]) => [path.join(app, name), row]));
    const product = path.join(app, 'node_modules/virtual-bash');
    assert.deepEqual(Object.fromEntries(Object.entries(census(product)).filter(([, row]) => !row.directory)), bound.auth.packageEntries);
    const manifest = { node: { path: seal.node.origin, sha256: seal.node.sha256 }, product, trees: [tree], files };
    const receipt = await budget.record('manifest-' + ++serial, manifest);
    immutable.push(tree);
    const child = await budget.child('product', seal.node.origin, ['--permission', '--allow-fs-read=' + app, '--allow-fs-read=' + receipt.path, '--allow-fs-read=' + seal.node.origin, path.join(app, 'worker.mjs'), receipt.path, receipt.sha256, 'literal', '["F11"]'], { cwd: app, env: { PATH: '', HOME: path.join(work, 'home'), TMPDIR: path.join(work, 'tmp'), LC_ALL: 'C', TZ: 'UTC' }, timeoutMs: 30000, maxBytes: 2 * 1024 * 1024 });
    const rows = child.stdout.split('\n').filter(Boolean).map(line => JSON.parse(line));
    const summaries = rows.filter(row => row.summary);
    const observations = rows.filter(row => row.observation).map(row => row.observation);
    assert.equal(summaries.length, 1);
    assert.equal(observations.length, 1);
    const observation = observations[0];
    assert.equal(observation.id, 'F11');
    assert.equal(observation.disposed, true);
    assert.equal(summaries[0].summary.cases, 1);
    assert.equal(summaries[0].summary.disposed, 1);
    assert.equal(summaries[0].summary.pass, observation.pass ? 1 : 0);
    assert.equal(child.code, observation.pass ? 0 : 1);
    assert.ok(!rows.some(row => row.diagnostic || row.unsafeCleanup));
    const loads = rows.filter(row => row.load).map(row => row.load);
    assert.ok(loads.some(row => row.path === path.join(product, 'dist/index.js')));
    for (const load of loads) assert.equal(load.sha256, files[load.path].sha256);
    const actual = observation.actual;
    const accepted = negative ? !observation.pass && child.code === fixture.delta.negative.workerExitCode && actual.stdout === fixture.delta.negative.stdout && actual.stderr === fixture.delta.negative.stderr && actual.exitCode === fixture.delta.negative.exitCode : observation.pass;
    await budget.record('body-' + serial, { label, negative, accepted, observation, summary: summaries[0].summary, loads, childCode: child.code });
    report.phases.push({ label, accepted, negative, actual: { stdout: actual.stdout, stderr: actual.stderr, exitCode: actual.exitCode } });
    budget.ordinary(label, accepted);
    immutable.pop();
    verify(tree);
    return tree;
  }
  const source = makeApp('source-build', 'source-build', true);
  immutable.push(await execute('source-build-F11-v2', source));
  const negative = makeApp('original-missing-parent', 'source-build', false);
  immutable.push(await execute('source-build-original-missing-parent', negative, true));
  const installed = makeApp('installed', 'moved', true);
  const beforeMove = await execute('installed-F11-v2', installed);
  const moved = path.join(work, 'apps/moved');
  fs.renameSync(installed, moved);
  assert.equal(fs.existsSync(installed), false);
  assert.deepEqual(census(moved), beforeMove.entries);
  immutable.push(await execute('moved-F11-v2', moved));
  bindRetained();
  clock.check('final-retained-admission');
  assert.deepEqual(report.phases.map(row => row.label), seal.expectedRows);
  assert.equal(budget.children.length, seal.expectedChildren);
  report.retainedOriginalArchives = 109;
  report.retainedSourceInputs = 272;
  report.packageMembers = 874;
  report.physicalMove = { from: installed, to: moved, oldPathAbsent: true, censusEqual: true };
  report.complete = true;
} catch (reason) {
  if (report) { report.unsafeStop = true; report.error = String(reason?.stack ?? reason); }
  else { console.error(String(reason?.stack ?? reason)); process.exitCode = 78; }
} finally {
  if (budget && report) {
    try {
      const terminal = await budget.finalize(report, () => ({ finalCensuses: ['apps', 'home', 'tmp'].map(name => ({ root: path.join(report.work, name), entries: census(path.join(report.work, name)) })) }), value => new Promise((resolve, reject) => process.stdout.write(JSON.stringify(value) + '\n', error => error ? reject(error) : resolve())));
      clock.check('coordinator-exit');
      process.exitCode = terminal.unsafeStop ? 78 : terminal.accepted ? 0 : 1;
    } catch (reason) { console.error(String(reason?.stack ?? reason)); process.exitCode = 78; }
  }
}
