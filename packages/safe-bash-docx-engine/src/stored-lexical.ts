import { InvalidDocumentError } from "./document-error.js";

/** XML Schema numeric/boolean whitespace excludes JavaScript's Unicode spaces. */
export function trimXmlWhitespace(raw: string): string {
  let first = 0, last = raw.length;
  while (first < last && [" ", "\t", "\r", "\n"].includes(raw[first]!)) first++;
  while (last > first && [" ", "\t", "\r", "\n"].includes(raw[last - 1]!)) last--;
  return raw.slice(first, last);
}

/** Compare xsd:integer identities exactly without narrowing them to JS numbers. */
export function storedIntegerIdentity(raw: string | undefined): string | undefined {
  if (raw === undefined) return undefined;
  const token = trimXmlWhitespace(raw);
  const sign = token[0] === "-" || token[0] === "+";
  const digits = sign ? token.slice(1) : token;
  if (!digits.length || [...digits].some(character => character < "0" || character > "9")) return undefined;
  let first = 0;
  while (first < digits.length - 1 && digits[first] === "0") first++;
  const magnitude = digits.slice(first);
  return token[0] === "-" && magnitude !== "0" ? "-" + magnitude : magnitude;
}

/** Decode stored on/off values; callers retain their distinct absence defaults. */
export function storedBoolean(raw: string, message = "Invalid stored document boolean."): boolean {
  const value = storedBooleanValue(raw);
  if (value !== null) return value;
  throw new InvalidDocumentError(message);
}

/** Tolerated on/off string spellings do not acquire xsd:boolean's whitespace. */
export function storedBooleanValue(raw: string): boolean | null {
  if (raw === "on") return true;
  if (raw === "off") return false;
  const token = trimXmlWhitespace(raw);
  if (["1", "true"].includes(token)) return true;
  if (["0", "false"].includes(token)) return false;
  return null;
}
