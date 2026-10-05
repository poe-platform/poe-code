import assert from "node:assert/strict";
import test from "node:test";
import { createMemoryFileSystem } from "@poe-code/safe-fs";
import { parseXml } from "@poe-code/safe-fs/core";
import { evaluate, evaluateScalar, serialize } from "./evaluate.js";
import { XmlBudget, resolveXmlQueryLimits } from "./limits.js";
import { parseQuery } from "./query.js";
import { StoredXmlDocument } from "./stored-document.js";
import { StoredXPath } from "./stored-evaluate.js";

const input = '<r xmlns:p="urn:p" xml:lang="en"><x id="1"><n>10</n><n>20</n>é<![CDATA[😀]]></x><x id="2"><n>30</n><p:z/></x><empty/></r>';
for (const source of [
  '.', '/r', '//x', '//x/@id | //x/n', '//x/n/..', '//x/../x', '//x/n/../@id',
  '//x[n=20]', '//x[n != 10]', '//x[n = /r/x[2]/n]', '//x[n > /r/x[1]/n]',
  '//x[n][last()]', '//x/n[position() = last()]', '//x/n[1]', '//x/@id[1]',
  'count(//x/n | /r/x[1]/n)', 'sum(//n)', 'string(/r/x[1])', 'boolean(//missing)',
  'count(//x//n)', 'count(/r/x/..)', 'name(//p:z)',
  'namespace-uri(//p:z)', 'name(/r/@xml:lang)', 'concat(//x[1]/@id, ":", //x[2]/@id)',
  'count(//x[@id = 2])', 'count(//x[n = true()])', 'count(//x[n = false()])',
  'substring(string(/r/x[1]), 3, 4)', 'translate(string(/r/x[1]), "é😀", "ab")',
]) test(`paged XPath preserves ${source}`, async () => {
  const signal = new AbortController().signal;
  const budget = new XmlBudget(resolveXmlQueryLimits(), signal, async () => {});
  const query = await parseQuery(source, budget);
  const document = await StoredXmlDocument.parse([input], { fs: createMemoryFileSystem(), cwd: "/", env: {}, signal }, budget, 1);
  try {
    const evaluator = new StoredXPath(document, budget);
    if (query.expression) assert.equal(await evaluator.scalar(query), await evaluateScalar(query, parseXml(input), budget));
    else {
      let expected = "", actual = "";
      for (const node of await evaluate(query, parseXml(input), budget)) {
        for await (const part of serialize(node, budget)) expected += part;
        expected += "\n";
      }
      const selected = await evaluator.select(query);
      for await (const node of selected.nodes()) {
        for await (const part of serialize(node, budget)) actual += part;
        actual += "\n";
      }
      assert.equal(actual, expected);
    }
  } finally { await document.close(); }
});

test("paged XPath selections replay document order and deduplicate beyond the fixed cache", async () => {
  const fs = createMemoryFileSystem(), signal = new AbortController().signal;
  const budget = new XmlBudget(resolveXmlQueryLimits(), signal, async () => {});
  let writes = 0, active = 0;
  const injected = new Proxy(fs, { get(target, key) {
    if (key === "open") return async (...args: Parameters<typeof fs.open>) => {
      const descriptor = await fs.open(...args);
      return new Proxy(descriptor, { get(handle, member) {
        if (member === "write") return async (...args: Parameters<typeof descriptor.write>) => {
          assert.ok(args[0].byteLength <= 16384);
          assert.equal(++active, 1);
          try { await Promise.resolve(); writes++; return await descriptor.write(...args); }
          finally { active--; }
        };
        const value = Reflect.get(handle, member, handle);
        return typeof value === "function" ? value.bind(handle) : value;
      } });
    };
    const value = Reflect.get(target, key, target);
    return typeof value === "function" ? value.bind(target) : value;
  } });
  const document = await StoredXmlDocument.parse((function* () {
    yield '<r>';
    for (let index = 0; index < 160; index++) yield `<x id="${index}"><n>${index}</n></x>`;
    yield '</r>';
  })(), { fs: injected, cwd: "/", env: {}, signal }, budget, 1);
  try {
    const before = writes;
    const evaluator = new StoredXPath(document, budget);
    const selected = await evaluator.select(await parseQuery('//x/@id | //x/@id | /r/x/n/../@id', budget));
    assert.equal(selected.size, 160);
    for (let replay = 0; replay < 2; replay++) {
      let index = 0;
      for await (const node of selected.nodes()) {
        assert.equal(node.kind, "attribute");
        if (node.kind !== "attribute") assert.fail();
        assert.equal(node.value.value, String(index++));
        await Promise.resolve();
      }
      assert.equal(index, 160);
    }
    assert.ok(writes > before, "query selections must spill through the injected store");
    assert.equal(await evaluator.scalar(await parseQuery('sum(//n)', budget)), '12720');
    assert.equal(await evaluator.scalar(await parseQuery('count(/r/x[position() > 150][last()]/@id)', budget)), '1');
  } finally { await document.close(); }
  assert.equal(active, 0);
  assert.deepEqual(await fs.readdir('/'), []);
});

for (const cancellation of [false, true]) test(`stored XPath retires backing after a query read fails (cancellation=${cancellation})`, async () => {
  const fs = createMemoryFileSystem(), controller = new AbortController(), failure = new Error("query read failed");
  let fail = false, closed = 0, opened = 0;
  const injected = new Proxy(fs, { get(target, key) {
    if (key === "open") return async (...args: Parameters<typeof fs.open>) => {
      const descriptor = await fs.open(...args); opened++;
      return new Proxy(descriptor, { get(handle, member) {
        if (member === "read") return async (...args: Parameters<typeof descriptor.read>) => {
          if (fail) {
            if (cancellation) controller.abort(failure);
            throw failure;
          }
          return descriptor.read(...args);
        };
        if (member === "close") return async (...args: Parameters<typeof descriptor.close>) => { closed++; return descriptor.close(...args); };
        const value = Reflect.get(handle, member, handle);
        return typeof value === "function" ? value.bind(handle) : value;
      } });
    };
    const value = Reflect.get(target, key, target);
    return typeof value === "function" ? value.bind(target) : value;
  } });
  const budget = new XmlBudget(resolveXmlQueryLimits(), controller.signal, async () => {});
  const document = await StoredXmlDocument.parse((function* () {
    yield '<r>';
    for (let index = 0; index < 160; index++) yield '<x id="1">value</x>';
    yield '</r>';
  })(), { fs: injected, cwd: "/", env: {}, signal: controller.signal }, budget, 1);
  const query = await parseQuery('count(//x)', budget);
  fail = true;
  try { await assert.rejects(new StoredXPath(document, budget).scalar(query), error => error === failure); }
  finally { await document.close(); }
  assert.ok(opened >= 1 && opened <= 3); assert.equal(closed, opened);
  assert.deepEqual(await fs.readdir('/'), []);
});

test("stored scalar functions replay paged strings across expression operations", async () => {
  const signal = new AbortController().signal;
  const budget = new XmlBudget(resolveXmlQueryLimits(), signal, async () => {});
  const document = await StoredXmlDocument.parse((function* () {
    yield '<r><a>';
    for (let index = 0; index < 50; index++) yield '<![CDATA[  ab😀  ]]>';
    for (let index = 0; index < 50; index++) yield '<![CDATA[' + 'x'.repeat(100) + ']]>';
    yield '</a><b>abab😀</b><n>1';
    for (let index = 0; index < 50; index++) yield '<![CDATA[' + '0'.repeat(100) + ']]>';
    yield 'e-5000</n></r>';
  })(), { fs: createMemoryFileSystem(), cwd: '/', env: {}, signal }, budget, 1);
  try {
    const evaluator = new StoredXPath(document, budget);
    const source = '  ab😀  '.repeat(50) + 'x'.repeat(5000);
    for (const [query, expected] of [
      ['string(/r/a)', source],
      ['string-length(/r/a)', String([...source].length)],
      ['concat(/r/a, ":", /r/b)', source + ':abab😀'],
      ['substring(/r/a, 349, 6)', [...source].slice(348, 354).join('')],
      ['substring-before(/r/a, "😀")', '  ab'],
      ['substring-after(/r/a, "😀")', source.slice(source.indexOf('😀') + 2)],
      ['normalize-space(/r/a)', 'ab😀 '.repeat(50) + 'x'.repeat(5000)],
      ['translate(/r/a, "abx😀", "BA")', '  BA  '.repeat(50)],
      ['contains(/r/a, /r/b)', 'false'],
      ['starts-with(/r/a, "  ab😀")', 'true'],
      ['number(/r/n)', '1'],
      ['sum(/r/n)', '1'],
      ['boolean(string(/r/a))', 'true'],
      ['string(/r/a) = concat(/r/a, "")', 'true'],
      ['string(/r/a) != concat(/r/a, "")', 'false'],
    ]) {
      let actual = '';
      for await (const part of evaluator.scalarChunks(await parseQuery(query!, budget))) {
        assert.ok(part.length <= 8192);
        actual += part;
        await Promise.resolve();
      }
      assert.equal(actual, expected, query);
    }
  } finally { await document.close(); }
});


test("paged XPath streams large attribute values through scalar and node results", async () => {
  const input = '<r a="' + 'é😀&amp;&#x9;'.repeat(1000) + '"/>';
  const fs = createMemoryFileSystem(), signal = new AbortController().signal;
  const budget = new XmlBudget(resolveXmlQueryLimits(), signal, async () => {});
  const document = await StoredXmlDocument.parse([input], { fs, cwd: "/", env: {}, signal }, budget, 1);
  try {
    const evaluator = new StoredXPath(document, budget), buffered = parseXml(input);
    for (const expression of ['count(/r/@a)', 'string-length(/r/@a)', 'contains(/r/@a, "😀&")', 'substring(/r/@a, 511, 10)', 'string(/r/@a)', '/r/@a', '/r']) {
      const query = await parseQuery(expression, budget);
      if (query.expression) assert.equal(await evaluator.scalar(query), await evaluateScalar(query, buffered, budget), expression);
      else {
        let actual = "", expected = "";
        for await (const node of (await evaluator.select(query)).nodes()) for await (const part of serialize(node, budget)) actual += part;
        for (const node of await evaluate(query, buffered, budget)) for await (const part of serialize(node, budget)) expected += part;
        assert.equal(actual, expected, expression);
      }
    }
  } finally { await document.close(); }
  assert.deepEqual(await fs.readdir("/"), []);
});
