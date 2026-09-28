import { SsconvertError } from "../contracts.js";
import { glossaryTimezones, glossaryTimezoneEnd } from "./glossary-timezones.js";

/** Gnumeric's localtime + strftime %Z, within the pinned source TZif profile. */
export function glossaryTimestamp(time: number, timezone: string, tick: () => void): string {
  if (!Number.isFinite(time)) throw new SsconvertError("invalid-request", "Invalid ssconvert glossary clock");
  const transitions = Object.hasOwn(glossaryTimezones, timezone) ? glossaryTimezones[timezone] : undefined;
  if (!transitions || time < 0 || time >= glossaryTimezoneEnd)
    throw new SsconvertError("capability-denied", "ssconvert glossary timezone/date outside supported TZif profile (UTC, America/Los_Angeles, Asia/Kolkata, Europe/Warsaw; 1970–2037 UTC)");
  let low = 0, high = transitions.length;
  while (low + 1 < high) {
    tick();
    const middle = Math.floor((low + high) / 2);
    if (transitions[middle]![0] * 1000 <= time) low = middle;
    else high = middle;
  }
  tick();
  const [, offset, abbreviation] = transitions[low]!;
  const local = new Date(Math.floor(time) + offset * 1000);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${local.getUTCFullYear()}-${pad(local.getUTCMonth() + 1)}-${pad(local.getUTCDate())} ${pad(local.getUTCHours())}:${pad(local.getUTCMinutes())}${abbreviation}`;
}
