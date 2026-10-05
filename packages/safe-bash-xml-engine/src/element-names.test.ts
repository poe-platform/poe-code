import assert from "node:assert/strict";
import test from "node:test";
import { createMemoryFileSystem } from "@poe-code/safe-fs";
import { parseXml } from "@poe-code/safe-fs/core";
import { XmlBudget, resolveXmlQueryLimits } from "./limits.js";
import { StoredXmlDocument } from "./stored-document.js";
import { serializeDocument } from "./document.js";
import { StoredXPath } from "./stored-evaluate.js";
import { parseQuery } from "./query.js";
import { storedXmlToJson, xmlToJson } from "./json.js";

for (const prefix of ["", "p:"]) for (const recover of [false, true]) test(`large element names stay backed through formatting, XPath and xq (prefix=${prefix}, recover=${recover})`, async () => {
  const fs = createMemoryFileSystem(), signal = new AbortController().signal;
  const localName = "a".repeat(12000), name = prefix + localName;
  const input = `<${name} xmlns:p="urn:p"><${name}>one</${name}><${name}>two</${name}><${name}b/></${name}>`;
  const budget = new XmlBudget(resolveXmlQueryLimits(), signal, async () => {});
  const expected = parseXml(input);
  const document = await StoredXmlDocument.parse([input], { fs, cwd: "/", env: {}, signal }, budget, 1, recover ? () => {} : undefined);
  try {
    assert.ok(JSON.stringify(await document.metadata(document.root)).length < 1024, "element metadata must retain name handles");
    for (const mode of ["format", "c14n", "exc-c14n"] as const) {
      let actual = "", buffered = "";
      for await (const part of serializeDocument(document, mode, budget, true)) { actual += part; await Promise.resolve(); }
      for await (const part of serializeDocument(expected, mode, budget, true)) buffered += part;
      assert.equal(actual, buffered);
    }
    const xpath = new StoredXPath(document, budget);
    assert.equal(await xpath.scalar(await parseQuery("name(/*)", budget)), name);
    assert.equal(await xpath.scalar(await parseQuery("local-name(/*)", budget)), localName);
    assert.equal(await xpath.scalar(await parseQuery(`count(//${name})`, budget)), "3");
    let json = ""; const decoder = new TextDecoder();
    for await (const part of storedXmlToJson(document, budget)) json += decoder.decode(part, { stream: true });
    json += decoder.decode();
    assert.equal(json, JSON.stringify(await xmlToJson(expected, budget)) + "\n");
    const buffered = await document.node(document.root);
    assert.equal(buffered.kind, "element");
    if (buffered.kind === "element") { assert.equal(buffered.name, name); assert.equal(buffered.localName, localName); }
  } finally { await document.close(); }
  assert.deepEqual(await fs.readdir("/"), []);
});

const longName = "a".repeat(600);
for (const input of [
  `<${longName}></${longName}>`, `<${longName}></${longName.slice(0, -1)}b>`,
  `<${longName}></x>`, `<x></${longName}>`, `<${longName}:x xmlns:${longName}="urn:p"/>`,
  `<xmlns:${longName}/>`, `<p:${longName}/>`, `<p:${longName} xmlns:p="urn:p"/>`,
  `<${longName}:1/>`, `<${longName}:b:c/>`, `<${longName}><x/>`
]) test(`deferred element validation preserves buffered diagnostics: ${input.slice(0, 5)}...${input.slice(-15)}`, async () => {
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
