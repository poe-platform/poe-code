import type { Budget } from "../budget.js";
import { sandboxGetProperty } from "../guest-proxy-get.js";
import { retainValues } from "../resources.js";
import { sandboxNumber, sandboxString } from "../string-coercion.js";
import type { SandboxCallContext, SandboxValue } from "../values.js";

export async function readTemporalDifferenceOptions(options: SandboxValue, budget: Budget, context?: SandboxCallContext) {
  if (options !== undefined && (options === null || typeof options !== "object"))
    throw new TypeError("Temporal difference options must be an object.");
  const normalized: Record<string, string | number> = Object.create(null);
  let current: SandboxValue;
  const release = retainValues(budget, () => [options, current, normalized]);
  try {
    for (const name of ["largestUnit", "roundingIncrement", "roundingMode", "smallestUnit"] as const) {
      current = options === undefined ? undefined : await sandboxGetProperty(options, name, options, budget, context);
      if (current === undefined) continue;
      if (name === "roundingIncrement") {
        const increment = Math.trunc(await sandboxNumber(current, budget, context));
        if (!Number.isFinite(increment) || increment < 1 || increment > 1000000000)
          throw new RangeError("Invalid Temporal rounding increment.");
        normalized[name] = increment;
      } else {
        const text = await sandboxString(current, budget, context);
        if (name === "roundingMode") {
          if (!["ceil", "floor", "expand", "trunc", "halfCeil", "halfFloor", "halfExpand", "halfTrunc", "halfEven"].includes(text))
            throw new RangeError("Invalid Temporal rounding mode.");
          normalized[name] = text;
        } else {
          // Category and cross-option checks follow all independently valid reads.
          const unit = text.endsWith("s") ? text.slice(0, -1) : text;
          if (!["year", "month", "week", "day", "hour", "minute", "second", "millisecond", "microsecond", "nanosecond", "auto"].includes(unit)
            || (unit === "auto" && text !== "auto"))
            throw new RangeError("Invalid Temporal difference unit.");
          normalized[name] = unit;
        }
      }
    }
    // The backend accepts smallestUnit: auto, unlike GetDifferenceSettings.
    if (normalized.smallestUnit === "auto") throw new RangeError("Invalid smallest Temporal difference unit.");
    return normalized;
  } finally { release(); }
}
