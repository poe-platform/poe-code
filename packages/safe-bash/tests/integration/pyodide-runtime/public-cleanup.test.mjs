import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { test } from 'node:test';

const consumer = process.env.SAFE_BASH_PYTHON_CONSUMER_DIR;
if (!consumer) throw new Error('SAFE_BASH_PYTHON_CONSUMER_DIR must name an installed standalone package with pinned Pyodide');

test('real Python cleans normal and exceptional temporary scopes through supported host adapters', { timeout: 90000 }, async context => {
  const source = `
    import assert from 'node:assert/strict';
    import { Shell, pythonCommands } from '@poe-platform/safe-bash';
    import { createNodePythonWorker } from '@poe-platform/safe-bash/commands/python/node';
    import { MemoryFileSystem, MountFileSystem, withFileSystemQuota } from '@poe-platform/safe-fs/core';
    const python = ${JSON.stringify(`import tempfile, pathlib, shutil, os
assert shutil.rmtree.avoids_symlink_attacks
for exceptional in (False, True):
 try:
  with tempfile.TemporaryDirectory(dir="/") as directory:
   pathlib.Path(directory, "nested").mkdir()
   pathlib.Path(directory, "nested", "file").write_bytes(b"hello")
   os.symlink("/unrelated", os.path.join(directory, "link"))
   if exceptional:
    raise ValueError("expected guest failure")
 except ValueError as error:
  assert str(error) == "expected guest failure"
 assert not os.path.exists(directory)
assert pathlib.Path("/unrelated").read_bytes() == b"safe"
failures = []
shutil.rmtree("/missing", onexc=lambda function, path, error: failures.append((path, error.errno)))
assert len(failures) == 1 and failures[0][0] == "/missing"
shutil.rmtree("/missing", ignore_errors=True)
print("normal, exceptional, symlink confinement and error callbacks passed")
`)};
    for (const profile of ['memory', 'delayed', 'quota', 'mount']) {
      const memory = new MemoryFileSystem();
      await memory.writeFile('/unrelated', new TextEncoder().encode('safe'));
      const fs = profile === 'quota' ? withFileSystemQuota(memory, { maxBytes: 1024 })
        : profile === 'mount' ? new MountFileSystem({ root: memory })
        : profile === 'delayed' ? new Proxy(memory, { get(target, property) {
          const value = Reflect.get(target, property);
          return typeof value !== 'function' ? value : async (...args) => {
            await new Promise(resolve => setTimeout(resolve, 1));
            return Reflect.apply(value, target, args);
          };
        } }) : memory;
      let retired = 0;
      const shell = new Shell({ fs }).use(pythonCommands({ createWorker() {
        const endpoint = createNodePythonWorker({ trustedPython: true, runtimeModuleURL: import.meta.resolve('pyodide/pyodide.mjs') });
        return { ...endpoint, async terminate() { await endpoint.terminate(); retired++; } };
      } }));
      try {
        const quote = String.fromCharCode(39);
        const result = await shell.exec('python -c ' + quote + python + quote);
        assert.equal(result.exitCode, 0, profile + ': ' + result.stderr);
        assert.match(result.stdout, /error callbacks passed/);
        assert.equal(retired, 1);
        assert.deepEqual((await memory.readdir('/')).map(entry => entry.name), ['unrelated']);
        console.log(profile + ' passed');
      } finally { await shell.dispose(); }
    }
  `;
  const result = await promisify(execFile)(process.execPath, ['--input-type=module', '--eval', source], {
    cwd: consumer, signal: context.signal, timeout: 85000, maxBuffer: 1024 * 1024,
  });
  assert.match(result.stdout, /mount passed/);
  context.diagnostic(result.stdout.trim());
});
