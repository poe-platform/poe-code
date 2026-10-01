import { ZipFailure } from "./options.js";

/** Unix Info-ZIP msname ordering, restricted to its portable ASCII domain. */
export function zipDosName(name: string): string {
  let result = "";
  let length = 0;
  for (const character of name) {
    const code = character.charCodeAt(0);
    if (code >= 127 || code < 32 || character === "\\") {
      throw new ZipFailure(16, "Invalid command arguments", "DOS names require printable ASCII components without backslashes");
    }
    if (' :"*+,;<=>?[]|'.includes(character)) continue;
    if (character === "/") { result += character; length = 0; }
    else if (character === ".") {
      if (length === 0) continue;
      if (length < 9) { result += character; length = 9; }
      else length = 12;
    } else if (length < 12 && length !== 8) {
      result += character.toUpperCase();
      length++;
    }
  }
  return result;
}
