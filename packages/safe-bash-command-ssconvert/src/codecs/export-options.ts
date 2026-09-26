import { SsconvertError } from "../contracts.js";
import type { ExportOptionRule } from "./types.js";
import { foldSheetName } from "../workbook/case-fold.js";

/** GOffice string/boolean/enum property handling for the captured C locale. */
export function applyExportOption(rule: ExportOptionRule, key: string, value: string): void {
  if (rule.kind === "string") return;
  if (rule.kind === "boolean") {
    if (["true", "false", "yes", "no", "1", "0"].includes(foldSheetName(value))) return;
  } else {
    // g_ascii_strcasecmp folds ASCII only, without Unicode transformations.
    const folded = rule.asciiCaseInsensitive ? Array.from(value, character =>
      character >= "A" && character <= "Z" ? character.toLowerCase() : character).join("") : value;
    if (rule.values.includes(folded)) return;
    if (rule.error) throw new SsconvertError("invalid-request", `ssconvert: ${rule.error}`);
  }
  throw new SsconvertError("invalid-request", `ssconvert: Invalid value for option ${key}: "${value}"`);
}
