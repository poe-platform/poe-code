import {expect, it} from "vitest";
import {ExecutionBudget, ExecutionLimitError} from "./execution-budget.js";
import {OrderedKeyMap} from "./ordered-key-map.js";
import {createRuntimeCoreCodecFunctions} from "./runtime-core-codec-functions.js";
import {RuntimeCodecRegistry} from "./runtime-codec-registry.js";
import {RuntimeValues, type RuntimeValue} from "./runtime-values.js";

const names = ["ascii", "latin_1", "utf_8", "utf_7", "charmap", "unicode_escape", "raw_unicode_escape"]
  .flatMap(codec => ["encode", "decode"].map(operation => `${codec}_${operation}`))
  .concat(["readbuffer_encode", "escape_encode", "escape_decode"]);

function fixture() {
  const controller = new AbortController();
  let budget = new ExecutionBudget({maxSteps: 100000, maxAllocatedBytes: 1000000, signal: controller.signal});
  const meter = {checkpoint(steps = 1, bytes = 0) {budget.checkpoint(steps, bytes);}};
  const values = new RuntimeValues(meter);
  const functions = createRuntimeCoreCodecFunctions(new RuntimeCodecRegistry(values, meter));
  const keywords = values.dictionary(new OrderedKeyMap<RuntimeValue, RuntimeValue>({hash: () => 0n, equal: (a, b) => a === b}, meter));
  return {controller, meter, values, functions, keywords, limit(bytes: number) {
    budget = new ExecutionBudget({maxSteps: 10000, maxAllocatedBytes: bytes, signal: controller.signal});
  }};
}

function expectTerminal(invoke: () => unknown, reason = "allocation") {
  let failure: unknown;
  try {invoke();} catch (error) {failure = error;}
  expect(failure).toBeInstanceOf(ExecutionLimitError);
  expect(failure).toMatchObject({reason});
  let retry: unknown;
  try {invoke();} catch (error) {retry = error;}
  expect(retry).toBe(failure);
}

it.each(names.flatMap(name => ["missing", "extra", "keywords", "source", "errors", "nul"].map(kind => ({name, kind}))))(
  "admits $name $kind rejection before constructing a catchable exception", ({name, kind}) => {
    const {values, meter, functions, keywords, limit} = fixture();
    const source = name.endsWith("encode") && name !== "escape_encode" && name !== "readbuffer_encode"
      ? values.string("") : values.bytes(new Uint8Array());
    const args = kind === "missing" ? [] : kind === "extra" ? [source, values.none, values.none, values.none]
      : kind === "source" ? [values.none] : kind === "errors" ? [source, values.true]
      : kind === "nul" ? [source, values.string("\0")] : [source];
    if (kind === "keywords") keywords.items.set(values.string("errors"), values.none);
    const fn = functions.get(name)!;
    // Fit argument storage and, for NUL, handler-name conversion. Exception
    // storage must still be admitted rather than bypassing the exhausted meter.
    limit(kind === "nul" ? 300 : 128);
    expectTerminal(() => fn.value.invoke(args, keywords, meter, {call: () => {throw Error("unexpected guest call during argument rejection");}}));
  }
);

it.each(names.flatMap(name => ["allocation", "cancel-return", "cancel-throw"].map(mode => ({name, mode}))))(
  "observes $mode after $name error type resolution and releases its input lease", ({name, mode}) => {
    const {controller, values, meter, functions, keywords, limit} = fixture();
    const encode = name.endsWith("encode") && name !== "readbuffer_encode";
    const source = name === "escape_encode" ? values.bytes(new Uint8Array()) : encode ? values.string("") : values.cell({});
    const invalid = values.cell({});
    let calls = 0, releases = 0, copies = 0;
    expectTerminal(() => functions.get(name)!.value.invoke([source, invalid], keywords, meter, {
      call: () => values.none,
      typeName: () => {
        calls++;
        if (mode === "allocation") limit(0);
        else controller.abort();
        if (mode === "cancel-throw") throw Error("service failed after cancellation");
        return "InvalidPolicy";
      },
      buffers: {acquireSimple: () => ({byteLength: 0, copy: () => {copies++; throw Error("unexpected copy");}, release: () => {releases++;}})}
    }), mode === "allocation" ? "allocation" : "cancelled");
    expect(calls).toBe(1);
    expect(releases).toBe(encode ? 0 : 1);
    expect(copies).toBe(0);
  }
);
