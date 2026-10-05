import assert from "node:assert/strict";
import test from "node:test";
import { createMemoryFileSystem } from "@poe-code/safe-fs";
import { parseXml, type XmlAttribute } from "@poe-code/safe-fs/core";
import { XmlBudget, resolveXmlQueryLimits } from "./limits.js";
import { parseStoredXml } from "./recovery.js";

for (const recover of [false, true]) for (const count of [1, 200]) test(`stored parser emits attributes without an aggregate collection (recover=${recover}, count=${count})`, async () => {
  const fs = createMemoryFileSystem(), signal = new AbortController().signal;
  const budget = new XmlBudget(resolveXmlQueryLimits(), signal, async () => {});
  const parts = ['<r p:first="&amp;"', ...Array.from({ length: count }, (_, index) => ` a${index}="v${index}"`), ' xmlns:p="urn:p"/>'];
  const expected = parseXml(parts.join("")).attributes;
  const actual: XmlAttribute[] = [];
  let opened = false, closed = false;
  const root = await parseStoredXml(parts, { fs, cwd: "/", env: {}, signal }, budget, recover ? () => {} : undefined, async event => {
    if (event.type === "open") { opened = true; assert.equal(event.element.attributes.length, 0); }
    if (event.type === "attribute") { assert.equal(opened, true); assert.equal(closed, false); await Promise.resolve(); actual.push(event.attribute); }
    if (event.type === "close") { closed = true; assert.equal(event.element.attributes.length, 0); }
  });
  assert.equal(closed, true); assert.equal(root.attributes.length, 0);
  assert.deepEqual(actual, expected);
  assert.deepEqual(await fs.readdir("/"), []);
});

for (const input of ['<r a="old" a="new"/>', '<r p:a="1" q:a="2" xmlns:p="urn:x" xmlns:q="urn:x"/>', '<r p:a="1"/>', '<r a="&unknown;"/>', '<r a="1"']) test(`stored attribute recovery preserves buffered diagnostics: ${input}`, async () => {
  const expectedMessages: string[] = [], actualMessages: string[] = [];
  let expected: ReturnType<typeof parseXml> | undefined, failure: Error | undefined;
  try { expected = parseXml(input, { recover: message => { expectedMessages.push(message); } }); }
  catch (error) { assert.ok(error instanceof Error); failure = error; }
  const fs = createMemoryFileSystem(), signal = new AbortController().signal;
  const actual: XmlAttribute[] = [];
  const operation = parseStoredXml([input], { fs, cwd: "/", env: {}, signal }, new XmlBudget(resolveXmlQueryLimits(), signal, async () => {}), message => { actualMessages.push(message); }, async event => {
    if (event.type === "attribute") actual.push(event.attribute);
  });
  if (failure) { await assert.rejects(operation, error => error instanceof Error && error.message === failure.message); assert.deepEqual(actual, []); }
  else { await operation; assert.deepEqual(actual, expected!.attributes); }
  assert.deepEqual(actualMessages, expectedMessages);
  assert.deepEqual(await fs.readdir("/"), []);
});

for (const recover of [false, true]) for (const outcome of ["success", "consumer", "abort", "write"]) test(`parser attribute storage bounds IO and retires it (recover=${recover}, outcome=${outcome})`, async () => {
  const fs = createMemoryFileSystem(), controller = new AbortController(), failure = new Error("attribute processing stopped");
  let writes = 0, active = 0, opened = 0, closed = 0, attributes = 0, sourceClosed = false;
  const injected = new Proxy(fs, { get(target, key) {
    if (key === "readFile") return () => assert.fail("parser must not read a whole payload");
    if (key === "open") return async (...args: Parameters<typeof fs.open>) => {
      const handle = await fs.open(...args); opened++;
      return new Proxy(handle, { get(descriptor, member) {
        if (member === "write") return async (...args: Parameters<typeof handle.write>) => {
          assert.ok(args[0].length <= 16384); assert.equal(++active, 1);
          try { await Promise.resolve(); if (++writes === 2 && outcome === "write") throw failure; return await handle.write(...args); }
          finally { active--; }
        };
        if (member === "close") return async () => { closed++; await handle.close(); };
        const value = Reflect.get(descriptor, member, descriptor);
        return typeof value === "function" ? value.bind(descriptor) : value;
      } });
    };
    const value = Reflect.get(target, key, target);
    return typeof value === "function" ? value.bind(target) : value;
  } });
  const source = (function* () {
    try { yield '<r'; for (let index = 0; index < 200; index++) yield ` a${index}="v${index}"`; yield '/>'; }
    finally { sourceClosed = true; }
  })();
  const operation = parseStoredXml(source, { fs: injected, cwd: "/", env: {}, signal: controller.signal },
    new XmlBudget(resolveXmlQueryLimits(), controller.signal, async () => {}), recover ? () => {} : undefined, async event => {
      if (event.type !== "attribute") return;
      assert.equal(event.attribute.name, `a${attributes}`); attributes++; await Promise.resolve();
      if (attributes === 3 && outcome === "consumer") throw failure;
      if (attributes === 3 && outcome === "abort") controller.abort(failure);
    });
  if (outcome === "success") { await operation; assert.equal(attributes, 200); }
  else await assert.rejects(operation, error => error === failure);
  assert.ok(writes > 0, "attribute state must spill even though the source fits in cache");
  assert.equal(active, 0); assert.equal(sourceClosed, true); assert.equal(closed, opened);
  assert.ok(opened >= 1 && opened <= 2); assert.deepEqual(await fs.readdir("/"), []);
});
