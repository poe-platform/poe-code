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

for (const recovery of [false, true]) test(`large entity-bearing text stays one paged node (recovery=${recovery})`, async () => {
  const fs = createMemoryFileSystem(), signal = new AbortController().signal;
  let writes = 0, opened = 0, closed = 0;
  const injected = new Proxy(fs, { get(target, key) {
    if (key === "readFile" || key === "writeFile") return () => assert.fail("use bounded descriptor I/O");
    if (key === "open") return async (...args: Parameters<typeof fs.open>) => {
      const handle = await fs.open(...args); opened++;
      return new Proxy(handle, { get(descriptor, member) {
        if (member === "write") return async (...values: Parameters<typeof handle.write>) => {
          assert.ok(values[0].byteLength <= 16384); writes++;
          await Promise.resolve();
          return handle.write(...values);
        };
        if (member === "read") return async (...values: Parameters<typeof handle.read>) => {
          assert.ok(values[0].byteLength <= 16384);
          return handle.read(...values);
        };
        if (member === "close") return async () => { closed++; await handle.close(); };
        const value = Reflect.get(descriptor, member, descriptor);
        return typeof value === "function" ? value.bind(descriptor) : value;
      } });
    };
    const value = Reflect.get(target, key, target);
    return typeof value === "function" ? value.bind(target) : value;
  } });
  const budget = new XmlBudget(resolveXmlQueryLimits(), signal, async () => {});
  const chunk = "x😀&amp;&#65;", repetitions = 3000;
  const document = await StoredXmlDocument.parse((function* () {
    yield "<r>";
    for (let index = 0; index < repetitions; index++) yield chunk;
    yield "</r>";
  })(), { fs: injected, cwd: "/", env: {}, signal }, budget, 1, recovery ? () => {} : undefined);
  const load = document.node.bind(document);
  document.node = async reference => {
    const node = await load(reference);
    if (node.kind === "text") assert.ok(node.text.length <= 512);
    return node;
  };
  try {
    const xpath = new StoredXPath(document, budget);
    assert.equal(await xpath.scalar(await parseQuery("count(/r/text())", budget)), "1");
    const selected = await xpath.select(await parseQuery("/r/text()", budget));
    let text = "", serialized = "";
    for await (const node of selected.nodes()) {
      for await (const part of stringValue(node, budget)) text += part;
      for await (const part of serialize(node, budget)) { serialized += part; await Promise.resolve(); }
    }
    assert.equal(text, "x😀&A".repeat(repetitions));
    assert.equal(serialized, "x😀&amp;A".repeat(repetitions));
    await document.transform({ nocdata: true, noblanks: true });
    let formatted = "";
    for await (const part of serializeDocument(document, "format", budget, false)) formatted += part;
    assert.equal(formatted, `<?xml version="1.0"?>\n<r>${"x&#x1F600;&amp;A".repeat(repetitions)}</r>\n`);
  } finally { await document.close(); }
  assert.ok(writes > 0); assert.equal(closed, opened);
  assert.deepEqual(await fs.readdir("/"), []);
});

for (const kind of ["comment", "processing-instruction"] as const) for (const recovery of [false, true])
test(`large ${kind} bodies preserve delimiters and node identity (recovery=${recovery})`, async () => {
  const fs = createMemoryFileSystem(), signal = new AbortController().signal;
  const budget = new XmlBudget(resolveXmlQueryLimits(), signal, async () => {});
  const chunk = "x😀&".repeat(128), repetitions = 100;
  const open = kind === "comment" ? "<!--" : "<?target ", close = kind === "comment" ? "-->" : "?>";
  const document = await StoredXmlDocument.parse((function* () {
    yield "<r>" + open;
    for (let index = 0; index < repetitions; index++) yield chunk;
    yield close + "<x/>" + open + close + "</r>";
  })(), { fs, cwd: "/", env: {}, signal }, budget, 1, recovery ? () => {} : undefined);
  const load = document.node.bind(document);
  document.node = async reference => {
    const node = await load(reference);
    if (node.kind === kind) assert.ok(node.text.length <= 512);
    return node;
  };
  try {
    let children = 0;
    for await (const ignored of document.children(document.root)) children++;
    assert.equal(children, 3);
    const empty = kind === "comment" ? "<!---->" : "<?target?>";
    const body = chunk.repeat(repetitions);
    const expected = `<r>${open}${body}${close}<x/>${empty}</r>`;
    for (const mode of ["format", "c14n", "exc-c14n"] as const) {
      let output = "";
      for await (const part of serializeDocument(document, mode, budget, false)) {
        assert.ok(part.length <= 512); output += part; await Promise.resolve();
      }
      assert.equal(output, mode === "format" ? `<?xml version="1.0"?>\n${expected}\n` : expected.replace("<x/>", "<x></x>"));
    }
    const xpath = new StoredXPath(document, budget);
    const selected = await xpath.select(await parseQuery("/r", budget));
    for await (const node of selected.nodes()) {
      let output = "";
      for await (const part of serialize(node, budget)) output += part;
      assert.equal(output, expected);
      let text = "";
      for await (const part of stringValue(node, budget)) text += part;
      assert.equal(text, "", "comments and PI bodies must not become element string content");
    }
  } finally { await document.close(); }
  assert.deepEqual(await fs.readdir("/"), []);
});
