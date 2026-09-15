import {expect, it} from "vitest";
import reference from "./__snapshots__/idna-buffer-encode-3.14.7.json";
import {CodePointString} from "./code-point-string.js";
import {PythonDecodeError} from "./decode-error.js";
import {PythonEncodeError} from "./encode-error.js";
import {PythonRuntimeError} from "./error.js";
import {ExecutionBudget, ExecutionLimitError} from "./execution-budget.js";
import {encodeIdnaBuffer} from "./idna-buffer-encode.js";

function fault(error: PythonRuntimeError): unknown {
  return {name: error.name, message: error.message, suppressContext: error.chaining?.suppressContext ?? false,
    ...(error instanceof PythonEncodeError || error instanceof PythonDecodeError ? {
      encoding: error.encoding, object: [...error.object], start: String(error.start), end: String(error.end), reason: error.reason
    } : {}), ...(error.chaining === undefined ? {} : {context: fault(error.chaining.context)})};
}

it("pins the incremental encoder reference", () => {
  expect(reference.oracle.version.startsWith("3.14.7 ")).toBe(true);
  expect(reference.oracle.unicode).toBe("16.0.0");
});
for (let start = 0; start < reference.cases.length; start += 50) {
  it(`matches incremental label buffering and fault chains from ${start}`, () => {
    const rows = reference.cases.slice(start, start + 50);
    expect(rows.map(row => {
      const meter = new ExecutionBudget({maxSteps: 1000000, maxAllocatedBytes: 8000000});
      const identity = {input: row.input, errors: row.errors, final: row.final};
      try {
        const result = encodeIdnaBuffer(new CodePointString(Uint32Array.from(row.input)), row.errors, row.final, meter);
        return {...identity, result: [...result.output], consumed: result.consumed};
      } catch (error) {if (!(error instanceof PythonRuntimeError)) throw error; return {...identity, error: fault(error)};}
    })).toEqual(rows);
  });
}

it.each(["bücher.example", "a..b", "a.\ud800", "x".repeat(64) + "."])("stops at every cancellation boundary: %s", text => {
  const input = new CodePointString(Uint32Array.from(Array.from(text, character => character.codePointAt(0)!)));
  const original = [...input];
  let count = 0;
  try {encodeIdnaBuffer(input, "strict", true, {checkpoint() {count++;}});}
  catch (error) {if (!(error instanceof PythonRuntimeError)) throw error;}
  for (let stop = 1; stop <= count; stop++) {
    const cancelled = new ExecutionLimitError("cancelled");
    let calls = 0, failure: unknown;
    try {encodeIdnaBuffer(input, "strict", true, {checkpoint() {if (++calls === stop) throw cancelled;}});}
    catch (error) {failure = error;}
    expect(failure).toBe(cancelled);
    expect(calls).toBe(stop);
    expect([...input]).toEqual(original);
  }
});

it.each(["bücher.example", "ABC。bücher．example｡", "a\u200d.b", "א.example"])("retains unfinished labels at every split: %s", text => {
  const points = Array.from(text, character => character.codePointAt(0)!);
  for (let split = 0; split <= points.length; split++) {
    const meter = new ExecutionBudget({maxSteps: 1000000, maxAllocatedBytes: 8000000});
    const whole = encodeIdnaBuffer(new CodePointString(Uint32Array.from(points)), "strict", true, meter);
    const first = encodeIdnaBuffer(new CodePointString(Uint32Array.from(points.slice(0, split))), "strict", false, meter);
    const pending = points.slice(first.consumed);
    const last = encodeIdnaBuffer(new CodePointString(Uint32Array.from(pending)), "strict", true, meter);
    expect([...first.output, ...last.output]).toEqual([...whole.output]);
    expect(first.consumed + last.consumed).toBe(points.length);
  }
});
