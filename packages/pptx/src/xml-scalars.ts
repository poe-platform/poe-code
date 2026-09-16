import { InvalidXmlError, TypeError as ModelTypeError } from "./errors.js";

function numericToken(value: string): string {
  if (typeof value !== "string") throw new ModelTypeError("XML numeric token must be a string.");
  let start = 0;
  let end = value.length;
  while (start < end && " \t\r\n".includes(value[start]!)) start++;
  while (end > start && " \t\r\n".includes(value[end - 1]!)) end--;
  return value.slice(start, end);
}

function decimal(value: string, fraction: boolean): number {
  let digits = 0;
  let dot = false;
  for (const [index, character] of [...value].entries()) {
    if (index === 0 && (character === "+" || character === "-")) continue;
    if (fraction && character === "." && !dot) {
      dot = true;
      continue;
    }
    if (character < "0" || character > "9") throw new InvalidXmlError("Invalid numeric XML token.");
    digits++;
  }
  const result = Number(value);
  if (!digits || !Number.isFinite(result)) throw new InvalidXmlError("Invalid numeric XML token.");
  return result;
}

export function readXmlInteger(value: string): number {
  const result = decimal(numericToken(value), false);
  if (!Number.isSafeInteger(result))
    throw new InvalidXmlError("XML integer exceeds the safe range.");
  return result;
}

export function readXmlCoordinate(value: string): number {
  value = numericToken(value);
  const units: Readonly<Record<string, number>> = {
    in: 914400,
    mm: 36000,
    cm: 360000,
    pt: 12700,
    pc: 152400,
    pi: 152400
  };
  const scale = units[value.slice(-2)];
  if (scale === undefined) return readXmlInteger(value);
  const scaled = decimal(value.slice(0, -2), true) * scale;
  const result = Math.sign(scaled) * Math.round(Math.abs(scaled));
  if (!Number.isSafeInteger(result))
    throw new InvalidXmlError("XML coordinate exceeds the safe range.");
  return result === 0 ? 0 : result;
}

export function readXmlPercentage(value: string | undefined): number {
  if (value === undefined) throw new InvalidXmlError("Missing percentage value.");
  value = numericToken(value);
  return value.endsWith("%")
    ? decimal(value.slice(0, -1), true) / 100
    : readXmlInteger(value) / 100000;
}
