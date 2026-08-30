import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { regular, put, sha, objectHash, census } from './common.mjs';
import { inspectData } from './data.mjs';
import { controller } from '../../../shell/indexed-arrays-independent-20260828/s06-successor-v1/preparation-v4/controller.mjs';
import { deadline } from '../../../shell/indexed-arrays-independent-20260828/s06-successor-v1/preparation-v4/deadline.mjs';
const here = path.dirname(fileURLToPath(import.meta.url)), repo = path.resolve(here, '../../../..');
let budget, report, clock; const apps = [];
try {
  const [expected] = process.argv.slice(2), bytes = regular(path.join(here, 'CONTINUATION-SEAL.json')); assert.equal(sha(bytes), expected); const continuation = JSON.parse(bytes);
  clock = deadline(Math.min(1200000, Math.max(1, continuation.absoluteDeadlineEpochMs - Date.now())));
  assert.ok(Date.now() < continuation.absoluteDeadlineEpochMs);
  const sealBytes = regular(path.join(here, 'SEAL.json')); assert.equal(sha(sealBytes), continuation.originalSealSha256); const seal = JSON.parse(sealBytes);
  const integrity = () => {
    clock.check('binding-start'); assert.ok(Date.now() < continuation.absoluteDeadlineEpochMs); assert.equal(sha(regular(seal.node.path)), seal.node.sha256);
    for (const row of [...seal.files.filter(row => row.path !== continuation.corrected.path), ...seal.executableRoles, ...continuation.roles]) { const filename = path.join(repo, row.path), content = regular(filename); assert.equal(sha(content), row.sha256, row.path); assert.equal(content.length, row.bytes); assert.equal(fs.statSync(filename).mode & 0o777, row.mode); }
    assert.deepEqual(census(seal.protectedAuthor.root), seal.protectedAuthor.entries); for (const tree of apps) assert.deepEqual(census(tree.root), tree.entries); clock.check('binding-end');
  };
  integrity(); const work = path.join(here, 'RUN-P16-DATA-CONTINUATION-01'); assert.equal(fs.existsSync(work), false); fs.mkdirSync(work);
  report = { scope: 'versioned historical-document correction; first pure-helper execution; no run02', work, continuationSeal: expected, originalAttempt: 'preserved exit78', complete: false, unsafeStop: false, phases: [] };
  budget = controller(work, { ...seal.policy, maxGitChildren: 0, maxOtherSupervisedChildren: 1 }, { node: { path: seal.node.path }, git: { path: seal.git.path } }, integrity, clock);
  for (const name of ['records','app','home','tmp']) { fs.mkdirSync(path.join(work, name)); budget.registerStorage(name, path.join(work, name), seal.policy.maxWorkingBytes); }
  const oldRecordBytes = regular(path.join(repo, continuation.oldChild.path)); assert.equal(sha(oldRecordBytes), continuation.oldChild.sha256); const oldChild = JSON.parse(oldRecordBytes); assert.equal(oldChild.code, 0); assert.equal(oldChild.closeObserved, true); assert.equal(oldChild.groupAbsent, true);
  const captured = Buffer.from(oldChild.stdout); let offset = 0; const authenticated = [];
  const binding = JSON.parse(regular(path.join(repo, seal.author, 'BINDINGS.json'))).authoritativePriority;
  assert.equal(binding.commit + ':' + binding.path, continuation.corrected.expression); assert.equal(binding.sha256, continuation.corrected.sha256);
  for (const original of seal.requests) {
    const request = original.expression === continuation.corrected.expression ? { ...original, bytes: continuation.corrected.bytes, sha256: continuation.corrected.sha256 } : original;
    const end = captured.indexOf(10, offset), header = /^([a-f0-9]{40}) blob ([0-9]+)$/.exec(captured.subarray(offset, end).toString()); assert.ok(header);
    const length = Number(header[2]), content = captured.subarray(end + 1, end + 1 + length); assert.equal(captured[end + 1 + length], 10); offset = end + 2 + length;
    assert.equal(objectHash('blob', content), header[1]); assert.equal(content.length, request.bytes); assert.equal(sha(content), request.sha256, request.expression); authenticated.push({ expression: request.expression, oid: header[1], bytes: content.length, sha256: sha(content), role: request.category });
  }
  assert.equal(offset, captured.length); await budget.record('AUTHENTICATION', { rows: authenticated, newGitChildren: 0, correction: continuation.corrected, originalResultChanged: false });
  const author = path.join(repo, seal.author), data = inspectData(repo, author);
  await budget.record('DATA', { rows: data.rows, details: data.details, passed: data.passed, total: data.total, allPassed: data.allPassed }); report.phases.push({ name: 'DATA', passed: data.passed, total: data.total }); budget.ordinary('DATA', data.allPassed);
  assert.ok(data.rows.filter(row => /^(?:D01|D02|D03|D04|D11|D12|D15|D16)-/.test(row.id)).every(row => row.passed), 'DATA_AUTHORITY_STOP');
  const app = path.join(work, 'app'); for (const name of ['stage-helper.mjs','qualify-data.mjs']) put(path.join(app, name), regular(path.join(author, name)));
  for (const name of ['bootstrap.mjs','worker.mjs']) put(path.join(app, name), regular(path.join(here, name))); put(path.join(app, 'INPUT.json'), Buffer.from(JSON.stringify(data.workerInput) + '\n'));
  const tree = { root: app, entries: census(app) }; apps.push(tree);
  const modules = Object.fromEntries(Object.entries(tree.entries).filter(([name]) => name.endsWith('.mjs')).map(([name, row]) => [path.join(app, name), row]));
  const manifest = await budget.record('MODULES', { node: seal.node, entry: path.join(app, 'worker.mjs'), modules, builtins: ['node:assert/strict','node:fs','node:vm'] });
  const child = await budget.child('product', seal.node.path, ['--permission','--allow-fs-read=' + app,'--allow-fs-read=' + manifest.path,'--allow-fs-read=' + seal.node.path,path.join(app, 'bootstrap.mjs'),manifest.path,manifest.sha256], { cwd: app, env: { PATH:'',HOME:path.join(work,'home'),TMPDIR:path.join(work,'tmp'),LC_ALL:'C',TZ:'UTC' }, timeoutMs:120000,maxBytes:16*1024*1024 });
  const parsed = child.stdout.split('\n').filter(Boolean).map(line => JSON.parse(line)), summaries = parsed.filter(row => row.kind === 'summary'), originals = parsed.filter(row => row.kind === 'original'), observations = parsed.filter(row => row.kind === 'independent'), loads = parsed.filter(row => row.kind === 'load');
  assert.equal(summaries.length, 1); assert.equal(originals.length, 1); assert.equal(child.stderr, ''); assert.deepEqual(summaries[0].originalCounts, [9,7,5]); assert.equal(summaries[0].independent, 22); assert.equal(observations.length, 22); assert.deepEqual(loads.map(row => path.basename(row.path)).sort(), ['qualify-data.mjs','stage-helper.mjs','worker.mjs']); assert.equal(child.code, summaries[0].pass ? 0 : 1); assert.equal(summaries[0].workerStarts, 0); assert.equal(summaries[0].supervisorImports, 0);
  await budget.record('SYNTHETIC', { original: originals[0], independent: observations, summary: summaries[0], loads }); budget.ordinary('synthetic', summaries[0].pass); report.phases.push({ name:'synthetic',original:[9,7,5],independent:22,passed:summaries[0].passed,pass:summaries[0].pass }); report.details = data.details; report.complete = true;
} catch (reason) { if (report) { report.unsafeStop = true; report.error = String(reason?.stack ?? reason); } else { console.error(String(reason?.stack ?? reason)); process.exitCode = 78; } }
finally {
  if (budget && report) try {
    const terminal = await budget.finalize(report, () => ({ finalCensuses: ['app','home','tmp'].map(name => ({ root:path.join(report.work,name),entries:census(path.join(report.work,name)) })) }), value => new Promise((resolve,reject)=>process.stdout.write(JSON.stringify(value)+'\n',error=>error?reject(error):resolve()))); clock.check('exit'); process.exitCode = terminal.unsafeStop ? 78 : terminal.accepted ? 0 : 1;
  } catch (reason) { console.error(String(reason?.stack ?? reason)); process.exitCode = 78; }
}
