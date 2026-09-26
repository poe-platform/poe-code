import type { Destination } from "../contracts.js";
import { conversionUri } from "./output.js";
import type { Sheet } from "../workbook.js";

/** Gnumeric 1.12.61 ssconvert.c resolve_template/do_split_save.
 * Expand before URI conversion; substitutions are literal and never recursive.
 */
export function splitOutput(template: string, sheet: Sheet, index: number, cwd: string,
  objectName?: string): Destination & { readonly kind: "resource" } {
  template = template.split("\0", 1)[0]!;
  if (!template.includes("%")) template += ".%n";
  let name = "";
  for (let offset = 0; offset < template.length; offset++) {
    const character = template[offset]!;
    if (character !== "%") name += character;
    else {
      const escape = template[++offset];
      if (escape === "n") name += index;
      else if (escape === "s") name += sheet.name.split("\0", 1)[0]!;
      else if (escape === "o") name += objectName?.split("\0", 1)[0] ?? "";
      else if (escape === "%") name += "%";
    }
  }
  // Keep malformed local authorities intact so authorized I/O can refuse them.
  // Canonicalization must never turn a denied mapping into an admitted path.
  if (name.slice(0, 7).toLowerCase() === "file://") {
    const end = name.indexOf("/", 7);
    const authority = name.slice(7, end < 0 ? undefined : end);
    if (authority.includes("@") || authority.includes(":"))
      return { kind: "resource", uri: name };
  }
  return { kind: "resource", uri: conversionUri(name, cwd) };
}
