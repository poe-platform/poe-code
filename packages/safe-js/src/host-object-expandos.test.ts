import { expect, it, vi } from "vitest";
import { Budget, createRealm, defineExtension, type HostObjectDefinition } from "./core.js";

function fixture(
  options: { definition?: HostObjectDefinition; budget?: Budget; expandos?: unknown } = {}
) {
  const get = vi.fn(() => "native");
  let node: unknown;
  const realm = createRealm({
    budget: options.budget,
    extensions: [
      defineExtension({
        manifest: { version: 1, name: "expandos", globals: ["lookup"] },
        setup(context) {
          node = context.createHostObject({
            properties: { value: { get } },
            ...options.definition,
            expandos: options.expandos ?? { maxKeys: 4, maxKeyCodeUnits: 32 }
          } as HostObjectDefinition);
          return { globals: { lookup: () => node } };
        }
      })
    ]
  });
  return { realm, get };
}

it("preserves guest graphs, aliases, callbacks and distinct symbol identities without host conversion", async () => {
  const { realm, get } = fixture();
  try {
    expect(
      await realm.evaluate(`
      const node = lookup(); const first = Symbol("same"); const second = Symbol("same");
      const value = { nested: { number: 21 } }; const callback = () => value.nested.number * 2;
      node[first] = value; node[second] = callback; node.private = value;
      return [node[first] === value, node[second] === callback, node[second]() === 42,
        node.private === value, first in node, Object.hasOwn(node, first),
        Object.getOwnPropertySymbols(node).length === 2, Object.keys(node).includes("private"),
        ({...node})[first] === value, Object.assign({}, node)[second] === callback,
        delete node[first], !(first in node), node[second]() === 42];
    `)
    ).toMatchObject({ ok: true, returnValue: Array(13).fill(true) });
    expect(get).toHaveBeenCalledTimes(2);
  } finally {
    await realm.close();
  }
});

it("retains guest data when the last local reference to the capability disappears", async () => {
  const { realm } = fixture();
  try {
    expect(
      await realm.evaluate("lookup().private = { count: 40, increment: () => 2 }; return 1;")
    ).toMatchObject({ ok: true });
    expect(
      await realm.evaluate("return lookup().private.count + lookup().private.increment();")
    ).toMatchObject({ ok: true, returnValue: 42 });
  } finally {
    await realm.close();
  }
});

it("counts both symbol and string keys against one limit and permits reuse after deletion", async () => {
  const { realm } = fixture({ expandos: { maxKeys: 2, maxKeyCodeUnits: 20 } });
  try {
    expect(
      await realm.evaluate(`
      const node = lookup(); const key = Symbol("key"); node[key] = 1; node.other = 2;
      let rejected = false; try { node.third = 3; } catch(e) { rejected = e instanceof RangeError; }
      delete node.other; node.third = 3;
      return [rejected, node[key] === 1, node.third === 3];
    `)
    ).toMatchObject({ ok: true, returnValue: [true, true, true] });
  } finally {
    await realm.close();
  }
});

it("counts symbol descriptions against UTF-16 limits before mutating", async () => {
  const { realm } = fixture({ expandos: { maxKeys: 4, maxKeyCodeUnits: 4 } });
  try {
    expect(
      await realm.evaluate(`
      const node = lookup(); const key = Symbol("oversize"); let rejected = false;
      try { node[key] = 1; } catch(e) { rejected = e instanceof RangeError; }
      return [rejected, !(key in node), Object.getOwnPropertySymbols(node).length === 0];
    `)
    ).toMatchObject({ ok: true, returnValue: [true, true, true] });
  } finally {
    await realm.close();
  }
});

it("preserves declared native reads and rejects protected methods, prototypes and indexed names", async () => {
  const { realm, get } = fixture({
    definition: {
      methods: { call: () => 42 },
      indexed: { length: () => 1, get: () => "item", maxLength: 2 }
    }
  });
  try {
    expect(
      await realm.evaluate(`
      const node = lookup(); const names = ["value", "call", "constructor", "prototype", "__proto__", "length", "0"];
      let rejected = 0; for (const name of names) { try { node[name] = 1; } catch(e) { if(e instanceof TypeError) rejected++; } }
      return [rejected === names.length, node.value === "native", node.call() === 42, node[0] === "item"];
    `)
    ).toMatchObject({ ok: true, returnValue: [true, true, true, true] });
    expect(get).toHaveBeenCalledTimes(1);
  } finally {
    await realm.close();
  }
});

it("checks publishing-owner lifetime for existing and absent keys", async () => {
  let closed = false;
  const { realm } = fixture({
    expandos: {
      maxKeys: 4,
      maxKeyCodeUnits: 32,
      assertActive() {
        if (closed) throw new Error("publisher closed");
      }
    }
  });
  try {
    await realm.evaluate("lookup().private = 1;");
    closed = true;
    expect(
      await realm.evaluate(`
      const node = lookup(); let denied = 0;
      for (const operation of [() => node.private, () => node[Symbol()], () => {node.other=2;}, () => delete node.private,
        () => Object.keys(node), () => Object.getOwnPropertySymbols(node), () => "absent" in node]) {
        try { operation(); } catch(e) { if(e.message === "publisher closed") denied++; }
      }
      return denied;
    `)
    ).toMatchObject({ ok: true, returnValue: 7 });
  } finally {
    await realm.close();
  }
});

it("includes hidden guest graphs in retained accounting and releases deleted data", async () => {
  const budget = new Budget({ dataSize: 20000 });
  const { realm } = fixture({ budget });
  try {
    await realm.evaluate('lookup().private = "x".repeat(4096); return 1;');
    await realm.evaluate("return 1;");
    const retained = budget.currentDataSize;
    expect(retained).toBeGreaterThanOrEqual(4096);
    await realm.evaluate("delete lookup().private; return 1;");
    expect(budget.currentDataSize).toBeLessThan(retained - 4000);
  } finally {
    await realm.close();
  }
});

it("keeps guest expando allocations subject to fatal data-size limits", async () => {
  const { realm } = fixture({ budget: new Budget({ dataSize: 10000 }) });
  try {
    const result = await realm
      .evaluate('try { lookup().private = "x".repeat(20000); } catch(e) {} return 1;')
      .catch((error) => ({ ok: false, error }));
    expect(result).toMatchObject({
      ok: false,
      error: { code: "budgetExceeded", budget: "dataSize" }
    });
  } finally {
    await realm.close();
  }
});

it.each([0, -1, 1.5, NaN, Infinity, "2"])("rejects malformed maxKeys %s", (maxKeys) => {
  const { realm } = fixture({ expandos: { maxKeys, maxKeyCodeUnits: 32 } });
  return expect(realm.evaluate("return lookup();"))
    .rejects.toBeInstanceOf(RangeError)
    .finally(() => realm.close());
});

it("isolates guest fields between independently owned realms", async () => {
  const first = fixture().realm,
    second = fixture().realm;
  try {
    await first.evaluate("lookup().private = 42;");
    expect(
      await second.evaluate('return [lookup().private === undefined, !("private" in lookup())];')
    ).toMatchObject({ ok: true, returnValue: [true, true] });
    expect(await first.evaluate("return lookup().private;")).toMatchObject({
      ok: true,
      returnValue: 42
    });
  } finally {
    await first.close();
    await second.close();
  }
});

it.each([0, -1, 1.5, NaN, Infinity, "32"])(
  "rejects malformed maxKeyCodeUnits %s",
  (maxKeyCodeUnits) => {
    const { realm } = fixture({ expandos: { maxKeys: 4, maxKeyCodeUnits } });
    return expect(realm.evaluate("return lookup();"))
      .rejects.toBeInstanceOf(RangeError)
      .finally(() => realm.close());
  }
);

it("rejects expando-definition accessors without invoking them", async () => {
  const getter = vi.fn(() => 4);
  const expandos = Object.defineProperty({ maxKeyCodeUnits: 32 }, "maxKeys", {
    enumerable: true,
    get: getter
  });
  const { realm } = fixture({ expandos });
  try {
    await expect(realm.evaluate("return lookup();")).rejects.toBeInstanceOf(TypeError);
  } finally {
    await realm.close();
  }
  expect(getter).not.toHaveBeenCalled();
});

it("rejects a hook's Promise return without leaking its rejection", async () => {
  const { realm } = fixture({
    expandos: {
      maxKeys: 4,
      maxKeyCodeUnits: 32,
      assertActive() {
        return Promise.reject(new Error("invalid asynchronous guard"));
      }
    }
  });
  try {
    expect(
      await realm.evaluate("try {lookup().private=1;} catch(e) {return e.message;}")
    ).toMatchObject({ ok: true, returnValue: "Guest expando assertActive must return undefined." });
  } finally {
    await realm.close();
  }
});

it("preserves fixed host objects when expandos are omitted", async () => {
  const realm = createRealm({
    extensions: [
      defineExtension({
        manifest: { version: 1, name: "fixed", globals: ["node"] },
        setup(context) {
          return { globals: { node: context.createHostObject({}) } };
        }
      })
    ]
  });
  try {
    expect(
      await realm.evaluate(
        "let count=0; try {node.private=1;} catch(e) {count++;} try {node[Symbol()]=1;} catch(e) {count++;} return count;"
      )
    ).toMatchObject({ ok: true, returnValue: 2 });
  } finally {
    await realm.close();
  }
});
