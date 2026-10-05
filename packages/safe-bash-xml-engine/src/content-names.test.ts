import assert from "node:assert/strict";
import test from "node:test";
import { createMemoryFileSystem } from "@poe-code/safe-fs";
import { parseXml } from "@poe-code/safe-fs/core";
import { XmlBudget, resolveXmlQueryLimits } from "./limits.js";
import { parseStoredXml } from "./recovery.js";
import { StoredXmlDocument } from "./stored-document.js";
import { evaluateExpression, expressionText } from "./predicate.js";
import { parseQuery } from "./query.js";
import { StoredXPath } from "./stored-evaluate.js";
import { StoredStringMap } from "./stored-map.js";
import { serializeDocument } from "./document.js";

for (const recover of [false, true]) test(`large processing-instruction targets use source spans (recover=${recover})`, async () => {
  const fs = createMemoryFileSystem(), signal = new AbortController().signal;
  const piece = "a".repeat(511) + "𐀀", count = 150;
  const source = (function* () { yield "<r><?"; for (let i = 0; i < count; i++) yield piece; yield " data?></r>"; })();
  const budget = new XmlBudget(resolveXmlQueryLimits(), signal, async () => {});
  let target = "", events = 0;
  await parseStoredXml(source, { fs, cwd: "/", env: {}, signal }, budget, recover ? () => {} : undefined, async (event, _namespaces, sourceParts) => {
    if (event.type !== "content" || event.content.kind !== "processing-instruction") return;
    assert.ok(event.content.target.length <= 512, "parser must not emit a complete large target");
    assert.ok(event.content.targetSource);
    for await (const part of sourceParts(event.content.targetSource)) {
      assert.ok(part.length <= 512); target += part; await Promise.resolve();
    }
    events++;
  }, { deferContentNames: true });
  assert.equal(target, piece.repeat(count)); assert.equal(events, 1);
  assert.deepEqual(await fs.readdir("/"), []);
});

for (const mode of ["format", "c14n", "exc-c14n"] as const) test(`backed PI targets preserve ${mode} and buffered nodes`, async () => {
  const fs = createMemoryFileSystem(), signal = new AbortController().signal;
  const target = "p:" + "a".repeat(20000), input = `<?${target} before?><r><?${target} inside?></r><?${target} after?>`;
  const budget = new XmlBudget(resolveXmlQueryLimits(), signal, async () => {});
  let expected = "";
  for await (const part of serializeDocument(parseXml(input), mode, budget, true)) expected += part;
  const document = await StoredXmlDocument.parse([input], { fs, cwd: "/", env: {}, signal }, budget, 1);
  try {
    for await (const reference of document.children(document.document)) {
      const metadata = await document.metadata(reference);
      if (metadata.kind !== "processing-instruction") continue;
      assert.ok(JSON.stringify(metadata).length < 1024, "metadata must contain a target handle");
      const complete = await document.node(reference);
      assert.equal(complete.kind, "processing-instruction");
      if (complete.kind === "processing-instruction") {
        assert.equal(complete.target, target); assert.equal(complete.targetReference, undefined);
      }
      for (const name of ["name", "local-name", "namespace-uri"]) {
        const query = await parseQuery(`${name}()`, budget);
        const result = await evaluateExpression(query.expression!, await new StoredXPath(document, budget).node(reference), 1, 1, budget);
        const value = await expressionText(result, budget, document.storage);
        let actual = ""; for await (const part of value.chunks()) actual += part;
        assert.equal(actual, name === "namespace-uri" ? "" : target);
      }
    }
    let actual = "";
    for await (const part of serializeDocument(document, mode, budget, true)) { actual += part; await Promise.resolve(); }
    assert.equal(actual, expected);
  } finally { await document.close(); }
  assert.deepEqual(await fs.readdir("/"), []);
});

for (const target of ["a".repeat(600), "p:" + "a".repeat(600), "a".repeat(511) + "𐀀z", ":" + "a".repeat(600), "a".repeat(600) + ":", "a".repeat(600) + ":b:c", "a".repeat(600) + ":1", "1" + "a".repeat(600), "a".repeat(600) + "$", "a".repeat(600) + "\u0301"])
  test(`deferred PI validation matches buffered diagnostics: ${target.slice(0, 3)}...${target.slice(-3)}`, async () => {
    const input = `<?${target} data?><r/>`, fs = createMemoryFileSystem(), signal = new AbortController().signal;
    let expected: Error | undefined;
    try { parseXml(input); } catch (error) { expected = error as Error; }
    for (const recover of [false, true]) {
      const budget = new XmlBudget(resolveXmlQueryLimits(), signal, async () => {});
      const operation = StoredXmlDocument.parse([input], { fs, cwd: "/", env: {}, signal }, budget, 1, recover ? () => {} : undefined);
      if (expected) await assert.rejects(operation, error => error instanceof Error && error.message === expected.message);
      else await (await operation).close();
    }
    assert.deepEqual(await fs.readdir("/"), []);
  });

for (const kind of ["PI", "element", "attribute"]) for (const recover of [false, true]) for (const outcome of ["read", "write", "abort"]) test(`${kind} name copy cleans up on ${outcome} (recover=${recover})`, async t => {
  const fs = createMemoryFileSystem(), controller = new AbortController(), failure = new Error("name copy stopped");
  let copying = false, fragments = 0, opened = 0, closed = 0, sourceClosed = false;
  const store = StoredStringMap.prototype.storeString;
  t.mock.method(StoredStringMap.prototype, "storeString", async function (this: StoredStringMap, parts: Parameters<typeof store>[0]) {
    if (!(Symbol.asyncIterator in parts)) return store.call(this, parts);
    const tracked = (async function* () {
      for await (const part of parts) {
        fragments++; assert.ok(part.length <= 512);
        if (outcome === "abort" && fragments === 40) controller.abort(failure);
        await Promise.resolve(); yield part;
      }
    })();
    copying = true;
    try { return await store.call(this, tracked); }
    finally { copying = false; }
  });
  const injected = new Proxy(fs, { get(target, key) {
    if (key === "readFile") return () => assert.fail("no payload-wide name read");
    if (key === "open") return async (...args: Parameters<typeof fs.open>) => {
      const handle = await fs.open(...args); opened++;
      return new Proxy(handle, { get(descriptor, member) {
        if (member === "read" || member === "write") return async (...values: Parameters<typeof handle.read>) => {
          assert.ok(values[0].byteLength <= 16384);
          if (copying && fragments >= 40 && member === outcome) throw failure;
          return member === "read" ? handle.read(...values) : handle.write(...values);
        };
        if (member === "close") return async () => { closed++; return handle.close(); };
        const value = Reflect.get(descriptor, member, descriptor);
        return typeof value === "function" ? value.bind(descriptor) : value;
      } });
    };
    const value = Reflect.get(target, key, target);
    return typeof value === "function" ? value.bind(target) : value;
  } });
  const source = (function* () {
    try { yield kind === "PI" ? "<r><?" : kind === "attribute" ? "<r " : "<"; const piece = "a".repeat(4096); for (let i = 0; i < 80; i++) yield piece; yield kind === "PI" ? " data?></r>" : kind === "attribute" ? '="value"/>' : "/>"; }
    finally { sourceClosed = true; }
  })();
  const budget = new XmlBudget(resolveXmlQueryLimits(), controller.signal, async () => {});
  await assert.rejects(StoredXmlDocument.parse(source, { fs: injected, cwd: "/", env: {}, signal: controller.signal }, budget, 1, recover ? () => {} : undefined), error => error === failure);
  assert.ok(fragments >= 40); assert.equal(sourceClosed, true); assert.equal(opened, closed);
  assert.deepEqual(await fs.readdir("/"), []);
});
