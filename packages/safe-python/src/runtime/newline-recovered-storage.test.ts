import {expect, it} from "vitest";
import reference from "./__snapshots__/newline-recovered-storage-3.14.7.json";
import {CodePointString} from "./code-point-string.js";
import {ExecutionBudget, ExecutionLimitError} from "./execution-budget.js";
import {UniversalNewlineDecoder} from "./newline-decoder.js";
import {decodeUtf8} from "./utf8-decode.js";
import {RuntimeValues} from "./runtime-values.js";

it("pins recovered newline storage to the reference interpreter", () => {
  expect(reference.target.version.startsWith("3.14.7 ")).toBe(true);
  expect(reference.target).toMatchObject({unicode: "16.0.0", platform: "darwin", byteorder: "little"});
  expect(reference.oracle).toMatchObject({status: 0, stderr: ""});
  expect(reference.rows).toHaveLength(288);
});

it.each(reference.rows)("preserves recovered storage: lead=$lead replacement=$replacement translate=$translate pending=$pending final=$final", row => {
  const meter = new ExecutionBudget({maxSteps: 100000, maxAllocatedBytes: 1000000});
  const values = new RuntimeValues(meter);
  const replacement = new CodePointString(Uint32Array.from(row.replacement), meter);
  const input = decodeUtf8(Uint8Array.of(row.lead), error => ({replacement, position: error.end, input: error.object}), meter, true, true).text;
  expect(input.isAsciiStorage(meter)).toBe(row.input_ascii);
  expect(input.equals(replacement, meter)).toBe(row.input_equal);
  const decoder = new UniversalNewlineDecoder(row.translate);
  decoder.setstate({pendingCR: row.pending}, meter);
  const result = decoder.decode(input, row.final, meter);
  expect([...result]).toEqual(row.output);
  expect(result.isAsciiStorage(meter)).toBe(row.ascii);
  expect(result.equals(new CodePointString(Uint32Array.from(row.output), meter), meter)).toBe(row.equal);
  const inputValue = values.stringPoints(input, "canonical");
  const outputValue = result === input ? inputValue : values.stringPoints(result, "canonical");
  expect(outputValue === inputValue).toBe(row.reuse);
  expect(decoder.getstate(meter)).toEqual({pendingCR: row.state === 1});
  expect(decoder.newlines).toEqual(row.newlines);
});

it.each([false, true])("keeps pending CR and history atomic when recovered storage is cancelled (translate=%s)", translate => {
  const input = CodePointString.fromUnicodeWriter(Uint32Array.of(56, 56), 65535);
  let count = 0;
  const probe = new UniversalNewlineDecoder(translate);
  probe.setstate({pendingCR: true});
  probe.decode(input, true, {checkpoint() {count++;}});
  for (let stop = 1; stop <= count; stop++) {
    const controller = new AbortController();
    const budget = new ExecutionBudget({maxSteps: 10000, maxAllocatedBytes: 10000, signal: controller.signal});
    const decoder = new UniversalNewlineDecoder(translate);
    decoder.decode(new CodePointString(Uint32Array.of(10, 13)));
    let calls = 0;
    const meter = {checkpoint(steps?: number, bytes?: number) {
      if (++calls === stop) controller.abort();
      budget.checkpoint(steps, bytes);
    }};
    let failure: unknown;
    try {decoder.decode(input, true, meter);} catch (error) {failure = error;}
    expect(failure).toBeInstanceOf(ExecutionLimitError);
    expect(decoder.getstate()).toEqual({pendingCR: true});
    expect(decoder.newlines).toBe("\n");
    expect(() => decoder.decode(input, true, budget)).toThrow(failure as Error);
  }
});
