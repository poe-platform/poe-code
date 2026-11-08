import assert from "node:assert/strict";
import test from "node:test";
import { createMemoryFileSystem } from "@poe-code/safe-fs";
import { parseXml } from "@poe-code/safe-fs/core";
import { evaluateScalar } from "./evaluate.js";
import { XmlBudget, resolveXmlQueryLimits } from "./limits.js";
import { parseQuery } from "./query.js";
import { StoredXmlDocument } from "./stored-document.js";
import { StoredXPath } from "./stored-evaluate.js";

const xml = '<r><item id="a"><n>A</n></item><item id="b"><n>B</n></item><item id="c"><n>C</n></item></r>';
for (const [query, expected] of [
  ['count(/child::r/child::item)', '3'],
  ['count(//n/ancestor::*)', '4'],
  ['count(//n/ancestor-or-self::*)', '7'],
  ['count(//n/ancestor::node())', '5'],
  ['count(//n/parent::item)', '3'],
  ['count(//n/parent::missing)', '0'],
  ['count(//item/self::item)', '3'],
  ['count(//item/self::missing)', '0'],
  ['count(/r/descendant::*)', '6'],
  ['count(/r/descendant-or-self::*)', '7'],
  ['count(//item/attribute::id)', '3'],
  ['count(//item[preceding-sibling::*])', '2'],
  ['string(//item[3]/preceding-sibling::*[1]/@id)', 'b'],
  ['string(//item[3]/preceding-sibling::*[last()]/@id)', 'a'],
  ['string(//item[3]/preceding-sibling::*[position()=1]/@id)', 'b'],
  ['string(//item[3]/preceding-sibling::*[position()>0][1]/@id)', 'b'],
  ['string((//item[3]/preceding-sibling::*)[1])', 'A'],
  ['string(//item[1]/following-sibling::*[1]/@id)', 'b'],
  ['string(//item[3]/preceding::item[1]/@id)', 'b'],
  ['string(//item[1]/following::item[1]/@id)', 'b'],
  ['count(//item[1]/following::n)', '2'],
  ['count(//item[3]/n/preceding::*)', '4'],
  ['name(//n/ancestor::*[1])', 'item'],
  ['name(//n/ancestor::*[last()])', 'r'],
  ['count(//item/@id/parent::item)', '3'],
  ['count(//item/@id/following-sibling::*)', '0'],
  ['count(//item[1]/@id/following::n)', '2'],
  ['count(//item[3]/@id/preceding::*)', '4'],
  ['count(/r/child::node())', '3'],
  ['count(//n/child::text())', '3'],
  ['count(//item/preceding-sibling::* | //item/following-sibling::*)', '3'],
] as const) test(`XPath tree axes: ${query}`, async () => {
  const signal = new AbortController().signal;
  const budget = new XmlBudget(resolveXmlQueryLimits(), signal, async () => {});
  const parsed = await parseQuery(query, budget);
  assert.equal(await evaluateScalar(parsed, parseXml(xml), budget), expected);
  const document = await StoredXmlDocument.parse([xml], { fs: createMemoryFileSystem(), cwd: "/", env: {}, signal }, budget, 1);
  try {
    assert.equal(await new StoredXPath(document, budget).scalar(parsed), expected);
  } finally { await document.close(); }
});

test("reverse-axis predicates retain proximity positions after selections spill", async () => {
  const signal = new AbortController().signal;
  const budget = new XmlBudget(resolveXmlQueryLimits(), signal, async () => {});
  const input = '<r>' + Array.from({ length: 160 }, (_, index) => `<n>${index}</n>`).join('') + '</r>';
  const document = await StoredXmlDocument.parse([input], { fs: createMemoryFileSystem(), cwd: "/", env: {}, signal }, budget, 1);
  try {
    for (const [query, expected] of [
      ['string(/r/n[160]/preceding-sibling::n[position() <= 2][last()])', '157'],
      ['string((/r/n[160]/preceding-sibling::n)[1])', '0'],
      ['count(/r/n[160]/preceding::node())', '318'],
    ] as const) {
      const parsed = await parseQuery(query, budget);
      assert.equal(await evaluateScalar(parsed, parseXml(input), budget), expected);
      assert.equal(await new StoredXPath(document, budget).scalar(parsed), expected);
    }
  } finally { await document.close(); }
});
