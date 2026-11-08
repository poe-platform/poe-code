const prerequisites: Readonly<Record<string, readonly string[]>> = {
  view_items: [],
  create_items: ["view_items"],
  view_and_copy_passwords: ["view_items"],
  edit_items: ["view_and_copy_passwords", "view_items"],
  archive_items: ["edit_items", "view_and_copy_passwords", "view_items"],
  delete_items: ["edit_items", "view_and_copy_passwords", "view_items"],
  view_item_history: ["view_and_copy_passwords", "view_items"],
  import_items: ["create_items", "view_items"],
  export_items: ["view_item_history", "view_and_copy_passwords", "view_items"],
  copy_and_share_items: ["view_item_history", "view_and_copy_passwords", "view_items"],
  print_items: ["view_item_history", "view_and_copy_passwords", "view_items"],
  manage_vault: [],
};

const umbrellas: Readonly<Record<string, readonly string[]>> = {
  allow_viewing: ["view_items", "view_and_copy_passwords", "view_item_history"],
  allow_editing: ["create_items", "edit_items", "archive_items", "delete_items", "import_items", "export_items", "copy_and_share_items", "print_items"],
  allow_managing: ["manage_vault"],
};

const moveRequirements = ["view_items", "edit_items", "archive_items", "view_and_copy_passwords", "view_item_history", "copy_and_share_items"];

export function expandVaultPermissions(permissions: readonly string[]): string[] {
  const expanded = new Set<string>();
  for (const permission of permissions) {
    if (Object.hasOwn(umbrellas, permission)) {
      for (const granular of umbrellas[permission]!) expanded.add(granular);
    } else if (Object.hasOwn(prerequisites, permission) || permission === "move_items") expanded.add(permission);
    else throw new Error("Invalid vault permission");
  }
  if (moveRequirements.every(permission => expanded.has(permission))) expanded.add("move_items");
  return [...expanded];
}

export function changeVaultPermissions(current: readonly string[], requested: readonly string[], action: "grant" | "revoke"): string[] {
  if (action === "grant" && !requested.length) throw new Error("Vault permissions are required");
  if (action === "revoke" && !requested.length) return [];
  if (requested.includes("move_items")) throw new Error("move_items is derived from its underlying vault permissions");
  const existing = expandVaultPermissions(current).filter(permission => permission !== "move_items");
  const selected = expandVaultPermissions(requested).filter(permission => permission !== "move_items");
  const remaining = new Set(action === "grant" ? [...existing, ...selected] : existing.filter(permission => !selected.includes(permission)));
  const missing = new Set<string>();
  const dependent = new Set<string>();
  for (const permission of remaining) {
    for (const prerequisite of prerequisites[permission]!) {
      if (!remaining.has(prerequisite)) {
        missing.add(prerequisite);
        dependent.add(permission);
      }
    }
  }
  if (missing.size) {
    throw new Error(action === "grant"
      ? `Required vault permissions must be granted explicitly: ${[...missing].sort().join(", ")}`
      : `Dependent vault permissions must also be revoked: ${[...dependent].sort().join(", ")}`);
  }
  return expandVaultPermissions([...remaining]);
}
