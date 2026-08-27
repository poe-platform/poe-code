import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { cp, lstat, mkdir, mkdtemp, readFile, readdir, readlink, realpath, rm, unlink, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const repo = '/Users/kjopek/Workspace/safe-bash';
assert.equal(process.cwd(), repo);
const own = dirname(import.meta.filename);
const output = resolve(process.argv[3] ?? own);
assert.ok(output === own || output.startsWith('/tmp/'));
const source = 'c7823633ee99f711f1319ace59d4cf2b7f622ecc';
const historical = '61c66bc';
const original = 'd904ca986fa945df8aef6e11b4165e2c2a63f814';
const datePath = 'tests/commands/time-env/date.test.ts';
const packed = 'tests/commands/time-env-stress/fraction-independent/packed';
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const git = args => execFileSync('git', args, { cwd: repo, maxBuffer: 32 * 1024 * 1024 });
const pinned = (revision, path) => git(['show', `${revision}:${path}`]);
const json = bytes => JSON.parse(bytes.toString());
const save = async (path, value) => {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, typeof value === 'string' || Buffer.isBuffer(value) ? value : JSON.stringify(value, null, 2) + '\n', { flag: 'wx' });
};
async function fileHash(path) {
  const digest = createHash('sha256');
  for await (const chunk of createReadStream(path)) digest.update(chunk);
  return digest.digest('hex');
}
async function entryHash(root, path) {
  const metadata = await lstat(join(root, path));
  return metadata.isSymbolicLink() ? `symlink:${await readlink(join(root, path))}` : fileHash(join(root, path));
}
async function snapshot(root, paths) {
  const result = {};
  for (const path of paths) result[path] = await entryHash(root, path);
  return result;
}
const digestRows = rows => hash(Object.entries(rows).map(([path, digest]) => path + '\0' + digest + '\n').join(''));
const differences = (before, after) => Object.keys(before).filter(path => before[path] !== after[path]).map(path => ({ path, before: before[path], after: after[path] }));
const fixturePaths = git(['ls-tree', '-r', '--name-only', original, '--', 'tests/commands/time-env']).toString().trim().split('\n');
const tests = fixturePaths.filter(path => path.endsWith('.test.ts'));
const supporting = ['helpers.ts', 'date-cases.ts', 'tsconfig.json'].map(name => `tests/commands/time-env/${name}`);
const core = git(['ls-tree', '-r', '--name-only', source, '--', 'src', 'package.json', 'package-lock.json', 'tsconfig.json', 'tsconfig.build.json']).toString().trim().split('\n');

if (process.argv[2] === 'prepare') {
  const scratch = await mkdtemp('/tmp/safe-bash-fraction-canonical-');
  const paths = git(['ls-files', '-z']).toString().split('\0').filter(path => path && path !== datePath && !path.startsWith('tests/commands/time-env-stress/fraction-independent/canonical/'));
  const guards = await snapshot(repo, paths);
  await save(join(scratch, 'worktree-before.json'), guards);
  const before = pinned(original, datePath);
  assert.deepEqual(before, pinned(source, datePath));
  const references = {};
  for (const [revision, path] of [
    ['c9b9626', 'tests/commands/time-env-stress/fraction-independent/semantics/README.md'],
    ['c9b9626', 'tests/commands/time-env-stress/fraction-independent/semantics/SOURCE_PROOF.md'],
    ['c9b9626', 'tests/commands/time-env-stress/fraction-independent/semantics/canonical-native-proposals.json'],
    [historical, `${packed}/README.md`],
    [historical, `${packed}/evidence-final/source-original223.json`],
    [historical, `${packed}/evidence-final/source-original223.stdout`],
    [historical, `${packed}/evidence-final/source-original223.stderr`],
    [historical, `${packed}/evidence-final/manifest.json`],
  ]) references[`${git(['rev-parse', revision]).toString().trim()}:${path}`] = hash(pinned(revision, path));
  await save(join(output, 'date.before.ts.txt'), before);
  await save(join(output, 'BEFORE.json'), {
    capturedAt: new Date().toISOString(), source, sourceTree: git(['rev-parse', `${source}^{tree}`]).toString().trim(),
    originalFixtureRevision: original, historicalReviewRevision: git(['rev-parse', historical]).toString().trim(),
    head: git(['rev-parse', 'HEAD']).toString().trim(), status: git(['status', '--short']).toString(),
    staged: git(['diff', '--cached', '--raw']).toString(), scratch, guardedPaths: paths.length,
    worktreeGuardSha256: digestRows(guards), dateBeforeSha256: hash(before), references,
  });
  console.log(`Prepared byte guards: ${paths.length} tracked paths; scratch ${scratch}`);
} else if (process.argv[2] === 'replay') {
  const before = json(await readFile(join(output, 'BEFORE.json')));
  const scratch = before.scratch;
  assert.match(scratch, /^\/tmp\/safe-bash-fraction-canonical-[a-zA-Z0-9]+$/);
  const archive = join(scratch, 'archive');
  const report = { source, startedAt: new Date().toISOString(), scratch, commands: {}, versions: process.versions, platform: process.platform, architecture: process.arch };
  const packedManifest = json(pinned(historical, `${packed}/evidence-final/manifest.json`));
  const worktreeBefore = json(await readFile(join(scratch, 'worktree-before.json')));
  const afterBytes = await readFile(join(repo, datePath));
  const beforeBytes = await readFile(join(output, 'date.before.ts.txt'));
  assert.equal(hash(beforeBytes), before.dateBeforeSha256);
  assert.notDeepEqual(afterBytes, beforeBytes);
  const migratedBlock = afterBytes.toString().match(/test\("date %12N zero-padding at epoch matches the accepted GNU9\.7 profile"[\s\S]*?(?=for \(const args of \[)/)?.[0];
  assert.ok(migratedBlock);
  assert.equal((migratedBlock.match(/^test\(/gm) ?? []).length, 2);
  assert.equal(afterBytes.toString().replace(migratedBlock, ''), beforeBytes.toString().replace(', ["-d@0", "+%12N"], ["-d@0", "+%-N"]', ''));
  await save(join(output, 'date.after.ts.txt'), afterBytes);
  await save(join(output, 'date.patch'), git(['diff', '--no-ext-diff', source, '--', datePath]));
  try {
    const tar = join(scratch, 'full-source.tar');
    git(['archive', '--format=tar', '--output', tar, source]);
    report.archive = { sha256: await fileHash(tar), bytes: (await lstat(tar)).size };
    assert.equal(report.archive.sha256, packedManifest.archive.sha256);
    await mkdir(archive);
    execFileSync('/usr/bin/tar', ['-xf', tar, '-C', archive]);
    const tracked = git(['ls-tree', '-rz', source]).toString().split('\0').filter(Boolean).map(entry => entry.split('\t')[1]);
    const archivedBefore = await snapshot(archive, tracked);
    assert.equal(digestRows(archivedBefore), packedManifest.trackedArchive.orderedPathAndHashSha256);
    report.originalArchive = { paths: tracked.length, sha256: digestRows(archivedBefore) };
    const sourceHashes = await snapshot(archive, core);
    for (const path of core) assert.equal(sourceHashes[path], hash(pinned(source, path)), path);
    const fixtures = {};
    for (const path of [...tests, ...supporting]) {
      const bytes = pinned(original, path);
      assert.equal(archivedBefore[path], hash(bytes), path);
      fixtures[path] = { originalSha256: hash(bytes), candidateSha256: path === datePath ? hash(afterBytes) : hash(bytes) };
    }
    await writeFile(join(archive, datePath), afterBytes);
    await cp(join(repo, 'node_modules'), join(archive, 'node_modules'), { recursive: true, dereference: true });
    report.tools = {};
    for (const path of ['typescript/lib/_tsc.js', 'typescript/package.json', 'tsx/package.json', 'tsx/dist/loader.mjs', '@types/node/package.json']) report.tools[path] = await fileHash(join(archive, 'node_modules', path));
    report.tools.node = { path: process.execPath, sha256: await fileHash(process.execPath) };
    report.native = {};
    for (const name of ['date', 'sleep', 'printenv']) {
      const path = `tests/commands/metadata-stress/.oracle/coreutils-9.7/src/${name}`;
      assert.equal(tracked.includes(path), false);
      await mkdir(dirname(join(archive, path)), { recursive: true });
      await cp(join(repo, path), join(archive, path), { dereference: true });
      const sha256 = await fileHash(join(archive, path));
      assert.equal(sha256, packedManifest.native[name].sha256);
      report.native[name] = { path, sha256, priorVersion: packedManifest.native[name].version };
    }
    const supervisorPath = 'tests/integration/full-gate-20260827/supervise.mjs';
    const supervisorBytes = pinned(historical, supervisorPath);
    await save(join(scratch, 'supervise.mjs'), supervisorBytes);
    report.supervisor = { revision: before.historicalReviewRevision, path: supervisorPath, sha256: hash(supervisorBytes) };
    const { supervise } = await import(pathToFileURL(join(scratch, 'supervise.mjs')).href);
    await mkdir(join(scratch, 'tmp'));
    const env = { PATH: '/usr/bin:/bin', HOME: scratch, TMPDIR: join(scratch, 'tmp'), LC_ALL: 'C', LANG: 'C', TZ: 'Pacific/Honolulu', TSX_DISABLE_CACHE: '1' };
    const runtimeArgs = ['--unhandled-rejections=strict', '--import', 'tsx', '--test', '--test-concurrency=1', '--test-timeout=30000', ...tests];
    await save(join(output, 'FREEZE.json'), {
      frozenAt: new Date().toISOString(), source, archive: report.archive, originalArchive: report.originalArchive,
      sourceHashes, fixtures, tests, originalCount: 223, expectedCandidateCount: 223,
      beforeSha256: hash(beforeBytes), afterSha256: hash(afterBytes), patchSha256: await fileHash(join(output, 'date.patch')),
      testOverlayOnly: datePath, env, runtimeArgs, typecheckArgs: ['node_modules/typescript/bin/tsc', '-p', 'tests/commands/time-env/tsconfig.json', '--noEmit'],
      profiles: ['%12N at @0: accepted GNU9.7 zero-padding match', 'bare %-N at @0: ordinary-formatter virtual-clock policy; not exact GNU9.7/Darwin parity'],
      tools: report.tools, native: report.native, supervisor: report.supervisor,
    });
    async function execute(label, args) {
      const stdout = join(output, `${label}.stdout`), stderr = join(output, `${label}.stderr`);
      const result = await supervise(process.execPath, args, { cwd: archive, env, stdout, stderr, timeoutMs: 120000, maxOutputBytes: 16 * 1024 * 1024 });
      const text = await readFile(stdout, 'utf8');
      result.counts = Object.fromEntries([...text.matchAll(/^# (tests|pass|fail|skipped|cancelled|todo) (\d+)$/gm)].map(match => [match[1], Number(match[2])]));
      result.stdoutSha256 = await fileHash(stdout); result.stderrSha256 = await fileHash(stderr);
      report.commands[label] = result;
      await save(join(output, `${label}.json`), result);
      console.log(label, result.status, result.counts);
      assert.equal(result.clean, true);
      return result;
    }
    const runtime = await execute('canonical223', runtimeArgs);
    assert.equal(runtime.status, 0, 'STOP: canonical cohort failure');
    assert.deepEqual(runtime.counts, { tests: 223, pass: 223, fail: 0, cancelled: 0, skipped: 0, todo: 0 });
    const types = await execute('scoped-types', ['node_modules/typescript/bin/tsc', '-p', 'tests/commands/time-env/tsconfig.json', '--noEmit']);
    report.typecheckPassed = types.status === 0;
    const archivedAfter = await snapshot(archive, tracked);
    report.archiveChanges = differences(archivedBefore, archivedAfter);
    assert.deepEqual(report.archiveChanges, [{ path: datePath, before: hash(beforeBytes), after: hash(afterBytes) }]);
    report.sourceAfterSha256 = digestRows(await snapshot(archive, core));
    assert.equal(report.sourceAfterSha256, digestRows(sourceHashes));
    report.archiveAfterSha256 = digestRows(archivedAfter);
  } catch (error) {
    report.failure = String(error.stack ?? error);
    process.exitCode = 1;
  } finally {
    const cacheRoot = `/tmp/tsx-${process.geteuid()}`;
    const sourceRoot = await realpath(archive).catch(() => archive) + '/src/';
    report.cacheCleanup = [];
    for (const name of await readdir(cacheRoot).catch(error => { if (error.code === 'ENOENT') return []; throw error; })) {
      const path = join(cacheRoot, name);
      const metadata = await lstat(path);
      if (!metadata.isFile() || metadata.size > 2 * 1024 * 1024) continue;
      const bytes = await readFile(path);
      if (!bytes.includes(scratch)) continue;
      const entry = json(bytes);
      assert.ok(entry.map.sources.length > 0 && entry.map.sources.every(value => value.startsWith(sourceRoot)), path);
      assert.equal((await lstat(path)).ino, metadata.ino);
      assert.equal(await fileHash(path), hash(bytes));
      report.cacheCleanup.push({ path, sha256: hash(bytes), sources: entry.map.sources });
      await unlink(path);
    }
    const worktreeAfter = await snapshot(repo, Object.keys(worktreeBefore));
    report.worktreeGuards = { paths: Object.keys(worktreeBefore).length, beforeSha256: digestRows(worktreeBefore), afterSha256: digestRows(worktreeAfter), changes: differences(worktreeBefore, worktreeAfter) };
    report.stagedBefore = before.staged;
    report.stagedAfter = git(['diff', '--cached', '--raw']).toString();
    report.headAfter = git(['rev-parse', 'HEAD']).toString().trim();
    await rm(scratch, { recursive: true });
    await assert.rejects(lstat(scratch), { code: 'ENOENT' });
    report.cleanedOwnedScratch = true;
    report.finishedAt = new Date().toISOString();
    await save(join(output, 'RESULTS.json'), report);
    console.log(JSON.stringify({ failure: report.failure ?? null, worktreeGuardChanges: report.worktreeGuards.changes, cleanedOwnedScratch: true }));
  }
} else {
  throw new Error('Usage: node replay.mjs prepare|replay [new /tmp/evidence-directory]');
}
