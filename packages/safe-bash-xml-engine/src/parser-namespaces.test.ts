import assert from "node:assert/strict";
import test from "node:test";
import { createMemoryFileSystem } from "@poe-code/safe-fs";
import { XmlLimitError, parseXml } from "@poe-code/safe-fs/core";
import { XmlBudget, resolveXmlQueryLimits } from "./limits.js";
import { parseStoredXml } from "./recovery.js";

for (const recover of [false, true]) test(`stored parser resolves namespaces without resident scope maps (recover=${recover})`, async () => {
  const fs = createMemoryFileSystem(), signal = new AbortController().signal;
  const budget = new XmlBudget(resolveXmlQueryLimits(), signal, async () => {});
  const opened: [string, string][] = [];
  const source = (function* () {
    yield '<r';
    for (let index = 0; index < 120; index++) yield ` xmlns:p${index}="urn:${index}"`;
    yield '><p119:x xmlns:p0="urn:changed"><p0:x/></p119:x><p0:x/></r>';
  })();
  const root = await parseStoredXml(source, { fs, cwd: "/", env: {}, signal }, budget, recover ? () => {} : undefined, async event => {
    if (event.type !== "open") return;
    assert.equal(event.element.namespaces.size, 0, "stored parser must not materialize the namespace scope");
    opened.push([event.element.name, event.element.namespace]);
  });
  assert.equal(root.namespaces.size, 0);
  assert.deepEqual(opened, [["r", ""], ["p119:x", "urn:119"], ["p0:x", "urn:changed"], ["p0:x", "urn:0"]]);
  assert.deepEqual(await fs.readdir("/"), []);
});

for (const recover of [false, true]) test(`stored parser counts distinct in-scope prefixes (recover=${recover})`, async () => {
  const fs = createMemoryFileSystem(), signal = new AbortController().signal;
  const budget = () => new XmlBudget({ ...resolveXmlQueryLimits(), maxNamespaces: 2 }, signal, async () => {});
  const context = { fs, cwd: "/", env: {}, signal };
  const root = await parseStoredXml(['<p:r xmlns:p="urn:one"><p:x xmlns:p="urn:two"/></p:r>'], context, budget(), recover ? () => {} : undefined);
  assert.equal(root.namespace, "urn:one");
  await assert.rejects(parseStoredXml(['<p:r xmlns:p="urn:one"><q:x xmlns:q="urn:two"/></p:r>'], context, budget(), recover ? () => {} : undefined), error => error instanceof XmlLimitError && error.limit === "maxNamespaces");
  assert.deepEqual(await fs.readdir("/"), []);
});

for (const recover of [false, true]) for (const cancel of [false, true]) test(`parser namespace spill preserves failure and cleanup (recover=${recover}, cancel=${cancel})`, async () => {
  const fs = createMemoryFileSystem(), controller = new AbortController(), failure = new Error("namespace spill failed");
  let writes = 0, active = 0;
  const injected = new Proxy(fs, { get(target, key) {
    if (key === "open") return async (...args: Parameters<typeof fs.open>) => {
      const handle = await fs.open(...args);
      return new Proxy(handle, { get(descriptor, member) {
        if (member === "write") return async (...args: Parameters<typeof handle.write>) => {
          assert.ok(args[0].length <= 16384); assert.equal(++active, 1);
          try {
            await Promise.resolve();
            if (++writes === 2) { if (cancel) controller.abort(failure); throw failure; }
            return await handle.write(...args);
          } finally { active--; }
        };
        const value = Reflect.get(descriptor, member, descriptor);
        return typeof value === "function" ? value.bind(descriptor) : value;
      } });
    };
    const value = Reflect.get(target, key, target);
    return typeof value === "function" ? value.bind(target) : value;
  } });
  let closed = false;
  const source = (function* () {
    try {
      yield '<r';
      for (let index = 0; index < 500; index++) yield ` xmlns:p${index}="urn:${index}"`;
      yield '/>';
    } finally { closed = true; }
  })();
  const budget = new XmlBudget(resolveXmlQueryLimits(), controller.signal, async () => {});
  await assert.rejects(parseStoredXml(source, { fs: injected, cwd: "/", env: {}, signal: controller.signal }, budget, recover ? () => {} : undefined), error => error === failure);
  assert.ok(writes >= 2); assert.equal(active, 0); assert.equal(closed, true);
  assert.deepEqual(await fs.readdir("/"), []);
});

for (const recover of [false, true]) test(`namespace binding consumes a lazy value producer (recover=${recover})`, async t => {
  const { StoredStringMap } = await import("./stored-map.js");
  const original = StoredStringMap.prototype.set;
  let bound = false;
  t.mock.method(StoredStringMap.prototype, "set", async function (this: InstanceType<typeof StoredStringMap>, key: Parameters<typeof original>[0], value: Parameters<typeof original>[1]) {
    if (key === "p") {
      assert.notEqual(typeof value, "string", "namespace binding must not receive a full URI string");
      assert.ok(Symbol.asyncIterator in (value as object)); bound = true;
    }
    return original.call(this, key, value);
  });
  const fs = createMemoryFileSystem(), signal = new AbortController().signal;
  const source = (function* () { yield '<r xmlns:p="urn:'; for (let i = 0; i < 100; i++) yield "é😀&amp;"; yield '"/>'; })();
  await parseStoredXml(source, { fs, cwd: "/", env: {}, signal }, new XmlBudget(resolveXmlQueryLimits(), signal, async () => {}), recover ? () => {} : undefined);
  assert.equal(bound, true); assert.deepEqual(await fs.readdir("/"), []);
});


const xmlUri = "http://www.w3.org/XML/1998/namespace";
for (const input of [
  '<r xmlns=""/>', '<r xmlns:p=""/>', '<r xmlns:xml="' + xmlUri + '"/>',
  '<r xmlns:xml="' + [...xmlUri].map(character => `&#000000${character.codePointAt(0)};`).join("") + '"/>',
  '<r xmlns:p="' + xmlUri + '"/>', '<r xmlns:xml="' + xmlUri + 'suffix"/>',
  '<r xmlns:p="http://www.w3.org/2000/xmlns/"/>', '<r xmlns:xmlns="urn:p"/>',
  '<r xmlns:p="urn:' + 'x'.repeat(2000) + '&unknown;"/>',
  '<r xmlns="&unknown;"/>', '<r xmlns:p="&#999999999;"/>',
]) test(`streamed namespace bindings preserve buffered validation: ${input.slice(0, 80)}`, async () => {
  const fs = createMemoryFileSystem(), signal = new AbortController().signal;
  const expectedMessages: string[] = [], actualMessages: string[] = [];
  let expected: ReturnType<typeof parseXml> | undefined, failure: Error | undefined;
  try { expected = parseXml(input, { recover: message => { expectedMessages.push(message); } }); }
  catch (error) { assert.ok(error instanceof Error); failure = error; }
  const operation = parseStoredXml([input], { fs, cwd: "/", env: {}, signal }, new XmlBudget(resolveXmlQueryLimits(), signal, async () => {}), message => { actualMessages.push(message); });
  if (failure) await assert.rejects(operation, error => error instanceof Error && error.message === failure.message);
  else assert.equal((await operation).namespace, expected!.namespace);
  assert.deepEqual(actualMessages, expectedMessages); assert.deepEqual(await fs.readdir("/"), []);
});

for (const recover of [false, true]) for (const outcome of ["read", "write", "abort"]) test(`lazy namespace binding retires backing after ${outcome} (recover=${recover})`, async t => {
  const { StoredStringMap } = await import("./stored-map.js");
  const fs = createMemoryFileSystem(), controller = new AbortController(), failure = new Error("binding stopped");
  let binding = false, fragments = 0, opened = 0, closed = 0, sourceClosed = false;
  const original = StoredStringMap.prototype.set;
  t.mock.method(StoredStringMap.prototype, "set", async function (this: InstanceType<typeof StoredStringMap>, key: Parameters<typeof original>[0], value: Parameters<typeof original>[1]) {
    if (key !== "p") return original.call(this, key, value);
    assert.ok(typeof value === "object" && Symbol.asyncIterator in value);
    const parts = (async function* () {
      for await (const part of value as AsyncIterable<string>) {
        assert.ok(part.length <= 512); fragments++;
        if (fragments === 3 && outcome === "abort") controller.abort(failure);
        await Promise.resolve(); yield part;
      }
    })();
    binding = true;
    try { return await original.call(this, key, parts); }
    finally { binding = false; }
  });
  const injected = new Proxy(fs, { get(target, key) {
    if (key === "readFile") return () => assert.fail("no whole URI/source reads");
    if (key === "open") return async (...args: Parameters<typeof fs.open>) => {
      const handle = await fs.open(...args); opened++;
      return new Proxy(handle, { get(descriptor, member) {
        if (member === "read") return async (...args: Parameters<typeof handle.read>) => {
          if (binding && outcome === "read") throw failure;
          return handle.read(...args);
        };
        if (member === "write") return async (...args: Parameters<typeof handle.write>) => {
          assert.ok(args[0].length <= 16384); await Promise.resolve();
          if (binding && outcome === "write") throw failure;
          return handle.write(...args);
        };
        if (member === "close") return async () => { closed++; await handle.close(); };
        const value = Reflect.get(descriptor, member, descriptor);
        return typeof value === "function" ? value.bind(descriptor) : value;
      } });
    };
    const value = Reflect.get(target, key, target);
    return typeof value === "function" ? value.bind(target) : value;
  } });
  const piece = "x".repeat(512);
  const source = (function* () { try { yield '<r xmlns:p="urn:'; for (let i = 0; i < 200; i++) yield piece; yield '"/>'; } finally { sourceClosed = true; } })();
  await assert.rejects(parseStoredXml(source, { fs: injected, cwd: "/", env: {}, signal: controller.signal }, new XmlBudget(resolveXmlQueryLimits(), controller.signal, async () => {}), recover ? () => {} : undefined), error => error === failure);
  assert.equal(sourceClosed, true); assert.equal(opened, closed); assert.equal(binding, false);
  assert.deepEqual(await fs.readdir("/"), []);
});

for (const recover of [false, true]) test(`expanded attribute validation uses backed URI keys (recover=${recover})`, async t => {
  const { StoredStringMap } = await import("./stored-map.js");
  const original = StoredStringMap.prototype.set;
  t.mock.method(StoredStringMap.prototype, "set", async function (this: InstanceType<typeof StoredStringMap>, key: Parameters<typeof original>[0], value: Parameters<typeof original>[1]) {
    if (typeof key === "string") assert.equal(key.includes("\0"), false, "expanded names must not concatenate namespace URI strings");
    return original.call(this, key, value);
  });
  const fs = createMemoryFileSystem(), signal = new AbortController().signal;
  const get = StoredStringMap.prototype.get;
  t.mock.method(StoredStringMap.prototype, "get", async function (this: InstanceType<typeof StoredStringMap>, key: string) {
    assert.ok(key !== "p" && key !== "q", "validation must not materialize namespace URIs");
    return get.call(this, key);
  });
  const context = { fs, cwd: "/", env: {}, signal };
  const source = (duplicate: boolean) => (function* () {
    yield '<r xmlns:p="urn:'; for (let i = 0; i < 100; i++) yield "x".repeat(512);
    yield '" xmlns:q="urn:'; for (let i = 0; i < 100; i++) yield "x".repeat(512);
    yield duplicate ? '" p:a="1" q:a="2"/>' : '" p:a="1" q:b="2"/>';
  })();
  const budget = () => new XmlBudget(resolveXmlQueryLimits(), signal, async () => {});
  await parseStoredXml(source(false), context, budget(), recover ? () => {} : undefined);
  if (!recover) await assert.rejects(parseStoredXml(source(true), context, budget()), /duplicate expanded attribute/);
  assert.deepEqual(await fs.readdir("/"), []);
});

for (const input of [
  '<r xmlns="urn:same" xmlns:p="urn:same" a="1" p:a="2"/>',
  '<r p:a="1" q:a="2" xmlns:p="urn:same" xmlns:q="urn:same"/>',
  '<r p:a="1" q:a="2" xmlns:p="urn:one" xmlns:q="urn:two"/>',
  '<r xmlns:p="urn:same"><r xmlns:p="urn:other" xmlns:q="urn:same" p:a="1" q:a="2"/></r>',
  '<r xmlns:p="urn:ab" xmlns:q="urn:a" p:c="1" q:bc="2"/>',
  '<r xmlns:p="urn:same" xmlns:q="urn:s&#97;me" p:a="1" q:a="2"/>',
  '<r p:a="1"/>', '<p:r/>'
]) test(`backed expanded-name diagnostics match buffered parsing: ${input}`, async () => {
  let failure: Error | undefined;
  try { parseXml(input); } catch (error) { failure = error as Error; }
  const fs = createMemoryFileSystem(), signal = new AbortController().signal;
  const operation = parseStoredXml([input], { fs, cwd: "/", env: {}, signal }, new XmlBudget(resolveXmlQueryLimits(), signal, async () => {}));
  if (failure) await assert.rejects(operation, error => error instanceof Error && error.message === failure.message);
  else await operation;
  assert.deepEqual(await fs.readdir("/"), []);
});
