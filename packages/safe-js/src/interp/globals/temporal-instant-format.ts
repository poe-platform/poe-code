import { Temporal as TemporalBackend } from "temporal-polyfill/full/implementation";
import type { Budget } from "../budget.js";
import { parseTemporalTimeZoneString } from "../temporal-time-zone-string.js";
import { sandboxGetProperty } from "../guest-proxy-get.js";
import { retainValues } from "../resources.js";
import { sandboxString } from "../string-coercion.js";
import { isSandboxTemporalZonedDateTime, temporalZonedDateTimeFields } from "../temporal-zoned-date-time.js";
import type { SandboxCallContext, SandboxValue } from "../values.js";

export async function formatTemporalInstant(epoch: bigint, options: SandboxValue, budget: Budget, context?: SandboxCallContext): Promise<string> {
  if (options!==undefined && (options===null || typeof options!=="object"))
    throw new TypeError("Temporal formatting options must be an object.");
  const normalized: Record<string,string|number>=Object.create(null);
  normalized.roundingMode="trunc";
  let current: SandboxValue;
  const release=retainValues(budget,()=>[options,current]);
  try {
    if (options!==undefined) {
      current=await sandboxGetProperty(options,"fractionalSecondDigits",options,budget,context);
      if (current!==undefined) {
        if (typeof current==="number") {
          const digits=Math.floor(current);
          if (!Number.isFinite(digits) || digits<0 || digits>9) throw new RangeError("Invalid fractional second digits.");
          normalized.fractionalSecondDigits=digits;
        } else {
          if (await sandboxString(current,budget,context)!=="auto") throw new RangeError("Invalid fractional second digits.");
          normalized.fractionalSecondDigits="auto";
        }
      }
      current=await sandboxGetProperty(options,"roundingMode",options,budget,context);
      if (current!==undefined) {
        const mode=await sandboxString(current,budget,context);
        if (!["ceil","floor","expand","trunc","halfCeil","halfFloor","halfExpand","halfTrunc","halfEven"].includes(mode))
          throw new RangeError("Invalid Temporal rounding mode.");
        normalized.roundingMode=mode;
      }
      current=await sandboxGetProperty(options,"smallestUnit",options,budget,context);
      let unit: string|undefined;
      if (current!==undefined) {
        const text=await sandboxString(current,budget,context);
        unit=text.endsWith("s")?text.slice(0,-1):text;
        if ((unit==="auto" && text!=="auto") || !["year","month","week","day","hour","minute","second","millisecond","microsecond","nanosecond","auto"].includes(unit))
          throw new RangeError("Invalid Temporal unit.");
        normalized.smallestUnit=unit;
      }
      current=await sandboxGetProperty(options,"timeZone",options,budget,context);
      if (unit!==undefined && !["minute","second","millisecond","microsecond","nanosecond"].includes(unit))
        throw new RangeError("Invalid Instant formatting unit.");
      if (current!==undefined) {
        if (isSandboxTemporalZonedDateTime(current)) current=temporalZonedDateTimeFields(current).timeZone;
        if (typeof current!=="string") throw new TypeError("Time zone must be a string or ZonedDateTime.");
        budget.visitNode(current.length);
        normalized.timeZone=budget.allocateString(parseTemporalTimeZoneString(current));
      }
    }
    // Exact-time rounding uses positive-direction semantics even before the
    // epoch. The backend's sign-sensitive modes mishandle subsecond negatives.
    if (normalized.roundingMode==="trunc") normalized.roundingMode="floor";
    else if (normalized.roundingMode==="expand") normalized.roundingMode="ceil";
    else if (normalized.roundingMode==="halfTrunc") normalized.roundingMode="halfFloor";
    else if (normalized.roundingMode==="halfExpand") normalized.roundingMode="halfCeil";
    return budget.allocateString(new TemporalBackend.Instant(epoch).toString(normalized));
  } finally {release();}
}
