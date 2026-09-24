import { JqError, type Json } from "./limits.js";
import { isNumber, numberValue } from "./numbers.js";

export function fromDateIso8601(input: Json): number {
  if (typeof input !== "string") throw new JqError("strptime/1 requires string inputs and arguments");
  const mismatch = () => new JqError(`date ${JSON.stringify(input)} does not match format "%Y-%m-%dT%H:%M:%SZ"`);
  const parts = input.split("T");
  if (parts.length !== 2 || !parts[1]!.endsWith("Z")) throw mismatch();
  const date = parts[0]!.split("-");
  const time = parts[1]!.slice(0, -1).split(":");
  const fields = [...date, ...time];
  if (date.length !== 3 || time.length !== 3 || fields.some((field, index) => field.length === 0
    || field.length > (index === 0 ? 4 : 2) || [...field].some(character => !"0123456789".includes(character)))) throw mismatch();
  const [year, month, day, hour, minute, second] = fields.map(Number) as [number, number, number, number, number, number];
  if (month < 1 || month > 12 || day > 31 || hour > 23 || minute > 59 || second > 60) throw mismatch();
  if (year < 1900) throw new JqError("invalid gmtime representation");
  // Like jq's mktime, UTC normalizes day overflow and leap seconds.
  return Date.UTC(year, month - 1, day, hour, minute, second) / 1000;
}

export function toDateIso8601(input: Json): string {
  if (!isNumber(input)) throw new JqError("strftime/1 requires parsed datetime inputs");
  const date = new Date(Math.trunc(numberValue(input)) * 1000);
  if (!Number.isFinite(date.getTime())) throw new JqError("error converting number of seconds since epoch to datetime");
  const year = String(date.getUTCFullYear()).padStart(4, "0");
  const fields = [date.getUTCMonth() + 1, date.getUTCDate(), date.getUTCHours(), date.getUTCMinutes(), date.getUTCSeconds()]
    .map(value => String(value).padStart(2, "0"));
  return `${year}-${fields[0]}-${fields[1]}T${fields[2]}:${fields[3]}:${fields[4]}Z`;
}
