import assert from 'node:assert/strict';

async function rejectsIdentity(operation, expected) {
  let rejected = false;
  let reason;
  try { await operation(); } catch (error) { rejected = true; reason = error; }
  assert.equal(rejected, true);
  assert.strictEqual(reason, expected);
}

export async function h03Expansion({ api, shell, observer }) {
  const before = observer.rows.length;
  let rejected = false;
  let reason;
  try {
    await shell.exec('[[ ${payload} =~ a ]]', {
      env: { payload: 'aa' },
      limits: { maxExpansionBytes: 1 },
    });
  } catch (error) { rejected = true; reason = error; }
  assert.equal(rejected, true);
  assert.ok(reason instanceof api.ShellLimitError);
  assert.equal(reason.limit, 'maxExpansionBytes');
  assert.equal(observer.rows.length, before);
  assert.equal(before, 0);
  observer.assertRetired();
}

export async function h06False({ shell, observer }) {
  await rejectsIdentity(() => shell.exec("bad='('; [[ a =~ $bad ]]", {
    stderr: { write() { throw false; } },
  }), false);
  observer.assertRetired();
}

export function h08Fresh({ observer }) {
  assert.equal(observer.rows.length, 2);
  const previous = observer.rows[0].requests[0].work;
  const fresh = observer.rows[1].requests[0].work;
  assert.ok(Number.isSafeInteger(previous) && previous > 0);
  assert.ok(Number.isSafeInteger(fresh) && fresh > 0);
  assert.equal(fresh, previous);
}

export async function eh04({ shell, observer }) {
  for (const variant of ['cleanup-only', 'sink-primary', 'caller-primary']) {
    const cleanupReason = Object.freeze({ cleanup: variant });
    const callerReason = Object.freeze({ caller: variant });
    const caller = new AbortController();
    let cleanups = 0;
    let diagnostics = 0;
    const name = 'bridge_' + variant.replaceAll('-', '_');
    shell.register({ name, execute(context) {
      assert.equal(typeof context.invoke, 'function');
      assert.equal(typeof context.registerCleanup, 'function');
      context.registerCleanup(() => { cleanups++; throw cleanupReason; });
      if (variant === 'cleanup-only') return context.invoke('invalid_ere', []);
      return context.invoke('invalid_ere', [], { stderr: { write() {
        diagnostics++;
        if (variant === 'caller-primary') caller.abort(callerReason);
        throw false;
      } } });
    } });
    const expected = variant === 'cleanup-only' ? cleanupReason : variant === 'sink-primary' ? false : callerReason;
    await rejectsIdentity(() => shell.exec("invalid_ere(){ bad='('; [[ a =~ $bad ]]; }; " + name, { signal: caller.signal }), expected);
    assert.equal(cleanups, 1);
    if (variant !== 'cleanup-only') assert.equal(diagnostics, 1);
    observer.assertRetired();
  }
}

export async function eh05({ shell, observer }) {
  for (const variant of ['exact', 'derived', 'thenable']) {
    let invoked;
    let returned;
    let diagnostics = 0;
    let cleanups = 0;
    const name = 'n14_' + variant;
    shell.register({ name, execute(context) {
      assert.equal(typeof context.invoke, 'function');
      assert.equal(typeof context.registerCleanup, 'function');
      context.registerCleanup(() => { cleanups++; });
      invoked = context.invoke('invalid_ere', [], { stderr: { write() { diagnostics++; throw false; } } });
      if (variant === 'exact') returned = invoked;
      else if (variant === 'derived') returned = invoked.then(value => value);
      else returned = { then(resolve, reject) { return invoked.then(resolve, reject); } };
      return returned;
    } });
    const script = "invalid_ere(){ bad='('; [[ a =~ $bad ]]; }; " + name;
    if (variant === 'exact') await rejectsIdentity(() => shell.exec(script), false);
    else {
      const result = await shell.exec(script);
      assert.equal(result.exitCode, 1);
      assert.equal(result.stdout, '');
      assert.equal(result.stderr, 'shell: line 1: false\n');
    }
    assert.equal(returned === invoked, variant === 'exact');
    assert.equal(cleanups, 1);
    assert.equal(diagnostics, 1);
    observer.assertRetired();
  }
}
