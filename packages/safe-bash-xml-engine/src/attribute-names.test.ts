import assert from "node:assert/strict";
import test from "node:test";
import { createMemoryFileSystem } from "@poe-code/safe-fs";
import { parseXml } from "@poe-code/safe-fs/core";
import { XmlBudget, resolveXmlQueryLimits } from "./limits.js";
import { StoredXmlDocument } from "./stored-document.js";
import { serializeDocument } from "./document.js";
import { serialize } from "./evaluate.js";
import { StoredXPath } from "./stored-evaluate.js";
import { parseQuery } from "./query.js";
import { storedXmlToJson, xmlToJson } from "./json.js";

for (const prefix of ["", "p:"]) for (const recover of [false, true]) test(`large attribute names stay backed through formatting, XPath and xq (prefix=${prefix}, recover=${recover})`, async () => {
  const fs = createMemoryFileSystem(), signal = new AbortController().signal;
  const localName = "a".repeat(12000), name = prefix + localName;
  const input = `<r ${name}b="two" ${name}="${"one".repeat(600)}" xmlns:p="urn:p"/>`;
  const budget = new XmlBudget(resolveXmlQueryLimits(), signal, async () => {});
  const expected = parseXml(input);
  const document = await StoredXmlDocument.parse([input], { fs, cwd: "/", env: {}, signal }, budget, 1, recover ? () => {} : undefined);
  try {
    assert.ok(JSON.stringify(await document.metadata((await document.attributeReferences(document.root).next()).value!)).length < 1024, "attribute metadata must retain name handles");
    for (const mode of ["format", "c14n", "exc-c14n"] as const) {
      let actual = "", buffered = "";
      for await (const part of serializeDocument(document, mode, budget, true)) { actual += part; await Promise.resolve(); }
      for await (const part of serializeDocument(expected, mode, budget, true)) buffered += part;
      assert.equal(actual, buffered);
    }
    const xpath = new StoredXPath(document, budget);
    assert.equal(await xpath.scalar(await parseQuery("name(/*/@*[2])", budget)), name);
    assert.equal(await xpath.scalar(await parseQuery("local-name(/*/@*[2])", budget)), localName);
    assert.equal(await xpath.scalar(await parseQuery(`count(/*/@${name})`, budget)), "1");
    let json = ""; const decoder = new TextDecoder();
    for await (const part of storedXmlToJson(document, budget)) json += decoder.decode(part, { stream: true });
    json += decoder.decode();
    assert.equal(json, JSON.stringify(await xmlToJson(expected, budget)) + "\n");
    let selected = "";
    for await (const reference of document.attributeReferences(document.root)) {
      const node = await xpath.node(reference);
      for await (const part of serialize(node, budget)) { assert.ok(part.length <= 4096); selected += part; }
    }
    assert.equal(selected, ` ${name}b="two" ${name}="${"one".repeat(600)}" xmlns:p="urn:p"`);
    const buffered = await document.node(document.root);
    assert.equal(buffered.kind, "element");
    if (buffered.kind === "element") { assert.equal(buffered.attributes[1]!.name, name); assert.equal(buffered.attributes[1]!.localName, localName); }
  } finally { await document.close(); }
  assert.deepEqual(await fs.readdir("/"), []);
});


const longName = "a".repeat(600);
for (const input of [
  `<r ${longName}="1" ${longName}="2"/>`,
  `<r p:${longName}="1" q:${longName}="2" xmlns:p="urn:p" xmlns:q="urn:p"/>`,
  `<r p:${longName}="1" q:${longName}b="2" xmlns:p="urn:p" xmlns:q="urn:p"/>`,
  `<r p:${longName}="1"/>`, `<r xmlns:${longName}="urn:p" ${longName}:a="1"/>`,
  `<r ${longName}:1="1"/>`, `<r ${longName}:b:c="1"/>`
]) test(`deferred attribute validation preserves diagnostics: ${input.slice(-30)}`, async () => {
  const fs = createMemoryFileSystem(), signal = new AbortController().signal;
  for (const recover of [false, true]) {
    const messages: string[] = [], actualMessages: string[] = [];
    let expected: Error | undefined;
    try { parseXml(input, recover ? { recover: message => messages.push(message) } : {}); }
    catch (error) { expected = error as Error; }
    const budget = new XmlBudget(resolveXmlQueryLimits(), signal, async () => {});
    const operation = StoredXmlDocument.parse([input], { fs, cwd: "/", env: {}, signal }, budget, 1, recover ? message => actualMessages.push(message) : undefined);
    if (expected) await assert.rejects(operation, error => error instanceof Error && error.message === expected.message);
    else await (await operation).close();
    assert.deepEqual(actualMessages, messages);
  }
  assert.deepEqual(await fs.readdir("/"), []);
});
