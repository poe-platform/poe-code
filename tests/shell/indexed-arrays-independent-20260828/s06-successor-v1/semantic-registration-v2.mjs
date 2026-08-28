import assert from 'node:assert/strict';

export const quote = value => `'${value.replaceAll("'", "'\\''")}'`;
const assignment = (name, members) => `${name}=(${members.map(([index, text]) => `[${index}]=${quote(text)}`).join(' ')})`;
async function closeOwned(shell, probe) {
  const failures = [];
  try { await shell.dispose(); } catch (error) { failures.push(String(error)); }
  try { await probe?.close(); } catch (error) { failures.push(String(error)); }
  if (failures.length) throw Object.assign(new Error(`owned cleanup failed: ${failures.join('; ')}`), { unsafe: true });
}
export function compileVector(row) {
  const setup = [assignment('a', row.a)];
  if (row.b) setup.push(assignment('b', row.b));
  if (Object.hasOwn(row, 'ifs')) setup.push(row.ifs === null ? 'unset IFS' : `IFS=${quote(row.ifs)}`);
  if (row.positional) setup.push(`set -- ${row.positional.map(quote).join(' ')}`);
  if (row.readonly) setup.push('readonly a');
  const operation = row.assignment ?? `__array_value ${row.word ?? `"${row.expression}"`}`;
  const status = `__array_status "$?"`;
  const after = row.after ? `__array_after "\${#a[@]}" ${row.after.map(([index]) => `"\${a[${index}]}"`).join(' ')}` : '';
  const side = Object.hasOwn(row, 'side') ? '__array_side "${side-unset}"' : '';
  return [...setup, operation, status, after, side].filter(Boolean).join('; ');
}
export async function semanticCase(api, row, auxiliary) {
  const fs = new api.MemoryFileSystem();
  const shell = new api.Shell({ fs, env: { LC_ALL: 'C.UTF-8', TZ: 'UTC' } });
  const calls = { value: [], status: [], after: [], side: [] };
  for (const key of Object.keys(calls)) shell.register({ name: `__array_${key}`, execute(context) { calls[key].push([...context.args]); return { exitCode: 0 }; } });
  let result; let probe;
  try {
    if (row.id === 'O11') {
      assert.ok(auxiliary?.observeTerminalState, 'O11 requires bound actual terminal-state observer, not a fake after-state');
      probe = await auxiliary.observeTerminalState(shell, row);
    }
    result = await shell.exec(compileVector(row));
    assert.equal(result.stdout, '');
    assert.deepEqual([...result.stdoutBytes], []);
    if (!row.failure) {
      assert.equal(result.exitCode, 0); assert.equal(result.stderr, '');
      assert.deepEqual(calls.value, [row.expectedArgv ?? [row.value]]);
      assert.deepEqual(calls.status, [['0']]);
    } else if (row.id === 'O14') {
      assert.equal(result.exitCode, 2); assert.ok(result.stderr.length > 0);
      assert.deepEqual(calls, { value: [], status: [], after: [], side: [] });
    } else if (row.id === 'O11') {
      assert.equal(result.exitCode, 127); assert.match(result.stderr, /a: missing/u);
      assert.deepEqual(calls.value, []); assert.deepEqual(calls.status, []);
      assert.deepEqual(await probe.after(), row.after);
    } else {
      assert.equal(result.exitCode, 0); assert.ok(result.stderr.length > 0);
      assert.deepEqual(calls.value, []); assert.deepEqual(calls.status, [['1']]);
      if (row.id === 'O09') assert.match(result.stderr, /readonly/u);
    }
    if (row.after && row.id !== 'O11') assert.deepEqual(calls.after, [[String(row.after.length), ...row.after.map(([, value]) => value)]]);
    if (Object.hasOwn(row, 'side')) assert.deepEqual(calls.side, [[row.side]]);
    return { calls, exitCode: result.exitCode, stderr: result.stderr, parentLimits: 'unchanged configured defaults', phase: 'argv capture is post-transfer E; no private allocation claim' };
  } finally { await closeOwned(shell, probe); }
}
export async function literalCase(api, row) {
  assert.equal(row.status, undefined, 'held question is not an executable case');
  const shell = new api.Shell({ fs: new api.MemoryFileSystem(), env: { LC_ALL: 'C.UTF-8', TZ: 'UTC' } });
  try {
    const definitions = api.createAgentCommands();
    assert.equal(definitions.length, 77, "exact admitted registry");
    const matches = definitions.filter(definition => definition.name === "printf");
    assert.equal(matches.length, 1, "exactly one actual printf definition");
    shell.register(matches[0]);
    const result = await shell.exec(row.script);
    assert.equal(result.exitCode, row.exitCode); assert.equal(result.stdout, row.stdout);
    assert.deepEqual([...result.stdoutBytes], [...new TextEncoder().encode(row.stdout)]);
    if (row.stderr === 'empty') assert.equal(result.stderr, ''); else assert.ok(result.stderr.length > 0);
    return { exitCode: result.exitCode, stdout: result.stdout, stderr: result.stderr };
  } finally { await closeOwned(shell); }
}
export async function preabort(api) {
  const outcomes = [];
  for (const reason of [false, 0, undefined, { label: 'caller' }]) {
    const shell = new api.Shell({ fs: new api.MemoryFileSystem() });
    const controller = new AbortController(); controller.abort(reason);
    let invocations = 0;
    shell.register({ name: '__never', execute() { invocations++; return { exitCode: 0 }; } });
    try {
      const outcome = await shell.exec('a=([0]=x); __never', { signal: controller.signal }).then(value => ({ value }), error => ({ error }));
      assert.ok(Object.hasOwn(outcome, 'error')); assert.ok(Object.is(outcome.error, controller.signal.reason)); assert.equal(invocations, 0);
      outcomes.push({ identity: true, invocations });
    } finally { await closeOwned(shell); }
  }
  return outcomes;
}
export async function rhsAbort(api) {
  const fs = new api.MemoryFileSystem(); const shell = new api.Shell({ fs });
  const controller = new AbortController(); const reason = { label: 'rhs-abort' };
  let release; const gate = new Promise(resolve => { release = resolve; });
  let started; const closing = new Promise(resolve => { started = resolve; });
  const events = []; let settled = false; let execution;
  shell.register({ name: '__stop', async execute(context) {
    events.push('rhs');
    context.registerCleanup(async () => { events.push('cleanup-start'); started(); await gate; events.push('cleanup-end'); });
    await context.fs.writeFile('/receipt', new TextEncoder().encode('retained'));
    controller.abort(reason); return { exitCode: 0 };
  } });
  try {
    execution = shell.exec('a=([0]=old); a=([1]="$(__stop)")', { signal: controller.signal }).then(value => ({ value }), error => ({ error }));
    execution.then(() => { settled = true; });
    await closing; assert.equal(settled, false); release();
    const result = await execution;
    assert.ok(Object.hasOwn(result, 'error')); assert.ok(Object.is(result.error, reason));
    assert.deepEqual(events, ['rhs', 'cleanup-start', 'cleanup-end']);
    assert.equal(new TextDecoder().decode(await fs.readFile('/receipt')), 'retained');
    return { events, identity: true, receipt: 'retained', privateDrainProof: 'separate instrumented candidate obligation' };
  } finally { release(); if (execution) await execution; await closeOwned(shell); }
}
export async function overlayCases(api, typed) {
  const variants = typed ? [
    { initial: 'a=([7]=tail)', body: ':', expected: ['1', '', 'tail'] },
    { initial: 'a=([7]=tail)', body: 'a=B', expected: ['1', 'B', ''] },
    { initial: 'a=A', body: 'unset a; a=([7]=new); unset a; a=B', expected: ['1', 'B', ''] }
  ] : [false, true].flatMap(unrelated => [
    { body: 'a=B', expected: ['A'] }, { body: 'a=C', expected: ['C'] },
    { body: 'a=C; a=B', expected: ['A'] }, { body: 'unset a; a=B', expected: ['A'] }
  ].map(row => ({ ...row, initial: `${unrelated ? 'other=([7]=unrelated); ' : ''}a=A` })));
  const receipts = [];
  for (const row of variants) {
    const shell = new api.Shell({ fs: new api.MemoryFileSystem() }); const calls = []; let overlays = 0;
    shell.use(async (context, next) => {
      if (context.command === '__overlay') { context.env.a = 'B'; overlays++; }
      return next();
    });
    shell.register({ name: '__capture', execute(context) { calls.push([...context.args]); return { exitCode: 0 }; } });
    try {
      const script = `${row.initial}; __overlay() { ${row.body}; }; __overlay; __capture ${typed ? '"${#a[@]}" "$a" "${a[7]}"' : '"$a"'}`;
      const result = await shell.exec(script);
      assert.equal(result.exitCode, 0); assert.equal(result.stdout, ''); assert.equal(result.stderr, '');
      assert.equal(overlays, 1); assert.deepEqual(calls, [row.expected]); receipts.push({ script, calls, overlays });
    } finally { await closeOwned(shell); }
  }
  return receipts;
}
