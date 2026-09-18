import { InvalidValueError } from "./archive.js";

export function hyperlinkHistory(value: string | undefined): boolean {
  if (value === undefined || ["1", "true", "on"].includes(value)) return true;
  if (["0", "false", "off"].includes(value)) return false;
  throw new InvalidValueError("Expected a hyperlink history flag.");
}
