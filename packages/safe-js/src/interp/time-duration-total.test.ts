import { expect, it } from "vitest";
import { totalTimeDuration } from "./time-duration-total.js";

it("rounds the validated hour-total discrepancy to the correct binary64 value", () => {
  const ns=816n*3600000000000n+2049187497660n;
  expect(totalTimeDuration(ns,"hour")).toBe(816.56921874935);
  expect(totalTimeDuration(-ns,"hour")).toBe(-816.56921874935);
});

it("rounds integer nanoseconds at even and odd binary64 halfway points", () => {
  expect(totalTimeDuration(9007199254740993n,"nanosecond")).toBe(9007199254740992);
  expect(totalTimeDuration(9007199254740995n,"nanosecond")).toBe(9007199254740996);
  expect(totalTimeDuration(-9007199254740993n,"nanosecond")).toBe(-9007199254740992);
  expect(totalTimeDuration(-9007199254740995n,"nanosecond")).toBe(-9007199254740996);
  expect(totalTimeDuration(18014398509481983n,"nanosecond")).toBe(18014398509481984);
});

it("returns positive zero for a blank duration", () => {
  expect(Object.is(totalTimeDuration(0n,"hour"),0)).toBe(true);
});

// Independent decimal oracle: 120 fractional digits are far beyond the
// separation of binary64 midpoints for the bounded Temporal time domain.
function decimalTotal(ns: bigint, divisor: bigint): number {
  const sign=ns<0n?"-":"";
  const positive=ns<0n?-ns:ns;
  return Number(`${sign}${positive/divisor}.${((positive%divisor)*10n**120n/divisor).toString().padStart(120,"0")}`);
}

it.each([23n, 25n, 24n * 28n, 24n * 31n, 24n * 365n, 24n * 366n])("rounds calendar intervals of %s hours with one final conversion", hours => {
  const divisor = hours * 3600000000000n;
  let seed = 123456789n;
  for (let i = 0; i < 200; i++) {
    seed = (seed * 6364136223846793005n + 1442695040888963407n) % (divisor * 1000000n);
    expect(totalTimeDuration(seed, divisor)).toBe(decimalTotal(seed, divisor));
    expect(totalTimeDuration(-seed, divisor)).toBe(decimalTotal(-seed, divisor));
  }
});

it.each([
  ["day",86400000000000n], ["hour",3600000000000n], ["minute",60000000000n],
  ["second",1000000000n], ["millisecond",1000000n], ["microsecond",1000n], ["nanosecond",1n]
] as const)("matches an independent decimal oracle for %s totals", (unit,divisor) => {
  const limit=9007199254740992n*1000000000n;
  const values=[1n,divisor-1n,divisor,divisor+1n,limit-1n,limit-divisor,9007199254740993n];
  let seed=123456789n;
  for(let i=0;i<200;i++){
    seed=(seed*6364136223846793005n+1442695040888963407n)%limit;
    values.push(seed);
  }
  // Probe both sides of significand midpoint and exponent boundaries. Random
  // spans alone rarely land near these rounding decisions.
  for(let exponent=-47;exponent<=83;exponent++){
    for(const significand of [2n**52n,2n**52n+1n,2n**53n-1n]){
      const numerator=(significand*2n+1n)*divisor;
      const shift=exponent-53;
      const midpoint=shift>=0?numerator<<BigInt(shift):numerator>>BigInt(-shift);
      for(const offset of [-1n,0n,1n]){
        const value=midpoint+offset;
        if(value>0n&&value<limit)values.push(value);
      }
    }
  }
  for(const value of values){
    expect(totalTimeDuration(value,unit)).toBe(decimalTotal(value,divisor));
    if(value!==0n)expect(totalTimeDuration(-value,unit)).toBe(decimalTotal(-value,divisor));
  }
});
