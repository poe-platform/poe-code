import { readFileSync } from 'node:fs';
import { build } from 'esbuild';
import { expect, it } from 'vitest';

it('ships the shell opt-in without publishing agent harness commands', () => {
  const manifest = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
  expect(manifest.exports).toHaveProperty('./safe-bash');
  expect(manifest.exports).toHaveProperty('./safe-bash/commands/media');
  expect(Object.keys(manifest.exports).filter(key => key.includes('agent-harness'))).toEqual([]);
  expect(Object.keys(manifest.bin).filter(key => key.startsWith('poe-safe'))).toEqual([]);
  expect(manifest.files.filter((file: string) => !file.startsWith('!') && file.includes('/agent-harness/'))).toEqual([]);
});

it('wires the bash SDK while keeping agent harness commands outside its import graph', async () => {
  const result = await build({
    entryPoints: ['src/index.ts'], bundle: true, packages: 'external',
    platform: 'node', format: 'esm', write: false, metafile: true,
    loader: { '.md': 'text', '.mustache': 'text', '.log': 'text' },
  });
  expect(Object.keys(result.metafile!.inputs).filter(file => file.includes('/commands/harness'))).toEqual([]);
  expect(Object.keys(result.metafile!.inputs)).toContain('src/sdk/bash.ts');
});


it('ships tokenfill as a separate dependency without its corpus copies', () => {
  const manifest = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
  expect(manifest.dependencies.tokenfill).toBe('^0.0.14');
  expect(manifest.devDependencies).not.toHaveProperty('tokenfill');
  expect(manifest.files).not.toContain('packages/tokenfill/dist');
  expect(manifest.files).toContain('!dist/corpus');
  expect(manifest.files).toContain('!packages/memory/dist/corpus');
});


it('keeps terminal automation and PowerPoint outside the published core', () => {
  const manifest = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
  expect(manifest.exports).not.toHaveProperty('./pptx');
  for (const name of ['terminal-pilot', 'terminal-pilot-mcp', 'pptx', 'office-package']) {
    expect(manifest.files.some((file: string) => file.startsWith(`packages/${name}/`))).toBe(false);
  }
});
