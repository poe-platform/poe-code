import assert from "node:assert/strict";
import test from "node:test";
import { createMemoryFileSystem } from "@poe-code/safe-fs";
import { XmlLimitError } from "@poe-code/safe-fs/core";
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
