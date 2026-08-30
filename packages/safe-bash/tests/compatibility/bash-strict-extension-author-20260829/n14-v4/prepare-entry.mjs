import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { gunzipSync } from 'node:zlib';
const own = path.dirname(fileURLToPath(import.meta.url)), prior = path.dirname(own), repo = path.resolve(own, '../../../..');
const relative = path.relative(repo, own), capture = path.join(own, 'bootstrap-output');
const log = fs.openSync(path.join(capture, 'prepare-events.jsonl'), 'wx');
const note = value => fs.writeSync(log, JSON.stringify(value) + '\n');
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const objectHash = (type, bytes) => createHash('sha1').update(`${type} ${bytes.length}\0`).update(bytes).digest('hex');
let sequence = 0;
function read(filename, maximum = 4194304) {
  const stat = fs.lstatSync(filename); assert.ok(stat.isFile() && !stat.isSymbolicLink() && stat.size <= maximum && !filename.split('/').includes('AGENTS.md'));
  return fs.readFileSync(filename);
}
function child(executable, args, input) {
  const prefix = path.join(capture, 'prepare-' + sequence++);
  const stdout = fs.openSync(prefix + '.stdout', 'wx'), stderr = fs.openSync(prefix + '.stderr', 'wx'); let result;
  try { result = spawnSync(executable, args, { cwd: repo, input, stdio: ['pipe', stdout, stderr], timeout: 30000 }); }
  finally { fs.closeSync(stdout); fs.closeSync(stderr); }
  note({ executable, args, pid: result.pid, status: result.status, signal: result.signal, prefix });
  assert.equal(result.error, undefined); assert.equal(result.signal, null); assert.equal(result.status, 0, prefix);
  return read(prefix + '.stdout', 8388608);
}
function writeJson(filename, value) { fs.writeFileSync(path.join(own, filename), JSON.stringify(value, null, 2) + '\n', { flag: 'wx' }); }
function addCode(files) {
  let patch = '*** Begin Patch\n';
  for (const [filename, text] of Object.entries(files)) { assert.equal(fs.existsSync(path.join(own, filename)), false); patch += '*** Add File: ' + path.join(own, filename) + '\n' + text.split('\n').map(line => '+' + line).join('\n') + '\n'; }
  patch += '*** End Patch\n';
  fs.writeFileSync(path.join(capture, 'generated-files.patch'), patch, { flag: 'wx' });
  child('/Users/kjopek/.codex/tmp/arg0/codex-arg0wITElD/apply_patch', [], patch);
}
try {
  note({ pid: process.pid, started: new Date().toISOString(), role: 'SOURCE_DATA_PRESEAL_ONLY' });
  assert.deepEqual(process.argv.slice(2), ['--prepare']);
  const sourceCommit = '7196bace8ea2c141d5ed1020fef5bf721c321ace';
  const before = read(path.join(prior, 'SOURCE.json'));
  assert.equal(sha(before), '9924773241f116d4cd5008fa7cd7f7fc3d95521f5e57b33299dbf2ed7cc2bf69');
  const base = JSON.parse(before); assert.equal(base.computedTree, '37e793ce6dce48a958030e7cc86fa8315d0b112e');
  const current = read(path.join(repo, 'src/shell/runtime.ts'));
  const original = base.inputs.find(row => row.path === 'src/shell/runtime.ts');
  const overlay = { ...original, blob: objectHash('blob', current), bytes: current.length, sha256: sha(current), revision: sourceCommit };
  const gitBytes = child('/usr/bin/git', ['cat-file', '--batch'], [sourceCommit + ':src/shell/runtime.ts', ...base.inputs.map(row => row.blob)].join('\n') + '\n');
  let cursor = 0;
  for (const row of [overlay, ...base.inputs]) {
    const end = gitBytes.indexOf(10, cursor); assert.equal(gitBytes.subarray(cursor, end).toString(), `${row.blob} blob ${row.bytes}`); cursor = end + 1;
    const bytes = gitBytes.subarray(cursor, cursor + row.bytes); cursor += row.bytes; assert.equal(gitBytes[cursor++], 10);
    assert.equal(sha(bytes), row.sha256); assert.equal(objectHash('blob', bytes), row.blob);
  }
  assert.equal(cursor, gitBytes.length);
  const trees = new Map(base.reconstructedTrees.map(row => [row.oid, Buffer.from(row.base64, 'base64')])), generated = [];
  function update(tree, parts) {
    const bytes = trees.get(tree); assert.ok(bytes); assert.equal(objectHash('tree', bytes), tree);
    const rows = []; let offset = 0;
    while (offset < bytes.length) { const space = bytes.indexOf(32, offset), zero = bytes.indexOf(0, space); rows.push({ mode: bytes.subarray(offset, space).toString(), name: bytes.subarray(space + 1, zero).toString(), oid: bytes.subarray(zero + 1, zero + 21).toString('hex') }); offset = zero + 21; }
    const row = rows.find(row => row.name === parts[0]); assert.ok(row);
    row.oid = parts.length === 1 ? overlay.blob : update(row.oid, parts.slice(1));
    const output = Buffer.concat(rows.flatMap(row => [Buffer.from(row.mode + ' ' + row.name + '\0'), Buffer.from(row.oid, 'hex')]));
    const oid = objectHash('tree', output); generated.push({ oid, base64: output.toString('base64') }); return oid;
  }
  const source = { ...base, role: 'N14_719_RUNTIME_ONLY_ON_9bb', base: base.computedTree, computedTree: update(base.computedTree, ['src', 'shell', 'runtime.ts']), sourceCommit, inputs: base.inputs.map(row => row.path === overlay.path ? overlay : row), overlay: [overlay], reconstructedTrees: generated, baseSourceSha256: sha(before) };
  const oldSeal = JSON.parse(read(path.join(prior, 'PRESEAL-v2.json'))), oldExecutor = JSON.parse(read(path.join(prior, 'EXECUTOR-v2.json')));
  for (const row of oldExecutor.files) { const bytes = read(path.join(repo, row.path)); assert.equal(bytes.length, row.bytes); assert.equal(sha(bytes), row.sha256, row.path); }
  const toolEvidence = read(path.join(repo, 'tests/integration/coherent78-shell-independent-20260828/RAW-v2.json.gz.base64'));
  assert.equal(sha(toolEvidence), oldSeal.baseEvidence);
  const tools = JSON.parse(gunzipSync(Buffer.from(toolEvidence.toString().trim(), 'base64'), { maxOutputLength: 67108864 })).tools;
  for (const name of ['typescript', '@types/node', 'undici-types', 'npm']) {
    const tool = tools[name]; assert.equal(sha(Buffer.from(JSON.stringify(tool.originalRows))), source.toolBindings[name].inventorySha256);
    for (const [relativePath, mode, size, digest] of tool.originalRows) {
      const filename = path.join(tool.origin, relativePath), stat = fs.lstatSync(filename);
      if (mode === 'SYMLINK') { assert.ok(stat.isSymbolicLink()); assert.equal(fs.readlinkSync(filename), size); assert.ok(fs.realpathSync(filename).startsWith(fs.realpathSync(tool.origin) + path.sep)); }
      else { assert.ok(stat.isFile() && !stat.isSymbolicLink()); assert.equal(stat.size, size); assert.equal(stat.mode & 0o777, mode); assert.equal(sha(fs.readFileSync(filename)), digest); }
    }
  }
  let runner = read(path.join(prior, 'run-v2.mjs')).toString().replaceAll('PRESEAL-v2.json', 'PRESEAL-v4.json').replaceAll('EXECUTOR-v2.json', 'EXECUTOR-v4.json').replaceAll('strict-extension-v2-author-', 'strict-n14-v4-author-');
  function replace(before, after) { assert.equal(runner.split(before).length, 2, before); runner = runner.replace(before, after); }
  replace('assert.equal(receipt.package.sha256, seal.expectedPackageSha256);', 'assert.equal(seal.expectedPackageSha256, null);');
  replace("'extension.mjs', 33", "'extension.mjs', 35");
  replace('  for (const [destination, from] of harnessMap)', "  harnessMap.push(['n14.mjs', '" + relative + "/n14.mjs']);\n  for (const [destination, from] of harnessMap)");
  replace("await layout('source', source);", "await layout('source', source); await cohort('source-n14', source, 'n14.mjs', 12);");
  replace("await layout('installed', installedRoot);", "await layout('installed', installedRoot); await cohort('installed-n14', installedRoot, 'n14.mjs', 12);");
  replace("await types('moved', movedRoot);", "await types('moved', movedRoot); await cohort('moved-n14', movedRoot, 'n14.mjs', 12);");
  replace('  const mutations = [', '  const mutations = [\n' + JSON.stringify({ id: 'n14-drop-provenance', file: 'shell/runtime.js', before: 'const diagnostic = this.cancellationState.consumeDiagnostic(raw);', after: 'const diagnostic = undefined;', case: 'N10', script: 'n14.mjs' }) + ',');
  replace("const changed = await run(mutation.id, mutantRoot, 'extension.mjs', { EXT_CASE: mutation.case });", "const changed = await run(mutation.id, mutantRoot, mutation.script ?? 'extension.mjs', mutation.script ? { N14_CASE: mutation.case } : { EXT_CASE: mutation.case });");
  replace("await cohort(mutation.id + '-restored', mutantRoot, 'extension.mjs', 1, { EXT_CASE: mutation.case });", "await cohort(mutation.id + '-restored', mutantRoot, mutation.script ?? 'extension.mjs', 1, mutation.script ? { N14_CASE: mutation.case } : { EXT_CASE: mutation.case });");
  runner = runner.replace('Fresh author-v2 strict extension35 (original32 plus3 versioned X10 identities) plus177 retained identities/layout.', 'N14-v4 twelve focused plus212 retained identities/layout; exact-Promise profile only, transformed promises not implicitly covered.');
  let helper = read(path.join(prior, 'prepare.mjs')).toString(); helper = helper.slice(0, helper.indexOf('if (process.argv[1] === fileURLToPath(import.meta.url))')).replace('"../../.."', '"../../../.."');
  let launcher = read(path.join(prior, 'launch-v2.mjs')).toString().replaceAll('PRESEAL-v2.json', 'PRESEAL-v4.json').replaceAll('EXECUTOR-v2.json', 'EXECUTOR-v4.json').replaceAll('run-v2.mjs', 'run-v4.mjs').replaceAll('strict-extension-v2-launch-', 'strict-n14-v4-launch-').replace('bash-strict-extension-author-20260829/run-v4.mjs', 'bash-strict-extension-author-20260829/n14-v4/run-v4.mjs').replace('path.resolve(own, "../../..")', 'path.resolve(own, "../../../..")');
  addCode({ 'run-v4.mjs': runner, 'prepare.mjs': helper, 'launch-v4.mjs': launcher });
  for (const file of ['run-v4.mjs', 'prepare.mjs', 'launch-v4.mjs', 'n14.mjs']) child(process.execPath, ['--check', path.join(own, file)]);
  const reviewer = path.join(repo, 'tests/compatibility/bash-strict-extension-independent-20260829/novel.mjs');
  const seal = { ...oldSeal, role: 'FRESH_N14_V4_PRESEALED', version: 'n14-v4', base: base.computedTree, sourceCommit, masterGrantStarted: new Date().toISOString(), expectedPackageSha256: null, bounds: { ...oldSeal.bounds, captureBytes: 201326592, scratchBytes: 1073741824, directProcessCeiling: 52, knownOSGrant: 112 }, plannedChildren: { direct: 44, loaders: 34, regexWorkersMax: 8, admin: 'record actual starts separately' }, cohorts: { extension: 35, conditional: 67, strict: 50, redirections: 48, arrays: 12, n14: 12 }, originalReview: 'cd06468eb1a067d8324e1d0e873cccbc2ede14c2', readonlyN14: { path: path.relative(repo, reviewer), sha256: sha(read(reviewer)) }, qualifications: 'Unchanged636 plus36 focused main; exact-Promise forwarding only. Historical681/684 unchanged; no Node/coherent or native acceptance.' };
  writeJson('SOURCE.json', source); writeJson('PRESEAL-v4.json', seal);
  const files = oldExecutor.files.slice();
  for (const filename of ['prepare-entry.mjs', 'BOOTSTRAP.md', 'n14.mjs', 'run-v4.mjs', 'prepare.mjs', 'launch-v4.mjs', 'SOURCE.json', 'PRESEAL-v4.json']) { const bytes = read(path.join(own, filename)); files.push({ path: relative + '/' + filename, bytes: bytes.length, sha256: sha(bytes) }); }
  writeJson('EXECUTOR-v4.json', { role: 'N14_V4_ACTUAL_EXECUTOR', source: sha(read(path.join(own, 'SOURCE.json'))), executions: 0, files });
  const result = { sourceCommit, computedTree: source.computedTree, sourceSha256: sha(read(path.join(own, 'SOURCE.json'))), inputs: source.inputs.length, focused: 36, retained: 636, main: 672, types: 6, negativeDiagnostics: 24, loadedMutants: 7, restores: 7, bindingRefusals: 2, productExecutions: 0, finished: new Date().toISOString() };
  writeJson('PREPARATION-RESULT.json', result); note(result); console.log(JSON.stringify(result));
} catch (error) { note({ error: String(error), stack: error?.stack }); console.error(error); process.exitCode = 1; }
finally { fs.closeSync(log); }
