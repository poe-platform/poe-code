import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { isAbsolute, join } from 'node:path';
import { Shell, pythonCommands, createFetchTransport, createOriginAuthorizer } from 'poe-code/safe-bash';
import { MemoryFileSystem } from 'poe-code/safe-fs/core';
import { createNodePythonWorker } from 'poe-code/safe-bash/commands/python/node';

// Explicit setup, never imported by a unit test or an acceptance test. Network
// access and host writes are confined to this opt-in provisioning command.
const directory = process.env.SAFE_BASH_PYTHON_CACHE;
assert.ok(directory && isAbsolute(directory), 'SAFE_BASH_PYTHON_CACHE must name an absolute provisioning directory');
await mkdir(directory, { recursive: true });
const runtimeModuleURL = process.env.SAFE_BASH_PYODIDE_RUNTIME_URL ?? new URL('./node_modules/pyodide/pyodide.mjs', import.meta.url).href;
const fs = new MemoryFileSystem();
await fs.mkdir('/work');
const shell = new Shell({ fs, cwd: '/work' }).use(pythonCommands({
  createWorker: () => createNodePythonWorker({ trustedPython: true, runtimeModuleURL }),
  packageProfile: 'documents',
  provisioning: {
    authorize: createOriginAuthorizer(['https://cdn.jsdelivr.net', 'https://pypi.org', 'https://files.pythonhosted.org']),
    transport: createFetchTransport(),
    cache: {
      async get(key) {
        try { return new Uint8Array(await readFile(join(directory, encodeURIComponent(key)))); }
        catch (error) { if (error.code === 'ENOENT') return undefined; throw error; }
      },
      async set(key, bytes) { await writeFile(join(directory, encodeURIComponent(key)), bytes); },
    },
    onProgress: event => process.stderr.write(JSON.stringify(event) + '\n'),
  },
}));
try {
  const result = await shell.exec(`python -c 'import sys, docx, openpyxl, xlsxwriter, fpdf, pypdf; assert sys.version_info[:3] == (3, 14, 2); print("Document profile provisioned for CPython 3.14.2")'`);
  process.stdout.write(result.stdout);
  process.stderr.write(result.stderr);
  assert.equal(result.exitCode, 0, 'Document runtime provisioning failed');
} finally { await shell.dispose(); }
