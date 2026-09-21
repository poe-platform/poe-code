import { SsconvertError } from "../contracts.js";
import { exportOptionPairs } from "../cli/export-options.js";
import { cNumber } from "./c-number.js";

/** Image options are validated at save, including sheets with no objects. */
export function validateImageOptions(options: readonly string[]): number {
  let resolution = 100;
  for (const text of options) for (const [key, value] of exportOptionPairs(text)) {
    resolution = cNumber(value);
    if (key !== "resolution" || !(resolution >= 1 && resolution <= 10000))
      throw new SsconvertError("invalid-request", `ssconvert: Invalid export option "${key}=${value}" for image export`);
  }
  return resolution;
}
