import assert from "node:assert/strict";
import test from "node:test";
import { createMemoryFileSystem } from "@poe-code/safe-fs";
import { parseXml } from "@poe-code/safe-fs/core";
import { xmlToJson, storedXmlToJson } from "./json.js";
import { XmlBudget, resolveXmlQueryLimits } from "./limits.js";
import { StoredXmlDocument } from "./stored-document.js";

for (const input of [
  '<r/>', '<r> \t\n </r>', '<r>  a<![CDATA[b]]> c  </r>',
  '<r a="1"><x>first</x><y/><x>second</x><z/><x a="last"/> tail </r>',
  '<r xmlns:p="urn:p"><p:x a="&quot;&amp;">é😀</p:x><p:x/><x>\u00a0 text \ufeff</x></r>',
  '<r><__proto__>a</__proto__><constructor>b</constructor><__proto__>c</__proto__></r>',
  '<!--before--><r><!--note--><?inside ok?><x/> text <![CDATA[ more ]]></r><?after ok?>',
  '<r>' + '<x>'.repeat(150) + 'text' + '</x>'.repeat(150) + '</r>',
]) test(`stored XML JSON conversion preserves ${input.slice(0, 70)}`, async () => {
  const signal = new AbortController().signal, budget = new XmlBudget(resolveXmlQueryLimits(), signal, async () => {});
  const document = await StoredXmlDocument.parse([input], { fs: createMemoryFileSystem(), cwd: "/", env: {}, signal }, budget, 1);
  try {
    let actual = "";
    for await (const bytes of storedXmlToJson(document, budget)) { assert.ok(bytes.length <= 16384); await Promise.resolve(); actual += new TextDecoder().decode(bytes); }
    assert.equal(actual, JSON.stringify(await xmlToJson(parseXml(input), budget)) + "\n");
  } finally { await document.close(); }
});

for (const cancel of [false, true]) test(`XML JSON grouping spills beyond its bounded index cache (cancel=${cancel})`, async () => {
  const fs = createMemoryFileSystem(), controller = new AbortController(), failure = new Error("consumer stopped");
  let writes = 0, active = 0, closed = 0, opened = 0;
  const injected = new Proxy(fs, { get(target, key) {
    if (key === "open") return async (...args: Parameters<typeof fs.open>) => {
      const handle = await fs.open(...args); opened++;
      return new Proxy(handle, { get(descriptor, member) {
        if (member === "write") return async (...args: Parameters<typeof handle.write>) => {
          assert.ok(args[0].length <= 16384); assert.equal(++active, 1);
          try { await Promise.resolve(); writes++; return await handle.write(...args); } finally { active--; }
        };
        if (member === "close") return async () => { closed++; await handle.close(); };
        const value = Reflect.get(descriptor, member, descriptor);
        return typeof value === "function" ? value.bind(descriptor) : value;
      } });
    };
    const value = Reflect.get(target, key, target);
    return typeof value === "function" ? value.bind(target) : value;
  } });
  const budget = new XmlBudget(resolveXmlQueryLimits(), controller.signal, async () => {});
  const document = await StoredXmlDocument.parse((function* () {
    yield '<r>';
    for (let pass = 0; pass < 2; pass++) for (let index = 0; index < 150; index++) yield `<n${index}>${pass}</n${index}>`;
    yield '</r>';
  })(), { fs: injected, cwd: "/", env: {}, signal: controller.signal }, budget, 1);
  const before = writes;
  let actual = "";
  const consume = async () => {
    for await (const bytes of storedXmlToJson(document, budget)) {
      await Promise.resolve(); actual += new TextDecoder().decode(bytes);
      if (cancel) controller.abort(failure);
    }
  };
  try {
    if (cancel) await assert.rejects(consume, error => error === failure);
    else {
      await consume(); const value = JSON.parse(actual);
      assert.equal(Object.keys(value.r).length, 150);
      for (let index = 0; index < 150; index++) assert.deepEqual(value.r[`n${index}`], ['0', '1']);
    }
    assert.ok(writes > before + 10, "grouping state must reach injected storage");
  } finally { await document.close(); }
  assert.equal(active, 0); assert.ok(opened >= 1 && opened <= 3); assert.equal(closed, opened); assert.deepEqual(await fs.readdir('/'), []);
});
