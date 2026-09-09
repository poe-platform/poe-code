import { expect, it } from "vitest";
import { runtimeBinary } from "./runtime-binary.js";
import { RuntimeValues, type RuntimeValue } from "./runtime-values.js";
import { ExecutionBudget, ExecutionLimitError } from "./execution-budget.js";
import { constructRuntimeDictionary } from "./runtime-dictionary-update.js";
import { bytesPercentFormat } from "./bytes-percent-format.js";
import { createRuntimePercentConversionContext } from "./runtime-percent-conversion.js";
import { createRuntimeRepresentationContext } from "./runtime-representation.js";
import { createRuntimePercentBindingContext } from "./runtime-percent-binding.js";

function fixture() {
  const meter = new ExecutionBudget({ maxSteps: 100000, maxAllocatedBytes: 1000000 }), v = new RuntimeValues(meter);
  const bytes = (s: string) => v.bytes(Uint8Array.from([...s].map(c => c.charCodeAt(0))));
  const format = (s: string, arg: RuntimeValue) => runtimeBinary("%", bytes(s), arg, v, meter);
  return { meter, v, bytes, format };
}
const text = (value: RuntimeValue) => { if (value.kind !== "bytes") throw Error("expected bytes"); return String.fromCharCode(...value.value); };
it("dispatches mixed bytes fields before operand family guards", () => {
  const { v, bytes, format } = fixture();
  expect(text(format("[%#x|%+.2f|%b|%r|%c]", v.tuple([v.integer(255), v.float(1.25), bytes("hi"), v.string("é"), v.integer(255)])))).toBe("[0xff|+1.25|hi|'\\xe9'|\xff]");
  expect(text(format("%a", v.list([v.true, v.none])))).toBe("[True, None]");
});
it("returns fresh multi-byte objects even when storage can be shared", () => {
  const { v, bytes, format, meter } = fixture(), value = bytes("hello");
  for (const source of ["%b", "%s", "%5b", "%.10b"]) {
    const result = format(source, value);
    expect(text(result)).toBe("hello");
    expect(result).not.toBe(value);
  }
  const literal = runtimeBinary("%", value, v.tuple([]), v, meter);
  expect(text(literal)).toBe("hello");
  expect(literal).not.toBe(value);
  expect(format("%b", bytes("x"))).toBe(bytes("x"));
  expect(format("%.0b", value)).toBe(bytes(""));
});
it("uses bytes mapping keys without treating bytes as a mapping operand", () => {
  const { v, bytes, format, meter } = fixture();
  const keys = { hash: () => 1n, equal: (a: RuntimeValue, b: RuntimeValue) => a.kind === "bytes" && b.kind === "bytes" && text(a) === text(b) };
  const d = constructRuntimeDictionary([], new Map(), v, keys, meter);
  d.items.set(bytes("n"), v.integer(12));
  expect(text(format("%(n)04d", d))).toBe("0012");
  expect(text(format("%(n)d", v.mappingProxy(d)))).toBe("12");
  expect(() => format("%(n)d", bytes("n"))).toThrow("format requires a mapping");
});
it("preserves conversion and binding diagnostics", () => {
  const { v, format } = fixture();
  expect(() => format("%b", v.integer(3))).toThrow("%b requires a bytes-like object");
  expect(() => format("%s", v.string("x"))).toThrow("%b requires a bytes-like object");
  expect(() => format("%f", v.string("x"))).toThrow("float argument required, not str");
  expect(() => format("%q", v.tuple([]))).toThrow("not enough arguments");
  expect(() => format("%d", v.tuple([v.integer(1), v.integer(2)]))).toThrow("not all arguments converted during bytes formatting");
});
it("exposes guest bytes slots, bytearray snapshots and buffer capabilities", () => {
  const { v, bytes, meter } = fixture(), guest = v.cell({}), payload = bytes("guest");
  for (const hook of ["byteString", "byteArray", "lookupBytes", "bufferBytes"] as const) {
    const context = {
      ...createRuntimePercentConversionContext(meter, {
        [hook]: () => hook === "lookupBytes" ? () => payload : payload.value,
        warn() { throw Error("unexpected warning"); }
      }),
      ...createRuntimeRepresentationContext(v, meter, { defaultRepr() { throw Error("unexpected default"); } }),
      ...createRuntimePercentBindingContext(v, meter),
      bytesValue: v.bytes.bind(v)
    };
    expect(text(bytesPercentFormat(bytes("%8.3b"), guest, context, meter))).toBe("     gue");
  }
});
it("constructs output only after surplus validation and checks cancellation", () => {
  const { v, bytes, meter } = fixture();
  let constructed = false;
  const context = {
    ...createRuntimePercentConversionContext(meter),
    ...createRuntimeRepresentationContext(v, meter, { defaultRepr() { throw Error("unexpected default"); } }),
    ...createRuntimePercentBindingContext(v, meter),
    bytesValue: () => { constructed = true; return bytes("done"); }
  };
  expect(() => bytesPercentFormat(bytes("%d"), v.tuple([v.integer(1), v.integer(2)]), context, meter)).toThrow("not all arguments converted");
  expect(constructed).toBe(false);
  const cancellable = { checkpoint() { if (constructed) throw new ExecutionLimitError("cancelled"); } };
  expect(() => bytesPercentFormat(bytes("%d"), v.integer(1), context, cancellable)).toThrow(ExecutionLimitError);
});
