import {createHash} from "node:crypto";
import {expect, it} from "vitest";
import {PythonDecodeError} from "./decode-error.js";
import {DoubleByteIncrementalDecoder} from "./double-byte-incremental-decoder.js";
import {ExecutionBudget} from "./execution-budget.js";
import {hzCodec} from "./hz-codec.js";
import {iso2022JpCodec} from "./iso2022-jp-codec.js";
import {iso2022Jp2Codec} from "./iso2022-jp-2-codec.js";
import {iso2022KrCodec} from "./iso2022-kr-codec.js";
import reference from "./__snapshots__/codec-shift-stream-edge.json";

const codecs = [hzCodec, iso2022JpCodec, iso2022Jp2Codec, iso2022KrCodec];
const policies = ["strict", "replace", "ignore"] as const;
let seed = reference.seed;
const next = () => seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
const inputs = Array.from({length: reference.rows}, () => {
  const bytes = Uint8Array.from({length: next() % 35}, () => reference.alphabet[next() % reference.alphabet.length]);
  const split = next() % (bytes.length + 1);
  return [bytes.slice(0, split), bytes.slice(split), Uint8Array.of(65), new Uint8Array()];
});

// Each independently bounded block retains complete outputs, exact native
// decode faults and post-call state, including successful calls after faults.
// The external driver is retained in the snapshot; tests never invoke Python.
it.each(reference.blocks)("matches pinned shift-stream edge rows $offset + $count", ({offset, count, sha256}) => {
  expect(reference.reference.version.startsWith("3.14.7 ")).toBe(true);
  expect(reference.reference.unicode).toBe("16.0.0");
  expect(reference.reference.byteorder).toBe("little");
  const outcomes = [];
  for (let index = offset; index < offset + count; index++) {
    const meter = new ExecutionBudget({maxSteps: 100000, maxAllocatedBytes: 1000000});
    const decoder = new DoubleByteIncrementalDecoder(codecs[index % codecs.length], policies[index % policies.length]);
    outcomes.push(inputs[index].map((input, call) => {
      let outcome: unknown;
      try {outcome = ["ok", [...decoder.decode(input, call % 2 === 1, meter)]];}
      catch (error) {
        // Internal faults, cancellation and exhausted budgets must fail the
        // test directly instead of being converted into oracle outcomes.
        if (!(error instanceof PythonDecodeError)) throw error;
        outcome = ["error", error.encoding, [...error.object], error.start, error.end, error.reason];
      }
      const [pending, state] = decoder.getstate(meter);
      return [outcome, [[...pending], String(state)]];
    }));
  }
  expect(createHash("sha256").update(JSON.stringify(outcomes)).digest("hex")).toBe(sha256);
});
