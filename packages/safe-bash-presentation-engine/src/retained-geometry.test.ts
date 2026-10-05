import { expect, it } from 'vitest';
import { createMemoryFileSystem } from '@poe-code/safe-fs';
import { retainedGeometry } from './retained-geometry.js';
import { openRetainedXmlDocument } from './retained-xml-document.js';
import { literal } from './retained-values.js';
import { parseXmlPart, type XmlElement } from './xml.js';
function geometry(node: XmlElement): unknown { return { name: node.name, attributes: [...node.attributes].sort((a, b) => { const left = `${a.name.namespace}/${a.name.localName}`, right = `${b.name.namespace}/${b.name.localName}`; return left < right ? -1 : left > right ? 1 : 0; }), children: node.children.map(geometry) }; }
for (const mode of ['wide', 'deep', 'names', 'failure', 'cancel']) it(`streams stored raw geometry with bounded writes: ${mode}`, async () => {
  const fs = createMemoryFileSystem(), open = fs.open!.bind(fs), controller = new AbortController(); let writes = 0, peak = 0, outstanding = 0;
  fs.readFile = async () => { throw new Error('whole-file read forbidden'); };
  fs.open = async (...args) => { const handle = await open(...args); return new Proxy(handle, { get(target, key) {
    if (key === 'write') return async (...parameters: Parameters<typeof handle.write>) => { outstanding += parameters[0].length; peak = Math.max(peak, outstanding); writes += parameters[0].length; try { await Promise.resolve(); return await handle.write(...parameters); } finally { outstanding -= parameters[0].length; } };
    const value = Reflect.get(target, key, target); return typeof value === 'function' ? value.bind(target) : value;
  } }); };
  let source = mode === 'deep' ? '<root>' + '<node a="x">'.repeat(180) + '</node>'.repeat(180) + '</root>' : '<root xmlns:z="urn:z" xmlns:a="urn:a" z:last="&amp;" a:first="one" plain="two">' + '<node z:value="'.concat('Large😀'.repeat(20), '"><leaf/></node>').repeat(mode === 'names' ? 1 : 80) + '</root>';
  if (mode === 'names') source = source.replace('urn:z', 'urn:' + 'z'.repeat(20000));
  const settings = { workingStorage: { fs, directory: '/', cacheBytes: 16384 }, signal: controller.signal, xmlLimits: { maxDepth: 1000 } };
  const document = await openRetainedXmlDocument(literal(source), settings), chunks: Uint8Array[] = [];
  const run = async () => { for await (const bytes of retainedGeometry(document, document.root, settings)) { if (mode === 'failure') throw new Error('sink'); if (mode === 'cancel') controller.abort(); await Promise.resolve(); chunks.push(new Uint8Array(bytes)); } };
  if (mode === 'failure') await expect(run()).rejects.toThrow('sink'); else if (mode === 'cancel') await expect(run()).rejects.toMatchObject({ code: 'cancelled' });
  else { await run(); expect(JSON.parse(Buffer.concat(chunks).toString())).toEqual(geometry(parseXmlPart(new TextEncoder().encode(source), { maxBytes: Infinity, maxNodes: Infinity, maxDepth: 1000 }).root)); expect(writes).toBeGreaterThan(16384); expect(peak).toBeLessThanOrEqual(16384); }
  await document.close(); expect(await fs.readdir('/')).toEqual([]);
});
