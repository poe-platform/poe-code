import { expect, it } from 'vitest';
import { createMemoryFileSystem } from '@poe-code/safe-fs';
import { openRetainedPackageExtraction } from './retained-package-extraction.js';
import { extractPackage } from './package-tools.js';
import { resourceContext } from './resource-limits.js';
import { fixture, xml, tree } from '../tests/fixtures/validation.js';
import { storedArchive } from '../tests/fixtures/archive.js';
const encode = (text: string) => new TextEncoder().encode(text);
async function collect(source: AsyncIterable<Uint8Array>) { const chunks: Uint8Array[] = []; for await (const bytes of source) chunks.push(new Uint8Array(bytes)); return Buffer.concat(chunks); }
for (const parts of [undefined, ['/slide.xml', '/[Content_Types].xml'], ['/absent.xml'], ['/slide.xml', '/SLIDE.xml'], []]) it(`retained package extraction matches buffered selection: ${parts}`, async () => {
  const volume = fixture({ 'slide.xml': xml('sld', tree('2')) });
  const bytes = storedArchive(Object.entries(volume.toJSON()).map(([path, text]) => ({ name: path.slice(6), bytes: encode(text!) })));
  const fs = createMemoryFileSystem(), settings = { ...resourceContext(), workingStorage: { fs, directory: '/', cacheBytes: 16384 } }, options = parts === undefined ? {} : { parts };
  const expected = await extractPackage(bytes, settings, options).catch(error => error);
  const source = { size: bytes.length, async read(p: number, n: number) { return bytes.subarray(p, p + n); }, async *stream() { yield bytes; } };
  const run = openRetainedPackageExtraction(source, settings, options);
  if (expected instanceof Error) await expect(run).rejects.toMatchObject({ code: (expected as Error & { code: string }).code });
  else {
    const extracted = await run, actual = [];
    try { for await (const member of extracted.members()) actual.push({ part: member.part, name: member.name, contentType: (await collect(member.contentType())).toString(), sha256: member.sha256, bytes: new Uint8Array(await collect(member.bytes())) }); }
    finally { await extracted.close(); }
    expect(actual).toEqual(expected); expect(extracted.count).toBe(actual.length);
    await expect(async () => { for await (const item of extracted.members()) void item; }).rejects.toMatchObject({ code: 'invalid-handle' });
  }
  expect(await fs.readdir('/')).toEqual([]);
});

for (const mode of ['success', 'storage', 'source', 'cancel', 'sink'] as const) it(`bounds extraction storage and cleanup: ${mode}`, async () => {
  const volume = fixture({ 'slide.xml': xml('sld', tree('2').replace('Lantern', '港'.repeat(14000))) });
  volume.writeFileSync('/deck/large.xml', '<root>' + '港 &amp; 😀'.repeat(20000) + '</root>');
  const bytes = storedArchive(Object.entries(volume.toJSON()).map(([path, text]) => ({ name: path.slice(6), bytes: encode(text!) })));
  const owner = createMemoryFileSystem(), controller = new AbortController(); let outstanding = 0, peak = 0, written = 0, handles = 0;
  const fs = new Proxy(owner, { get(target, key) {
    if (key === 'readFile') return async () => { throw new Error('whole-file read forbidden'); };
    if (key === 'open') return async (...args: Parameters<NonNullable<typeof owner.open>>) => {
      const handle = await owner.open!(...args); handles++;
      return new Proxy(handle, { get(target, key) {
        if (key === 'write') return async (...args: Parameters<typeof handle.write>) => {
          if (mode === 'storage') throw new Error('storage failed');
          outstanding += args[0].length; peak = Math.max(peak, outstanding);
          try { await Promise.resolve(); written += args[0].length; return await handle.write(...args); } finally { outstanding -= args[0].length; }
        };
        if (key === 'close') return async () => { handles--; await handle.close(); };
        const value = Reflect.get(target, key, target); return typeof value === 'function' ? value.bind(target) : value;
      } });
    };
    const value = Reflect.get(target, key, target); return typeof value === 'function' ? value.bind(target) : value;
  } });
  const reused = new Uint8Array(4096), source = { size: bytes.length,
    async read(p: number, n: number) { const length = Math.min(n, reused.length, bytes.length - p); reused.set(bytes.subarray(p, p + length)); return reused.subarray(0, length); },
    async *stream() { for (let p = 0; p < bytes.length; p += reused.length) { if (mode === 'source') throw new Error('source failed'); const length = Math.min(reused.length, bytes.length - p); reused.set(bytes.subarray(p, p + length)); yield reused.subarray(0, length); reused.fill(255); } }
  };
  const run = openRetainedPackageExtraction(source, { signal: controller.signal, workingStorage: { fs, directory: '/', cacheBytes: 16384 } });
  if (mode === 'source' || mode === 'storage') await expect(run).rejects.toMatchObject({ code: 'io-failure' });
  else {
    const extracted = await run;
    const consume = async () => { for await (const member of extracted.members()) { let count = 0; for await (const chunk of member.bytes()) { if (mode === 'sink') throw new Error('sink failed'); if (mode === 'cancel') controller.abort(); expect(chunk.length).toBeLessThanOrEqual(16384); await Promise.resolve(); count += chunk.length; } expect(count).toBe(member.size); } };
    try { if (mode === 'sink' || mode === 'cancel') await expect(consume()).rejects.toThrow(); else await consume(); }
    finally { await extracted.close(); }
    expect(written).toBeGreaterThan(16384 * 4); expect(peak).toBeLessThanOrEqual(16384);
  }
  expect(outstanding).toBe(0); expect(handles).toBe(0); expect(await fs.readdir('/')).toEqual([]);
});

it('admits every requested part before exposing output and keeps case-sensitive order', async () => {
  const volume = fixture({ 'slide.xml': xml('sld', tree('2')) });
  volume.writeFileSync('/deck/Z.xml', '<root/>'); volume.writeFileSync('/deck/a.xml', '<root/>');
  const bytes = storedArchive(Object.entries(volume.toJSON()).reverse().map(([path, text]) => ({ name: path.slice(6), bytes: encode(text!) })));
  const fs = createMemoryFileSystem(), context = { ...resourceContext(), workingStorage: { fs, directory: '/', cacheBytes: 16384 } };
  const source = { size: bytes.length, async read(p: number, n: number) { return bytes.subarray(p, p + n); }, async *stream() { yield bytes; } };
  await expect(openRetainedPackageExtraction(source, context, { parts: ['/slide.xml', '/absent.xml'] })).rejects.toMatchObject({ code: 'missing-binding' });
  const extraction = await openRetainedPackageExtraction(source, context), expected = await extractPackage(bytes, context), names = [];
  let saved: import('./retained-package-extraction.js').RetainedExtractedPackageMember | undefined;
  try { for await (const member of extraction.members()) names.push(member.part); saved = (await extraction.members().next()).value; }
  finally { await extraction.close(); }
  expect(names).toEqual(expected.map(member => member.part));
  await expect(collect(saved!.bytes())).rejects.toMatchObject({ code: 'invalid-handle' });
  expect(await fs.readdir('/')).toEqual([]);
});

for (const mode of ['invalid-chunk', 'reads', 'too-long', 'short', 'ENOENT', 'EFBIG', 'cancel'] as const) it(`bounds retained extraction admission: ${mode}`, async () => {
  const bytes = storedArchive(Object.entries(fixture({ 'slide.xml': xml('sld', tree('2')) }).toJSON()).map(([path, text]) => ({ name: path.slice(6), bytes: encode(text!) })));
  const fs = createMemoryFileSystem(), controller = new AbortController(); let returned = 0;
  const source = { size: bytes.length, async read(p: number, n: number) { return bytes.subarray(p, p + n); }, stream() { return { [Symbol.asyncIterator]() { return {
    async next(): Promise<IteratorResult<Uint8Array>> {
      if (mode === 'cancel') controller.abort();
      if (mode === 'ENOENT' || mode === 'EFBIG') throw Object.assign(new Error('source failed'), { code: mode });
      return mode === 'short' ? { done: true, value: undefined } : { done: false, value: mode === 'invalid-chunk' ? 'invalid' as unknown as Uint8Array : mode === 'too-long' ? new Uint8Array(bytes.length + 1) : new Uint8Array() };
    }, async return(): Promise<IteratorResult<Uint8Array>> { returned++; throw new Error('return failure must not mask admission'); }
  }; } }; } };
  await expect(openRetainedPackageExtraction(source, { signal: controller.signal, limits: { maxReads: 2 }, workingStorage: { fs, directory: '/', cacheBytes: 16384 } })).rejects.toMatchObject({ code: mode === 'invalid-chunk' ? 'invalid-type' : mode === 'short' ? 'io-failure' : mode === 'ENOENT' ? 'io-failure' : mode === 'cancel' ? 'cancelled' : 'resource-limit' });
  expect(returned).toBe(mode === 'short' ? 0 : 1); expect(await fs.readdir('/')).toEqual([]);
});

it('streams long content types and stores increasing member descriptors', async () => {
  const volume = fixture({ 'slide.xml': xml('sld', tree('2')) });
  for (let n = 0; n < 30; n++) volume.writeFileSync('/deck/' + String(n) + 'x'.repeat(1000) + '.xml', '<root/>');
  const type = 'application/' + 'x'.repeat(18000) + '+xml';
  const types = volume.readFileSync('/deck/[Content_Types].xml', 'utf8') as string;
  volume.writeFileSync('/deck/[Content_Types].xml', types.replace('</Types>', '<Override PartName="/extra.xml" ContentType="' + type + '"/></Types>'));
  volume.writeFileSync('/deck/extra.xml', '<root/>');
  const bytes = storedArchive(Object.entries(volume.toJSON()).map(([path, text]) => ({ name: path.slice(6), bytes: encode(text!) })));
  const fs = createMemoryFileSystem(), settings = { ...resourceContext(), workingStorage: { fs, directory: '/', cacheBytes: 16384 } };
  const source = { size: bytes.length, async read(p: number, n: number) { return bytes.subarray(p, p + n); }, async *stream() { yield bytes; } };
  const extracted = await openRetainedPackageExtraction(source, settings), expected = await extractPackage(bytes, settings), actual = [];
  try { for await (const member of extracted.members()) actual.push({ part: member.part, name: member.name, contentType: (await collect(member.contentType())).toString(), sha256: member.sha256, bytes: new Uint8Array(await collect(member.bytes())) }); }
  finally { await extracted.close(); }
  expect(actual).toEqual(expected); expect(await fs.readdir('/')).toEqual([]);
});

for (const mode of ['unsafe', 'sparse', 'accessor', 'limit', 'invalid-deck'] as const) it(`rejects extraction admission before exposing members: ${mode}`, async () => {
  const volume = fixture({ 'slide.xml': xml('sld', mode === 'invalid-deck' ? '<p:cSld/>' : tree('2')) });
  const bytes = storedArchive(Object.entries(volume.toJSON()).map(([path, text]) => ({ name: path.slice(6), bytes: encode(text!) })));
  const parts = mode === 'sparse' ? new Array<string>(2) : mode === 'unsafe' ? ['/../slide.xml'] : ['/slide.xml', '/pres.xml'];
  if (mode === 'accessor') Object.defineProperty(parts, '0', { get() { throw new Error('accessor must not run'); } });
  const fs = createMemoryFileSystem(), settings = { ...resourceContext(mode === 'limit' ? { archiveLimits: { maxMembers: 1 } } : {}), workingStorage: { fs, directory: '/', cacheBytes: 16384 } };
  const source = { size: bytes.length, async read(p: number, n: number) { return bytes.subarray(p, p + n); }, async *stream() { yield bytes; } };
  await expect(openRetainedPackageExtraction(source, settings, mode === 'invalid-deck' ? {} : { parts })).rejects.toMatchObject({ code: mode === 'unsafe' ? 'unsafe-path' : mode === 'limit' ? 'resource-limit' : mode === 'invalid-deck' ? 'invalid-opc' : 'invalid-value' });
  expect(await fs.readdir('/')).toEqual([]);
});
