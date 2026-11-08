import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { test } from 'node:test';
import http from 'node:http';
import { networkInterfaces } from 'node:os';

const consumerRoot = process.env.SAFE_BASH_PUBLIC_CONSUMER_ROOT;
const image = process.env.SAFE_BASH_DOCKER_IMAGE;
const socketPath = process.env.SAFE_BASH_DOCKER_SOCKET;
if (!consumerRoot || !image || !socketPath) throw new Error('Configure the installed consumer, immutable Docker image ID, and explicit Docker socket');
async function publicImport(name, subpath) {
  const directory = resolve(consumerRoot, 'node_modules', '@poe-platform', name);
  const manifest = JSON.parse(readFileSync(resolve(directory, 'package.json'), 'utf8'));
  return import(pathToFileURL(resolve(directory, manifest.exports[subpath].import)).href);
}
const { Shell } = await publicImport('safe-bash', '.');
const { pythonCommands } = await publicImport('safe-bash', './commands/python');
const { createDockerPythonExecutorPool } = await publicImport('safe-bash', './commands/python/docker');
const { MemoryFileSystem } = await publicImport('safe-fs', './core');
const configuration = { socketPath, image, memoryBytes: 268435456, cpus: 1, deadlineMs: 15000, maxConcurrentExecutors: 2 };
const command = source => "python -c '" + source.split("'").join("'\\''") + "'";

test('public Docker executor runs real native Python with canonical binary files and temporary cleanup', { timeout: 45000 }, async context => {
  const pool = await createDockerPythonExecutorPool(configuration);
  const fs = new MemoryFileSystem();
  const shell = new Shell({ fs }).use(pythonCommands({ createExecutor: pool.createExecutor }));
  try {
    const result = await shell.exec(command(`import tempfile, pathlib, zlib, sys
with tempfile.TemporaryDirectory(dir="/") as directory:
    path = pathlib.Path(directory, "binary")
    path.write_bytes(bytes([0, 255, 42]))
    assert zlib.decompress(zlib.compress(path.read_bytes())) == bytes([0, 255, 42])
pathlib.Path("/output").write_bytes(bytes([0, 255, 42]))
print(sys.version_info[:3], flush=True)`));
    assert.equal(result.exitCode, 0, result.stderr);
    assert.deepEqual(await fs.readFile('/output'), new Uint8Array([0, 255, 42]));
    assert.deepEqual(await fs.readdir('/'), [{ name: 'output', type: 'file' }]);
    assert.equal(pool.inspect().active, 0);
    context.diagnostic(JSON.stringify({ python: result.stdout.trim(), canonicalBinary: true, temporaryCleanup: true, retired: true }));
  } finally { await shell.dispose(); await pool.dispose(); }
});

test('reflected native networking cannot reach a listener on the Docker host', { timeout: 45000 }, async () => {
  const address = Object.values(networkInterfaces()).flat().find(entry => entry && entry.family === 'IPv4' && !entry.internal)?.address;
  assert.ok(address, 'A non-loopback local host address is required for the network-denial probe');
  let connections = 0;
  const server = http.createServer((_request, response) => { response.end('ungranted host endpoint'); });
  server.on('connection', () => { connections++; });
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '0.0.0.0', resolve); });
  const pool = await createDockerPythonExecutorPool(configuration);
  const shell = new Shell({ fs: new MemoryFileSystem() }).use(pythonCommands({ createExecutor: pool.createExecutor }));
  try {
    const probe = `const net = require('node:net');
const socket = net.connect({host: ${JSON.stringify(address)}, port: ${server.address().port}});
socket.once('connect', () => process.exit(3));
socket.once('error', () => process.exit(0));
setTimeout(() => process.exit(4), 2000);`;
    const reflected = `const child = process.getBuiltinModule('node:child_process');
return child.spawnSync(process.execPath, ['-e', ${JSON.stringify(probe)}], {timeout: 3000}).status;`;
    const result = await shell.exec(command(`import pyodide_js
probe = pyodide_js._module.FS.readFile.constructor(${JSON.stringify(reflected)})
print(probe(), flush=True)`));
    assert.equal(result.exitCode, 0, result.stderr);
    assert.equal(result.stdout.trim(), '0');
    assert.equal(connections, 0);
  } finally {
    await shell.dispose(); await pool.dispose();
    await new Promise(resolve => server.close(resolve));
  }
});

test('shared admission and CPU cancellation preserve a blocked sibling interpreter', { timeout: 45000 }, async () => {
  const pool = await createDockerPythonExecutorPool(configuration);
  const controller = new AbortController();
  let ready;
  const initialized = new Promise(resolve => { ready = resolve; });
  const first = new Shell({ fs: new MemoryFileSystem() }).use(pythonCommands({ createExecutor: pool.createExecutor,
    onProgress(event) { if (event.phase === 'ready') ready(); } }));
  const sibling = new Shell({ fs: new MemoryFileSystem() }).use(pythonCommands({ createExecutor: pool.createExecutor }));
  const saturated = new Shell({ fs: new MemoryFileSystem() }).use(pythonCommands({ createExecutor: pool.createExecutor }));
  let reading;
  const blocked = new Promise(resolve => { reading = resolve; });
  let supply;
  const input = { [Symbol.asyncIterator]() { return {
    next() { reading(); return new Promise(resolve => { supply = resolve; }); },
    async return() { return { done: true }; },
  }; } };
  const reason = new Error('cancel only the CPU loop');
  const running = assert.rejects(first.exec(command('while True: pass'), { signal: controller.signal }), error => error === reason);
  const other = sibling.exec(command('import sys\nprint(sys.stdin.buffer.read(1)[0], flush=True)'), { stdin: input });
  try {
    await Promise.all([initialized, blocked]);
    const refused = await saturated.exec('python3 -c pass');
    assert.equal(refused.exitCode, 1);
    assert.match(refused.stderr, /capacity/);
    assert.equal(pool.inspect().active, 2);
    controller.abort(reason);
    await running;
    await first.dispose();
    assert.equal(pool.inspect().active, 1);
    assert.equal(pool.inspect().closed, false);
    supply({ done: false, value: new Uint8Array([42]) });
    const result = await other;
    assert.equal(result.exitCode, 0, result.stderr);
    assert.equal(result.stdout, '42\n');
    assert.equal(pool.inspect().active, 0);
    const recovered = await saturated.exec(command('print("recovered", flush=True)'));
    assert.equal(recovered.exitCode, 0, recovered.stderr);
  } finally {
    controller.abort(reason);
    supply?.({ done: true });
    await Promise.allSettled([running, other]);
    await first.dispose(); await sibling.dispose(); await saturated.dispose(); await pool.dispose();
  }
});

test('cancellation retires real Python blocked on opaque input without admitting a late write', { timeout: 45000 }, async () => {
  const pool = await createDockerPythonExecutorPool(configuration);
  const fs = new MemoryFileSystem();
  const shell = new Shell({ fs }).use(pythonCommands({ createExecutor: pool.createExecutor }));
  const controller = new AbortController();
  let entered;
  const blocked = new Promise(resolve => { entered = resolve; });
  let supply;
  const input = { [Symbol.asyncIterator]() { return {
    next() { entered(); return new Promise(resolve => { supply = resolve; }); },
    return() { return new Promise(() => {}); },
  }; } };
  const reason = new Error('cancel blocked input');
  const running = assert.rejects(shell.exec(command('import sys, pathlib\npathlib.Path("/late").write_bytes(sys.stdin.buffer.read(1))'),
    { stdin: input, signal: controller.signal }), error => error === reason);
  try {
    await blocked;
    controller.abort(reason);
    await running;
    assert.equal(pool.inspect().active, 0);
    supply({ done: false, value: new Uint8Array([99]) });
    await new Promise(resolve => setImmediate(resolve));
    assert.deepEqual(await fs.readdir('/'), []);
    const result = await shell.exec(command('print("recovered", flush=True)'));
    assert.equal(result.exitCode, 0, result.stderr);
  } finally { controller.abort(reason); await running; await shell.dispose(); await pool.dispose(); }
});

test('JavaScript reflection stays inside the non-root read-only container without ambient host access', { timeout: 45000 }, async () => {
  const previous = process.env.POE_PYTHON_HOST_CANARY;
  process.env.POE_PYTHON_HOST_CANARY = 'not-granted-to-the-container';
  const pool = await createDockerPythonExecutorPool(configuration);
  const shell = new Shell({ fs: new MemoryFileSystem() }).use(pythonCommands({ createExecutor: pool.createExecutor }));
  try {
    const result = await shell.exec(command(`import pyodide_js, json
probe = pyodide_js._module.FS.readFile.constructor("""
const fs = process.getBuiltinModule('node:fs');
let readonly = false;
try { fs.writeFileSync('/ungranted-root-write', 'x'); } catch (error) { readonly = error.code === 'EROFS'; }
fs.writeFileSync('/tmp/private-marker', 'owned');
return JSON.stringify({uid: process.getuid(), canary: process.env.POE_PYTHON_HOST_CANARY ?? null,
  hostFile: fs.existsSync('/home/kjopek/project/poe-code/package.json'),
  daemon: fs.existsSync('/var/run/docker.sock'), readonly, privateWrite: fs.readFileSync('/tmp/private-marker', 'utf8')});
""")
print(probe(), flush=True)`));
    assert.equal(result.exitCode, 0, result.stderr);
    assert.deepEqual(JSON.parse(result.stdout), { uid: 65534, canary: null, hostFile: false, daemon: false, readonly: true, privateWrite: 'owned' });
    const second = await shell.exec(command(`import pyodide_js
probe = pyodide_js._module.FS.readFile.constructor("return process.getBuiltinModule('node:fs').existsSync('/tmp/private-marker');")
print(probe(), flush=True)`));
    assert.equal(second.exitCode, 0, second.stderr);
    assert.equal(second.stdout.trim(), 'False');
  } finally {
    await shell.dispose(); await pool.dispose();
    if (previous === undefined) delete process.env.POE_PYTHON_HOST_CANARY;
    else process.env.POE_PYTHON_HOST_CANARY = previous;
  }
});

test('an external deadline terminates a CPU loop and preserves acknowledged canonical writes', { timeout: 45000 }, async () => {
  const pool = await createDockerPythonExecutorPool({ ...configuration, deadlineMs: 4000 });
  const fs = new MemoryFileSystem();
  const shell = new Shell({ fs }).use(pythonCommands({ createExecutor: pool.createExecutor }));
  try {
    const result = await shell.exec(command(`import os
with open("/acknowledged", "wb") as output:
    output.write(bytes([42]))
    output.flush()
    os.fsync(output.fileno())
while True:
    pass`));
    assert.equal(result.exitCode, 1);
    assert.match(result.stderr, /host deadline/);
    assert.deepEqual(await fs.readFile('/acknowledged'), new Uint8Array([42]));
    assert.equal(pool.inspect().active, 0);
    const recovered = await shell.exec(command('print("recovered", flush=True)'));
    assert.equal(recovered.exitCode, 0, recovered.stderr);
    assert.equal(recovered.stdout, 'recovered\n');
  } finally { await shell.dispose(); await pool.dispose(); }
});

test('allocation pressure is bounded and leaves a new invocation usable', { timeout: 45000 }, async () => {
  const pool = await createDockerPythonExecutorPool(configuration);
  const shell = new Shell({ fs: new MemoryFileSystem() }).use(pythonCommands({ createExecutor: pool.createExecutor }));
  try {
    const result = await shell.exec(command('payload = bytearray(1024 * 1024 * 1024)\nprint("unbounded allocation succeeded", flush=True)'));
    assert.equal(result.exitCode, 1, result.stdout);
    assert.equal(pool.inspect().active, 0);
    const recovered = await shell.exec(command('print("recovered", flush=True)'));
    assert.equal(recovered.exitCode, 0, recovered.stderr);
    assert.equal(recovered.stdout, 'recovered\n');
  } finally { await shell.dispose(); await pool.dispose(); }
});
