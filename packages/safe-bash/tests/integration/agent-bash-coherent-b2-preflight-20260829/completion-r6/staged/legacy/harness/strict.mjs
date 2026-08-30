import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import * as api from 'virtual-bash';

const design = JSON.parse(await fs.readFile(new URL('strict-design.json', import.meta.url)));
const expected = {
  U01: 'ready\n', U02: '<>\n', U03: '<>\n', U04: '2|<-x>|<>\n0\n', U05: '2:a\n1:c\n',
  U08: 'eu\ne\n', U09: '<>\n', U10: null, U11: '<>\n', U12: 'default|default||default\n',
  U13: '<>|<>|<yes>|<>\n', U14: 'ok\nok\n', U15: 'ok|<>\n', U16: null, U18: null,
  U19: '<>|default\n', U20: 'n=0\n<>\n<>\n', U21: '<a>\n<>\n<b>\n<a::b>\n',
  U22: '<>\n<>\n', U23: '<>\n<>\n', U24: '<>\n', U25: null, U26: '<>\n',
  U29: null, U30: null, U37: '\nparent-after\n', U38: 'parent:1\n', U39: null,
  U40: null, U41: null, U42: 'parent:1\n', U43: 'pipeline:1\n', U44: 'guarded\ndone\n',
};
const fatal = new Set(['U10', 'U16', 'U18', 'U24', 'U25', 'U26', 'U29', 'U30', 'U39', 'U40', 'U41']);
const diagnosed = new Set([...fatal, 'U37', 'U38', 'U42', 'U43']);
const shells = new Set(), releases = new Set(), rows = [];
const turn = () => new Promise(resolve => setImmediate(resolve));
function deferred() { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; }
function create(memory = new api.MemoryFileSystem()) {
  const shell = new api.Shell({ fs: memory, cwd: '/' }).use(api.agentCommands());
  shells.add(shell); return shell;
}
const capture = promise => promise.then(value => ({ kind: 'return', value }), reason => ({ kind: 'throw', reason }));
async function record(id, execute) {
  if (process.env.STRICT_CASE && process.env.STRICT_CASE !== id) return;
  const row = { id, role: id.startsWith('U') ? 'ROOT_RESOLVED_PRODUCT_SELECTION_NOT_GNU_GOLDEN' : 'ADDITIONAL_CONTROL', pass: false };
  const timer = setTimeout(() => { console.error('CASE_DEADLINE', id); process.exit(78); }, 30000);
  try { await execute(row); row.pass = true; }
  catch (error) { row.error = String(error?.stack ?? error); }
  finally {
    for (const release of releases) release(); releases.clear();
    const results = await Promise.allSettled([...shells].map(shell => shell.dispose()));
    row.created = shells.size; row.disposed = results.filter(result => result.status === 'fulfilled').length;
    row.cleanupFailure = row.created !== row.disposed;
    shells.clear(); clearTimeout(timer);
  }
  rows.push(row); console.log(JSON.stringify(row));
  if (row.cleanupFailure) process.exit(78);
}
for (const item of design.cases) {
  if (!Object.hasOwn(expected, item.id)) continue;
  await record(item.id, async row => {
    const memory = new api.MemoryFileSystem();
    for (const [name, text] of Object.entries(item.files ?? {})) await memory.writeFile('/' + name, new TextEncoder().encode(text));
    const result = await create(memory).exec(item.program);
    row.actual = { status: result.exitCode, stdout: result.stdout, stderr: result.stderr };
    assert.equal(result.exitCode, fatal.has(item.id) ? 1 : 0);
    assert.equal(result.stdout, expected[item.id] ?? '');
    if (diagnosed.has(item.id)) {
      assert.equal(result.stderr.split('unbound variable').length - 1, 1);
      assert.ok(result.stderr.endsWith('\n'));
      assert.doesNotMatch(result.stderr, /after|NounsetFailure|NounsetDiagnosticFailure/);
    } else assert.equal(result.stderr, '');
    for (const [name, text] of Object.entries(item.files ?? {})) assert.equal(Buffer.from(await memory.readFile('/' + name)).toString(), text);
  });
}
await record('U45', async () => {
  const shell = create();
  assert.equal((await shell.exec('set -u; printf "%s" "$missing"')).exitCode, 1);
  const next = await shell.exec('printf "<%s>" "$missing"');
  assert.equal(next.exitCode, 0); assert.equal(next.stdout, '<>'); assert.equal(next.stderr, '');
});
await record('U46', async () => {
  const shell = create(); let cleaned = 0;
  shell.commands.register({ name: 'bridge', async execute(context) {
    context.registerCleanup(async () => { await turn(); cleaned++; });
    const child = await context.invoke('f', []);
    await context.stdout.write(Buffer.from(`child:${child.exitCode}\n`));
    return { exitCode: 0 };
  } });
  const result = await shell.exec('set -u; f(){ printf "%s" "$missing"; printf child-after; }; bridge; printf "parent\\n"');
  assert.equal(result.exitCode, 0); assert.equal(result.stdout, 'child:1\nparent\n');
  assert.equal(result.stderr.split('unbound variable').length - 1, 1); assert.equal(cleaned, 1);
});
await record('U47', async () => {
  const shell = create(), controller = new AbortController(), started = deferred(), gate = deferred();
  releases.add(gate.resolve); let cleaned = 0;
  shell.commands.register({ name: 'guard', async execute(context) {
    context.registerCleanup(async () => { await turn(); cleaned++; }); return { exitCode: 0 };
  } });
  const reason = Object.freeze({ role: 'caller' });
  const pending = capture(shell.exec('guard; set -u; printf "%s" "$missing"', {
    signal: controller.signal, stderr: { async write() { started.resolve(); await gate.promise; } },
  }));
  await started.promise; controller.abort(reason); gate.resolve();
  const outcome = await pending;
  assert.equal(outcome.kind, 'throw'); assert.equal(outcome.reason, reason); assert.equal(cleaned, 1);
});
await record('U48', async () => {
  let writes = 0;
  const outcome = await capture(create().exec('set -u; printf "%s" "$missing"', {
    limits: { maxOutputBytes: 0 }, stderr: { async write() { writes++; } },
  }));
  assert.equal(outcome.kind, 'throw'); assert.ok(outcome.reason instanceof api.ShellLimitError);
  assert.equal(outcome.reason.limit, 'maxOutputBytes'); assert.equal(writes, 0);
});
await record('U49', async () => {
  for (const reason of [Object.freeze({ role: 'diagnostic-sink' }), undefined]) {
    let writes = 0;
    const outcome = await capture(create().exec('set -u; printf "%s" "$missing"', {
      stderr: { async write() { writes++; throw reason; } },
    }));
    assert.equal(outcome.kind, 'throw'); assert.equal(outcome.reason, reason); assert.equal(writes, 1);
  }
});
await record('U50', async () => {
  const shell = create(), reason = Object.freeze({ role: 'registered-cleanup' }); let cleaned = 0;
  shell.commands.register({ name: 'guard', async execute(context) {
    context.registerCleanup(async () => { await turn(); cleaned++; throw reason; }); return { exitCode: 0 };
  } });
  const outcome = await capture(shell.exec('guard; set -u; printf "%s" "$missing"'));
  assert.equal(outcome.kind, 'throw'); assert.equal(outcome.reason, reason); assert.equal(cleaned, 1);
});
await record('E01-active-file-stderr', async () => {
  const memory = new api.MemoryFileSystem();
  const result = await create(memory).exec('set -u; { printf "%s" "$missing"; } 2>err; printf after');
  assert.equal(result.exitCode, 1); assert.equal(result.stdout, ''); assert.equal(result.stderr, '');
  assert.match(Buffer.from(await memory.readFile('/err')).toString(), /missing: unbound variable\n$/);
});
await record('E02-here-string', async () => {
  const result = await create().exec('set -u; cat <<<"$missing"; printf after');
  assert.equal(result.exitCode, 1); assert.equal(result.stdout, ''); assert.match(result.stderr, /missing: unbound variable\n$/);
});
await record('E03-ordered-redirect-effects', async () => {
  const memory = new api.MemoryFileSystem();
  const result = await create(memory).exec('set -u; : >created 2>err >"$missing"; printf after');
  assert.equal(result.exitCode, 1); assert.equal(result.stdout, ''); assert.equal(result.stderr, '');
  assert.equal((await memory.readFile('/created')).length, 0);
  assert.match(Buffer.from(await memory.readFile('/err')).toString(), /missing: unbound variable\n$/);
  assert.deepEqual((await memory.readdir('/')).map(entry => entry.name).sort(), ['created', 'err']);
});
await record('E04-lazy-array-zero', async () => {
  const result = await create().exec('set -u; a=([0]=ok); printf "%s|%s" "${a:-$missing}" "${a:=ignored}"');
  assert.equal(result.exitCode, 0); assert.equal(result.stdout, 'ok|ok'); assert.equal(result.stderr, '');
});
await record('E05-function-option-state', async () => {
  const result = await create().exec('set -u; f(){ set +u; }; f; printf "<%s>" "$missing"');
  assert.equal(result.exitCode, 0); assert.equal(result.stdout, '<>'); assert.equal(result.stderr, '');
});
await record('E06-if-not-errexit', async () => {
  const result = await create().exec('set -u; if printf "%s" "$missing"; then printf bad; fi; printf after');
  assert.equal(result.exitCode, 1); assert.equal(result.stdout, ''); assert.match(result.stderr, /unbound variable/);
});
await record('E07-here-document', async () => {
  const result = await create().exec('set -u\ncat <<EOF\n$missing\nEOF\nprintf after');
  assert.equal(result.exitCode, 1); assert.equal(result.stdout, ''); assert.match(result.stderr, /unbound variable/);
});
await record('E08-nested-sink-rejection', async () => {
  for (const program of ['set -u; f(){ printf "%s" "$missing"; }; f', 'set -u; (printf "%s" "$missing")', 'set -u; printf "%s" "$missing" | cat']) {
    const reason = Object.freeze({ program }); let writes = 0;
    const outcome = await capture(create().exec(program, { stderr: { async write() { writes++; throw reason; } } }));
    assert.equal(outcome.kind, 'throw'); assert.equal(outcome.reason, reason); assert.equal(writes, 1);
  }
});
await record('E09-invoke-sink-boundary', async () => {
  const shell = create(), reason = Object.freeze({ role: 'child-stderr' }); let caught = 0;
  shell.commands.register({ name: 'bridge', async execute(context) {
    const result = await capture(context.invoke('f', [], { stderr: { async write() { throw reason; } } }));
    assert.equal(result.kind, 'throw'); assert.equal(result.reason, reason); caught++; return { exitCode: 0 };
  } });
  const result = await shell.exec('set -u; f(){ printf "%s" "$missing"; }; bridge; printf parent');
  assert.equal(result.exitCode, 0); assert.equal(result.stdout, 'parent'); assert.equal(caught, 1);
});
await record('E10-primary-sink-cleanup', async () => {
  const shell = create(), sink = Object.freeze({ role: 'primary' }), cleanup = Object.freeze({ role: 'secondary' }); let cleaned = 0;
  shell.commands.register({ name: 'guard', async execute(context) {
    context.registerCleanup(async () => { await turn(); cleaned++; throw cleanup; }); return { exitCode: 0 };
  } });
  const outcome = await capture(shell.exec('guard; set -u; printf "%s" "$missing"', { stderr: { async write() { throw sink; } } }));
  assert.equal(outcome.kind, 'throw'); assert.equal(outcome.reason, sink); assert.equal(cleaned, 1);
});
await record('E11-substitution-errexit', async () => {
  const result = await create().exec('set -eu; value=$(printf "%s" "$missing"); printf after');
  assert.equal(result.exitCode, 1); assert.equal(result.stdout, ''); assert.match(result.stderr, /unbound variable/);
});
const summary = { cases: rows.length, pass: rows.filter(row => row.pass && !row.cleanupFailure).length };
summary.fail = summary.cases - summary.pass;
console.log(JSON.stringify({ summary })); process.exitCode = summary.fail ? 1 : 0;
