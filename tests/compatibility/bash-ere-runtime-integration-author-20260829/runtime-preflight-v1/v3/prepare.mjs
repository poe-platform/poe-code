import * as fs from 'node:fs';
import * as path from 'node:path';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { SourceTextModule } from 'node:vm';
const root = '/private/tmp/safe-bash-core70-v3-20260829';
const author = '/Users/kjopek/Workspace/safe-bash/tests/compatibility/bash-ere-runtime-integration-author-20260829';
const scope = author + '/runtime-preflight-v1/v3';
const phase = JSON.parse(fs.readFileSync(scope + '/START.json', 'utf8'));
assert.ok(Number.isSafeInteger(phase.deadlineMs) && Date.now() < phase.deadlineMs);
const bindings = [];
const read = file => {
  const stat = fs.lstatSync(file);
  assert.ok(stat.isFile() && !stat.isSymbolicLink() && stat.size <= 2097152);
  const bytes = fs.readFileSync(file);
  assert.equal(bytes.length, stat.size);
  bindings.push({ path: file, size: bytes.length, mode: stat.mode & 511, sha256: createHash('sha256').update(bytes).digest('hex') });
  return bytes;
};
const expected = read(scope + '/PREP-SHA256SUMS').toString().trimEnd().split('\n');
for (const line of expected) {
  const match = /^([a-f0-9]{64})  (.+)$/.exec(line);
  assert.ok(match);
  assert.equal(createHash('sha256').update(read(match[2])).digest('hex'), match[1]);
}
let cell = read(author + '/runtime-preflight-v1/cell.mjs').toString('utf8');
function replace(before, after) {
  assert.equal(cell.split(before).length, 2, 'exact one source anchor');
  cell = cell.replace(before, after);
}
replace("import { observeWorker } from './worker-observer.mjs';", "import { observeWorker } from './worker-observer.mjs';\nimport { h03Expansion, h06False, h08Fresh, eh04, eh05 } from './additions.mjs';");
replace("  } else if (definition.id === 'H08') {", "    await h06False({ shell, observer });\n  } else if (definition.id === 'H08') {");
replace("  } else if (definition.id === 'EH01' || definition.id === 'EH02') {", "    h08Fresh({ observer });\n  } else if (definition.id === 'EH04') {\n    await eh04({ shell, observer });\n  } else if (definition.id === 'EH05') {\n    await eh05({ shell, observer });\n  } else if (definition.id === 'EH01' || definition.id === 'EH02') {");
const cases = JSON.parse(read(author + '/runtime-preflight-v1/CASES.json'));
assert.equal(cases.rows.length, 70);
const originalIds = cases.rows.map(row => row.id);
for (const definition of cases.rows) {
  if (definition.id === 'H06') { definition.version = 'v3-standalone-false'; definition.workerStartsMaximum++; }
  if (definition.id === 'H08') definition.version = 'v3-fresh-allowance-equality';
  if (definition.id === 'H03') definition.approvedSubcases = [{ id: 'H03/public-expansion-limit', module: 'additions.mjs', export: 'h03Expansion', state: 'AUTHORED_UNRUN', call: 'await h03Expansion({ api, shell, observer })' }];
  if (definition.id === 'EH04' || definition.id === 'EH05') {
    definition.route = 'host'; definition.state = 'UNRUN'; definition.workerStartsMaximum = 3;
    definition.previousGate = definition.gate; delete definition.gate;
  }
  if (definition.id === 'EH01' || definition.id === 'EH02') definition.admissionHold = 'Original 33-group fixture expects private status3 but pinned syntax reports unsupported status2. Original input/expectation untouched; needs a genuine private-limit stimulus.';
}
assert.deepEqual(cases.rows.map(row => row.id), originalIds);
assert.equal(new Set(originalIds).size, 70);
cases.status = 'HOLD_65_WHOLE_BODIES_5_INCOMPLETE_2_ADDITIONAL_SOURCE_CONFLICTS_ALL_UNRUN';
fs.writeFileSync(scope + '/cell-v3.mjs', cell, { flag: 'wx' });
fs.writeFileSync(scope + '/CASES-v3.json', JSON.stringify(cases, null, 2) + '\n', { flag: 'wx' });
const syntax = [];
for (const [name, content] of [['cell-v3.mjs', cell], ['additions.mjs', read(scope + '/additions.mjs').toString('utf8')], ['prepare.mjs', read(scope + '/prepare.mjs').toString('utf8')]]) {
  try { new SourceTextModule(content, { identifier: scope + '/' + name }); syntax.push({ name, status: 'PASS', diagnostic: null }); }
  catch (error) { syntax.push({ name, status: 'FAIL', diagnostic: String(error) }); }
}
const controllerRoot = root + '/owner-controls';
fs.mkdirSync(controllerRoot, { mode: 0o700 });
for (const name of ['owner.mjs', 'harmless.mjs', 'controls.mjs', 'PRESEAL.md']) {
  const bytes = read(author + '/runtime-preflight-v1/v2/' + name);
  fs.writeFileSync(controllerRoot + '/' + name, bytes, { flag: 'wx', mode: 0o600 });
}
fs.writeFileSync(controllerRoot + '/START.json', read(scope + '/START.json'), { flag: 'wx', mode: 0o600 });
const sums = ['owner.mjs', 'harmless.mjs', 'controls.mjs', 'PRESEAL.md', 'START.json'].map(name => createHash('sha256').update(read(controllerRoot + '/' + name)).digest('hex') + '  ' + name + '\n').join('');
fs.writeFileSync(controllerRoot + '/SHA256SUMS', sums, { flag: 'wx', mode: 0o600 });
fs.writeFileSync(scope + '/OWNER-SHA256SUMS', sums, { flag: 'wx' });
const summary = { status: syntax.every(row => row.status === 'PASS') ? 'SOURCE_PREPARATION_HOLD' : 'SYNTAX_HOLD', pid: process.pid, syntax, topLevelIds: 70, layoutCells: 210, wholeBodies: 65, incomplete: ['H02', 'H03', 'H04', 'H05', 'H07'], sourceConflicts: ['EH01', 'EH02'], allRuntimeCells: 'UNRUN', bindings, controllerRoot, productImports: 0, workers: 0 };
fs.writeFileSync(scope + '/PREPARATION-RESULT.json', JSON.stringify(summary, null, 2) + '\n', { flag: 'wx' });
console.log(JSON.stringify({ status: summary.status, syntax, wholeBodies: 65, incomplete: summary.incomplete, sourceConflicts: summary.sourceConflicts }));
