import assert from 'node:assert/strict';
import { Shell, MemoryFileSystem, standardCommands, FsError } from '@poe-platform/safe-bash';
import { nodeCommands, createNodeCommand } from '@poe-platform/safe-bash/commands/node';

const calls = [];
let retainedWrite;
const runtime = {
  createBudget: options => options,
  makeFsModule: ({ adapter }) => ({ readFile: path => adapter.readFile(path) }),
  declareHostOperation: operation => operation,
  async run(source, options) {
    calls.push(options);
    retainedWrite = options.modules.stdio.write;
    if (source.includes('missing-file')) {
      try { await options.modules.fs.readFile('/missing'); }
      catch (error) { assert.ok(error instanceof FsError); throw error; }
    }
    const bytes = await options.modules.stdio.readBytes();
    if (bytes) await options.modules.stdio.writeBytes(bytes);
    else await options.modules.stdio.write('bridge\n');
    return { ok: true };
  },
};
const fs = new MemoryFileSystem();
await fs.writeFile('/guest.js', new TextEncoder().encode('guest'));
await fs.writeFile('/run.sh', new TextEncoder().encode('node /guest.js argument | cat'));
const shell = new Shell({ fs }).use(standardCommands()).use(nodeCommands({ runtime }));
try {
  const result = await shell.exec('sh /run.sh');
  assert.equal(result.exitCode, 0, result.stderr);
  assert.equal(result.stdout, 'bridge\n');
  assert.deepEqual(calls.at(-1).modules.command.args, ['argument']);
  assert.equal(calls.at(-1).signal.aborted, true);
  await assert.rejects(retainedWrite('late'));
  const bytes = await shell.exec("printf '\\377\\000\\376' | node /guest.js | cat");
  assert.deepEqual(Array.from(bytes.stdoutBytes), [255, 0, 254]);
  assert.equal((await shell.exec('node -e missing-file')).exitCode, 1);
  assert.throws(() => nodeCommands({ runtime }).setup({ commands: shell.commands }), /already registered/);
  shell.use(nodeCommands({ runtime, replace: true, limits: { maxSourceBytes: 1 } }));
  assert.equal((await shell.exec('node /guest.js')).exitCode, 124);
} finally { await shell.dispose(); }

let entered;
const started = new Promise(resolve => { entered = resolve; });
const cancel = new AbortController();
const reason = new Error('packed bridge cancellation');
const cancellation = new Shell({ fs }).use(nodeCommands({ runtime: {
  ...runtime,
  async run(_source, options) {
    entered();
    await new Promise((_, reject) => options.signal.addEventListener('abort', () => reject(options.signal.reason), { once: true }));
    return { ok: true };
  },
} }));
try {
  const pending = cancellation.exec('node /guest.js', { signal: cancel.signal });
  await started;
  cancel.abort(reason);
  await assert.rejects(pending, error => error === reason);
} finally { await cancellation.dispose(); }
assert.equal(createNodeCommand({ runtime }).name, 'node');
