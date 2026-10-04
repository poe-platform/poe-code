import assert from "node:assert/strict";
import test from "node:test";
import { createMemoryFileSystem } from "@poe-code/safe-fs";
import { PagedStorage } from "@poe-code/safe-fs/storage";
import { XmlBudget, resolveXmlQueryLimits } from "./limits.js";
import { TextValue } from "./text-value.js";

test("XPath text spills, replays bounded chunks, and searches across page boundaries", async () => {
  const fs = createMemoryFileSystem(), signal = new AbortController().signal;
  let writes = 0;
  const injected = new Proxy(fs, { get(target, key) {
    if (key === "open") return async (...args: Parameters<typeof fs.open>) => {
      const descriptor = await fs.open(...args);
      return new Proxy(descriptor, { get(handle, member) {
        if (member === "write") return async (...args: Parameters<typeof descriptor.write>) => {
          assert.ok(args[0].byteLength <= 16384); writes++;
          await Promise.resolve(); return descriptor.write(...args);
        };
        const value = Reflect.get(handle, member, handle);
        return typeof value === "function" ? value.bind(handle) : value;
      } });
    };
    const value = Reflect.get(target, key, target);
    return typeof value === "function" ? value.bind(target) : value;
  } });
  const storage = new PagedStorage({ fs: injected, cwd: "/", env: {}, signal }, 1);
  const budget = new XmlBudget(resolveXmlQueryLimits(), signal, async () => {});
  try {
    const text = await TextValue.create((function* () {
      for (let index = 0; index < 20; index++) yield "ab😀".repeat(300);
      yield "end";
    })(), budget, storage);
    assert.equal(text.size, 18003);
    assert.equal(text.byteLength, 36003);
    assert.equal(await text.find(await TextValue.create(["😀abend"], budget, storage)), -1);
    assert.equal(await text.find(await TextValue.create(["😀end"], budget, storage)), 17999);
    assert.equal(await (await text.slice(17998)).string(), "b😀end");
    let size = 0;
    for await (const part of text.chunks()) { assert.ok(part.length <= 8192); size += [...part].length; await Promise.resolve(); }
    assert.equal(size, text.size);
    assert.ok(writes > 1, "text must reach caller backing");
  } finally { await storage.close(); }
  assert.deepEqual(await fs.readdir("/"), []);
});

for (const source of ["", " ", "-0", ".5", "-12.30e+2", "1e", "+1", "1 2", "1e309", "1e-400", "0." + "0".repeat(5000) + "1", "1" + "0".repeat(5000) + "e-5000", "0." + "0".repeat(323) + "25", "1." + "0".repeat(5000) + "1"]) {
  test(`XPath numeric conversion streams ${source.length > 40 ? `${source.length} characters` : JSON.stringify(source)}`, async () => {
    const signal = new AbortController().signal, storage = new PagedStorage({ fs: createMemoryFileSystem(), cwd: "/", env: {}, signal }, 1);
    const budget = new XmlBudget(resolveXmlQueryLimits(), signal, async () => {});
    try {
      const text = await TextValue.create((function* () { for (let at = 0; at < source.length; at += 13) yield source.slice(at, at + 13); })(), budget, storage);
      const expected = source.trim() === "" || source.startsWith("+") ? NaN : Number(source);
      assert.ok(Object.is(await text.number(), expected));
    } finally { await storage.close(); }
  });
}

test("numeric coercion retains IEEE rounding boundaries beyond the retained decimal prefix", async () => {
  const signal = new AbortController().signal, storage = new PagedStorage({ fs: createMemoryFileSystem(), cwd: "/", env: {}, signal }, 1);
  const budget = new XmlBudget(resolveXmlQueryLimits(), signal, async () => {});
  const halfMinimum = (5n ** 1075n).toString();
  const boundary = '0.' + '0'.repeat(1075 - halfMinimum.length) + halfMinimum;
  const halfwayAtOne = '1.00000000000000011102230246251565404236316680908203125';
  try {
    for (const input of [boundary, boundary + '0'.repeat(1500) + '1', halfwayAtOne, halfwayAtOne + '0'.repeat(1500) + '1', ((2n ** 1024n) - (2n ** 970n)).toString()]) {
      const text = await TextValue.create([input], budget, storage);
      assert.ok(Object.is(await text.number(), Number(input)), input.slice(0, 60));
    }
  } finally { await storage.close(); }
});

test("large search patterns and translation maps use caller page storage", async () => {
  const signal = new AbortController().signal, storage = new PagedStorage({ fs: createMemoryFileSystem(), cwd: "/", env: {}, signal }, 1);
  const budget = new XmlBudget(resolveXmlQueryLimits(), signal, async () => {});
  try {
    const pattern = await TextValue.create(['a'.repeat(4200), 'b'], budget, storage);
    const source = await TextValue.create(['x', 'a'.repeat(4500), 'b', 'z'], budget, storage);
    assert.equal(await source.find(pattern), 301);
    const alphabet = await TextValue.create((function* () { for (let point = 0x1000; point < 0x1000 + 4300; point++) yield String.fromCodePoint(point); })(), budget, storage);
    const first = await TextValue.create([String.fromCodePoint(0x1000)], budget, storage);
    const translated = await alphabet.translate(alphabet, first);
    assert.equal(translated.size, 1);
    assert.equal(await translated.string(), String.fromCodePoint(0x1000));
    assert.equal(await (await source.normalize()).string(), await source.string());
  } finally { await storage.close(); }
});

test("text values preserve code points split across source chunks", async () => {
  const budget = new XmlBudget(resolveXmlQueryLimits(), new AbortController().signal, async () => {});
  const text = await TextValue.create(['a\ud83d', '', '\ude00b'], budget);
  assert.equal(text.size, 3);
  assert.equal(text.byteLength, 6);
  assert.equal(await text.string(), 'a😀b');
});

for (const cancel of [false, true]) test(`paged text retires its source after backing failure (cancel=${cancel})`, async () => {
  const fs = createMemoryFileSystem(), controller = new AbortController(), failure = new Error('text backing failed');
  let retired = false, closed = 0;
  const injected = new Proxy(fs, { get(target, key) {
    if (key === 'open') return async (...args: Parameters<typeof fs.open>) => {
      const descriptor = await fs.open(...args);
      return new Proxy(descriptor, { get(handle, member) {
        if (member === 'write') return async () => { if (cancel) controller.abort(failure); throw failure; };
        if (member === 'close') return async (...args: Parameters<typeof descriptor.close>) => { closed++; return descriptor.close(...args); };
        const value = Reflect.get(handle, member, handle);
        return typeof value === 'function' ? value.bind(handle) : value;
      } });
    };
    const value = Reflect.get(target, key, target);
    return typeof value === 'function' ? value.bind(target) : value;
  } });
  const storage = new PagedStorage({ fs: injected, cwd: '/', env: {}, signal: controller.signal }, 1);
  const budget = new XmlBudget(resolveXmlQueryLimits(), controller.signal, async () => {});
  try {
    await assert.rejects(TextValue.create((async function* () {
      try { for (let index = 0; index < 40; index++) yield 'a'.repeat(256); }
      finally { retired = true; }
    })(), budget, storage), error => error === failure);
  } finally { await storage.close(); }
  assert.equal(retired, true);
  assert.equal(closed, 1);
  assert.deepEqual(await fs.readdir('/'), []);
});
