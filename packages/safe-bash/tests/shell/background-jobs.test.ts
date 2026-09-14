import assert from "node:assert/strict";
import { test } from "node:test";
import { setup } from "./helpers.js";

for (const [source, stdout] of [
  ['false & p=$!; say $?; wait "$p"; say $?; wait "$p"; say $?', '0\n1\n1\n'],
  ['x=parent; { x=child; status 7; } & p=$!; wait "$p"; say "$?:$x"', '7:parent\n'],
  ['false && say wrong & wait; say $?', '0\n'],
  ['false & p=$!; (wait "$p" 2>/dev/null; say $?); wait "$p"; say $?', '127\n1\n'],
  ['f() { local x=ok; { local y=yes; say "$x:$y"; return 9; } & p=$!; wait "$p"; say $?; }; f', 'ok:yes\n9\n'],
  ['read x & wait; say "${x-unset}"; read y; say "$y"', 'unset\ninput\n'],
  ['read x <<< yes & wait; say "${x-unset}"', 'unset\n'],
  ['false & p=$!; wait; wait "$p" 2>/dev/null; say $?', '127\n'],
  ['false & wait %1; say $?', '1\n'],
] as const) test(`background Bash behavior: ${source}`, async () => {
  const { shell } = setup();
  const result = await shell.exec(source, { stdin: 'input\n' });
  assert.equal(result.stdout, stdout);
  assert.equal(result.stderr, '');
  assert.equal(result.exitCode, 0);
});

test('waiting for a child does not wait for its descendants', async () => {
  const { shell, commands } = setup();
  let release!: () => void;
  const held = new Promise<void>(resolve => { release = resolve; });
  commands.register({ name: 'hold', async execute() { await held; return { exitCode: 0 }; } });
  commands.register({ name: 'release', execute() { release(); return { exitCode: 0 }; } });
  const result = await shell.exec('{ hold & exit 7; } & p=$!; wait "$p"; say $?; release');
  assert.equal(result.stdout, '7\n');
  assert.equal(result.exitCode, 0);
});

for (const source of ['(delayed &) | pass', '{ delayed & } | pass', 'x=$(delayed &); say "$x"', '{ delayed & } > /out; wait; pass < /out']) test(`background retains output: ${source}`, async () => {
  const { shell, commands } = setup();
  commands.register({ name: 'delayed', async execute({ stdout }) {
    await new Promise<void>(resolve => setImmediate(resolve));
    await stdout.write(new TextEncoder().encode('child\n'));
    return { exitCode: 0 };
  } });
  const result = await shell.exec(source);
  assert.equal(result.stdout, 'child\n');
  assert.equal(result.stderr, '');
});

test('redirected descendants do not hold command substitution output open', async () => {
  const { shell, commands } = setup();
  let release!: () => void;
  const held = new Promise<void>(resolve => { release = resolve; });
  commands.register({ name: 'hold', async execute() { await held; return { exitCode: 0 }; } });
  commands.register({ name: 'release', execute() { release(); return { exitCode: 0 }; } });
  const abort = new AbortController();
  const timer = setTimeout(() => abort.abort(new Error('descendant retained redirected capture')), 100);
  try {
    const result = await shell.exec('x=$(hold >/out &); release; say done', { signal: abort.signal });
    assert.equal(result.stdout, 'done\n');
  } finally { clearTimeout(timer); release(); }
});

for (const source of ['bash -c "true & wait"', 'sh -c "true & wait"', 'bash -c "wait"']) test(`fresh shell owns background table: ${source}`, async () => {
  const result = await setup().shell.exec(source);
  assert.equal(result.exitCode, 0);
  assert.equal(result.stderr, '');
});
for (const argument of ['nope', '0x1', '1e0', '']) test(`wait rejects nondecimal PID ${argument}`, async () => {
  const result = await setup().shell.exec(`false & wait '${argument}'; say $?`);
  assert.equal(result.stdout, '1\n');
  assert.match(result.stderr, /wait:/u);
});
test('async launch preserves PIPESTATUS and exposes success status', async () => {
  const result = await setup().shell.exec('false | true; false & say "$?" "${PIPESTATUS[*]}"; wait');
  assert.equal(result.stdout, '0 1 0\n');
});

test('modern wait -p assigns an explicit PID without -n', async () => {
  const result = await setup().shell.exec('status 6 & p=$!; wait -p got "$p"; say "$?:$got:$p"');
  assert.equal(result.stdout, '6:1:1\n');
});
test('modern wait -n excludes a child consumed by ordinary wait', async () => {
  const result = await setup().shell.exec('status 6 & p=$!; wait "$p"; wait -np got "$p"; say "$?:${got-unset}"; wait "$p"; say $?');
  assert.equal(result.stdout, '127:unset\n6\n');
});

for (const option of ['-n nope', '-n 999']) test(`modern invalid wait ${option}`, async () => {
  const result = await setup().shell.exec(`wait ${option}; say $?`);
  assert.equal(result.stdout, '127\n');
});

test('wait -p supports indexed targets and leaves them intact without a result', async () => {
  const result = await setup().shell.exec('a=(old second); wait -np "a[1]"; say "$?:${a[*]}"; status 7 & p=$!; wait -p "a[1]" "$p"; say "$?:${a[*]}"');
  assert.equal(result.stdout, '127:old second\n7:old 1\n');
  assert.equal(result.stderr, '');
});

test('background inherits explicitly redirected input after function return', async () => {
  const { shell, commands, fs } = setup();
  await fs.writeFile('/in', new TextEncoder().encode('input\n'));
  commands.register({ name: 'delayedpass', async execute({ stdin, stdout }) {
    await new Promise<void>(resolve => setImmediate(resolve));
    for await (const chunk of stdin) await stdout.write(chunk);
    return { exitCode: 0 };
  } });
  const result = await shell.exec('f() { { delayedpass <&3 & } 3</in; }; f; wait');
  assert.equal(result.stdout, 'input\n');
  assert.equal(result.stderr, '');
});

test('function display preserves asynchronous list syntax', async () => {
  const { shell } = setup();
  const displayed = await shell.exec('f() { false & wait; }; type f');
  assert.match(displayed.stdout, /false &/u);
  const definition = displayed.stdout.slice(displayed.stdout.indexOf('f ()'));
  const result = await setup().shell.exec(`${definition}\nf`);
  assert.equal(result.exitCode, 0);
  assert.equal(result.stderr, '');
});

test('braced last-background PID expansion follows special parameter rules', async () => {
  const result = await setup().shell.exec('say "${!:-none}"; true & say "${!}" "${#!}"; wait');
  assert.equal(result.stdout, 'none\n1 1\n');
});
test('automatic API settlement retains caller stdin for an explicit background redirect', async () => {
  const { shell, commands } = setup();
  commands.register({ name: 'delayed', async execute() { await new Promise<void>(resolve => setImmediate(resolve)); return { exitCode: 0 }; } });
  const result = await shell.exec('{ delayed; read x; say "$x"; } <&0 &', { stdin: 'input\n' });
  assert.equal(result.stdout, 'input\n');
  assert.equal(result.stderr, '');
});

test('job numbers can be reused after all children have been waited for', async () => {
  const result = await setup().shell.exec('true & wait; status 7 & wait %1; say $?');
  assert.equal(result.stdout, '7\n');
});
