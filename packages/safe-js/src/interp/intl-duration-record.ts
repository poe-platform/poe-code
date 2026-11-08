import type { Budget } from "./budget.js";
import { readIntlProperty } from "./intl-options.js";
import { retainValues } from "./resources.js";
import { sandboxNumber } from "./string-coercion.js";
import type { SandboxCallContext, SandboxValue } from "./values.js";
import { isSandboxTemporalDuration, temporalDurationFields } from "./temporal-duration.js";

export async function readDurationRecord(input: SandboxValue, budget: Budget, context?: SandboxCallContext) {
  if (isSandboxTemporalDuration(input)) return { ...temporalDurationFields(input) };
  if (typeof input === "string") throw new RangeError("Duration strings are not supported.");
  if (typeof input !== "object" || input === null) throw new TypeError("Expected a duration object.");
  const record = { years: 0, months: 0, weeks: 0, days: 0, hours: 0, minutes: 0, seconds: 0, milliseconds: 0, microseconds: 0, nanoseconds: 0 };
  let raw: SandboxValue;
  let present = false;
  const release = retainValues(budget, () => [input, record, raw]);
  try {
    for (const key of ["days", "hours", "microseconds", "milliseconds", "minutes", "months", "nanoseconds", "seconds", "weeks", "years"] as const) {
      raw = await readIntlProperty(input, key, budget, context);
      if (raw === undefined) continue;
      present = true;
      const value = await sandboxNumber(raw, budget, context);
      if (!Number.isInteger(value)) throw new RangeError("Duration fields must be finite integers.");
      record[key] = value === 0 ? 0 : value;
    }
    if (!present) throw new TypeError("Expected at least one duration field.");
    let sign = 0;
    for (const value of Object.values(record)) {
      const current = Math.sign(value);
      if (current !== 0) {
        if (sign !== 0 && sign !== current) throw new RangeError("Duration fields must have the same sign.");
        sign = current;
      }
    }
    if ([record.years, record.months, record.weeks].some(value => Math.abs(value) >= 2 ** 32))
      throw new RangeError("Duration calendar fields exceed their limit.");
    const nanoseconds = BigInt(record.days) * 86400000000000n + BigInt(record.hours) * 3600000000000n +
      BigInt(record.minutes) * 60000000000n + BigInt(record.seconds) * 1000000000n +
      BigInt(record.milliseconds) * 1000000n + BigInt(record.microseconds) * 1000n + BigInt(record.nanoseconds);
    const limit = (2n ** 53n) * 1000000000n;
    if (nanoseconds <= -limit || nanoseconds >= limit) throw new RangeError("Duration time fields exceed their limit.");
    return record;
  } finally { release(); }
}
