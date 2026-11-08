import { asciiKey, partName } from "./package-uri.js";

export function relationshipOwner(name: string): string | null {
  const key = asciiKey(name);
  if (key === "/_rels/.rels") return "/";
  const slash = name.lastIndexOf("/");
  const directory = name.slice(0, slash);
  if (!asciiKey(directory).endsWith("/_rels") || !key.endsWith(".rels")) return null;
  return partName(`${directory.slice(0, -6)}/${name.slice(slash + 1, -5)}`, false);
}

