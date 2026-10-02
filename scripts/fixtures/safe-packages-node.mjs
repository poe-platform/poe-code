import assert from "node:assert/strict";
import { Shell, MemoryFileSystem, FsError, createCommandArguments, getCommandArguments, standardCommands } from "@poe-platform/safe-bash";
import { nodeCommands, createNodeCommand, NODE_PROFILE } from "@poe-platform/safe-bash/commands/node";
import { createNodeWorkerProvider } from "@poe-platform/safe-bash/commands/node/host";

export async function verifyNodeCommand() {
  const fs = new MemoryFileSystem();
  await fs.writeFile('/main.js', new TextEncoder().encode('console.log(process.argv[2]);'));
  const shell = new Shell({ fs }).use(standardCommands()).use(nodeCommands());
  try {
    assert.equal((await shell.exec('node /main.js hello | cat')).stdout, 'hello\n');
    assert.equal((await shell.exec(`printf 'console.log(42)' | node`)).stdout, '42\n');
    assert.throws(() => nodeCommands().setup({ commands: shell.commands }), /already registered/);
    const missing = await shell.exec(`node -e 'require("node:fs").readFileSync("/missing", "utf8")'`);
    assert.equal(missing.exitCode, 1);
    assert.match(missing.stderr, /ENOENT/);
  } finally { await shell.dispose(); }

  const { FsError: contractError } = await import('@poe-platform/safe-bash/contracts/errors');
  assert.equal(FsError, contractError);
  let retired = 0;
  let expectedArgv = ["é"];
  const provider = { profile: NODE_PROFILE, identity: 'packed-provider', prepare(request) {
    assert.deepEqual(request.argv.slice(-expectedArgv.length), expectedArgv);
    return { async start() { return { kind: 'entryReturned', observation: { state: 'unknown', fault: false, name: null, message: null, code: null } }; },
      cancel() {}, async retire() { retired++; return { acquisition: 'exited', exitCode: 0 }; } };
  } };
  const carrier = createCommandArguments(['-e', '', 'é']);
  const context = { command: 'node', args: carrier.args, argumentValues: carrier, cwd: '/', env: {}, fs,
    signal: new AbortController().signal, stdin: { async *[Symbol.asyncIterator]() {} },
    stdout: { async write() {} }, stderr: { async write() {} } };
  assert.equal(getCommandArguments(context), carrier);
  assert.equal((await createNodeCommand({ provider }).execute(context)).exitCode, 0);
  assert.equal(retired, 1);

  expectedArgv = ['�', '�'];
  const bytesShell = new Shell({ fs }).use(async (context, next) => {
    const arguments_ = getCommandArguments(context);
    assert.deepEqual([...arguments_.bytes(2)], [255]);
    assert.deepEqual([...arguments_.bytes(3)], [254]);
    return next();
  }).use(nodeCommands({ provider }));
  try {
    const result = await bytesShell.exec("node -e '' $'\\xff' $'\\xfe'");
    assert.equal(result.exitCode, 0, result.stderr);
  } finally { await bytesShell.dispose(); }
  assert.equal(retired, 2);

  const controller = new AbortController();
  const reason = new Error('packed cancellation');
  const cancelShell = new Shell({ fs }).use(nodeCommands({ provider: {
    profile: NODE_PROFILE, identity: 'packed-cancellation', prepare(_request, services) {
      return { async start() {
        controller.abort(reason);
        assert.equal(services.signal.reason, reason);
        return { kind: 'entryReturned', observation: { state: 'unknown', fault: false, name: null, message: null, code: null } };
      }, cancel() {}, async retire() { retired++; return { acquisition: 'exited', exitCode: 0 }; } };
    },
  } }));
  try {
    await assert.rejects(cancelShell.exec('node -e 1', { signal: controller.signal }), error => error === reason);
    assert.equal(retired, 3);
  } finally { await cancelShell.dispose(); }

  const events = [];
  const worker = createNodeWorkerProvider({ entry: new URL('./safe-packages-node-adapter.mjs', import.meta.url).href,
    identity: 'packed-node-adapter', observe(event) { events.push(event.kind); } });
  const workerShell = new Shell({ fs }).use(nodeCommands({ provider: worker, grants: { stdoutWrite: true } }));
  try {
    const result = await workerShell.exec('node -e "1"');
    assert.equal(result.exitCode, 0, result.stderr);
    assert.equal(result.stdout, 'worker\n');
    assert.ok(events.includes('retired'));
  } finally { await workerShell.dispose(); }
}

await verifyNodeCommand();
