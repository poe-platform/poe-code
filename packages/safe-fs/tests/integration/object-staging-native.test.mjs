import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { readFile, mkdtemp, rm } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { promisify } from 'node:util';
import { test } from 'node:test';
import { build } from 'esbuild';

const root = fileURLToPath(new URL('../../../../', import.meta.url));
const runtimeRoot = process.env.SAFE_FS_PYODIDE_ROOT;
assert.ok(runtimeRoot, 'Set SAFE_FS_PYODIDE_ROOT to an installed pyodide@314.0.6 package directory');
assert.equal(JSON.parse(await readFile(join(runtimeRoot, 'package.json'), 'utf8')).version, '314.0.6');
const outputRoot = resolve(process.env.TMPDIR ?? join(root, 'out'));
assert.ok(outputRoot.startsWith(join(root, 'out') + '/'), 'Set TMPDIR to an existing directory under worktree out/');

test('native Python closes large binary output without manual flush or fsync', { timeout: 180000 }, async context => {
  const directory = await mkdtemp(join(outputRoot, 'native-build-'));
  try {
    await build({
      entryPoints: {
        main: fileURLToPath(new URL('./object-staging-native.worker.mjs', import.meta.url)),
        worker: join(root, 'packages/safe-bash/src/commands/python/worker.ts'),
      },
      outdir: directory, bundle: true, platform: 'node', format: 'esm', target: 'node22',
      alias: { '@poe-code/safe-fs/core': join(root, 'packages/safe-fs/src/core.ts') },
    });
    for (const size of [9 * 1024 * 1024, 100 * 1024 * 1024]) {
      for (const profile of ['immediate', 'delayed']) {
        await context.test(`${profile}: ${size} bytes with one 64 KiB staging page`, async child => {
          const result = await promisify(execFile)(process.execPath, [join(directory, 'main.js'),
            pathToFileURL(resolve(runtimeRoot, 'pyodide.mjs')).href, outputRoot, String(size), profile],
          { signal: child.signal, timeout: 85000, maxBuffer: 1024 * 1024 });
          const evidence = JSON.parse(result.stdout.trim());
          assert.equal(evidence.size, size);
          assert.equal(evidence.interpreter, true);
          child.diagnostic(JSON.stringify(evidence));
        });
      }
    }
  } finally { await rm(directory, { recursive: true, force: true }); }
});
