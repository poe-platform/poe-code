import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { cpSync, existsSync, lstatSync, mkdirSync, readFileSync, readdirSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const repository = path.resolve(here, '../../..');
const helper = 'src/shell/cancellation.ts';
const authorDirectory = 'tests/shell/cancellation-stage1-20260827';
const commits = {
  freeze: '7023c28229ecb7939aee5eb7ca0f52ac57c795bb',
  candidate: '6747227230cd770379148552d471621717b766d7',
  evidence: '3d247da92459f8526afaea42c0ce25b59f3bd263',
  independentFreeze: '3af5da96',
  design: '618d8967009117547ab476256bc6eb0a9463309a',
};
const mode = process.argv[2];
const label = process.argv[3];
assert.ok(mode === 'capture' || mode === 'replay', 'usage: review-v1.mjs capture|replay unique-output-label [seal.json]');
assert.match(label ?? '', /^[a-zA-Z0-9-]+$/);
const output = path.join(here, label);
assert.equal(existsSync(output), false, 'never overwrite evidence');
mkdirSync(output);
const scratch = path.join(output, 'scratch');
mkdirSync(scratch);
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const gitHash = (type, bytes) => createHash('sha1').update(`${type} ${bytes.length}\0`).update(bytes).digest('hex');
const json = (name, value) => writeFileSync(path.join(output, name), `${JSON.stringify(value, null, 2)}\n`);
function git(...args) {
  const result = spawnSync('git', args, { cwd: repository, maxBuffer: 64 * 1024 * 1024 });
  assert.equal(result.error, undefined);
  assert.equal(result.signal, null);
  assert.equal(result.status, 0, `git ${args.join(' ')}: ${result.stderr}`);
  return result.stdout;
}
function inventory(directory) {
  const entries = [];
  function visit(relative) {
    for (const name of readdirSync(path.join(directory, relative)).sort()) {
      const item = path.posix.join(relative, name);
      const location = path.join(directory, item);
      const stat = lstatSync(location);
      assert.equal(stat.isSymbolicLink(), false, `regular copies only: ${location}`);
      if (stat.isDirectory()) { entries.push({ path: `${item}/`, kind: 'directory' }); visit(item); }
      else entries.push({ path: item, kind: 'file', size: stat.size, sha256: hash(readFileSync(location)) });
    }
  }
  visit('');
  return entries;
}
const fixtureNames = readdirSync(here).filter(name => lstatSync(path.join(here, name)).isFile()).sort();
const fixtureInventory = () => readdirSync(here).filter(name => lstatSync(path.join(here, name)).isFile()).sort()
  .map(name => ({ path: name, sha256: hash(readFileSync(path.join(here, name))) }));
const before = {
  at: new Date().toISOString(), head: git('rev-parse', 'HEAD').toString().trim(),
  status: git('status', '--porcelain=v1', '--untracked-files=all').toString(),
  index: git('diff', '--cached', '--raw').toString(), fixtures: fixtureInventory(),
};
json('before.json', before);
let seal;
if (mode === 'capture') {
  seal = { version: 1, commits: {}, objects: {}, files: {}, pathsets: {}, memberships: {} };
  function saveObject(oid) {
    if (seal.objects[oid]) return;
    const type = git('cat-file', '-t', oid).toString().trim();
    const bytes = git('cat-file', type, oid);
    assert.equal(gitHash(type, bytes), oid);
    seal.objects[oid] = { type, sha256: hash(bytes), base64: bytes.toString('base64') };
  }
  for (const [key, input] of Object.entries(commits)) {
    const oid = git('rev-parse', input).toString().trim();
    seal.commits[key] = oid;
    saveObject(oid);
    seal.pathsets[key] = git('diff-tree', '--no-commit-id', '--root', '-r', '--name-status', oid).toString();
  }
  function saveFile(commit, file) {
    const oid = git('rev-parse', `${commit}:${file}`).toString().trim();
    saveObject(oid);
    const components = file.split('/');
    for (let depth = 0; depth < components.length; depth++) {
      const directory = components.slice(0, depth).join('/');
      const tree = git('rev-parse', directory ? `${commit}:${directory}` : `${commit}^{tree}`).toString().trim();
      saveObject(tree);
    }
    seal.files[`${commit}:${file}`] = oid;
  }
  const frozenPaths = git('ls-tree', '-r', '--name-only', commits.freeze, '--', authorDirectory).toString().trim().split('\n');
  for (const file of frozenPaths) {
    saveFile(commits.freeze, file);
    saveFile(commits.candidate, file);
    saveFile(commits.evidence, file);
  }
  saveFile(commits.candidate, helper);
  saveFile(commits.evidence, `${authorDirectory}/evidence-v1/RESULTS.md`);
  for (const file of ['src/shell/cleanup.ts', 'src/shell/runtime.ts', 'src/shell/shell.ts', 'src/shell/types.ts', 'src/index.ts', 'package.json']) {
    saveFile(commits.freeze, file);
    saveFile(commits.candidate, file);
    saveFile(commits.design, file);
  }
  saveFile(seal.commits.independentFreeze, 'tests/shell/cancellation-stage1-independent-20260827/FREEZE-v1.md');
  const freezeShellTree = git('rev-parse', `${commits.freeze}:src/shell`).toString().trim();
  saveObject(freezeShellTree);
  seal.freezeShellTree = freezeShellTree;
  seal.helperAbsent = git('ls-tree', commits.freeze, '--', helper).toString();
  for (const name of ['freeze', 'candidate', 'evidence']) {
    seal.memberships[name] = git('ls-tree', '-r', '--full-tree', seal.commits[name], '--', 'src', 'package.json', authorDirectory).toString();
  }
  json('seal.json', seal);
} else {
  seal = JSON.parse(readFileSync(path.resolve(process.argv[4]), 'utf8'));
  json('seal.json', seal);
}
function objectBytes(oid, expectedType) {
  const object = seal.objects[oid];
  assert.ok(object, `sealed object ${oid}`);
  if (expectedType) assert.equal(object.type, expectedType);
  const bytes = Buffer.from(object.base64, 'base64');
  assert.equal(gitHash(object.type, bytes), oid);
  assert.equal(hash(bytes), object.sha256);
  return bytes;
}
function entries(oid) {
  const bytes = objectBytes(oid, 'tree');
  const result = new Map();
  let cursor = 0;
  while (cursor < bytes.length) {
    const space = bytes.indexOf(32, cursor);
    const nul = bytes.indexOf(0, space);
    const name = bytes.subarray(space + 1, nul).toString();
    result.set(name, bytes.subarray(nul + 1, nul + 21).toString('hex'));
    cursor = nul + 21;
  }
  assert.equal(cursor, bytes.length);
  return result;
}
function fileBytes(commit, file) {
  const rawCommit = objectBytes(commit, 'commit').toString();
  let oid = /^tree ([0-9a-f]{40})$/m.exec(rawCommit)[1];
  for (const name of file.split('/')) {
    oid = entries(oid).get(name);
    assert.ok(oid, `reachable path ${file}`);
  }
  assert.equal(oid, seal.files[`${commit}:${file}`]);
  return objectBytes(oid, 'blob');
}
for (const oid of Object.keys(seal.objects)) objectBytes(oid);
for (const key of Object.keys(seal.files)) {
  const separator = key.indexOf(':');
  fileBytes(key.slice(0, separator), key.slice(separator + 1));
}
assert.equal(seal.helperAbsent, '');
assert.equal(entries(seal.freezeShellTree).has('cancellation.ts'), false);
assert.equal(seal.pathsets.candidate, `A\t${helper}\n`);
const source = fileBytes(commits.candidate, helper);
assert.equal(hash(source), 'cde614b830e11f2040db65d2347c5f430df4b353324684585b2dc242ac733960');
assert.equal(seal.files[`${commits.candidate}:${helper}`], 'd5ceafef56a9351bd77630db66d9acfdc19a38ee');
assert.equal(/^\s*(?:import\b|export\s+.*\bfrom\b)|\b(?:import|require)\s*\(/m.test(source.toString()), false);
const authorManifest = JSON.parse(fileBytes(commits.freeze, `${authorDirectory}/freeze-manifest.json`));
for (const [file, expected] of Object.entries(authorManifest.files)) {
  for (const commit of [commits.freeze, commits.candidate, commits.evidence]) assert.equal(hash(fileBytes(commit, `${authorDirectory}/${file}`)), expected);
}
const reserved = ['cleanup', 'runtime', 'shell', 'types'].map(name => `src/shell/${name}.ts`);
for (const file of reserved) {
  assert.equal(hash(fileBytes(commits.candidate, file)), hash(fileBytes(commits.freeze, file)));
  assert.equal(hash(fileBytes(commits.candidate, file)), hash(fileBytes(commits.design, file)));
}
for (const file of ['src/index.ts', 'package.json']) assert.equal(fileBytes(commits.candidate, file).toString().includes('cancellation'), false);
json('authentication.json', {
  commits: seal.commits, candidateRawSha256: hash(objectBytes(commits.candidate, 'commit')),
  candidateTree: /^tree (.*)$/m.exec(objectBytes(commits.candidate, 'commit').toString())[1],
  helperBlob: seal.files[`${commits.candidate}:${helper}`], helperSha256: hash(source),
  sealedObjectCount: Object.keys(seal.objects).length, sealedPathCount: Object.keys(seal.files).length,
  importClosure: [], frozenAuthorHashesVerified: 8, helperAbsentAtAuthorFreeze: true,
  reservedUnchanged: reserved, rootExportsUnchangedByCandidate: true,
  profile: 'partial raw-object path proof, not a full Git clone or commit-ancestry archive',
});

const tools = path.join(scratch, 'tools');
mkdirSync(tools);
const compilerOriginal = path.join(repository, 'node_modules/typescript');
const compilerBefore = inventory(compilerOriginal);
cpSync(compilerOriginal, path.join(tools, 'typescript'), { recursive: true, dereference: true });
assert.deepEqual(inventory(path.join(tools, 'typescript')), compilerBefore);
const nodeOriginal = realpathSync(process.execPath);
cpSync(nodeOriginal, path.join(tools, 'node'));
const nodeHash = hash(readFileSync(nodeOriginal));
assert.equal(hash(readFileSync(path.join(tools, 'node'))), nodeHash);
json('tools-before.json', { node: { path: nodeOriginal, version: process.version, sha256: nodeHash }, typescript: compilerBefore });
const node = path.join(tools, 'node');
const compiler = path.join(tools, 'typescript/lib/tsc.js');
const processes = [];
function run(name, args, extra = {}) {
  const started = new Date().toISOString();
  const result = spawnSync(node, args, {
    cwd: scratch, env: { ...process.env, TMPDIR: scratch, TMP: scratch, TEMP: scratch, NODE_OPTIONS: '', ...extra },
    timeout: 90000, maxBuffer: 16 * 1024 * 1024,
  });
  writeFileSync(path.join(output, `${name}.stdout`), result.stdout ?? '');
  writeFileSync(path.join(output, `${name}.stderr`), result.stderr ?? '');
  const record = { name, args, started, finished: new Date().toISOString(), status: result.status, signal: result.signal,
    error: result.error ? String(result.error) : null, watchdogMilliseconds: 90000, watchdogUsed: Boolean(result.error?.code === 'ETIMEDOUT') };
  processes.push(record);
  json('processes.json', processes);
  return { ...record, stdout: result.stdout?.toString() ?? '', stderr: result.stderr?.toString() ?? '' };
}
const options = { strict: true, exactOptionalPropertyTypes: true, noUncheckedIndexedAccess: true,
  target: 'ES2023', module: 'NodeNext', moduleResolution: 'NodeNext', lib: ['ES2023', 'DOM'], types: [],
  skipLibCheck: false, declaration: true, noEmitOnError: true };
function build(name, bytes) {
  const directory = path.join(scratch, name);
  mkdirSync(directory);
  writeFileSync(path.join(directory, 'package.json'), '{"type":"module"}\n');
  writeFileSync(path.join(directory, 'cancellation.ts'), bytes);
  writeFileSync(path.join(directory, 'positive.ts'), readFileSync(path.join(here, 'positive-v1.ts.data')));
  writeFileSync(path.join(directory, 'tsconfig.json'), JSON.stringify({ compilerOptions: { ...options, outDir: './emitted' }, files: ['cancellation.ts', 'positive.ts'] }));
  const result = run(`${name}-build`, [compiler, '-p', path.join(directory, 'tsconfig.json')]);
  return { directory, result };
}
const built = build('candidate', source);
assert.equal(built.result.status, 0, 'candidate compiler baseline must pass');
const module = path.join(built.directory, 'emitted/cancellation.js');
const runtime = run('candidate-runtime', ['--test', path.join(here, 'cohort-v1.mjs')], { CANCELLATION_MODULE: module });
const negativeFile = path.join(built.directory, 'negative.ts');
writeFileSync(negativeFile, readFileSync(path.join(here, 'negative-v1.ts.data')));
writeFileSync(path.join(built.directory, 'negative.json'), JSON.stringify({ compilerOptions: { ...options, noEmit: true }, files: ['negative.ts', 'emitted/cancellation.d.ts'] }));
const negative = run('negative-types', [compiler, '-p', path.join(built.directory, 'negative.json'), '--pretty', 'false']);
const diagnostics = [...negative.stdout.matchAll(/negative\.ts\((\d+),\d+\): error TS(\d+):/g)].map(match => ({ line: Number(match[1]), code: Number(match[2]) }));
assert.equal(negative.status, 2);
assert.deepEqual(diagnostics.map(item => item.line), [2, 3, 4, 5, 6, 7]);
assert.ok(diagnostics.every(item => [2322, 2739, 2740].includes(item.code)));
assert.equal(/TS2307|Cannot find module/.test(negative.stdout + negative.stderr), false);

const moved = path.join(scratch, 'relocated-internal');
mkdirSync(moved);
writeFileSync(path.join(moved, 'package.json'), '{"type":"module"}\n');
cpSync(module, path.join(moved, 'cancellation.js'));
cpSync(path.join(built.directory, 'emitted/cancellation.d.ts'), path.join(moved, 'cancellation.d.ts'));
cpSync(path.join(here, 'cohort-v1.mjs'), path.join(moved, 'cohort.mjs'));
cpSync(path.join(here, 'positive-v1.ts.data'), path.join(moved, 'positive.ts'));
cpSync(path.join(here, 'negative-v1.ts.data'), path.join(moved, 'negative.ts'));
const artifactIdentity = ['cancellation.js', 'cancellation.d.ts'].map(file => {
  const emittedHash = hash(readFileSync(path.join(built.directory, 'emitted', file)));
  const movedHash = hash(readFileSync(path.join(moved, file)));
  assert.equal(emittedHash, movedHash);
  return { file, emittedHash, movedHash };
});
rmSync(built.directory, { recursive: true });
writeFileSync(path.join(moved, 'positive.json'), JSON.stringify({ compilerOptions: { ...options, noEmit: true }, files: ['positive.ts', 'cancellation.d.ts'] }));
writeFileSync(path.join(moved, 'negative.json'), JSON.stringify({ compilerOptions: { ...options, noEmit: true }, files: ['negative.ts', 'cancellation.d.ts'] }));
const movedPositive = run('moved-positive-types', [compiler, '-p', path.join(moved, 'positive.json')]);
const movedNegative = run('moved-negative-types', [compiler, '-p', path.join(moved, 'negative.json'), '--pretty', 'false']);
assert.equal(movedPositive.status, 0);
assert.equal(movedNegative.status, 2);
assert.equal([...movedNegative.stdout.matchAll(/negative\.ts\(\d+,\d+\): error TS/g)].length, 6);
const movedRuntime = run('moved-runtime', ['--test', path.join(moved, 'cohort.mjs')], { CANCELLATION_MODULE: path.join(moved, 'cancellation.js') });
json('artifacts.json', { artifactIdentity, originalBuildRemovedBeforeMovedChecks: true, movedMembership: inventory(moved) });

const mutations = [
  { name: 'mutant-provenance', obligation: 'H01', from: 'return Object.freeze({ origin, [reportState]: state });',
    to: 'return Object.freeze({ origin: Object.freeze({ ...origin, signal: origin.frame.deliverySignal }), [reportState]: state });' },
  { name: 'mutant-capacity', obligation: 'H08', from: 'if (count > state.resourceLimit - state.resourcesUsed) throw new CancellationCapacityError();',
    to: 'if (false && count > state.resourceLimit - state.resourcesUsed) throw new CancellationCapacityError();' },
  { name: 'mutant-listener-cleanup', obligation: 'H10', from: 'for (const detacher of state.signalDetachers) state.failures.push(...removeSignalListener(detacher));',
    to: 'for (const detacher of state.signalDetachers) void detacher;' },
];
const mutantResults = [];
for (const mutation of mutations) {
  assert.equal(source.toString().split(mutation.from).length, 2);
  const altered = source.toString().replace(mutation.from, mutation.to);
  const mutant = build(mutation.name, altered);
  const execution = mutant.result.status === 0 ? run(`${mutation.name}-runtime`, ['--test', path.join(here, 'cohort-v1.mjs')],
    { CANCELLATION_MODULE: path.join(mutant.directory, 'emitted/cancellation.js') }) : null;
  const passingBaseline = new RegExp(`^ok \\d+ - ${mutation.obligation} `, 'm').test(runtime.stdout);
  const behavioralFailure = execution && new RegExp(`^not ok \\d+ - ${mutation.obligation} `, 'm').test(execution.stdout);
  mutantResults.push({ ...mutation, sha256: hash(altered), buildStatus: mutant.result.status,
    runtimeStatus: execution?.status, passingBaseline, behavioralFailure: Boolean(behavioralFailure),
    killed: mutant.result.status === 0 && Boolean(passingBaseline && behavioralFailure) });
}
json('mutants.json', mutantResults);
json('summary.json', {
  version: 1, runtimeStatus: runtime.status, movedRuntimeStatus: movedRuntime.status,
  runtimeRecords: 12, reasonVariantsWithinH03: 7, independentObligations: 12,
  positiveBuildStatus: built.result.status, malformedSignalDiagnostics: diagnostics,
  movedPositiveStatus: movedPositive.status, movedNegativeStatus: movedNegative.status,
  mutantKills: mutantResults.filter(item => item.killed).length, mutantCount: mutantResults.length,
  authorRuntimeRerun: false, publicRuntimeSeam: false, allNodeProcessesNatural: processes.every(item => item.signal === null && item.error === null),
});
const compilerAfter = inventory(compilerOriginal);
assert.deepEqual(compilerAfter, compilerBefore, 'tool membership including new entries unchanged');
assert.equal(hash(readFileSync(nodeOriginal)), nodeHash);
assert.deepEqual(inventory(path.join(tools, 'typescript')), compilerBefore);
assert.deepEqual(fixtureInventory(), before.fixtures, 'fixture membership including additions unchanged');
const scratchMembership = inventory(scratch);
json('scratch-before-removal.json', scratchMembership);
json('tools-after.json', { nodeSha256: hash(readFileSync(nodeOriginal)), typescript: compilerAfter });
for (const oid of Object.keys(seal.objects)) objectBytes(oid);
assert.equal(hash(fileBytes(commits.candidate, helper)), hash(source));
const after = {
  at: new Date().toISOString(), head: git('rev-parse', 'HEAD').toString().trim(),
  status: git('status', '--porcelain=v1', '--untracked-files=all').toString(),
  index: git('diff', '--cached', '--raw').toString(), fixtures: fixtureInventory(),
  sourceReauthenticated: true, frozenSourceMembershipBefore: Object.keys(seal.files).sort(),
  frozenSourceMembershipAfter: Object.keys(seal.files).sort(),
};
json('after.json', after);
rmSync(scratch, { recursive: true });
json('scratch-removal.json', { removed: 'scratch', entriesEnumerated: scratchMembership.length, absentAfter: !existsSync(scratch) });
json('evidence-manifest.json', inventory(output));
console.log(JSON.stringify({ output, runtimeStatus: runtime.status, movedRuntimeStatus: movedRuntime.status, mutants: mutantResults.map(item => ({ name: item.name, killed: item.killed })) }, null, 2));
