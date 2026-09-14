import {expect, it} from "vitest";
import reference from "./__snapshots__/idna-ascii-label-3.14.7.json";
import {CodePointString} from "./code-point-string.js";
import {PythonEncodeError} from "./encode-error.js";
import {ExecutionBudget, ExecutionLimitError} from "./execution-budget.js";
import {encodeIdnaAsciiLabel} from "./idna-ascii-label.js";

it("matches pinned default ToASCII labels, length boundaries and exact faults", () => {
  expect(reference.oracle.unicode).toBe("16.0.0");
  expect(reference.oracle.version.startsWith("3.14.7 ")).toBe(true);
  const actual = reference.cases.map(row => {
    const input = new CodePointString(Uint32Array.from(row.input));
    const meter = new ExecutionBudget({maxSteps: 1000000, maxAllocatedBytes: 4000000});
    try { return {input: row.input, result: [...encodeIdnaAsciiLabel(input, meter)]}; }
    catch (error) {
      if (!(error instanceof PythonEncodeError)) throw error;
      return {input: row.input, error: {name: error.name, encoding: error.encoding,
        object: [...error.object], start: error.start, end: error.end,
        reason: error.reason, message: error.message}};
    }
  });
  expect(actual).toEqual(reference.cases);
});

it.each([[], [65], [0xad], [0xff21], [0xe9], [0x5d0, 65], [120, 110, 45, 45, 0xe9]].map(points => ({points})))("keeps cancellation fatal at every label checkpoint: $points", ({points}) => {
  const input = new CodePointString(Uint32Array.from(points));
  let count = 0;
  try { encodeIdnaAsciiLabel(input, {checkpoint() {count++;}}); }
  catch (error) {if (!(error instanceof PythonEncodeError)) throw error;}
  for (let stop = 1; stop <= count; stop++) {
    const cancelled = new ExecutionLimitError("cancelled");
    let calls = 0, failure: unknown;
    try { encodeIdnaAsciiLabel(input, {checkpoint() {if (++calls === stop) throw cancelled;}}); }
    catch (error) {failure = error;}
    expect(failure).toBe(cancelled);
    expect(calls).toBe(stop);
    expect([...input]).toEqual(points);
  }
});
