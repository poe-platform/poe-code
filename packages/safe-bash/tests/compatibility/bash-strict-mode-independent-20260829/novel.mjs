import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import * as api from 'virtual-bash';
const cases = JSON.parse(await fs.readFile(new URL('./NOVEL-CASES.json', import.meta.url)));
const owners = new Set(), releases = new Set(), rows = [], unhandled = [];
process.on('unhandledRejection', reason => unhandled.push(String(reason)));
const turn = () => new Promise(resolve => setImmediate(resolve));
const capture = promise => promise.then(value => ({ kind: 'return', value }), reason => ({ kind: 'throw', reason }));
function deferred() { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; }
function create(memory = new api.MemoryFileSystem()) { const shell = new api.Shell({ fs: memory, cwd: '/' }).use(api.agentCommands()); owners.add(shell); return shell; }
for (const item of cases) {
  const row = { id: item.id, role: 'INDEPENDENT_RATIFIED_PROJECT_PROFILE_NOT_NATIVE_GOLDEN', pass: false };
  const timer = setTimeout(() => { console.error('CASE_DEADLINE', item.id); process.exit(78); }, 30000);
  try {
    if (item.program) {
      const memory = new api.MemoryFileSystem();
      for (const [name, text] of Object.entries(item.files ?? {})) await memory.writeFile(name, Buffer.from(text));
      const result = await create(memory).exec(item.program);
      row.actual = { status: result.exitCode, stdout: result.stdout, stderr: result.stderr, stdoutHex: Buffer.from(result.stdoutBytes).toString('hex'), stderrHex: Buffer.from(result.stderrBytes).toString('hex') };
      assert.equal(result.exitCode, item.status); assert.equal(result.stdout, item.stdout);
      assert.equal(result.stderr.split('unbound variable').length - 1, item.diagnostics);
      if (!item.diagnostics) assert.equal(result.stderr, ''); else { assert.ok(result.stderr.endsWith('\n')); assert.ok(!result.stderr.includes('NounsetFailure')); }
      for (const [name, text] of Object.entries(item.files ?? {})) assert.equal(Buffer.from(await memory.readFile(name)).toString(), text);
      for (const name of item.absentPaths ?? []) await assert.rejects(memory.lstat(name), error => error?.code === 'ENOENT');
      if (item.errorFile) { row.diagnosticFile = Buffer.from(await memory.readFile(item.errorFile)).toString(); assert.equal(row.diagnosticFile.split('unbound variable').length - 1, 1); assert.ok(row.diagnosticFile.endsWith('\n')); }
    } else if (item.host === 'substitution-false-sink' || item.host === 'source-null-sink') {
      const memory = new api.MemoryFileSystem(), reason = item.host === 'substitution-false-sink' ? false : null;
      await memory.writeFile('/fatal.sh', Buffer.from('printf "%s" "$missing"; printf WRONG\n'));
      const program = reason === false ? 'set -u; printf "%s" "$(printf "%s" "$missing")"; printf WRONG' : 'set -u; f(){ . /fatal.sh; printf WRONG; }; f || printf WRONG';
      let writes = 0; const outcome = await capture(create(memory).exec(program, { stderr: { async write() { writes++; throw reason; } } }));
      row.actual = { kind: outcome.kind, sameReason: outcome.kind === 'throw' && Object.is(outcome.reason, reason), writes };
      assert.equal(outcome.kind, 'throw'); assert.equal(outcome.reason, reason); assert.equal(writes, 1);
    } else if (item.host === 'pipeline-output-limit') {
      let writes = 0, forbiddenCalls = 0;
      const shell = create();
      shell.commands.register({ name: 'forbidden', execute() { forbiddenCalls++; return { exitCode: 0 }; } });
      const outcome = await capture(shell.exec('set -u; (printf "%s" "$missing") | cat; forbidden', { limits: { maxOutputBytes: 0 }, stderr: { async write() { writes++; } } }));
      row.actual = { kind: outcome.kind, limit: outcome.reason?.limit, writes, forbiddenCalls };
      assert.equal(outcome.kind, 'throw'); assert.ok(outcome.reason instanceof api.ShellLimitError); assert.equal(outcome.reason.limit, 'maxOutputBytes'); assert.equal(writes, 0); assert.equal(forbiddenCalls, 0);
    } else if (item.host === 'invoke-caller-cleanup') {
      const shell = create(), controller = new AbortController(), entered = deferred(), gate = deferred();
      releases.add(gate.resolve); let cleaned = 0, writes = 0;
      shell.commands.register({ name: 'bridge', async execute(context) { context.registerCleanup(async () => { await gate.promise; await turn(); cleaned++; }); return context.invoke('f', []); } });
      const reason = Object.freeze({ role: 'N16-caller' });
      const pending = capture(shell.exec('set -u; f(){ printf "%s" "$missing"; printf WRONG; }; bridge; printf WRONG', { signal: controller.signal, stderr: { async write() { writes++; entered.resolve(); await gate.promise; } } }));
      await entered.promise; controller.abort(reason); gate.resolve(); const outcome = await pending;
      row.actual = { kind: outcome.kind, sameReason: outcome.kind === 'throw' && outcome.reason === reason, writes, cleaned };
      assert.equal(outcome.kind, 'throw'); assert.equal(outcome.reason, reason); assert.equal(writes, 1); assert.equal(cleaned, 1);
    } else throw Error('Unknown sealed case');
    row.pass = true;
  } catch (reason) { row.primaryPresent = true; row.error = String(reason?.stack ?? reason); }
  finally {
    for (const release of releases) release(); releases.clear();
    const settled = await Promise.allSettled([...owners].map(owner => owner.dispose()));
    row.created = owners.size; row.disposed = settled.filter(item => item.status === 'fulfilled').length; row.cleanupFailure = row.created !== row.disposed;
    owners.clear(); await turn(); row.unhandledCount = unhandled.length; clearTimeout(timer);
  }
  rows.push(row); console.log(JSON.stringify(row)); if (row.cleanupFailure || row.unhandledCount) process.exit(78);
}
const summary = { cases: rows.length, pass: rows.filter(row => row.pass).length }; summary.fail = summary.cases - summary.pass;
console.log(JSON.stringify({ summary })); process.exitCode = summary.fail ? 1 : 0;
