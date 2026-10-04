import assert from "node:assert/strict";
import test from "node:test";
import { PagedStorage } from "@poe-code/safe-fs/storage";
import { Budget } from "./budget.js";
import { convert } from "./fixtures.js";
import { settings } from "./options.js";
import { TextStore } from "./stored-text.js";
import { storedIdnaLabel } from "./stored-idna.js";
import { normalizeStored } from "./stored-normalize.js";
import { decodePunycode, encodePunycode } from "./stored-punycode.js";

async function fixture(run: (text: TextStore, budget: Budget) => Promise<void>) {
  const context = (await convert("")).context, storage = new PagedStorage(context, 16);
  try { await run(new TextStore(storage), new Budget(context, settings({}))); }
  finally { await storage.close(); }
}
async function collect(text: TextStore, root: number): Promise<string> {
  let result = "";
  for await (const chunk of text.chunks(root)) result += chunk;
  return result;
}

test("stored normalization agrees with native NFC across decompositions and unbounded combining runs", () => fixture(async (text, budget) => {
  const cases = ["", "a\u0315\u0300".repeat(16), "a" + "\u0315\u0300".repeat(2048), "\u0345\u0334a", "\u1100\u1161\u11a8", "\uac00\u11a8", "\u1f82", "\u212b", "a\u034f\u0301", "\u0301a", "😀\u0301𐀀"];
  let seed = 1788;
  const scalars = ["a", "A", "é", "\u0301", "\u0315", "\u0323", "\u0345", "\u0334", "\u034f", "\u212b", "\u1f82", "\u1100", "\u1161", "\u11a8", "😀"];
  for (let trial = 0; trial < 40; trial++) {
    let value = "";
    for (let index = 0; index < 20; index++) { seed = Math.imul(seed, 1664525) + 1013904223 >>> 0; value += scalars[seed % scalars.length]; }
    cases.push(value);
  }
  for (const value of cases) assert.equal(await collect(text, await normalizeStored(text, await text.from(value), budget)), value.normalize("NFC"), JSON.stringify(value.slice(0, 80)));
}));

test("stored punycode preserves Unicode scalar insertion and rejects malformed encodings", () => fixture(async (text, budget) => {
  for (const label of ["bücher", "é", "😀a𐀀b", "aéöü", "مثال", "é".repeat(1024)]) {
    const encoded = await encodePunycode(text, await text.from(label), budget);
    assert.notEqual(encoded, undefined);
    const decoded = await decodePunycode(text, encoded!, budget);
    assert.notEqual(decoded, undefined);
    assert.equal(await collect(text, decoded!), label);
    assert.equal("xn--" + await collect(text, encoded!), new URL(`http://${label}/`).hostname);
  }
  for (const value of ["-abc", "%%%%", "99999999999999999999999999", "a$"]) {
    assert.equal(await decodePunycode(text, await text.from(value), budget), undefined, value);
  }
}));

test("stored IDNA validation agrees with native mapping, joining, bidi and A-label rules", () => fixture(async (text, budget) => {
  const labels = ["é", "e\u0301", "Ａ", "\u00ad", "\u200b", "\ufeff", "１２３", "０ｘ７ｆ", "㏇", "a﹒b", "\u0301a", "a\u0340", "a\u200c", "क्\u200dष", "क्\u200cष", "ب\u200cب", "ب\u064e\u200c\u064eب", "ب\u200cب\u200cب", "ب\u200c\u200cب", "א", "1א", "א1", "אa", "א١1", "א\u0301", "xn--abc-", "xn--", "xn--a", "xn--bcher-kva", "xn--a-ecp", "xn---abc", "xn--abc--", "xn--xn---", "-א", "١א", "😀", "\u{1e6c0}"];
  for (const label of [...labels, "a".repeat(300) + "ب\u200cب", "א".repeat(300), "א".repeat(300) + "a"]) {
    for (const unicode of label.startsWith("xn--") ? [false, true] : [true]) {
      const suffix = unicode ? "é" : "invalid", ending = unicode ? ".xn--9ca" : ".invalid";
      let expected: string | undefined;
      try { expected = new URL(`http://${label}.${suffix}/`).hostname.slice(0, -ending.length); } catch { /* invalid label */ }
      const root = await storedIdnaLabel(text, await text.from(label), unicode, budget);
      const actual = root === undefined ? undefined : await collect(text, root);
      assert.equal(actual, expected, JSON.stringify([label.slice(-50), unicode]));
    }
  }
}));

test("stored normalization never gives native normalization a payload-sized input", async t => {
  const original = String.prototype.normalize;
  let maximum = 0;
  t.mock.method(String.prototype, "normalize", function (this: string, form?: string) {
    maximum = Math.max(maximum, this.length);
    return original.call(this, form);
  });
  await fixture(async (text, budget) => {
    const input = await text.concat(await text.from("a"), await text.repeat(await text.from("\u0315\u0300".repeat(64)), 32));
    const output = await normalizeStored(text, input, budget);
    assert.equal((await text.info(output)).points, 4096);
  });
  assert.ok(maximum <= 4, `native normalization retained ${maximum} UTF-16 units`);
});

for (const outcome of ["failure", "abort"] as const) test(`IDNA storage ${outcome} preserves the primary error and closes backing`, async () => {
  const controller = new AbortController(), reason = new Error("IDNA backing interrupted");
  const context = (await convert("", {}, { signal: controller.signal })).context;
  const storage = new PagedStorage(context, 1), text = new TextStore(storage);
  const input = await text.repeat(await text.from("é".repeat(64)), 256);
  const open = context.fs.open!.bind(context.fs);
  let closed = 0;
  context.fs.open = async (path, options) => {
    const fd = await open(path, options);
    return { ...fd, capabilities: fd.capabilities, stat: fd.stat.bind(fd), read: fd.read.bind(fd), truncate: fd.truncate.bind(fd), sync: fd.sync.bind(fd),
      async write() { if (outcome === "abort") controller.abort(reason); throw reason; },
      async close(options) { closed++; return fd.close(options); }
    };
  };
  try { await assert.rejects(storedIdnaLabel(text, input, true, new Budget(context, settings({}))), error => error === reason); }
  finally { await storage.close(); }
  assert.equal(closed, 1);
  assert.deepEqual(await context.fs.readdir("/"), []);
});
