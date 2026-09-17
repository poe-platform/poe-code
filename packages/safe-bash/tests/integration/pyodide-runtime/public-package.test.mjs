import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import test from 'node:test';
import { promisify } from 'node:util';

const consumer = process.env.SAFE_BASH_PYTHON_CONSUMER_DIR;
const packageName = process.env.SAFE_BASH_PYTHON_PACKAGE ?? '@poe-platform/safe-bash';
if (!consumer) throw new Error('SAFE_BASH_PYTHON_CONSUMER_DIR must name a fresh package installation containing pinned Pyodide');
if (!['@poe-platform/safe-bash', 'poe-code'].includes(packageName)) throw new Error('Unsupported Python package profile');
const shellSpecifier = packageName === 'poe-code' ? 'poe-code/safe-bash' : packageName;
const fsSpecifier = packageName === 'poe-code' ? 'poe-code/safe-fs/core' : '@poe-platform/safe-fs/core';

test(`${packageName} public Node Python executes and awaits worker termination`, { timeout: 45000 }, async context => {
  const source = `
    import assert from 'node:assert/strict';
    import { Shell, agentCommands, pythonCommands } from ${JSON.stringify(shellSpecifier)};
    import { createNodePythonWorker } from ${JSON.stringify(shellSpecifier + '/commands/python/node')};
    import { MemoryFileSystem } from ${JSON.stringify(fsSpecifier)};
    if (${JSON.stringify(packageName)} !== 'poe-code') {
      assert.throws(() => import.meta.resolve('poe-code'), { code: 'ERR_MODULE_NOT_FOUND' });
    }
    const probe = createNodePythonWorker({ trustedPython: true, runtimeModuleURL: import.meta.resolve('pyodide/pyodide.mjs') });
    await probe.terminate();
    const fs = new MemoryFileSystem();
    let started = 0;
    let terminated = 0;
    const shell = new Shell({ fs }).use(agentCommands()).use(pythonCommands({ createWorker() {
      const endpoint = createNodePythonWorker({ trustedPython: true, runtimeModuleURL: import.meta.resolve('pyodide/pyodide.mjs') });
      started++;
      const terminate = endpoint.terminate.bind(endpoint);
      return { ...endpoint, async terminate() { await terminate(); terminated++; } };
    } }));
    try {
      const inline = await shell.exec('python -c "print(6 * 7)"');
      assert.equal(inline.exitCode, 0, inline.stderr);
      assert.equal(inline.stdout, '42\\n');
      assert.equal(terminated, started);
      console.log('inline execution and termination passed');
      const binary = await shell.exec(${JSON.stringify('python -c "import pathlib; data=bytes(range(256)); pathlib.Path(\'/binary\').write_bytes(data); assert pathlib.Path(\'/binary\').read_bytes()==data"')});
      assert.equal(binary.exitCode, 0, binary.stderr);
      assert.deepEqual(await fs.readFile('/binary'), Uint8Array.from({ length: 256 }, (_, index) => index));
      assert.equal(terminated, started);
      console.log('binary I/O and termination passed');
      const pipeline = await shell.exec('printf pipeline | python -c "import sys; sys.stdout.write(sys.stdin.read().upper())" | cat');
      assert.equal(pipeline.exitCode, 0, pipeline.stderr);
      assert.equal(pipeline.stdout, 'PIPELINE');
      assert.equal(started, 3);
      assert.equal(terminated, started);
      console.log('pipeline and termination passed');
    } finally { await shell.dispose(); }
    assert.equal(terminated, started);
    console.log('public Python package: inline, binary, pipeline, awaited termination passed');
  `;
  const result = await promisify(execFile)(process.execPath, ['--input-type=module', '--eval', source], {
    cwd: consumer, signal: context.signal, timeout: 40000, maxBuffer: 1024 * 1024,
  });
  assert.match(result.stdout, /awaited termination passed/);
  context.diagnostic(result.stdout.trim());
});
