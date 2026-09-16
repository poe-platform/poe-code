import { InvalidContainerError } from "./archive.js";
import type { DocumentBudget } from "./budget.js";

/** Validate the entire archive namespace before selecting or acquiring payloads. */
export function validateArchiveNamespace(members: readonly { readonly name: string; readonly directory: boolean }[], budget: DocumentBudget): void {
  const spellings = new Map<string, string>();
  const names = new Map<string, boolean>();
  // Validate the whole namespace, including directories and unselected resources.
  for (const member of members) {
    budget.charge("work", member.name.length + 1);
    budget.charge("retainedBytes", member.name.length * 8 + 128);
    const name = member.directory ? member.name.slice(0, -1) : member.name;
    const segments = name.split("/");
    if (!name || segments.some(segment => !segment || segment === "." || segment === ".." || segment.endsWith(".") || segment.endsWith(" ") || [...segment].some(c => c.codePointAt(0)! < 32 || c === "\x7f")) || name.includes("\\") || name.includes(":"))
      throw new InvalidContainerError("Unsafe archive extraction path.");
    for (let end = 1; end <= segments.length; end++) {
      const spelling = segments.slice(0, end).join("/");
      budget.charge("work", spelling.length * 8 + 1);
      budget.charge("retainedBytes", spelling.length * 8 + 128);
      let decoded: string;
      try { decoded = decodeURIComponent(spelling); } catch { throw new InvalidContainerError("Invalid archive path escape."); }
      const alias = decoded.normalize("NFC").toUpperCase().toLowerCase();
      if (spellings.has(alias) && spellings.get(alias) !== spelling) throw new InvalidContainerError("Ambiguous archive directory alias.");
      spellings.set(alias, spelling);
    }
    const key = name.normalize("NFC").toUpperCase().toLowerCase();
    if (key === "manifest.json" || key.startsWith("manifest.json/") || names.has(key)) throw new InvalidContainerError("Ambiguous archive extraction path.");
    names.set(key, member.directory);
  }
  for (const key of names.keys()) {
    const segments = key.split("/");
    for (let end = 1; end < segments.length; end++)
      if (names.get(segments.slice(0, end).join("/")) === false) throw new InvalidContainerError("Archive file conflicts with a directory.");
  }
}
