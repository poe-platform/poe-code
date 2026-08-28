import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { regular, put, sha, census, verify } from '../common.mjs';
import { controller } from '../../../../shell/indexed-arrays-independent-20260828/s06-successor-v1/preparation-v4/controller.mjs';
import { deadline } from '../../../../shell/indexed-arrays-independent-20260828/s06-successor-v1/preparation-v4/deadline.mjs';
const here = path.dirname(fileURLToPath(import.meta.url)), repo = path.resolve(here, '../../../../..'), parent = path.resolve(here, '../..'), clock = deadline(600000);
let budget, report; const immutableApps = [];
try {
  const [expected, label] = process.argv.slice(2), sealBytes = regular(path.join(here, 'SEAL.json')); assert.equal(sha(sealBytes), expected);
  const seal = JSON.parse(sealBytes); assert.equal(label, seal.label); assert.equal(process.execPath, seal.node.path); assert.equal(process.version, seal.node.version);
  const integrity = () => {
    clock.check('integrity-start'); assert.equal(sha(regular(seal.node.path)), seal.node.sha256);
    for (const row of [...seal.roles, ...seal.bindings]) { const filename = path.join(repo, row.path); const bytes = regular(filename); assert.equal(sha(bytes), row.sha256, filename); assert.equal(bytes.length, row.bytes); assert.equal(fs.lstatSync(filename).mode & 0o777, row.mode); }
    for (const tree of [...seal.protectedTrees, ...immutableApps]) verify(tree);
    const prior = census(seal.priorIndependent.root); for (const key of Object.keys(prior)) if (key.startsWith(seal.priorIndependent.excludedNewOwnedDirectory)) delete prior[key]; assert.deepEqual(prior, seal.priorIndependent.entries);
    clock.check('integrity-complete');
  };
  integrity(); const work = path.join(here, 'RUN-' + label); assert.equal(fs.existsSync(work), false); fs.mkdirSync(work);
  report = { scope: '12 original synthetic/DATA, four independent synthetic, same three instrumented pilot bodies; NOT284', seal: expected, work, phases: [], complete: false, unsafeStop: false, candidate: '9885390fb11454fa194a3e60fdbef198dbfdf633', package: seal.package };
  budget = controller(work, seal.policy, { node: { path: seal.node.path }, git: { path: '/Library/Developer/CommandLineTools/usr/bin/git' } }, integrity, clock);
  for (const name of ['records', 'apps', 'home', 'tmp']) { fs.mkdirSync(path.join(work, name)); budget.registerStorage(name, path.join(work, name), seal.policy.maxWorkingBytes); }
  const authorPilot = path.join(parent, 'adapter-pilot-v10'), originalManifest = JSON.parse(regular(path.join(authorPilot, 'RUN-01/MODULES.json')));
  const recipes = [
    { name: 'original-v9', source: path.join(parent, 'adapter-v9'), names: seal.v9Names, entry: 'worker.mjs', mode: 'synthetic', ids: ['T01','T02','T03','T04','T05','T06','T07','T08','T09','T10','D01','D02'] },
    { name: 'independent-v10', source: authorPilot, names: ['adapter.mjs'], entry: 'counter.mjs', mode: 'synthetic', ids: ['I01-throw-forward-cleanup','I02-required-joins','I03-context-cleanup-isolation','I04-overflow-still-forwards'] },
    { name: 'pilot-v10', source: authorPilot, names: seal.pilotNames, entry: 'worker.mjs', mode: 'pilot', ids: ['A57','A60','H09'] },
  ];
  for (const recipe of recipes) {
    const app = path.join(work, 'apps', recipe.name); fs.mkdirSync(app);
    for (const name of recipe.names) put(path.join(app, name), regular(path.join(recipe.source, name)));
    put(path.join(app, 'independent-bootstrap.mjs'), regular(path.join(here, 'bootstrap.mjs')));
    if (recipe.name === 'independent-v10') put(path.join(app, 'counter.mjs'), regular(path.join(here, 'counter.mjs')));
    if (recipe.mode === 'pilot') for (const row of originalManifest.files.filter(row => row.path.startsWith(authorPilot + '/RUN-01/app/dist/'))) put(path.join(app, path.relative(authorPilot, row.path)), regular(row.path));
    const tree = { root: app, entries: census(app) }; immutableApps.push(tree);
    const files = Object.fromEntries(Object.entries(tree.entries).filter(([, row]) => !row.directory).map(([name, row]) => {
      const original = originalManifest.files.find(member => member.path === path.join(authorPilot, name));
      return [path.join(app, name), { ...row, role: original?.role ?? 'independent-or-v9-harness-data' }];
    }));
    const builtins = recipe.mode === 'pilot' ? JSON.parse(regular(path.join(authorPilot, 'PRESEAL.json'))).allowedBuiltins : ['node:assert/strict','node:crypto','node:events','node:fs'];
    const manifest = await budget.record('manifest-' + recipe.name, { root: app, node: seal.node, files, builtins });
    const child = await budget.child('product', seal.node.path, ['--permission', '--allow-fs-read=' + app, '--allow-fs-read=' + manifest.path, '--allow-fs-read=' + seal.node.path, path.join(app, 'independent-bootstrap.mjs'), manifest.path, manifest.sha256, recipe.entry, recipe.mode], { cwd: app, env: { PATH: '', UV_THREADPOOL_SIZE: '1', TZ: 'UTC', LC_ALL: 'C', HOME: path.join(work, 'home'), TMPDIR: path.join(work, 'tmp') }, timeoutMs: 120000, maxBytes: 16 * 1024 * 1024 });
    const rows = child.stdout.split('\n').filter(Boolean).map(line => JSON.parse(line));
    const births = rows.filter(row => row.kind === 'independent-birth'); assert.equal(births.length, 1); assert.equal(births[0].pid, child.pid); assert.equal(births[0].ppid, process.pid); assert.equal(births[0].execPath, seal.node.path);
    const cases = rows.filter(row => row.kind === 'case'), summaries = rows.filter(row => row.kind === 'summary'); assert.equal(summaries.length, 1, 'mandatory summary after cleanup');
    const summary = summaries[0]; assert.equal(summary.executed, cases.length); assert.deepEqual(cases.map(row => row.id), recipe.ids.slice(0, cases.length));
    assert.ok(!summary.stopped && !cases.some(row => row.safety || row.hasCleanupFailure || row.cleanupError || row.cleanupFailure), 'safety or unknown cleanup stops dependents');
    const accepted = cases.length === recipe.ids.length && cases.every(row => row.passed); assert.equal(child.code, accepted ? 0 : 1, 'actual child status agrees with assertions, never all-PASS/nonzero acceptance'); assert.equal(child.stderr, '');
    const loads = rows.filter(row => row.kind === 'independent-load'); assert.ok(loads.some(row => row.path === path.join(app, 'adapter.mjs')));
    if (recipe.mode === 'pilot') {
      assert.equal(loads.length, 224); assert.equal(loads.filter(row => row.role === 'instrumented-emitted-module').length, 5); assert.equal(loads.filter(row => row.role === 'authenticated-original-emit').length, 215);
      assert.equal(summary.unmodifiedSemanticGroups, 0); assert.equal(summary.actualStreamInstances, 15);
      assert.deepEqual(cases.map(row => row.afterNotification.resources.length), [6,6,3]);
      for (const row of cases) {
        const events = row.afterNotification.events;
        for (const resource of row.afterNotification.resources) {
          const own = events.filter(event => event.subject === resource.streamId), start = own.find(event => event.event === 'writer-start'); assert.ok(start);
          assert.ok(own.some(event => event.event === 'writer-joined' && event.value === start.value)); assert.ok(own.some(event => event.event === 'codec-finalizer-joined')); assert.ok(own.some(event => event.event === 'acquire-close-joined')); assert.equal(resource.closeDelivered, true);
        }
      }
    }
    await budget.record('observations-' + recipe.name, { accepted, cases, summary, loads, builtins: rows.filter(row => row.kind === 'independent-builtin') });
    report.phases.push({ name: recipe.name, accepted, cases: cases.length, passed: cases.filter(row => row.passed).length, actualLoads: loads.length }); budget.ordinary(recipe.name, accepted);
  }
  assert.equal(budget.children.length, 3); report.complete = true;
} catch (reason) {
  if (report) { report.unsafeStop = true; report.error = String(reason?.stack ?? reason); }
  else { console.error(String(reason?.stack ?? reason)); process.exitCode = 78; }
} finally {
  if (budget && report) try {
    const terminal = await budget.finalize(report, () => ({ finalCensuses: ['apps','home','tmp'].map(name => ({ root: path.join(report.work, name), entries: census(path.join(report.work, name)) })) }), value => new Promise((resolve, reject) => process.stdout.write(JSON.stringify(value) + '\n', error => error ? reject(error) : resolve())));
    clock.check('coordinator-exit'); process.exitCode = terminal.unsafeStop ? 78 : terminal.accepted ? 0 : 1;
  } catch (reason) { console.error(String(reason?.stack ?? reason)); process.exitCode = 78; }
}
