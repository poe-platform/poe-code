// Run with node --import tsx packages/safe-bash-rust/scripts/generate-op-help.mts.
import { writeFileSync } from "node:fs";
import { getOpCommandFlags, opCatalogNodes, opCommandCatalog } from "../../safe-bash-command-op/src/catalog.js";
import { renderOpHelp } from "../../safe-bash-command-op/src/help-renderer.js";

let source = "// Generated from the stable op catalog by scripts/generate-op-help.mts.\n";
source += "pub(super) fn child(parent: &str, word: &str) -> Option<(&'static str, bool, &'static str)> {\n    Some(match (parent, word) {\n";
for (const node of opCatalogNodes) {
  if (!node.path.length || node.availability === "beta") continue;
  const name = node.path.at(-1)!;
  const parent = node.path.slice(0, -1).join(" ");
  const spellings = [name, ...node.aliases].map(s => JSON.stringify(s)).join(" | ");
  const group = !opCommandCatalog.includes(node);
  source += `        (${JSON.stringify(parent)}, ${spellings}) => (${JSON.stringify(node.path.join(" "))}, ${group}, ${JSON.stringify(renderOpHelp(node.path))}),\n`;
}
source += "        _ => return None,\n    })\n}\n";
const valueFlags = new Set<string>();
for (const node of opCommandCatalog.filter(node => node.availability !== "beta")) {
  for (const [name, flag] of Object.entries(getOpCommandFlags(node.path))) {
    if (flag.kind === "boolean" || flag.kind === "optional") continue;
    valueFlags.add("--" + name);
    if (flag.alias) valueFlags.add("-" + flag.alias);
    for (const alias of flag.longAliases ?? []) valueFlags.add("--" + alias);
  }
}
source += `
pub(super) fn takes_value(flag: &str) -> bool {
    matches!(flag, ${[...valueFlags].sort().map(s => JSON.stringify(s)).join(" | ")})
}
`;
source += "\npub(super) fn operand_bounds(path: &str) -> (usize, Option<usize>) {\n    match path {\n";
for (const { path, args } of opCommandCatalog) {
  if (args) source += `        ${JSON.stringify(path.join(" "))} => (${args.min}, ${args.max === undefined ? "None" : "Some(" + args.max + ")"}),
`;
}
source += "        _ => (0, None),\n    }\n}\n";
writeFileSync(new URL("../src/commands/help/op_topics.rs", import.meta.url), source);
