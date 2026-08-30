import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { createReadStream } from 'node:fs';
import { cp, lstat, mkdir, mkdtemp, readFile, readdir, readlink, realpath, rm, unlink, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { pathToFileURL } from 'node:url';

const repo = '/Users/kjopek/Workspace/safe-bash';
assert.equal(process.cwd(), repo);
const own = dirname(import.meta.filename);
const source = 'c7823633ee99f711f1319ace59d4cf2b7f622ecc';
const candidate = 'f5341340bcbc9e4c4d46d6eb3f1759da73713097';
const original = 'd904ca986fa945df8aef6e11b4165e2c2a63f814';
const previous = '61c66bca1212ad511af2ce057f866c8839027b8a';
const datePath = 'tests/commands/time-env/date.test.ts';
const authorRoot = 'tests/commands/time-env-stress/fraction-independent/canonical/';
const identity = { reviewer: '01a0426e-7ffc-75e2-97a7-2c875e1a0afb', migrationAuthor: '01a0427f-0535-7e03-83e8-eac693a4d417', role: 'Independent semantics reviewer; not migration author or Curie; no delegation' };
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const git = args => execFileSync('/usr/bin/git', args, { cwd: repo, timeout: 60000, maxBuffer: 32 * 1024 * 1024 });
const pinned = (revision, path) => git(['show', revision + ':' + path]);
const save = (name, value) => writeFile(join(own, name), Buffer.isBuffer(value) || typeof value === 'string' ? value : JSON.stringify(value, null, 2) + '\n', { flag: 'wx' });
async function fileHash(path) {
  const digest = createHash('sha256');
  for await (const bytes of createReadStream(path)) digest.update(bytes);
  return digest.digest('hex');
}
async function snapshot(root, paths) {
  const result = {};
  for (const path of paths) {
    const metadata = await lstat(join(root, path));
    result[path] = metadata.isSymbolicLink() ? 'symlink:' + await readlink(join(root, path)) : await fileHash(join(root, path));
  }
  return result;
}
const digest = rows => hash(Object.entries(rows).map(([path, sha256]) => path + '\0' + sha256 + '\n').join(''));
async function regularTree(root, prefix = '') {
  const result = {};
  for (const entry of (await readdir(join(root, prefix), { withFileTypes: true })).sort((left, right) => left.name.localeCompare(right.name))) {
    const path = join(prefix, entry.name);
    if (entry.isDirectory()) Object.assign(result, await regularTree(root, path));
    else { assert.ok(entry.isFile(), 'prerequisite must be regular: ' + path); result[path] = await fileHash(join(root, path)); }
  }
  return result;
}
assert.equal(git(['rev-parse', 'f534134^{commit}']).toString().trim(), candidate);
const delta = git(['diff-tree', '--no-commit-id', '--name-status', '-r', candidate]).toString().trim().split('\n').map(line => line.split('\t'));
assert.deepEqual(delta.filter(([status]) => status !== 'A'), [['M', datePath]]);
assert.ok(delta.filter(([status]) => status === 'A').every(([, path]) => path.startsWith(authorRoot)));
const before = pinned(source, datePath), after = pinned(candidate, datePath);
assert.deepEqual(before, pinned(original, datePath));
assert.equal(hash(after), '91065b8d1b9e7cf08e34fb40d44e4307286040ba11ce14ae13c1ec8c015c8b67');
const patch = git(['diff', '--no-ext-diff', candidate + '^', candidate, '--', datePath]);
assert.equal(hash(patch), 'bd1f5a6270e7c96e6c2a9f8cad0c254bb8619957117920634f0ee486d2518e07');
const block = after.toString().match(/test\("date %12N zero-padding[\s\S]*?(?=for \(const args of \[)/)?.[0];
assert.ok(block);
assert.equal((block.match(/^test\(/gm) ?? []).length, 2);
assert.equal(after.toString().replace(block, ''), before.toString().replace(', ["-d@0", "+%12N"], ["-d@0", "+%-N"]', ''));
assert.equal((block.match(/assert\.deepEqual\(Buffer\.concat\(stderr\), Buffer\.alloc\(0\)\)/g) ?? []).length, 2);
assert.ok(!/\b(?:skip|todo|only)\s*[:(]/.test(block));
await save('candidate.patch', patch);
const authorFreeze = JSON.parse(pinned(candidate, authorRoot + 'FREEZE.json'));
const tests = git(['ls-tree', '-r', '--name-only', original, '--', 'tests/commands/time-env']).toString().trim().split('\n').filter(path => path.endsWith('.test.ts'));
assert.deepEqual(tests, authorFreeze.tests);
const tracked = git(['ls-tree', '-r', '--name-only', source]).toString().trim().split('\n');
const core = tracked.filter(path => path.startsWith('src/') || ['package.json', 'package-lock.json', 'tsconfig.json', 'tsconfig.build.json'].includes(path));
const protectedPaths = git(['ls-files', '--', 'src', 'package.json', 'package-lock.json', 'tsconfig.json', 'tsconfig.build.json', 'tests/commands/time-env',
  'tests/commands/time-env-stress/fraction-independent/semantics', 'tests/commands/time-env-stress/fraction-independent/packed', authorRoot]).toString().trim().split('\n');
const protectedBefore = await snapshot(repo, protectedPaths);
const scratch = await mkdtemp('/tmp/safe-bash-canonical-independent-');
const archive = join(scratch, 'archive');
const report = { identity, source, candidate, startedAt: new Date().toISOString(), scratch, candidateSha256: hash(after), diffSha256: hash(patch),
  commitPaths: delta, commands: {}, originalTests: tests, originalSemantics312NotRerun: true, retries: 0,
  before: { head: git(['rev-parse', 'HEAD']).toString().trim(), status: git(['status', '--short']).toString(), staged: git(['diff', '--cached', '--raw']).toString() } };
let archivedBefore;
try {
  const tar = join(scratch, 'full-source.tar');
  git(['archive', '--format=tar', '--output', tar, source]);
  report.archive = { sha256: await fileHash(tar), bytes: (await lstat(tar)).size };
  assert.equal(report.archive.sha256, '4ba2f44723111446087b45a56269492492b34fa88df21b007a50aabf38e21530');
  await mkdir(archive);
  execFileSync('/usr/bin/tar', ['-xf', tar, '-C', archive], { timeout: 120000 });
  archivedBefore = await snapshot(archive, tracked);
  for (const path of core) assert.equal(archivedBefore[path], hash(pinned(source, path)), path);
  for (const path of [...tests, ...['helpers.ts', 'date-cases.ts', 'tsconfig.json'].map(name => 'tests/commands/time-env/' + name)]) {
    assert.equal(archivedBefore[path], hash(pinned(original, path)), path);
  }
  await writeFile(join(archive, datePath), after);
  await cp(join(repo, 'node_modules'), join(archive, 'node_modules'), { recursive: true, dereference: true });
  const dependencies = await regularTree(join(archive, 'node_modules'));
  for (const [path, expected] of Object.entries(authorFreeze.tools)) {
    if (path === 'node') { assert.equal(await fileHash(process.execPath), expected.sha256); continue; }
    assert.equal(dependencies[path], expected, path);
  }
  const native = {};
  for (const [name, expected] of Object.entries(authorFreeze.native)) {
    assert.ok(!tracked.includes(expected.path));
    await mkdir(dirname(join(archive, expected.path)), { recursive: true });
    await cp(join(repo, expected.path), join(archive, expected.path), { dereference: true });
    assert.equal(await fileHash(join(archive, expected.path)), expected.sha256);
    native[name] = { path: expected.path, sha256: expected.sha256 };
  }
  const supervisorBytes = pinned(previous, 'tests/integration/full-gate-20260827/supervise.mjs');
  assert.equal(hash(supervisorBytes), 'e68ef77eb0ad1610177521a1aeab9f6f189e47de47476dafcab7ad05097ebfb9');
  await writeFile(join(scratch, 'supervise.mjs'), supervisorBytes, { flag: 'wx' });
  const { supervise } = await import(pathToFileURL(join(scratch, 'supervise.mjs')).href);
  await cp(join(own, 'guard.mjs'), join(scratch, 'guard.mjs'));
  const guardHashes = { ...archivedBefore, [datePath]: hash(after), ...Object.fromEntries(Object.entries(dependencies).map(([path, sha256]) => ['node_modules/' + path, sha256])) };
  const guardConfig = { archive: await realpath(archive), log: join(own, 'runtime-imports.jsonl'), hashes: guardHashes, forbidden: pathToFileURL(join(repo, 'src/index.ts')).href };
  await writeFile(join(scratch, 'guard-config.json'), JSON.stringify(guardConfig));
  await mkdir(join(scratch, 'tmp'));
  const env = { PATH: '/usr/bin:/bin', HOME: scratch, TMPDIR: join(scratch, 'tmp'), LC_ALL: 'C', LANG: 'C', TZ: 'Pacific/Honolulu', TSX_DISABLE_CACHE: '1' };
  const runtimeArgs = ['--unhandled-rejections=strict', '--import', pathToFileURL(join(scratch, 'guard.mjs')).href, ...authorFreeze.runtimeArgs.slice(1)];
  await save('FREEZE.json', { identity, source, candidate, frozenAt: new Date().toISOString(), archive: report.archive,
    trackedPaths: tracked.length, archiveBeforeSha256: digest(archivedBefore), core: Object.fromEntries(core.map(path => [path, archivedBefore[path]])),
    fixtures: Object.fromEntries([...tests, 'tests/commands/time-env/helpers.ts', 'tests/commands/time-env/date-cases.ts', 'tests/commands/time-env/tsconfig.json'].map(path => [path, guardHashes[path]])),
    expectedCounts: { tests: 223, pass: 223, fail: 0, cancelled: 0, skipped: 0, todo: 0 }, env, runtimeArgs, typecheckArgs: authorFreeze.typecheckArgs,
    guardSha256: await fileHash(join(own, 'guard.mjs')), guardConfigSha256: await fileHash(join(scratch, 'guard-config.json')),
    dependencyTreeSha256: digest(dependencies), supervisorSha256: hash(supervisorBytes), native, node: { version: process.version, sha256: await fileHash(process.execPath) },
    profileDifference: 'Same source/tests/development/native/profile as author, except owned HOME/TMPDIR and an independent preloaded hash/import guard. No extra behavioral cases.' });
  for (const [label, args] of [['canonical223', runtimeArgs], ['scoped-types', authorFreeze.typecheckArgs]]) {
    const result = await supervise(process.execPath, args, { cwd: archive, env, stdout: join(own, label + '.stdout'), stderr: join(own, label + '.stderr'), timeoutMs: 120000, maxOutputBytes: 16 * 1024 * 1024 });
    const stdout = await readFile(join(own, label + '.stdout'), 'utf8');
    result.counts = Object.fromEntries(['tests', 'pass', 'fail', 'cancelled', 'skipped', 'todo'].flatMap(key => {
      const match = stdout.match(new RegExp('^# ' + key + ' (\\d+)$', 'm')); return match ? [[key, Number(match[1])]] : [];
    }));
    await save(label + '.json', result); report.commands[label] = result;
    console.log(label, result.status, result.counts);
    assert.equal(result.clean, true, 'process cleanup must not rescue acceptance');
    assert.equal(result.status, 0, 'STOP: candidate verification failure');
    if (label === 'canonical223') assert.deepEqual(result.counts, { tests: 223, pass: 223, fail: 0, cancelled: 0, skipped: 0, todo: 0 });
  }
  const imports = (await readFile(join(own, 'runtime-imports.jsonl'), 'utf8')).trim().split('\n').map(JSON.parse);
  const loaded = new Set(imports.filter(row => row.phase === 'load').map(row => row.path));
  for (const path of [...tests, 'tests/commands/time-env/helpers.ts', 'src/commands/time-env/format.ts', 'src/commands/time-env/date.ts', 'src/commands/time-env/calendar.ts']) assert.ok(loaded.has(path), 'missing actual runtime load: ' + path);
  report.imports = { rows: imports.length, loadedPaths: [...loaded].sort(), negativeControls: imports.filter(row => row.phase === 'negative-control'), sha256: await fileHash(join(own, 'runtime-imports.jsonl')) };
  report.accepted = true;
} catch (error) {
  report.failure = String(error.stack ?? error); report.accepted = false; process.exitCode = 1;
  await writeFile('/tmp/safe-bash-fraction-canonical-review-final.txt', `NOT ACCEPTED: ${report.failure}\nSource ${source}; candidate ${candidate}; no fix/retry.\n`);
} finally {
  if (archivedBefore) {
    const archivedAfter = await snapshot(archive, tracked);
    report.archiveChanges = tracked.filter(path => archivedBefore[path] !== archivedAfter[path]).map(path => ({ path, before: archivedBefore[path], after: archivedAfter[path] }));
    assert.deepEqual(report.archiveChanges, [{ path: datePath, before: hash(before), after: hash(after) }]);
    report.archiveBeforeSha256 = digest(archivedBefore); report.archiveAfterSha256 = digest(archivedAfter);
  }
  report.cacheCleanup = [];
  const cacheRoot = '/tmp/tsx-' + process.geteuid();
  const ownedRoot = (await realpath(archive).catch(() => archive)) + '/';
  for (const name of await readdir(cacheRoot).catch(error => { if (error.code === 'ENOENT') return []; throw error; })) {
    const path = join(cacheRoot, name), metadata = await lstat(path);
    if (!metadata.isFile() || metadata.size > 2 * 1024 * 1024) continue;
    const bytes = await readFile(path);
    if (!bytes.includes(scratch)) continue;
    const entry = JSON.parse(bytes);
    assert.ok(entry.map.sources.length && entry.map.sources.every(value => value.startsWith(ownedRoot)), 'refuse foreign/mixed cache entry');
    assert.equal((await lstat(path)).ino, metadata.ino); assert.equal(await fileHash(path), hash(bytes));
    report.cacheCleanup.push({ path, sha256: hash(bytes), sources: entry.map.sources }); await unlink(path);
  }
  const protectedAfter = await snapshot(repo, protectedPaths);
  report.readonlyGuards = { paths: protectedPaths.length, beforeSha256: digest(protectedBefore), afterSha256: digest(protectedAfter), changes: protectedPaths.filter(path => protectedBefore[path] !== protectedAfter[path]) };
  assert.deepEqual(report.readonlyGuards.changes, []);
  await rm(scratch, { recursive: true });
  await assert.rejects(lstat(scratch), { code: 'ENOENT' });
  report.cleanedScratch = true; report.finishedAt = new Date().toISOString();
  report.after = { head: git(['rev-parse', 'HEAD']).toString().trim(), staged: git(['diff', '--cached', '--raw']).toString() };
  await save('RESULTS.json', report);
  console.log(JSON.stringify({ accepted: report.accepted, failure: report.failure ?? null, changes: report.archiveChanges, readonly: report.readonlyGuards, cleanedScratch: report.cleanedScratch }));
}
