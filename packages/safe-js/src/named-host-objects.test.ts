import { describe, expect, it, vi } from "vitest";
import {
  Budget,
  createRealm,
  defineExtension,
  type HostObject,
  type HostObjectDefinition
} from "./core.js";
import { deepCopyToSandbox } from "./index.js";

function namedRealm(
  options: {
    named?: unknown;
    enumerable?: boolean;
    indexed?: boolean;
    fixed?: HostObjectDefinition;
    budget?: Budget;
    read?: (name: string, values: Map<string, HostObject>) => unknown;
  } = {}
) {
  const values = new Map<string, HostObject>();
  const indexedValues: HostObject[] = [];
  const keys = vi.fn(() => [...values.keys()]);
  const get = vi.fn((name: string) =>
    options.read ? options.read(name, values) : values.get(name)
  );
  const realm = createRealm({
    budget: options.budget,
    extensions: [
      defineExtension({
        manifest: { version: 1, name: "named", globals: ["attrs", "first", "second"] },
        setup(context) {
          const first = context.createHostObject({ properties: { value: { get: () => "title" } } });
          const second = context.createHostObject({
            properties: { value: { get: () => "hidden" } }
          });
          values.set("title", first);
          values.set("hidden", second);
          indexedValues.push(first, second);
          const attrs = context.createHostObject({
            named: options.named ?? {
              keys,
              get,
              maxKeys: 16,
              maxKeyCodeUnits: 128,
              enumerable: options.enumerable ?? true
            },
            ...(options.indexed
              ? {
                  indexed: {
                    length: () => indexedValues.length,
                    get: (index: number) => indexedValues[index],
                    maxLength: 16
                  }
                }
              : {}),
            ...options.fixed
          } as HostObjectDefinition);
          return { globals: { attrs, first, second } };
        }
      })
    ]
  });
  return { realm, values, keys, get };
}

describe("dynamic named host properties", () => {
  it("accounts for temporary key data even when membership returns only a boolean", async () => {
    const { realm } = namedRealm({
      named: { keys: () => ["x".repeat(2000)], get: () => 1, maxKeys: 1, maxKeyCodeUnits: 4096 },
      budget: new Budget({ dataSize: 1000 })
    });
    try {
      await expect(
        realm.evaluate("try { return 'absent' in attrs; } catch (error) {} return 1;")
      ).rejects.toMatchObject({
        code: "budgetExceeded",
        budget: "dataSize"
      });
    } finally {
      await realm.close();
    }
  });
  it("preserves saved collection and value identity while names change", async () => {
    const { realm, values } = namedRealm();
    try {
      expect(
        await realm.evaluate(
          "const saved = attrs; return [saved.title === first, saved.hidden === second, Object.keys(saved)];"
        )
      ).toMatchObject({ returnValue: [true, true, ["title", "hidden"]] });
      const first = values.get("title")!;
      values.delete("hidden");
      values.set("newName", first);
      expect(
        await realm.evaluate(
          "return [saved.hidden, 'hidden' in saved, saved.newName === first, Object.hasOwn(saved, 'newName')];"
        )
      ).toMatchObject({ returnValue: [undefined, false, true, true] });
    } finally {
      await realm.close();
    }
  });

  it("keeps non-enumerable names visible while numeric indices remain enumerable", async () => {
    const { realm } = namedRealm({ indexed: true, enumerable: false });
    try {
      expect(
        await realm.evaluate(
          "const keys = []; for (const key in attrs) keys.push(key); return [Object.keys(attrs), keys, Object.values(attrs)[0] === first, 'title' in attrs, Object.hasOwn(attrs, 'title'), Object.prototype.propertyIsEnumerable.call(attrs, 'title'), ({ ...attrs })[1] === second, attrs.title === first];"
        )
      ).toMatchObject({
        returnValue: [["0", "1"], ["0", "1"], true, true, true, false, true, true]
      });
    } finally {
      await realm.close();
    }
  });

  it("gives fixed and indexed members precedence without querying names", async () => {
    const { realm, keys, get } = namedRealm({
      indexed: true,
      fixed: { properties: { title: { get: () => "fixed" } }, methods: { method: () => "method" } }
    });
    try {
      expect(
        await realm.evaluate(
          "return [attrs.title, attrs.method(), attrs[0] === first, attrs.length];"
        )
      ).toMatchObject({ returnValue: ["fixed", "method", true, 2] });
      expect(keys).not.toHaveBeenCalled();
      expect(get).not.toHaveBeenCalled();
    } finally {
      await realm.close();
    }
  });

  it("deduplicates fixed/indexed collisions while retaining unrelated names", async () => {
    const { realm, values, get } = namedRealm({
      indexed: true,
      fixed: { properties: { title: { get: () => "fixed" } } }
    });
    try {
      await realm.evaluate("const saved = attrs;");
      values.set("0", values.get("hidden")!);
      values.set("length", values.get("hidden")!);
      expect(
        await realm.evaluate(
          "return [Object.keys(saved), saved[0] === first, saved.title, saved.length];"
        )
      ).toMatchObject({ returnValue: [["0", "1", "title", "hidden"], true, "fixed", 2] });
      expect(get).not.toHaveBeenCalled();
    } finally {
      await realm.close();
    }
  });

  it.each([
    "Object.keys({ ...attrs })",
    "Object.values(attrs).map(value => value.value)",
    "Object.entries(attrs).map(entry => entry[0])"
  ])("observes removal during earlier getters: %s", async (expression) => {
    const { realm, get } = namedRealm({
      read(name, values) {
        if (name === "title") values.delete("hidden");
        return values.get(name);
      }
    });
    try {
      expect(await realm.evaluate(`return ${expression};`)).toMatchObject({
        returnValue: ["title"]
      });
      expect(get.mock.calls.map(([name]) => name)).toEqual(["title"]);
    } finally {
      await realm.close();
    }
  });

  it.each([
    "attrs.title = first;",
    "delete attrs.title;",
    "Object.freeze(attrs);",
    "Object.defineProperty(attrs, 'title', { value: first });"
  ])("rejects named mutation: %s", async (source) => {
    const { realm } = namedRealm();
    try {
      await expect(realm.evaluate(source)).rejects.toThrow();
    } finally {
      await realm.close();
    }
  });

  it.each([
    ["duplicate", () => ["same", "same"]],
    ["sparse", () => new Array(2)],
    ["non-string", () => [1]],
    ["prototype name", () => ["__proto__"]],
    ["constructor name", () => ["constructor"]],
    ["prototype capability", () => ["prototype"]],
    ["async resolve", () => Promise.resolve(["title"])],
    ["async reject", () => Promise.reject(new Error("rejected key provider"))],
    ["too many", () => ["one", "two", "three"]],
    ["too many units", () => ["x".repeat(17)]]
  ])("rejects %s key lists", async (_label, keys) => {
    const get = vi.fn();
    const { realm } = namedRealm({ named: { keys, get, maxKeys: 2, maxKeyCodeUnits: 16 } });
    try {
      await expect(realm.evaluate("return attrs.title;")).rejects.toThrow();
      expect(get).not.toHaveBeenCalled();
    } finally {
      await realm.close();
    }
  });

  it("validates array accessors and proxies without evaluating traps", async () => {
    for (const location of ["index", "extra", "proxy"]) {
      const getter = vi.fn(() => "title");
      const keys = ["title"];
      const input =
        location === "proxy"
          ? new Proxy(keys, { get: getter })
          : Object.defineProperty(keys, location === "index" ? "0" : "extra", { get: getter });
      const { realm } = namedRealm({
        named: { keys: () => input, get: () => 1, maxKeys: 2, maxKeyCodeUnits: 16 }
      });
      try {
        await expect(realm.evaluate("attrs.title;")).rejects.toThrow();
        expect(getter).not.toHaveBeenCalled();
      } finally {
        await realm.close();
      }
    }
  });

  it("counts UTF-16 code units rather than Unicode code points", async () => {
    const { realm } = namedRealm({
      named: { keys: () => ["😀"], get: () => 1, maxKeys: 1, maxKeyCodeUnits: 1 }
    });
    try {
      await expect(realm.evaluate("Object.keys(attrs);")).rejects.toThrow(/code units/);
    } finally {
      await realm.close();
    }
  });

  it("rejects asynchronous value providers without an unhandled rejection", async () => {
    const { realm } = namedRealm({
      read: () => Promise.reject(new Error("rejected value provider"))
    });
    try {
      await expect(realm.evaluate("attrs.title;")).rejects.toThrow(/synchronous/);
    } finally {
      await realm.close();
    }
  });

  it("keeps retained-data accounting callback-free and copy boundaries explicit", async () => {
    const { realm, keys, get } = namedRealm({ budget: new Budget({ dataSize: 2000 }) });
    try {
      const result = await realm.evaluate("const saved = attrs; return saved;");
      expect(keys).not.toHaveBeenCalled();
      expect(get).not.toHaveBeenCalled();
      if (!result.ok) throw new Error("Named fixture failed");
      expect(() => deepCopyToSandbox(result.returnValue)).toThrow(/Live capabilities/);
    } finally {
      await realm.close();
    }
    const reads = keys.mock.calls.length;
    await expect(realm.evaluate("saved.title;")).rejects.toThrow(/closed/);
    expect(keys).toHaveBeenCalledTimes(reads);
  });

  it("charges validation work even when an invalid key list is caught", async () => {
    const keys = Array.from({ length: 100 }, (_entry, index) => `key${index}`);
    keys.push("key0");
    const { realm } = namedRealm({
      named: { keys: () => keys, get: () => 1, maxKeys: 128, maxKeyCodeUnits: 1024 },
      budget: new Budget({ maxSteps: 32 })
    });
    try {
      await expect(
        realm.evaluate("try { attrs.title; } catch (error) {} return 1;")
      ).rejects.toMatchObject({ code: "budgetExceeded", budget: "steps" });
    } finally {
      await realm.close();
    }
  });

  it.each([
    ["maxKeys", 0],
    ["maxKeys", -1],
    ["maxKeys", 1.5],
    ["maxKeys", 65537],
    ["maxKeyCodeUnits", 0],
    ["maxKeyCodeUnits", Infinity],
    ["maxKeyCodeUnits", 1048577],
    ["enumerable", "false"],
    ["enumerable", null]
  ])("rejects invalid declaration %s=%s before provider calls", async (field, value) => {
    const keys = vi.fn(() => []);
    const { realm } = namedRealm({
      named: { keys, get: () => 1, maxKeys: 16, maxKeyCodeUnits: 128, [field as string]: value }
    });
    try {
      await expect(realm.evaluate("return 1;")).rejects.toThrow();
      expect(keys).not.toHaveBeenCalled();
    } finally {
      await realm.close();
    }
  });

  it("validates declaration accessors without invoking them", async () => {
    const getter = vi.fn(() => () => []);
    const named = Object.defineProperty(
      { get: () => 1, maxKeys: 16, maxKeyCodeUnits: 128 },
      "keys",
      { get: getter }
    );
    const { realm } = namedRealm({ named });
    try {
      await expect(realm.evaluate("return 1;")).rejects.toThrow(/accessors/);
      expect(getter).not.toHaveBeenCalled();
    } finally {
      await realm.close();
    }
  });

  it("does not invoke get for absent names or native prototype capabilities", async () => {
    const { realm, get } = namedRealm();
    try {
      expect(
        await realm.evaluate(
          "return [attrs.absent, attrs.constructor, attrs.__proto__, 'absent' in attrs, Object.hasOwn(attrs, 'absent')];"
        )
      ).toMatchObject({ returnValue: [undefined, undefined, undefined, false, false] });
      expect(get).not.toHaveBeenCalled();
    } finally {
      await realm.close();
    }
  });

  it("applies array limits to the combined indexed and named enumeration", async () => {
    const { realm } = namedRealm({ indexed: true, budget: new Budget({ arrayLength: 2 }) });
    try {
      await expect(realm.evaluate("Object.keys(attrs);")).rejects.toMatchObject({
        code: "budgetExceeded",
        budget: "arrayLength"
      });
    } finally {
      await realm.close();
    }
  });

  it("applies normal string limits to provider keys", async () => {
    const { realm } = namedRealm({
      named: { keys: () => ["x".repeat(64)], get: () => 1, maxKeys: 1, maxKeyCodeUnits: 128 },
      budget: new Budget({ stringLength: 32 })
    });
    try {
      await expect(realm.evaluate("Object.keys(attrs);")).rejects.toMatchObject({
        code: "budgetExceeded",
        budget: "stringLength"
      });
    } finally {
      await realm.close();
    }
  });

  it("rejects foreign capabilities from named getters", async () => {
    const foreign = namedRealm();
    const value = await foreign.realm.evaluate("return first;");
    if (!value.ok) throw new Error("Foreign named fixture failed");
    const local = namedRealm({ read: () => value.returnValue });
    try {
      await expect(local.realm.evaluate("attrs.title;")).rejects.toThrow(/Foreign realm/);
    } finally {
      await local.realm.close();
      await foreign.realm.close();
    }
  });
});
