import { expect, it } from "vitest";
import { createMemoryFileSystem } from "@poe-code/safe-fs";
import { openRetainedXmlDocument } from "./retained-xml-document.js";
import { parseXmlPart } from "./xml.js";
const encode = (text: string) => new TextEncoder().encode(text);
const source = (text: string) => (async function* () { yield encode(text); })();
const text = async (source: AsyncIterable<Uint8Array>) => { let result = ""; const decoder = new TextDecoder(); for await (const bytes of source) result += decoder.decode(bytes, { stream: true }); return result + decoder.decode(); };

it("indexes expanded names, scoped namespace rebinding, mixed content and attributes", async () => {
  const doc = await openRetainedXmlDocument(source('<a xmlns="one" xmlns:p="two" p:x="A&amp;B"><p:b xmlns:p="three">x<![CDATA[<y&\r\n]]></p:b><p:c/>z</a>'),
    { workingStorage: { fs: createMemoryFileSystem(), directory: "/" } });
  expect(await text(doc.namespace(doc.root))).toBe("one");
  expect(await text(doc.text(doc.root))).toBe("x<y&\nz");
  const children = [];
  for await (const node of doc.children(doc.root)) if (node.kind === "element") children.push([await text(doc.raw(node.localName)), await text(doc.namespace(node))]);
  expect(children).toEqual([["b", "three"], ["c", "two"]]);
  const attrs = [];
  for await (const node of doc.attributes(doc.root)) attrs.push([await text(doc.raw(node.localName)), await text(doc.namespace(node)), await text(doc.text(node))]);
  expect(attrs).toEqual([["x", "two", "A&B"]]);
  await doc.close();
  await expect(doc.children(doc.root).next()).rejects.toMatchObject({ code: "invalid-handle" });
});

const invalid = [
  '', '<a>', '<a></b>', '<a/><b/>', 'text<a/>', '<a/>text', '<![CDATA[x]]><a/>',
  '<a x="1" x="2"/>', '<a xmlns:p="n" xmlns:q="n" p:x="1" q:x="2"/>', '<a p:x="1"/>', '<p:a/>',
  '<a xmlns:xml="other"/>', '<a xmlns:xmlns="n"/>', '<a xmlns:p=""/>',
  '<a xmlns="http://www.w3.org/XML/1998/namespace"/>', '<a xmlns:p="http://www.w3.org/2000/xmlns/"/>',
  '<a xmlns:p="n" xmlns:p="m"/>', '<a a:b:c="x"/>', '<a:x:y/>', '<a x="&bad;"/>', '<a>&bad;</a>',
  '<?XML x?><a/>', ' <?xml version="1.0"?><a/>', '<?xml version="1.1"?><a/>',
  '<?xml encoding="UTF-8" version="1.0"?><a/>', '<?xml version="1.0" encoding="UTF-16"?><a/>',
  '<?xml version="1.0" standalone="maybe"?><a/>', '<??><a/>', '<a>]]></a>'
];
for (const input of invalid) it(`rejects malformed XML with retained admission: ${input}`, async () => {
  expect(() => parseXmlPart(encode(input))).toThrow();
  const fs = createMemoryFileSystem();
  await expect(openRetainedXmlDocument(source(input), { workingStorage: { fs, directory: "/", cacheBytes: 16384 } })).rejects.toMatchObject({ code: "invalid-xml" });
  expect(await fs.readdir("/")).toEqual([]);
});

for (const input of [
  '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><a/>', '<a xml:lang="en"/>',
  '<a xmlns="one"><b xmlns=""/><c/></a>', '<a xmlns:p="one"><p:b xmlns:p="two"/><p:c/></a>',
  '<a xmlns:xml="http://www.w3.org/XML/1998/namespace"/>', '<?p a?><a/><!--x-->',
  '<𐀀.é a="&#x1f642;"/>', '<a xmlns:p="one" p:x="1" x="2"/>', '<a xmlns:p="n&amp;x" xmlns:q="n&amp;y" p:x="1" q:x="2"/>'
]) it(`accepts valid XML with retained admission: ${input}`, async () => {
  expect(() => parseXmlPart(encode(input))).not.toThrow();
  const doc = await openRetainedXmlDocument(source(input), { workingStorage: { fs: createMemoryFileSystem(), directory: "/" } });
  await doc.close();
});

it("stores deep element stacks in caller storage and enforces configured depth", async () => {
  const fs = createMemoryFileSystem();
  const open = fs.open!.bind(fs); let writes = 0;
  fs.open = async (...args) => {
    const descriptor = await open(...args);
    return new Proxy(descriptor, { get(target, key) {
      if (key === "write") return async (...parameters: Parameters<typeof descriptor.write>) => { writes += parameters[0].length; expect(parameters[0].length).toBeLessThanOrEqual(16384); return descriptor.write(...parameters); };
      const value = Reflect.get(target, key, target); return typeof value === "function" ? value.bind(target) : value;
    } });
  };
  const input = () => (async function* () { for (let n = 0; n < 1024; n++) yield encode('<a>'); yield encode('value'); for (let n = 0; n < 1024; n++) yield encode('</a>'); })();
  const settings = { workingStorage: { fs, directory: "/", cacheBytes: 16384 } };
  const doc = await openRetainedXmlDocument(input(), settings);
  expect(await text(doc.text(doc.root))).toBe("value"); expect(writes).toBeGreaterThan(16384);
  await doc.close();
  await expect(openRetainedXmlDocument(input(), { ...settings, xmlLimits: { maxDepth: 1023 } })).rejects.toMatchObject({ code: "resource-limit" });
  expect(await fs.readdir("/")).toEqual([]);
});

it("matches existing parser admission across namespace and name combinations", async () => {
  const fs = createMemoryFileSystem();
  const declarations = ['', ' xmlns="u"', ' xmlns:p="u"', ' xmlns:p="u" xmlns:q="u"', ' xmlns:p="u" xmlns:q="v"', ' xmlns:p="u&#13;" xmlns:q="u&#xD;"'];
  const names = ['a', 'p:a', 'q:a', 'xml:a', 'xmlns:a', 'a:b:c', 'a:', ':a', 'é', 'a·b', '·a'];
  for (const declaration of declarations) for (const name of names) {
    const input = `<${name}${declaration} p:x="1" q:x="2"/>`;
    let expected = true;
    try { parseXmlPart(encode(input)); } catch { expected = false; }
    let doc;
    try { doc = await openRetainedXmlDocument(source(input), { workingStorage: { fs, directory: "/" } }); }
    catch (error) { expect(expected, input).toBe(false); expect(error).toMatchObject({ code: "invalid-xml" }); }
    if (doc) { expect(expected, input).toBe(true); await doc.close(); }
  }
});

it("streams large namespace values and attribute sets without scalar collection", async () => {
  const fs = createMemoryFileSystem();
  const input = (async function* () {
    yield encode('<a xmlns:p="'); const chunk = new Uint8Array(16384).fill(117);
    for (let n = 0; n < 80; n++) yield chunk;
    yield encode('"');
    for (let n = 0; n < 1024; n++) yield encode(` a${n}="${n}"`);
    yield encode('><p:b/></a>');
  })();
  const doc = await openRetainedXmlDocument(input, { workingStorage: { fs, directory: "/", cacheBytes: 16384 } });
  let count = 0; for await (const attribute of doc.attributes(doc.root)) { expect(attribute.kind).toBe('attribute'); count++; }
  expect(count).toBe(1024);
  for await (const child of doc.children(doc.root)) {
    let bytes = 0;
    for await (const chunk of doc.namespace(child)) { expect(chunk.length).toBeLessThanOrEqual(16384); expect(chunk.every(byte => byte === 117)).toBe(true); bytes += chunk.length; }
    expect(bytes).toBe(80 * 16384);
  }
  await doc.close(); expect(await fs.readdir("/")).toEqual([]);
});

for (const mode of ["cancel", "read-error", "write-error"] as const) it(`cleans both XML stores after index ${mode}`, async () => {
  const fs = createMemoryFileSystem(), controller = new AbortController();
  const open = fs.open!.bind(fs); let opened = 0, closed = 0;
  fs.open = async (...args) => {
    const handle = await open(...args); const number = ++opened;
    return new Proxy(handle, { get(target, key) {
      if (key === "close") return async (...parameters: Parameters<typeof handle.close>) => { closed++; await handle.close(...parameters); };
      if (key === "read") return async (...parameters: Parameters<typeof handle.read>) => {
        if (number === 2 && mode === "read-error") throw new Error("index read failed");
        return handle.read(...parameters);
      };
      if (key === "write") return async (...parameters: Parameters<typeof handle.write>) => {
        if (number === 2 && mode === "cancel") controller.abort(new Error("cancel index"));
        if (number === 2 && mode === "write-error") throw new Error("index write failed");
        return handle.write(...parameters);
      };
      const value = Reflect.get(target, key, target); return typeof value === "function" ? value.bind(target) : value;
    } });
  };
  const input = (async function* () { yield encode('<a>'); for (let n = 0; n < 2048; n++) yield encode('<b x="value"/>'); yield encode('</a>'); })();
  await expect(openRetainedXmlDocument(input, { workingStorage: { fs, directory: "/", cacheBytes: 16384 }, signal: controller.signal }))
    .rejects.toMatchObject({ code: mode === "cancel" ? "cancelled" : "io-failure" });
  expect(opened).toBe(2); expect(closed).toBe(2); expect(await fs.readdir("/")).toEqual([]);
});

for (const input of ['<a/>', ' <a/> ', '<a x="1"/>', '<?xml version="1.0"?><a/>', '<a>t<![CDATA[x]]>t</a>', '<!--x--><a/><?p x?>']) it(`preserves XML node accounting: ${input}`, async () => {
  const expected = parseXmlPart(encode(input)).nodeCount;
  const doc = await openRetainedXmlDocument(source(input), { workingStorage: { fs: createMemoryFileSystem(), directory: "/" } });
  expect(doc.nodeCount).toBe(expected); await doc.close();
  if (expected > 1) await expect(openRetainedXmlDocument(source(input), { workingStorage: { fs: createMemoryFileSystem(), directory: "/" }, xmlLimits: { maxNodes: expected - 1 } })).rejects.toMatchObject({ code: "resource-limit" });
});

it("owns working-storage settings before consuming a caller source", async () => {
  const fs = createMemoryFileSystem();
  const workingStorage = { fs, directory: "/", cacheBytes: 16384 };
  const input = (async function* () {
    yield encode('<a>'); const chunk = new Uint8Array(16384).fill(120);
    for (let n = 0; n < 3; n++) yield chunk;
    yield encode('</a>'); workingStorage.cacheBytes = 1; workingStorage.directory = '/missing';
  })();
  const doc = await openRetainedXmlDocument(input, { workingStorage });
  expect(doc.root.kind).toBe('element'); await doc.close(); expect(await fs.readdir('/')).toEqual([]);
});

for (const little of [false, true]) it(`admits UTF-16 namespaces and values across single-byte chunks: little=${little}`, async () => {
  const input = '<?xml version="1.0" encoding="UTF-16"?><é:a xmlns:é="urn:海"><é:b x="🙂&#13;"/></é:a>';
  const bytes = new Uint8Array(2 + input.length * 2), view = new DataView(bytes.buffer);
  view.setUint16(0, 0xfeff, little);
  for (let n = 0; n < input.length; n++) view.setUint16(2 + n * 2, input.charCodeAt(n), little);
  const doc = await openRetainedXmlDocument((async function* () { for (const byte of bytes) yield new Uint8Array([byte]); })(),
    { workingStorage: { fs: createMemoryFileSystem(), directory: "/" } });
  expect(await text(doc.raw(doc.root.localName))).toBe("a");
  expect(await text(doc.namespace(doc.root))).toBe("urn:海");
  for await (const child of doc.children(doc.root)) for await (const attribute of doc.attributes(child)) expect(await text(doc.text(attribute))).toBe("🙂\r");
  await doc.close();
});

it("rejects foreign node capabilities without reading arbitrary records", async () => {
  const options = { workingStorage: { fs: createMemoryFileSystem(), directory: "/" } };
  const a = await openRetainedXmlDocument(source('<a/>'), options), b = await openRetainedXmlDocument(source('<b/>'), options);
  await expect(a.children(b.root).next()).rejects.toMatchObject({ code: "invalid-handle" });
  await expect(text(a.text({ ...a.root }))).rejects.toMatchObject({ code: "invalid-handle" });
  await a.close(); await b.close();
});
it('restores document-scoped node IDs and resolves namespace prefixes after scope restoration', async () => {
  const fs = createMemoryFileSystem(), doc = await openRetainedXmlDocument(source('<a xmlns:p="one"><b xmlns:p="two"><c/></b><d/></a>'), { workingStorage: { fs, directory: '/' } });
  const root = await doc.node(doc.reference(doc.root)); expect(doc.reference(root)).toBe(doc.reference(doc.root));
  const nodes = []; for await (const child of doc.children(root)) nodes.push(child);
  expect(await text((await doc.resolveNamespace(nodes[0]!, () => source('p')))!) ).toBe('two');
  expect(await text((await doc.resolveNamespace(nodes[1]!, () => source('p')))!) ).toBe('one');
  expect(await doc.resolveNamespace(root, () => source('missing'))).toBeUndefined();
  expect(await text((await doc.resolveNamespace(root, () => source('xml')))!) ).toBe('http://www.w3.org/XML/1998/namespace');
  await expect(doc.node(doc.reference(doc.root) + 1)).rejects.toMatchObject({ code: 'invalid-handle' });
  await expect(doc.node(NaN)).rejects.toMatchObject({ code: 'invalid-handle' });
  const savedId = doc.reference(root); await doc.close(); await expect(doc.node(savedId)).rejects.toMatchObject({ code: 'invalid-handle' }); expect(await fs.readdir('/')).toEqual([]);
});
