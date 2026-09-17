import { readFileSync } from 'node:fs';
import { build } from 'esbuild';
import { expect, it } from 'vitest';

it('keeps sandbox entrypoints and files out of the published package', () => {
  const manifest = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
  expect(Object.keys(manifest.exports).filter(key => key.startsWith('./safe'))).toEqual([]);
  expect(Object.keys(manifest.bin).filter(key => key.startsWith('poe-safe'))).toEqual([]);
  expect(manifest.files.filter((file: string) => !file.startsWith('!') && (file.includes('/safe-') || file.includes('/agent-harness/')))).toEqual([]);
});

it('keeps sandbox runtimes out of the CLI and SDK import graph', async () => {
  const result = await build({
    entryPoints: ['src/index.ts'], bundle: true, packages: 'external',
    platform: 'node', format: 'esm', write: false, metafile: true,
    loader: { '.md': 'text', '.mustache': 'text', '.log': 'text' },
  });
  expect(Object.keys(result.metafile!.inputs).filter(file => file.includes('/commands/harness') || file.includes('/sdk/bash'))).toEqual([]);
});


it('ships tokenfill as a separate dependency without its corpus copies', () => {
  const manifest = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
  expect(manifest.dependencies.tokenfill).toBe('^0.0.14');
  expect(manifest.devDependencies).not.toHaveProperty('tokenfill');
  expect(manifest.files).not.toContain('packages/tokenfill/dist');
  expect(manifest.files).toContain('!dist/corpus');
  expect(manifest.files).toContain('!packages/memory/dist/corpus');
});
