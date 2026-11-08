import assert from 'node:assert/strict';
import fs from 'node:fs';
import * as api from 'virtual-bash';

const design = JSON.parse(fs.readFileSync(new URL('./extension-design.json', import.meta.url)));
const rows = [], shells = new Set(), releases = new Set();
const capture = promise => promise.then(value => ({ kind: 'return', value }), reason => ({ kind: 'throw', reason }));
const turn = () => new Promise(resolve => setImmediate(resolve));
function deferred() { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; }
function create(options = {}) { const shell = new api.Shell({ fs: new api.MemoryFileSystem(), cwd: '/', ...options }).use(api.agentCommands()); shells.add(shell); return shell; }
async function record(id, execute) {
  if (process.env.EXT_CASE && process.env.EXT_CASE !== id) return;
  const row = { id, role: 'RATIFIED_PRODUCT_PROFILE_NOT_NATIVE_GOLDEN', pass: false };
  const timer = setTimeout(() => { console.error('CASE_DEADLINE', id); process.exit(78); }, 30000);
  try { await execute(row); row.pass = true; }
  catch (error) { row.error = String(error?.stack ?? error); }
  finally {
    for (const release of releases) release(); releases.clear();
    const disposed = await Promise.allSettled([...shells].map(shell => shell.dispose()));
    row.created = shells.size; row.disposed = disposed.filter(item => item.status === 'fulfilled').length;
    row.cleanupFailure = row.created !== row.disposed; shells.clear(); clearTimeout(timer);
  }
  rows.push(row); console.log(JSON.stringify(row)); if (row.cleanupFailure) process.exit(78);
}
const listing = 'errexit\toff\nnounset\ton\npipefail\toff\n';
const expected = {
  U06: [0, 'after\n', 0, 1], U07: [0, listing + 'after\n'], U17: [127, '', 0, 0, 'required'],
  U28: [0, '0|0\n'], U31: [1, '', 1], U32: [0, '2\n'], U33: [1, '', 1], U34: [1, '', 1],
  U35: [0, '1\n1\n4\n'], U36: [1, '', 1],
  'S-U06-PARTIAL-v1': [1, 'set-status:1\n', 1, 1],
  'S-U07-LIST-STATUS-v1': [0, listing + 'list-status:0\nafter\n'],
  'S-ARITH-SUBSHELL-v1': [0, 'parent:1\n', 1],
  'S-ARITH-SUBSTITUTION-v1': [0, 'status:1|result:\n', 1],
  'E19-plus-tail': [0, 'set:1|flags:\n\n', 0, 1],
  'E20-subset-listing': [0, 'set +o errexit\nset -o nounset\nset +o pipefail\ncount:2|first:one\n'],
  'E21-write-only-chain': [0, '2|2\n'], 'E22-function-fatal': [1, '', 1],
};
for (const item of design.cases) {
  if (!Object.hasOwn(expected, item.id)) continue;
  await record(item.id, async row => {
    const result = await create().exec(item.program); row.actual = result;
    const [status, stdout, missing = 0, invalid = 0, explicit] = expected[item.id];
    assert.equal(result.exitCode, status); assert.equal(result.stdout, stdout);
    assert.equal(result.stderr.split('missing: unbound variable').length - 1, missing);
    assert.equal(result.stderr.split('unsupported shell option').length - 1, invalid);
    if (explicit) assert.match(result.stderr, /missing: required\n$/);
    else if (!missing && !invalid) assert.equal(result.stderr, '');
    if (missing) assert.doesNotMatch(result.stderr, /let:|\(\(:|NounsetFailure|NounsetDiagnosticFailure/);
  });
}
await record('H24-preabort', async () => {
  const controller = new AbortController(), reason = Object.freeze({ caller: 'preabort' }); let writes = 0;
  controller.abort(reason);
  const outcome = await capture(create().exec('set -u; let "missing++"', { signal: controller.signal, stderr: { async write() { writes++; } } }));
  assert.equal(outcome.kind, 'throw'); assert.equal(outcome.reason, reason); assert.equal(writes, 0);
});
await record('H25-falsy-sink', async () => {
  for (const reason of [undefined, null, false, 0, '']) {
    let writes = 0; const outcome = await capture(create().exec('set -u; let "missing++"', { stderr: { async write() { writes++; throw reason; } } }));
    assert.equal(outcome.kind, 'throw'); assert.equal(outcome.reason, reason); assert.equal(writes, 1);
  }
});
await record('H26-read-budget', async () => {
  const outcome = await capture(create().exec('set -u; let value', { env: { value: '1'.repeat(64) }, limits: { maxExpansionBytes: 32 } }));
  assert.equal(outcome.kind, 'throw'); assert.ok(outcome.reason instanceof api.ShellLimitError); assert.equal(outcome.reason.limit, 'maxExpansionBytes');
});
await record('H27-registered-cleanup', async row => {
  row.variants = [];
  for (const reject of [false, true]) {
    const shell = create(), entered = deferred(), gate = deferred(), reason = Object.freeze({ cleanup: reject });
    releases.add(gate.resolve); let settled = false, cleaned = 0;
    shell.commands.register({ name: 'guard', async execute(context) {
      context.registerCleanup(async () => { entered.resolve(); await gate.promise; cleaned++; if (reject) throw reason; });
      return context.invoke('f', []);
    } });
    const pending = capture(shell.exec('f() { set -u; let "missing++"; }; guard')).then(outcome => { settled = true; return outcome; });
    try { await entered.promise; await turn(); assert.equal(settled, false); assert.equal(cleaned, 0); }
    finally { gate.resolve(); releases.delete(gate.resolve); }
    const outcome = await pending; assert.equal(cleaned, 1);
    if (reject) { assert.equal(outcome.kind, 'throw'); assert.equal(outcome.reason, reason); }
    else { assert.equal(outcome.kind, 'return'); assert.equal(outcome.value.exitCode, 1); }
    row.variants.push({ reject, cleaned, settled, outcome: outcome.kind });
  }
});
await record('H28-caller-during-diagnostic', async row => {
  const shell = create(), controller = new AbortController(), started = deferred(), gate = deferred();
  const reason = Object.freeze({ caller: true }), cleanup = Object.freeze({ secondary: true });
  releases.add(gate.resolve); let cleaned = 0, settled = false;
  shell.commands.register({ name: 'guard', async execute(context) {
    context.registerCleanup(async () => { await gate.promise; cleaned++; throw cleanup; }); return context.invoke('f', []);
  } });
  const pending = capture(shell.exec('f() { set -u; let "missing++"; }; guard', { signal: controller.signal, stderr: { async write() { started.resolve(); await gate.promise; } } })).then(outcome => { settled = true; return outcome; });
  try { await started.promise; controller.abort(reason); await turn(); assert.equal(settled, false); }
  finally { gate.resolve(); releases.delete(gate.resolve); }
  const outcome = await pending; assert.equal(outcome.kind, 'throw'); assert.equal(outcome.reason, reason); assert.equal(cleaned, 1); row.cleaned = cleaned;
});
await record('X01-sh-policy', async row => {
  row.variants = [];
  for (const [program, status, stdout] of [["sh -c 'set -uz; printf after'", 2, ''], ["sh -c 'command set -uz; printf \"%s:%s\" \"$?\" \"$-\"'", 0, '2:']]) {
    const result = await create().exec(program); row.variants.push(result); assert.equal(result.exitCode, status); assert.equal(result.stdout, stdout); assert.match(result.stderr, /unsupported shell option/);
  }
});
await record('X02-positional-listing', async () => {
  const result = await create().exec('set -- a b; set -eu -o pipefail; set +o; set +eu; set -o; set - x y; printf "%s|%s|%s" "$#" "$1" "$2"');
  assert.equal(result.exitCode, 0); assert.equal(result.stderr, '');
  assert.equal(result.stdout, 'set -o errexit\nset -o nounset\nset -o pipefail\nerrexit\toff\nnounset\toff\npipefail\ton\n2|x|y');
});
await record('X03-errexit', async () => {
  const stopped = await create().exec('set -ez; printf after'); assert.equal(stopped.exitCode, 1); assert.equal(stopped.stdout, ''); assert.match(stopped.stderr, /unsupported shell option/);
  const ignored = await create().exec('if set -ez; then printf bad; fi; printf after'); assert.equal(ignored.exitCode, 0); assert.equal(ignored.stdout, 'after'); assert.match(ignored.stderr, /unsupported shell option/);
});
await record('X04-lazy-fixed64', async () => {
  const result = await create().exec('set -u; printf "%s|%s|%s|%s" "$((0 && missing))" "$((1 || missing))" "$((0 ? missing : 9))" "$((9223372036854775807+1))"');
  assert.equal(result.exitCode, 0); assert.equal(result.stderr, ''); assert.equal(result.stdout, '0|1|9|-9223372036854775808');
});
await record('X05-optind-substring', async row => {
  row.variants = [];
  for (const program of ['set -u; OPTIND=missing; printf after', 'set -u; value=abc; printf "%s" "${value:missing}"; printf after']) {
    const result = await create().exec(program); row.variants.push(result); assert.equal(result.exitCode, 1); assert.equal(result.stdout, ''); assert.match(result.stderr, /missing: unbound variable\n$/);
  }
});
await record('X06-existing-refusals', async () => {
  const indexed = await create().exec('set -u; a=(1); let a'); assert.equal(indexed.exitCode, 1); assert.equal(indexed.stdout, ''); assert.match(indexed.stderr, /indexed arithmetic is unsupported/);
  const readonly = await create().exec('readonly value=7; let "value=8"; printf "%s:%s" "$?" "$value"'); assert.equal(readonly.exitCode, 0); assert.equal(readonly.stdout, '1:7'); assert.match(readonly.stderr, /readonly variable/);
});
await record('X07-parameter-falsy-sink', async () => {
  for (const reason of [undefined, null, false, 0, '', Object.freeze({ sink: true })]) {
    let writes = 0; const outcome = await capture(create().exec('printf "%s" "${missing:?required}"', { stderr: { async write() { writes++; throw reason; } } }));
    assert.equal(outcome.kind, 'throw'); assert.equal(outcome.reason, reason); assert.equal(writes, 1);
  }
});
await record('X08-parameter-limit', async () => {
  let writes = 0;
  const outcome = await capture(create().exec('printf "%s" "${missing:?required}"', { limits: { maxOutputBytes: 0 }, stderr: { async write() { writes++; } } }));
  assert.equal(outcome.kind, 'throw'); assert.ok(outcome.reason instanceof api.ShellLimitError); assert.equal(outcome.reason.limit, 'maxOutputBytes'); assert.equal(writes, 0);
  const reason = new api.ShellLimitError('maxExpansionBytes');
  const raw = await capture(create().exec('printf "%s" "${missing:?required}"', { stderr: { async write() { throw reason; } } }));
  assert.equal(raw.kind, 'throw'); assert.equal(raw.reason, reason);
});
await record('X09-parameter-cleanup', async () => {
  const shell = create(), secondary = Object.freeze({ cleanup: true }); let cleaned = 0;
  shell.commands.register({ name: 'guard', async execute(context) { context.registerCleanup(async () => { await turn(); cleaned++; throw secondary; }); return { exitCode: 0 }; } });
  const outcome = await capture(shell.exec('guard; printf "%s" "${missing:?required}"', { stderr: { async write() { throw undefined; } } }));
  assert.equal(outcome.kind, 'throw'); assert.equal(outcome.reason, undefined); assert.equal(cleaned, 1);
});
await record('X10a-parameter-isolated-status-v2', async row => {
  const status = await create().exec('(printf "%s" "${missing:?required}")');
  row.actual = status;
  assert.equal(status.exitCode, 1); assert.equal(status.stdout, ''); assert.match(status.stderr, /missing: required\n$/);
});
await record('X10b-parameter-isolated-null-v2', async row => {
  let writes = 0;
  const rejected = await capture(create().exec('(printf "%s" "${missing:?required}")', { stderr: { async write() { writes++; throw null; } } }));
  row.outcome = rejected.kind; row.writes = writes; row.reasonIsNull = rejected.reason === null;
  assert.equal(rejected.kind, 'throw'); assert.equal(rejected.reason, null); assert.equal(writes, 1);
});
await record('X10c-parameter-caller-cleanup-v2', async row => {
  const shell = create(), entered = deferred(), gate = deferred(), controller = new AbortController();
  const reason = Object.freeze({ caller: 'parameter' }); let cleaned = 0, settled = false;
  row.events = [];
  const observe = event => { row.events.push(event); console.error(JSON.stringify({ protocol: row.id, event })); };
  const release = () => { observe('gate-release'); gate.resolve(); };
  releases.add(release);
  shell.commands.register({ name: 'guard', async execute(context) {
    context.registerCleanup(async () => { observe('cleanup-entry'); await gate.promise; cleaned++; observe('cleanup-finished'); });
    observe('cleanup-registered');
    return context.invoke('f', []);
  } });
  const pending = capture(shell.exec('f() { printf "%s" "${missing:?required}"; }; guard', {
    signal: controller.signal,
    stderr: { async write() { observe('diagnostic-entered'); entered.resolve(); await gate.promise; observe('diagnostic-raw-false'); throw false; } },
  })).then(outcome => { settled = true; observe('public-settlement'); return outcome; });
  try {
    const first = await Promise.race([entered.promise.then(() => 'entered'), pending.then(() => 'premature-settlement')]);
    assert.equal(first, 'entered');
    controller.abort(reason); observe('caller-abort');
    await turn(); assert.equal(settled, false); assert.equal(cleaned, 0);
  } finally { release(); releases.delete(release); }
  const outcome = await pending;
  row.outcome = outcome.kind; row.callerIdentity = outcome.reason === reason; row.cleaned = cleaned;
  assert.equal(outcome.kind, 'throw'); assert.equal(outcome.reason, reason); assert.equal(cleaned, 1);
  for (const event of ['cleanup-registered', 'diagnostic-entered', 'caller-abort', 'gate-release', 'cleanup-entry', 'cleanup-finished', 'public-settlement']) assert.ok(row.events.includes(event));
  assert.ok(row.events.indexOf('cleanup-registered') < row.events.indexOf('diagnostic-entered'));
  assert.ok(row.events.indexOf('diagnostic-entered') < row.events.indexOf('caller-abort'));
  assert.ok(row.events.indexOf('caller-abort') < row.events.indexOf('gate-release'));
  assert.ok(row.events.indexOf('gate-release') < row.events.indexOf('cleanup-finished'));
  assert.ok(row.events.indexOf('cleanup-finished') < row.events.indexOf('public-settlement'));
});
console.log(JSON.stringify({ summary: { cases: rows.length, pass: rows.filter(row => row.pass).length, fail: rows.filter(row => !row.pass).length, native: 0 } }));
process.exitCode = rows.every(row => row.pass) ? 0 : 1;
