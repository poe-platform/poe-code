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
  assert.equal(opened, 1);
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
