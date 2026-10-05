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
  try {
    t.mock.method(StoredStringMap.prototype, "get", async () => { throw new Error("buffered map lookup during canonical output"); });
    t.mock.method(StoredStringMap.prototype, Symbol.asyncIterator, async function* () { yield assert.fail("buffered map iteration during canonical output"); });
    let actual = "";
    for await (const part of serializeDocument(document, mode, budget, true)) { actual += part; await Promise.resolve(); }
    assert.equal(actual, expected);
  } finally { await document.close(); }
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
