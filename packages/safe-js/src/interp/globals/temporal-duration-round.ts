import { Temporal as Backend } from "temporal-polyfill/full/implementation";
import type { Budget } from "../budget.js";
import { sandboxGetProperty } from "../guest-proxy-get.js";
import { retainValues } from "../resources.js";
import { sandboxNumber, sandboxString } from "../string-coercion.js";
import { createSandboxTemporalDuration, temporalDurationFieldNames, type TemporalDurationFields } from "../temporal-duration.js";
import type { SandboxCallContext, SandboxValue } from "../values.js";
import { readTemporalRelativeTo } from "./temporal-relative-to.js";

export async function roundTemporalDuration(fields: TemporalDurationFields, options: SandboxValue, budget: Budget, context?: SandboxCallContext) {
  if (typeof options !== "string" && (options === null || typeof options !== "object"))
    throw new TypeError("Duration round requires a unit string or options object.");
  const normalized: Backend.DurationRoundingOptions = Object.create(null);
  let current: SandboxValue;
  const release = retainValues(budget, () => [fields, options, current, normalized]);
  try {
    for (const key of ["largestUnit", "relativeTo", "roundingIncrement", "roundingMode", "smallestUnit"] as const) {
      current = typeof options === "string" ? (key === "smallestUnit" ? options : undefined)
        : await sandboxGetProperty(options, key, options, budget, context);
      if (current === undefined) continue;
      if (key === "relativeTo") normalized.relativeTo = await readTemporalRelativeTo(current, budget, context);
      else if (key === "roundingIncrement") {
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
        } else if (key === "largestUnit" && text === "auto") normalized.largestUnit = "auto";
        else {
          const unit = (["year", "month", "week", "day", "hour", "minute", "second", "millisecond", "microsecond", "nanosecond"] as const).find(unit => text === unit || text === `${unit}s`);
          if (unit === undefined) throw new RangeError("Invalid Temporal rounding unit.");
          normalized[key] = unit;
        }
      }
    }
    const result = Backend.Duration.from(fields).round(normalized);
    return createSandboxTemporalDuration(Object.fromEntries(temporalDurationFieldNames.map(name => [name, result[name]])));
  } finally { release(); }
}
