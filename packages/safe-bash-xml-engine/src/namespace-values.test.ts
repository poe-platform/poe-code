import assert from "node:assert/strict";
import test from "node:test";
import { createMemoryFileSystem } from "@poe-code/safe-fs";
import { parseXml } from "@poe-code/safe-fs/core";
import { StoredXmlDocument } from "./stored-document.js";
import { StoredStringMap } from "./stored-map.js";
import { serializeDocument } from "./document.js";
import { parseStoredXml } from "./recovery.js";
import { XmlBudget, resolveXmlQueryLimits } from "./limits.js";

for (const recover of [false, true]) test(`namespace declarations emit bounded value fragments (recover=${recover})`, async () => {
  const fs = createMemoryFileSystem(), signal = new AbortController().signal;
  const uri = "urn:" + "é😀".repeat(1000), input = '<r xmlns:p="' + uri + '"/>';
  const budget = new XmlBudget(resolveXmlQueryLimits(), signal, async () => {});
  let actual = "", count = 0;
  await parseStoredXml([input], { fs, cwd: "/", env: {}, signal }, budget, recover ? () => {} : undefined, async event => {
    if (event.type !== "attribute") return;
    assert.ok(event.attribute.value.length <= 512, `namespace fragment size ${event.attribute.value.length}`);
    actual += event.attribute.value; count++; await Promise.resolve();
  });
  assert.equal(actual, uri); assert.ok(count > 1);
  assert.deepEqual(await fs.readdir("/"), []);
});

for (const mode of ["c14n", "exc-c14n"] as const) test(`canonical ${mode} replays namespace references without buffered map values`, async t => {
  const fs = createMemoryFileSystem(), signal = new AbortController().signal;
  const uri = "urn:" + "x".repeat(5000);
  const input = `<r xmlns:p="${uri}"><p:x/><x xmlns:p="urn:other"><p:y/></x><p:z/></r>`;
  const budget = new XmlBudget(resolveXmlQueryLimits(), signal, async () => {});
  let expected = "";
  for await (const part of serializeDocument(parseXml(input), mode, budget, true)) expected += part;
  const document = await StoredXmlDocument.parse([input], { fs, cwd: "/", env: {}, signal }, budget, 1);
  const iterator = StoredStringMap.prototype[Symbol.asyncIterator];
  try {
    t.mock.method(StoredStringMap.prototype, "get", async () => { throw new Error("buffered map lookup during canonical output"); });
    StoredStringMap.prototype[Symbol.asyncIterator] = async function* () { yield assert.fail("buffered map iteration during canonical output"); };
    let actual = "";
    for await (const part of serializeDocument(document, mode, budget, true)) { actual += part; await Promise.resolve(); }
    assert.equal(actual, expected);
  } finally { StoredStringMap.prototype[Symbol.asyncIterator] = iterator; await document.close(); }
  assert.deepEqual(await fs.readdir("/"), []);
});

for (const uri of ["", ":bad", "relative", "1:bad", "a b:c", "a".repeat(5000) + ":valid", "a".repeat(5000)]) test(`streamed canonical namespace validation preserves ${uri.slice(0, 20) || "empty"}`, async () => {
  const input = `<r xmlns="${uri}"/>`, fs = createMemoryFileSystem(), signal = new AbortController().signal;
  const budget = new XmlBudget(resolveXmlQueryLimits(), signal, async () => {});
  let expected = "", failure: Error | undefined;
  try { for await (const part of serializeDocument(parseXml(input), "c14n", budget, true)) expected += part; }
  catch (error) { assert.ok(error instanceof Error); failure = error; }
  const document = await StoredXmlDocument.parse([input], { fs, cwd: "/", env: {}, signal }, budget, 1);
  try {
    const consume = async () => { let actual = ""; for await (const part of serializeDocument(document, "c14n", budget, true)) actual += part; return actual; };
    if (failure) await assert.rejects(consume(), error => error instanceof Error && error.message === failure.message);
    else assert.equal(await consume(), expected);
  } finally { await document.close(); }
  assert.deepEqual(await fs.readdir("/"), []);
});

for (const recover of [false, true]) test(`stored namespace metadata stays backed through formatting and XPath (recover=${recover})`, async t => {
  const { StoredXPath } = await import("./stored-evaluate.js");
  const { parseQuery } = await import("./query.js");
  const fs = createMemoryFileSystem(), signal = new AbortController().signal;
  const uri = "urn:" + "x".repeat(12000);
  const input = `<p:r xmlns:p="${uri}" xmlns:q="urn:other" p:a="1" q:a="2"><p:x/></p:r>`;
  const budget = new XmlBudget(resolveXmlQueryLimits(), signal, async () => {});
  const expected = new Map<string, string>();
  for (const mode of ["format", "c14n", "exc-c14n"] as const) {
    let value = ""; for await (const part of serializeDocument(parseXml(input), mode, budget, true)) value += part;
    expected.set(mode, value);
  }
  t.mock.method(StoredStringMap.prototype, "get", async () => { throw new Error("buffered namespace metadata lookup"); });
  const document = await StoredXmlDocument.parse([input], { fs, cwd: "/", env: {}, signal }, budget, 1, recover ? () => {} : undefined);
  try {
    assert.ok(JSON.stringify(await document.metadata(document.root)).length < 1024);
    for (const mode of ["format", "c14n", "exc-c14n"] as const) {
      let actual = ""; for await (const part of serializeDocument(document, mode, budget, true)) actual += part;
      assert.equal(actual, expected.get(mode));
    }
    const buffered = await document.node(document.root);
    assert.equal(buffered.kind, "element");
    if (buffered.kind === "element") {
      assert.equal(buffered.namespace, uri); assert.equal(buffered.namespaceReference, undefined);
      assert.equal(buffered.attributes.find(attribute => attribute.name === "p:a")?.namespace, uri);
    }
    const xpath = new StoredXPath(document, budget);
    assert.equal(await xpath.scalar(await parseQuery("count(//p:x)", budget)), "1");
    assert.equal(await xpath.scalar(await parseQuery("namespace-uri(/p:r)", budget)), uri);
    assert.equal(await xpath.scalar(await parseQuery("namespace-uri(/p:r/@p:a)", budget)), uri);
  } finally { await document.close(); }
  assert.deepEqual(await fs.readdir("/"), []);
});

for (const recover of [false, true]) for (const outcome of ["read", "write", "abort"]) test(`namespace metadata copy cleans up on ${outcome} (recover=${recover})`, async t => {
  const fs = createMemoryFileSystem(), controller = new AbortController(), failure = new Error("namespace copy stopped");
  let copying = false, fragments = 0, opened = 0, closed = 0, sourceClosed = false;
  const valueParts = StoredStringMap.prototype.valueParts;
  t.mock.method(StoredStringMap.prototype, "valueParts", async function* (this: StoredStringMap, reference: number) {
    try {
      for await (const part of valueParts.call(this, reference)) {
        copying = true; fragments++; assert.ok(part.length <= 4096);
        if (outcome === "abort" && fragments === 3) controller.abort(failure);
        await Promise.resolve(); yield part;
      }
    } finally { copying = false; }
  });
  const injected = new Proxy(fs, { get(target, key) {
    if (key === "readFile") return () => assert.fail("no payload-wide namespace read");
    if (key === "open") return async (...args: Parameters<typeof fs.open>) => {
      const handle = await fs.open(...args); opened++;
      return new Proxy(handle, { get(descriptor, member) {
        if (member === "read" || member === "write") return async (...values: Parameters<typeof handle.read>) => {
          assert.ok(values[0].byteLength <= 16384);
          if (copying && fragments >= 3 && member === outcome) throw failure;
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
    try { yield '<p:r xmlns:p="urn:'; const piece = "x".repeat(4096); for (let i = 0; i < 80; i++) yield piece; yield '"/>'; }
    finally { sourceClosed = true; }
  })();
  const budget = new XmlBudget(resolveXmlQueryLimits(), controller.signal, async () => {});
  await assert.rejects(StoredXmlDocument.parse(source, { fs: injected, cwd: "/", env: {}, signal: controller.signal }, budget, 1, recover ? () => {} : undefined), error => error === failure);
  assert.ok(fragments >= 3); assert.equal(sourceClosed, true); assert.equal(opened, closed);
  assert.deepEqual(await fs.readdir("/"), []);
});
