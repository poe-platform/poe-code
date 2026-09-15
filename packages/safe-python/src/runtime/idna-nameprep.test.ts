import {expect, it} from "vitest";
import reference from "./__snapshots__/idna-nameprep-3.14.7.json";
import {CodePointString} from "./code-point-string.js";
import {PythonEncodeError} from "./encode-error.js";
import {ExecutionBudget, ExecutionLimitError} from "./execution-budget.js";
import {prepareIdnaName} from "./idna-nameprep.js";

it("matches pinned Nameprep mapping, normalization, prohibited characters and bidi diagnostics", () => {
  expect(reference.oracle).toMatchObject({unicode: "16.0.0", normalization: "3.2.0", exitStatus: 0, stderr: "", signal: null});
  const actual = reference.cases.map(row => {
    const input = new CodePointString(Uint32Array.from(row.input));
    const meter = new ExecutionBudget({maxSteps: 100000, maxAllocatedBytes: 1000000});
    try { return {input: row.input, result: [...prepareIdnaName(input, meter)]}; }
    catch (error) {
      if (!(error instanceof PythonEncodeError)) throw error;
      return {input: row.input, error: {
        name: error.name, encoding: error.encoding, object: [...error.object],
        start: error.start, end: error.end, reason: error.reason, message: error.message,
      }};
    }
  });
  expect(actual).toEqual(reference.cases);
});

it.each([
  {name: "mapping and composition", points: [65, 0x30a, 0x323, 0xdf, 0xad, 0x1e9e]},
  {name: "valid bidirectional label", points: [0x5d0, 0x31, 0x5d1]},
  {name: "bidirectional fault", points: [0x5d0, 65, 0x5d1]},
  {name: "prohibited surrogate", points: [65, 0xd800, 0xdc00]},
])("preserves fatal cancellation at every Nameprep checkpoint: $name", ({points}) => {
  const input = new CodePointString(Uint32Array.from(points));
  let checkpoints = 0;
  try { prepareIdnaName(input, {checkpoint() { checkpoints++; }}); }
  catch (error) { if (!(error instanceof PythonEncodeError)) throw error; }
  for (let at = 1; at <= checkpoints; at++) {
    const cancelled = new ExecutionLimitError("cancelled");
    let calls = 0;
    let failure: unknown;
    try { prepareIdnaName(input, {checkpoint() { if (++calls === at) throw cancelled; }}); }
    catch (error) { failure = error; }
    expect(failure).toBe(cancelled);
    expect(calls).toBe(at);
    expect([...input]).toEqual(points);
  }
});

it("charges expansion, normalization and working storage before publication", () => {
  const input = new CodePointString(Uint32Array.from([0x33c6, 0xdf, 65, 0x30a]));
  expect(() => prepareIdnaName(input, new ExecutionBudget({maxSteps: 10, maxAllocatedBytes: 100000}))).toThrow(ExecutionLimitError);
  expect(() => prepareIdnaName(input, new ExecutionBudget({maxSteps: 100000, maxAllocatedBytes: 10}))).toThrow(ExecutionLimitError);
  expect([...input]).toEqual([0x33c6, 0xdf, 65, 0x30a]);
});
