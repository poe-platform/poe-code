import assert from 'node:assert/strict';
import { Shell, agentCommands, createMemoryFileSystem, createStructuredCommands, structuredCommands, defaultJqLimits } from '@poe-platform/safe-bash';
import { createJqCommand, createJqCommands, jqCommands } from '@poe-platform/safe-bash/commands/jq';
import { FsError, createCommandArguments, getCommandArguments, commandRuntimeIdentity } from '@poe-platform/safe-bash/contracts';
import { shellValueFromBytes } from '@poe-platform/safe-bash/contracts/value';
import { FsError as directError } from '@poe-platform/safe-bash/contracts/errors';
import { registerYieldCheckpoint } from '@poe-platform/safe-bash/contracts/yield';

assert.equal(FsError, directError);
assert.ok(defaultJqLimits.maxSteps > 0);
assert.deepEqual(createJqCommands().map(c => c.name), ['jq']);
assert.deepEqual(createStructuredCommands().map(c => c.name), ['jq']);

const fs = createMemoryFileSystem();
await fs.writeFile('/input.json', new TextEncoder().encode('{"items":[1,2]}'));
await fs.writeFile('/filter.jq', new TextEncoder().encode('.items[]'));
await fs.writeFile('/script.sh', new TextEncoder().encode('jq -c -f /filter.jq /input.json | jq -sc add'));
const shell = new Shell({ fs }).use(agentCommands());
const definition = createJqCommand();
let paired = false;
shell.use({ name: 'jq-boundary-witness', setup(host) {
  host.commands.register({ ...definition, runtimeIdentity: commandRuntimeIdentity, async execute(context) {
    if (context.args[0] === "-nr" && context.args[1] === "--arg" && context.argumentValues !== undefined) {
      paired = getCommandArguments(context) === context.argumentValues;
      assert.deepEqual(context.argumentValues.bytes(3), Uint8Array.of(255));
    }
    return definition.execute(context);
  } }, { replace: true });
  host.commands.register({ name: 'raw-byte', async execute(context) { await context.stdout.write(Uint8Array.of(255)); return { exitCode: 0 }; } });
} });
try {
  const script = await shell.exec('sh /script.sh');
  assert.equal(script.exitCode, 0, script.stderr);
  assert.equal(script.stdout, '3\n');
  const raw = await shell.exec("jq -nr --arg v \"$(raw-byte)\" '$v'");
  assert.equal(raw.stdout, '\ufffd\n');
  assert.ok(paired);
  const exact = await shell.exec("jq -nc --argjson n 9007199254740993123456789 '$n'");
  assert.equal(exact.stdout, '9007199254740993123456789\n');
  const missing = await shell.exec('jq . /missing');
  assert.equal(missing.exitCode, 2);
  assert.ok(missing.stderr.includes('ENOENT'));
  const collision = new Shell({ fs }).use(agentCommands()).use(jqCommands());
  try { await assert.rejects(collision.exec(':'), /already registered/i); }
  finally { await collision.dispose(); }
  shell.use(structuredCommands({ replace: true, limits: { maxOutputBytes: 2 } }));
  const bounded = await shell.exec('jq -nc "[1,2]"');
  assert.equal(bounded.exitCode, 5);
  assert.ok(bounded.stderr.includes('maxOutputBytes'));
} finally { await shell.dispose(); }

// Preserve owned byte values and the canonical argument carrier at the command boundary.
const value = shellValueFromBytes(Uint8Array.of(255));
const carrier = createCommandArguments(['-nr', '$v | reduce range(2048) as $x (.; .)', '--arg', 'v', value]);
let output = '';
const signal = new AbortController().signal;
let checkpoints = 0;
registerYieldCheckpoint(signal, () => { checkpoints++; });
const direct = await createJqCommand().execute({ command: 'jq', args: carrier.args, argumentValues: carrier,
  stdin: (async function* () {})(), fs, cwd: '/', env: {}, signal,
  stdout: { async write(chunk) { output += new TextDecoder().decode(chunk); } },
  stderr: { async write() { assert.fail('unexpected diagnostic'); } },
});
assert.equal(direct.exitCode, 0);
assert.equal(output, '\ufffd\n'); // existing decoded jq string policy
assert.deepEqual(carrier.bytes(4), Uint8Array.of(255));
assert.ok(checkpoints > 0);
const cancelled = new AbortController();
const reason = new Error('packed jq cancellation');
cancelled.abort(reason);
await assert.rejects(createJqCommand().execute({ command: 'jq', args: [], stdin: (async function* () {})(), fs, cwd: '/', env: {}, signal: cancelled.signal,
  stdout: { async write() { assert.fail('cancelled output'); } }, stderr: { async write() { assert.fail('cancelled diagnostic'); } },
}), error => error === reason);
const active = new AbortController();
const activeReason = new Error('active packed jq cancellation');
registerYieldCheckpoint(active.signal, () => { active.abort(activeReason); });
await assert.rejects(createJqCommand().execute({ command: 'jq', args: ['-n', 'reduce range(2048) as $x (0; .+1)'],
  stdin: (async function* () {})(), fs, cwd: '/', env: {}, signal: active.signal,
  stdout: { async write() { assert.fail('cancelled output'); } },
  stderr: { async write() { assert.fail('cancelled diagnostic'); } },
}), error => error === activeReason);
console.log('Installed jq: public imports, VFS script/pipes, registration, limits, decimal tokens, byte carriers and cancellation passed');
