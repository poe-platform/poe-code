import { canonicalizeIntlOffsetZone } from "./intl-offset-zone.js";

// UTCOffset[+SubMinutePrecision]. Unlike clock seconds, offset seconds cannot
// be 60. The backend currently normalizes overflowing components instead.
export function validateTemporalOffset(input: string): void {
  if (input[0] !== "+" && input[0] !== "-") throw new RangeError("Invalid Temporal offset.");
  let cursor = 1;
  const extended = input[3] === ":";
  for (let component = 0; component < 3; component++) {
    if (component > 0 && extended) {
      if (input[cursor++] !== ":") throw new RangeError("Invalid Temporal offset.");
    }
    const digits = input.slice(cursor, cursor + 2);
    if (digits.length !== 2 || [...digits].some(digit => digit < "0" || digit > "9")
      || Number(digits) > (component === 0 ? 23 : 59)) throw new RangeError("Invalid Temporal offset.");
    cursor += 2;
    if (cursor === input.length) return;
  }
  if (input[cursor] !== "." && input[cursor] !== ",") throw new RangeError("Invalid Temporal offset.");
  const fraction = input.slice(cursor + 1);
  if (fraction.length < 1 || fraction.length > 9 || [...fraction].some(digit => digit < "0" || digit > "9"))
    throw new RangeError("Invalid Temporal offset.");
}

// Validate the offset tokens of the Temporal string grammar; the backend still
// validates the complete date/time, annotation syntax and calendar semantics.
// Callers charge the input length before this linear scan.
export function validateTemporalStringOffsets(input: string, allowTimeOnly = false): void {
  let bracket = input.indexOf("[");
  const body = bracket < 0 ? input : input.slice(0, bracket);
  while (bracket >= 0) {
    const end = input.indexOf("]", bracket + 1);
    if (end < 0) break; // The complete grammar parser rejects unclosed brackets.
    const start = input[bracket + 1] === "!" ? bracket + 2 : bracket + 1;
    const annotation = input.slice(start, end);
    if (!annotation.includes("=")) canonicalizeIntlOffsetZone(annotation);
    bracket = input.indexOf("[", end + 1);
  }
  // Standalone minute-precision zone identifiers, not signed expanded years
  // or the -- prefix of a yearless month-day (including basic --MMDD).
  if (body.length <= 6 && !body.startsWith("--") && (body[0] === "+" || body[0] === "-" || body[0] === "−")) {
    canonicalizeIntlOffsetZone(body);
    return;
  }
  let timeStart = allowTimeOnly ? 0 : -1;
  for (let i = 0; i < body.length; i++) {
    if ((body[i] === "T" || body[i] === "t" || body[i] === " ") && body[i + 1] >= "0" && body[i + 1] <= "9") {
      timeStart = i + 1;
      break;
    }
  }
  if (timeStart < 0) return;
  for (let i = timeStart; i < body.length; i++) {
    if (body[i] === "+" || body[i] === "-" || body[i] === "−") {
      validateTemporalOffset(body.slice(i));
      return;
    }
  }
}
