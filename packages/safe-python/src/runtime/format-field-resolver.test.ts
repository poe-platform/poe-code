import { expect, it } from "vitest";
import { FormatFieldResolver, type FormatFieldHooks } from "./format-field-resolver.js";
import { CodePointString } from "./code-point-string.js";
import { ExecutionBudget, ExecutionLimitError } from "./execution-budget.js";

const text = (value: string) => new CodePointString(Uint32Array.from(value, c => c.codePointAt(0)!));
const host = (value: CodePointString) => String.fromCodePoint(...value);
function fixture(positional: readonly string[] | null = ["first", "second", "third"]) {
  const meter = new ExecutionBudget({ maxSteps: 10000, maxAllocatedBytes: 100000 });
  const events: unknown[] = [];
  const hooks: FormatFieldHooks<string> = {
    keyword(name) { events.push(["keyword", host(name)]); return "named"; },
    attribute(value, name) { events.push(["attribute", value, host(name)]); return value + "." + host(name); },
    item(value, key) { events.push(["item", value, typeof key === "bigint" ? key : host(key)]); return "item"; }
  };
  const resolver = new FormatFieldResolver(positional, hooks, meter);
  return { resolver, hooks, events, meter, resolve: (name: string) => resolver.resolve(text(name)) };
}
it("shares automatic numbering while named arguments leave the counter unchanged", () => {
  const { resolve, events } = fixture();
  expect(resolve("")).toBe("first");
  expect(resolve("name")).toBe("named");
  expect(resolve("")).toBe("second");
  expect(resolve("[0]")).toBe("item");
  expect(events).toEqual([["keyword", "name"], ["item", "third", 0n]]);
  expect(() => resolve("")).toThrow("Replacement index 3 out of range for positional args tuple");
});
it("enforces both numbering transitions before lookup and positional bounds", () => {
  const automatic = fixture(); automatic.resolve("");
  expect(() => automatic.resolve("0")).toThrow("cannot switch from automatic field numbering to manual field specification");
  const manual = fixture(); expect(manual.resolve("٢")).toBe("third");
  expect(manual.resolve("name")).toBe("named");
  expect(() => manual.resolve("")).toThrow("cannot switch from manual field specification to automatic field numbering");
  expect(() => fixture().resolve("9223372036854775807")).toThrow("Replacement index 9223372036854775807 out of range for positional args tuple");
});
it("walks attributes and items through explicit hooks in source order", () => {
  const { resolve, events } = fixture();
  expect(resolve("0.a[٢][text].z")).toBe("item.z");
  expect(events).toEqual([["attribute", "first", "a"], ["item", "first.a", 2n], ["item", "item", "text"], ["attribute", "item", "z"]]);
});
it("rejects positional map fields without invoking mapping hooks", () => {
  for (const name of ["", "0", "٢", ".a", "[0]"]) {
    const { resolve, events } = fixture(null);
    expect(() => resolve(name)).toThrow("Format string contains positional fields");
    expect(events).toEqual([]);
  }
  const { resolve, events } = fixture(null);
  expect(resolve("name[0]")).toBe("item");
  expect(events).toEqual([["keyword", "name"], ["item", "named", 0n]]);
});
it("preserves guest exceptions before malformed suffixes and checks after callbacks", () => {
  const { resolve, hooks, events } = fixture();
  const error = Error("guest lookup");
  hooks.keyword = () => { throw error; };
  expect(() => resolve("name[]")).toThrow(error);
  hooks.item = () => { throw error; };
  expect(() => resolve("0[x]invalid")).toThrow(error);
  expect(events).toEqual([]);
  const controller = new AbortController();
  const meter = new ExecutionBudget({ maxSteps: 10000, maxAllocatedBytes: 100000, signal: controller.signal });
  const resolver = new FormatFieldResolver(null, { ...hooks, keyword() { controller.abort(); return "value"; } }, meter);
  expect(() => resolver.resolve(text("name"))).toThrow(ExecutionLimitError);
});
it("uses spans without losing code-point offsets or copying positional arguments", () => {
  const { resolver } = fixture();
  expect(resolver.resolve(text("😀{1}tail"), 2, 3)).toBe("second");
  const meter = new ExecutionBudget({ maxSteps: 1000, maxAllocatedBytes: 10000 });
  const value = {}, unused = (): never => { throw Error("unused"); };
  expect(new FormatFieldResolver([value], { keyword: unused, attribute: unused, item: unused }, meter).resolve(text("0"))).toBe(value);
});
