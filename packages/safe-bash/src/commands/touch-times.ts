import { PublicDiagnostic } from "../diagnostics.js";
import { millisecondsInstant, parseDate, TimeZone } from "./time-env/calendar.js";
import { CommandFailure } from "./time-env/shared.js";

export function touchTimes(
  date: string | undefined, timestamp: string | undefined, timezone: string,
  base: { readonly atimeMs: number; readonly mtimeMs: number },
): { readonly atimeMs: number; readonly mtimeMs: number } {
  try {
    const zone = new TimeZone(timezone);
    if (timestamp !== undefined) {
      const parts = timestamp.split(".");
      const digits = parts[0]!;
      if (parts.length > 2 || ![8, 10, 12].includes(digits.length)
        || [...digits].some(character => character < "0" || character > "9")
        || parts[1] !== undefined && (parts[1].length !== 2 || [...parts[1]].some(character => character < "0" || character > "9"))) {
        throw new CommandFailure(`invalid date format '${timestamp}'`);
      }
      const prefix = digits.slice(0, -8);
      const year = prefix.length === 4 ? Number(prefix) : prefix.length === 2
        ? Number(prefix) + (Number(prefix) >= 69 ? 1900 : 2000) : zone.fields(millisecondsInstant(base.mtimeMs)).year;
      const fields = digits.slice(-8);
      const second = Number(parts[1] ?? 0);
      const instant = zone.instant({ year, month: Number(fields.slice(0, 2)), day: Number(fields.slice(2, 4)),
        hour: Number(fields.slice(4, 6)), minute: Number(fields.slice(6, 8)), second: second === 60 ? 59 : second });
      const milliseconds = Number(instant / 1000000n) + (second === 60 ? 1000 : 0);
      return { atimeMs: milliseconds, mtimeMs: milliseconds };
    }
    if (date === undefined) return base;
    const access = parseDate(date, zone, () => millisecondsInstant(base.atimeMs));
    const modify = parseDate(date, zone, () => millisecondsInstant(base.mtimeMs));
    return { atimeMs: Number(access / 1000000n) + Number(access % 1000000n) / 1000000,
      mtimeMs: Number(modify / 1000000n) + Number(modify % 1000000n) / 1000000 };
  } catch (error) {
    if (error instanceof CommandFailure) throw new PublicDiagnostic(error.message);
    throw error;
  }
}
