import assert from "node:assert/strict";
import test from "node:test";
import { parseXml } from "@poe-code/safe-fs/core";
import { XmlBudget, resolveXmlQueryLimits, XmlQueryLimitError } from "./limits.js";
import { parseQuery } from "./query.js";
import { evaluate, evaluateScalar } from "./evaluate.js";

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

for (const [predicate, expected] of [
  ['@id=1', ['Alpha']], ['@price > 15', ['Beta']],
  ['@price >= 20', ['Beta']], ['@price < 20', ['Alpha']],
  ['@price <= 10.5', ['Alpha']], ['@id != "1"', ['Beta']],
  ['@id="1" or @id="2"', ['Alpha', 'Beta']],
  ['@id="1" or @id="2" and @price<15', ['Alpha']],
  ['(@id="1" or @id="2") and @price>15', ['Beta']],
  ['not(@id="1")', ['Beta']], ['contains(., "Alp")', ['Alpha']],
  ['starts-with(., "Be")', ['Beta']], ['normalize-space(.)="Alpha"', ['Alpha']],
  ['0 = 1 < 2', []], ['@missing != "x"', []], ['@missing < 10', []],
  ['position()=1', ['Alpha']], ['last()', ['Beta']]
] as const) {
  test(`XPath predicate ${predicate}`, async () => {
    const budget = new XmlBudget(resolveXmlQueryLimits(), new AbortController().signal, async () => {});
    const query = await parseQuery(`//item[${predicate}]/text()`, budget);
    const nodes = await evaluate(query, parseXml('<root><item id="1" price="10.5">Alpha</item><item id="2" price="20">Beta</item></root>'), budget);
    assert.deepEqual(nodes.map(node => node.kind === "text" ? node.value.text : ""), expected);
  });
}

test("XPath node-set comparisons are existential and normalize-space uses XML whitespace", async () => {
  const budget = new XmlBudget(resolveXmlQueryLimits(), new AbortController().signal, async () => {});
  const root = parseXml('<root><item><value>1</value><value>2</value><title> A  B </title></item><item><value>2</value></item></root>');
  for (const [predicate, expected] of [['value != 2', 1], ['value = 2', 2], ['normalize-space(title)="A B"', 1], ['not(value = 2)', 0]] as const)
    assert.equal((await evaluate(await parseQuery(`//item[${predicate}]`, budget), root, budget)).length, expected);
});
test("XPath predicate nesting is iterative and obeys configured depth", async () => {
  const source = `//item[${"(".repeat(10000)}@id=1${")".repeat(10000)}]`;
  const budget = new XmlBudget(resolveXmlQueryLimits(), new AbortController().signal, async () => {});
  assert.equal((await evaluate(await parseQuery(source, budget), parseXml('<item id="1"/>'), budget)).length, 1);
  const bounded = new XmlBudget(resolveXmlQueryLimits({maxDepth: 3}), new AbortController().signal, async () => {});
  await assert.rejects(parseQuery(source, bounded), /maxDepth/);
});

test("XPath numeric coercion accepts XML whitespace only", async () => {
  const budget = new XmlBudget(resolveXmlQueryLimits(), new AbortController().signal, async () => {});
  const query = await parseQuery('//item[@n=1]', budget);
  const nodes = await evaluate(query, parseXml('<root><item n="&#160;1"/><item n=" 1 "/></root>'), budget);
  assert.equal(nodes.length, 1);
});

for (const [source, count] of [
  ["/root/@xml:lang", 1], ["/root/@xml:space", 1],
  ["//ns:item", 2], ["//alias:item", 2],
  ["//ns:item[@xml:lang='fr']", 1],
  ["//*[local-name()='item']", 3], ["//item", 0],
  ["//other:item", 1]
] as const) {
  test(`XPath namespace selection ${source}`, async () => {
    const budget = new XmlBudget(resolveXmlQueryLimits(), new AbortController().signal, async () => {});
    const root = parseXml('<root xmlns:ns="urn:x" xmlns:alias="urn:x" xmlns:other="urn:y" xml:lang="en" xml:space="preserve"><ns:item xml:lang="fr"/><alias:item/><other:item/></root>');
    assert.equal((await evaluate(await parseQuery(source, budget), root, budget)).length, count);
  });
}

for (const source of ["//ns:", "//:item", "//ns:item:bad", "//ns::item"]) {
  test(`rejects malformed QName ${source}`, async () => {
    const budget = new XmlBudget(resolveXmlQueryLimits(), new AbortController().signal, async () => {});
    await assert.rejects(parseQuery(source, budget));
  });
}

test("XPath prefixes use root bindings and reject undeclared prefixes", async () => {
  const budget = new XmlBudget(resolveXmlQueryLimits(), new AbortController().signal, async () => {});
  const root = parseXml('<root xmlns:n="urn:one"><n:item/><branch xmlns:n="urn:two"><n:item/></branch></root>');
  assert.equal((await evaluate(await parseQuery("//n:item", budget), root, budget)).length, 1);
  await assert.rejects(evaluate(await parseQuery("//missing:item", budget), root, budget), /undefined XPath namespace prefix/);
});

for (const [source, expected] of [
  ["-1 + 2", "1"], ["-number(/root/@n)", "-10"],
  ["--number(/root/@n)", "10"], ["-(1 + 2) - 3", "-6"],
  ["1-2-3", "-4"], ["1--2", "3"], ["-1 + 2 = 1", "true"],
  ["number(/root/@n)+2", "12"], ["- /root/@n", "-10"],
  ["-number(/root/@missing)", "NaN"], ["-(-2)", "2"],
  ["count(/root/item[-@n + 2 = 1])", "1"],
] as const) {
  test(`XPath arithmetic ${source}`, async () => {
    const budget = new XmlBudget(resolveXmlQueryLimits(), new AbortController().signal, async () => {});
    const root = parseXml('<root n="10"><item n="1"/><item n="2"/></root>');
    assert.equal(await evaluateScalar(await parseQuery(source, budget), root, budget), expected);
  });
}

for (const source of ["-", "1 +", "-(1 +)", "number(1 +)"]) {
  test(`XPath rejects incomplete arithmetic ${source}`, async () => {
    const budget = new XmlBudget(resolveXmlQueryLimits(), new AbortController().signal, async () => {});
    await assert.rejects(parseQuery(source, budget), /unsupported XPath/);
  });
}
