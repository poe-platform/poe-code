import { expect, test } from 'vitest';
import { createMemoryFileSystem } from '@poe-code/safe-fs/core';
import { captureBrowserArtifact } from '../src/browser-artifact';
import { captureBrowserTrace } from '../src/browser-trace';

test('Worker artifact capture uses supplied safe-fs with unlimited and finite budgets', async () => {
  const fs = createMemoryFileSystem();
  await fs.mkdir('/tmp');
  const bytes = Uint8Array.of(1, 2, 3);
  let path = '';
  const produce = async (file: string) => { path = file; await fs.writeFile(file, bytes); };
  const options = { signal: new AbortController().signal, maxBytes: Infinity, extension: 'bin' };
  expect(await captureBrowserArtifact(produce, options, fs)).toEqual(bytes);
  await expect(fs.stat(path)).rejects.toThrow();
  await expect(captureBrowserArtifact(produce, { ...options, maxBytes: 2 }, fs)).rejects.toThrow('byte limit');
  await expect(fs.stat(path)).rejects.toThrow();
});

test('Worker trace capture reads only provider-owned safe-fs paths', async () => {
  const fs = createMemoryFileSystem();
  const root = '/tmp/playwright-artifacts-owned';
  await fs.mkdir(`${root}/resources`, { recursive: true });
  await fs.writeFile(`${root}/live.trace`, Uint8Array.of(1));
  await fs.writeFile(`${root}/live.network`, Uint8Array.of(2));
  await fs.writeFile(`${root}/resources/owned`, Uint8Array.of(3));
  const native = {
    _state: { tracesDir: root, traceFile: `${root}/live.trace`, networkFile: `${root}/live.network`,
      resourcesDir: `${root}/resources`, traceSha1s: new Set(['owned']), networkSha1s: new Set<string>() },
    _fs: { async syncAndGetError() { return undefined; } },
  };
  const context = { tracing: { _connection: { toImpl: () => native } } } as unknown as Parameters<typeof captureBrowserTrace>[0];
  const options = { signal: new AbortController().signal, maxBytes: Infinity };
  expect((await captureBrowserTrace(context, options, fs)).files.map(file => [...file.bytes])).toEqual([[1], [2], [3]]);
  await expect(captureBrowserTrace(context, { ...options, maxBytes: 2 }, fs)).rejects.toThrow('byte limit');
});
