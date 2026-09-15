import { expect, it } from "vitest";
import { bindPercentFormat, type PercentFormatBindingContext } from "./percent-format-bind.js";
import { ExecutionBudget, ExecutionLimitError } from "./execution-budget.js";
import { RuntimeValues } from "./runtime-values.js";

const tuple = (...items: unknown[]) => ({ tuple: items });
function fixture() {
  const meter = new ExecutionBudget({ maxSteps: 10000, maxAllocatedBytes: 100000 }), v = new RuntimeValues(meter), events: string[] = [];
  const context: PercentFormatBindingContext<unknown> = {
    tupleItems: value => typeof value === "object" && value !== null && "tuple" in value ? (value as ReturnType<typeof tuple>).tuple : undefined,
    isMapping: value => value instanceof Map,
    mappingItem(value, source, start, end) {
      const key = Array.from(source).slice(start, end).map(point => String.fromCodePoint(point)).join(""); events.push(key);
      const map = value as Map<string, unknown>; if (!map.has(key)) throw new Error("missing " + key); return map.get(key);
    },
    integer: value => typeof value === "bigint" ? value : typeof value === "boolean" ? BigInt(Number(value)) : undefined
  };
  const bind = (format: string, args: unknown) => bindPercentFormat(v.string(format).value, args, context, meter);
  return { meter, v, context, events, bind };
}
it("binds tuple operands in order and normalizes dynamic dimensions", () => {
  const { bind } = fixture();
  const fields = [...bind("%*.*s %s", tuple(-4n, 2n, "a", "b"))].filter(event => event.kind === "conversion");
  expect(fields.map(field => field.argument)).toEqual(["a", "b"]);
  expect(fields[0]).toMatchObject({ width: 4n, precision: 2n, flags: { left: true } });
  expect(fields[1]).toMatchObject({ width: 0n, precision: null, flags: { left: false } });
});
it("consumes a non-tuple scalar once and reports surplus after the last conversion", () => {
  const { bind } = fixture();
  expect(() => [...bind("%s %s", "x")]).toThrow("not enough arguments for format string");
  const cursor = bind("%s", tuple("x", "y")); expect(cursor.next().value).toMatchObject({ kind: "conversion", argument: "x" });
  expect(() => cursor.next()).toThrow("not all arguments converted during string formatting");
  expect(() => [...bind("plain", 1n)]).toThrow("not all arguments converted during string formatting");
  expect([...bind("plain", tuple())]).toEqual([{ kind: "literal", start: 0, end: 5 }]);
});
it("looks up mapping fields lazily and treats mapped tuples as single arguments", () => {
  const { bind, events } = fixture(), mapped = tuple("a", "b"), args = new Map([["😀(x)", mapped]]);
  const cursor = bind("%(😀(x))s %(😀(x))s", args); expect(events).toEqual([]);
  expect(cursor.next().value).toMatchObject({ kind: "conversion", argument: mapped }); expect(events).toEqual(["😀(x)"]);
  expect([...cursor].filter(event => event.kind === "conversion")).toHaveLength(1); expect(events).toEqual(["😀(x)", "😀(x)"]);
  expect([...bind("plain", args)]).toEqual([{ kind: "literal", start: 0, end: 5 }]);
});
it("retains the original mapping while resetting positional consumption after each key", () => {
  const { bind } = fixture(), args = new Map([["x", "a"]]);
  expect([...bind("%s %(x)s", args)].filter(event => event.kind === "conversion").map(field => field.argument)).toEqual([args, "a"]);
  expect(() => [...bind("%(x)s %s", args)]).toThrow("not enough arguments for format string");
  expect(() => [...bind("%(x)*s", new Map([["x", 3n]]))]).toThrow("not enough arguments for format string");
});
it("performs mapping and dynamic argument actions before later scanner errors", () => {
  const { bind } = fixture();
  expect(() => [...bind("%(", 1n)]).toThrow("format requires a mapping");
  expect(() => [...bind("%(", new Map())]).toThrow("incomplete format key");
  expect(() => [...bind("%*", tuple())]).toThrow("not enough arguments for format string");
  expect(() => [...bind("%*", 1.5)]).toThrow("* wants int");
  expect(() => [...bind("%*", 1n)]).toThrow("incomplete format");
  expect(() => [...bind("%q", tuple())]).toThrow("not enough arguments for format string");
  expect([...bind("%q", 1n)][0]).toMatchObject({ kind: "conversion", code: 113, argument: 1n });
});
it("uses native integer widths, C-int precisions and signed-minimum width behavior", () => {
  const { bind } = fixture();
  expect(() => [...bind("%*s", tuple(1n << 63n, "x"))]).toThrow("Python int too large to convert to C ssize_t");
  expect(() => [...bind("%.*s", tuple(1n << 31n, "x"))]).toThrow("Python int too large to convert to C int");
  expect([...bind("%*.*s", tuple(-(1n << 63n), -1n, "x"))][0]).toMatchObject({ width: 0n, precision: 0n, flags: { left: true } });
  expect([...bind("%*s", tuple(true, "x"))][0]).toMatchObject({ width: 1n });
});
it("uses bytes-specific surplus argument diagnostics", () => {
  const { v, meter, context } = fixture();
  const source = v.bytes(Uint8Array.of(120)).value;
  expect(() => [...bindPercentFormat(source, 1n, context, meter)]).toThrow("not all arguments converted during bytes formatting");
});
it("does not publish a mapped value after guest callback cancellation", () => {
  const { v, context } = fixture(); let cancelled = false;
  context.mappingItem = () => { cancelled = true; return "x"; };
  const meter = { checkpoint() { if (cancelled) throw new ExecutionLimitError("cancelled"); } };
  const cursor = bindPercentFormat(v.string("%(x)s").value, new Map(), context, meter);
  expect(() => cursor.next()).toThrow(ExecutionLimitError);
});
