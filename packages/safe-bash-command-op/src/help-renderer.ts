import { getOpCommandFlags, opCatalogNodes, type OpFlagDefinition } from "./catalog.js";

function wrap(text: string, width: number): string[] {
  const lines: string[] = [];
  let line = "";
  for (const word of text.split(" ").filter(Boolean)) {
    if (line && line.length + word.length + 1 > width) { lines.push(line); line = ""; }
    line += (line ? " " : "") + word;
  }
  if (line) lines.push(line);
  return lines;
}

function flagSyntax(name: string, flag: OpFlagDefinition): string {
  const value = flag.metavar ?? (flag.kind === "boolean" ? "" : "string");
  return `${flag.alias ? `-${flag.alias}, ` : "    "}--${name}${flag.kind === "optional" ? `[=${value}]` : value ? ` ${value}` : ""}`;
}

export function renderOpHelp(path: readonly string[], channel: "stable" | "beta" = "stable"): string {
  const node = opCatalogNodes.find(entry => entry.path.join(" ") === path.join(" ") && (channel === "beta" || entry.availability !== "beta"));
  if (!node) throw new Error("Unknown help topic");
  const children = opCatalogNodes.filter(entry => entry.path.length === path.length + 1 && path.every((part, index) => entry.path[index] === part) && (channel === "beta" || entry.availability !== "beta"));
  const prefix = `op${path.length ? ` ${path.join(" ")}` : ""}`;
  const lines = [node.description, "", `Usage:  ${prefix} ${node.synopsis}`, ""];
  if (node.availability !== "stable") lines.push(`Availability: ${node.availability}`, "");
  if (node.aliases.length) lines.push("Aliases:", `  ${[path.at(-1), ...node.aliases].join(", ")}`, "");
  for (const group of ["management", "commands"] as const) {
    const entries = children.filter(child => child.helpGroup === group).sort((first, second) => first.helpOrder - second.helpOrder || first.path.at(-1)!.localeCompare(second.path.at(-1)!));
    if (!entries.length) continue;
    lines.push(group === "management" ? "Management Commands:" : "Commands:");
    const width = Math.max(...entries.map(child => child.path.at(-1)!.length)) + 1;
    for (const child of entries) {
      lines.push(`  ${child.path.at(-1)!.padEnd(width)} ${child.summary}${child.availability === "stable" ? "" : ` [${child.availability}]`}`);
    }
    lines.push("");
  }
  if (node.examples) lines.push("Examples:", node.examples, "");
  const flags = Object.entries(getOpCommandFlags(path, channel)).filter(([name, flag]) => flag.helpVisible !== false && (!path.length || name === "help" || Object.hasOwn(node.flags, name))).sort(([first], [second]) => first.localeCompare(second));
  lines.push(path.length ? "Flags:" : "Global Flags:");
  const width = Math.max(...flags.map(([name, flag]) => flagSyntax(name, flag).length)) + 3;
  for (const [name, flag] of flags) {
    const description = `${flag.description ?? ""}${flag.defaultDisplay === undefined ? "" : ` (default ${flag.defaultDisplay})`}${flag.availability === "beta" ? " [beta]" : ""}`;
    const wrapped = wrap(description, Math.max(20, 143 - width - 2));
    lines.push(`  ${flagSyntax(name, flag).padEnd(width)}${wrapped[0] ?? ""}`.trimEnd());
    for (const continuation of wrapped.slice(1)) lines.push(`${" ".repeat(width + 2)}${continuation}`);
  }
  lines.push("");
  if (path.length) lines.push("To list the global flags available on every command, run  'op --help'.");
  if (children.length) lines.push(...(path.length ? [""] : []), `Run '${prefix} [command] --help' for more information on the command.`);
  return `${lines.join("\n")}\n`;
}
