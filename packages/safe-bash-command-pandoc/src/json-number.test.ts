import {expect, it} from "vitest";
import {readJsonNumber} from "./json-number.js";

// The existing reader policy is the oracle. This deliberately uses whole-token
// arithmetic; production must obtain the same result with bounded fragments.
function original(token: string): number {
  const value = Number(token);
  if (!Number.isFinite(value) || Number.isInteger(value) && !Number.isSafeInteger(value)) throw new RangeError();
  if (Number.isInteger(value)) {
    const [mantissa = "", exponent = "0"] = token.toLowerCase().split("e");
    const [whole = "", fraction = ""] = mantissa.split(".");
    const digits = whole + fraction, scale = Number(exponent) - fraction.length;
    if (digits.length > 1024 || Math.abs(scale) > 1024) throw new RangeError();
    const coefficient = BigInt(digits), divisor = 10n ** BigInt(Math.abs(scale));
    if (scale >= 0 ? coefficient * divisor !== BigInt(value) : coefficient % divisor !== 0n || coefficient / divisor !== BigInt(value)) throw new RangeError();
  }
  return value;
}
async function check(token: string, size: number): Promise<void> {
  let expected: number;
  try {expected = original(token);} catch {
    await expect(readJsonNumber((async function* () {for (let i = 0; i < token.length; i += size) yield token.slice(i, i + size);})(), async () => {})).rejects.toThrow(RangeError);
    return;
  }
  const value = await readJsonNumber((async function* () {for (let i = 0; i < token.length; i += size) yield token.slice(i, i + size);})(), async units => {
    expect(units).toBeLessThanOrEqual(4096);
  });
  expect(value).toBe(expected);
}
it.each([1, 7, 65536])("preserves the existing rounding policy across fragments (%i)", async size => {
  for (const token of ["0", "-0", "1", "-1", "1.25", "1e-10", "0e9999", "-0e-9999", "1e9999", "1e-9999", "9007199254740991", "9007199254740992", "9007199254740990.5", "9.007199254740991e15", "5e-324", "1e-324", "1.7976931348623157e308", "0.1" + "0".repeat(12000), "1." + "0".repeat(12000), "0." + "0".repeat(12000) + "1e12001", "1" + "0".repeat(12000) + "e-12001", "1e" + "0".repeat(12000) + "1", "1e-" + "0".repeat(12000) + "1", "0e" + "9".repeat(12000), "1e" + "9".repeat(12000)])
    await check(token, size);
});
it("resolves distant digits on both sides of binary64 rounding midpoints", async () => {
  for (const multiplier of [1n, 3n, 5n]) {
    const coefficient = multiplier * 5n ** 1075n * 10n ** 500n;
    for (const delta of [-1n, 0n, 1n]) {
      const digits = String(coefficient + delta);
      const token = "0." + "0".repeat(1575 - digits.length) + digits;
      await check(token, 31);
      await check("-" + token, 31);
    }
  }
});
it("matches native conversion and prior validation over varied long mantissas", async () => {
  let seed = 1770;
  const random = () => (seed = Math.imul(seed, 1664525) + 1013904223 >>> 0);
  for (let test = 0; test < 120; test++) {
    const length = random() % 3000 + 1;
    let digits = "";
    for (let i = 0; i < length; i++) digits += random() % 10;
    const token = (random() % 2 ? "-" : "") + "0." + digits + "e" + (random() % 650 - 325);
    await check(token, 113);
  }
});
it("cooperates inside large supplied fragments and closes the source on cancellation", async () => {
  const reason = new Error("cancelled");
  let closed = false, calls = 0;
  const fragments = (async function* () {
    try {yield "0." + "1".repeat(100000); throw new Error("read past cancellation");}
    finally {closed = true;}
  })();
  await expect(readJsonNumber(fragments, async () => {if (++calls === 2) throw reason;})).rejects.toBe(reason);
  expect(closed).toBe(true);
  expect(calls).toBe(2);
});
