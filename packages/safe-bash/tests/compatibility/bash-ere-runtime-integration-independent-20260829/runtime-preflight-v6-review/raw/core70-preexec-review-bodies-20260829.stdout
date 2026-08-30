import * as fs from 'node:fs';
import assert from 'node:assert/strict';
import { boundFile, deferred } from './guards.mjs';
import { h03Expansion } from './additions.mjs';

async function exactRejection(promise, reason) {
  let caught, rejected = false;
  try { await promise; } catch (error) { rejected = true; caught = error; }
  assert.equal(rejected, true); assert.strictEqual(caught, reason);
}

export async function h02({ shell, observer }) {
  observer.select('checkpoint');
  for (const reason of [Object.freeze({ inFlight: true }), false]) {
    const caller = new AbortController();
    const witnessed = observer.expectWitness();
    const pending = shell.exec('[[ aaaa =~ (a+) ]]', { signal: caller.signal });
    void pending.catch(() => {});
    try {
      await Promise.race([witnessed, pending.then(() => { throw new Error('matcher completed before witness'); }, error => { throw error; })]);
      caller.abort(reason);
      await exactRejection(pending, reason);
      observer.assertRetired();
    } finally { caller.abort(reason); await Promise.allSettled([pending]); }
  }
  observer.select('stock');
}

export async function h03(context) {
  const { shell, observer, emit } = context;
  await h03Expansion(context);
  const variants = [
    ['group32', '('.repeat(32) + 'a' + ')'.repeat(32), 'a', 0],
    ['group33', '('.repeat(33) + 'a' + ')'.repeat(33), 'a', 2],
    ['nodes4096', 'a'.repeat(4095), '', 1],
    ['nodes4097', 'a'.repeat(4096), '', 2],
    ['interval255', 'a{255}', 'a'.repeat(255), 0],
    ['interval256', 'a{256}', 'a', 2],
    ['private-pattern-limit', 'a'.repeat(65537), 'a', 3],
    ['private-work', '(a|aa){18}', 'a'.repeat(36), 3, { maxExpansionBytes: 512, maxExpansionFields: 16384 }],
    ['private-state', '(a|aa){64}', 'a'.repeat(128), 3, { maxExpansionBytes: 1048576, maxExpansionFields: 128 }],
  ];
  for (const [id, re, subject, status, limits] of variants) {
    const before = observer.rows.length;
    const result = await shell.exec('BASH_REMATCH=(saved); [[ "$subject" =~ $re ]]; result=$?; printf "%s\\n" "${BASH_REMATCH[0]}"; exit "$result"', { env: { re, subject }, ...(limits ? { limits } : {}) });
    observer.assertRetired(); assert.equal(result.exitCode, status, id);
    if (status === 2 || status === 3) assert.equal(result.stdout, 'saved\n', id);
    if (status < 2) assert.equal(result.stderr, '', id);
    if (id === 'private-pattern-limit') assert.equal(observer.rows.length, before);
    if (id === 'private-work') assert.ok(result.stderr.includes('work'), result.stderr);
    if (id === 'private-state') assert.ok(result.stderr.includes('states'), result.stderr);
    emit({ event: 'subcase', id: 'H03/' + id, status, workerDelta: observer.rows.length - before, stderr: result.stderr });
  }
  emit({ event: 'source-proof', id: 'H03/depth64', classification: 'UNREACHABLE_SOURCE_ONLY', reason: 'Every recursive expression(depth+1) is entered only after the32-group guard; no public path reaches depth64.' });
}

export async function h04({ shell, observer, arrays, emit }) {
  assert.ok(arrays);
  let result = await shell.exec('[[ aaaa =~ ((a+)(a*)) ]]; printf "<%s>\\n" "${BASH_REMATCH[@]}"');
  assert.equal(result.exitCode, 0); assert.equal(result.stdout, '<aaaa>\n<aaaa>\n<aaaa>\n<>\n');
  await arrays.settle(); observer.assertRetired();
  const entered = deferred(), release = deferred();
  shell.register({ name: 'hold_snapshot', execute(context) {
    assert.equal(typeof context.registerCleanup, 'function');
    context.registerCleanup(() => { release.resolve(); });
    entered.resolve(); return release.promise.then(() => ({ exitCode: 0 }));
  } });
  shell.register({ name: 'replace_with_snapshot_alive', async execute(context) {
    assert.equal(typeof context.invoke, 'function');
    const held = context.invoke('snapshot_child', []); void held.catch(() => {});
    try { await entered.promise; const changed = await context.invoke('replace_capture', []); assert.equal(changed.exitCode, 0); }
    finally { release.resolve(); }
    return held;
  } });
  try {
    result = await shell.exec('BASH_REMATCH=(old); snapshot_child(){ ( hold_snapshot; printf "old:%s\\n" "${BASH_REMATCH[0]}" ); }; replace_capture(){ [[ aa =~ (a+) ]]; printf "new:%s\\n" "${BASH_REMATCH[0]}"; }; replace_with_snapshot_alive; printf "final:%s\\n" "${BASH_REMATCH[0]}"');
    assert.equal(result.exitCode, 0); assert.equal(result.stdout, 'new:aa\nold:old\nfinal:aa\n');
  } finally { release.resolve(); entered.cancel(); }
  await arrays.settle(); observer.assertRetired();
  assert.ok(arrays.rows.some(row => row.kind === 'binding' && row.name === 'retain'));
  assert.ok(arrays.rows.some(row => row.kind === 'binding' && row.name === 'release' && row.outcome === 'settled'));
  const before = arrays.rows.length;
  result = await shell.exec('[[ a =~ (a) ]]', { limits: { maxExpansionFields: 1 } });
  assert.equal(result.exitCode, 1); assert.ok(result.stderr.includes('indexed array: private'), result.stderr);
  await arrays.settle(); observer.assertRetired();
  const refusals = arrays.rows.slice(before).filter(row => row.name === 'reserve' && row.outcome === 'throw');
  assert.ok(refusals.length > 0);
  for (const row of refusals) assert.deepEqual(row.after, row.before, 'failure-atomic private reservation');
  for (const row of arrays.rows) if (row.after?.caps) for (let index = 0; index < 7; index++) assert.ok(row.after.used[index] <= row.after.caps[index]);
  const reason = Object.freeze({ registeredCleanup: true }); let cleaned = 0;
  shell.register({ name: 'retirement_failure', execute(context) { assert.equal(typeof context.registerCleanup, 'function'); context.registerCleanup(() => { cleaned++; throw reason; }); return { exitCode: 0 }; } });
  await exactRejection(shell.exec('[[ a =~ (a) ]]; retirement_failure'), reason);
  assert.equal(cleaned, 1); await arrays.settle(); observer.assertRetired();
  emit({ event: 'array-observer', rows: arrays.rows, qualification: 'Instrumented snapshots/call/settlement; registered host cleanup rejection is not an injected ArrayOwner.close rejection. MAX_SAFE_INTEGER ticket exhaustion remains source-only.' });
}

export async function h05({ shell, observer }) {
  for (const variant of ['readonly', 'stale', 'local-restoration', 'caller']) {
    const gate = observer.requestGate(), caller = new AbortController(), reason = Object.freeze({ caller: variant });
    const name = 'mutating_' + variant.replaceAll('-', '_');
    shell.register({ name, async execute(context) {
      assert.equal(typeof context.invoke, 'function');
      const pending = context.invoke('match_target', []); void pending.catch(() => {});
      try {
        await gate.entered;
        if (variant === 'caller') { caller.abort(reason); gate.cancel(); }
        else {
          const changed = variant === 'readonly' ? await context.invoke('readonly', ['BASH_REMATCH']) : await context.invoke(variant === 'stale' ? 'unrelated_mutation' : 'local_restoration', []);
          assert.equal(changed.exitCode, 0); gate.forward();
        }
        return await pending;
      } finally { gate.cancel(); }
    } });
    const script = 'BASH_REMATCH=(saved); match_target(){ [[ aa =~ (a+) ]]; }; unrelated_mutation(){ unrelated=changed; }; local_restoration(){ local probe=entered; :; }; ' + name + '; printf "%s:<%s>\\n" "$?" "${BASH_REMATCH[0]}"';
    if (variant === 'caller') await exactRejection(shell.exec(script, { signal: caller.signal }), reason);
    else {
      const result = await shell.exec(script);
      assert.equal(result.stdout, (variant === 'readonly' ? '0' : '1') + ':<saved>\n');
      assert.ok(result.stderr.includes(variant === 'readonly' ? 'readonly variable' : 'stale binding'), result.stderr);
    }
    observer.assertRetired();
  }
}

export async function h07({ shell, observer, cell }) {
  const modes = ['wrong-id', 'wrong-operation', 'wrong-count', 'out-of-range-span', 'fractional-span', 'extra-key', 'late-reply'];
  const sample = cell.worker.roles.find(role => role.name === 'positive').file;
  const before = observer.rows.length;
  assert.throws(() => boundFile({ ...sample, sha256: sample.sha256[0] === '0' ? '1' + sample.sha256.slice(1) : '0' + sample.sha256.slice(1) }), /file hash/);
  assert.equal(observer.rows.length, before);
  assert.throws(() => fs.readFileSync(cell.deniedFile), error => error?.code === 'ERR_ACCESS_DENIED');
  let late;
  shell.register({ name: 'await_duplicate', execute() { return late.then(() => ({ exitCode: 0 })); } });
  for (const mode of modes) {
    observer.select(mode);
    if (mode === 'late-reply') late = observer.expectReplies(2);
    let rejected = false, reason;
    try { await shell.exec(mode === 'late-reply' ? '[[ a =~ (a) ]]; await_duplicate; [[ a =~ (a) ]]' : '[[ a =~ (a) ]]'); }
    catch (error) { rejected = true; reason = error; }
    assert.equal(rejected, true, mode); assert.equal(reason?.code, 'PROTOCOL', mode); observer.assertRetired();
    observer.select('positive');
    const restored = await shell.exec('[[ a =~ (a) ]]; printf "%s\\n" "${BASH_REMATCH[1]}"');
    assert.equal(restored.exitCode, 0); assert.equal(restored.stdout, 'a\n'); assert.equal(restored.stderr, ''); observer.assertRetired();
  }
  observer.select('stock');
  const stock = await shell.exec('[[ a =~ (a) ]]'); assert.equal(stock.exitCode, 0); observer.assertRetired();
}
