import { expect, it } from 'vitest';
import { createMemoryFileSystem } from '@poe-code/safe-fs';
import { parseRelationships } from './relationships.js';
import { openRetainedRelationships } from './retained-relationships.js';
const encode = (value: string) => new TextEncoder().encode(value);
const source = (value: string) => (async function* () { yield encode(value); })();
const text = async (source: AsyncIterable<Uint8Array>) => { const decoder = new TextDecoder(); let result = ''; for await (const bytes of source) result += decoder.decode(bytes, { stream: true }); return result + decoder.decode(); };
const xml = (body: string) => `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${body}</Relationships>`;
it('streams relationship records and indexes exact case-sensitive identifiers', async () => {
  const fs = createMemoryFileSystem();
  const input = xml('<Relationship Id="a" Type="type" Target="../slide.xml"/><Relationship Id="A" Type="link" Target="https://example.org/?a=1&amp;b=2" TargetMode="External"/>');
  const index = await openRetainedRelationships(source(input), { workingStorage: { fs, directory: '/' } });
  const records = []; for await (const record of index.records()) records.push({ id: await text(record.id()), type: await text(record.type()), target: await text(record.target()), external: record.external });
  expect(records).toEqual(parseRelationships(encode(input))); expect(index.count).toBe(2);
  expect(await text((await index.get('A'))!.target())).toBe('https://example.org/?a=1&b=2');
  expect(await index.get('absent')).toBeUndefined();
  const retained = (await index.get('a'))!; await index.close();
  await expect(retained.target()[Symbol.asyncIterator]().next()).rejects.toMatchObject({ code: 'invalid-handle' });
  expect(await fs.readdir('/')).toEqual([]);
});
for (const body of ['', '<!-- comment -->', '<Relationship Id="a" Type="t" Target="x"/>', '<Relationship Id="a" Type="t" Target="x" TargetMode="Internal"/>', '<Relationship Id="" Type="t" Target="x"/>', '<Relationship Id="a" Type="" Target="x"/>', '<Relationship Id="a" Type="t" Target=""/>', '<Relationship Id="a" Type="t" Target="x" TargetMode="external"/>', '<Relationship Id="a" Type="t" Target="x" Extra="1"/>', '<Relationship Id="a" Type="t" Target="x"/><Relationship Id="a" Type="u" Target="y"/>', '<![CDATA[ ]]>', '<Relationship Id="a" Type="t" Target="x"><Relationship/></Relationship>', 'text']) {
  it(`matches relationship parser admission: ${body}`, async () => {
    const input = xml(body), fs = createMemoryFileSystem(); let expected = true; try { parseRelationships(encode(input)); } catch { expected = false; }
    let index; try { index = await openRetainedRelationships(source(input), { workingStorage: { fs, directory: '/' } }); } catch { expect(expected).toBe(false); }
    if (index) { expect(expected).toBe(true); await index.close(); } expect(await fs.readdir('/')).toEqual([]);
  });
}
it('stores large reused identifier/type/target chunks with bounded outstanding caller IO', async () => {
  const fs = createMemoryFileSystem(), open = fs.open!.bind(fs); let written = 0, pending = 0, peak = 0;
  fs.open = async (...args) => { const handle = await open(...args); return new Proxy(handle, { get(target, key) {
    if (key === 'write') return async (...parameters: Parameters<typeof handle.write>) => { const size = parameters[0].length; written += size; pending += size; peak = Math.max(peak, pending); try { await Promise.resolve(); return await handle.write(...parameters); } finally { pending -= size; } };
    const value = Reflect.get(target, key, target); return typeof value === 'function' ? value.bind(target) : value;
  } }); };
  const input = (async function* () {
    yield encode(xml('').replace('</Relationships>', '') + '<Relationship Id="'); const chunk = new Uint8Array(16384);
    for (const boundary of ['" Type="', '" Target="', '"/></Relationships>']) { for (let n = 0; n < 20; n++) { chunk.fill(97); yield chunk; } yield encode(boundary); }
  })();
  const index = await openRetainedRelationships(input, { workingStorage: { fs, directory: '/', cacheBytes: 16384 } });
  for await (const record of index.records()) { let length = 0; for await (const chunk of record.target()) { expect(chunk.length).toBeLessThanOrEqual(16384); length += chunk.length; await Promise.resolve(); } expect(length).toBe(20 * 16384); }
  expect(written).toBeGreaterThan(60 * 16384); expect(peak).toBeLessThanOrEqual(16384); await index.close(); expect(await fs.readdir('/')).toEqual([]);
});
it('enforces configured relationship limits and retires indexes on cancellation', async () => {
  const fs = createMemoryFileSystem(), settings = { workingStorage: { fs, directory: '/' } };
  const input = xml('<Relationship Id="a" Type="t" Target="x"/><Relationship Id="b" Type="t" Target="y"/>');
  await expect(openRetainedRelationships(source(input), { ...settings, relationshipLimits: { maxRelationships: 1 } })).rejects.toMatchObject({ code: 'resource-limit' });
  await expect(openRetainedRelationships(source(input), { ...settings, relationshipLimits: { maxBytes: 20 } })).rejects.toMatchObject({ code: 'resource-limit' });
  const controller = new AbortController(); const index = await openRetainedRelationships(source(input), { ...settings, signal: controller.signal }); controller.abort();
  await expect(index.records().next()).rejects.toMatchObject({ code: 'cancelled' }); await index.close(); expect(await fs.readdir('/')).toEqual([]);
});
