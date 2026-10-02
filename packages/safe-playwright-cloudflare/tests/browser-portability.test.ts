import { expect, test } from 'vitest';
import { build } from 'esbuild';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../../../', import.meta.url));
test('the adapter graph bundles for workerd without Node builtins', async () => {
  const result = await build({
    entryPoints: [path.join(root, 'packages/safe-playwright-cloudflare/src/index.ts')],
    bundle: true, write: false, metafile: true, platform: 'browser', conditions: ['workerd', 'browser'],
    format: 'esm', target: 'es2022', external: ['cloudflare:workers'], logLevel: 'silent',
    alias: {'@poe-platform/safe-bash/playwright': path.join(root, 'packages/safe-bash/src/playwright/index.ts')},
  });
  const imports = Object.values(result.metafile!.outputs).flatMap(output => output.imports);
  expect([...new Set(imports.filter(entry => entry.external).map(entry => entry.path))]).toEqual(['cloudflare:workers']);
  expect(Object.keys(result.metafile!.inputs).some(input => input.includes('browser-trace-archive.ts'))).toBe(true);
});
