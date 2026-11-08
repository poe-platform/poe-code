import * as fs from 'node:fs';
import * as path from 'node:path';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { SourceTextModule } from 'node:vm';
import { workerSource, faultModes } from './wrapper-source.mjs';
const author = '/Users/kjopek/Workspace/safe-bash/tests/compatibility/bash-ere-runtime-integration-author-20260829';
const prior = author + '/runtime-preflight-v1';
const scope = prior + '/v4';
const root = '/private/tmp/safe-bash-core70-v4-20260829';
const phase = JSON.parse(fs.readFileSync(scope + '/START.json', 'utf8'));
assert.ok(Number.isSafeInteger(phase.deadlineMs) && Date.now() < phase.deadlineMs);
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const read = (file, expected) => {
  const stat = fs.lstatSync(file);
  assert.ok(stat.isFile() && !stat.isSymbolicLink() && stat.size <= 4194304, file);
  if (expected) { assert.equal(stat.size, expected.size); assert.equal(stat.mode & 511, expected.mode); }
  const bytes = fs.readFileSync(file); assert.equal(bytes.length, stat.size);
  if (expected) assert.equal(sha(bytes), expected.sha256, file);
  return bytes;
};
for (const line of read(scope + '/BUILD-V2-SHA256SUMS').toString().trimEnd().split('\n')) {
  const match = /^([a-f0-9]{64})  (.+)$/.exec(line); assert.ok(match); assert.equal(sha(read(match[2])), match[1]);
}
const oldBytes = read(prior + '/EXECUTION-SEAL.json');
assert.equal(sha(oldBytes), '42c5cef6c87bff404edb7a21b199bc5bca174054b89b062e88ba5731f917b12e');
const old = JSON.parse(oldBytes);
read(old.archive.path, old.archive);
const compiled = read(old.compiled.path, old.compiled);
const sourceSealBytes = read(author + '/rebind-v1/SEAL.json');
assert.equal(sha(sourceSealBytes), 'b3a3844213fe34017bb4b413bafda2433fd52a0d9165aed5810b01db245dfe95');
const sourceSeal = JSON.parse(sourceSealBytes);
assert.equal(sourceSeal.sources.length, 305);
for (const member of sourceSeal.sources) read(author + '/rebind-v1/candidate/' + member.path, { size: member.bytes, mode: parseInt(member.mode, 8) & 511, sha256: member.sha256 });
let cellSource = read(prior + '/v3/cell-v3.mjs').toString('utf8');
function edit(before, after) { assert.equal(cellSource.split(before).length, 2, before); cellSource = cellSource.replace(before, after); }
edit("import { observeWorker } from './worker-observer.mjs';", "import { observeWorker } from './worker-observer.mjs';\nimport { observeArrays } from './array-observer.mjs';\nimport { boundFile, terminalOutcome } from './guards.mjs';\nimport { h02, h03, h04, h05, h07 } from './host-bodies.mjs';");
edit('let observer;', 'let observer;\nlet arrays;');
edit('  const api = await import(pathToFileURL(cell.modulePath).href);', `  const api = await import(pathToFileURL(cell.modulePath).href);
  if (cell.definition.id === 'H04') {
    for (const member of cell.arrayModules) boundFile(member);
    const ledger = await import(pathToFileURL(cell.arrayModules[0].path).href);
    const bindings = await import(pathToFileURL(cell.arrayModules[1].path).href);
    arrays = observeArrays(ledger.ArrayOwner, bindings.IndexedBinding);
  }`);
edit("  } else if (definition.id === 'H06') {", `  } else if (definition.id === 'H02') {
    await h02({ api, shell, observer, arrays, emit, cell });
  } else if (definition.id === 'H03') {
    await h03({ api, shell, observer, arrays, emit, cell });
  } else if (definition.id === 'H04') {
    await h04({ api, shell, observer, arrays, emit, cell });
  } else if (definition.id === 'H05') {
    await h05({ api, shell, observer, arrays, emit, cell });
  } else if (definition.id === 'H07') {
    await h07({ api, shell, observer, arrays, emit, cell });
  } else if (definition.id === 'H06') {`);
edit("const pattern = '('.repeat(33) + 'a' + ')'.repeat(33);", "const pattern = 'a'.repeat(65537);");
edit("const prefix = `re='${pattern}'; `;", "const prefix = ''; ");
edit('await check(prefix + script, { exitCode });', 'await check(prefix + script, { exitCode }, { env: { re: pattern } });');
edit('await shell?.dispose(); observer?.assertRetired();', 'await shell?.dispose(); await arrays?.settle(); observer?.assertRetired();');
edit('  observer?.restore();', '  arrays?.restore();\n  observer?.restore();');
edit("status: primaryFailed ? 'FAIL' : 'PASS', retired: !cleanupFailed", "...terminalOutcome(primaryFailed, cleanupFailed, undefined)");
const syntax = [];
function parseOnly(name, text) { try { new SourceTextModule(text, { identifier: name }); syntax.push({ name, status: 'PASS', diagnostic: null }); } catch (error) { syntax.push({ name, status: 'FAIL', diagnostic: String(error) }); } }
parseOnly('cell-v4.mjs', cellSource);
fs.writeFileSync(scope + '/cell-v4.mjs', cellSource, { flag: 'wx' });
const cases = JSON.parse(read(prior + '/v3/CASES-v3.json'));
const ids = cases.rows.map(row => row.id); assert.equal(ids.length, 70); assert.equal(new Set(ids).size, 70);
const maxima = { H01: 0, H02: 2, H03: 8, H04: 4, H05: 4, H06: 4, H07: 15, H08: 2, EH01: 0, EH02: 0, EH03: 1, EH04: 3, EH05: 3 };
for (const definition of cases.rows) {
  delete definition.gate; delete definition.admissionHold;
  if (definition.id.startsWith('H') || definition.id.startsWith('EH')) definition.route = 'host';
  definition.state = 'UNRUN'; definition.workerStartsMaximum = maxima[definition.id] ?? 1;
  if (definition.id === 'EH01' || definition.id === 'EH02') definition.version = 'v4-private-pattern-limit65537-public-env';
  if (definition.id === 'H03') definition.sourceOnly = ['depth64-unreachable-before-group33'];
  if (definition.id === 'H04') definition.unexecutedProofQualifications = ['MAX_SAFE_INTEGER ticket exhaustion is source-only, not dynamically forced', 'registered cleanup rejection is separate from an ArrayOwner.close rejection'];
}
cases.status = '210_CONCRETE_CALLS_ALL_RUNTIME_UNRUN_REQUIRES_INDEPENDENT_PREEXEC_AND_ROOT_RELEASE';
const harness = new Map([
  ['cell.mjs', Buffer.from(cellSource)], ['additions.mjs', read(prior + '/v3/additions.mjs')],
  ...['guards.mjs', 'worker-observer.mjs', 'array-observer.mjs', 'host-bodies.mjs'].map(name => [name, read(scope + '/' + name)]),
]);
for (const [name, bytes] of harness) parseOnly(name, bytes.toString('utf8'));
const binding = file => { const stat = fs.lstatSync(file); return { path: file, size: stat.size, mode: stat.mode & 511, sha256: sha(read(file)) }; };
const put = (file, bytes, mode = 0o600) => { fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 }); fs.writeFileSync(file, bytes, { flag: 'wx', mode }); };
function census(directory) {
  const rows = [], directories = [];
  const walk = current => {
    for (const name of fs.readdirSync(current).sort()) {
      const file = path.join(current, name), stat = fs.lstatSync(file);
      assert.ok(!stat.isSymbolicLink());
      if (stat.isDirectory()) { directories.push(path.relative(directory, file)); walk(file); }
      else { assert.ok(stat.isFile()); const value = binding(file); rows.push({ path: path.relative(directory, file), size: value.size, mode: value.mode, sha256: value.sha256, kind: 'file' }); }
    }
  }; walk(directory); return { rows, directories };
}
const layouts = [];
for (const previous of old.layouts) {
  const manifest = JSON.parse(read(previous.manifest.path, previous.manifest));
  for (const row of manifest.rows) read(path.join(previous.app, row.path), row);
  const actual = census(previous.app);
  assert.deepEqual(actual.rows.map(row => row.path).sort(), manifest.rows.map(row => row.path).sort(), 'old full app additions guard');
  const relativePackage = path.relative(previous.app, previous.packageRoot);
  const app = root + '/apps/' + previous.name + '/app';
  const staging = previous.name === 'moved' ? root + '/move-origin/app' : app;
  const sourceMembers = manifest.rows.filter(row => row.path.startsWith(relativePackage + '/'));
  assert.equal(sourceMembers.length, previous.name === 'source-built' ? 1305 : 1002);
  for (const row of sourceMembers) {
    assert.ok(!row.path.split('/').includes('..') && path.basename(row.path) !== 'AGENTS.md');
    put(path.join(staging, row.path), read(path.join(previous.app, row.path), row), row.mode);
  }
  if (staging !== app) { fs.mkdirSync(path.dirname(app), { recursive: true, mode: 0o700 }); fs.renameSync(staging, app); assert.equal(fs.existsSync(staging), false); }
  const packageRoot = path.join(app, relativePackage);
  for (const [name, bytes] of harness) put(app + '/harness/' + name, bytes);
  for (const name of ['captures', 'home', 'tmp']) fs.mkdirSync(app + '/' + name, { mode: 0o700 });
  const entry = packageRoot + '/dist/commands/regex-execution/ere/transport/worker-entry.js';
  const ledger = packageRoot + '/dist/commands/regex-execution/ere/limits.js';
  const roles = [{ name: 'stock', file: null }];
  for (const mode of ['checkpoint', ...faultModes]) {
    const text = workerSource(pathToFileURL(entry).href, pathToFileURL(ledger).href, mode);
    const file = app + '/harness/worker-' + mode + '.mjs'; put(file, text); parseOnly(previous.name + '/' + mode, text); roles.push({ name: mode, file: binding(file) });
  }
  const privatePrefix = relativePackage + '/dist/commands/regex-execution/ere/';
  const closure = sourceMembers.filter(row => row.path.startsWith(privatePrefix)).map(row => binding(app + '/' + row.path));
  assert.equal(closure.length, 48);
  const worker = { ...binding(entry), optionKeys: previous.worker.optionKeys, resourceLimits: previous.worker.resourceLimits, closure };
  const arrayModules = ['ledger.js', 'bindings.js'].map(name => binding(packageRoot + '/dist/shell/arrays/' + name));
  const cells = [];
  for (const definition of cases.rows) {
    const allowedRoles = definition.id === 'H02' ? ['stock', 'checkpoint'] : definition.id === 'H07' ? ['stock', ...faultModes] : ['stock'];
    const cell = { definition, modulePath: packageRoot + '/dist/index.js', worker: { ...worker, roles: roles.filter(role => allowedRoles.includes(role.name)) }, arrayModules, limits: { maxOutputBytes: 65536, maxCommands: 500, maxLoopIterations: 1000, maxSubstitutionDepth: 16, maxSourceBytes: 65536, maxExpansionFields: 16384, maxExpansionBytes: 1048576, pipeHighWaterMark: 65536 }, deniedFile: root + '/move-origin/app/forbidden-origin.js' };
    const cellPath = app + '/cells/' + definition.id + '.json', capture = app + '/captures/' + definition.id + '.jsonl';
    put(cellPath, JSON.stringify(cell, null, 2) + '\n');
    cells.push({ id: previous.name + '/' + definition.id, originalId: definition.id, capture, stdout: capture + '.stdout', stderr: capture + '.stderr', cwd: app, executable: old.node.path, argv: ['--permission', '--allow-fs-read=' + app, '--allow-fs-write=' + app + '/captures', '--allow-worker', app + '/harness/cell.mjs', cellPath, capture], env: { PATH: path.dirname(old.node.path), HOME: app + '/home', TMPDIR: app + '/tmp', LC_ALL: 'C', LANG: 'C', TZ: 'UTC' }, caseMs: 30000, retireMs: 3000, childCapture: definition.id === 'H04' ? 4194304 : 262144, workerStartsMaximum: definition.workerStartsMaximum });
  }
  const final = census(app), manifestPath = root + '/LAYOUT-' + previous.name + '.json';
  put(manifestPath, JSON.stringify(final, null, 2) + '\n');
  layouts.push({ name: previous.name, app, packageRoot, packageMembers: sourceMembers.length, manifest: binding(manifestPath), cells, wrapperRoles: roles, privateAssets: 48 });
  for (const row of sourceMembers) read(app + '/' + row.path, row);
}
assert.equal(layouts.flatMap(layout => layout.cells).length, 210);
assert.ok(syntax.every(row => row.status === 'PASS'));
const controller = root + '/controller'; fs.mkdirSync(controller, { mode: 0o700 });
for (const [name, original] of [['owner.mjs', prior + '/v2/owner.mjs'], ['dispatch.mjs', scope + '/dispatch.mjs']]) put(controller + '/' + name, read(original));
parseOnly('dispatch.mjs', read(scope + '/dispatch.mjs').toString());
const final = { status: 'PREEXEC_REVIEW_REQUIRED_NO_RUNTIME_RELEASE', sourceTree: old.sourceTree, sourceInputs: 305, archive: old.archive, node: old.node, layouts, controller: ['owner.mjs', 'dispatch.mjs'].map(name => binding(controller + '/' + name)), deferredCells: [], proofQualifications: { H03: ['depth64 SOURCE_ONLY dominated by group32'], H04: ['ticket MAX_SAFE overflow SOURCE_ONLY', 'ArrayOwner.close rejection not injected or observed; registered host cleanup rejection separate'] }, futureCaps: { childMaximum: 210, coordinatorMaximum: 1, knownAdministrativeAllowance: 4, totalKnownOSMaximum: 215, peakOS: 2, workerStartsMaximum: layouts.flatMap(layout => layout.cells).reduce((total, cell) => total + cell.workerStartsMaximum, 0), workerLiveMaximum: 1, internalLoaderStarts: 0, totalMilliseconds: 7500000, captureBytes: 134217728, workingBytes: 536870912 }, authorityRequired: ['qualified relevant private T1 plus six nonpublic variants', 'different CORE preexec review', 'fresh exact ROOT grant confirmation'] };
put(root + '/EXECUTION-SEAL.json', JSON.stringify(final, null, 2) + '\n');
fs.writeFileSync(scope + '/EXECUTION-SEAL.json', read(root + '/EXECUTION-SEAL.json'), { flag: 'wx' });
fs.writeFileSync(scope + '/CASES-v4.json', JSON.stringify(cases, null, 2) + '\n', { flag: 'wx' });
const report = { pid: process.pid, status: 'PREEXEC_SOURCE_DATA_ONLY', sourceInputsAuthenticated: 305, compiledManifestSha256: sha(compiled), archiveReauthenticatedNoInflate: true, cells: 210, wholeBodyIds: 70, workerStartsMaximum: final.futureCaps.workerStartsMaximum, sourceOnly: final.proofQualifications, syntax, sealSha256: sha(read(root + '/EXECUTION-SEAL.json')), productImports: 0, workers: 0, finishedMs: Date.now() };
assert.ok(report.finishedMs < phase.deadlineMs);
fs.writeFileSync(scope + '/BUILD-RESULT.json', JSON.stringify(report, null, 2) + '\n', { flag: 'wx' });
console.log(JSON.stringify({ status: report.status, cells: 210, syntax: syntax.length, workerStartsMaximum: report.workerStartsMaximum, seal: report.sealSha256 }));
