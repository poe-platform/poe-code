import assert from "node:assert/strict";
import test from "node:test";
import { parseXml } from "@poe-code/safe-fs/core";
import { XmlBudget, resolveXmlQueryLimits, XmlQueryLimitError } from "./limits.js";
import { parseQuery } from "./query.js";
import { evaluate } from "./evaluate.js";

test("shared engine evaluates bounded XPath with the canonical XML tree", async () => {
  const budget = new XmlBudget(
    resolveXmlQueryLimits(),
    new AbortController().signal,
    async () => {}
  );
  const query = await parseQuery("/root/item", budget);
  const nodes = await evaluate(query, parseXml("<root><item/><item/></root>"), budget);
  assert.equal(nodes.length, 2);
});

test("query UTF-8 source bytes are admitted independently of character count", async () => {
  const budget = new XmlBudget(
    resolveXmlQueryLimits({ maxSourceBytes: 5 }),
    new AbortController().signal,
    async () => {}
  );
  await assert.rejects(parseQuery("/ééé", budget), XmlQueryLimitError);
});
