import { SsconvertError } from "../contracts.js";
import { timezonePeriod } from "@poe-code/spreadsheet-engine/formulas/functions/timezones";

/** Gnumeric's localtime + strftime %Z, using the pinned native TZif profile. */
export function glossaryTimestamp(time: number, timezone: string, tick: () => void): string {
  if (!Number.isFinite(time) || Math.abs(time) > 8640000000000000)
    throw new SsconvertError("invalid-request", "Invalid ssconvert glossary clock");
  const period = timezonePeriod(timezone, time, tick);
  if (!period) throw new SsconvertError("capability-denied", "ssconvert glossary timezone outside supported TZif profile");
  const [offset, abbreviation] = period;
  // Reduce the civil year before adding the offset, so local times beyond
  // either Date boundary remain representable. Gregorian rules repeat in 400 years.
  const local = new Date(Math.floor(time));
  const era = Math.floor(local.getUTCFullYear() / 400);
  local.setUTCFullYear(local.getUTCFullYear() - era * 400);
  local.setTime(local.getTime() + offset * 1000);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${local.getUTCFullYear() + era * 400}-${pad(local.getUTCMonth() + 1)}-${pad(local.getUTCDate())} ${pad(local.getUTCHours())}:${pad(local.getUTCMinutes())}${abbreviation}`;
}
