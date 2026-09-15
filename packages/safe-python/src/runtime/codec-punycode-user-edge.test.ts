import {createHash} from "node:crypto";
import {expect, it} from "vitest";
import {CodePointString} from "./code-point-string.js";
import {PythonDecodeError} from "./decode-error.js";
import {PythonRuntimeError} from "./error.js";
import {ExecutionBudget} from "./execution-budget.js";
import {decodePunycode, encodePunycode} from "./punycode.js";
import reference from "./__snapshots__/codec-punycode-user-edge.json";

let seed = reference.seed;
const next = () => {
  seed ^= seed << 13;
  seed ^= seed >>> 17;
  seed ^= seed << 5;
  return seed >>>= 0;
};
const alphabet = [0, 9, 10, 13, 32, 45, 47, 48, 57, 65, 90, 97, 122, 127, 128, 255];
const points = [0, 45, 65, 127, 128, 255, 0xd800, 0xdfff, 0xffff, 0x10000, 0x10ffff];
const policies = ["strict", "replace", "ignore"];
const rows: ["decode" | "encode", number[], string][] = [];
for (let index = 0; index < 20000; index++) {
  const bytes = Array.from({length: index % 40}, () => index % 2 ? next() % 256 : alphabet[next() % alphabet.length]);
  rows.push(["decode", bytes, policies[index % 3]]);
}
for (let index = 0; index < 10000; index++) {
  const text = Array.from({length: index % 30}, () => index % 3 === 0 ? points[next() % points.length] : index % 3 === 1 ? next() % 256 : next() % 0x110000);
  rows.push(["encode", text, "strict"]);
}

it("retains the complete Punycode edge corpus and pinned oracle identity", () => {
  expect(reference.oracle.startsWith("3.14.7 ")).toBe(true);
  expect(reference.unicode).toBe("16.0.0");
  expect(reference.platform).toBe("darwin");
  expect(rows).toHaveLength(reference.rows);
  expect(reference.blocks.reduce((total, block) => total + block.count, 0)).toBe(rows.length);
  expect(createHash("sha256").update(JSON.stringify(rows)).digest("hex")).toBe(reference.inputSha256);
});

// Oracle capture is external and retained in the fixture. Bounded blocks cover
// every row; unit tests execute metered kernels without subprocesses or files.
it.each(reference.blocks)("matches Punycode edge rows $offset + $count", ({offset, count, sha256}) => {
  const outcomes = rows.slice(offset, offset + count).map(([operation, input, policy]) => {
    const meter = new ExecutionBudget({maxSteps: 100000, maxAllocatedBytes: 1000000});
    try {
      const result = operation === "decode"
        ? decodePunycode(Uint8Array.from(input), policy, meter)
        : encodePunycode(new CodePointString(Uint32Array.from(input), meter), meter);
      return ["ok", [...result]];
    } catch (error) {
      if (error instanceof PythonDecodeError) return ["decode", error.encoding, [...error.object], String(error.start), String(error.end), error.reason];
      if (error instanceof PythonRuntimeError) return [error.name, error.message];
      // Exhaustion, cancellation and unexpected host faults are test failures.
      throw error;
    }
  });
  expect(createHash("sha256").update(JSON.stringify(outcomes)).digest("hex")).toBe(sha256);
});
