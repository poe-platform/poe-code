import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { hash, inventory, read, save, toolInventory } from './common.mjs';

const own = dirname(fileURLToPath(import.meta.url)), capture = join(own, process.argv[2]), state = read(join(capture, 'state.json'));
const git = (...args) => execFileSync('git', ['--no-replace-objects', ...args], { cwd: resolve(own, '../../../..'), maxBuffer: 64 * 1024 * 1024 });
save(join(capture, 'FINAL-AUDIT-PRE.json'), { at: new Date().toISOString(), driver: hash(readFileSync(new URL(import.meta.url))), supervisor: hash(readFileSync(join(own, 'common.mjs'))), node: hash(readFileSync(process.execPath)) });
for (const [name, digest] of Object.entries(state.scriptsBefore)) assert.equal(hash(readFileSync(join(own, name))), digest, name);
for (const [binding, entry] of Object.entries(state.inputs)) { assert.equal(hash(git('show', binding)), entry.sha256); assert.equal(git('rev-parse', binding).toString().trim(), entry.blob); }
for (const [root, expected] of [[state.isolated, state.isolatedBefore], [state.installed, state.installedBefore], [state.legacy, state.legacyBefore], [state.author, state.authorBefore]]) assert.deepEqual(inventory(root), expected);
for (const name of ['typescript', '@types/node', 'undici-types']) assert.deepEqual(inventory(join(state.tools, 'node_modules', name)), state.toolchain[name].files);
assert.deepEqual(toolInventory(state.npmRoot), state.toolchain.npm.files);
assert.equal(hash(readFileSync(process.execPath)), state.toolchain.node.sha256);
assert.equal(hash(readFileSync(state.pandoc)), state.toolchain.pandoc.sha256);
for (const [path, digest] of Object.entries(state.compilerInputs)) {
  if (path.startsWith(state.build + '/')) assert.equal(digest, state.sourceBefore[path.slice(state.build.length + 1)]);
  else {
    let found = false;
    for (const name of ['typescript', '@types/node', 'undici-types']) {
      const prefix = join(state.tools, 'node_modules', name) + '/';
      if (path.startsWith(prefix)) { assert.equal(digest, state.toolchain[name].files[path.slice(prefix.length)]); found = true; }
    }
    assert(found, path);
  }
}
const receipts = []; let productLoads = 0, harnessLoads = 0;
function walk(directory) {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    if (directory === capture && entry.name === 'work') continue;
    const path = join(directory, entry.name);
    if (entry.isDirectory()) walk(path);
    else if (entry.name.endsWith('.receipt.json')) {
      const receipt = read(path), prefix = path.slice(0, -'.receipt.json'.length), pre = read(prefix + '.pre.json');
      for (const [suffix, digest] of [['.pre.json', receipt.preSHA256], ['.stdout', receipt.stdoutSHA256], ['.stderr', receipt.stderrSHA256]]) assert.equal(hash(readFileSync(prefix + suffix)), digest);
      assert.equal(pre.supervisorSHA256, state.scriptsBefore['common.mjs']);
      assert.equal(pre.executableSHA256, pre.executable === state.pandoc ? state.toolchain.pandoc.sha256 : state.toolchain.node.sha256);
      assert.equal(receipt.processGroupGone, true);
      if (receipt.killed) { assert.equal(receipt.id, 'busy-loop'); assert.equal(receipt.outcome, 'EXPECTED_SUPERVISOR_KILL'); }
      else assert.equal(receipt.signal, null);
      for (const load of receipt.loads) {
        const loaded = fileURLToPath(load.url);
        if (loaded.startsWith(state.isolated + '/dist/')) { assert.equal(load.sha256, state.isolatedBefore[loaded.slice(state.isolated.length + 1)]); productLoads++; }
        else if (loaded.startsWith(state.installed + '/dist/')) { assert.equal(load.sha256, state.installedBefore[loaded.slice(state.installed.length + 1)]); productLoads++; }
        else { assert(loaded.startsWith(state.consumer + '/')); assert.equal(hash(readFileSync(loaded)), load.sha256); harnessLoads++; }
      }
      receipts.push({ path: path.slice(capture.length + 1), id: receipt.id, outcome: receipt.outcome, killed: receipt.killed });
    }
  }
}
walk(capture);
const main = read(join(capture, 'RESULTS.json')), neighbors = read(join(capture, 'followup/RESULTS.json')), holdouts = read(join(capture, 'holdouts/RESULTS.json')), legacy = read(join(capture, 'legacy-ast-v2/RESULTS.json'));
const counts = rows => ({ total: rows.length, pass: rows.filter(row => row.outcome === 'PASS').length, fail: rows.filter(row => row.outcome === 'FAIL').length, intentionalKills: rows.filter(row => row.outcome === 'EXPECTED_SUPERVISOR_KILL').length });
const perLayout = {};
for (const layout of ['isolated', 'moved']) {
  const cohort = main.rows.filter(row => row.layout === layout);
  perLayout[layout] = { phases: Object.fromEntries([...new Set(cohort.map(row => row.phase))].map(phase => [phase, counts(cohort.filter(row => row.phase === phase))])), mainAST: counts(main.astRows.filter(row => row.layout === layout)), neighborsAST: counts(neighbors.ast.filter(row => row.layout === layout)), holdoutAST: counts(holdouts.ast.filter(row => row.layout === layout)), oldFiveAST: legacy.results.find(row => row.layout === layout).originalFive.rows.map(row => ({ id: row.id, outcome: row.outcome })) };
}
const inFlight = main.rows.filter(row => row.phase === 'in-flight-abort').map(row => ({ layout: row.layout, id: row.id, ...row.result.actual }));
const directScan = neighbors.rows.filter(row => row.id.startsWith('scan-abort-')).map(row => ({ layout: row.layout, id: row.id, ...row.result.actual }));
const normalization = holdouts.rows.filter(row => row.id === 'normalization-abort').map(row => ({ layout: row.layout, id: row.id, ...row.result.actual.observations[0] }));
for (const observation of [...inFlight, ...directScan, ...normalization]) { assert.equal(observation.reasonIdentity, true); assert(observation.settlementMs < 1000); }
save(join(capture, 'FINAL-AUDIT.json'), { at: new Date().toISOString(), source: state.source, freeze: state.freeze, packSHA256: state.packSHA256, independentPackSHA256: state.independentPackSHA256, sourceBindings: Object.keys(state.inputs).length, sourceFiles: state.productSourceFiles, compilerInputs: Object.keys(state.compilerInputs).length, preAndPostInventoriesIncludeNewEntries: true, receipts: counts(receipts), productLoads, harnessLoads, perLayout, mainFailures: main.rows.filter(row => row.outcome === 'FAIL').map(row => ({ layout: row.layout, phase: row.phase, id: row.id, actual: row.result?.actual })), holdoutFailures: holdouts.ast.filter(row => row.outcome === 'FAIL'), inFlight, directScan, normalization, actualReceipts: receipts });
console.log(JSON.stringify({ receipts: counts(receipts), productLoads, harnessLoads, neighborsAST: counts(neighbors.ast), holdoutAST: counts(holdouts.ast), exactReasonAborts: inFlight.length + directScan.length + normalization.length }));
