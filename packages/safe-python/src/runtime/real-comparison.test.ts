import { describe, expect, it } from "vitest";
import { compareReal, hashReal } from "./real-comparison.js";

describe("real numeric comparison and hashing", () => {
  it.each([
    [0n, -0, 0], [1n, 1, 0], [-1n, -1, 0],
    [9007199254740993n, 9007199254740992, 1],
    [-9007199254740993n, -9007199254740992, -1],
    [1n, 1.5, -1], [-1n, -1.5, 1],
    [10n ** 1000n, Infinity, -1], [-(10n ** 1000n), -Infinity, 1],
    [10n ** 1000n, Number.MAX_VALUE, 1],
    [Infinity, Infinity, 0], [-Infinity, Infinity, -1]
  ])("compares %s with %s exactly", (a, b, ordering) => {
    expect(compareReal(a, b)).toBe(ordering);
    expect(compareReal(b, a)).toBe(ordering === 0 ? 0 : -ordering);
  });

  it("reports NaN as unordered, not equal or greater", () => {
    for (const other of [0n, 10n ** 1000n, -0, Infinity, -Infinity, NaN]) {
      expect(compareReal(NaN, other)).toBeUndefined();
      expect(compareReal(other, NaN)).toBeUndefined();
    }
  });

  it.each([
    [0n, 0n], [-0, 0n], [1n, 1n], [-1n, -2n], [-2n, -2n],
    [(1n << 61n) - 1n, 0n], [1n << 61n, 1n], [-(1n << 61n), -2n],
    [0.5, 1n << 60n], [0.1, 230584300921369408n],
    [Infinity, 314159n], [-Infinity, -314159n], [Number.MIN_VALUE, 16777216n]
  ])("hashes %s to the 64-bit Python numeric hash %s", (value, hash) => {
    expect(hashReal(value)).toBe(hash);
  });

  it("shares hashes between equal integers and floats across their common range", () => {
    for (let exponent = 0; exponent <= 1023; exponent += 7) {
      for (const sign of [-1, 1]) {
        const float = sign * 2 ** exponent, integer = BigInt(float);
        expect(compareReal(integer, float)).toBe(0);
        expect(hashReal(integer)).toBe(hashReal(float));
      }
    }
  });

  it("distinguishes equality from hash collisions", () => {
    const prime = (1n << 61n) - 1n;
    expect(hashReal(1n)).toBe(hashReal(prime + 1n));
    expect(compareReal(1n, prime + 1n)).toBe(-1);
    expect(hashReal(-1n)).toBe(hashReal(-2n));
    expect(compareReal(-1n, -2n)).toBe(1);
  });

  it("requires object-identity hashing for NaN rather than assigning a value hash", () => {
    expect(hashReal(NaN)).toBeUndefined();
  });
});
