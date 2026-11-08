import { expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import { createMemoryFileSystem } from '@poe-code/safe-fs';
import { stageRetainedPackage } from './retained-package-packing.js';
import { packPackage } from './package-tools.js';
import { resourceContext } from './resource-limits.js';
import { fixture, xml, tree } from '../tests/fixtures/validation.js';
const hash = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');
const encode = (text: string) => new TextEncoder().encode(text);
async function collect(source: AsyncIterable<Uint8Array>) { const chunks = []; for await (const bytes of source) { expect(bytes.length).toBeLessThanOrEqual(16384); await Promise.resolve(); chunks.push(bytes); } return new Uint8Array(Buffer.concat(chunks)); }
function members() { return Object.entries(fixture({ 'slide.xml': xml('sld', tree('2')) }).toJSON()).map(([path, text]) => { const bytes = encode(text!); return { part: path.slice(5), bytes, sha256: hash(bytes) }; }); }
async function* descriptors(items: ReturnType<typeof members>) { for (const { part, sha256 } of items) yield { part, sha256 }; }
it('packs stored descriptors with exact buffered ZIP bytes and an owned replayable output', async () => {
  const items = members().reverse(), fs = createMemoryFileSystem(), settings = { ...resourceContext(), workingStorage: { fs, directory: '/', cacheBytes: 16384 } };
  const expected = await packPackage(items, settings);
  const staged = await stageRetainedPackage(descriptors(items), async function* (part) { yield items.find(item => item.part === part)!.bytes; }, settings);
  try { expect(await collect(staged.bytes())).toEqual(expected); expect(await collect(staged.bytes())).toEqual(expected); expect(staged.size).toBe(expected.length); expect(staged.fingerprint).toBe(hash(expected)); }
  finally { await staged.close(); }
  await expect(collect(staged.bytes())).rejects.toMatchObject({ code: 'invalid-handle' });
  expect(await fs.readdir('/')).toEqual([]);
});
for (const parts of [['/folder', '/folder/item.xml'], ['/FOLDER/item.xml', '/folder/item.xml'], ['/folder/item.xml', '/folder'], ['/../outside.xml']]) it(`admits namespace before opening any member: ${parts}`, async () => {
  const fs = createMemoryFileSystem(); let reads = 0;
  const rows = parts.map(part => ({ part, sha256: '0'.repeat(64), bytes: new Uint8Array() }));
  await expect(stageRetainedPackage(descriptors(rows), async function* () { reads++; yield new Uint8Array(); }, { workingStorage: { fs, directory: '/', cacheBytes: 16384 } })).rejects.toMatchObject({ code: parts.length === 1 ? 'unsafe-path' : 'invalid-opc' });
  expect(reads).toBe(0); expect(await fs.readdir('/')).toEqual([]);
});
for (const mode of ['hash', 'missing', 'kind', 'reads', 'source', 'chunk', 'cancel'] as const) it(`rejects invalid packed input and cleans scratch: ${mode}`, async () => {
  const fs = createMemoryFileSystem(), items = members(), controller = new AbortController();
  if (mode === 'hash') items[0]!.sha256 = '0'.repeat(64);
  if (mode === 'missing') items.splice(items.findIndex(item => item.part === '/slide.xml'), 1);
  const pending = stageRetainedPackage(descriptors(items), async function* (part) {
    if (mode === 'source') throw new Error('failed');
    if (mode === 'cancel') controller.abort();
    if (mode === 'chunk') { yield 'bad' as unknown as Uint8Array; return; }
    yield items.find(item => item.part === part)!.bytes;
  }, { signal: controller.signal, limits: mode === 'reads' ? { maxReads: 1 } : {}, workingStorage: { fs, directory: '/', cacheBytes: 16384 } }, mode === 'kind' ? { kind: 'potx' } : {});
  await expect(pending).rejects.toMatchObject({ code: { hash: 'invalid-value', missing: 'missing-binding', kind: 'invalid-opc', reads: 'resource-limit', source: 'io-failure', chunk: 'invalid-type', cancel: 'cancelled' }[mode] });
  expect(await fs.readdir('/')).toEqual([]);
});
for (const mode of ['success', 'storage', 'cancel', 'source', 'sink'] as const) it(`spills packing state with bounded writes and reused chunks: ${mode}`, async () => {
  const items = members();
  const slide = items.find(item => item.part === '/slide.xml')!;
  slide.bytes = encode(xml('sld', tree('2').replace('Lantern', '港😀'.repeat(12000)))); slide.sha256 = hash(slide.bytes);
  const owner = createMemoryFileSystem(), controller = new AbortController(); let written = 0, outstanding = 0, peak = 0, handles = 0, retired = 0;
  const fs = new Proxy(owner, { get(target, key) {
    if (key === 'readFile') return async () => { throw new Error('Whole-file reads are forbidden'); };
    if (key === 'open') return async (...args: Parameters<NonNullable<typeof owner.open>>) => {
      const handle = await owner.open!(...args); handles++;
      return new Proxy(handle, { get(target, key) {
        if (key === 'write') return async (...args: Parameters<typeof handle.write>) => {
          outstanding += args[0].length; peak = Math.max(peak, outstanding);
          try { await Promise.resolve(); if (mode === 'storage') throw new Error('storage failure'); written += args[0].length; return await handle.write(...args); } finally { outstanding -= args[0].length; }
        };
        if (key === 'close') return async () => { handles--; await handle.close(); };
        const value = Reflect.get(target, key, target); return typeof value === 'function' ? value.bind(target) : value;
      } });
    };
    const value = Reflect.get(target, key, target); return typeof value === 'function' ? value.bind(target) : value;
  } });
  const pending = stageRetainedPackage(descriptors(items), async function* (part) {
    const data = items.find(item => item.part === part)!.bytes, reused = new Uint8Array(4096);
    try { for (let offset = 0; offset < data.length; offset += reused.length) {
      const size = Math.min(reused.length, data.length - offset); reused.set(data.subarray(offset, offset + size)); yield reused.subarray(0, size); reused.fill(255);
      if (part === '/slide.xml') { if (mode === 'cancel') controller.abort(); if (mode === 'source') throw new Error('source failure'); }
    } } finally { retired++; }
  }, { signal: controller.signal, workingStorage: { fs, directory: '/', cacheBytes: 16384 } });
  if (mode === 'storage' || mode === 'source' || mode === 'cancel') await expect(pending).rejects.toMatchObject({ code: mode === 'cancel' ? 'cancelled' : 'io-failure' });
  else {
    const staged = await pending;
    try {
      if (mode === 'sink') await expect(async () => { for await (const bytes of staged.bytes()) { void bytes; throw new Error('sink failure'); } }).rejects.toThrow('sink failure');
      else expect(await collect(staged.bytes())).toEqual(await packPackage(items, resourceContext()));
      expect(written).toBeGreaterThan(16384 * 4); expect(retired).toBe(items.length);
    } finally { await staged.close(); }
  }
  expect(peak).toBeLessThanOrEqual(16384); expect(outstanding).toBe(0); expect(handles).toBe(0); expect(await fs.readdir('/')).toEqual([]);
});
it('closes an unfinished source once while preserving the primary resource error', async () => {
  const fs = createMemoryFileSystem(); let retired = 0;
  await expect(stageRetainedPackage(descriptors(members()), () => ({ [Symbol.asyncIterator]() { return { async next() { return { done: false, value: new Uint8Array() }; }, async return() { retired++; throw new Error('cleanup failed'); } }; } }), { limits: { maxReads: 2 }, workingStorage: { fs, directory: '/', cacheBytes: 16384 } })).rejects.toMatchObject({ code: 'resource-limit' });
  expect(retired).toBe(1); expect(await fs.readdir('/')).toEqual([]);
});
for (const mode of ['members', 'entry', 'total', 'archive', 'path', 'depth'] as const) it(`enforces packing ${mode} limits`, async () => {
  const fs = createMemoryFileSystem(); const archiveLimits = { [ { members: 'maxMembers', entry: 'maxEntryBytes', total: 'maxTotalBytes', archive: 'maxArchiveBytes', path: 'maxPathBytes', depth: 'maxDepth' }[mode] ]: 1 };
  const items = members();
  await expect(stageRetainedPackage(descriptors(items), async function* (part) { yield items.find(item => item.part === part)!.bytes; }, { archiveLimits, workingStorage: { fs, directory: '/', cacheBytes: 16384 } })).rejects.toMatchObject({ code: 'resource-limit' });
  expect(await fs.readdir('/')).toEqual([]);
});
it('admits empty trailing chunks at the aggregate byte limit', async () => {
  const fs = createMemoryFileSystem(), items = members();
  items.push({ part: '/z.xml', bytes: encode('<root/>'), sha256: hash(encode('<root/>')) });
  const total = items.reduce((sum, item) => sum + item.bytes.length, 0);
  const settings = { archiveLimits: { maxTotalBytes: total }, workingStorage: { fs, directory: '/', cacheBytes: 16384 } };
  const staged = await stageRetainedPackage(descriptors(items), async function* (part) { yield items.find(item => item.part === part)!.bytes; yield new Uint8Array(); }, settings);
  try { expect(await collect(staged.bytes())).toEqual(await packPackage(items, resourceContext(settings))); } finally { await staged.close(); }
  expect(await fs.readdir('/')).toEqual([]);
});
for (const mode of ['signature', 'vba', 'label-path', 'label-type', 'custom-label', 'protected'] as const) it(`preserves buffered pack security admission: ${mode}`, async () => {
  const fs = createMemoryFileSystem(), items = members();
  if (mode === 'protected') {
    const main = items.find(item => item.part === '/main.xml')!;
    main.bytes = encode(new TextDecoder().decode(main.bytes).replace('</p:presentation>', '<p:modifyVerifier/></p:presentation>')); main.sha256 = hash(main.bytes);
  } else {
    const part = { signature: '/_xmlsignatures/sig.xml', vba: '/vbaProject.bin', 'label-path': '/docMetadata/LabelInfo.xml', 'label-type': '/label.xml', 'custom-label': '/custom.xml' }[mode];
    const contentType = { signature: 'application/xml', vba: 'application/octet-stream', 'label-path': 'application/xml', 'label-type': 'application/vnd.ms-office.classificationlabels+xml', 'custom-label': 'application/vnd.openxmlformats-officedocument.custom-properties+xml' }[mode];
    const bytes = encode(mode === 'custom-label' ? '<Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/custom-properties"><property name="MSIP_Label_test"/></Properties>' : '<root/>');
    items.push({ part, bytes, sha256: hash(bytes) });
    const types = items.find(item => item.part === '/[Content_Types].xml')!;
    types.bytes = encode(new TextDecoder().decode(types.bytes).replace('</Types>', `<Override PartName="${part}" ContentType="${contentType}"/></Types>`)); types.sha256 = hash(types.bytes);
  }
  const settings = { ...resourceContext(), workingStorage: { fs, directory: '/', cacheBytes: 16384 } };
  await expect(packPackage(items, settings)).rejects.toMatchObject({ code: 'unsupported-edit' });
  await expect(stageRetainedPackage(descriptors(items), async function* (part) { yield items.find(item => item.part === part)!.bytes; }, settings)).rejects.toMatchObject({ code: 'unsupported-edit' });
  expect(await fs.readdir('/')).toEqual([]);
});
