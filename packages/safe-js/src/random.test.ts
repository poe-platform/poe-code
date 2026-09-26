import { afterEach, expect, it, vi } from "vitest";
import { createReplayableRandom } from "./random.js";

afterEach(() => vi.restoreAllMocks());

it("seeds an unseeded generator from Web Crypto across the full uint32 range", () => {
  const entropy = vi.spyOn(globalThis.crypto, "getRandomValues").mockImplementation(array => {
    (array as Uint32Array)[0] = 0xffff_ffff;
    return array;
  });
  const random = createReplayableRandom();
  expect(random.seed).toBe(0xffff_ffff);
  expect(entropy).toHaveBeenCalledTimes(1);
  expect(random.next()).toBe(createReplayableRandom({ seed: 0xffff_ffff }).next());
});

it("does not acquire host entropy for an explicit seed", () => {
  const entropy = vi.spyOn(globalThis.crypto, "getRandomValues").mockImplementation(() => {
    throw new Error("Unexpected host entropy");
  });
  expect(createReplayableRandom({ seed: 0 }).seed).toBe(0);
  expect(entropy).not.toHaveBeenCalled();
});

it("propagates unavailable host entropy without a Math.random fallback", () => {
  const failure = new Error("Entropy unavailable");
  vi.spyOn(globalThis.crypto, "getRandomValues").mockImplementation(() => { throw failure; });
  expect(() => createReplayableRandom()).toThrow(failure);
});
