import { expect, test } from 'vitest';
import { createMemoryFileSystem } from '@poe-code/safe-fs/core';
import { createZipCodec } from '@poe-code/office-package/zip';
import { writeTraceArchive } from '../src/browser-trace-archive.js';

test('exports admitted trace files and source names through the supplied VFS without Buffer', async () => {
  const fs = createMemoryFileSystem();
  await fs.mkdir('/trace');
  await fs.writeFile('/trace/events', new TextEncoder().encode('trace\n'));
  await fs.writeFile('/source.ts', new TextEncoder().encode('export {};'));
  const limits = {maxBytes: 4096, maxFiles: 8, maxArchiveBytes: 4096};
  const original = globalThis.Buffer;
  Reflect.deleteProperty(globalThis, 'Buffer');
  try {
    await writeTraceArchive({ fs, entries: [{name: 'trace.trace', value: '/trace/events'}], zipFile: '/archive.zip',
      calls: [{id: 1, stack: [{file: '/source.ts', line: 1}]}], includeSources: true, limits,
      signal: new AbortController().signal, admitInput() {} });
  } finally { globalThis.Buffer = original; }
  const bytes = await fs.readFile('/archive.zip');
  const codec = createZipCodec();
  const zipLimits = {maxArchiveBytes: 4096, maxEntryBytes: 4096, maxTotalBytes: 4096, maxMembers: 8,
    maxPathBytes: 65535, maxDepth: 32, maxPaxBytes: 65535, maxTextBytes: 65535, chunkSize: 65536};
  const signal = new AbortController().signal;
  const archive = await codec.readZipArchive(bytes, zipLimits, signal);
  expect(archive.entries.map(entry => entry.name)).toEqual(['trace.trace', 'trace.stacks',
    'resources/src@' + Array.from(new Uint8Array(await crypto.subtle.digest('SHA-1', new TextEncoder().encode('/source.ts'))), byte => byte.toString(16).padStart(2, '0')).join('') + '.txt']);
  let source = '';
  for await (const chunk of codec.decodeZipEntry(archive.entries[2]!, zipLimits, signal)) source += new TextDecoder().decode(chunk);
  expect(source).toBe('export {};');
});
