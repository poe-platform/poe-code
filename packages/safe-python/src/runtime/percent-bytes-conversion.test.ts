import { expect, it } from "vitest";
import { percentBytes, type PercentBytesContext } from "./percent-bytes-conversion.js";
import { ImmutableBytes } from "./immutable-bytes.js";
import { ExecutionBudget, ExecutionLimitError } from "./execution-budget.js";
import { PythonRuntimeError } from "./error.js";

type Value = { name: string; bytes?: ImmutableBytes; array?: ImmutableBytes; buffer?: ImmutableBytes; method?: () => Value };
function fixture() {
  const meter = new ExecutionBudget({ maxSteps: 100000, maxAllocatedBytes: 1000000 }), trace: string[] = [];
  const storage = ImmutableBytes.copyOf([0, 128, 255], meter);
  const context: PercentBytesContext<Value> = {
    byteString: value => { trace.push("bytes:" + value.name); return value.bytes; },
    byteArray: value => { trace.push("array:" + value.name); return value.array; },
    lookupBytes: value => { trace.push("lookup:" + value.name); return value.method; },
    bufferBytes: value => { trace.push("buffer:" + value.name); return value.buffer; },
    typeName: value => value.name
  };
  return { meter, trace, storage, context };
}
it("bypasses overrides and buffer access for native bytes and bytearray subclasses", () => {
  const { meter, trace, storage, context } = fixture();
  const method = () => { throw Error("must not call"); };
  expect(percentBytes({ name: "B", bytes: storage, method }, context, meter)).toBe(storage);
  expect(trace).toEqual(["bytes:B"]);
  trace.length = 0;
  expect(percentBytes({ name: "A", array: storage, method }, context, meter)).toBe(storage);
  expect(trace).toEqual(["bytes:A", "array:A"]);
});
it("prefers the bound bytes slot over the buffer and accepts bytes subclass results", () => {
  const { meter, trace, storage, context } = fixture();
  const result = { name: "B", bytes: storage };
  expect(percentBytes({ name: "C", buffer: storage, method: () => { trace.push("call"); return result; } }, context, meter)).toBe(storage);
  expect(trace).toEqual(["bytes:C", "array:C", "lookup:C", "call", "bytes:B"]);
});
it("rejects non-bytes slot results without trying their arrays or buffers", () => {
  const { meter, trace, storage, context } = fixture();
  expect(() => percentBytes({ name: "C", buffer: storage, method: () => ({ name: "bytearray", array: storage }) }, context, meter)).toThrow("__bytes__ returned non-bytes (type bytearray)");
  expect(trace).toEqual(["bytes:C", "array:C", "lookup:C", "bytes:bytearray"]);
});
it("uses buffer extraction only for an absent bytes slot", () => {
  const { meter, trace, storage, context } = fixture();
  expect(percentBytes({ name: "memoryview", buffer: storage }, context, meter)).toBe(storage);
  expect(trace).toEqual(["bytes:memoryview", "array:memoryview", "lookup:memoryview", "buffer:memoryview"]);
});
it("rejects unsupported operands with the b diagnostic shared by s", () => {
  const { meter, context } = fixture();
  for (const name of ["int", "str", "list", "NoneType"]) {
    expect(() => percentBytes({ name }, context, meter)).toThrow(`%b requires a bytes-like object, or an object that implements __bytes__, not '${name}'`);
  }
  expect(() => percentBytes({ name: "é".repeat(80) }, context, meter)).toThrow(`not '${"é".repeat(50)}'`);
  expect(() => percentBytes({ name: "C", method: () => ({ name: "é".repeat(120) }) }, context, meter)).toThrow(`(type ${"é".repeat(100)})`);
});
it("preserves slot and buffer failures without fallback or remapping", () => {
  const { meter, trace, storage, context } = fixture();
  for (const error of [new PythonRuntimeError("TypeError", "not callable"), new PythonRuntimeError("ValueError", "guest"), new ExecutionLimitError("cancelled"), Error("host")]) {
    trace.length = 0;
    expect(() => percentBytes({ name: "C", buffer: storage, method: () => { throw error; } }, context, meter)).toThrow(error);
    expect(trace).toEqual(["bytes:C", "array:C", "lookup:C"]);
    expect(() => percentBytes({ name: "C" }, { ...context, bufferBytes() { throw error; } }, meter)).toThrow(error);
  }
});
it("checks execution limits after every supplied capability", () => {
  const { context, storage } = fixture();
  for (const capability of ["byteString", "byteArray", "lookupBytes", "bufferBytes", "typeName"] as const) {
    let cancelled = false;
    const meter = { checkpoint() { if (cancelled) throw new ExecutionLimitError("cancelled"); } };
    const wrapped = { ...context, [capability]: () => { cancelled = true; return capability === "typeName" ? "C" : undefined; } };
    expect(() => percentBytes({ name: "C" }, wrapped, meter)).toThrow(ExecutionLimitError);
  }
  let cancelled = false;
  const meter = { checkpoint() { if (cancelled) throw new ExecutionLimitError("cancelled"); } };
  expect(() => percentBytes({ name: "C", method: () => { cancelled = true; return { name: "bytes", bytes: storage }; } }, context, meter)).toThrow(ExecutionLimitError);
});
