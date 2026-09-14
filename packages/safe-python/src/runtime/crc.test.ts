import {expect, it} from "vitest";
import reference from "./__snapshots__/crc-3.14.7.json";
import {crc32, crcHqx} from "./crc.js";
import {ExecutionBudget, ExecutionLimitError, type ExecutionMeter} from "./execution-budget.js";

it("matches pinned CRC results for every byte, seed boundaries and long inputs", () => {
  expect(reference.oracle.version.startsWith("3.14.7 ")).toBe(true);
  expect(reference.oracle.unicode).toBe("16.0.0");
  for (const [hex, seed, expected32, expectedHqx] of reference.rows) {
    const text = hex as string;
    const input = Uint8Array.from({length: text.length / 2}, (_, index) => Number.parseInt(text.slice(index * 2, index * 2 + 2), 16));
    expect([crc32(input, seed as number), crcHqx(input, seed as number)], `${hex}, ${seed}`).toEqual([expected32, expectedHqx]);
  }
});

it("matches all 65536 two-byte inputs against the external oracle", () => {
  const actual = reference.pairs.map((_, index) => {
    const input = Uint8Array.of(index >>> 8, index & 255);
    return [crc32(input), crcHqx(input, 0)];
  });
  expect(actual).toEqual(reference.pairs);
});

it.each([crc32, crcHqx])("resumes at every byte split without modifying input", checksum => {
  const input = Uint8Array.from({length: 256}, (_, index) => index);
  const original = input.slice();
  for (const seed of [0, 1, 0x80000000, 0xffffffff]) {
    const expected = checksum(input, seed);
    for (let split = 0; split <= input.length; split++) {
      expect(checksum(input.subarray(split), checksum(input.subarray(0, split), seed))).toBe(expected);
    }
  }
  expect(input).toEqual(original);
});

it.each([crc32, crcHqx])("charges work and keeps cancellation terminal at entry, processing and return", checksum => {
  const input = new Uint8Array(64);
  expect(() => checksum(input, 0, new ExecutionBudget({maxSteps: 4, maxAllocatedBytes: 0}))).toThrow(ExecutionLimitError);
  for (const length of [0, 64]) {
    for (const at of [1, length === 0 ? 2 : 3, length + 2]) {
      const controller = new AbortController();
      const budget = new ExecutionBudget({maxSteps: 10000, maxAllocatedBytes: 0, signal: controller.signal});
      let calls = 0;
      const meter: ExecutionMeter = {checkpoint(steps, bytes) {
        if (++calls === at) controller.abort();
        budget.checkpoint(steps, bytes);
      }};
      expect(() => checksum(input.subarray(0, length), 0, meter)).toThrow(ExecutionLimitError);
      expect(() => budget.checkpoint()).toThrow(ExecutionLimitError);
    }
  }
});

it("uses unsigned results, masks HQX seeds and needs no temporary buffer allocation", () => {
  const empty = new Uint8Array();
  expect(crc32(empty, 0xffffffff)).toBe(0xffffffff);
  expect(crcHqx(empty, 0xffffffff)).toBe(0xffff);
  const input = Uint8Array.of(49, 50, 51, 52, 53, 54, 55, 56, 57);
  const meter = new ExecutionBudget({maxSteps: 10000, maxAllocatedBytes: 0});
  expect(crc32(input, 0, meter)).toBe(0xcbf43926);
  expect(crcHqx(input, 0, meter)).toBe(0x31c3);
});
