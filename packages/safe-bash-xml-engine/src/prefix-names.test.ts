import assert from "node:assert/strict";
import test from "node:test";
import { createMemoryFileSystem } from "@poe-code/safe-fs";
import { parseXml } from "@poe-code/safe-fs/core";
import { XmlBudget, resolveXmlQueryLimits } from "./limits.js";
import { StoredXmlDocument } from "./stored-document.js";
import { serializeDocument } from "./document.js";
import { parseStoredXml } from "./recovery.js";
import { StoredStringMap } from "./stored-map.js";
import { serialize } from "./evaluate.js";
import { StoredXPath } from "./stored-evaluate.js";
import { parseQuery } from "./query.js";
import { storedXmlToJson, xmlToJson } from "./json.js";

for (const prefix of ["p".repeat(12000) + ":"]) for (const recover of [false, true]) test(`large namespace prefixes stay backed through formatting, XPath and xq (prefixLength=${prefix.length}, recover=${recover})`, async () => {
  const fs = createMemoryFileSystem(), signal = new AbortController().signal;
  const localName = "a".repeat(12000), name = prefix + localName;
  const input = `<${name} ${prefix}attr="value" xmlns:${prefix.slice(0,-1)}="urn:p"><${name}>one</${name}><${name}>two</${name}><${name}b/></${name}>`;
  const budget = new XmlBudget(resolveXmlQueryLimits(), signal, async () => {});
  const expected = parseXml(input);
  const document = await StoredXmlDocument.parse([input], { fs, cwd: "/", env: {}, signal }, budget, 1, recover ? () => {} : undefined);
  const references = StoredStringMap.prototype.references;
  try {
    assert.ok(JSON.stringify(await document.metadata(document.root)).length < 1024, "element metadata must retain name handles");
    for await (const reference of document.attributeReferences(document.root))
      assert.ok(JSON.stringify(await document.metadata(reference)).length < 1024, "attribute metadata must retain prefix handles");
    StoredStringMap.prototype.references = () => { throw new Error("buffered namespace keys"); };
    for (const mode of ["format", "c14n", "exc-c14n"] as const) {
      let actual = "", buffered = "";
      for await (const part of serializeDocument(document, mode, budget, true)) { actual += part; await Promise.resolve(); }
      for await (const part of serializeDocument(expected, mode, budget, true)) buffered += part;
      assert.equal(actual, buffered);
    }
    StoredStringMap.prototype.references = references;
    const xpath = new StoredXPath(document, budget);
    assert.equal(await xpath.scalar(await parseQuery("name(/*)", budget)), name);
    assert.equal(await xpath.scalar(await parseQuery("local-name(/*)", budget)), localName);
    assert.equal(await xpath.scalar(await parseQuery(`count(//${name})`, budget)), "3");
    let json = ""; const decoder = new TextDecoder();
    for await (const part of storedXmlToJson(document, budget)) json += decoder.decode(part, { stream: true });
    json += decoder.decode();
    assert.equal(json, JSON.stringify(await xmlToJson(expected, budget)) + "\n");
    let selection = "";
    for await (const part of serialize(await xpath.node(document.root), budget)) selection += part;
    assert.equal(selection, input);
    const buffered = await document.node(document.root);
    assert.equal(buffered.kind, "element");
    if (buffered.kind === "element") { assert.equal(buffered.name, name); assert.equal(buffered.localName, localName); }
  } finally { StoredStringMap.prototype.references = references; await document.close(); }
  assert.deepEqual(await fs.readdir("/"), []);
});


const prefix = "p".repeat(600);
for (const input of [
  `<${prefix}:r/>`, `<r ${prefix}:a="1"/>`,
  `<r xmlns:${prefix}=""/>`, `<r xmlns:${prefix}="http://www.w3.org/XML/1998/namespace"/>`,
  `<r xmlns:${prefix}="urn:p" xmlns:${prefix}="urn:q"/>`,
  `<r ${prefix}:a="1" q:a="2" xmlns:q="urn:p" xmlns:${prefix}="urn:p"/>`,
  `<${prefix}:r xmlns:${prefix}="urn:p"><${prefix}:x xmlns:${prefix}="urn:q"/><${prefix}:x/></${prefix}:r>`,
  `<${prefix}:r xmlns:${prefix}="urn:p"><${prefix}:x xmlns:${prefix}="urn:q"></${prefix}:x></${prefix}:r>`
]) test(`long-prefix namespace validation matches buffered diagnostics: ${input.slice(-25)}`, async () => {
  const fs = createMemoryFileSystem(), signal = new AbortController().signal;
  for (const recover of [false, true]) {
    const expectedMessages: string[] = [], actualMessages: string[] = [];
    let expected: Error | undefined;
    try { parseXml(input, recover ? { recover: message => expectedMessages.push(message) } : {}); }
    catch (error) { expected = error as Error; }
    const budget = new XmlBudget(resolveXmlQueryLimits(), signal, async () => {});
    const operation = StoredXmlDocument.parse([input], { fs, cwd: "/", env: {}, signal }, budget, 1, recover ? message => actualMessages.push(message) : undefined);
    if (expected) await assert.rejects(operation, error => error instanceof Error && error.message === expected.message);
    else await (await operation).close();
    assert.deepEqual(actualMessages, expectedMessages);
  }
  assert.deepEqual(await fs.readdir("/"), []);
});

for (const recover of [false, true]) test(`parser prefix events retain bounded spans (recover=${recover})`, async () => {
  const fs = createMemoryFileSystem(), signal = new AbortController().signal;
  const injected = new Proxy(fs, { get(target, key) {
    if (key === "readFile") return () => assert.fail("payload-wide readFile");
    if (key === "open") return async (...args: Parameters<typeof fs.open>) => {
      const handle = await fs.open(...args);
      return new Proxy(handle, { get(descriptor, member) {
        if (member === "read" || member === "write") return async (...values: Parameters<typeof handle.read>) => {
          assert.ok(values[0].byteLength <= 16384);
          await Promise.resolve();
          return member === "read" ? handle.read(...values) : handle.write(...values);
        };
        const value = Reflect.get(descriptor, member, descriptor);
        return typeof value === "function" ? value.bind(descriptor) : value;
      } });
    };
    const value = Reflect.get(target, key, target);
    return typeof value === "function" ? value.bind(target) : value;
  } });
  const piece = "p".repeat(511) + "𐀀";
  const source = (function* () {
    yield "<"; for (let i = 0; i < 100; i++) yield piece;
    yield ':r xmlns:'; for (let i = 0; i < 100; i++) yield piece;
    yield '="urn:p"><x/></'; for (let i = 0; i < 100; i++) yield piece;
    yield ':r>';
  })();
  const budget = new XmlBudget(resolveXmlQueryLimits(), signal, async () => {});
  let prefixes = 0;
  await parseStoredXml(source, { fs: injected, cwd: "/", env: {}, signal }, budget, recover ? () => {} : undefined,
    async (event, _namespaceParts, sourceParts) => {
      assert.ok(JSON.stringify(event).length < 2048, "parser events must contain compact name spans");
      if (event.type !== "open" || !event.element.prefixSource) return;
      let length = 0;
      for await (const part of sourceParts(event.element.prefixSource)) {
        assert.ok(part.length <= 512); length += part.length; await Promise.resolve();
      }
      assert.equal(length, piece.length * 100); prefixes++;
    }, { deferNamespaces: true, deferElementNames: true, deferAttributeNames: true });
  assert.equal(prefixes, 1);
  assert.deepEqual(await fs.readdir("/"), []);
});
