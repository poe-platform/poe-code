import {expect, it} from "vitest";
import {createHash} from "node:crypto";
import {normalizeNfkcPoints} from "./normalization.js";
import {unicode32Normalization} from "./normalization-unicode32-data.js";
import reference from "./runtime/__snapshots__/normalization-3.2-3.14.7.json" with {type: "json"};
import {ExecutionBudget, ExecutionLimitError} from "./runtime/execution-budget.js";

it("matches the pinned 3.2 NFKC result for every Unicode code point", () => {
  const hash = createHash("sha256"), word = Buffer.alloc(4);
  for (let point = 0; point <= 0x10ffff; point++) {
    const result = normalizeNfkcPoints([point], unicode32Normalization);
    word.writeUInt32LE(result.length); hash.update(word);
    for (const output of result) {word.writeUInt32LE(output); hash.update(word);}
  }
  expect(hash.digest("hex")).toBe(reference.singlePointSha256);
});

it("matches combining-class interactions, blocking, Hangul and normalization corrections", () => {
  expect(reference.sequences.map(([input]) => [input, normalizeNfkcPoints(input, unicode32Normalization)]))
    .toEqual(reference.sequences);
});

it("matches all five columns of every Unicode 3.2 normalization conformance row", () => {
  const corpus = reference.normalizationTest;
  expect(createHash("sha256").update(corpus.text).digest("hex")).toBe(corpus.sha256);
  const hash = createHash("sha256"), word = Buffer.alloc(4);
  const mismatches: unknown[] = [];
  let count = 0;
  for (const line of corpus.text.split("\n")) {
    const body = line.split("#", 1)[0].trim();
    if (!body || body.startsWith("@")) continue;
    const fields = body.split(";").slice(0, 5).map(field => field.trim().split(" ").map(point => Number.parseInt(point, 16)));
    for (const input of fields) {
      const result = normalizeNfkcPoints(input, unicode32Normalization);
      if (result.length !== fields[3].length || result.some((point, index) => point !== fields[3][index])) mismatches.push({input, result, expected: fields[3]});
      word.writeUInt32LE(result.length); hash.update(word);
      for (const point of result) {word.writeUInt32LE(point); hash.update(word);}
      count++;
    }
  }
  expect(mismatches).toEqual([]);
  expect(count).toBe(corpus.invocations);
  expect(hash.digest("hex")).toBe(corpus.resultSha256);
});

it("preserves separate surrogate points and uses 3.2 rather than modern properties", () => {
  const points = [0xd835, 0xdc00, 0x1ccd6, 0x1e9e];
  expect(normalizeNfkcPoints(points, unicode32Normalization)).toEqual(points);
  expect(normalizeNfkcPoints([0x2f868], unicode32Normalization)).toEqual([0x2136a]);
});

it("meters decomposition expansion, ordering, composition and output allocation", () => {
  const points = [0xfdfa, 0x41, 0x315, 0x300, 0x1100, 0x1161, 0x11a8];
  const meter = new ExecutionBudget({maxSteps: 10000, maxAllocatedBytes: 10000});
  let checkpoints = 0;
  const result = normalizeNfkcPoints(points, unicode32Normalization, {checkpoint(steps, bytes) {
    checkpoints++; meter.checkpoint(steps, bytes);
  }});
  expect(result).toEqual(normalizeNfkcPoints(points, unicode32Normalization));
  expect(meter.usage.allocatedBytes).toBeGreaterThan(result.length * 4);
  for (const resource of ["maxSteps", "maxAllocatedBytes"] as const) {
    const exhausted = new ExecutionBudget({maxSteps: 10000, maxAllocatedBytes: 10000, [resource]: 0});
    expect(() => normalizeNfkcPoints(points, unicode32Normalization, exhausted)).toThrow(ExecutionLimitError);
  }
  for (let stop = 1; stop <= checkpoints; stop++) {
    let calls = 0;
    const cancelled = {checkpoint() {if (++calls === stop) throw new ExecutionLimitError("cancelled");}};
    expect(() => normalizeNfkcPoints(points, unicode32Normalization, cancelled)).toThrow(ExecutionLimitError);
  }
});
