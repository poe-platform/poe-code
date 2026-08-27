import assert from 'node:assert/strict';
import { test } from 'node:test';
import { setImmediate as immediate } from 'node:timers/promises';
import { Shell, MemoryFileSystem, CommandRegistry } from 'virtual-bash';

test('I07 existing normal command task-yield occurs at command128', async () => {
  const shell = new Shell({ fs: new MemoryFileSystem() });
  let commands = 0, taskRan = false;
  const observations = [];
  shell.use(async (_context, next) => {
    commands++;
    if (commands === 1) setImmediate(() => { taskRan = true; });
    observations.push({ command: commands, taskRan });
    return next();
  });
  const result = await shell.exec(Array(129).fill(':').join(';'), { limits: { maxCommands: 129 } });
  assert.equal(result.exitCode, 0);
  assert.equal(commands, 129);
  assert.equal(observations.find(row => row.taskRan).command, 128);
  await shell.dispose();
});

test('I08 pre-abort and late-reject observation preserve caller reasons', async () => {
  for (const reason of [{ token: 'pre-abort' }, false, 0, '', null]) {
    const shell = new Shell({ fs: new MemoryFileSystem() });
    const controller = new AbortController();
    controller.abort(reason);
    let calls = 0;
    shell.use(async (_context, next) => { calls++; return next(); });
    await assert.rejects(shell.exec('getopts a opt -a', { signal: controller.signal }), error => error === reason);
    assert.equal(calls, 0);
    await shell.dispose();
  }
  const shell = new Shell({ fs: new MemoryFileSystem() });
  const controller = new AbortController();
  const reason = { token: 'diagnostic-abort' };
  let rejectWrite;
  const pending = new Promise((_resolve, reject) => { rejectWrite = reject; });
  await assert.rejects(shell.exec('getopts a opt -z', { signal: controller.signal, stderr: { write() { controller.abort(reason); return pending; } } }), error => error === reason);
  rejectWrite(new Error('late diagnostic rejection must be observed'));
  await immediate();
  await immediate();
  await shell.dispose();
});

test('I04 actual concurrent pending invokes own independent cursor and parent state', { timeout: 3000 }, async () => {
  const commands = new CommandRegistry([{ name: 'say', async execute(context) { await context.stdout.write(Buffer.from(context.args.join(' ') + '\n')); return { exitCode: 0 }; } }]);
  const shell = new Shell({ fs: new MemoryFileSystem(), commands });
  let bothEntered;
  const entered = new Promise(resolve => { bothEntered = resolve; });
  const release = [];
  const outputs = ['', ''];
  let arrived = 0;
  commands.register({ name: 'host', async execute(context) {
    const pending = [0, 1].map(index => {
      const gate = new Promise(resolve => { release[index] = resolve; });
      let writes = 0;
      return context.invoke('runner', [], { stdout: { async write(bytes) {
        outputs[index] += Buffer.from(bytes).toString();
        if (++writes === 1) { if (++arrived === 2) bothEntered(); await gate; }
      } } });
    });
    await entered;
    assert.deepEqual(outputs, ['b\n', 'b\n']);
    release[1]();
    await pending[1];
    release[0]();
    const results = await Promise.all(pending);
    assert.deepEqual(results.map(result => result.exitCode), [0, 0]);
    return { exitCode: 0 };
  } });
  const result = await shell.exec('runner() { getopts abc opt -abc; say "$opt"; getopts abc opt -abc; say "$opt"; }; getopts abc opt -abc; host; getopts abc opt -abc; say "parent:$opt"');
  assert.deepEqual(outputs, ['b\nc\n', 'b\nc\n']);
  assert.equal(result.stdout, 'parent:b\n');
  assert.equal(result.stderr, '');
  await shell.dispose();
});
