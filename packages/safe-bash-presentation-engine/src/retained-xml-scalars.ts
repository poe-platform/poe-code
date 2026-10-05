import { readJsonNumber } from "@poe-code/json-ast";
import type { ByteSource } from "./contracts.js";
import { characters } from "./retained-values.js";
import { InvalidXmlError } from "./errors.js";

/** OOXML numeric grammar without collecting padding, leading zeros or precision. */
export async function readRetainedXmlScalar(
  kind: "integer" | "coordinate" | "percentage",
  source: ByteSource,
  check: () => void
): Promise<number> {
  let started = false,
    trailing = false,
    digits = false,
    dot = false,
    invalid = false,
    suffix = "";
  async function* number() {
    for await (const character of characters(source)) {
      check();
      if (invalid) continue;
      if (" \t\r\n".includes(character)) {
        if (started) trailing = true;
        continue;
      }
      if (trailing) {
        invalid = true;
        continue;
      }
      const first = !started;
      started = true;
      if (suffix || character === "%" || (character >= "a" && character <= "z")) {
        if (suffix.length === 2) invalid = true;
        else suffix += character;
        continue;
      }
      if (first && (character === "+" || character === "-")) {
        yield character;
        continue;
      }
      if (character === "." && !dot) {
        dot = true;
        yield character;
        continue;
      }
      if (character >= "0" && character <= "9") {
        digits = true;
        yield character;
      } else invalid = true;
    }
  }
  const value = await readJsonNumber(
    number(),
    async () => {
      check();
    },
    false
  );
  check();
  const units: Readonly<Record<string, number>> = {
    in: 914400,
    mm: 36000,
    cm: 360000,
    pt: 12700,
    pc: 152400,
    pi: 152400
  };
  const scale = kind === "coordinate" ? units[suffix] : undefined;
  const fractional = scale !== undefined || (kind === "percentage" && suffix === "%");
  if (
    invalid ||
    !digits ||
    !Number.isFinite(value) ||
    (dot && !fractional) ||
    (suffix && !fractional)
  )
    throw new InvalidXmlError("Invalid numeric XML token.");
  if (scale !== undefined) {
    const scaled = value * scale,
      result = Math.sign(scaled) * Math.round(Math.abs(scaled));
    if (!Number.isSafeInteger(result))
      throw new InvalidXmlError("XML coordinate exceeds the safe range.");
    return result === 0 ? 0 : result;
  }
  if (kind === "percentage" && suffix === "%") return value / 100;
  if (!Number.isSafeInteger(value))
    throw new InvalidXmlError("XML integer exceeds the safe range.");
  return kind === "percentage" ? value / 100000 : value;
}
