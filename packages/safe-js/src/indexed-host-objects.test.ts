import { describe, expect, it, vi } from "vitest";
import {
  Budget,
  createRealm,
  defineExtension,
  type HostObject,
  type HostObjectDefinition
} from "./core.js";
import { deepCopyToSandbox } from "./index.js";

function collectionRealm(
  options: {
    indexed?: unknown;
    definition?: Partial<HostObjectDefinition>;
    budget?: Budget;
    read?: (index: number, contents: HostObject[]) => unknown;
  } = {}
) {
  const contents: HostObject[] = [];
  const length = vi.fn(() => contents.length);
  const get = vi.fn((index: number) =>
    options.read ? options.read(index, contents) : contents[index]
  );
  const realm = createRealm({
    budget: options.budget,
    extensions: [
      defineExtension({
        manifest: { version: 1, name: "indexed", globals: ["items", "first", "second", "trim"] },
        setup(context) {
          const first = context.createHostObject({ properties: { label: { get: () => "first" } } });
          const second = context.createHostObject({
            properties: { label: { get: () => "second" } }
          });
          contents.push(first, second);
          const items = context.createHostObject({
            indexed: options.indexed ?? { length, get, maxLength: 8 },
            ...options.definition
          } as HostObjectDefinition);
          return {
            globals: {
              items,
              first,
              second,
              trim: () => {
                contents.length = 1;
              }
            }
          };
        }
      })
    ]
  });
  return { realm, contents, length, get };
}

describe("indexed live host objects", () => {
  it("reads live contents through saved collections without losing element identity", async () => {
    const { realm, contents, length } = collectionRealm();
    expect(length).not.toHaveBeenCalled();
    try {
      expect(
        await realm.evaluate(
          "const saved = items; return [saved.length, saved[0] === first, saved[1] === second];"
        )
      ).toMatchObject({ returnValue: [2, true, true] });
      contents.shift();
      expect(
        await realm.evaluate("return [saved.length, saved[0] === second, saved[1]];")
      ).toMatchObject({ returnValue: [1, true, undefined] });
    } finally {
      await realm.close();
    }
  });

  it("does not query element getters for noncanonical or out-of-range keys", async () => {
    const { realm, get } = collectionRealm();
    try {
      expect(
        await realm.evaluate(
          "return [items[-1], items['01'], items['1.0'], items['-0'], items['+1'], items[2], items[100000], items.constructor, items.__proto__];"
        )
      ).toMatchObject({ returnValue: Array(9).fill(undefined) });
      expect(get).not.toHaveBeenCalled();
    } finally {
      await realm.close();
    }
  });

  it("supports own keys, membership and generic own-property inspection", async () => {
    const { realm, get } = collectionRealm();
    try {
      expect(
        await realm.evaluate(
          "return [Object.keys(items), '0' in items, '2' in items, 'length' in items, Object.hasOwn(items, '1'), Object.hasOwn(items, 'length'), Object.prototype.propertyIsEnumerable.call(items, 'length')];"
        )
      ).toMatchObject({ returnValue: [["0", "1"], true, false, true, true, true, false] });
      expect(get).not.toHaveBeenCalled();
    } finally {
      await realm.close();
    }
  });

  it("preserves shallow identity in iteration, Array.from, values and spread", async () => {
    const { realm } = collectionRealm();
    try {
      expect(
        await realm.evaluate(
          "const collected = []; for (const item of items) collected.push(item); const array = Array.from(items); const values = Object.values(items); const spread = { ...items }; return [collected[0] === first, array[1] === second, values[0] === first, spread[1] === second, Array.from(items, item => item.label)];"
        )
      ).toMatchObject({ returnValue: [true, true, true, true, ["first", "second"]] });
    } finally {
      await realm.close();
    }
  });

  it("skips indices removed by an earlier getter during object spread", async () => {
    const { realm, get } = collectionRealm({
      read(index, contents) {
        if (index === 0) contents.length = 1;
        return contents[index];
      }
    });
    try {
      expect(await realm.evaluate("return Object.keys({ ...items });")).toMatchObject({
        returnValue: ["0"]
      });
      expect(get.mock.calls.map(([index]) => index)).toEqual([0]);
    } finally {
      await realm.close();
    }
  });

  it.each([
    "items[0] = first;",
    "items.length = 1;",
    "delete items[0];",
    "Object.freeze(items);",
    "Object.defineProperty(items, '0', { value: first });"
  ])("rejects unsupported mutation: %s", async (source) => {
    const { realm } = collectionRealm();
    try {
      await expect(realm.evaluate(source)).rejects.toThrow();
    } finally {
      await realm.close();
    }
  });

  it.each([-1, 1.5, NaN, Infinity, 9, "2", Promise.resolve(2)])(
    "rejects invalid live length %s",
    async (value) => {
      const get = vi.fn();
      const { realm } = collectionRealm({ indexed: { maxLength: 8, length: () => value, get } });
      try {
        await expect(realm.evaluate("return items.length;")).rejects.toThrow();
        expect(get).not.toHaveBeenCalled();
      } finally {
        await realm.close();
      }
    }
  );

  it.each([0, -1, 1.5, 65537, Infinity])(
    "rejects maximum length %s during setup",
    async (maxLength) => {
      const { realm } = collectionRealm({
        indexed: { maxLength, length: () => 0, get: () => undefined }
      });
      try {
        await expect(realm.evaluate("return 1;")).rejects.toThrow(/maxLength/);
      } finally {
        await realm.close();
      }
    }
  );

  it.each(["length", "0", "99999"])("rejects conflicting fixed member %s", async (name) => {
    const { realm } = collectionRealm({ definition: { properties: { [name]: { get: () => 1 } } } });
    try {
      await expect(realm.evaluate("return 1;")).rejects.toThrow(/Conflicting indexed/);
    } finally {
      await realm.close();
    }
  });

  it("enforces array limits during enumeration", async () => {
    const { realm } = collectionRealm({ budget: new Budget({ arrayLength: 1 }) });
    try {
      await expect(realm.evaluate("return Object.keys(items);")).rejects.toMatchObject({
        code: "budgetExceeded",
        budget: "arrayLength"
      });
    } finally {
      await realm.close();
    }
  });

  it("revokes saved access on close without more host callbacks", async () => {
    const { realm, get, length } = collectionRealm();
    await realm.evaluate("const saved = items;");
    await realm.close();
    const reads = length.mock.calls.length;
    await expect(realm.evaluate("saved[0];")).rejects.toThrow(/closed/);
    expect(length).toHaveBeenCalledTimes(reads);
    expect(get).not.toHaveBeenCalled();
  });

  it("does not query host length during retained-data accounting", async () => {
    const { realm, length, get } = collectionRealm();
    try {
      await realm.evaluate("const saved = items;");
      expect(length).not.toHaveBeenCalled();
      expect(get).not.toHaveBeenCalled();
    } finally {
      await realm.close();
    }
  });

  it("keeps for-in and coercible membership keys getter-free", async () => {
    const { realm, get } = collectionRealm();
    try {
      expect(
        await realm.evaluate(
          "const keys = []; for (const key in items) keys.push(key); return [keys, { toString() { return '0'; } } in items];"
        )
      ).toMatchObject({ returnValue: [["0", "1"], true] });
      expect(get).not.toHaveBeenCalled();
    } finally {
      await realm.close();
    }
  });

  it("checks live length between iterator reads", async () => {
    const { realm, get } = collectionRealm({
      read(index, contents) {
        contents.length = 1;
        return contents[index];
      }
    });
    try {
      expect(
        await realm.evaluate(
          "const values = []; for (const item of items) values.push(item.label); return values;"
        )
      ).toMatchObject({ returnValue: ["first"] });
      expect(get.mock.calls.map(([index]) => index)).toEqual([0]);
    } finally {
      await realm.close();
    }
  });

  it("rejects asynchronous element getters", async () => {
    const { realm } = collectionRealm({ read: async () => 1 });
    try {
      await expect(realm.evaluate("return items[0];")).rejects.toThrow(/synchronous/);
    } finally {
      await realm.close();
    }
  });

  it("validates indexed configuration passively", async () => {
    const getter = vi.fn(() => () => 0);
    const indexed = Object.defineProperty({ maxLength: 8, get: () => undefined }, "length", {
      get: getter
    });
    const { realm } = collectionRealm({ indexed });
    try {
      await expect(realm.evaluate("return 1;")).rejects.toThrow(/accessors/);
      expect(getter).not.toHaveBeenCalled();
    } finally {
      await realm.close();
    }
  });

  it("interleaves Array.from mapping with live reads", async () => {
    const { realm, get } = collectionRealm();
    try {
      expect(
        await realm.evaluate("return Array.from(items, item => { trim(); return item.label; });")
      ).toMatchObject({ returnValue: ["first"] });
      expect(get.mock.calls.map(([index]) => index)).toEqual([0]);
    } finally {
      await realm.close();
    }
  });

  it("validates Array.from mappers before reading elements", async () => {
    const { realm, get } = collectionRealm();
    try {
      await expect(realm.evaluate("Array.from(items, 1);")).rejects.toThrow(/mapping callback/);
      expect(get).not.toHaveBeenCalled();
    } finally {
      await realm.close();
    }
  });

  it("does not eagerly allocate or query a maximum-sized virtual collection", async () => {
    const length = vi.fn(() => 65536);
    const get = vi.fn();
    const { realm } = collectionRealm({
      indexed: { length, get, maxLength: 65536 },
      budget: new Budget({ maxSteps: 100, dataSize: 1000 })
    });
    try {
      expect(await realm.evaluate("const saved = items; return typeof saved;")).toMatchObject({
        returnValue: "object"
      });
      expect(length).not.toHaveBeenCalled();
      expect(get).not.toHaveBeenCalled();
    } finally {
      await realm.close();
    }
  });

  it("rejects foreign capabilities returned from indexed getters", async () => {
    const foreign = collectionRealm();
    const first = await foreign.realm.evaluate("return first;");
    if (!first.ok) throw new Error("Foreign fixture failed");
    const local = collectionRealm({ read: () => first.returnValue });
    try {
      await expect(local.realm.evaluate("return items[0];")).rejects.toThrow(/Foreign realm/);
    } finally {
      await local.realm.close();
      await foreign.realm.close();
    }
  });

  it("keeps live collections outside plain-data copy boundaries", async () => {
    const { realm } = collectionRealm();
    try {
      const result = await realm.evaluate("return items;");
      if (!result.ok) throw new Error("Collection fixture failed");
      expect(() => deepCopyToSandbox(result.returnValue)).toThrow(/Live capabilities/);
    } finally {
      await realm.close();
    }
  });
});
