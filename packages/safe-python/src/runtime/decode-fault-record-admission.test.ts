import {expect, it} from "vitest";
import {PythonDecodeError} from "./decode-error.js";
import {ExecutionBudget, ExecutionLimitError, type ExecutionMeter} from "./execution-budget.js";
import {decodeSingleByte} from "./single-byte-decode.js";
import {decodeUtf8, type Utf8DecodeRecovery} from "./utf8-decode.js";
import {decodeUtf7} from "./utf7.js";
import {decodeWideUnicode} from "./utf-wide.js";

const decoders = [
  {name: "ASCII", scratch: 32, run: (errors: "strict" | Utf8DecodeRecovery, meter: ExecutionMeter) => decodeSingleByte(Uint8Array.of(255), "ascii", errors, meter)},
  {name: "UTF-8", scratch: 68, run: (errors: "strict" | Utf8DecodeRecovery, meter: ExecutionMeter) => decodeUtf8(Uint8Array.of(255), errors, meter)},
  {name: "UTF-7", scratch: 68, run: (errors: "strict" | Utf8DecodeRecovery, meter: ExecutionMeter) => decodeUtf7(Uint8Array.of(255), errors, meter)},
  ...([16, 32] as const).map(width => ({name: `UTF-${width}`, scratch: 260, run: (errors: "strict" | Utf8DecodeRecovery, meter: ExecutionMeter) => decodeWideUnicode(Uint8Array.of(255), width, -1, errors, meter)}))
];

it.each(decoders.flatMap(decoder => [false, true].map(callback => ({...decoder, callback}))))(
  "admits the $name fault record before recovery (callback=$callback)", ({scratch, run, callback}) => {
    // Permit the decoder's scratch storage and the fault's byte snapshot only.
    const meter = new ExecutionBudget({maxSteps: 1000, maxAllocatedBytes: scratch + 65});
    let calls = 0;
    const recovery: Utf8DecodeRecovery = () => {calls++; throw new Error("unadmitted recovery");};
    const invoke = () => run(callback ? recovery : "strict", meter);
    let failure: unknown;
    try {invoke();} catch (error) {failure = error;}
    expect(failure).toBeInstanceOf(ExecutionLimitError);
    expect(failure).toMatchObject({reason: "allocation"});
    expect(calls).toBe(0);
    let repeated: unknown;
    try {invoke();} catch (error) {repeated = error;}
    expect(repeated).toBe(failure);
    expect(calls).toBe(0);
  }
);

it.each([0, 1, 256])("admits the exception record independently of its %i-byte snapshot", length => {
  const meter = new ExecutionBudget({maxSteps: 1000, maxAllocatedBytes: 64 + length});
  expect(() => new PythonDecodeError("utf-8", new Uint8Array(length), 0, length, "invalid input", meter)).toThrow(ExecutionLimitError);
});
