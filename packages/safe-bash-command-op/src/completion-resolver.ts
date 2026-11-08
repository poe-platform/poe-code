import { getOpCommandFlags, opCatalogNodes, opCommandCatalog, opGlobalFlags, type OpCatalogCommand, type OpFlagDefinition } from "./catalog.js";
import { validateOpFlagValue } from "./flag-values.js";

export interface OpCompletionResult {
  readonly candidates: readonly { readonly value: string; readonly description: string }[];
  readonly directive: 0 | 4;
}

export function resolveOpCompletion(words: readonly string[], channel: "stable" | "beta" = "stable"): OpCompletionResult {
  const catalog = opCommandCatalog.filter(command => channel === "beta" || command.availability !== "beta");
  const previous = words.slice(0, -1);
  const current = words.at(-1) ?? "";
  const path: string[] = [];
  const used = new Set<string>();
  let command: OpCatalogCommand | undefined;
  let pending: string | undefined;
  let stopped = false;
  let invalid = false;
  let help = false;
  const available = () => getOpCommandFlags(path, channel);
  const consume = (name: string, definition: OpFlagDefinition, value: string | undefined, spelling: string) => {
    used.add(definition.longAliases?.includes(spelling) ? spelling : name);
    if (name === "help" || name === "version") help = true;
    if (definition.kind === "boolean") {
      if (value !== undefined && !["true", "false", "1", "0", "t", "f", "TRUE", "FALSE", "True", "False", "T", "F"].includes(value)) invalid = true;
    } else if (definition.kind !== "optional" && value === undefined) pending = name;
    if (name === "format" && value !== undefined && !["json", "human-readable"].includes(value)) invalid = true;
    if (definition.completionRejectEmpty && value === "") invalid = true;
    if (value !== undefined) {
      try { validateOpFlagValue(name, definition, value); } catch { invalid = true; }
    }
  };
  for (const token of previous) {
    if (pending !== undefined) {
      if (pending === "format" && !["json", "human-readable"].includes(token)) invalid = true;
      if (available()[pending]?.completionRejectEmpty && token === "") invalid = true;
      const definition = available()[pending];
      if (definition) {
        try { validateOpFlagValue(pending, definition, token); } catch { invalid = true; }
      }
      pending = undefined;
      continue;
    }
    if (stopped || invalid) break;
    if (token === "--") { stopped = true; break; }
    if (token.startsWith("-") && token !== "-") {
      const flags = available();
      if (token.startsWith("--")) {
        const equal = token.indexOf("=");
        const spelling = token.slice(2, equal < 0 ? undefined : equal);
        const name = Object.hasOwn(flags, spelling) ? spelling : Object.keys(flags).find(key => flags[key]!.longAliases?.includes(spelling));
        if (!name) { invalid = true; break; }
        consume(name, flags[name]!, equal < 0 ? undefined : token.slice(equal + 1), spelling);
      } else {
        for (let index = 1; index < token.length; index++) {
          const name = Object.keys(flags).find(key => flags[key]!.alias === token[index]);
          if (!name) { invalid = true; break; }
          const definition = flags[name]!;
          const remainder = token.slice(index + 1);
          const attached = remainder.startsWith("=") || definition.kind !== "boolean";
          consume(name, definition, attached && remainder ? remainder.startsWith("=") ? remainder.slice(1) : remainder : undefined, name);
          if (attached) break;
        }
      }
      continue;
    }
    if (command) continue;
    if (path.length === 0 && token === "help") { stopped = true; break; }
    const candidates = catalog.filter(entry => path.every((part, index) => entry.path[index] === part) && (entry.path[path.length] === token || entry.path.length === path.length + 1 && entry.aliases.includes(token)));
    if (!candidates.length) { invalid = true; break; }
    path.push(candidates[0]!.path[path.length]!);
    command = candidates.find(entry => entry.path.length === path.length);
  }
  if (invalid || pending !== undefined || stopped) return { candidates: [], directive: 0 };
  if (help) return { candidates: [], directive: 4 };
  if (current.startsWith("-")) {
    if (current.includes("=")) return { candidates: [], directive: 0 };
    const flags = available();
    const inherited = path.length ? Object.keys(opGlobalFlags).filter(name => name !== "help") : [];
    const local = Object.keys(flags).filter(name => !inherited.includes(name));
    const candidates: { value: string; description: string }[] = [];
    const required: { value: string; description: string }[] = [];
    for (const name of [...inherited.sort(), ...local.sort()]) {
      const definition = flags[name];
      if (!definition || definition.completionVisible === false || used.has(name) && definition.kind !== "array" && definition.valueSyntax !== "csv") continue;
      for (const value of [`--${name}`, ...(definition.alias ? [`-${definition.alias}`] : [])]) {
        if (value.startsWith(current)) {
          const candidate = { value, description: definition.description ?? "" };
          candidates.push(candidate);
          if (definition.completionRequired && !used.has(name)) required.push(candidate);
        }
      }
    }
    return { candidates: required.length ? required : candidates, directive: 4 };
  }
  if (command) return { candidates: [], directive: 0 };
  const names = new Set(catalog.filter(entry => path.every((part, index) => entry.path[index] === part)).map(entry => entry.path[path.length]!));
  if (!path.length) names.add("help");
  return { candidates: [...names].sort().filter(value => value.startsWith(current)).map(value => ({ value, description: opCatalogNodes.find(node => node.path.join(" ") === [...path, value].join(" "))?.summary ?? "Help about any command" })), directive: 4 };
}
