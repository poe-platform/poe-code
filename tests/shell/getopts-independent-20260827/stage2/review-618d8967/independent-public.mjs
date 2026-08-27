import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { test, after } from 'node:test';
import { setImmediate as immediate } from 'node:timers/promises';
import { Shell, MemoryFileSystem, CommandRegistry, standardCommands, ShellLimitError } from 'virtual-bash';

const source = process.env.REVIEW_SOURCE;
const original = path.join(source, 'tests/shell/getopts-independent-20260827/stage2');
const { scripts } = await import(pathToFileURL(path.join(original, 'corpus.mjs')));
const overlay = JSON.parse(fs.readFileSync(path.join(process.env.REVIEW_OWN, 'native-corrections-v1.json')));
const observations = [];
after(() => fs.writeFileSync(process.env.REVIEW_OBSERVATIONS, JSON.stringify(observations, null, 2) + '\n', { flag: 'wx' }));
function setup(options = {}) {
  const filesystem = new MemoryFileSystem();
  const commands = new CommandRegistry([{ name: 'say', async execute(context) { await context.stdout.write(Buffer.from(context.args.join(' ') + '\n')); return { exitCode: 0 }; } }]);
  const shell = new Shell({ fs: filesystem, commands, ...options });
  return { shell, filesystem, commands };
}
const row = (label, status, option, index, argument = null) => `${label}|${status}|${option}|${index}|${argument === null ? '' : 'x'}|${argument ?? ''}|1\n`;
const policyOutputs = {
  N04: row('first', 0, 'a', 1) + row('prefix', 0, 'a', 1) + row('restored', 0, 'b', 1) + row('next', 0, 'c', 2),
  N12: row('readonly-index-first', 1, 'UNSET', 1) + row('readonly-index-next', 1, 'UNSET', 1) + row('readonly-index-end', 1, 'UNSET', 1) + row('readonly-name-first', 1, 'old', 1) + row('readonly-name-next', 1, 'old', 2) + row('readonly-name-end', 1, 'old', 2),
  N13: row('readonly-set', 1, 'UNSET', 3, 'old') + row('no-argument', 1, 'UNSET', 4, 'old') + row('eof', 1, 'UNSET', 4, 'old') + row('ordinary-unset', 1, 'UNSET', 4, 'old'),
  N14: ['export-failed', 'after-export', 'read-failed', 'after-read', 'local-failed', 'local-next', 'after-local', 'prefix-failed', 'after-prefix'].map(label => row(label, 1, 'a', 1)).join(''),
};
for (const control of scripts) test(`frozen ${control.id}: installed public Shell with separate product policy`, async () => {
  const { shell, filesystem } = setup({ cwd: '/review-stage2', env: control.env ?? {} });
  shell.use(standardCommands());
  await filesystem.mkdir('/review-stage2/fixtures', { recursive: true });
  for (const name of ['reset-input.data', 'shared-source.data']) await filesystem.writeFile('/review-stage2/fixtures/' + name, new Uint8Array(fs.readFileSync(path.join(original, 'fixtures', name))));
  const correction = overlay.corrections.find(value => value.id === control.id);
  const correctedNative = correction?.correctedSelectedNativeExpectation ?? control.expectation;
  let expected = policyOutputs[control.id] ?? correctedNative.stdout;
  if (control.id === 'N15') expected = expected.replace(row('bare-readonly', 0, 'c', 1), row('bare-readonly', 1, 'b', 1));
  const result = await shell.exec(control.productScript);
  observations.push({ id: control.id, classification: 'candidate product observation, not native rerun', originalSelectedNativeExpectation: control.expectation, correctedSelectedNativeExpectation: correctedNative, productExpectation: { stdout: expected, exitCode: 0 }, actual: result, originalNativeMatch: result.stdout === control.expectation.stdout, correctedNativeStdoutMatch: result.stdout === correctedNative.stdout, intentionalPolicy: Object.hasOwn(policyOutputs, control.id) || control.id === 'N15' });
  try {
    assert.equal(result.stdout, expected);
    assert.equal(result.exitCode, 0);
    const predicate = control.expectation.stderr;
    if (predicate.kind === 'empty') assert.equal(result.stderr, '');
    else if (predicate.kind === 'contains') for (const text of predicate.text) assert(result.stderr.includes(text), text);
    else if (predicate.kind === 'contains-count') assert.equal(result.stderr.split(predicate.text).length - 1, predicate.count);
  } finally { await shell.dispose(); }
});

test('I01/I02 regular routing, fresh exported defaults and no registry plugin growth', async () => {
  const { shell, commands } = setup({ env: { OPTIND: '7', OPTERR: '0' } });
  const before = commands.list().map(command => command.name);
  commands.register({ name: 'host', async execute(context) { assert.equal(context.env.OPTIND, '1'); assert.equal(context.env.OPTERR, '1'); return { exitCode: 0 }; } });
  const result = await shell.exec('host; type -t getopts; getopts a opt -a; say "$opt:$OPTIND"');
  assert.equal(result.stdout, 'builtin\na:2\n');
  assert.equal(commands.has('getopts'), false);
  assert.deepEqual(commands.list().map(command => command.name), [...before, 'host']);
  await shell.dispose();
});

test('I07 per-word admission, maximum-safe saturation and shared command budget', async () => {
  const { shell, commands } = setup();
  assert.equal((await shell.exec('getopts a opt -aaaaaa -aaaaaa -aaaaaa', { limits: { maxExpansionBytes: 7, maxExpansionFields: 8, maxCommands: 1 } })).exitCode, 0);
  assert.equal((await shell.exec('getopts a opt -a', { limits: { maxExpansionBytes: Number.MAX_SAFE_INTEGER, maxExpansionFields: Number.MAX_SAFE_INTEGER, maxCommands: 1 } })).exitCode, 0);
  assert.equal((await shell.exec('getopts a opt -a; command getopts a opt -a', { limits: { maxCommands: 3 } })).exitCode, 1);
  await assert.rejects(shell.exec('getopts a opt -a; command getopts a opt -a', { limits: { maxCommands: 2 } }), error => error instanceof ShellLimitError && error.limit === 'maxCommands');
  commands.register({ name: 'child', execute(context) { return context.invoke('getopts', ['a', 'opt', '-a']); } });
  await assert.rejects(shell.exec(':; child', { limits: { maxCommands: 2 } }), error => error instanceof ShellLimitError && error.limit === 'maxCommands');
  await shell.dispose();
});

test('I07 forwarded byte/field admission rejects actual middleware bypass', async () => {
  for (const kind of ['maxExpansionBytes', 'maxExpansionFields']) {
    const { shell } = setup();
    shell.use(async (context, next) => { Object.assign(context, { args: kind === 'maxExpansionBytes' ? ['a', 'opt', '-'.repeat(40)] : ['a', 'opt', ...Array(20).fill('-a')] }); return next(); });
    await assert.rejects(shell.exec('getopts a opt -a', { limits: { maxExpansionBytes: 16, maxExpansionFields: 8 } }), error => error instanceof ShellLimitError && error.limit === kind);
    await shell.dispose();
  }
});

test('I08 tiny final flush yields a real task and preserves all falsy caller reasons', async () => {
  for (const reason of [{ sentinel: 'abort' }, false, 0, '', null]) {
    const { shell } = setup();
    const controller = new AbortController();
    shell.use(async (context, next) => { if (context.command === 'getopts') setImmediate(() => controller.abort(reason)); return next(); });
    await assert.rejects(shell.exec('getopts a opt -a', { signal: controller.signal }), error => error === reason);
    await shell.dispose();
  }
});

test('I08 long helper work observes caller timer at real checkpoints', { timeout: 3000 }, async () => {
  const { shell } = setup();
  const controller = new AbortController();
  const reason = { checkpoint: true };
  shell.use(async (context, next) => { Object.assign(context, { args: ['a'.repeat(100000), 'opt', '-a'] }); setTimeout(() => controller.abort(reason), 0); return next(); });
  await assert.rejects(shell.exec('getopts a opt -a', { signal: controller.signal }), error => error === reason);
  await shell.dispose();
});

test('I09/I12 rejected diagnostic preserves only earlier scan; EPIPE mapping and silence', async () => {
  const { shell } = setup();
  let writes = 0;
  const result = await shell.exec('OPTARG=old; opt=old; getopts a opt -za; say "$?:$OPTIND:$OPTARG:$opt"; getopts a opt -za; say "$opt:$OPTIND"', { stderr: { async write(bytes) { if (++writes === 1) { assert.equal(Buffer.from(bytes).toString(), 'shell: illegal option -- z\n'); throw false; } } } });
  assert.equal(result.stdout, '1:1:old:old\na:2\n');
  assert.equal(writes, 2);
  assert.equal((await shell.exec('getopts a opt -z', { stderr: { async write() { throw Object.assign(new Error('closed'), { code: 'EPIPE' }); } } })).exitCode, 141);
  for (const script of ['getopts :a opt -z', 'OPTERR=0; getopts a opt -z']) assert.equal((await shell.exec(script, { stderr: { async write() { assert.fail('silent diagnostic write'); } } })).stderr, '');
  await shell.dispose();
});

test('I08/I09 blocked diagnostic awaits backpressure and cooperative cleanup', { timeout: 3000 }, async () => {
  const { shell } = setup();
  const controller = new AbortController();
  const reason = { blocked: true };
  let arrived, releaseWrite, releaseCleanup, cleanupCalls = 0, settled = false;
  const entered = new Promise(resolve => { arrived = resolve; });
  const writeGate = new Promise(resolve => { releaseWrite = resolve; });
  const cleanupGate = new Promise(resolve => { releaseCleanup = resolve; });
  shell.use(async (context, next) => { context.registerCleanup(async () => { cleanupCalls++; await cleanupGate; }); return next(); });
  const execution = shell.exec('getopts a opt -z', { signal: controller.signal, stderr: { write() { arrived(); return writeGate; } } });
  const checked = assert.rejects(execution, error => error === reason).finally(() => { settled = true; });
  await entered;
  await immediate();
  assert.equal(settled, false);
  controller.abort(reason);
  await immediate();
  assert.equal(settled, false);
  assert.equal(cleanupCalls, 1);
  releaseCleanup();
  await checked;
  releaseWrite();
  await immediate();
  await shell.dispose();
});

test('I10 actual literal invoke uses final binding, export promotion and child-only replacement', async () => {
  for (const exported of [false, true]) {
    const { shell, commands } = setup();
    commands.register({ name: 'host', async execute(context) { await context.invoke('runner', [], { replaceEnv: true }); await context.invoke('runner', [], { replaceEnv: true, env: { OPTIND: '1' } }); await assert.rejects(context.invoke('getopts', ['a', 'opt', '-a'], { env: { OPTIND: undefined } }), TypeError); return { exitCode: 0 }; } });
    shell.use(async (context, next) => { context.env = { ...context.env }; return next(); });
    const result = await shell.exec('runner() { say "${OPTIND-absent}"; getopts abc opt -abc; say "$opt"; }; getopts abc opt -abc; ' + (exported ? 'export OPTIND; ' : '') + 'host; getopts abc opt -abc; say "parent:$opt"');
    assert.equal(result.stdout, (exported ? 'absent\na\n' : '1\nb\n') + '1\nb\nparent:b\n');
    await shell.dispose();
  }
});

test('I10 literal metacharacters are not source and direct middleware restoration is conditional', async () => {
  const { shell, commands } = setup();
  commands.register({ name: 'host', execute(context) { return context.invoke('runner', ['-a', '$(say forbidden)'], { replaceEnv: true }); } });
  assert.equal((await shell.exec('runner() { getopts a: opt "$@"; say "$OPTARG"; }; host')).stdout, '$(say forbidden)\n');
  let visits = 0;
  shell.use(async (context, next) => { if (context.command === 'getopts' && ++visits === 2) context.env.OPTIND = '1'; return next(); });
  const result = await shell.exec('getopts ab opt -ab; getopts ab opt -ab; getopts ab opt -ab; say "$opt:$OPTIND"');
  assert.equal(result.stdout, 'b:2\n');
  await shell.dispose();
});

test('I11 builtin never reads sentinel stdin or VFS and writes no stdout', async () => {
  const filesystem = new MemoryFileSystem();
  const calls = [];
  const guarded = new Proxy(filesystem, { get(target, name) { const value = Reflect.get(target, name); return typeof value === 'function' ? (...args) => { calls.push(String(name)); return value.apply(target, args); } : value; } });
  const { shell } = setup({ fs: guarded });
  calls.length = 0;
  const result = await shell.exec('getopts a opt -a', { stdin: { async *[Symbol.asyncIterator]() { assert.fail('stdin read'); } }, stdout: { async write() { assert.fail('stdout write'); } } });
  assert.equal(result.exitCode, 0);
  assert.deepEqual(calls, []);
  await shell.dispose();
});
