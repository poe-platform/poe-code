import { Temporal as TemporalBackend } from "temporal-polyfill/full/implementation";
import type { Budget } from "../budget.js";
import { sandboxGetProperty } from "../guest-proxy-get.js";
import { retainValues } from "../resources.js";
import { sandboxString } from "../string-coercion.js";
import type { TemporalDurationFields } from "../temporal-duration.js";
import type { SandboxCallContext, SandboxValue } from "../values.js";

export async function formatTemporalDuration(fields: TemporalDurationFields, options: SandboxValue, budget: Budget, context?: SandboxCallContext): Promise<string> {
  if (options !== undefined && (options === null || typeof options !== "object"))
    throw new TypeError("Temporal formatting options must be an object.");
  const normalized: Record<string, string | number> = Object.create(null);
  normalized.roundingMode = "trunc";
  let current: SandboxValue;
  const release = retainValues(budget, () => [options, current]);
  try {
    if (options !== undefined) {
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
        if (!["second", "millisecond", "microsecond", "nanosecond"].includes(unit))
          throw new RangeError("Invalid Duration formatting unit.");
        normalized.smallestUnit = unit;
      }
    }
    let result = TemporalBackend.Duration.from(fields).toString(normalized);
    // The backend retains the input sign when rounding a negative duration to
    // zero. Temporal formats the rounded value's sign, which is zero instead.
    if (result.startsWith("-") && TemporalBackend.Duration.from(result).blank) result = result.slice(1);
    return budget.allocateString(result);
  } finally { release(); }
}
