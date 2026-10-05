import assert from "node:assert/strict";
import test from "node:test";
import { createMemoryFileSystem } from "@poe-code/safe-fs";
import { parseXml } from "@poe-code/safe-fs/core";
import { serializeDocument } from "./document.js";
import { XmlBudget, resolveXmlQueryLimits } from "./limits.js";
import { StoredXmlDocument } from "./stored-document.js";

for (const fail of [false, true]) test(`XML node storage spills through injected retained descriptors and closes them (failure=${fail})`, async () => {
  const fs = createMemoryFileSystem(), signal = new AbortController().signal;
  let writes = 0, opened = 0, closed = 0;
  const injected = new Proxy(fs, { get(target, key) {
    if (key === "readFile" || key === "writeFile") return () => assert.fail("document storage must use positioned descriptors");
    if (key === "open") return async (...args: Parameters<typeof fs.open>) => {
      const handle = await fs.open(...args); opened++;
      return new Proxy(handle, { get(descriptor, member) {
        if (member === "write") return async (...values: Parameters<typeof handle.write>) => {
          assert.ok(values[0].byteLength <= 16384); writes++;
          return handle.write(...values);
        };
        if (member === "close") return async (...values: Parameters<typeof handle.close>) => {
          closed++; await handle.close(...values);
          if (fail) throw new Error("cleanup failed");
        };
        const value = Reflect.get(descriptor, member, descriptor);
        return typeof value === "function" ? value.bind(descriptor) : value;
      } });
    };
    const value = Reflect.get(target, key, target);
    return typeof value === "function" ? value.bind(target) : value;
  } });
  const failure = new Error("input failed");
  const source = { async *[Symbol.asyncIterator]() {
    yield "<!--before--><r>";
    for (let index = 0; index < 200; index++) yield `<x id="${index}">é😀</x>`;
    if (fail) throw failure;
    yield "</r><?after ok?>";
  } };
  const context = { fs: injected, cwd: "/", env: {}, signal };
  const budget = new XmlBudget(resolveXmlQueryLimits(), signal, async () => {});
  if (fail) await assert.rejects(StoredXmlDocument.parse(source, context, budget, 1), error => error === failure);
  else {
    const document = await StoredXmlDocument.parse(source, context, budget, 1);
    try {
      let count = 0;
      for await (const reference of document.children(document.root)) {
        const node = await document.node(reference);
        assert.equal(node.kind, "element");
        if (node.kind !== "element") assert.fail();
        assert.equal(node.attributes[0]?.value, String(count++));
        assert.deepEqual(node.children, []);
        assert.deepEqual(node.content, []);
      }
      assert.equal(count, 200);
    } finally { await document.close(); }
  }
  assert.ok(writes > 1, "large input must reach the injected backing store");
  assert.ok(opened >= 1 && opened <= 3, "only source, ancestry and document backing may be opened");
  assert.equal(closed, opened);
  assert.deepEqual(await fs.readdir("/"), []);
});


for (const mode of ["format", "c14n", "exc-c14n"] as const) for (const format of [false, true]) {
  test(`stored XML serialization preserves ${mode} (format=${format})`, async () => {
    const input = `<?xml version="1.0"?><!--before--><r xmlns:p="urn:p">\n<p:x a="é">😀<![CDATA[c]]></p:x>\n<empty/><s xml:space="preserve"> <a/> </s></r><?after ok?>`;
    const signal = new AbortController().signal;
    const budget = () => new XmlBudget(resolveXmlQueryLimits(), signal, async () => {});
    const expected: string[] = [];
    for await (const text of serializeDocument(parseXml(input), mode, budget(), format)) expected.push(text);
    const document = await StoredXmlDocument.parse([input], { fs: createMemoryFileSystem(), cwd: "/", env: {}, signal }, budget());
    try {
      const actual: string[] = [];
      for await (const text of serializeDocument(document, mode, budget(), format)) actual.push(text);
      assert.equal(actual.join(""), expected.join(""));
    } finally { await document.close(); }
  });
}

for (const mode of ["format", "c14n", "exc-c14n"] as const) for (const formatted of [false, true])
test(`deep ${mode} (formatted=${formatted}) serialization stores pending ancestry in caller backing`, async () => {
  const fs = createMemoryFileSystem(), signal = new AbortController().signal;
  const budget = new XmlBudget(resolveXmlQueryLimits(), signal, async () => {});
  const depth = 300;
  const input = '<r xmlns:p="urn:p">' + '<x>'.repeat(depth) + '<p:leaf/>' + '</x>'.repeat(depth) + '</r>';
  const document = await StoredXmlDocument.parse([input], { fs, cwd: "/", env: {}, signal }, budget, 1);
  let allocations = 0;
  const allocate = document.storage.allocate.bind(document.storage);
  document.storage.allocate = length => { allocations += length; return allocate(length); };
  try {
    let actual = "", expected = "";
    for await (const part of serializeDocument(parseXml(input), mode, budget, formatted)) expected += part;
    for await (const part of serializeDocument(document, mode, budget, formatted)) { await Promise.resolve(); actual += part; }
    assert.equal(actual, expected);
    assert.ok(allocations > 16384, "pending traversal frames must be stored, not retained in iterator closures");
  } finally { await document.close(); }
  assert.deepEqual(await fs.readdir("/"), []);
});

for (const cancel of [false, true]) test(`serializer retires stored frames after backing failure (cancel=${cancel})`, async () => {
  const fs = createMemoryFileSystem(), controller = new AbortController(), failure = new Error("frame backing failed");
  let serializing = false, opened = 0, closed = 0;
  const injected = new Proxy(fs, { get(target, key) {
    if (key === "open") return async (...args: Parameters<typeof fs.open>) => {
      const handle = await fs.open(...args); opened++;
      return new Proxy(handle, { get(descriptor, member) {
        if (member === "write") return async (...args: Parameters<typeof handle.write>) => {
          assert.ok(args[0].length <= 16384);
          if (serializing) { if (cancel) controller.abort(failure); throw failure; }
          return handle.write(...args);
        };
        if (member === "close") return async () => { closed++; await handle.close(); };
        const value = Reflect.get(descriptor, member, descriptor);
        return typeof value === "function" ? value.bind(descriptor) : value;
      } });
    };
    const value = Reflect.get(target, key, target);
    return typeof value === "function" ? value.bind(target) : value;
  } });
  const budget = new XmlBudget(resolveXmlQueryLimits(), controller.signal, async () => {});
  const document = await StoredXmlDocument.parse(['<r>' + '<x>'.repeat(200) + 'text' + '</x>'.repeat(200) + '</r>'],
    { fs: injected, cwd: "/", env: {}, signal: controller.signal }, budget, 1);
  serializing = true;
  try {
    await assert.rejects(async () => { for await (const part of serializeDocument(document, "format", budget, false)) assert.ok(part.length <= 4096); }, error => error === failure);
  } finally { await document.close(); }
  assert.ok(opened >= 1 && opened <= 3, "only source, ancestry and document backing may be opened"); assert.equal(closed, opened);
  assert.deepEqual(await fs.readdir("/"), []);
});

for (const width of [1, 7, 512]) test(`recovery reads chunked source with split Unicode and line endings (width=${width})`, async () => {
  const input = '\uFEFF<?xml version="1.0"?><r a="a\r\nb">\r\n😀é<x>tail&missing;</r>';
  const signal = new AbortController().signal, fs = createMemoryFileSystem();
  const budget = () => new XmlBudget(resolveXmlQueryLimits(), signal, async () => {});
  const expectedMessages: string[] = [], actualMessages: string[] = [];
  const expected = parseXml(input, { recover: message => expectedMessages.push(message) });
  const source = { async *[Symbol.asyncIterator]() {
    for (let index = 0; index < input.length; index += width) yield input.slice(index, index + width);
  } };
  const document = await StoredXmlDocument.parse(source, { fs, cwd: '/', env: {}, signal }, budget(), 1, message => actualMessages.push(message));
  try {
    let actualOutput = '', expectedOutput = '';
    for await (const chunk of serializeDocument(document, 'format', budget(), false)) actualOutput += chunk;
    for await (const chunk of serializeDocument(expected, 'format', budget(), false)) expectedOutput += chunk;
    assert.equal(actualOutput, expectedOutput);
    assert.deepEqual(actualMessages, expectedMessages);
  } finally { await document.close(); }
  assert.deepEqual(await fs.readdir('/'), []);
});

test('ordinary XML parser ancestry spills independently of document cache size', async () => {
  const fs = createMemoryFileSystem(), signal = new AbortController().signal;
  let writes = 0;
  const injected = new Proxy(fs, { get(target, key) {
    if (key === 'open') return async (...args: Parameters<typeof fs.open>) => {
      const handle = await fs.open(...args);
      return new Proxy(handle, { get(descriptor, member) {
        if (member === 'write') return async (...args: Parameters<typeof handle.write>) => { writes++; return handle.write(...args); };
        const value = Reflect.get(descriptor, member, descriptor);
        return typeof value === 'function' ? value.bind(descriptor) : value;
      } });
    };
    const value = Reflect.get(target, key, target);
    return typeof value === 'function' ? value.bind(target) : value;
  } });
  const source = { async *[Symbol.asyncIterator]() {
    for (let index = 0; index < 600; index++) yield '<x>';
    for (let index = 0; index < 600; index++) yield '</x>';
  } };
  const document = await StoredXmlDocument.parse(source, { fs: injected, cwd: '/', env: {}, signal },
    new XmlBudget(resolveXmlQueryLimits(), signal, async () => {}));
  try { assert.ok(writes > 0, 'small documents with deep ancestry must spill parser state'); }
  finally { await document.close(); }
  assert.deepEqual(await fs.readdir('/'), []);
});
