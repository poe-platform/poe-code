import type { Temporal as Backend } from "temporal-polyfill/full/implementation";
import type { Budget } from "../budget.js";
import { sandboxGetProperty } from "../guest-proxy-get.js";
import { retainValues } from "../resources.js";
import { sandboxNumber, sandboxString } from "../string-coercion.js";
import type { SandboxCallContext, SandboxValue } from "../values.js";

export async function readTemporalRoundingOptions<T extends Backend.TimeUnit | "day">(options: SandboxValue, units: readonly T[], budget: Budget, context?: SandboxCallContext): Promise<Backend.RoundingOptions<T>> {
  if (typeof options !== "string" && (options === null || typeof options !== "object"))
    throw new TypeError("Temporal round requires a unit string or options object.");
  const normalized: Backend.RoundingOptions<T> = Object.create(null);
  let current: SandboxValue;
  const release = retainValues(budget, () => [options, current, normalized]);
  try {
    for (const key of ["roundingIncrement", "roundingMode", "smallestUnit"] as const) {
      current = typeof options === "string" ? (key === "smallestUnit" ? options : undefined)
        : await sandboxGetProperty(options, key, options, budget, context);
      if (current === undefined) {
        if (key === "smallestUnit") throw new RangeError("Temporal round requires smallestUnit.");
        continue;
      }
      if (key === "roundingIncrement") {
        const number = Math.trunc(await sandboxNumber(current, budget, context));
        if (!Number.isFinite(number) || number < 1 || number > 1000000000)
          throw new RangeError("Invalid Temporal rounding increment.");
        normalized.roundingIncrement = number;
      } else {
        const text = await sandboxString(current, budget, context);
        if (key === "roundingMode") {
          const mode = (["ceil", "floor", "expand", "trunc", "halfCeil", "halfFloor", "halfExpand", "halfTrunc", "halfEven"] as const).find(mode => mode === text);
          if (mode === undefined) throw new RangeError("Invalid Temporal rounding mode.");
          normalized.roundingMode = mode;
        } else {
          const unit = units.find(unit => text === unit || text === `${unit}s`);
          if (unit === undefined) throw new RangeError("Invalid Temporal rounding unit.");
          normalized.smallestUnit = unit;
        }
      }
    }
    return normalized;
  } finally { release(); }
}
