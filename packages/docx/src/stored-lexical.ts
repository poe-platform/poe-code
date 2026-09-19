import { InvalidDocumentError } from "./document-error.js";

/** XML Schema numeric/boolean whitespace excludes JavaScript's Unicode spaces. */
export function trimXmlWhitespace(raw: string): string {
  let first = 0, last = raw.length;
  while (first < last && [" ", "\t", "\r", "\n"].includes(raw[first]!)) first++;
  while (last > first && [" ", "\t", "\r", "\n"].includes(raw[last - 1]!)) last--;
  return raw.slice(first, last);
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
