import { expect, it } from 'vitest';
import { parseXmlStream, type XmlElement } from '@poe-code/safe-fs/xml';
import { defaultSsconvertLimits, type CapabilityContext } from '@poe-code/spreadsheet-engine';
import { createOdfXmlStorage } from './odf-xml-storage.js';

const table = 'urn:oasis:names:tc:opendocument:xmlns:table:1.0';
const context: CapabilityContext = { limits: defaultSsconvertLimits, signal: new AbortController().signal,
  environment: { env: {}, locale: 'C', timezone: 'UTC' }, own() {} };

it('replays exact canonical mixed content and nested staged groups with borrowed windows', async () => {
  const xml = `<table:table xmlns:table="${table}">before<!--comment--><table:table-row-group>` +
    Array.from({ length: 300 }, (_, i) => `x<table:table-row><table:table-cell>${i}😀</table:table-cell></table:table-row>`).join('') +
    '</table:table-row-group><![CDATA[middle]]><?pi data?><table:table-row><table:table-cell>last</table:table-cell></table:table-row>after</table:table>';
  const expected = await parseXmlStream([xml]);
  const bytes = new Uint8Array(4 * 1024 * 1024), borrowed = new Uint8Array(16384); let end = 8, closed = 0, pending = 0;
  const store = createOdfXmlStorage({ ...context, createWorkingStorage() { return {
    allocate(length) { const at = end; end += length; expect(end).toBeLessThan(bytes.length); return at; },
    async read(at, length) { expect(length).toBeLessThanOrEqual(16384); borrowed.set(bytes.subarray(at, at + length)); return borrowed.subarray(0, length); },
    async write(at, value) { expect(++pending).toBe(1); expect(value.length).toBeLessThanOrEqual(16384); await Promise.resolve(); bytes.set(value, at); pending--; },
    async close() { closed++; }
  }; } }, [table]);
  const root = await parseXmlStream([xml], { streamElements: store.streamElements });
  expect(root.children).toEqual([]); expect(root.text).toBe('after');
  const [first, second] = await Promise.all([store.materialize(root), store.materialize(root)]);
  expect(first).toEqual(expected); expect(second).toEqual(expected);
  first.children.length = 0; expect((await store.materialize(root)).children).toEqual(expected.children);
  const iterator = store.children(root); await iterator.next(); await iterator.return(undefined);
  await store.close(); await store.close(); expect(closed).toBe(1);
  await expect(store.content(root).next()).rejects.toThrow('closed');
});

it.each(['read', 'write', 'cancel'])('retires staged XML after %s failure', async mode => {
  const controller = new AbortController(), error = new Error('XML backing failed');
  const bytes = new Uint8Array(65536); let end = 8, armed = mode === 'write', closed = 0;
  const store = createOdfXmlStorage({ ...context, signal: controller.signal, createWorkingStorage() { return {
    allocate(length) { const at = end; end += length; return at; },
    async read(at, length) { if (armed && mode === 'read') throw error; if (armed && mode === 'cancel') controller.abort(error); return bytes.subarray(at, at + length); },
    async write(at, value) { if (armed && mode === 'write') throw error; bytes.set(value, at); }, async close() { closed++; }
  }; } }, [table]);
  const xml = `<table:table xmlns:table="${table}"><table:table-row><table:table-cell>cell</table:table-cell></table:table-row></table:table>`;
  let root: XmlElement | undefined;
  const run = async () => { root = await parseXmlStream([xml], { streamElements: store.streamElements }); armed = true; await store.materialize(root); };
  await expect(run()).rejects.toMatchObject({ cause: error });
  await store.close(); expect(closed).toBe(1);
});
