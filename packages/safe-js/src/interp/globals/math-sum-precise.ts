import type { Budget } from "../budget.js";
import { createDataCheckpoint } from "../data-checkpoint.js";
import { acquireSandboxIterator, closeIterator, getSandboxIterator, readIteratorResult, type SandboxIterator } from "../iteration.js";
import { retainValues } from "../resources.js";
import type { SandboxCallContext, SandboxValue } from "../values.js";

export async function sumPrecise(source: SandboxValue, budget: Budget, context?: SandboxCallContext): Promise<number> {
  let iterator: SandboxIterator | undefined;
  let current: SandboxValue;
  let recordValue: SandboxValue;
  let sum = 0n;
  let sumSize = 1;
  let special: number | undefined;
  let minusZero = true;
  let count = 0;
  const storage = new DataView(new ArrayBuffer(8));
  const checkData = createDataCheckpoint(budget, context);
  const release = retainValues(budget, () => [source, iterator?.retainedValue, recordValue, current, sum]);
  try {
    if (source === undefined || source === null) throw new TypeError("Math.sumPrecise requires an iterable.");
    iterator = context === undefined
      ? getSandboxIterator(source, budget)
      : await acquireSandboxIterator(source, budget, context);
    if (iterator === undefined) throw new TypeError("Math.sumPrecise requires an iterable.");
    checkData(source, 0, true);
    while (true) {
      budget.visitNode();
      const next = iterator.next();
      const result = iterator.asynchronous || iterator.generator ? await next : next;
      if ((typeof result !== "object" && typeof result !== "function") || result === null)
        throw new TypeError("Iterator result must be an object.");
      recordValue = result as unknown as SandboxValue;
      const record = result as IteratorResult<SandboxValue>;
      if ((await readIteratorResult(iterator, record, "done")).value) break;
      current = (await readIteratorResult(iterator, record, "value")).value;
      if (count >= Number.MAX_SAFE_INTEGER || typeof current !== "number") {
        const error = count >= Number.MAX_SAFE_INTEGER
          ? new RangeError("Math.sumPrecise received too many elements.")
          : new TypeError("Math.sumPrecise requires number elements.");
        await closeIterator(iterator, true);
        throw error;
      }
      count++;
      if (!Object.is(current, -0)) minusZero = false;
      if (Number.isNaN(current)) special = NaN;
      else if (!Number.isFinite(current)) {
        special = special === undefined || special === current ? current : NaN;
      } else if (special === undefined) {
        // Every finite binary64 is an integer multiple of 2^-1074.
        storage.setFloat64(0, current);
        const bits = storage.getBigUint64(0);
        const exponent = Number((bits >> 52n) & 2047n);
        const fraction = bits & ((1n << 52n) - 1n);
        const significand = exponent === 0 ? fraction : (1n << 52n) | fraction;
        const units = significand << BigInt(Math.max(0, exponent - 1));
        sum += bits >> 63n ? -units : units;
      }
      current = undefined;
      recordValue = undefined;
      const size = sum.toString(16).length;
      checkData(source, Math.max(0, size - sumSize));
      sumSize = size;
    }
    if (special !== undefined) return special;
    if (minusZero) return -0;
    const sign = sum < 0n ? -1 : 1;
    if (sum < 0n) sum = -sum;
    // Round once to 53 significant bits, with ties to even.
    const shift = Math.max(0, sum.toString(2).length - 53);
    let rounded = sum >> BigInt(shift);
    if (shift > 0) {
      const remainder = sum - (rounded << BigInt(shift));
      const half = 1n << BigInt(shift - 1);
      if (remainder > half || (remainder === half && (rounded & 1n) === 1n)) rounded++;
    }
    return sign * Number(rounded) * 2 ** (shift - 1074);
  } finally { release(); }
}
