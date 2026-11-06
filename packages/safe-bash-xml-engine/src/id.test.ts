import assert from "node:assert/strict";
import test from "node:test";
import { createMemoryFileSystem } from "@poe-code/safe-fs";
import { parseXml } from "@poe-code/safe-fs/core";
import { evaluate, evaluateScalar } from "./evaluate.js";
import { XmlBudget, resolveXmlQueryLimits } from "./limits.js";
import { parseQuery } from "./query.js";
import { StoredXmlDocument } from "./stored-document.js";
import { StoredXPath } from "./stored-evaluate.js";

const input = '<r xml:id="root"><x xml:id="first"/><x xml:id="second"/><ref>second first</ref><ref>first</ref><x id="plain" xmlns:p="urn:p" p:id="other"/></r>';
for (const [source, expected] of [
  ['count(id(//ref))', '2'],
  ['count(//x[id("root")])', '3'],
  ['count(//@*[id("root")])', '5'],
  ['count(id("plain other"))', '0'],
  ['name(id("second root first"))', 'r'],
  ['count(id(true()))', '0'],
  ['count(id(1))', '0'],
  ['count(id("first\u00a0second"))', '0'],
  ['count((id("second first"))[1])', '1'],
] as const) test(`ID lookup in stored and tree evaluators: ${source}`, async () => {
  const signal = new AbortController().signal;
  const budget = new XmlBudget(resolveXmlQueryLimits(), signal, async () => {});
  const query = await parseQuery(source, budget);
  assert.equal(await evaluateScalar(query, parseXml(input), budget), expected);
  const fs = createMemoryFileSystem();
  const document = await StoredXmlDocument.parse([input], { fs, cwd: '/', env: {}, signal }, budget, 1);
  try { assert.equal(await new StoredXPath(document, budget).scalar(query), expected); }
  finally { await document.close(); }
  assert.deepEqual(await fs.readdir('/'), []);
});

test('ID selections retain document order beyond the page cache and enforce result limits', async () => {
  const signal = new AbortController().signal, fs = createMemoryFileSystem();
  const input = '<r>' + Array.from({ length: 150 }, (_, i) => `<x xml:id="id${i}"/>`).join('') + '</r>';
  const ids = Array.from({ length: 150 }, (_, i) => `id${149 - i}`).join(' ');
  const budget = new XmlBudget(resolveXmlQueryLimits(), signal, async () => {});
  const query = await parseQuery(`id("${ids}")`, budget);
  const tree = await evaluate(query, parseXml(input), budget);
  assert.equal(tree.length, 150);
  const document = await StoredXmlDocument.parse([input], { fs, cwd: '/', env: {}, signal }, budget, 1);
  try {
    const selected = await new StoredXPath(document, budget).select(query);
    const actual: string[] = [];
    for await (const node of selected.nodes()) {
      assert.equal(node.kind, 'element');
      for await (const attribute of document.attributes(node.stored!.reference)) actual.push(attribute.value);
    }
    assert.deepEqual(actual, Array.from({ length: 150 }, (_, i) => `id${i}`));
    const limited = new XmlBudget(resolveXmlQueryLimits({ maxResults: 1 }), signal, async () => {});
    await assert.rejects(new StoredXPath(document, limited).select(query), /maxResults/);
    await assert.rejects(evaluate(query, parseXml(input), limited), /maxResults/);
  } finally { await document.close(); }
  assert.deepEqual(await fs.readdir('/'), []);
});
