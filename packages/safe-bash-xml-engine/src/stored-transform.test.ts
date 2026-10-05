import assert from "node:assert/strict";
import test from "node:test";
import { createMemoryFileSystem } from "@poe-code/safe-fs";
import { serialize, stringValue } from "./evaluate.js";
import { serializeDocument } from "./document.js";
import { XmlBudget, resolveXmlQueryLimits } from "./limits.js";
import { parseQuery } from "./query.js";
import { StoredXmlDocument } from "./stored-document.js";
import { StoredXPath } from "./stored-evaluate.js";

test("CDATA coalescing stores one logical text node without joining its token bodies", async () => {
  const fs = createMemoryFileSystem(), signal = new AbortController().signal;
  const budget = new XmlBudget(resolveXmlQueryLimits(), signal, async () => {});
  const payload = "a".repeat(16384), token = `<![CDATA[${payload}]]>`;
  const document = await StoredXmlDocument.parse((function* () {
    yield "<r>";
    for (let index = 0; index < 80; index++) yield token;
    yield "</r>";
  })(), { fs, cwd: "/", env: {}, signal }, budget, 1);
  const load = document.node.bind(document);
  document.node = async reference => {
    const node = await load(reference);
    if (node.kind === "text" || node.kind === "cdata") assert.ok(node.text.length <= payload.length, "node metadata must never contain the joined text");
    return node;
  };
  try {
    await document.transform({ nocdata: true });
    await document.transform({ nocdata: true });
    const evaluator = new StoredXPath(document, budget);
    assert.equal(await evaluator.scalar(await parseQuery("count(/r/text())", budget)), "1");
    const selected = await evaluator.select(await parseQuery("/r/text()", budget));
    for await (const node of selected.nodes()) {
      let size = 0, fragments = 0;
      for await (const part of stringValue(node, budget)) {
        assert.ok(part.length <= 512);
        assert.equal(part, "a".repeat(part.length));
        size += part.length; fragments++;
      }
      assert.equal(fragments, 80 * payload.length / 512);
      assert.equal(size, 80 * payload.length);
      let serialized = 0;
      for await (const part of serialize(node, budget)) {
        assert.ok(part.length <= 4096);
        serialized += part.length;
        await Promise.resolve();
      }
      assert.equal(serialized, size);
    }
    let documentSize = 0;
    for await (const part of serializeDocument(document, "format", budget, false)) {
      assert.ok(part.length <= 4096);
      documentSize += part.length;
    }
    assert.equal(documentSize, '<?xml version="1.0"?>\n<r></r>\n'.length + 80 * payload.length);
  } finally { await document.close(); }
  assert.deepEqual(await fs.readdir("/"), []);
});

for (const cancel of [false, true]) test(`stored transformations retire backing when a checkpoint fails (cancel=${cancel})`, async () => {
  const fs = createMemoryFileSystem(), controller = new AbortController(), failure = new Error("transform interrupted");
  let transforming = false;
  const budget = new XmlBudget(resolveXmlQueryLimits(), controller.signal, async () => {
    if (transforming) {
      if (cancel) controller.abort(failure);
      throw failure;
    }
  });
  const document = await StoredXmlDocument.parse((function* () {
    yield "<r>";
    for (let index = 0; index < 180; index++) yield '<x> <![CDATA[ ]]><a/> </x>';
    yield "</r>";
  })(), { fs, cwd: "/", env: {}, signal: controller.signal }, budget, 1);
  transforming = true;
  try { await assert.rejects(document.transform({ nocdata: true, noblanks: true }), error => error === failure); }
  finally { await document.close(); }
  assert.deepEqual(await fs.readdir("/"), []);
});

for (const recovery of [false, true]) test(`a large CDATA section stays one paged node (recovery=${recovery})`, async () => {
  const fs = createMemoryFileSystem(), signal = new AbortController().signal;
  const budget = new XmlBudget(resolveXmlQueryLimits(), signal, async () => {});
  const chunk = "x😀".repeat(171), repetitions = 150;
  const document = await StoredXmlDocument.parse((function* () {
    yield "<r><![CDATA[";
    for (let index = 0; index < repetitions; index++) yield chunk;
    yield "]]><![CDATA[]]></r>";
  })(), { fs, cwd: "/", env: {}, signal }, budget, 1, recovery ? () => {} : undefined);
  const load = document.node.bind(document);
  document.node = async reference => {
    const node = await load(reference);
    if (node.kind === "cdata") assert.ok(node.text.length <= 512);
    return node;
  };
  try {
    const xpath = new StoredXPath(document, budget);
    assert.equal(await xpath.scalar(await parseQuery("count(/r/text())", budget)), "2");
    const selected = await xpath.select(await parseQuery("/r/text()", budget));
    let serialized = "", text = "";
    for await (const node of selected.nodes()) {
      for await (const part of serialize(node, budget)) { serialized += part; await Promise.resolve(); }
      for await (const part of stringValue(node, budget)) text += part;
    }
    assert.equal(serialized, `<![CDATA[${chunk.repeat(repetitions)}]]><![CDATA[]]>`);
    assert.equal(text, chunk.repeat(repetitions));
    let formatted = "";
    for await (const part of serializeDocument(document, "format", budget, false)) formatted += part;
    assert.equal(formatted, `<?xml version="1.0"?>\n<r>${serialized}</r>\n`);
  } finally { await document.close(); }
  assert.deepEqual(await fs.readdir("/"), []);
});
