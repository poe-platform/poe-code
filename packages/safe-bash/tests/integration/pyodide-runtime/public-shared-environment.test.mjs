import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { test } from 'node:test';

const consumer = process.env.SAFE_BASH_PYTHON_CONSUMER_DIR;
if (!consumer) throw new Error('SAFE_BASH_PYTHON_CONSUMER_DIR must name a fresh standalone installation with pinned Pyodide');
if (!process.env.SAFE_BASH_PYTHON_CACHE) throw new Error('SAFE_BASH_PYTHON_CACHE must name the preprovisioned document artifact cache');

test('public fresh shells share pinned offline packages, not interpreter or tenant state', { timeout: 90000 }, async context => {
  const source = `
    import assert from 'node:assert/strict';
    import { readFile, readdir } from 'node:fs/promises';
    import { join } from 'node:path';
    import { Shell, pythonCommands, createPythonPackageEnvironment, createPythonPackageCache,
      createPythonPackageManifestStore, PythonPackageConflictError } from '@poe-platform/safe-bash';
    import { createNodePythonWorker } from '@poe-platform/safe-bash/commands/python/node';
    import { MemoryFileSystem } from '@poe-platform/safe-fs/core';
    assert.throws(() => import.meta.resolve('poe-code'), { code: 'ERR_MODULE_NOT_FOUND' });
    const cache = createPythonPackageCache({ maxBytes: 32 * 1024 * 1024 });
    for (const filename of await readdir(process.env.SAFE_BASH_PYTHON_CACHE)) {
      const key = decodeURIComponent(filename);
      if (!key.endsWith('-environment')) await cache.set(key, new Uint8Array(await readFile(join(process.env.SAFE_BASH_PYTHON_CACHE, filename))));
    }
    const manifestStore = createPythonPackageManifestStore();
    let downloads = 0;
    let started = 0;
    let retired = 0;
    const diagnostics = [];
    const environmentFor = scope => createPythonPackageEnvironment({ cache, manifestStore, scope, offline: true,
      authorize: () => true, transport: async () => { downloads++; throw new Error('offline acceptance attempted network'); } });
    const shellFor = environment => {
      const fs = new MemoryFileSystem();
      fs.mkdir = async () => { throw new Error('flat package stores must not require directories'); };
      return new Shell({ fs }).use(pythonCommands({ environment,
        onDiagnostic(event) { diagnostics.push(event); },
        createWorker() {
          started++;
          const endpoint = createNodePythonWorker({ trustedPython: true, runtimeModuleURL: import.meta.resolve('pyodide/pyodide.mjs') });
          return { ...endpoint, async terminate() { await endpoint.terminate(); retired++; } };
        },
      }));
    };
    const check = async (shell, command, expected = 0) => {
      const result = await shell.exec(command);
      assert.equal(result.exitCode, expected, result.stderr);
      assert.equal(retired, started);
      return result;
    };
    const verify = ${JSON.stringify('python -c "import pypdf; assert pypdf.__version__ == \'6.18.1\'; assert not hasattr(pypdf, \'_private_marker\'); print(42)"')};
    const firstEnvironment = environmentFor('tenant-a');
    const first = shellFor(firstEnvironment);
    await check(first, 'python -m pip install pypdf==6.18.1');
    await check(first, 'python -c "import pypdf; pypdf._private_marker = True"');
    await first.dispose(); await first.dispose();
    const second = shellFor(firstEnvironment);
    assert.equal((await check(second, verify)).stdout, '42\\n');
    await second.dispose(); await firstEnvironment.dispose();
    const restored = environmentFor('tenant-a');
    const third = shellFor(restored);
    assert.equal((await check(third, verify)).stdout, '42\\n');
    await check(third, 'python -m pip install pypdf==0.0.0', 1);
    assert.equal((await check(third, verify)).stdout, '42\\n');
    await third.dispose();
    const isolatedEnvironment = environmentFor('tenant-b');
    const isolated = shellFor(isolatedEnvironment);
    await check(isolated, ${JSON.stringify('python -c "import importlib.util; assert importlib.util.find_spec(\'pypdf\') is None"')});
    await isolated.dispose(); await isolatedEnvironment.dispose();
    const concurrent = [shellFor(restored), shellFor(restored)];
    const results = await Promise.all(concurrent.map(shell => shell.exec(verify)));
    assert.deepEqual(results.map(result => result.exitCode).sort(), [0, 1]);
    assert.ok(diagnostics.some(event => event.cause instanceof PythonPackageConflictError && event.cause.retryable));
    const retry = concurrent[results.findIndex(result => result.exitCode === 1)];
    assert.equal((await check(retry, verify)).stdout, '42\\n');
    await Promise.all(concurrent.map(shell => shell.dispose()));
    await restored.dispose(); await restored.dispose();
    assert.equal(downloads, 0);
    assert.equal(retired, started);
    manifestStore.dispose(); cache.dispose();
    console.log('offline fresh-shell reuse, revision conflicts, tenant/interpreter isolation, rejected upgrade recovery and retirement passed');
  `;
  const result = await promisify(execFile)(process.execPath, ['--input-type=module', '--eval', source], {
    cwd: consumer, signal: context.signal, timeout: 85000, maxBuffer: 1024 * 1024,
  });
  assert.match(result.stdout, /retirement passed/);
  context.diagnostic(result.stdout.trim());
});
