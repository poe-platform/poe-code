import type { Budget } from "../budget.js";
import { sandboxGetProperty } from "../guest-proxy-get.js";
import { retainValues } from "../resources.js";
import { sandboxString } from "../string-coercion.js";
import type { SandboxCallContext, SandboxValue } from "../values.js";

export async function readTemporalStringOptions(options: SandboxValue, budget: Budget, context?: SandboxCallContext, includeCalendar = false, includeZone = false): Promise<Record<string, string | number>> {
  if (options !== undefined && (options === null || typeof options !== "object"))
    throw new TypeError("Temporal formatting options must be an object.");
  const normalized: Record<string, string | number> = Object.create(null);
  let current: SandboxValue;
  const release = retainValues(budget, () => [options, current, normalized]);
  try {
    if (options !== undefined) {
      if (includeCalendar) {
        current = await sandboxGetProperty(options, "calendarName", options, budget, context);
        if (current !== undefined) {
          const display = await sandboxString(current, budget, context);
          if (!["auto", "always", "never", "critical"].includes(display)) throw new RangeError("Invalid calendar display option.");
          normalized.calendarName = display;
        }
      }
      current = await sandboxGetProperty(options, "fractionalSecondDigits", options, budget, context);
      if (current !== undefined) {
        if (typeof current === "number") {
          const digits = Math.floor(current);
          if (!Number.isFinite(digits) || digits < 0 || digits > 9) throw new RangeError("Invalid fractional second digits.");
          normalized.fractionalSecondDigits = digits;
        } else {
          if (await sandboxString(current, budget, context) !== "auto") throw new RangeError("Invalid fractional second digits.");
          normalized.fractionalSecondDigits = "auto";
        }
      }
      if (includeZone) {
        current = await sandboxGetProperty(options, "offset", options, budget, context);
        if (current !== undefined) {
          const offset = await sandboxString(current, budget, context);
          if (!["auto", "never"].includes(offset)) throw new RangeError("Invalid offset display option.");
          normalized.offset = offset;
        }
      }
      current = await sandboxGetProperty(options, "roundingMode", options, budget, context);
      if (current !== undefined) {
        const mode = await sandboxString(current, budget, context);
        if (!["ceil", "floor", "expand", "trunc", "halfCeil", "halfFloor", "halfExpand", "halfTrunc", "halfEven"].includes(mode))
          throw new RangeError("Invalid Temporal rounding mode.");
        normalized.roundingMode = mode;
      }
      current = await sandboxGetProperty(options, "smallestUnit", options, budget, context);
      if (current !== undefined) {
        const text = await sandboxString(current, budget, context);
        const unit = text.endsWith("s") ? text.slice(0, -1) : text;
        if (!(includeZone ? ["year", "month", "week", "day", "hour", "minute", "second", "millisecond", "microsecond", "nanosecond"] : ["minute", "second", "millisecond", "microsecond", "nanosecond"]).includes(unit))
          throw new RangeError("Invalid Temporal formatting unit.");
        normalized.smallestUnit = unit;
      }
      if (includeZone) {
        current = await sandboxGetProperty(options, "timeZoneName", options, budget, context);
        if (current !== undefined) {
          const display = await sandboxString(current, budget, context);
          if (!["auto", "never", "critical"].includes(display)) throw new RangeError("Invalid time zone display option.");
          normalized.timeZoneName = display;
        }
        if (normalized.smallestUnit !== undefined && !["minute", "second", "millisecond", "microsecond", "nanosecond"].includes(String(normalized.smallestUnit)))
          throw new RangeError("Invalid Temporal formatting unit.");
      }
    }
    return normalized;
  } finally { release(); }
}
