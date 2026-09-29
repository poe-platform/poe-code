import { builtInDirectContextExecutors } from "../internal.js";
import type { CommandDefinition, VirtualShellPlugin } from "../../contracts/index.js";
import { createGetoptCommand as createRawGetoptCommand } from "./command.js";
import type { GetoptCommandsOptions } from "./internal.js";

export type { GetoptCommandsOptions, GetoptLimits } from "./internal.js";

export function createGetoptCommand(options: GetoptCommandsOptions = {}): CommandDefinition {
  const def = createRawGetoptCommand(options);
  if (options.limits === undefined) builtInDirectContextExecutors.add(def.execute);
  return def;
}

export function createGetoptCommands(options: GetoptCommandsOptions = {}): readonly CommandDefinition[] {
  return [createGetoptCommand(options)];
}

export function getoptCommands(options: GetoptCommandsOptions = {}): VirtualShellPlugin {
  const commands = createGetoptCommands(options);
  return { name: "getopt-commands", setup(host) {
    for (const command of commands) host.commands.register(command, { replace: options.replace ?? false });
  } };
}

function quoteShell(value: string, quote: boolean, tcsh: boolean): string {
  if (!quote) return " " + value;
  if (tcsh) {
    return " '" + value.replace(/[\x27\n!]/g, ch => ch === "'" ? "'\''" : "\\" + ch) + "'";
  }
  return " '" + value.replaceAll("'", "'\\''") + "'";
}

export function evalSyncGetopt(
  args: readonly string[],
  env: { GETOPT_COMPATIBLE?: string | undefined; POSIXLY_CORRECT?: string | undefined }
): string | undefined {
  if (args.length === 0 || args.length > 128) return undefined;
  const compatible = env.GETOPT_COMPATIBLE !== undefined;
  const posix = env.POSIXLY_CORRECT !== undefined;
  let specification: string | undefined;
  let parameters: readonly string[] = args;
  const longSpecs = new Map<string, 0 | 1 | 2>();
  let quote = true, tcsh = false, quietOutput = false, alternative = false;
  if (compatible || !args[0]!.startsWith("-")) {
    let start = 0;
    while (args[0]![start] === "+" || args[0]![start] === "-") start++;
    specification = args[0]!.slice(start);
    parameters = args.slice(1);
    quote = false;
  } else {
    let idx = 0;
    const parseLongSpecList = (raw: string): boolean => {
      for (const token of raw.split(",")) {
        if (!token) continue;
        let name = token;
        let argMode: 0 | 1 | 2 = 0;
        if (name.endsWith("::")) { argMode = 2; name = name.slice(0, -2); }
        else if (name.endsWith(":")) { argMode = 1; name = name.slice(0, -1); }
        if (!name) return false;
        longSpecs.set(name, argMode);
      }
      return true;
    };
    while (idx < args.length) {
      const a = args[idx]!;
      if (a === "--") { idx++; break; }
      if (!a.startsWith("-") || a === "-") break;
      if (a === "-o" || a === "--options") {
        const v = args[++idx];
        if (v === undefined) return undefined;
        specification = v;
      } else if (a.startsWith("--options=")) {
        specification = a.slice(10);
      } else if (a.startsWith("-o") && a.length > 2) {
        specification = a.slice(2);
      } else if (a === "-l" || a === "--longoptions" || a === "--long") {
        const v = args[++idx];
        if (v === undefined || !parseLongSpecList(v)) return undefined;
      } else if (a.startsWith("--longoptions=")) {
        if (!parseLongSpecList(a.slice(14))) return undefined;
      } else if (a.startsWith("--long=")) {
        if (!parseLongSpecList(a.slice(7))) return undefined;
      } else if (a === "-q" || a === "--quiet") {
        // quiet
      } else if (a === "-Q" || a === "--quiet-output") {
        quietOutput = true;
      } else if (a === "-u" || a === "--unquoted") {
        quote = false;
      } else if (a === "-a" || a === "--alternative") {
        alternative = true;
      } else if (a === "-n" || a === "--name") {
        if (args[++idx] === undefined) return undefined;
      } else if (a === "-s" || a === "--shell") {
        const sh = args[++idx];
        if (sh === "bash" || sh === "sh") tcsh = false;
        else if (sh === "tcsh" || sh === "csh") tcsh = true;
        else return undefined;
      } else {
        return undefined;
      }
      idx++;
    }
    if (specification === undefined) {
      if (idx >= args.length) return undefined;
      specification = args[idx++]!;
    }
    parameters = args.slice(idx);
  }
  let spec = specification!;
  let stopEarly = posix;
  let returnInOrder = false;
  if (spec.startsWith("+")) { stopEarly = true; spec = spec.slice(1); }
  else if (spec.startsWith("-")) { returnInOrder = true; spec = spec.slice(1); }
  const shortMap = new Map<string, 0 | 1 | 2>();
  for (let i = 0; i < spec.length; i++) {
    const ch = spec[i]!;
    if (ch === ":") continue;
    if (spec[i + 1] === ":" && spec[i + 2] === ":") { shortMap.set(ch, 2); i += 2; }
    else if (spec[i + 1] === ":") { shortMap.set(ch, 1); i += 1; }
    else shortMap.set(ch, 0);
  }
  let out = "";
  const operands: string[] = [];
  let pIdx = 0;
  while (pIdx < parameters.length) {
    const param = parameters[pIdx]!;
    if (param === "--") {
      pIdx++;
      while (pIdx < parameters.length) operands.push(parameters[pIdx++]!);
      break;
    }
    if (!param.startsWith("-") || param === "-") {
      if (stopEarly) {
        while (pIdx < parameters.length) operands.push(parameters[pIdx++]!);
        break;
      }
      if (returnInOrder) out += quoteShell(param, quote, tcsh);
      else operands.push(param);
      pIdx++;
      continue;
    }
    if (param.startsWith("--") || (alternative && param.startsWith("-") && longSpecs.size > 0 && !shortMap.has(param[1]!))) {
      const rawLong = param.startsWith("--") ? param.slice(2) : param.slice(1);
      const eq = rawLong.indexOf("=");
      const optName = eq < 0 ? rawLong : rawLong.slice(0, eq);
      const inlineVal = eq < 0 ? undefined : rawLong.slice(eq + 1);
      let matchedName: string | undefined;
      if (longSpecs.has(optName)) {
        matchedName = optName;
      } else {
        const matches = [...longSpecs.keys()].filter(k => k.startsWith(optName));
        if (matches.length !== 1) return undefined;
        matchedName = matches[0]!;
      }
      const mode = longSpecs.get(matchedName)!;
      out += ` --${matchedName}`;
      if (mode === 0) {
        if (inlineVal !== undefined) return undefined;
      } else if (mode === 1) {
        const val = inlineVal ?? parameters[++pIdx];
        if (val === undefined) return undefined;
        out += quoteShell(val, quote, tcsh);
      } else {
        out += quoteShell(inlineVal ?? "", quote, tcsh);
      }
      pIdx++;
      continue;
    }
    for (let j = 1; j < param.length; j++) {
      const ch = param[j]!;
      const mode = shortMap.get(ch);
      if (mode === undefined) return undefined;
      out += ` -${ch}`;
      if (mode === 1) {
        const rest = param.slice(j + 1);
        const val = rest.length > 0 ? rest : parameters[++pIdx];
        if (val === undefined) return undefined;
        out += quoteShell(val, quote, tcsh);
        break;
      } else if (mode === 2) {
        const rest = param.slice(j + 1);
        out += quoteShell(rest, quote, tcsh);
        break;
      }
    }
    pIdx++;
  }
  if (quietOutput) return "";
  out += " --";
  for (const op of operands) out += quoteShell(op, quote, tcsh);
  return out;
}
