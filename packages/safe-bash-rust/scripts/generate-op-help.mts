// Run with node --import tsx packages/safe-bash-rust/scripts/generate-op-help.mts.
import { writeFileSync } from "node:fs";
import { getOpCommandFlags, opCatalogNodes, opCommandCatalog, opGlobalFlags } from "../../safe-bash-command-op/src/catalog.js";
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
const spells = new Map<string, { name: string; kind: string; global: boolean }>();
const paths = new Map<string, Set<string>>();
for (const node of opCatalogNodes.filter(node => node.availability !== "beta")) {
  for (const [name, flag] of Object.entries(getOpCommandFlags(node.path))) {
    const kind = flag.kind === "boolean" ? "Bool" : flag.kind === "optional" ? "Optional" : "Value";
    const global = name in opGlobalFlags || name === "version";
    for (const spelling of ["--" + name, ...(flag.alias ? ["-" + flag.alias] : []), ...(flag.longAliases ?? []).map(a => "--" + a)]) {
      spells.set(spelling, { name: "--" + name, kind, global });
    }
    if (!global) {
      if (!paths.has(name)) paths.set(name, new Set());
      paths.get(name)!.add(node.path.join(" "));
    }
  }
}
source += "\nuse super::op_cli::Kind;\n";
source += "pub(super) fn flag(spelling: &str) -> Option<(&'static str, Kind, bool)> {\n    Some(match spelling {\n";
for (const [spelling, { name, kind, global }] of spells) {
  source += `        ${JSON.stringify(spelling)} => (${JSON.stringify(name)}, Kind::${kind}, ${global}),\n`;
}
source += "        _ => return None,\n    })\n}\n";
source += "\npub(super) fn local_paths(name: &str) -> &'static [&'static str] {\n    match name {\n";
for (const [name, commands] of paths) {
  source += `        ${JSON.stringify("--" + name)} => &[${[...commands].map(s => JSON.stringify(s)).join(", ")}],\n`;
}
source += "        _ => &[],\n    }\n}\n";
source += "\npub(super) fn operand_bounds(path: &str) -> (usize, Option<usize>) {\n    match path {\n";
for (const { path, args } of opCommandCatalog) {
  if (args) source += `        ${JSON.stringify(path.join(" "))} => (${args.min}, ${args.max === undefined ? "None" : "Some(" + args.max + ")"}),
`;
}
source += "        _ => (0, None),\n    }\n}\n";
writeFileSync(new URL("../src/commands/help/op_topics.rs", import.meta.url), source);
