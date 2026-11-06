import assert from "node:assert/strict";
import test from "node:test";
import { createMemoryFileSystem } from "@poe-code/safe-fs";
import { parseXml } from "@poe-code/safe-fs/core";
import { evaluateScalar } from "./evaluate.js";
import { XmlBudget, resolveXmlQueryLimits } from "./limits.js";
import { parseQuery } from "./query.js";
import { StoredXmlDocument } from "./stored-document.js";
import { StoredXPath } from "./stored-evaluate.js";

const input = '<catalog xmlns:p="urn:p" xmlns:q="urn:p" xml:lang="en-US"><item id="a" xml:id="first" p:a="x"><p:n/><q:n/></item><item id="b" xml:lang="fr"/><item id="c"/><other xmlns:p="urn:other" p:a="y"><p:n/></other></catalog>';
for (const [source, expected] of [
  ['count(//@xml:*)', '3'],
  ['count(//attribute::xml:*)', '3'],
  ['count(//item[@xml:*])', '2'],
  ['count(//@xml:*[local-name()="lang"])', '2'],
  ['count(//@p:*)', '1'],
  ['count(//p:*)', '2'],
  ['count(//@*)', '8'],
  ['count(//@xml:lang)', '2'],
  ['count(//xml:*)', '0'],
] as const) test(`namespace wildcard matches expanded names: ${source}`, async () => {
  const signal = new AbortController().signal;
  const budget = new XmlBudget(resolveXmlQueryLimits(), signal, async () => {});
  const query = await parseQuery(source, budget);
  assert.equal(await evaluateScalar(query, parseXml(input), budget), expected);
  const document = await StoredXmlDocument.parse([input], { fs: createMemoryFileSystem(), cwd: "/", env: {}, signal }, budget, 1);
  try {
    assert.equal(await new StoredXPath(document, budget).scalar(query), expected);
  } finally { await document.close(); }
});

test("namespace wildcards still reject undefined prefixes", async () => {
  const signal = new AbortController().signal;
  const budget = new XmlBudget(resolveXmlQueryLimits(), signal, async () => {});
  const query = await parseQuery('count(//@missing:*)', budget);
  await assert.rejects(evaluateScalar(query, parseXml(input), budget), /undefined XPath namespace prefix/);
  const document = await StoredXmlDocument.parse([input], { fs: createMemoryFileSystem(), cwd: "/", env: {}, signal }, budget, 1);
  try {
    await assert.rejects(new StoredXPath(document, budget).scalar(query), /undefined XPath namespace prefix/);
  } finally { await document.close(); }
});
