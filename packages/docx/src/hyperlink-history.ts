import { storedBooleanValue } from "./stored-lexical.js";
import { InvalidValueError } from "./archive.js";

export function hyperlinkHistory(value: string | undefined): boolean {
  const flag = storedBooleanValue(value ?? "1");
  if (flag !== null) return flag;
  throw new InvalidValueError("Expected a hyperlink history flag.");
}
