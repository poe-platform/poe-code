const icons = new Set([
  "airplane", "application", "art-supplies", "bankers-box", "brown-briefcase",
  "brown-gate", "buildings", "cabin", "castle", "circle-of-dots", "coffee",
  "color-wheel", "curtained-window", "document", "doughnut", "fence", "galaxy",
  "gears", "globe", "green-backpack", "green-gem", "handshake", "heart-with-monitor",
  "house", "id-card", "jet", "large-ship", "luggage", "plant", "porthole", "puzzle",
  "rainbow", "record", "round-door", "sandals", "scales", "screwdriver", "shop",
  "tall-window", "treasure-chest", "vault-door", "vehicle", "wallet", "wrench"
]);

export function validateVaultOptions(value: Readonly<Record<string, unknown>>): void {
  if (value.icon !== undefined && (typeof value.icon !== "string" || !icons.has(value.icon))) throw new Error("Invalid vault icon");
  if (value["travel-mode"] !== undefined && value["travel-mode"] !== "on" && value["travel-mode"] !== "off") throw new Error("Invalid travel mode");
}
