import {expect, it} from "vitest";
import reference from "./__snapshots__/codec-newline-reuse-3.14.7.json";
import {CodePointString} from "./code-point-string.js";
import {ExecutionBudget, ExecutionLimitError} from "./execution-budget.js";
import {UniversalNewlineDecoder} from "./newline-decoder.js";

const text = (points: readonly number[]) => new CodePointString(Uint32Array.from(points));

// The oracle uses a str subtype so native copying cannot be obscured by the
// empty/Latin-1 singleton caches. This tests storage reuse in the newline layer;
// public _io object publication and subtype identity need their own integration.
it.each(reference.groups)("matches newline storage reuse: translate=$translate history=$history pending=$pending", group => {
  expect(reference.target.version.startsWith("3.14.7 ")).toBe(true);
  expect(reference.target.unicode).toBe("16.0.0");
  for (const row of group.rows) {
    const decoder = new UniversalNewlineDecoder(group.translate);
    decoder.decode(text(group.history), true);
    decoder.setstate({pendingCR: group.pending});
    const input = text(row.input), output = decoder.decode(input, row.final);
    expect([...output], JSON.stringify(row)).toEqual(row.output);
    expect(output === input, JSON.stringify(row)).toBe(row.reuse);
    expect(decoder.getstate()).toEqual({pendingCR: row.pending});
    expect(decoder.newlines).toEqual(row.newlines);
  }
});

it.each([false, true])("reuses unchanged text without allocating another buffer, translate=%s", translate => {
  const decoder = new UniversalNewlineDecoder(translate), input = text([65, 10, 0xd800, 0xdc00]);
  const meter = new ExecutionBudget({maxSteps: 1000, maxAllocatedBytes: 0});
  expect(decoder.decode(input, true, meter)).toBe(input);
  expect(decoder.newlines).toBe("\n");
});

it.each([false, true])("keeps history unchanged when reuse scanning is cancelled, translate=%s", translate => {
  const input = text([65, 10, 0xd800, 0xdc00]);
  let checkpoints = 0;
  new UniversalNewlineDecoder(translate).decode(input, true, {checkpoint() {checkpoints++;}});
  for (let stop = 1; stop <= checkpoints; stop++) {
    const decoder = new UniversalNewlineDecoder(translate), controller = new AbortController();
    const budget = new ExecutionBudget({maxSteps: 1000, maxAllocatedBytes: 1000, signal: controller.signal});
    let calls = 0;
    const meter = {checkpoint(steps?: number, bytes?: number) {
      if (++calls === stop) controller.abort();
      budget.checkpoint(steps, bytes);
    }};
    let failure: unknown;
    try {decoder.decode(input, true, meter);} catch (error) {failure = error;}
    expect(failure).toBeInstanceOf(ExecutionLimitError);
    expect(decoder.newlines).toBeNull();
    expect(decoder.getstate()).toEqual({pendingCR: false});
    let repeated: unknown;
    try {decoder.decode(input, true, budget);} catch (error) {repeated = error;}
    expect(repeated).toBe(failure);
  }
});
