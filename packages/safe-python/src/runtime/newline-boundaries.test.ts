import {createHash} from "node:crypto";
import {expect, it} from "vitest";
import reference from "./__snapshots__/newline-boundaries-3.14.7.json" with {type: "json"};
import {CodePointString} from "./code-point-string.js";
import {ExecutionBudget, ExecutionLimitError} from "./execution-budget.js";
import {UniversalNewlineDecoder} from "./newline-decoder.js";
import {Utf8IncrementalDecoder} from "./utf8-incremental.js";

const text = (points: readonly number[]) => new CodePointString(Uint32Array.from(points));

function* inputs(length: number, prefix: number[] = []): Generator<number[]> {
  if (length === 0) {yield prefix; return;}
  for (const point of reference.alphabet) yield* inputs(length - 1, [...prefix, point]);
}

it("pins the newline oracle to CPython 3.14.7 and Unicode 16", () => {
  expect(reference.oracle.version.startsWith("3.14.7 ")).toBe(true);
  expect(reference.oracle.unicode).toBe("16.0.0");
  expect(reference.oracle.exitStatus).toBe(0);
  expect(reference.oracle.stderr).toBe("");
  expect(reference.oracle.signal).toBeNull();
});

it.each(reference.rows)("matches every three-chunk boundary (translate=$translate, pending=$pending)", row => {
  const hash = createHash("sha256");
  let count = 0;
  for (let size = 0; size < 4; size++) for (const points of inputs(size)) {
    for (let first = 0; first <= size; first++) for (let second = first; second <= size; second++) {
      const decoder = new UniversalNewlineDecoder(row.translate);
      decoder.decode(text([10]));
      decoder.setstate({pendingCR: row.pending});
      const events = [];
      for (const [chunk, final] of [[points.slice(0, first), false], [points.slice(first, second), false], [points.slice(second), true], [[], true]] as const) {
        const output = decoder.decode(text(chunk), final);
        events.push([[...output], Number(decoder.getstate().pendingCR), decoder.newlines]);
      }
      decoder.reset();
      const output = decoder.decode(text(points), true);
      events.push([[...output], Number(decoder.getstate().pendingCR), decoder.newlines]);
      hash.update(JSON.stringify([points, first, second, events]) + "\n");
      count++;
    }
  }
  expect(count).toBe(row.count);
  expect(hash.digest("hex")).toBe(row.sha256);
});

it.each(reference.utf8)("matches UTF-8/newline composition at every byte split: $points, translate=$translate", row => {
  expect(row.scenarios).toHaveLength(row.input.length + 1);
  for (let split = 0; split <= row.input.length; split++) {
    const bytes = new Utf8IncrementalDecoder("surrogatepass");
    const newline = new UniversalNewlineDecoder(row.translate);
    const events = [];
    for (const [chunk, final] of [[row.input.slice(0, split), false], [[], false], [row.input.slice(split), true], [[], true]] as const) {
      const output = newline.decode(bytes.decode(Uint8Array.from(chunk), final), final);
      const [pending, flag] = bytes.getstate();
      events.push([[...output], [...pending], Number(flag * 2n) + Number(newline.getstate().pendingCR), newline.newlines]);
    }
    expect(events, `split ${split}`).toEqual(row.scenarios[split]);
  }
});

it.each([false, true])("preserves newline state on cancellation at every checkpoint, translate=%s", translate => {
  const input = text([10, 0xd800, 13, 65, 10, 0xdc00, 13]);
  let checkpoints = 0;
  const probe = new UniversalNewlineDecoder(translate);
  probe.decode(text([10, 13]));
  const expected = [...probe.decode(input, true, {checkpoint() {checkpoints++;}})];
  expect(checkpoints).toBeGreaterThan(1);
  for (let stop = 1; stop <= checkpoints; stop++) {
    const decoder = new UniversalNewlineDecoder(translate);
    decoder.decode(text([10, 13]));
    const before = decoder.getstate(), seen = decoder.newlines;
    let calls = 0;
    const failure = new ExecutionLimitError("cancelled");
    expect(() => decoder.decode(input, true, {checkpoint() {if (++calls === stop) throw failure;}})).toThrow(failure);
    expect(calls).toBe(stop);
    expect(decoder.getstate()).toEqual(before);
    expect(decoder.newlines).toEqual(seen);
    expect([...decoder.decode(input, true)]).toEqual(expected);
  }
});

it.each(["steps", "allocation"] as const)("leaves pending CR and history intact on %s exhaustion", reason => {
  const decoder = new UniversalNewlineDecoder();
  decoder.decode(text([10, 13]));
  const meter = new ExecutionBudget({maxSteps: reason === "steps" ? 2 : 1000, maxAllocatedBytes: reason === "allocation" ? 4 : 1000});
  expect(() => decoder.decode(text([10, 65]), true, meter)).toThrow(expect.objectContaining({reason}));
  expect(decoder.getstate()).toEqual({pendingCR: true});
  expect(decoder.newlines).toBe("\n");
});
