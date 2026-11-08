import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import readline from 'node:readline';
import vm from 'node:vm';
import {pathToFileURL} from 'node:url';

async function main() {
  const repository = '/Users/kjopek/Workspace/safe-bash';
  const namespace = 'tests/integration/agent-bash-coherent-b2-preflight-20260829';
  const owned = `${repository}/${namespace}`;
  const work = '/private/tmp/safe-bash-b2-completion-r5-01a04d95';
  const stageRoot = `${work}/staged`;
  const capture = '/private/tmp/safe-bash-b2-completion-r5-01a04d95.log';
  const started = performance.now();
  const initialElapsed = Date.now() - fs.statSync(capture).birthtimeMs;
  const events = [];
  let invocation = 0;
  let starts = 10;
  let harmlessStarts = 0;
  let materialized = false;
  fs.mkdirSync(work, {mode: 0o700});
  process.chdir(work);
  process.stdin.setRawMode?.(true);
  const sha = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
  function read(filename, expected, maximum = 33554432) {
    const before = fs.lstatSync(filename);
    assert.ok(before.isFile() && !before.isSymbolicLink() && before.size <= maximum);
    if (expected) { assert.ok(Number.isSafeInteger(expected.bytes)); assert.match(expected.sha256, /^[a-f0-9]{64}$/); assert.equal(before.size, expected.bytes); }
    const descriptor = fs.openSync(filename, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW);
    try {
      const opened = fs.fstatSync(descriptor); assert.equal(opened.ino, before.ino); assert.equal(opened.dev, before.dev);
      const bytes = Buffer.alloc(before.size); let offset = 0;
      while (offset < bytes.length) { const count = fs.readSync(descriptor, bytes, offset, bytes.length - offset, offset); assert.ok(count > 0); offset += count; }
      const after = fs.fstatSync(descriptor); assert.equal(after.size, before.size); assert.equal(after.mtimeMs, before.mtimeMs);
      if (expected) assert.equal(sha(bytes), expected.sha256, filename);
      return bytes;
    } finally { fs.closeSync(descriptor); }
  }
  function save(filename, value) {
    assert.ok(filename.startsWith(`${work}/`));
    const bytes = Buffer.isBuffer(value) ? value : Buffer.from(typeof value === 'string' ? value : JSON.stringify(value, null, 2) + '\n');
    fs.mkdirSync(path.dirname(filename), {recursive: true, mode: 0o700});
    const descriptor = fs.openSync(filename, 'wx', 0o600);
    try { let offset = 0; while (offset < bytes.length) { const count = fs.writeSync(descriptor, bytes, offset, bytes.length - offset); assert.ok(count > 0); offset += count; } fs.fsyncSync(descriptor); }
    finally { fs.closeSync(descriptor); }
    return {bytes: bytes.length, sha256: sha(bytes)};
  }
  function inventory(root) {
    const rows = [];
    function visit(directory) {
      for (const name of fs.readdirSync(directory).sort()) {
        const filename = path.join(directory, name); const stat = fs.lstatSync(filename);
        assert.ok(rows.length < 20000);
        if (stat.isDirectory()) visit(filename);
        else { assert.ok(stat.isFile() && !stat.isSymbolicLink()); rows.push({path: path.relative(root, filename), bytes: stat.size}); }
      }
    }
    if (fs.existsSync(root)) visit(root);
    return Object.freeze(rows.map(Object.freeze));
  }
  function check() {
    const elapsedSeconds = (initialElapsed + performance.now() - started) / 1000;
    assert.ok(elapsedSeconds < 900, 'inclusive r5 deadline');
    assert.ok(starts + harmlessStarts <= 40);
    const rows = inventory(work);
    const rawBytes = fs.statSync(capture).size + rows.filter(row => /\.(stdout|stderr|jsonl)$/.test(row.path)).reduce((sum, row) => sum + row.bytes, 0);
    const chargedBytes = fs.statSync(capture).size + rows.reduce((sum, row) => sum + row.bytes, 0) + inventory(`${owned}/completion-r5`).reduce((sum, row) => sum + row.bytes, 0);
    assert.ok(rawBytes <= 67108864 && chargedBytes + 4194304 <= 268435456);
    return Object.freeze({elapsedSeconds, knownOsStarts: starts + harmlessStarts, peakKnownOs: 2, rawBytes, chargedBytes, reservedPublicationBytes: 4194304});
  }
  function output(value) { const bytes = Buffer.from(JSON.stringify(value) + '\n'); fs.writeSync(1, bytes); fs.writeSync(3, bytes); }
  async function subprocess(role, binary, args, options = {}) {
    check(); starts += 1; assert.ok(starts + harmlessStarts <= 40);
    const label = `${events.length}-${role}`; fs.mkdirSync(`${work}/raw`, {recursive: true, mode: 0o700});
    const stdoutPath = `${work}/raw/${label}.stdout`, stderrPath = `${work}/raw/${label}.stderr`;
    const stdout = fs.openSync(stdoutPath, 'wx', 0o600); let stderr;
    try { stderr = fs.openSync(stderrPath, 'wx', 0o600); } catch (error) { fs.closeSync(stdout); throw error; }
    const child = spawn(binary, args, {cwd: options.cwd ?? repository, env: {HOME: work, TMPDIR: work, TMP: work, TEMP: work, PATH: '/usr/bin:/bin', LANG: 'C', LC_ALL: 'C', NODE_OPTIONS: '', NODE_PATH: ''}, stdio: ['pipe', stdout, stderr]});
    child.stdin.on('error', () => {}); child.stdin.end(options.input);
    let failure;
    const timer = setInterval(() => { try { check(); } catch (error) { failure = error; child.kill('SIGKILL'); } }, 100);
    try {
      const result = await new Promise((resolve, reject) => { child.once('error', reject); child.once('close', (code, signal) => resolve({code, signal})); });
      events.push(Object.freeze({role, binary, args, ...result, stdoutPath, stderrPath}));
      if (failure) throw failure;
      assert.equal(result.signal, null); assert.ok((options.codes ?? [0]).includes(result.code), `${role} failed; see ${stderrPath}`);
      return {...result, stdout: read(stdoutPath), stderr: read(stderrPath)};
    } finally { clearInterval(timer); fs.closeSync(stdout); fs.closeSync(stderr); }
  }
  const git = (role, args, input) => subprocess(role, '/usr/bin/git', ['-c', 'gc.auto=0', '-c', 'maintenance.auto=false', '-c', 'core.hooksPath=/dev/null', '-c', 'commit.gpgsign=false', ...args], {input});
  async function patchFiles(files) {
    const patch = '*** Begin Patch\n' + files.map(({name, text}) => `*** Add File: ${namespace}/completion-r5/${name}\n${text.replace(/\n$/, '').split('\n').map(line => '+' + line).join('\n')}\n`).join('') + '*** End Patch\n';
    await subprocess('apply-patch', '/Users/kjopek/.codex/tmp/arg0/codex-arg0wITElD/apply_patch', [], {input: patch});
  }
  function preseal(filename) {
    const bytes = read(filename); invocation += 1;
    assert.ok(Number.isSafeInteger(invocation));
    const target = `${work}/invocation-${String(invocation).padStart(6, '0')}.mjs`;
    const identity = {invocation, original: filename, bytes: bytes.length, sha256: sha(bytes)};
    save(`${target}.preseal.json`, identity); save(target, bytes);
    return {target, identity};
  }
  const context = {repository, namespace, owned, work, stageRoot, read, save, sha, inventory, check, subprocess, git, patchFiles, events, vm, reserveHarmless(count) { assert.equal(harmlessStarts, 0); assert.equal(count, 4); harmlessStarts = count; check(); }, markMaterialized() { assert.equal(materialized, false); materialized = true; }};
  const inspection = JSON.parse(read('/private/tmp/safe-bash-b2-completion-r3-01a04d95/INSPECTION.json', {bytes: 5819094, sha256: 'ff8ee6723c96cd073ebdc979f37c8c0337f9087a337ee94806d979f5703a1da3'}));
  context.inspection = inspection;
  output({ready: 'R5_VERSIONED_FILE_BASED_CONTROLLER', census: check()});
  const input = readline.createInterface({input: process.stdin, terminal: false});
  for await (const line of input) {
    if (!line.trim()) continue;
    try {
      check(); const request = JSON.parse(line); let result;
      if (request.action === 'read') result = read(request.path ?? `${owned}/completion-r4/${request.file}`).toString().slice(request.offset ?? 0, (request.offset ?? 0) + (request.length ?? 4000));
      else if (request.action === 'patch') { await subprocess('apply-patch', '/Users/kjopek/.codex/tmp/arg0/codex-arg0wITElD/apply_patch', [], {input: request.patch}); result = {patched: true}; }
      else if (request.action === 'invoke') {
        const selected = preseal(`${owned}/completion-r5/${request.file}`);
        new vm.SourceTextModule(read(selected.target, selected.identity).toString());
        const module = await import(pathToFileURL(selected.target).href);
        result = await module[request.export ?? 'main'](context, request.options ?? {});
      } else if (request.action === 'invoke-control') {
        const before = events.length;
        const first = preseal(import.meta.filename), second = preseal(import.meta.filename);
        assert.notEqual(first.target, second.target); assert.equal(second.identity.invocation, first.identity.invocation + 1); assert.equal(events.length, before);
        result = {status: 'PURE_REPEATED_PRESEAL_CONTROL_PASS', first, second, additionalSubprocesses: 0, counterScope: 'main invocation lexical state, independent of child-event count', r4StopPreserved: true};
        save(`${work}/INVOKE-CONTROL.json`, result);
      } else if (request.action === 'commit') {
        const files = inventory(`${owned}/completion-r5`).map(row => `${namespace}/completion-r5/${row.path}`);
        await git('owned-add', ['add', '--', ...files]); await git('authored-whitespace', ['diff', '--cached', '--check', '--', ...files]);
        await git('atomic-owned-commit', ['commit', '--only', '-m', request.message, '--', ...files]);
        result = {commit: (await git('commit-id', ['rev-parse', 'HEAD'])).stdout.toString().trim(), census: check()};
        save(`${work}/COMMIT-${events.length}.json`, result);
      } else if (request.action === 'close') { output({closed: true, census: check(), events}); input.close(); break; }
      else throw new Error('unknown fixed operation');
      output({action: request.action, result});
    } catch (error) {
      const failure = {status: 'STOP', error: String(error.stack ?? error), events, materialized, noAutomaticRetry: true};
      try { save(`${work}/STOP.json`, failure); } catch {}
      output(failure); process.exitCode = 1; input.close(); break;
    }
  }
}
await main();
