import { expect, it } from 'vitest';
import { PagedStorage } from '@poe-code/safe-fs/storage';
import { createMemoryFileSystem } from '@poe-code/safe-fs';
import { RetainedValues, literal } from './retained-values.js';
import { resolveRetainedPartReference } from './retained-package-uri.js';
import { resolvePartReference } from './package-uri.js';
const text = async (source: AsyncIterable<Uint8Array>) => { let result = ''; const decoder = new TextDecoder(); for await (const chunk of source) result += decoder.decode(chunk, { stream: true }); return result + decoder.decode(); };
for (const base of ['/', '/ppt', '/ppt/slides']) for (const reference of ['a.xml', '../a.xml', '../../a.xml', './a.xml', '/a.xml', '/x/../a.xml', 'x/../../a.xml', 'a:b', 'x/a:b', '%3a.xml', 'a%20b.xml', 'É/🙂.xml', '[Content_Types].xml', 'x/[Content_Types].xml', '[Content_Types].xml/../a.xml', '', '.', '..', 'x/.', 'x/..', 'x/', '//x', '/x//y', 'x./y', 'x%41', 'x%ff', 'x%2f', 'x%5c', 'x%7f', 'x%', 'x#frag', 'x?query']) {
  it(`matches OPC reference resolution: ${base} + ${reference}`, async () => {
    const fs = createMemoryFileSystem(), signal = new AbortController().signal, pages = new PagedStorage({ fs, cwd: '/', env: {}, signal }, 1);
    const values = new RetainedValues(pages, () => signal.throwIfAborted(), signal);
    let expected: string | undefined; try { expected = resolvePartReference(base, reference); } catch { /* rejected baseline */ }
    try {
      const range = await resolveRetainedPartReference(base, literal(reference), pages, values);
      expect(expected).toBeDefined(); expect(await text(values.read(range))).toBe(expected);
    } catch (error) { expect(expected).toBeUndefined(); expect(error).toMatchObject({ code: 'unsafe-path' }); }
    await pages.close(); expect(await fs.readdir('/')).toEqual([]);
  });
}
it('resolves generated deep paths using caller storage rather than an in-memory segment stack', async () => {
  const fs = createMemoryFileSystem(), signal = new AbortController().signal, open = fs.open!.bind(fs); let writes = 0;
  fs.open = async (...args) => { const handle = await open(...args); return new Proxy(handle, { get(target, key) {
    if (key === 'write') return async (...parameters: Parameters<typeof handle.write>) => { expect(parameters[0].length).toBeLessThanOrEqual(16384); writes += parameters[0].length; return handle.write(...parameters); };
    const value = Reflect.get(target, key, target); return typeof value === 'function' ? value.bind(target) : value;
  } }); };
  const pages = new PagedStorage({ fs, cwd: '/', env: {}, signal }, 1), values = new RetainedValues(pages, () => signal.throwIfAborted(), signal);
  const input = (async function* () { for (let n = 0; n < 1000; n++) yield* literal('x/'); for (let n = 0; n < 1000; n++) yield* literal('../'); yield* literal('result.xml'); })();
  const result = await resolveRetainedPartReference('/ppt', input, pages, values);
  expect(await text(values.read(result))).toBe('/ppt/result.xml'); expect(writes).toBeGreaterThan(16384);
  await pages.close(); expect(await fs.readdir('/')).toEqual([]);
});
