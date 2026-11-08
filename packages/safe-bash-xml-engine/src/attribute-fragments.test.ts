import assert from "node:assert/strict";
import test from "node:test";
import { createMemoryFileSystem } from "@poe-code/safe-fs";
import { parseXml } from "@poe-code/safe-fs/core";
import { parseStoredXml } from "./recovery.js";
import { StoredXmlDocument } from "./stored-document.js";
import { serializeDocument } from "./document.js";
import { XmlBudget, resolveXmlQueryLimits } from "./limits.js";

for (const recover of [false, true]) test(`large attribute values use bounded parser fragments (recover=${recover})`, async () => {
  const fs = createMemoryFileSystem(), signal = new AbortController().signal;
  const piece = "é😀\t&amp;&#x9;&#xA;&#xD;";
  const input = '<r a="' + piece.repeat(1500) + '"/>';
  const expected = parseXml(input).attributes[0]!.value;
  const source = function* () { yield '<r a="'; for (let i = 0; i < 1500; i++) yield piece; yield '"/>'; };
  let actual = "", fragments = 0;
  await parseStoredXml(source(), { fs, cwd: "/", env: {}, signal }, new XmlBudget(resolveXmlQueryLimits(), signal, async () => {}), recover ? () => {} : undefined, async event => {
    if (event.type !== "attribute") return;
    assert.ok(event.attribute.value.length <= 512, `resident attribute size ${event.attribute.value.length}`);
    assert.equal(event.attribute.name, "a"); actual += event.attribute.value; fragments++;
    await Promise.resolve();
  });
  assert.equal(actual, expected); assert.ok(fragments > 1);
  assert.deepEqual(await fs.readdir("/"), []);
});

for (const mode of ["format", "c14n", "exc-c14n"] as const) test(`stored attribute fragments preserve logical nodes and ${mode}`, async () => {
  const fs = createMemoryFileSystem(), signal = new AbortController().signal;
  const input = '<r xml:space="' + "preserve".repeat(1000) + '" b="' + "é😀&amp;&#x9;".repeat(1500) + '"><x> </x></r>';
  const budget = new XmlBudget(resolveXmlQueryLimits(), signal, async () => {});
  const document = await StoredXmlDocument.parse([input], { fs, cwd: "/", env: {}, signal }, budget, 1);
  try {
    let attributes = 0;
    for await (const reference of document.attributeReferences(document.root)) {
      const metadata = await document.metadata(reference);
      assert.equal(metadata.kind, "attribute");
      if (metadata.kind !== "attribute") assert.fail();
      assert.ok(metadata.value.value.length <= 512);
      attributes++;
    }
    assert.equal(attributes, 2);
    const buffered = parseXml(input);
    const node = await document.node(document.root);
    assert.equal(node.kind, "element");
    if (node.kind !== "element") assert.fail();
    assert.deepEqual(node.attributes, buffered.attributes);
    let actual = "", expected = "";
    for await (const part of serializeDocument(document, mode, budget, true)) actual += part;
    for await (const part of serializeDocument(buffered, mode, budget, true)) expected += part;
    assert.equal(actual, expected);
  } finally { await document.close(); }
  assert.deepEqual(await fs.readdir("/"), []);
});

for (const recover of [false, true]) for (const outcome of ["success", "consumer", "abort", "read", "write"]) test(`attribute fragment spill cleanup (recover=${recover}, outcome=${outcome})`, async () => {
  const fs = createMemoryFileSystem(), controller = new AbortController(), failure = new Error("attribute stopped");
  let writes = 0, reads = 0, active = 0, opened = 0, closed = 0, sourceClosed = false, fragments = 0;
  const injected = new Proxy(fs, { get(target, key) {
    if (key === "readFile") return () => assert.fail("must not read a whole XML payload");
    if (key === "open") return async (...args: Parameters<typeof fs.open>) => {
      const handle = await fs.open(...args); opened++;
      return new Proxy(handle, { get(descriptor, member) {
        if (member === "write") return async (...args: Parameters<typeof handle.write>) => {
          assert.ok(args[0].length <= 16384); assert.equal(++active, 1);
          try { await Promise.resolve(); if (++writes === 2 && outcome === "write") throw failure; return await handle.write(...args); }
          finally { active--; }
        };
        if (member === "read") return async (...args: Parameters<typeof handle.read>) => {
          if (++reads === 2 && outcome === "read") throw failure;
          return handle.read(...args);
        };
        if (member === "close") return async () => { closed++; await handle.close(); };
        const value = Reflect.get(descriptor, member, descriptor);
        return typeof value === "function" ? value.bind(descriptor) : value;
      } });
    };
    const value = Reflect.get(target, key, target);
    return typeof value === "function" ? value.bind(target) : value;
  } });
  const piece = "é😀".repeat(170);
  const source = (function* () { try { yield '<r a="'; for (let i = 0; i < 200; i++) yield piece; yield '"/>'; } finally { sourceClosed = true; } })();
  const operation = parseStoredXml(source, { fs: injected, cwd: "/", env: {}, signal: controller.signal },
    new XmlBudget(resolveXmlQueryLimits(), controller.signal, async () => {}), recover ? () => {} : undefined, async event => {
      if (event.type !== "attribute") return;
      assert.ok(event.attribute.value.length <= 512); fragments++; await Promise.resolve();
      if (fragments === 3 && outcome === "consumer") throw failure;
      if (fragments === 3 && outcome === "abort") controller.abort(failure);
    });
  if (outcome === "success") { await operation; assert.ok(fragments > 100); }
  else await assert.rejects(operation, error => error === failure);
  assert.ok(writes > 0); assert.equal(active, 0); assert.equal(opened, closed); assert.equal(sourceClosed, true);
  assert.deepEqual(await fs.readdir("/"), []);
});

for (const input of ['<r a=""/>', '<r a="&unknown;"/>', '<r a="x&broken"/>', '<r a="&#x20;\t&#9;"/>', '<r a="&#0000000000000000000000000000000097;"/>', '<r a="&#999999999;"/>', '<r a="a<b"/>']) test(`fragmented attributes retain buffered diagnostics: ${input}`, async () => {
  const fs = createMemoryFileSystem(), signal = new AbortController().signal;
  const expectedMessages: string[] = [], actualMessages: string[] = [];
  let expected: ReturnType<typeof parseXml> | undefined, failure: Error | undefined;
  try { expected = parseXml(input, { recover: message => { expectedMessages.push(message); } }); }
  catch (error) { assert.ok(error instanceof Error); failure = error; }
  let actual = "";
  const operation = parseStoredXml([input], { fs, cwd: "/", env: {}, signal }, new XmlBudget(resolveXmlQueryLimits(), signal, async () => {}), message => { actualMessages.push(message); }, async event => {
    if (event.type === "attribute") actual += event.attribute.value;
  });
  if (failure) await assert.rejects(operation, error => error instanceof Error && error.message === failure.message);
  else { await operation; assert.equal(actual, expected!.attributes[0]!.value); }
  assert.deepEqual(actualMessages, expectedMessages);
  assert.deepEqual(await fs.readdir("/"), []);
});
