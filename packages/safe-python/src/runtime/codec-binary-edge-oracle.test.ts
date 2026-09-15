import {createHash} from "node:crypto";
import {expect, it} from "vitest";
import {BinasciiError} from "./binascii-error.js";
import {ExecutionBudget} from "./execution-budget.js";
import {encodeQuotedPrintable, decodeQuotedPrintable} from "./quoted-printable.js";
import {decodeUu} from "./uuencode.js";
import reference from "./__snapshots__/codec-binary-edge-oracle.json";

// The external oracle records every outcome before computing these block
// digests. Unit tests only execute package kernels; no files or Python process
// are used. Small independent blocks keep individual cases bounded.
let seed = reference.seed;
const inputs = Array.from({length: reference.rows}, (_, index) => {
  const input = new Uint8Array(index % 181);
  for (let offset = 0; offset < input.length; offset++) {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    input[offset] = reference.alphabet[seed % reference.alphabet.length];
  }
  return input;
});

it.each(reference.blocks)("matches pinned binary codec edge rows $offset + $count", ({offset, count, sha256}) => {
  expect(reference.reference.version.startsWith("3.14.7 ")).toBe(true);
  expect(reference.reference.unicode).toBe("16.0.0");
  const outcomes = [];
  for (let index = offset; index < offset + count; index++) {
    const input = inputs[index], flag = index % 8;
    const meter = new ExecutionBudget({maxSteps: 10000, maxAllocatedBytes: 10000});
    outcomes.push([
      () => encodeQuotedPrintable(input, {quoteTabs: !!(flag & 1), isText: !!(flag & 2), header: !!(flag & 4)}, meter),
      () => decodeQuotedPrintable(input, !!(flag & 4), meter),
      () => decodeUu(input, meter)
    ].map(invoke => {
      try {return [...invoke()];}
      catch (error) {
        // Only the actual binascii error family is a guest result. Internal
        // failures and exhausted budgets must fail the test, not enter a hash.
        if (!(error instanceof BinasciiError)) throw error;
        return ["Error", error.message];
      }
    }));
  }
  expect(createHash("sha256").update(JSON.stringify(outcomes)).digest("hex")).toBe(sha256);
});
