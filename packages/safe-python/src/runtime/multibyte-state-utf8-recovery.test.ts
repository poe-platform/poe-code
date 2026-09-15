import {expect, it} from "vitest";
import type {CodePointString} from "./code-point-string.js";
import {DoubleByteIncrementalEncoder} from "./double-byte-incremental-encoder.js";
import {Gb2312IncrementalEncoder} from "./gb2312-incremental-encoder.js";
import {gbkCodec} from "./gbk-codec.js";
import {ExecutionBudget, ExecutionLimitError} from "./execution-budget.js";
import {RuntimeCodecRegistry} from "./runtime-codec-registry.js";
import {RuntimeCodecRecovery} from "./runtime-codec-recovery.js";
import {RuntimeExceptionExecution} from "./runtime-exception-execution.js";
import {PythonRuntimeError} from "./error.js";
import {runtimeExceptionPayload} from "./runtime-exception-state.js";
import {RuntimeTypeRegistry} from "./runtime-type-registry.js";
import {RuntimeValues, type BuiltinInvocationContext, type RuntimeValue} from "./runtime-values.js";

const encoders = [
  {name: "GB2312", codec: "gb2312", create: () => new Gb2312IncrementalEncoder()},
  {name: "shared multibyte", codec: "gbk", create: () => new DoubleByteIncrementalEncoder(gbkCodec)}
];

function fixture(signal?: AbortSignal) {
  const meter = new ExecutionBudget({maxSteps: 100000, maxAllocatedBytes: 1000000, signal});
  const values = new RuntimeValues(meter), registry = new RuntimeCodecRegistry(values, meter);
  const types = new RuntimeTypeRegistry(values, {hash: () => 0n, equal: (a: RuntimeValue, b: RuntimeValue) => a === b}, meter);
  const exceptions = new RuntimeExceptionExecution(types, values, meter);
  const callbacks = new Map<RuntimeValue, (error: RuntimeValue) => RuntimeValue>();
  const context: BuiltinInvocationContext = {
    isCallable: value => callbacks.has(value),
    call: (value, args) => callbacks.get(value)!(args[0]),
    isException: (error, name) => exceptions.matches(error, name),
    prepareException: (error, retained) => exceptions.prepare(error, retained),
    chainException: error => exceptions.chain(error)
  };
  const strings = new Map<CodePointString, RuntimeValue>();
  return {
    meter, values, registry, exceptions,
    serialize(text: CodePointString) {
      let object = strings.get(text);
      if (object === undefined) {object = values.stringPoints(text); strings.set(text, object);}
      return registry.unicodeUtf8(object, context);
    },
    register(callback: (error: RuntimeValue) => RuntimeValue) {
      const handler = values.cell({});
      callbacks.set(handler, callback);
      registry.registerError("strict", handler, context);
    },
    recovery() {
      return new RuntimeCodecRecovery(registry, "strict", values.none, context);
    }
  };
}

it.each(encoders)("$name bounds serialized pending UTF-8 by bytes and preserves rejected state", ({create, codec}) => {
  for (const replacement of ["ABCDEFGHI", "ééééé", "中中中"]) {
    const state = fixture(), encoder = create(), {values, meter} = state;
    let calls = 0;
    state.register(() => {
      calls++;
      return values.tuple([values.string(replacement), values.integer(1)]);
    });
    const recovery = state.recovery();
    encoder.setstate(1n | (255n << 8n) | (42n << 16n), meter, error => recovery.decode(error));
    for (let attempt = 0; attempt < 2; attempt++) {
      expect(() => encoder.getstate(meter)).toThrow(expect.objectContaining({
        name: "UnicodeEncodeError", encoding: codec, object: values.string(replacement).value,
        start: 0, end: replacement.length, reason: "pending buffer too large"
      }));
    }
    expect(calls).toBe(1);
    encoder.reset(meter);
    expect(encoder.getstate(meter)).toBe(42n << 8n);
  }
});

it.each(encoders)("$name serializes exactly eight pending UTF-8 bytes", ({create}) => {
  for (const [replacement, expected] of [["ABCDEFGH", 199672693722416737829128n], ["éééé", 201470991044224372818696n]] as const) {
    const state = fixture(), encoder = create(), {values, meter} = state;
    state.register(() => values.tuple([values.string(replacement), values.integer(1)]));
    const recovery = state.recovery();
    encoder.setstate(1n | (255n << 8n) | (42n << 16n), meter, error => recovery.decode(error));
    expect(encoder.getstate(meter)).toBe(expected);
    expect(encoder.getstate(meter)).toBe(expected);
  }
});

it.each(encoders)("$name retries encoding recovered pending text beyond the serialized state bound", ({create, codec}) => {
  // CPython 3.14.7 accepts these strings from setstate's strict handler.
  // The eight-byte getstate bound does not limit subsequent encode input.
  for (const [pending, encoded] of [
    ["", [90]],
    ["ABCDEFGHI", [65,66,67,68,69,70,71,72,73,90]],
    ["ééééé", [168,166,168,166,168,166,168,166,168,166,90]],
    ["中中中", [214,208,214,208,214,208,90]]
  ] as const) {
    const state = fixture(), encoder = create(), {values, meter} = state;
    let calls = 0;
    state.register(() => {
      calls++;
      return values.tuple([values.string(pending), values.integer(1)]);
    });
    const recovery = state.recovery();
    encoder.setstate(1n | (255n << 8n) | (42n << 16n), meter, error => recovery.decode(error));
    const rejected = values.string("\ud800").value;
    expect(() => encoder instanceof DoubleByteIncrementalEncoder
      ? encoder.encode(rejected, false, meter) : encoder.encode(rejected, meter)).toThrow(expect.objectContaining({
      name: "UnicodeEncodeError", encoding: codec, object: values.string(pending + "\ud800").value,
      start: pending.length, end: pending.length + 1, reason: "illegal multibyte sequence"
    }));
    if (pending.length !== 0) {
      expect(() => encoder.getstate(meter, state.serialize)).toThrow(expect.objectContaining({
        name: "UnicodeEncodeError", encoding: codec, start: 0, end: pending.length, reason: "pending buffer too large"
      }));
    } else expect(encoder.getstate(meter, state.serialize)).toBe(10752n);
    const accepted = values.string("Z").value;
    expect([...encoder instanceof DoubleByteIncrementalEncoder
      ? encoder.encode(accepted, false, meter) : encoder.encode(accepted, meter)]).toEqual(encoded);
    expect(encoder.getstate(meter, state.serialize)).toBe(10752n);
    const empty = values.string("").value;
    expect([...encoder instanceof DoubleByteIncrementalEncoder
      ? encoder.encode(empty, true, meter) : encoder.encode(empty, meter)]).toEqual([]);
    expect(calls).toBe(1);
  }
});

it.each(encoders)("$name restores pending UTF-8 through the interpreter strict registry", ({create}) => {
  const state = fixture(), encoder = create(), {values, meter} = state;
  const seen: RuntimeValue[] = [];
  state.register(error => {
    seen.push(error);
    const fields = runtimeExceptionPayload(error)!;
    expect(fields.member("encoding", meter)).toEqual(values.string("utf-8"));
    expect(fields.member("object", meter)).toEqual(values.bytes(Uint8Array.of(255, 254, 66)));
    expect(fields.member("end", meter)).toEqual(values.integer(seen.length));
    // Changing the registry does not replace a handler retained by this call.
    state.register(() => values.tuple([values.string("Z"), values.integer(1)]));
    return values.tuple([values.string("A"), values.integer(seen.length - 3)]);
  });
  const recovery = state.recovery();
  encoder.setstate(3n | (255n << 8n) | (254n << 16n) | (66n << 24n) | (42n << 32n), meter, error => recovery.decode(error));
  expect(seen).toHaveLength(2);
  expect(seen[0]).toBe(seen[1]);
  expect(encoder.getstate(meter)).toBe(3n | (65n << 8n) | (65n << 16n) | (66n << 24n) | (42n << 32n));
  const next = state.recovery();
  encoder.setstate(1n | (255n << 8n), meter, error => next.decode(error));
  expect(encoder.getstate(meter)).toBe(1n | (90n << 8n));
});

it.each(encoders)("$name preserves state after rejected UTF-8 recovery results", ({create}) => {
  for (const invalid of ["tuple", "replacement", "position", "overflow", "bounds", "guest"] as const) {
    const state = fixture(), encoder = create(), {values, meter} = state;
    const initial = 1n | (65n << 8n) | (42n << 16n);
    encoder.setstate(initial, meter);
    const failure = state.exceptions.prepare(new PythonRuntimeError("ValueError", "guest failure"));
    state.register(() => {
      if (invalid === "guest") throw failure;
      if (invalid === "tuple") return values.list([]);
      return values.tuple([
        invalid === "replacement" ? values.bytes(Uint8Array.of(65)) : values.string("A"),
        invalid === "position" ? values.float(1) : values.integer(invalid === "overflow" ? 1n << 63n : invalid === "bounds" ? -2n : 1n)
      ]);
    });
    const recovery = state.recovery();
    let caught: unknown;
    try {encoder.setstate(1n | (255n << 8n), meter, error => recovery.decode(error));}
    catch (error) {caught = error;}
    if (invalid === "guest") expect(caught).toBe(failure);
    else expect(caught).toMatchObject({
      name: invalid === "overflow" ? "OverflowError" : invalid === "bounds" ? "IndexError" : "TypeError",
      message: invalid === "overflow" ? "Python int too large to convert to C ssize_t"
        : invalid === "bounds" ? "position -1 from error handler out of bounds"
        : invalid === "position" ? "'float' object cannot be interpreted as an integer"
        : "decoding error handler must return (str, int) tuple"
    });
    expect(encoder.getstate(meter)).toBe(initial);
  }
});

it.each(encoders)("$name preserves reentrant state on failure and commits recovered input on success", ({create}) => {
  for (const fails of [false, true]) {
    const state = fixture(), encoder = create(), {values, meter} = state;
    const nested = 1n | (66n << 8n) | (43n << 16n);
    const failure = state.exceptions.prepare(new PythonRuntimeError("ValueError", "nested failure"));
    encoder.errors = "ignore";
    state.register(error => {
      encoder.setstate(nested, meter);
      if (fails) throw failure;
      runtimeExceptionPayload(error)!.assignMember("object", values.bytes(Uint8Array.of(67)), meter);
      return values.tuple([values.string("A"), values.integer(-1)]);
    });
    const recovery = state.recovery();
    if (fails) {
      let caught: unknown;
      try {encoder.setstate(1n | (255n << 8n) | (42n << 16n), meter, error => recovery.decode(error));}
      catch (error) {caught = error;}
      expect(caught).toBe(failure);
      expect(encoder.getstate(meter)).toBe(nested);
    } else {
      encoder.setstate(1n | (255n << 8n) | (42n << 16n), meter, error => recovery.decode(error));
      expect(encoder.getstate(meter)).toBe(2n | (65n << 8n) | (67n << 16n) | (42n << 24n));
    }
  }
});

it.each(encoders)("$name cannot publish restored state or reenter recovery after cancellation", ({create}) => {
  for (const throws of [false, true]) {
    const controller = new AbortController(), state = fixture(controller.signal), encoder = create();
    const {values, meter} = state;
    const initial = 1n | (65n << 8n) | (42n << 16n);
    encoder.setstate(initial, meter);
    let calls = 0;
    state.register(() => {
      calls++;
      controller.abort();
      if (throws) throw new Error("service failure after cancellation");
      return values.tuple([values.string("B"), values.integer(1)]);
    });
    const recovery = state.recovery();
    let fatal: unknown;
    try {encoder.setstate(1n | (255n << 8n), meter, error => recovery.decode(error));}
    catch (error) {fatal = error;}
    expect(fatal).toBeInstanceOf(ExecutionLimitError);
    expect(fatal).toMatchObject({reason: "cancelled"});
    let repeated: unknown;
    try {encoder.setstate(1n | (255n << 8n), meter, error => recovery.decode(error));}
    catch (error) {repeated = error;}
    expect(repeated).toBe(fatal);
    expect(calls).toBe(1);
    expect(encoder.getstate(new ExecutionBudget({maxSteps: 10000, maxAllocatedBytes: 10000}))).toBe(initial);
  }
});

it.each(encoders)("$name serializes pending surrogates through the owning Unicode cache", ({create, codec}) => {
  for (const action of ["cache", "reset", "set", "long", "fail"] as const) {
    const state = fixture(), encoder = create(), {values, meter, serialize} = state;
    let calls = 0;
    state.register(() => values.tuple([values.string("\ud800"), values.integer(1)]));
    const recovery = state.recovery();
    encoder.setstate(1n | (255n << 8n) | (42n << 16n), meter, error => recovery.decode(error));
    const failure = state.exceptions.prepare(new PythonRuntimeError("ValueError", "guest"));
    state.register(error => {
      calls++;
      expect(runtimeExceptionPayload(error)!.member("encoding", meter)).toEqual(values.string("utf-8"));
      if (action === "fail") throw failure;
      if (action === "reset") encoder.reset(meter);
      if (action === "set") encoder.setstate(2834945n, meter);
      return values.tuple([values.bytes(Uint8Array.from(action === "long" ? [65,66,67,68,69,70,71,72,73] : [90])), values.integer(1)]);
    });
    for (let attempt = 0; attempt < 2; attempt++) {
      if (action === "fail") {
        let caught: unknown;
        try {encoder.getstate(meter, serialize);} catch (error) {caught = error;}
        expect(caught).toBe(failure);
      } else if (action === "long") {
        expect(() => encoder.getstate(meter, serialize)).toThrow(expect.objectContaining({
          name: "UnicodeEncodeError", encoding: codec, start: 0, end: 1, reason: "pending buffer too large"
        }));
      } else {
        const expected = attempt === 0 ? action === "set" ? 2841089n : 2775553n
          : action === "reset" ? 10752n : action === "set" ? 2834945n : 2775553n;
        expect(encoder.getstate(meter, serialize)).toBe(expected);
      }
    }
    expect(calls).toBe(action === "fail" ? 2 : 1);
  }
});

it.each(encoders)("$name validates serialization recovery and retries uncached failures", ({create}) => {
  for (const invalid of ["tuple", "replacement", "position", "overflow", "bounds", "negative"] as const) {
    const state = fixture(), encoder = create(), {values, meter, serialize} = state;
    state.register(() => values.tuple([values.string("\ud800A"), values.integer(1)]));
    const recovery = state.recovery();
    encoder.setstate(65281n, meter, error => recovery.decode(error));
    let calls = 0;
    state.register(() => {
      calls++;
      if (invalid === "tuple") return values.list([]);
      return values.tuple([
        invalid === "replacement" ? values.integer(1) : values.bytes(Uint8Array.of(90)),
        invalid === "position" ? values.float(1.5) : values.integer(invalid === "overflow" ? 1n << 63n : invalid === "bounds" ? -3 : -1)
      ]);
    });
    for (let attempt = 0; attempt < 2; attempt++) {
      if (invalid === "negative") expect(encoder.getstate(meter, serialize)).toBe(4282882n);
      else expect(() => encoder.getstate(meter, serialize)).toThrow(expect.objectContaining({
        name: invalid === "overflow" ? "OverflowError" : invalid === "bounds" ? "IndexError" : "TypeError",
        message: invalid === "overflow" ? "Python int too large to convert to C ssize_t"
          : invalid === "bounds" ? "position -1 from error handler out of bounds"
          : invalid === "position" ? "'float' object cannot be interpreted as an integer"
          : "encoding error handler must return (str/bytes, int) tuple"
      }));
    }
    expect(calls).toBe(invalid === "negative" ? 1 : 2);
  }
});

it.each(encoders)("$name terminates state serialization when registry recovery cancels", ({create}) => {
  for (const throws of [false, true]) {
    const controller = new AbortController(), state = fixture(controller.signal), encoder = create();
    const {values, meter, serialize} = state;
    state.register(() => values.tuple([values.string("\ud800"), values.integer(1)]));
    const recovery = state.recovery();
    encoder.setstate(65281n, meter, error => recovery.decode(error));
    let calls = 0;
    state.register(() => {
      calls++;
      controller.abort();
      if (throws) throw new Error("service failure after cancellation");
      return values.tuple([values.bytes(Uint8Array.of(90)), values.integer(1)]);
    });
    let fatal: unknown;
    try {encoder.getstate(meter, serialize);} catch (error) {fatal = error;}
    expect(fatal).toBeInstanceOf(ExecutionLimitError);
    expect(fatal).toMatchObject({reason: "cancelled"});
    let repeated: unknown;
    try {encoder.getstate(meter, serialize);} catch (error) {repeated = error;}
    expect(repeated).toBe(fatal);
    expect(calls).toBe(1);
  }
});

it.each(encoders)("$name observes termination at the pending-text serialization service boundary", ({create}) => {
  for (const outcome of ["empty", "bytes", "throw", "fatal"] as const) {
    const controller = new AbortController(), state = fixture(controller.signal), encoder = create();
    const {values, meter} = state;
    encoder.setstate(1n | (65n << 8n) | (42n << 16n), meter);
    const serialized = state.serialize(values.string(outcome === "empty" ? "" : "A").value);
    const serviceFailure = new PythonRuntimeError("ValueError", "serialization service failed");
    const existingFatal = new ExecutionLimitError("allocation");
    let calls = 0;
    const serialize = () => {
      calls++;
      controller.abort();
      if (outcome === "throw") throw serviceFailure;
      if (outcome === "fatal") throw existingFatal;
      return serialized;
    };
    let fatal: unknown;
    try {encoder.getstate(meter, serialize);} catch (error) {fatal = error;}
    expect(fatal).toBeInstanceOf(ExecutionLimitError);
    if (outcome === "fatal") expect(fatal).toBe(existingFatal);
    else {
      expect(fatal).toMatchObject({reason: "cancelled"});
      expect(() => encoder.getstate(meter, serialize)).toThrow(fatal as Error);
    }
    expect(calls).toBe(1);
    const inspection = new ExecutionBudget({maxSteps: 10000, maxAllocatedBytes: 10000});
    expect(encoder.getstate(inspection)).toBe(1n | (65n << 8n) | (42n << 16n));
  }
});

it.each(encoders)("$name preserves cached empty UTF-8 recovery and live flags", ({create}) => {
  for (const action of ["empty", "reset", "set"] as const) {
    const state = fixture(), encoder = create(), {values, meter, serialize} = state;
    state.register(() => values.tuple([values.string("\ud800"), values.integer(1)]));
    const recovery = state.recovery();
    encoder.setstate(1n | (255n << 8n) | (42n << 16n), meter, error => recovery.decode(error));
    const calls: unknown[] = [];
    state.register(error => {
      const payload = runtimeExceptionPayload(error)!;
      calls.push([payload.member("encoding", meter), payload.member("start", meter), payload.member("end", meter)]);
      if (action === "reset") encoder.reset(meter);
      if (action === "set") encoder.setstate(2834945n, meter);
      return values.tuple([values.bytes(new Uint8Array()), values.integer(1)]);
    });
    expect(encoder.getstate(meter, serialize)).toBe(action === "set" ? 11008n : 10752n);
    expect(encoder.getstate(meter, serialize)).toBe(action === "set" ? 2834945n : 10752n);
    expect(calls).toEqual([[values.string("utf-8"), values.integer(0), values.integer(1)]]);
  }
});
