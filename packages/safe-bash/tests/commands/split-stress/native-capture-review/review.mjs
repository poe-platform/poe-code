import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import * as fs from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { setTimeout } from 'node:timers/promises';

const scope = dirname(fileURLToPath(import.meta.url));
const root = fileURLToPath(new URL('../../../../', import.meta.url));
const candidate = '46abd8792bee106b0a339a3e37f238604a2405ba';
const suite = 'tests/commands/split';
const frozen = 'tests/integration/full-gate-20260827/combined-8670ebe8';
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const canonical = ['native.test.ts', 'native-errors.test.ts'];
const gnuRelative = 'tests/commands/metadata-stress/.oracle/coreutils-9.7/src/split';
const pins = [
  { path: gnuRelative, hash: 'cf5851c4e6566983ce69940b766c0b5eb0cd26ebf2bb45eefe215b2d5c62f958' },
  { path: '/usr/bin/split', hash: '7c2d5f3c73e849d664bad3a2f4c67c5154b0f03f59f2fa779d49e33dc7983f91' },
];
function command(executable, args, options = {}) {
  const result = spawnSync(executable, args, { cwd: root, maxBuffer: 100 * 1024 * 1024, ...options });
  assert.equal(result.status, 0, `${executable} ${args.join(' ')}: ${result.stderr}`);
  return result.stdout;
}
function git(...args) { return command('git', args); }
async function publish(name, content) {
  const text = typeof content === 'string' ? content : JSON.stringify(content, null, 2) + '\n';
  command('apply_patch', [], { input: `*** Begin Patch\n*** Add File: ${join(scope, name)}\n${text.trimEnd().split('\n').map(line => '+' + line).join('\n')}\n*** End Patch\n` });
}
async function witness(path) {
  const stat = await fs.lstat(path);
  return { mode: stat.mode & 0o7777, size: stat.size, sha256: hash(stat.isSymbolicLink() ? await fs.readlink(path) : await fs.readFile(path)), ...(stat.isSymbolicLink() ? { link: await fs.readlink(path) } : {}) };
}
async function tree(directory) {
  const result = {};
  async function visit(path) {
    const stat = await fs.lstat(path);
    const name = relative(directory, path);
    if (stat.isDirectory()) {
      result[name] = { mode: stat.mode & 0o7777, directory: true };
      for (const entry of (await fs.readdir(path)).sort()) await visit(join(path, entry));
    } else result[name] = await witness(path);
  }
  await visit(directory);
  return result;
}
async function liveSnapshot() {
  const tracked = git('ls-files', '-z', '--', 'src', suite, frozen, 'package.json', 'package-lock.json', 'tsconfig.json', 'tsconfig.build.json').toString().split('\0').filter(Boolean);
  return { tracked: Object.fromEntries(await Promise.all(tracked.map(async path => [path, await witness(join(root, path))]))), splitTree: await tree(join(root, suite)), frozenTree: await tree(join(root, frozen)) };
}
async function qualifyNative() {
  const records = [];
  for (const pin of pins) {
    const path = pin.path.startsWith('/') ? pin.path : join(root, pin.path);
    try { const actual = await witness(path); records.push({ ...pin, actual, available: true, matches: actual.sha256 === pin.hash }); }
    catch (error) { records.push({ ...pin, available: false, error: String(error), matches: false }); }
  }
  return records;
}
if (process.argv[2] === 'prepare') {
  assert.equal(git('rev-parse', '--show-toplevel').toString().trim(), root.replace(/\/$/, ''));
  await assert.rejects(fs.access(join(scope, 'freeze.json')), { code: 'ENOENT' });
  const temporary = await fs.realpath(await fs.mkdtemp(join(tmpdir(), 'virtual-bash-split-independent-')));
  const copy = join(temporary, 'candidate');
  const mutant = join(temporary, 'reporting-control');
  const native = await qualifyNative();
  const entries = git('ls-tree', '-r', '-z', candidate, '--', 'src', suite, 'package.json', 'package-lock.json', 'tsconfig.json', 'tsconfig.build.json').toString().split('\0').filter(Boolean).map(line => {
    const [metadata, path] = line.split('\t');
    const [mode, type, blob] = metadata.split(' ');
    assert.equal(type, 'blob');
    return { mode, blob, path };
  });
  const inputs = {};
  for (const entry of entries) {
    assert.notEqual(entry.mode, '120000', 'unexpected source symlink');
    const bytes = git('cat-file', 'blob', entry.blob);
    const path = join(copy, entry.path);
    await fs.mkdir(dirname(path), { recursive: true });
    await fs.writeFile(path, bytes, { flag: 'wx', mode: parseInt(entry.mode, 8) & 0o777 });
    inputs[entry.path] = { ...entry, ...await witness(path) };
  }
  if (native[0].matches) {
    await fs.mkdir(dirname(join(copy, gnuRelative)), { recursive: true });
    await fs.copyFile(join(root, gnuRelative), join(copy, gnuRelative));
    await fs.chmod(join(copy, gnuRelative), native[0].actual.mode);
    assert.equal((await witness(join(copy, gnuRelative))).sha256, pins[0].hash);
  }
  await fs.cp(copy, mutant, { recursive: true, errorOnExist: true });
  for (const directory of [copy, mutant]) await fs.symlink(join(root, 'node_modules'), join(directory, 'node_modules'));
  const mutations = [
    { file: 'native.test.ts', original: 'try { assert.deepEqual(observed, expected); } catch { match = false; failed = true; }', replacement: 'try { assert.deepEqual(observed, expected); if (specimen.id === "default-empty") throw new Error("independent reporting-only control"); } catch { match = false; failed = true; }' },
    { file: 'native-errors.test.ts', original: '      assert.match(actual.stderr, specimen.virtualMessage);', replacement: '      assert.match(actual.stderr, specimen.virtualMessage);\n      if (specimen.id === "zero-lines") throw new Error("independent reporting-only control");' },
  ];
  for (const mutation of mutations) {
    const path = join(mutant, suite, mutation.file);
    const source = await fs.readFile(path, 'utf8');
    assert.equal(source.split(mutation.original).length, 2);
    command('apply_patch', [], { input: `*** Begin Patch\n*** Update File: ${path}\n@@\n-${mutation.original}\n${mutation.replacement.split('\n').map(line => '+' + line).join('\n')}\n*** End Patch\n` });
  }
  const before = await liveSnapshot();
  const copyBefore = await tree(copy);
  const mutantBefore = await tree(mutant);
  const scripts = Object.fromEntries(await Promise.all(['PLAN.md', 'barrier.mjs', 'guards.mjs', 'review.mjs'].map(async name => [name, await witness(join(scope, name))])));
  const freeze = { candidate, head: git('rev-parse', 'HEAD').toString().trim(), prepared: new Date().toISOString(), node: process.version, platform: process.platform, arch: process.arch, temporary, copy, mutant, native, mutations, scripts, inputs, copyBefore, mutantBefore, before, tooling: { tsx: await witness(join(root, 'node_modules/tsx/package.json')), typescript: await witness(join(root, 'node_modules/typescript/package.json')) } };
  await publish('candidate.diff', git('diff', candidate + '^', candidate, '--', suite).toString());
  await publish('freeze.json', freeze);
  console.log(JSON.stringify({ temporary, sourceFiles: entries.length, protected: Object.keys(before.tracked).length, native }));
} else if (process.argv[2] === 'run') {
  const freeze = JSON.parse(await fs.readFile(join(scope, 'freeze.json'), 'utf8'));
  for (const [name, expected] of Object.entries(freeze.scripts)) assert.deepEqual(await witness(join(scope, name)), expected);
  assert.deepEqual(await tree(freeze.copy), freeze.copyBefore);
  assert.deepEqual(await tree(freeze.mutant), freeze.mutantBefore);
  assert.deepEqual(await liveSnapshot(), freeze.before);
  assert.deepEqual(await qualifyNative(), freeze.native);
  assert.ok(freeze.native.every(native => native.available && native.matches), 'UNAVAILABLE or changed native prerequisite: no acceptance run');
  assert.equal(process.platform, 'darwin');
  const version = command(join(freeze.copy, gnuRelative), ['--version']).toString();
  assert.match(version, /9\.7/);
  const children = new Set();
  const runs = [];
  const details = { version, started: new Date().toISOString(), runs, rendezvous: [], checks: [], native: freeze.native };
  async function launch(mode, copy, barrier, extraArgs) {
    const temporary = join(freeze.temporary, mode);
    await fs.mkdir(temporary);
    const env = { ...process.env, TMPDIR: temporary, TMP: temporary, TEMP: temporary, TSX_DISABLE_CACHE: '1', REVIEW_COPY: copy, REVIEW_MODE: mode };
    delete env.NODE_TEST_CONTEXT;
    delete env.VIRTUAL_BASH_SPLIT_CAPTURE;
    if (mode.endsWith('capture')) env.VIRTUAL_BASH_SPLIT_CAPTURE = '1';
    if (barrier) env.REVIEW_BARRIER = barrier; else delete env.REVIEW_BARRIER;
    const args = extraArgs ?? ['--unhandled-rejections=strict', '--import', join(scope, 'barrier.mjs'), '--import', 'tsx', '--test', '--test-reporter=tap', ...canonical.map(name => join(suite, name))];
    const child = spawn(process.execPath, args, { cwd: copy, env, stdio: ['ignore', 'pipe', 'pipe'] });
    children.add(child);
    const record = { mode, copy, temporary, pid: child.pid, args, start: new Date().toISOString() };
    runs.push(record);
    const output = [], errors = [];
    child.stdout.on('data', bytes => output.push(Buffer.from(bytes)));
    child.stderr.on('data', bytes => errors.push(Buffer.from(bytes)));
    const timer = globalThis.setTimeout(() => child.kill('SIGTERM'), 120000);
    const done = new Promise((resolve, reject) => {
      child.on('error', reject);
      child.on('close', async (code, signal) => {
        globalThis.clearTimeout(timer);
        children.delete(child);
        Object.assign(record, { code, signal, end: new Date().toISOString() });
        record.stdout = Buffer.concat(output).toString();
        record.stderr = Buffer.concat(errors).toString();
        await fs.writeFile(join(freeze.temporary, mode + '.tap'), record.stdout, { flag: 'wx' });
        await fs.writeFile(join(freeze.temporary, mode + '.stderr'), record.stderr, { flag: 'wx' });
        resolve(record);
      });
    });
    return { record, done };
  }
  async function pair(prefix, copy) {
    const barrier = join(freeze.temporary, prefix + '-barrier');
    await fs.mkdir(barrier);
    const defaultRun = await launch(prefix + '-default', copy, barrier);
    const captureRun = await launch(prefix + '-capture', copy, barrier);
    const deadline = Date.now() + 45000;
    let ready;
    do {
      ready = (await fs.readdir(barrier)).filter(name => name.endsWith('.ready.json'));
      if (Date.now() > deadline) throw new Error('four test children did not reach rendezvous');
      await setTimeout(20);
    } while (ready.length < 4);
    assert.equal(ready.length, 4);
    const members = await Promise.all(ready.map(async name => JSON.parse(await fs.readFile(join(barrier, name), 'utf8'))));
    for (const member of members) process.kill(member.pid, 0);
    for (const mode of [prefix + '-default', prefix + '-capture']) assert.deepEqual(members.filter(member => member.mode === mode).map(member => basename(member.argv.at(-1))).sort(), canonical.slice().sort());
    details.rendezvous.push({ prefix, members, release: new Date().toISOString(), allFourAliveBeforeRelease: true });
    await fs.writeFile(join(barrier, 'release'), 'go', { flag: 'wx' });
    return Promise.all([defaultRun.done, captureRun.done]);
  }
  try {
    const positives = await pair('canonical', freeze.copy);
    const negatives = await pair('negative', freeze.mutant);
    const guard = await launch('guards', freeze.copy, undefined, ['--unhandled-rejections=strict', '--import', 'tsx', join(scope, 'guards.mjs')]);
    await guard.done;
    assert.equal(guard.record.code, 0, guard.record.stderr);
    details.guards = JSON.parse(await fs.readFile(join(guard.record.temporary, 'guard-results.json'), 'utf8'));
    for (const record of [...positives, ...negatives]) {
      const negative = record.mode.startsWith('negative');
      const capture = record.mode.endsWith('capture');
      assert.equal(record.code, negative ? 1 : 0, record.stdout + record.stderr);
      assert.equal(record.signal, null);
      assert.match(record.stdout, negative ? /# pass 1\n# fail 3\n/ : /# pass 4\n# fail 0\n/);
      assert.match(record.stdout, /# skipped 0\n/);
      record.captures = [...record.stdout.matchAll(/^# split native capture: (.+)$/gm)].map(match => match[1]);
      record.scratches = [...record.stdout.matchAll(/^# split native scratch retained: (.+)$/gm)].map(match => match[1]);
      record.failureDiagnostics = [...record.stdout.matchAll(/^# split native failure ([^ ]+) \(base64\): (.+)$/gm)].map(match => ({ name: match[1], report: JSON.parse(Buffer.from(match[2], 'base64').toString()) }));
      assert.equal(record.captures.length, capture ? 4 : 0);
      assert.equal(record.scratches.length, negative ? 3 : 0);
      assert.equal(record.failureDiagnostics.length, negative && !capture ? 3 : 0);
      assert.equal((await fs.readdir(record.temporary)).length, record.captures.length + record.scratches.length);
      for (const path of record.scratches) assert.ok((await fs.stat(path)).isDirectory());
      record.captureWitnesses = [];
      for (const path of record.captures) {
        assert.equal(dirname(dirname(path)), record.temporary);
        assert.equal((await fs.stat(path)).mode & 0o777, 0o600);
        assert.equal((await fs.stat(dirname(path))).mode & 0o777, 0o700);
        const bytes = await fs.readFile(path);
        const report = JSON.parse(bytes);
        if (!negative) {
          const historicalName = basename(path) === 'native-profile-differences.json' ? basename(path) : basename(path, '.json') + '-latest.json';
          const historicalBytes = await fs.readFile(join(freeze.copy, suite, 'evidence', historicalName));
          const historical = JSON.parse(historicalBytes);
          const normalized = structuredClone(report);
          if (normalized.profile?.name === 'gnu9.7-darwin') {
            assert.equal(normalized.profile.executable, join(freeze.copy, gnuRelative));
            normalized.profile.executable = historical.profile.executable;
          }
          assert.deepEqual(normalized, historical);
          assert.equal(JSON.stringify(normalized, null, 2) + '\n', historicalBytes.toString());
          record.captureWitnesses.push({ path, ...await witness(path), rawByteIdentical: bytes.equals(historicalBytes), normalizedByteIdentical: true, historicalName, historicalSha256: hash(historicalBytes), report });
        } else record.captureWitnesses.push({ path, ...await witness(path), report });
      }
      if (negative) {
        const reports = capture ? record.captureWitnesses.filter(item => basename(item.path) !== 'native-profile-differences.json').map(item => item.report) : record.failureDiagnostics.map(item => item.report);
        for (const report of reports) {
          const rows = report.cohort ?? report.report;
          const failures = rows.filter(row => (row.match ?? row.semanticMatch) === false);
          assert.equal(failures.length, 1);
          assert.ok(['default-empty', 'zero-lines'].includes(failures[0].id));
          if (report.cohort) assert.deepEqual(failures[0].expected, failures[0].observed);
          else { assert.equal(failures[0].expected.status, failures[0].observed.status); assert.equal(failures[0].expected.stderr, failures[0].observed.stderr); }
        }
      }
    }
    const paths = [...positives, ...negatives].flatMap(record => [...record.captures, ...record.scratches]);
    assert.equal(new Set(paths).size, paths.length);
    details.checks.push('canonical 8/8; negative expected 6 failures/2 passes; four-child rendezvous in each pair; capture and scratch paths disjoint; default temp has zero report files');
  } catch (error) {
    details.error = { message: String(error), stack: error.stack };
    process.exitCode = 1;
  } finally {
    for (const child of children) child.kill('SIGTERM');
    if (children.size) await setTimeout(1000);
    details.ownedProcessesRemaining = [...children].map(child => child.pid);
    details.after = await liveSnapshot();
    details.copyAfter = await tree(freeze.copy);
    details.mutantAfter = await tree(freeze.mutant);
    details.nativeAfter = await qualifyNative();
    details.integrity = { live: JSON.stringify(details.after) === JSON.stringify(freeze.before), copy: JSON.stringify(details.copyAfter) === JSON.stringify(freeze.copyBefore), mutant: JSON.stringify(details.mutantAfter) === JSON.stringify(freeze.mutantBefore), native: JSON.stringify(details.nativeAfter) === JSON.stringify(freeze.native) };
    details.ended = new Date().toISOString();
    await publish('results.json', details);
    for (const record of runs) {
      if (record.stdout !== undefined) await publish(record.mode + '.tap', record.stdout);
      if (record.stderr) await publish(record.mode + '.stderr', record.stderr);
    }
    console.log(JSON.stringify({ error: details.error, integrity: details.integrity, runs: runs.map(({ mode, code }) => ({ mode, code })), guards: details.guards?.results.length, remaining: details.ownedProcessesRemaining }));
    if (Object.values(details.integrity).some(value => !value)) process.exitCode = 1;
  }
} else throw new Error('Use prepare, then commit frozen inputs, then run');
