import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFileSync, spawnSync } from 'node:child_process';
import { chmodSync, copyFileSync, cpSync, existsSync, lstatSync, mkdirSync, readFileSync, readdirSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, isAbsolute, join, relative, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { gzipSync } from 'node:zlib';

const own = dirname(fileURLToPath(import.meta.url));
const repository = resolve(own, '../../..');
const relativeOwn = relative(repository, own);
const phase = process.argv[2];
const runName = process.argv[3] ?? 'evidence-v2';
assert.match(runName, /^[a-zA-Z0-9_-]+$/);
const evidence = join(own, runName);
const scratch = join(own, `.scratch-${runName}`);
const candidate = '373437cf84424939e1792470805cdd9e60bd3898';
const authorFreeze = '88d91975e4a718fb3c1b55322e44492cf4059391';
const independentFreeze = 'cbed682564e1e3b1c2ac8062157ece7b8b997f30';
const expectedSource = 'f628801379acd1c86c247a778e973f4cb89f8bbe2c3089f8192c31f3c5b273a5';
const helperPath = 'src/shell/cancellation.ts';
const oldDirectory = 'tests/shell/cancellation-stage1-independent-20260827';
const authorDirectory = 'tests/shell/cancellation-stage1-20260827';
const sourceDirectory = join(scratch, 'source');
const buildDirectory = join(scratch, 'build');
const movedDirectory = join(scratch, 'moved-internal');
const fixtureDirectory = join(scratch, 'fixtures');
const toolDirectory = join(scratch, 'tools');
const copiedNode = join(toolDirectory, 'node');
const compiler = join(toolDirectory, 'typescript/lib/tsc.js');
const environment = { PATH: '/usr/bin:/bin', HOME: scratch, TMPDIR: join(scratch, 'tmp'), LANG: 'C', LC_ALL: 'C', TZ: 'UTC', NODE_NO_WARNINGS: '1' };
const sha256 = value => createHash('sha256').update(value).digest('hex');
const objectId = (type, content) => createHash('sha1').update(`${type} ${content.length}\0`).update(content).digest('hex');
const git = (...args) => execFileSync('git', args, { cwd: repository, maxBuffer: 64 * 1024 * 1024, timeout: 60000 });
const text = (...args) => git(...args).toString().trim();
const sourceAt = (commit, filename) => git('show', `${commit}:${filename}`);
const processes = [];

function write(filename, content) {
  assert.ok(!existsSync(filename), `refuse evidence overwrite: ${filename}`);
  mkdirSync(dirname(filename), { recursive: true });
  writeFileSync(filename, content, { flag: 'wx' });
}

function json(filename, value) { write(filename, JSON.stringify(value, null, 2) + '\n'); }
function record(name, value) { json(join(evidence, `${name}.json`), value); }

function inventory(directory) {
  if (!existsSync(directory)) return null;
  const members = {};
  function visit(current) {
    const info = lstatSync(current);
    const name = relative(directory, current) || '.';
    assert.equal(info.isSymbolicLink(), false, `symlink refused: ${current}`);
    if (info.isDirectory()) {
      members[name] = { kind: 'directory', mode: info.mode & 0o777 };
      for (const entry of readdirSync(current).sort()) visit(join(current, entry));
    } else {
      assert.ok(info.isFile(), `nonregular file refused: ${current}`);
      const bytes = readFileSync(current);
      members[name] = { kind: 'file', mode: info.mode & 0o777, size: bytes.length, sha256: sha256(bytes) };
    }
  }
  visit(directory);
  return members;
}

function foreignIndex() {
  const entries = git('ls-files', '--stage', '-z').toString().split('\0').filter(Boolean)
    .filter(entry => !entry.split('\t')[1].startsWith(relativeOwn + '/'));
  return { entries: entries.length, sha256: sha256(entries.join('\0') + '\0'), staged: git('diff', '--cached', '--name-status', '--', '.', `:(exclude)${relativeOwn}`).toString() };
}

function liveState() {
  const files = {};
  for (const filename of ['package.json', 'package-lock.json', 'tsconfig.json', 'tsconfig.build.json', 'src/index.ts', 'src/plugins/index.ts']) {
    if (existsSync(join(repository, filename))) files[filename] = sha256(readFileSync(join(repository, filename)));
  }
  return { head: text('rev-parse', 'HEAD'), files, source: { shell: inventory(join(repository, 'src/shell')), contracts: inventory(join(repository, 'src/contracts')) },
    historicalIndependent: inventory(join(repository, oldDirectory)), authorHistory: inventory(join(repository, authorDirectory)),
    foreignIndex: foreignIndex(), status: git('status', '--short').toString() };
}

function launch(name, executable, args, extraEnvironment = {}, cwd = scratch) {
  const started = new Date().toISOString();
  const result = spawnSync(executable, args, { cwd, env: { ...environment, ...extraEnvironment }, encoding: 'utf8', timeout: 45000, killSignal: 'SIGKILL', maxBuffer: 8 * 1024 * 1024 });
  const entry = { name, executable, executableSha256: sha256(readFileSync(executable)), args, cwd, environment: { ...environment, ...extraEnvironment }, started,
    ended: new Date().toISOString(), pid: result.pid, exit: result.status, signal: result.signal, error: result.error ? { message: result.error.message, code: result.error.code } : null,
    stdoutSha256: sha256(result.stdout ?? ''), stderrSha256: sha256(result.stderr ?? '') };
  processes.push(entry);
  write(join(evidence, `${name}.stdout`), result.stdout ?? '');
  write(join(evidence, `${name}.stderr`), result.stderr ?? '');
  record(name + '-process', entry);
  assert.equal(result.error, undefined, `${name} infrastructure failure`);
  assert.equal(result.signal, null, `${name} must terminate naturally`);
  return { entry, stdout: result.stdout, stderr: result.stderr };
}

function typeConfig(directory, filenames, emit = false) {
  return { compilerOptions: { target: 'ES2023', module: 'NodeNext', moduleResolution: 'NodeNext', lib: ['ES2023', 'DOM'], types: [], strict: true,
    exactOptionalPropertyTypes: true, skipLibCheck: false, noEmit: !emit, declaration: emit, ...(emit ? { outDir: relative(directory, buildDirectory) } : {}) }, files: filenames };
}

function build(name, directory, destination) {
  const config = typeConfig(directory, ['cancellation.ts'], true);
  config.compilerOptions.outDir = relative(directory, destination);
  json(join(directory, 'tsconfig.json'), config);
  const result = launch(name, copiedNode, [compiler, '--project', join(directory, 'tsconfig.json'), '--pretty', 'false']);
  assert.equal(result.entry.exit, 0, `${name} compile`);
  json(join(destination, 'package.json'), { type: 'module' });
  return result;
}

function runtime(name, modulePath, fixture, pattern) {
  const loadLog = join(evidence, `${name}-loads.jsonl`);
  const fixturePath = isAbsolute(fixture) ? fixture : join(fixtureDirectory, fixture);
  const allowedFiles = [modulePath, fixturePath].map(filename => realpathSync(filename));
  const args = ['--import', join(fixtureDirectory, 'register-guard-v1.mjs'), '--test', '--test-reporter=tap'];
  if (pattern) args.push('--test-name-pattern', pattern);
  args.push(fixturePath);
  const result = launch(name, copiedNode, args, {
    CANCELLATION_MODULE: modulePath, CANCELLATION_MODULE_SHA256: sha256(readFileSync(modulePath)),
    REVIEW_ALLOWED_FILES: JSON.stringify(allowedFiles), REVIEW_LOAD_LOG: loadLog,
  });
  const loads = readFileSync(loadLog, 'utf8').trim().split('\n').map(line => JSON.parse(line));
  assert.equal(loads.filter(item => item.filename === realpathSync(modulePath)).length, 1, 'exactly one authenticated helper load');
  const count = label => Number(result.stdout.match(new RegExp(`^# ${label} (\\d+)$`, 'm'))?.[1] ?? NaN);
  const tests = [...result.stdout.matchAll(/^(not ok|ok) \d+ - (.+)$/gm)].map(match => ({ pass: match[1] === 'ok', name: match[2] }));
  const summary = { exit: result.entry.exit, tests: count('tests'), pass: count('pass'), fail: count('fail'), cancelled: count('cancelled'), skipped: count('skipped'), todo: count('todo'), records: tests };
  assert.ok(Number.isFinite(summary.tests), 'TAP summary present');
  assert.equal(summary.cancelled, 0);
  record(name + '-summary', summary);
  console.log(JSON.stringify({ name, ...summary }));
  return summary;
}

function types(name, moduleDirectory, input, expectedRows) {
  const fixture = `${name}.ts`;
  write(join(moduleDirectory, fixture), readFileSync(join(fixtureDirectory, input)));
  const configName = `tsconfig-${name}.json`;
  json(join(moduleDirectory, configName), typeConfig(moduleDirectory, [fixture]));
  const result = launch(name, copiedNode, [compiler, '--project', join(moduleDirectory, configName), '--pretty', 'false']);
  const diagnostics = [...result.stdout.matchAll(/([^\n]+)\((\d+),(\d+)\): error TS(\d+): ([^\n]+)/g)]
    .map(match => ({ file: match[1], line: Number(match[2]), column: Number(match[3]), code: Number(match[4]), message: match[5] }));
  if (expectedRows.length === 0) assert.equal(result.entry.exit, 0, `${name} positive compilation`);
  else {
    assert.equal(result.entry.exit, 2, `${name} expected type diagnostics`);
    assert.deepEqual(diagnostics.map(item => item.line), expectedRows, `${name} exact malformed rows`);
    assert.ok(diagnostics.every(item => item.file.endsWith(fixture)), 'diagnostics only from malformed fixture');
    assert.ok(diagnostics.every(item => [2322, 2345, 2540, 2739, 2740, 2741].includes(item.code)), 'targeted assignability/readonly diagnostics only');
    assert.equal(result.stderr, '');
  }
  record(name + '-diagnostics', { expectedRows, diagnostics, exit: result.entry.exit, accepted: true });
}

function authenticate() {
  const objects = new Map();
  const paths = [];
  function keep(type, oid) {
    if (!objects.has(oid)) {
      const bytes = git('cat-file', type, oid);
      assert.equal(objectId(type, bytes), oid);
      objects.set(oid, { type, oid, size: bytes.length, sha256: sha256(bytes), base64: bytes.toString('base64') });
    }
    return Buffer.from(objects.get(oid).base64, 'base64');
  }
  function bind(commit, filename, contents = false) {
    const rawCommit = keep('commit', commit).toString();
    let tree = rawCommit.match(/^tree ([0-9a-f]{40})$/m)[1];
    const steps = [];
    const pieces = filename.split('/');
    for (let index = 0; index < pieces.length; index += 1) {
      keep('tree', tree);
      const rows = git('ls-tree', '-z', tree).toString().split('\0').filter(Boolean);
      const match = rows.map(row => /^(\d+) (\w+) ([0-9a-f]{40})\t(.+)$/.exec(row)).find(row => row[4] === pieces[index]);
      assert.ok(match, `${commit}:${filename}`);
      steps.push({ tree, name: match[4], mode: match[1], type: match[2], oid: match[3] });
      tree = match[3];
    }
    if (contents) keep('blob', tree);
    paths.push({ commit, path: filename, oid: tree, steps });
    return tree;
  }
  const rawCandidate = keep('commit', candidate).toString();
  assert.equal(rawCandidate.match(/^parent (.+)$/m)[1], authorFreeze);
  assert.equal(git('diff-tree', '--no-commit-id', '--name-only', '-r', candidate).toString().trim(), helperPath);
  assert.equal(sha256(sourceAt(candidate, helperPath)), expectedSource);
  bind(candidate, helperPath, true);
  bind(authorFreeze, helperPath, true);
  bind(independentFreeze, helperPath);
  const ownParent = keep('commit', independentFreeze).toString().match(/^parent (.+)$/m)[1];
  bind(ownParent, helperPath);
  const frozen = JSON.parse(sourceAt(independentFreeze, `${relativeOwn}/FREEZE-v1.json`));
  for (const input of frozen.inputs) {
    assert.equal(bind(input.commit, input.path, true), input.blob);
    assert.equal(sha256(sourceAt(input.commit, input.path)), input.sha256);
  }
  for (const [filename, digest] of Object.entries(frozen.files)) {
    bind(independentFreeze, `${relativeOwn}/${filename}`, true);
    assert.equal(sha256(sourceAt(independentFreeze, `${relativeOwn}/${filename}`)), digest);
  }
  bind(independentFreeze, `${relativeOwn}/FREEZE-v1.json`, true);
  const historicalMembership = {};
  for (const directory of [oldDirectory, authorDirectory]) {
    const baseline = git('ls-tree', '-r', '-z', authorFreeze, '--', directory);
    const current = git('ls-tree', '-r', '-z', candidate, '--', directory);
    assert.deepEqual(current, baseline, `historical membership unchanged: ${directory}`);
    historicalMembership[directory] = { sha256: sha256(baseline), bytes: baseline.length, tree: bind(candidate, directory) };
    bind(authorFreeze, directory);
    write(join(evidence, directory === oldDirectory ? 'historical-independent-membership.z' : 'historical-author-membership.z'), gzipSync(baseline));
  }
  const reserved = ['src/contracts', 'src/shell/runtime.ts', 'src/shell/shell.ts', 'src/shell/types.ts', 'src/shell/cleanup.ts', 'src/index.ts', 'src/plugins/index.ts', 'package.json', 'package-lock.json'];
  const reservedBindings = reserved.map(filename => {
    const before = bind(authorFreeze, filename);
    const after = bind(candidate, filename);
    assert.equal(after, before);
    return { path: filename, before, after };
  });
  write(join(evidence, 'raw-object-proof.json.gz'), gzipSync(JSON.stringify({ version: 1, objects: [...objects.values()], paths })));
  record('authentication', { candidate, authorFreeze, independentFreeze, ownParent, helperSha256: expectedSource, candidateParentIsAuthorFreeze: true,
    candidateChangedPaths: [helperPath], reservedBindings, historicalMembership, rawObjects: objects.size,
    fullTreeDeltaChecked: true, liveOverlay: false, sourceBindingsFromGit: true });
}

async function prepare() {
  assert.equal(existsSync(evidence), false);
  assert.equal(existsSync(scratch), false);
  mkdirSync(evidence);
  record('live-before', liveState());
  authenticate();
  for (const directory of [sourceDirectory, fixtureDirectory, toolDirectory, join(scratch, 'tmp')]) mkdirSync(directory, { recursive: true });
  const hostNode = realpathSync(process.execPath);
  copyFileSync(hostNode, copiedNode);
  chmodSync(copiedNode, 0o755);
  const originalTypescript = join(repository, 'node_modules/typescript');
  const originalTools = { node: { path: hostNode, sha256: sha256(readFileSync(hostNode)) }, typescript: inventory(originalTypescript) };
  cpSync(originalTypescript, join(toolDirectory, 'typescript'), { dereference: true, recursive: true, errorOnExist: true, force: false });
  record('tools-origin', originalTools);
  record('tools-before', inventory(toolDirectory));
  assert.deepEqual(inventory(join(toolDirectory, 'typescript')), originalTools.typescript);
  assert.equal(sha256(readFileSync(copiedNode)), originalTools.node.sha256);
  write(join(sourceDirectory, 'cancellation.ts'), sourceAt(candidate, helperPath));
  json(join(sourceDirectory, 'package.json'), { type: 'module' });
  const compilerApi = await import(pathToFileURL(join(toolDirectory, 'typescript/lib/typescript.js')).href);
  const parsed = compilerApi.default.createSourceFile('cancellation.ts', readFileSync(join(sourceDirectory, 'cancellation.ts'), 'utf8'), compilerApi.default.ScriptTarget.Latest, true);
  const references = [];
  function walk(node) {
    if (compilerApi.default.isImportDeclaration(node) || compilerApi.default.isExportDeclaration(node) && node.moduleSpecifier || compilerApi.default.isCallExpression(node) && (node.expression.kind === compilerApi.default.SyntaxKind.ImportKeyword || node.expression.getText(parsed) === 'require')) references.push(node.getText(parsed));
    compilerApi.default.forEachChild(node, walk);
  }
  walk(parsed);
  assert.deepEqual(references, [], 'standalone helper import closure');
  record('import-closure', { sourceSha256: expectedSource, references, closurePaths: [helperPath] });
  const frozen = JSON.parse(sourceAt(independentFreeze, `${relativeOwn}/FREEZE-v1.json`));
  for (const filename of ['extension-v1.mjs', 'positive-v1.ts.data', 'negative-v1.ts.data']) write(join(fixtureDirectory, filename), sourceAt(independentFreeze, `${relativeOwn}/${filename}`));
  const oldFixtures = [
    ['original12.mjs', '647f42b9abf9f5abc4de3e36c74410b3bb63df3c', `${oldDirectory}/cohort-v1.mjs`],
    ['old-positive.ts.data', '647f42b9abf9f5abc4de3e36c74410b3bb63df3c', `${oldDirectory}/positive-v1.ts.data`],
    ['old-negative.ts.data', '647f42b9abf9f5abc4de3e36c74410b3bb63df3c', `${oldDirectory}/negative-v1.ts.data`],
    ['nearby4.mjs', '61092847acc8d2c54af109a5bbeefe22146488d3', `${oldDirectory}/repair-fbbe1ef7/nearby-v1.mjs`],
  ];
  for (const [name, commit, filename] of oldFixtures) write(join(fixtureDirectory, name), sourceAt(commit, filename));
  for (const filename of ['load-guard-v1.mjs', 'register-guard-v1.mjs']) write(join(fixtureDirectory, filename), readFileSync(join(own, filename)));
  record('fixture-bindings', { frozen, oldFixtures, members: inventory(fixtureDirectory) });
  record('source-before', inventory(sourceDirectory));
  launch('node-version', copiedNode, ['--version']);
  launch('typescript-version', copiedNode, [compiler, '--version']);
  build('candidate-build', sourceDirectory, buildDirectory);
  record('source-after-build', inventory(sourceDirectory));
  record('build-before', inventory(buildDirectory));
  record('prepare-complete', { ready: true });
}

function baseline() {
  const modulePath = join(buildDirectory, 'cancellation.js');
  for (const [name, fixture] of [['extension', 'extension-v1.mjs'], ['original12', 'original12.mjs'], ['nearby4', 'nearby4.mjs']]) runtime(`${name}-isolated`, modulePath, fixture);
  record('baseline-complete', { allRunsCaptured: true });
}

function probe() {
  const diagnostic = join(scratch, 'diagnostics', 'bug-repro-v1.mjs');
  write(diagnostic, readFileSync(join(own, 'bug-repro-v1.mjs')));
  write(join(evidence, 'bug-repro-v1.mjs.data'), readFileSync(diagnostic));
  runtime('bug-E07-isolated', join(buildDirectory, 'cancellation.js'), diagnostic);
}

function mutate(source, name) {
  const replaceOnce = (needle, replacement) => {
    assert.equal(source.split(needle).length, 2, `${name} unique mutation anchor`);
    return source.replace(needle, replacement);
  };
  if (name === 'premature-preparation-acquisition') return replaceOnce('  return new Prepared(state);', '  new AbortController();\n  return new Prepared(state);');
  if (name === 'activation-recheck') {
    const needle = '  throwLocalActivationFailure(preparation);';
    assert.equal(source.split(needle).length, 3);
    return source.replaceAll(needle, '  void preparation;');
  }
  if (name === 'runtime-reason-equality') return replaceOnce('  const classified = reported ?? observed;', '  const classified = reported ?? observed ?? (captured.kind === "throw" ? matchingVisibleOrigin(lineage, captured.reason) : undefined);');
  if (name === 'activation-rollback') return replaceOnce('    const cancellation = admissionFailure(state);\n    const rollback = rollbackState(state);', '    const cancellation = admissionFailure(state);\n    const rollback: unknown[] = [];');
  throw new Error(`unknown mutation ${name}`);
}

function finish() {
  for (const [name, fixture, rows] of [
    ['old-positive', 'old-positive.ts.data', []], ['old-six-negative', 'old-negative.ts.data', [2, 3, 4, 5, 6, 7]],
    ['extension-positive', 'positive-v1.ts.data', []], ['extension-eight-negative', 'negative-v1.ts.data', [5, 6, 7, 8, 9, 10, 11, 12]],
  ]) types(`${name}-source`, sourceDirectory, fixture, rows);
  mkdirSync(movedDirectory);
  for (const filename of ['cancellation.js', 'cancellation.d.ts', 'package.json']) copyFileSync(join(buildDirectory, filename), join(movedDirectory, filename));
  const movedBefore = inventory(movedDirectory);
  record('moved-before', movedBefore);
  const removalInventory = { source: inventory(sourceDirectory), build: inventory(buildDirectory) };
  record('source-build-before-removal', removalInventory);
  rmSync(sourceDirectory, { recursive: true });
  rmSync(buildDirectory, { recursive: true });
  record('source-build-removal', { sourceAbsent: !existsSync(sourceDirectory), buildAbsent: !existsSync(buildDirectory), enumeratedBeforeRemoval: true });
  const modulePath = join(movedDirectory, 'cancellation.js');
  for (const [name, fixture] of [['extension', 'extension-v1.mjs'], ['original12', 'original12.mjs'], ['nearby4', 'nearby4.mjs']]) runtime(`${name}-moved`, modulePath, fixture);
  for (const [name, fixture, rows] of [
    ['old-positive', 'old-positive.ts.data', []], ['old-six-negative', 'old-negative.ts.data', [2, 3, 4, 5, 6, 7]],
    ['extension-positive', 'positive-v1.ts.data', []], ['extension-eight-negative', 'negative-v1.ts.data', [5, 6, 7, 8, 9, 10, 11, 12]],
  ]) types(`${name}-moved`, movedDirectory, fixture, rows);
  const source = sourceAt(candidate, helperPath).toString();
  const witnesses = { 'premature-preparation-acquisition': 'E01', 'activation-recheck': 'E04', 'runtime-reason-equality': 'E08', 'activation-rollback': 'E11' };
  const mutantResults = [];
  const candidateSummary = JSON.parse(readFileSync(join(evidence, 'extension-isolated-summary.json')));
  for (const [name, witness] of Object.entries(witnesses)) {
    const baselineRecord = candidateSummary.records.find(item => item.name.startsWith(witness + ' '));
    assert.equal(baselineRecord?.pass, true, `${name} candidate-passing witness required`);
    const directory = join(scratch, `counterfactual-${name}`);
    mkdirSync(directory);
    const modified = mutate(source, name);
    write(join(directory, 'cancellation.ts'), modified);
    write(join(evidence, `counterfactual-${name}.ts.data`), modified);
    json(join(directory, 'package.json'), { type: 'module' });
    record(`counterfactual-${name}-before`, inventory(directory));
    const emitted = join(directory, 'emitted');
    build(`counterfactual-${name}-build`, directory, emitted);
    const result = runtime(`counterfactual-${name}`, join(emitted, 'cancellation.js'), 'extension-v1.mjs', `^${witness} `);
    const witnessResult = result.records.find(item => item.name.startsWith(witness + ' '));
    const killed = result.exit === 1 && witnessResult?.pass === false && result.fail === 1;
    assert.ok(killed, `${name} relevant behavioral kill`);
    mutantResults.push({ name, witness, candidateWitnessPassed: true, compiled: true, authenticatedLoad: true, killed, sourceSha256: sha256(modified) });
    record(`counterfactual-${name}-after`, inventory(directory));
  }
  record('counterfactuals', mutantResults);
  record('fixtures-after', inventory(fixtureDirectory));
  assert.deepEqual(inventory(fixtureDirectory), JSON.parse(readFileSync(join(evidence, 'fixture-bindings.json'))).members);
  record('tools-after', inventory(toolDirectory));
  assert.deepEqual(inventory(toolDirectory), JSON.parse(readFileSync(join(evidence, 'tools-before.json'))));
  record('moved-after', inventory(movedDirectory));
  for (const filename of ['cancellation.js', 'cancellation.d.ts', 'package.json']) assert.deepEqual(inventory(movedDirectory)[filename], movedBefore[filename]);
  const after = liveState();
  const before = JSON.parse(readFileSync(join(evidence, 'live-before.json')));
  record('live-after', after);
  assert.deepEqual(after.historicalIndependent, before.historicalIndependent, 'all old independent entries unchanged including additions');
  assert.deepEqual(after.authorHistory, before.authorHistory, 'all author history entries unchanged including additions');
  record('concurrent-index-reconciliation', verifyConcurrentIndex(before, after));
  for (const filename of ['cancellation.js', 'cancellation.d.ts', 'package.json']) {
    write(join(evidence, 'artifacts', `${filename}.data`), readFileSync(join(movedDirectory, filename)));
  }
  record('live-comparison', { historicalIndependentEqual: true, authorHistoryEqual: true, foreignStagedEditsEqual: true,
    fullRawIndexUnchangedClaimed: before.foreignIndex.sha256 === after.foreignIndex.sha256,
    sourceEqual: JSON.stringify(after.source) === JSON.stringify(before.source), rootFilesEqual: JSON.stringify(after.files) === JSON.stringify(before.files),
    note: 'Live source changes are separate observations, never overlaid into committed candidate.' });
  const scratchMembers = inventory(scratch);
  record('scratch-before-removal', scratchMembers);
  record('durable-before-cleanup', { captured: true, scratchFiles: Object.values(scratchMembers).filter(item => item.kind === 'file').length });
  rmSync(scratch, { recursive: true });
  record('scratch-cleanup', { enumerated: true, removed: scratch, absent: !existsSync(scratch) });
  record('finish-complete', { reviewExecuted: true, integrationAuthorized: false });
}

function verifyConcurrentIndex(before, after) {
  for (const value of [before, after]) {
    assert.equal(value.foreignIndex.staged, '', 'this review started and ended without staged foreign edits');
    const entries = git('ls-tree', '-r', '-z', value.head).toString().split('\0').filter(Boolean)
      .map(row => /^(\d+) (\w+) ([0-9a-f]{40})\t([\s\S]+)$/.exec(row))
      .filter(row => !row[4].startsWith(relativeOwn + '/'))
      .map(row => `${row[1]} ${row[3]} 0\t${row[4]}`);
    assert.equal(sha256(entries.join('\0') + '\0'), value.foreignIndex.sha256, 'full foreign index matches its contemporaneous HEAD');
    assert.equal(entries.length, value.foreignIndex.entries);
  }
  return { beforeHead: before.head, afterHead: after.head, stagedForeignBefore: '', stagedForeignAfter: '',
    fullIndexMatchesEachHead: true, rawIndexIdentical: before.foreignIndex.sha256 === after.foreignIndex.sha256,
    concurrentCommittedChanges: git('diff', '--name-status', before.head, after.head, '--', '.', `:(exclude)${relativeOwn}`).toString() };
}

function sealAfterRetainedIndexError() {
  const before = JSON.parse(readFileSync(join(evidence, 'live-before.json')));
  const after = JSON.parse(readFileSync(join(evidence, 'live-after.json')));
  record('concurrent-index-reconciliation', verifyConcurrentIndex(before, after));
  const now = liveState();
  record('live-final', now);
  record('concurrent-index-final', verifyConcurrentIndex(after, now));
  assert.deepEqual(now.historicalIndependent, before.historicalIndependent, 'all historical independent entries unchanged');
  assert.deepEqual(now.authorHistory, before.authorHistory, 'all historical author entries unchanged');
  assert.deepEqual(inventory(fixtureDirectory), JSON.parse(readFileSync(join(evidence, 'fixture-bindings.json'))).members);
  assert.deepEqual(inventory(toolDirectory), JSON.parse(readFileSync(join(evidence, 'tools-before.json'))));
  const movedBefore = JSON.parse(readFileSync(join(evidence, 'moved-before.json')));
  for (const filename of ['cancellation.js', 'cancellation.d.ts', 'package.json']) {
    assert.deepEqual(inventory(movedDirectory)[filename], movedBefore[filename]);
    write(join(evidence, 'artifacts', `${filename}.data`), readFileSync(join(movedDirectory, filename)));
  }
  record('live-comparison-final', { historicalIndependentEqual: true, authorHistoryEqual: true, foreignStagedEditsEqual: true,
    sourceEqual: JSON.stringify(now.source) === JSON.stringify(before.source), rootFilesEqual: JSON.stringify(now.files) === JSON.stringify(before.files),
    fullRawIndexUnchangedClaimed: false, candidateInputsNeverOverlaid: true });
  const scratchMembers = inventory(scratch);
  record('scratch-before-removal', scratchMembers);
  record('durable-before-cleanup', { captured: true, scratchFiles: Object.values(scratchMembers).filter(item => item.kind === 'file').length,
    completedTestsNotRerun: true, priorIndexAssertionFailureRetained: true });
  rmSync(scratch, { recursive: true });
  record('scratch-cleanup', { enumerated: true, removed: scratch, absent: !existsSync(scratch) });
  record('finish-complete', { reviewExecuted: true, integrationAuthorized: false, completionPhase: 'seal-after-retained-index-error' });
}

try {
  if (phase === 'prepare') await prepare();
  else if (phase === 'baseline') baseline();
  else if (phase === 'probe') probe();
  else if (phase === 'finish') finish();
  else if (phase === 'seal-after-index-error') sealAfterRetainedIndexError();
  else throw new Error('usage: run-v1.mjs prepare|baseline|probe|finish|seal-after-index-error [new-evidence-name]');
} catch (error) {
  if (existsSync(evidence)) {
    const name = `${phase}-error-${Date.now()}`;
    record(name, { message: error.message, stack: error.stack, processes });
  }
  throw error;
} finally {
  if (existsSync(evidence)) {
    const name = `${phase}-driver-${Date.now()}`;
    write(join(evidence, `${name}.mjs.data`), readFileSync(fileURLToPath(import.meta.url)));
    record(name, { capturedAt: new Date().toISOString(), driverSha256: sha256(readFileSync(fileURLToPath(import.meta.url))), processes });
  }
}
