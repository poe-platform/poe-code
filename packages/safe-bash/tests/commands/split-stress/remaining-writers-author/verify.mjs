import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import * as fs from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';
import ts from 'typescript';

const scope = dirname(fileURLToPath(import.meta.url));
const root = fileURLToPath(new URL('../../../../', import.meta.url));
const candidate = '79f11f1526224a1f34ffd64d7a32c63bdb971a0d';
const suite = 'tests/commands/split';
const canonical = ['edge.test.ts', 'stress.test.ts', 'dangling-native.test.ts'];
const pinned = 'tests/commands/metadata-stress/.oracle/coreutils-9.7/src/split';
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
function command(executable, args, options = {}) {
  const result = spawnSync(executable, args, { cwd: root, maxBuffer: 64 * 1024 * 1024, ...options });
  assert.equal(result.status, 0, `${executable}: ${result.stderr}`);
  return result.stdout;
}
const git = (...args) => command('git', args);
async function publish(name, value) {
  await assert.rejects(fs.access(join(scope, name)), { code: 'ENOENT' });
  const text = typeof value === 'string' ? value : JSON.stringify(value, null, 2) + '\n';
  command('apply_patch', [], { input: `*** Begin Patch\n*** Add File: ${join(scope, name)}\n${text.replace(/\n$/, '').split('\n').map(line => '+' + line).join('\n')}\n*** End Patch\n` });
}
async function tree(directory) {
  const result = {};
  async function visit(path) {
    const stat = await fs.lstat(path);
    const name = relative(directory, path);
    result[name] = { mode: stat.mode & 0o7777 };
    if (stat.isDirectory()) {
      result[name].directory = true;
      for (const entry of (await fs.readdir(path)).sort()) await visit(join(path, entry));
    } else result[name].sha256 = hash(stat.isSymbolicLink() ? await fs.readlink(path) : await fs.readFile(path));
  }
  await visit(directory);
  return result;
}
function syntax(text) {
  const source = ts.createSourceFile('source.ts', text, ts.ScriptTarget.Latest, true);
  const printer = ts.createPrinter({ removeComments: true });
  const print = node => printer.printNode(ts.EmitHint.Unspecified, node, source);
  const assertions = [], vectors = [];
  function visit(node) {
    if (ts.isCallExpression(node) && node.expression.getText(source).startsWith('assert.')) assertions.push([print(node.expression), ...node.arguments.slice(0, 2).map(print)]);
    if (ts.isArrayLiteralExpression(node)) vectors.push(print(node));
    ts.forEachChild(node, visit);
  }
  visit(source);
  return { assertions, vectors };
}
const output = await fs.realpath(await fs.mkdtemp(join(tmpdir(), 'virtual-bash-split-remaining-author-')));
const copy = join(output, 'candidate');
const mutant = join(output, 'reporting-control');
const entries = git('ls-tree', '-r', '-z', candidate, '--', 'src', suite, 'package.json', 'package-lock.json', 'tsconfig.json', 'tsconfig.build.json').toString().split('\0').filter(Boolean).map(line => {
  const [metadata, path] = line.split('\t');
  const [mode, type, blob] = metadata.split(' ');
  assert.equal(type, 'blob');
  return { mode, blob, path };
});
const manifest = { candidate, parent: git('rev-parse', `${candidate}^`).toString().trim(), output, copy, mutant, started: new Date().toISOString(), platform: process.platform, arch: process.arch, node: process.version, entries, sourceTree: git('rev-parse', `${candidate}:src`).toString().trim(), parentSourceTree: git('rev-parse', `${candidate}^:src`).toString().trim(), assertions: {}, native: [], historical: {} };
assert.equal(manifest.sourceTree, manifest.parentSourceTree);
for (const entry of entries) {
  const bytes = git('cat-file', 'blob', entry.blob);
  entry.sha256 = hash(bytes);
  await fs.mkdir(dirname(join(copy, entry.path)), { recursive: true });
  await fs.writeFile(join(copy, entry.path), bytes, { flag: 'wx', mode: parseInt(entry.mode, 8) });
}
for (const name of canonical) {
  const original = syntax(git('show', `${candidate}^:${suite}/${name}`).toString());
  const current = syntax(git('show', `${candidate}:${suite}/${name}`).toString());
  assert.deepEqual(current, original);
  manifest.assertions[name] = current;
}
for (const [path, expected] of [[pinned, 'cf5851c4e6566983ce69940b766c0b5eb0cd26ebf2bb45eefe215b2d5c62f958'], ['/usr/bin/split', '7c2d5f3c73e849d664bad3a2f4c67c5154b0f03f59f2fa779d49e33dc7983f91']]) {
  const location = path.startsWith('/') ? path : join(root, path);
  const bytes = await fs.readFile(location);
  assert.equal(hash(bytes), expected);
  manifest.native.push({ path, sha256: hash(bytes), mode: (await fs.stat(location)).mode & 0o7777 });
  if (!path.startsWith('/')) {
    await fs.mkdir(dirname(join(copy, path)), { recursive: true });
    await fs.writeFile(join(copy, path), bytes, { flag: 'wx', mode: 0o755 });
  }
}
manifest.nativeVersion = command(join(copy, pinned), ['--version']).toString();
await fs.symlink(join(root, 'node_modules'), join(copy, 'node_modules'), 'dir');
await fs.cp(copy, mutant, { recursive: true, verbatimSymlinks: true });
const injections = [
  ['edge.test.ts', 'const observed = await run(args);', 'const observed = await run(args);\n    if (size === "1g") observed.exitCode += 1;'],
  ['stress.test.ts', 'const actual = await run(args, chunks(input, chunkSize, true), { limits: { maxChunkBytes: 4096 } });', 'const actual = await run(args, chunks(input, chunkSize, true), { limits: { maxChunkBytes: 4096 } });\n        if (inputName === "64KiB-record-edges" && args[0] === "-C4096" && chunkSize === 65537) actual.exitCode += 1;'],
  ['dangling-native.test.ts', 'const result = await run(args, "", {}, { fs });', 'const result = await run(args, "", {}, { fs });\n        if (fixture.id === "relative" && backend === "memory") result.exitCode += 1;'],
];
for (const [name, original, replacement] of injections) {
  const path = join(mutant, suite, name);
  const text = await fs.readFile(path, 'utf8');
  assert.equal(text.split(original).length, 2);
  await fs.writeFile(path, text.replace(original, replacement));
}
manifest.injections = injections;
manifest.copyBefore = await tree(copy);
manifest.mutantBefore = await tree(mutant);
for (const path of [`${suite}/evidence`, 'tests/commands/split-stress/native-capture-repair', 'tests/commands/split-stress/native-capture-review', 'tests/integration/full-gate-20260827/combined-8670ebe8']) manifest.historical[path] = await tree(join(root, path));
await publish('freeze.json', manifest);
console.log(`Frozen candidate and retained output: ${output}`);
const children = new Set();
const details = { candidate, output, runs: [], barriers: [], checks: [] };
async function launch(mode, working, barrier, args) {
  const temporary = join(output, mode);
  const audit = join(output, mode + '-audit');
  await fs.mkdir(temporary);
  await fs.mkdir(audit);
  const env = { ...process.env, TMPDIR: temporary, TMP: temporary, TEMP: temporary, TSX_DISABLE_CACHE: '1', REVIEW_MODE: mode, REVIEW_COPY: working, REMAINING_AUDIT: audit, SPLIT_DANGLING_PHASE: 'initial' };
  delete env.NODE_TEST_CONTEXT;
  delete env.VIRTUAL_BASH_SPLIT_CAPTURE;
  delete env.REVIEW_BARRIER;
  delete env.REMAINING_GUARD_CONTROL;
  if (mode.endsWith('capture')) env.VIRTUAL_BASH_SPLIT_CAPTURE = '1';
  if (barrier) env.REVIEW_BARRIER = barrier;
  if (mode === 'observer-control') env.REMAINING_GUARD_CONTROL = '1';
  const argv = args ?? ['--unhandled-rejections=strict', '--import', join(scope, '../native-capture-review/barrier.mjs'), '--import', join(scope, 'write-guard.mjs'), '--import', 'tsx', '--test', '--test-concurrency=3', '--test-reporter=tap', ...canonical.map(name => join(suite, name))];
  const child = spawn(process.execPath, argv, { cwd: working, env, stdio: ['ignore', 'pipe', 'pipe'], detached: true });
  children.add(child);
  const record = { mode, working, temporary, audit, pid: child.pid, argv, started: new Date().toISOString() };
  details.runs.push(record);
  const stdout = [], stderr = [];
  let bytes = 0;
  const stop = () => { try { process.kill(-child.pid, 'SIGKILL'); } catch (error) { if (error.code !== 'ESRCH') throw error; } };
  for (const [stream, buffers] of [[child.stdout, stdout], [child.stderr, stderr]]) stream.on('data', chunk => { bytes += chunk.length; if (bytes > 16 * 1024 * 1024) stop(); else buffers.push(Buffer.from(chunk)); });
  const timer = globalThis.setTimeout(stop, 120000);
  const done = new Promise((resolve, reject) => {
    child.once('error', reject);
    child.once('close', async (code, signal) => {
      clearTimeout(timer);
      children.delete(child);
      Object.assign(record, { code, signal, stdout: Buffer.concat(stdout).toString(), stderr: Buffer.concat(stderr).toString(), ended: new Date().toISOString() });
      try {
        await publish(mode + '.tap', record.stdout);
        await fs.writeFile(join(output, mode + '.stderr'), record.stderr, { flag: 'wx' });
        resolve(record);
      } catch (error) { reject(error); }
    });
  });
  return { record, done };
}
async function pair(prefix, working) {
  const barrier = join(output, prefix + '-barrier');
  await fs.mkdir(barrier);
  const runs = [await launch(prefix + '-default', working, barrier), await launch(prefix + '-capture', working, barrier)];
  const deadline = Date.now() + 45000;
  let ready;
  do {
    ready = (await fs.readdir(barrier)).filter(name => name.endsWith('.ready.json'));
    if (Date.now() > deadline) throw new Error('six children failed to reach barrier');
    await delay(20);
  } while (ready.length < 6);
  assert.equal(ready.length, 6);
  const members = await Promise.all(ready.map(async name => JSON.parse(await fs.readFile(join(barrier, name), 'utf8'))));
  for (const member of members) process.kill(member.pid, 0);
  for (const mode of [prefix + '-default', prefix + '-capture']) assert.deepEqual(members.filter(member => member.mode === mode).map(member => basename(member.argv.at(-1))).sort(), canonical.slice().sort());
  details.barriers.push({ members, released: new Date().toISOString(), allSixAlive: true });
  await fs.writeFile(join(barrier, 'release'), 'go', { flag: 'wx' });
  return Promise.all(runs.map(run => run.done));
}
try {
  const positives = await pair('canonical', copy);
  const negatives = await pair('negative', mutant);
  const observer = await launch('observer-control', copy, undefined, ['--import', join(scope, 'write-guard.mjs'), '-e', '']);
  await observer.done;
  assert.equal(observer.record.code, 0, observer.record.stderr);
  const guards = await launch('helper-guards', copy, undefined, ['--import', 'tsx', join(scope, '../native-capture-review/guards.mjs')]);
  await guards.done;
  assert.equal(guards.record.code, 0, guards.record.stderr);
  details.guards = JSON.parse(await fs.readFile(join(guards.record.temporary, 'guard-results.json'), 'utf8'));
  for (const record of details.runs) {
    record.writeAttempts = (await Promise.all((await fs.readdir(record.audit)).map(async name => (await fs.readFile(join(record.audit, name), 'utf8')).trim().split('\n').filter(Boolean).map(line => JSON.parse(line))))).flat();
    if (record.mode === 'observer-control') {
      assert.equal(record.writeAttempts.length, 2);
      assert.ok(record.writeAttempts.every(attempt => !attempt.allowed));
    } else assert.ok(record.writeAttempts.every(attempt => attempt.allowed));
  }
  for (const record of [...positives, ...negatives]) {
    const negative = record.mode.startsWith('negative');
    const capture = record.mode.endsWith('capture');
    assert.equal(record.code, negative ? 1 : 0, record.stdout + record.stderr);
    assert.equal(record.signal, null);
    assert.match(record.stdout, negative ? /# pass 0\n# fail 3\n/ : /# pass 3\n# fail 0\n/);
    assert.match(record.stdout, /# skipped 0\n/);
    record.captures = [...record.stdout.matchAll(/^# split native capture: (.+)$/gm)].map(match => match[1]);
    record.scratches = [...record.stdout.matchAll(/^# split native scratch retained: (.+)$/gm)].map(match => match[1]);
    record.failureDiagnostics = [...record.stdout.matchAll(/^# split native failure ([^ ]+) \(base64\): (.+)$/gm)].map(match => ({ name: match[1], report: JSON.parse(Buffer.from(match[2], 'base64').toString()) }));
    assert.equal(record.captures.length, capture ? 3 : 0);
    assert.equal(record.scratches.length, negative ? 1 : 0);
    assert.equal(record.failureDiagnostics.length, negative && !capture ? 3 : 0);
    assert.equal((await fs.readdir(record.temporary)).length, record.captures.length + record.scratches.length);
    record.captureWitnesses = [];
    for (const path of record.captures) {
      assert.equal(dirname(dirname(path)), record.temporary);
      const bytes = await fs.readFile(path);
      const report = JSON.parse(bytes);
      const mode = (await fs.stat(path)).mode & 0o777;
      assert.equal(mode, 0o600);
      assert.equal((await fs.stat(dirname(path))).mode & 0o777, 0o700);
      record.captureWitnesses.push({ path, sha256: hash(bytes), bytes: bytes.length, mode });
      if (!negative) {
        const name = basename(path, '.json');
        const historicalPath = join(copy, suite, 'evidence', name === 'dangling-native' ? 'dangling/native-final.json' : `${name}-latest.json`);
        const historicalBytes = await fs.readFile(historicalPath);
        const historical = JSON.parse(historicalBytes);
        const normalized = structuredClone(report);
        if (name === 'dangling-native') normalized.time = historical.time;
        const relocated = JSON.parse(JSON.stringify(normalized).split(join(copy, pinned)).join(join(root, pinned)));
        const match = JSON.stringify(relocated) === JSON.stringify(historical);
        details.checks.push({ name, historicalPath, capture: path, rawEqual: bytes.equals(historicalBytes), timeAndExactOraclePathOnlyEquivalent: match });
        assert.ok(match, `${name} differs beyond timestamp/oracle path relocation`);
      }
    }
  }
  const destinations = [...positives, ...negatives].flatMap(record => [...record.captures, ...record.scratches]);
  assert.equal(new Set(destinations).size, destinations.length);
  assert.deepEqual(await tree(copy), manifest.copyBefore);
  assert.deepEqual(await tree(mutant), manifest.mutantBefore);
  for (const [path, before] of Object.entries(manifest.historical)) assert.deepEqual(await tree(join(root, path)), before);
  for (const native of manifest.native) assert.equal(hash(await fs.readFile(native.path.startsWith('/') ? native.path : join(root, native.path))), native.sha256);
  details.integrity = { candidateAndMutantUnchanged: true, historicalTreesUnchanged: true, reenumeratesNewEntries: true, nativeHashesUnchanged: true };
  for (const pid of [...details.runs.map(run => run.pid), ...details.barriers.flatMap(barrier => barrier.members.map(member => member.pid))]) {
    assert.throws(() => process.kill(pid, 0), { code: 'ESRCH' });
  }
  details.ownedProcessesReaped = true;
  details.passed = true;
} catch (error) {
  details.passed = false;
  details.error = { message: String(error), stack: error.stack };
  process.exitCode = 1;
} finally {
  for (const child of children) { try { process.kill(-child.pid, 'SIGKILL'); } catch (error) { if (error.code !== 'ESRCH') throw error; } }
  details.finished = new Date().toISOString();
  await publish('results.json', details);
  console.log(JSON.stringify({ passed: details.passed, output, error: details.error }));
}
