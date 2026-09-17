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

for (const storageProfile of ['memory', 'quota']) test(`${packageName} public Node Python on ${storageProfile} executes and awaits worker termination`, { timeout: 45000 }, async context => {
  const source = `
    import assert from 'node:assert/strict';
    import { Shell, agentCommands, pythonCommands } from ${JSON.stringify(shellSpecifier)};
    import { createNodePythonWorker } from ${JSON.stringify(shellSpecifier + '/commands/python/node')};
    import { MemoryFileSystem, withFileSystemQuota } from ${JSON.stringify(fsSpecifier)};
    if (${JSON.stringify(packageName)} !== 'poe-code') {
      assert.throws(() => import.meta.resolve('poe-code'), { code: 'ERR_MODULE_NOT_FOUND' });
    }
    const probe = createNodePythonWorker({ trustedPython: true, runtimeModuleURL: import.meta.resolve('pyodide/pyodide.mjs') });
    await probe.terminate();
    const storage = new MemoryFileSystem();
    const fs = ${JSON.stringify(storageProfile)} === 'quota' ? withFileSystemQuota(storage, { maxBytes: 256 }) : storage;
    let started = 0;
    let terminated = 0;
    const shell = new Shell({ fs }).use(agentCommands()).use(pythonCommands({ createWorker() {
      const endpoint = createNodePythonWorker({ trustedPython: true, runtimeModuleURL: import.meta.resolve('pyodide/pyodide.mjs') });
      started++;
      const terminate = endpoint.terminate.bind(endpoint);
      return { ...endpoint, async terminate() { await terminate(); terminated++; } };
    } }));
    try {
      const inline = await shell.exec(${JSON.stringify('python -c "import tempfile; temporary=tempfile.NamedTemporaryFile(dir=\'/\'); temporary.write(b\'abc\'); temporary.close(); print(6 * 7)"')});
      assert.equal(inline.exitCode, 0, inline.stderr);
      assert.equal(inline.stdout, '42\\n');
      assert.equal(terminated, started);
      console.log('inline execution and termination passed');
      const binary = await shell.exec(${JSON.stringify('python -c "import pathlib; data=bytes(range(256)); pathlib.Path(\'/binary\').write_bytes(data); assert pathlib.Path(\'/binary\').read_bytes()==data"')});
      assert.equal(binary.exitCode, 0, binary.stderr);
      assert.deepEqual(await fs.readFile('/binary'), Uint8Array.from({ length: 256 }, (_, index) => index));
      assert.equal(terminated, started);
      console.log('binary I/O and termination passed');
      if (${JSON.stringify(storageProfile)} === 'quota') {
        const bounded = await shell.exec(${JSON.stringify('python -c "import errno\ntry:\n with open(\'/binary\', \'ab\', buffering=0) as stream: stream.write(b\'!\')\nexcept OSError as error: assert error.errno == errno.ENOSPC\nelse: raise AssertionError(\'quota exceeded\')"')});
        assert.equal(bounded.exitCode, 0, bounded.stderr);
        assert.deepEqual(await fs.readFile('/binary'), Uint8Array.from({ length: 256 }, (_, index) => index));
        assert.equal(terminated, started);
      }
      const pipeline = await shell.exec('printf pipeline | python -c "import sys; sys.stdout.write(sys.stdin.read().upper())" | cat');
      assert.equal(pipeline.exitCode, 0, pipeline.stderr);
      assert.equal(pipeline.stdout, 'PIPELINE');
      assert.equal(started, ${storageProfile === 'quota' ? 4 : 3});
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
