import { OfficeError } from "./errors.js";

export function commandLength(value: string): number {
  const units = { emu: 1, in: 914400, cm: 360000, mm: 36000, pt: 12700 };
  const unit = Object.keys(units).find((candidate) => value.endsWith(candidate));
  const digits = unit ? value.slice(0, -unit.length) : "";
  const pieces = digits.split(".");
  if (
    !unit ||
    pieces.length > 2 ||
    !pieces[0] ||
    pieces.some(
      (piece) => !piece || [...piece].some((character) => character < "0" || character > "9")
    )
  )
    throw new OfficeError(
      "invalid-value",
      "Lengths require a positive decimal and emu, in, cm, mm or pt unit.",
      "usage"
    );
  const raw = Number(digits) * units[unit as keyof typeof units];
  const result = Math.round(raw);
  if (
    !Number.isFinite(raw) ||
    raw > Number.MAX_SAFE_INTEGER ||
    !Number.isSafeInteger(result) ||
    result < 1
  )
    throw new OfficeError("invalid-value", "Length is outside the supported range.", "usage");
  return result;
}

export function commandTimestamp(value: string): Date {
  const date = new Date(value);
  if (
    !Number.isFinite(date.getTime()) ||
    !value.endsWith("Z") ||
    (date.toISOString() !== value && date.toISOString() !== value.slice(0, -1) + ".000Z")
  )
    throw new OfficeError(
      "invalid-value",
      "Timestamp requires a valid UTC date with seconds and Z suffix.",
      "usage"
    );
  return date;
}

export function commandJson(value: string): unknown {
  const frames: { keys?: Set<string>; key: boolean }[] = [];
  try {
    for (let index = 0; index < value.length; index++) {
      const character = value[index];
      if (character === "{") frames.push({ keys: new Set(), key: true });
      else if (character === "[") frames.push({ key: false });
      else if (character === "}" || character === "]") frames.pop();
      else if (character === "," && frames.at(-1)?.keys) frames.at(-1)!.key = true;
      else if (character === '"') {
        const start = index++;
        while (index < value.length && value[index] !== '"') {
          if (value[index] === "\\") index++;
          index++;
        }
        const frame = frames.at(-1);
        if (frame?.keys && frame.key) {
          const key = JSON.parse(value.slice(start, index + 1)) as string;
          if (frame.keys.has(key)) throw new Error("duplicate");
          frame.keys.add(key);
          frame.key = false;
        }
      }
      if (frames.length > 32) throw new Error("depth");
    }
    return JSON.parse(value) as unknown;
  } catch {
    throw new OfficeError(
      "invalid-value",
      "Structured slides require valid JSON without duplicate keys, at most 32 levels deep.",
      "usage"
    );
  }
}
