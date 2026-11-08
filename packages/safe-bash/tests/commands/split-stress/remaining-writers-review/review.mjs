import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import * as fs from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, relative, basename } from 'node:path';
import { fileURLToPath } from 'node:url';
import { setTimeout } from 'node:timers/promises';
import ts from 'typescript';

const scope = dirname(fileURLToPath(import.meta.url));
const evidence = join(scope, process.argv[2] ?? 'attempt-02');
const root = fileURLToPath(new URL('../../../../', import.meta.url)).replace(/\/$/, '');
const candidate = '79f11f1526224a1f34ffd64d7a32c63bdb971a0d';
const suite = 'tests/commands/split';
const canonical = ['native.test.ts', 'native-errors.test.ts', 'edge.test.ts', 'stress.test.ts', 'dangling-native.test.ts'];
const gnuRelative = 'tests/commands/metadata-stress/.oracle/coreutils-9.7/src/split';
const gnuPin = 'cf5851c4e6566983ce69940b766c0b5eb0cd26ebf2bb45eefe215b2d5c62f958';
const applePin = '7c2d5f3c73e849d664bad3a2f4c67c5154b0f03f59f2fa779d49e33dc7983f91';
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
function command(executable, args, options = {}) {
  const result = spawnSync(executable, args, { cwd: root, maxBuffer: 100 * 1024 * 1024, ...options });
  assert.equal(result.status, 0, `${executable} ${args.join(' ')}: ${result.stderr}`);
  return result.stdout;
}
const git = (...args) => command('git', args);
function publish(name, data) {
  const path = join(evidence, name);
  const text = typeof data === 'string' ? data : JSON.stringify(data, null, 2) + '\n';
  command('apply_patch', [], { input: `*** Begin Patch\n*** Add File: ${path}\n${text.trimEnd().split('\n').map(line => '+' + line).join('\n')}\n*** End Patch\n` });
}
async function witness(path) {
  const stat = await fs.lstat(path);
  if (stat.isDirectory()) return { directory: true, mode: stat.mode & 0o7777 };
  return { mode: stat.mode & 0o7777, sha256: sha256(stat.isSymbolicLink() ? await fs.readlink(path) : await fs.readFile(path)), ...(stat.isSymbolicLink() ? { link: await fs.readlink(path) } : { size: stat.size }) };
}
async function tree(directory) {
  const entries = {};
  async function visit(path) {
    const entry = await witness(path);
    entries[relative(directory, path)] = entry;
    if (entry.directory) for (const child of (await fs.readdir(path)).sort()) await visit(join(path, child));
  }
  await visit(directory);
  return entries;
}
async function liveSnapshot() {
  const names = git('ls-files', '-z', '--', 'src', suite, 'package.json', 'package-lock.json', 'tsconfig.json', 'tsconfig.build.json').toString().split('\0').filter(Boolean);
  return { tracked: Object.fromEntries(await Promise.all(names.map(async name => [name, await witness(join(root, name))]))), splitTree: await tree(join(root, suite)) };
}
async function nativeSnapshot() {
  return Promise.all([[join(root, gnuRelative), gnuPin], ['/usr/bin/split', applePin]].map(async ([path, pin]) => ({ path, pin, ...await witness(path) })));
}
function inspectAssertions(source, name) {
  const parsed = ts.createSourceFile(name, source, ts.ScriptTarget.Latest, true);
  const calls = [];
  function visit(node) {
    if (ts.isCallExpression(node) && node.expression.getText(parsed).startsWith('assert.')) {
      const args = node.arguments.map(argument => argument.getText(parsed));
      if (name === 'edge.test.ts' || name === 'stress.test.ts') {
        if (node.expression.getText(parsed) === 'assert.equal' && args[0] === 'failed') args.splice(2);
      }
      calls.push({ method: node.expression.getText(parsed), args });
    }
    ts.forEachChild(node, visit);
  }
  visit(parsed);
  return calls;
}
function inspectCandidate() {
  const changed = git('diff', '--name-only', `${candidate}^`, candidate).toString().trim().split('\n');
  assert.deepEqual(changed, ['dangling-native.test.ts', 'edge.test.ts', 'native-capture.test.ts', 'native-capture.ts', 'stress.test.ts'].map(name => `${suite}/${name}`));
  const results = { changed, files: [] };
  for (const name of canonical) {
    const parent = git('show', `${candidate}^:${suite}/${name}`).toString();
    const after = git('show', `${candidate}:${suite}/${name}`).toString();
    const assertions = inspectAssertions(parent, name);
    assert.deepEqual(inspectAssertions(after, name), assertions);
    if (['native.test.ts', 'native-errors.test.ts'].includes(name)) assert.equal(after, parent);
    const arrays = source => {
      const parsed = ts.createSourceFile(name, source, ts.ScriptTarget.Latest, true);
      const values = [];
      function visit(node) { if (ts.isArrayLiteralExpression(node)) values.push(node.getText(parsed)); ts.forEachChild(node, visit); }
      visit(parsed);
      return values;
    };
    assert.deepEqual(arrays(after), arrays(parent));
    const pins = source => [...source.matchAll(/\b[a-f0-9]{64}\b/g)].map(match => match[0]);
    assert.deepEqual(pins(after), pins(parent));
    results.files.push({ name, parentSha256: sha256(parent), candidateSha256: sha256(after), unchanged: parent === after, assertions, arrayLiterals: arrays(after).length, pins: pins(after) });
  }
  assert.equal(git('diff', `${candidate}^`, candidate, '--', 'src', `${suite}/cases.ts`, `${suite}/helpers.ts`, `${suite}/evidence`).length, 0);
  return results;
}

await assert.rejects(fs.access(join(evidence, 'results.json')), { code: 'ENOENT' });
assert.equal(git('rev-parse', '--show-toplevel').toString().trim(), root);
assert.equal(process.platform, 'darwin');
const started = new Date().toISOString();
const inspection = inspectCandidate();
publish('candidate.diff', git('diff', `${candidate}^`, candidate).toString());
publish('inspection.json', inspection);
const temporary = await fs.realpath(await fs.mkdtemp(join(tmpdir(), 'virtual-bash-split-remaining-review-')));
const copy = join(temporary, 'candidate');
const native = await nativeSnapshot();
assert.ok(native.every(entry => entry.sha256 === entry.pin), 'native prerequisite mismatch: acceptance unavailable');
const entries = git('ls-tree', '-r', '-z', candidate, '--', 'src', suite, 'package.json', 'package-lock.json', 'tsconfig.json', 'tsconfig.build.json').toString().split('\0').filter(Boolean).map(line => {
  const [metadata, path] = line.split('\t');
  const [mode, type, blob] = metadata.split(' ');
  assert.equal(type, 'blob');
  return { path, mode, blob };
});
for (const entry of entries) {
  const path = join(copy, entry.path);
  await fs.mkdir(dirname(path), { recursive: true });
  const bytes = git('cat-file', 'blob', entry.blob);
  await fs.writeFile(path, bytes, { flag: 'wx', mode: entry.mode === '100755' ? 0o755 : 0o644 });
  entry.sha256 = sha256(bytes);
}
await fs.symlink(join(root, 'node_modules'), join(copy, 'node_modules'), 'dir');
await fs.mkdir(dirname(join(copy, gnuRelative)), { recursive: true });
await fs.copyFile(join(root, gnuRelative), join(copy, gnuRelative));
assert.equal(sha256(await fs.readFile(join(copy, gnuRelative))), gnuPin);
const version = command(join(copy, gnuRelative), ['--version']).toString();
assert.match(version, /9\.7/);
const before = await tree(copy);
const liveBefore = await liveSnapshot();
const scripts = Object.fromEntries(await Promise.all(['audit.mjs', 'barrier.mjs', 'guards.mjs', 'review.mjs'].map(async name => [name, await witness(join(scope, name))])));
publish('freeze.json', { candidate, parent: git('rev-parse', `${candidate}^`).toString().trim(), started, temporary, copy, entries, before, liveBefore, native, scripts, node: process.version, platform: process.platform, arch: process.arch, version, gitStatus: git('status', '--short').toString() });
const details = { candidate, started, temporary, copy, runs: [], rendezvous: [], checks: [], limitations: [], complete: false };
const children = new Set();
async function launch(mode, files, options = {}) {
  const output = join(temporary, mode);
  const logs = join(temporary, `${mode}-audit`);
  await fs.mkdir(output);
  await fs.mkdir(logs);
  const env = { ...process.env, TMPDIR: output, TMP: output, TEMP: output, TSX_DISABLE_CACHE: '1', REVIEW_MODE: mode, REVIEW_COPY: copy, REVIEW_CONTROLS: options.controls ? '1' : '0' };
  delete env.NODE_TEST_CONTEXT;
  delete env.VIRTUAL_BASH_SPLIT_CAPTURE;
  delete env.SPLIT_DANGLING_PHASE;
  delete env.REVIEW_BARRIER;
  if (options.capture) env.VIRTUAL_BASH_SPLIT_CAPTURE = '1';
  if (options.phase !== undefined) env.SPLIT_DANGLING_PHASE = options.phase;
  if (options.barrier) env.REVIEW_BARRIER = options.barrier;
  env.REVIEW_AUDIT = JSON.stringify({ mode, logs, protected: [root, copy], temporary, native: [{ path: join(copy, gnuRelative), sha256: gnuPin }, { path: '/usr/bin/split', sha256: applePin }] });
  env.NODE_OPTIONS = `--import=${join(scope, 'audit.mjs')}`;
  const args = options.args ?? ['--unhandled-rejections=strict', '--import', join(scope, 'barrier.mjs'), '--import', 'tsx', '--test', '--test-concurrency=3', '--test-reporter=tap', ...files.map(name => join(suite, name))];
  const child = spawn(process.execPath, args, { cwd: copy, env, stdio: ['ignore', 'pipe', 'pipe'] });
  children.add(child);
  const record = { mode, output, logs, args, pid: child.pid, start: new Date().toISOString(), capture: options.capture ?? false, phase: options.phase ?? null };
  details.runs.push(record);
  const stdout = [], stderr = [];
  child.stdout.on('data', bytes => stdout.push(Buffer.from(bytes)));
  child.stderr.on('data', bytes => stderr.push(Buffer.from(bytes)));
  const timer = globalThis.setTimeout(() => { record.deadlineExceeded = true; child.kill('SIGTERM'); }, 100000);
  const done = new Promise((resolve, reject) => {
    child.once('error', reject);
    child.once('close', async (code, signal) => {
      globalThis.clearTimeout(timer);
      children.delete(child);
      Object.assign(record, { code, signal, end: new Date().toISOString(), stdout: Buffer.concat(stdout).toString(), stderr: Buffer.concat(stderr).toString() });
      await fs.writeFile(join(temporary, `${mode}.tap`), record.stdout, { flag: 'wx' });
      await fs.writeFile(join(temporary, `${mode}.stderr`), record.stderr, { flag: 'wx' });
      resolve(record);
    });
  });
  return { record, done };
}
function count(record) {
  const get = key => Number(new RegExp(`^# ${key} (\\d+)$`, 'm').exec(record.stdout)?.[1] ?? NaN);
  return { tests: get('tests'), pass: get('pass'), fail: get('fail'), skip: get('skipped') };
}
async function auditRun(record) {
  const events = [];
  const raw = {};
  for (const name of (await fs.readdir(record.logs)).sort()) {
    const text = await fs.readFile(join(record.logs, name), 'utf8');
    raw[name] = { sha256: sha256(text), base64: Buffer.from(text).toString('base64') };
    for (const line of text.trim().split('\n')) events.push(JSON.parse(line));
  }
  publish(`${record.mode}-audit.json`, raw);
  const mutations = events.filter(event => event.event === 'mutation-attempt');
  const blocked = mutations.filter(event => event.blocked);
  const natives = events.filter(event => event.event === 'native-start');
  record.audit = { processes: events.filter(event => event.event === 'installed').length, mutationAttempts: mutations.length, protectedAttempts: blocked.length, blocked, nativeInvocations: natives.length, nativeAllowed: natives.every(event => event.allowed), unapprovedChildren: events.filter(event => event.event === 'unapproved-child'), nativeErrors: events.filter(event => event.event === 'native-end' && (event.signal || event.error)) };
  record.childRuns = events.filter(event => event.event === 'node-child-result').map(event => {
    const stdout = Buffer.from(event.stdoutBase64, 'base64').toString();
    return { ...event, counts: count({ stdout }) };
  });
  record.publishedReports = events.filter(event => event.event === 'report-published');
  for (const [index, child] of record.childRuns.entries()) {
    const stdout = Buffer.from(child.stdoutBase64, 'base64').toString();
    publish(`${record.mode}-child-${index}.tap`, stdout);
    delete child.stdoutBase64;
    delete child.stderrBase64;
  }
  const paths = [...record.stdout.matchAll(/^# split native capture: (.+)$/gm)].map(match => match[1]);
  record.captures = [];
  for (const path of paths) {
    assert.equal(dirname(dirname(path)), record.output);
    const bytes = await fs.readFile(path);
    record.captures.push({ path, ...await witness(path), directory: await witness(dirname(path)), base64: bytes.toString('base64') });
  }
  record.retainedScratch = [...record.stdout.matchAll(/^# split native scratch retained: (.+)$/gm)].map(match => match[1]);
  record.outputTree = await tree(record.output);
}
try {
  const barrier = join(temporary, 'canonical-barrier');
  await fs.mkdir(barrier);
  const defaults = await launch('canonical-default', canonical, { barrier, phase: 'initial' });
  const captures = await launch('canonical-capture', canonical, { barrier, capture: true, phase: 'final' });
  const deadline = Date.now() + 45000;
  let ready;
  for (;;) {
    ready = (await fs.readdir(barrier)).filter(name => name.endsWith('.ready.json'));
    if (ready.length >= 6) break;
    if (Date.now() > deadline) throw new Error('six canonical children did not rendezvous');
    await setTimeout(20);
  }
  assert.equal(ready.length, 6);
  const members = await Promise.all(ready.map(async name => JSON.parse(await fs.readFile(join(barrier, name), 'utf8'))));
  for (const member of members) process.kill(member.pid, 0);
  for (const mode of ['canonical-default', 'canonical-capture']) assert.equal(members.filter(member => member.mode === mode).length, 3);
  details.rendezvous.push({ members, allSixAlive: true, released: new Date().toISOString(), concurrencyPerMode: 3 });
  await fs.writeFile(join(barrier, 'release'), 'go', { flag: 'wx' });
  await Promise.all([defaults.done, captures.done]);
  const helper = await launch('helper', ['native-capture.test.ts']);
  await helper.done;
  const guards = await launch('guards', [], { controls: true, args: ['--unhandled-rejections=strict', '--import', 'tsx', join(scope, 'guards.mjs')] });
  await guards.done;
  const phaseFixed = await launch('phase-fixed', ['dangling-native.test.ts'], { phase: 'fixed' });
  await phaseFixed.done;
  const phasePath = await launch('phase-path', ['dangling-native.test.ts'], { capture: true, phase: '../../evidence/dangling/native-initial' });
  await phasePath.done;
  const typecheck = await launch('scoped-typecheck', [], { args: [join(root, 'node_modules/typescript/bin/tsc'), '-p', join(copy, suite, 'tsconfig.json'), '--noEmit'] });
  await typecheck.done;
  for (const record of details.runs) {
    record.counts = count(record);
    await auditRun(record);
    publish(`${record.mode}.tap`, record.stdout || '\n');
    publish(`${record.mode}.stderr`, record.stderr || '\n');
    delete record.stdout;
    delete record.stderr;
  }
  details.guards = JSON.parse(await fs.readFile(join(guards.record.output, 'guards.json'), 'utf8'));
  for (const record of [defaults.record, captures.record]) {
    assert.equal(record.code, 0, `genuine unchanged canonical failure: ${record.mode}`);
    assert.deepEqual(record.counts, { tests: 7, pass: 7, fail: 0, skip: 0 });
    assert.equal(record.captures.length, record.capture ? 7 : 0);
    assert.equal(record.retainedScratch.length, 0);
  }
  assert.deepEqual(helper.record.counts, { tests: 10, pass: 10, fail: 0, skip: 0 });
  assert.equal(helper.record.childRuns.length, 4);
  for (const child of helper.record.childRuns) {
    assert.equal(child.signal, null);
    assert.equal(child.counts.skip, 0);
    assert.deepEqual(child.counts, child.status === 0 ? { tests: 7, pass: 7, fail: 0, skip: 0 } : { tests: 7, pass: 1, fail: 6, skip: 0 });
  }
  assert.equal(helper.record.childRuns.filter(child => child.status === 1).length, 2);
  for (const record of [phaseFixed.record, phasePath.record]) assert.deepEqual(record.counts, { tests: 1, pass: 1, fail: 0, skip: 0 });
  assert.equal(phaseFixed.record.captures.length, 0);
  assert.equal(phasePath.record.captures.length, 1);
  assert.equal(guards.record.code, 0);
  assert.ok(details.guards.every(result => result.pass));
  assert.equal(typecheck.record.code, 0);
  for (const record of details.runs) {
    assert.equal(record.signal, null);
    assert.equal(record.audit.protectedAttempts, record.mode === 'guards' ? 11 : 0);
    assert.equal(record.audit.nativeAllowed, true);
    assert.equal(record.audit.unapprovedChildren.length, 0);
    assert.equal(record.audit.nativeErrors.length, 0);
  }
  const paths = details.runs.flatMap(record => record.captures.map(capture => capture.path));
  assert.equal(new Set(paths).size, paths.length);
  details.complete = true;
} catch (error) {
  details.error = { message: String(error), stack: error.stack };
  process.exitCode = 1;
} finally {
  for (const child of children) child.kill('SIGTERM');
  details.after = await tree(copy);
  details.archiveUnchangedIncludingNewEntries = JSON.stringify(details.after) === JSON.stringify(before);
  details.liveAfter = await liveSnapshot();
  details.liveSplitUnchangedIncludingNewEntries = JSON.stringify(details.liveAfter.splitTree) === JSON.stringify(liveBefore.splitTree);
  details.liveTrackedChanges = [...new Set([...Object.keys(liveBefore.tracked), ...Object.keys(details.liveAfter.tracked)])].filter(path => JSON.stringify(liveBefore.tracked[path]) !== JSON.stringify(details.liveAfter.tracked[path]));
  details.nativeAfter = await nativeSnapshot();
  details.nativeUnchanged = JSON.stringify(details.nativeAfter) === JSON.stringify(native);
  details.scriptChanges = [];
  for (const [name, expected] of Object.entries(scripts)) if (JSON.stringify(await witness(join(scope, name))) !== JSON.stringify(expected)) details.scriptChanges.push(name);
  details.knownTopLevelChildren = (await fs.readdir(temporary)).sort();
  details.finished = new Date().toISOString();
  if (!details.archiveUnchangedIncludingNewEntries || !details.liveSplitUnchangedIncludingNewEntries || !details.nativeUnchanged || details.scriptChanges.length) { details.complete = false; process.exitCode = 1; }
  publish('results.json', details);
  console.log(JSON.stringify({ candidate, temporary, complete: details.complete, error: details.error, runs: details.runs.map(({ mode, code, counts, audit }) => ({ mode, code, counts, audit: audit && { protectedAttempts: audit.protectedAttempts, nativeInvocations: audit.nativeInvocations } })) }, null, 2));
}
