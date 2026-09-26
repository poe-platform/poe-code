import type { OpFlagDefinition } from "./catalog.js";
import { isOpDuration } from "./duration.js";
import { parseOpFileMode } from "./file-mode.js";
import { parseOpCsv } from "./csv-values.js";

function isPasswordRecipe(value: string): boolean {
  let lengthSeen = false;
  for (const part of value.split(",")) {
    if (["letters", "digits", "symbols"].includes(part.toLowerCase())) continue;
    const digits = part.startsWith("+") ? part.slice(1) : part;
    if (!digits || !Array.from(digits).every(character => character >= "0" && character <= "9")) return false;
    const length = Number(digits);
    if (lengthSeen || length < 1 || length > 64) return false;
    lengthSeen = true;
  }
  return true;
}

export function validateOpFlagValue(name: string, definition: OpFlagDefinition, value: string): void {
  if (definition.valueSyntax === "password-recipe" && !isPasswordRecipe(value)) throw new Error(`invalid value for --${name}`);
  if (definition.valueSyntax === "csv") parseOpCsv(value);
  if (definition.valueSyntax === "duration" && !isOpDuration(value)) throw new Error(`invalid value for --${name}`);
  if (definition.valueSyntax === "go-duration" && !isOpDuration(value, false)) throw new Error(`invalid value for --${name}`);
  if (definition.valueSyntax === "file-mode") {
    try { parseOpFileMode(value); } catch { throw new Error(`invalid value for --${name}`); }
  }
  if (!definition.allowedValues) return;
  const values = definition.kind === "csv" ? value.split(",") : [value];
  for (const entry of values) {
    const normalized = definition.normalizeValues === "trim-lowercase" ? entry.trim().toLowerCase() : definition.normalizeValues === "lowercase" ? entry.toLowerCase() : entry;
    if (!definition.allowedValues.includes(normalized)) throw new Error(`invalid value for --${name}`);
  }
}
