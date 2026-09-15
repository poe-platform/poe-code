import {createHash} from "node:crypto";
import {expect, it} from "vitest";
import {BinasciiError} from "./binascii-error.js";
import {ExecutionBudget} from "./execution-budget.js";
import {decodeUu} from "./uuencode.js";
import reference from "./__snapshots__/codec-uu-user-edge.json";

const alphabet = [0, 9, 10, 13, 31, 32, 33, 63, 64, 95, 96, 97, 127, 255];
const rows: number[][] = [];
for (let lead = 0; lead < 256; lead++) {
  for (const second of alphabet) {
    for (const third of alphabet) rows.push([lead, second, third]);
  }
}
let seed = reference.seed;
const next = () => {
  seed ^= seed << 13;
  seed ^= seed >>> 17;
  seed ^= seed << 5;
  return seed >>>= 0;
};
for (let index = 0; index < 10000; index++) {
  rows.push(Array.from({length: index % 90}, () => index % 2 ? next() % 256 : alphabet[next() % alphabet.length]));
}

it("retains every UU edge input and the pinned external reference", () => {
  expect(reference.version.startsWith("3.14.7 ")).toBe(true);
  expect(reference.unicode).toBe("16.0.0");
  expect(reference.platform).toBe("darwin");
  expect(rows).toHaveLength(reference.rows);
  expect(reference.blocks.reduce((total, block) => total + block.count, 0)).toBe(rows.length);
  expect(createHash("sha256").update(JSON.stringify(rows)).digest("hex")).toBe(reference.inputSha256);
});

// Replay the complete external corpus through the real metered byte kernel.
// Unit tests never invoke Python, create files, or accept sandbox faults.
it.each(reference.blocks)("matches UU edge rows $offset + $count", ({offset, count, sha256}) => {
  const outcomes = rows.slice(offset, offset + count).map(input => {
    const meter = new ExecutionBudget({maxSteps: 1000, maxAllocatedBytes: 1000});
    try {
      return ["ok", [...decodeUu(Uint8Array.from(input), meter)]];
    } catch (error) {
      if (!(error instanceof BinasciiError)) throw error;
      return ["Error", error.message];
    }
  });
  expect(createHash("sha256").update(JSON.stringify(outcomes)).digest("hex")).toBe(sha256);
});
