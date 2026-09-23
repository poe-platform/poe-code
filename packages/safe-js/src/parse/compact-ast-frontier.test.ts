import { expect, it, vi } from "vitest";
import { CompactModuleAst } from "./compact-module-ast.js";

it("finishes compiler descendants before queueing a wide row of siblings", () => {
  let opened = 0;
  const items = Array.from({ length: 2000 }, (_, index) => ({
    get nested() {
      opened++;
      return {
        get value() {
          expect(opened).toBe(index + 1);
          return index;
        }
      };
    }
  }));
  const storage = new CompactModuleAst(" ".repeat(20000));
  const packed = storage.pack({ items });
  storage.finish();
  expect(packed).toEqual({ items: items.map((_, value) => ({ nested: { value } })) });
});

it("releases consumed parser array entries before packing their descendants", () => {
  const items = Array.from({ length: 2000 }, (_, index) => ({
    nested: {
      get value() {
        expect(items[index] === undefined).toBe(true);
        return index;
      }
    }
  }));
  const storage = new CompactModuleAst(" ".repeat(20000));
  const packed = storage.pack({ items }, false, true);
  storage.finish();
  expect(items.every((item) => item === undefined)).toBe(true);
  expect(packed.items).toEqual(Array.from({ length: 2000 }, (_, value) => ({ nested: { value } })));
});

it("pins retirement property writes against later native hooks", () => {
  const items = new Array<unknown>(2);
  items[1] = { value: 7 };
  const storage = new CompactModuleAst(" ".repeat(1000));
  const hook = vi.spyOn(Reflect, "defineProperty").mockImplementation(() => {
    throw new Error("Compiler array reached a later native hook");
  });
  let packed: { items: unknown[] };
  try {
    packed = storage.pack({ items }, false, true);
    expect(hook).not.toHaveBeenCalled();
  } finally {
    hook.mockRestore();
  }
  storage.finish();
  expect(packed!.items).toEqual([undefined, { value: 7 }]);
  expect(items).toEqual([undefined, undefined]);
});

it.each([false, true])(
  "preserves aliases and cycles across sibling compiler rows (retire=%s)",
  (retire) => {
    const shared = { value: -0 };
    const first: { shared: typeof shared; other?: object } = { shared };
    const second = { shared, other: first };
    first.other = second;
    const storage = new CompactModuleAst(" ".repeat(1000));
    const packed = storage.pack({ items: [first, second] }, false, retire);
    storage.finish();
    expect(packed.items[0]!.other).toBe(packed.items[1]);
    expect(packed.items[1]!.other).toBe(packed.items[0]);
    expect(packed.items[0]!.shared).toBe(packed.items[1]!.shared);
    expect(Object.is(packed.items[0]!.shared.value, -0)).toBe(true);
  }
);
