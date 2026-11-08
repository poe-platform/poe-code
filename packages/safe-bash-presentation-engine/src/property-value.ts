import type { PropertyType } from "./properties.js";

export function decodePropertyValue(type: PropertyType | "unknown", value: string): string | number | boolean | null {
  if (type === "number")
    return value.trim() !== "" && Number.isFinite(Number(value)) ? Number(value) : null;
  if (type === "boolean")
    return value === "true" || value === "1"
      ? true
      : value === "false" || value === "0"
        ? false
        : null;
  if (type === "date") {
    const segments = value.split("T");
    if (segments.length > 2) return null;
    const calendar = segments[0]!.split("-");
    if (
      calendar.length > 3 ||
      calendar[0]?.length !== 4 ||
      calendar.some(
        (v, i) => v.length !== (i === 0 ? 4 : 2) || [...v].some((c) => c < "0" || c > "9")
      )
    )
      return null;
    const year = Number(calendar[0]),
      month = Number(calendar[1] ?? 1),
      day = Number(calendar[2] ?? 1);
    const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
    if (
      year < 1 ||
      month < 1 ||
      month > 12 ||
      day < 1 ||
      day > [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][month - 1]!
    )
      return null;
    if (
      segments.length === 2 &&
      (calendar.length !== 3 ||
        !(value.endsWith("Z") || value.slice(19).includes("+") || value.slice(19).includes("-")))
    )
      return null;
    const date = new Date(
      segments.length === 1
        ? `${calendar[0]}-${calendar[1] ?? "01"}-${calendar[2] ?? "01"}T00:00:00Z`
        : value
    );
    return Number.isFinite(date.getTime()) ? date.toISOString().slice(0, 19) + "Z" : null;
  }
  return value;
}
