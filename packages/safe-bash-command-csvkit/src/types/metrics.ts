import { Decimal } from "./decimal.js";

/** Agate Percentiles' CDF method, including the reference binary64 ranks. */
export function decimalPercentiles(values: readonly Decimal[], step: () => void): readonly (Decimal | null)[] {
  step();
  const data = [...values].sort((a, b) => { step(); return a.compare(b); });
  if (!data.length) return Array<null>(101).fill(null);
  const result: Decimal[] = [data[0]!];
  for (let percentile = 1; percentile < 100; percentile++) {
    step();
    const rank = data.length * (percentile / 100);
    const low = Math.max(1, Math.ceil(rank));
    const high = Math.min(data.length, Math.floor(rank + 1));
    result.push(low === high ? data[low - 1]! : data[low - 1]!.add(data[high - 1]!).divide(Decimal.parse("2")));
  }
  result.push(data[data.length - 1]!);
  return result;
}

/** Sample variance follows the source's ordered precision-28 accumulation. */
export function sampleVariance(values: readonly Decimal[], step: () => void): Decimal | null {
  if (!values.length) return null;
  let total = Decimal.parse("0");
  for (const value of values) { step(); total = total.add(value); }
  const mean = total.divide(Decimal.parse(String(values.length)));
  const negativeMean = mean.multiply(Decimal.parse("-1"));
  let squaredDeviations = Decimal.parse("0");
  for (const value of values) {
    step();
    const difference = value.add(negativeMean);
    squaredDeviations = squaredDeviations.add(difference.square());
  }
  return squaredDeviations.divide(Decimal.parse(String(values.length - 1)));
}
