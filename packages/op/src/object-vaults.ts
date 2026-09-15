import type { OpObject } from "./types.js";

export function selectCreationVault(vaults: readonly OpObject[], selector: unknown, defaultVault?: string): OpObject {
  if (selector === undefined) {
    if (defaultVault !== undefined) {
      const vault = vaults.find(vault => vault.id === defaultVault);
      if (!vault) throw new Error("Default vault is unavailable in the selected scope");
      return vault;
    }
    if (vaults.length !== 1) throw new Error("Select a vault or configure defaultVault");
    return vaults[0]!;
  }
  if (selector !== null && typeof selector === "object" && !Array.isArray(selector)) selector = (selector as Record<string, unknown>).id;
  if (typeof selector !== "string" || !selector) throw new Error("A vault is required");
  const folded = selector.toLowerCase();
  const ids = vaults.filter(vault => vault.id.toLowerCase() === folded);
  const matches = ids.length ? ids : vaults.filter(vault => typeof vault.name === "string" && vault.name.toLowerCase() === folded);
  if (matches.length !== 1) throw new Error(matches.length ? "Ambiguous object selector" : "Object not found");
  return matches[0]!;
}
