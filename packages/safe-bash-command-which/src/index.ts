import { registerDefaultExecutor, registerDefaultExecutors } from "safe-bash-io-engine/internal";
import type { CommandDefinition, VirtualShellPlugin } from "safe-bash-contracts";
import type { WhichCommandsOptions } from "./options.js";
import { createWhichCommand } from "./which.js";

export { createWhichCommand } from "./which.js";
export type { WhichCommandsOptions, WhichLimits } from "./options.js";

export function createWhichCommands(options: WhichCommandsOptions = {}): readonly CommandDefinition[] {
  return Object.freeze([registerDefaultExecutor(createWhichCommand(options), options)]);
}

export function whichCommands(options: WhichCommandsOptions = {}): VirtualShellPlugin {
  const commands = createWhichCommands(options);
  const replace = options.replace ?? false;
  return {
    name: "which-commands",
    setup(host) {
      if (!replace) for (const command of commands) {
        if (host.commands.has(command.name)) throw new Error(`Command already registered: ${command.name}`);
      }
      for (const command of commands) host.commands.register(command, { replace });
    },
  };
}

export function evalSyncWhich(
  args: readonly string[],
  cwd: string,
  pathEnv: string | undefined,
  isExecutableFile: (lookupPath: string) => boolean | undefined,
): string | undefined {
  if (pathEnv === undefined || !cwd.startsWith("/") || cwd.includes("\0") || pathEnv.includes("\0")) {
    return undefined;
  }
  for (let k = 0; k < args.length; k++) {
    if (args[k]!.includes("\0")) return undefined;
  }
  let all = false;
  let quiet = false;
  let i = 0;
  while (i < args.length) {
    const arg = args[i]!;
    if (arg === "--") {
      i++;
      break;
    }
    if (arg === "--all") { all = true; i++; continue; }
    if (arg === "--silent" || arg === "--quiet") { quiet = true; i++; continue; }
    if (!arg.startsWith("-") || arg === "-") break;
    for (let j = 1; j < arg.length; j++) {
      const ch = arg[j]!;
      if (ch === "a") all = true;
      else if (ch === "s") quiet = true;
      else return undefined;
    }
    i++;
  }
  if (i >= args.length) return undefined;
  const outLines: string[] = [];
  const probeOne = (display: string): boolean | undefined => {
    if (display.endsWith("/") || display.endsWith("/.") || display.endsWith("/..")) return false;
    const lookup = display.startsWith("/") ? display : `${cwd === "/" ? "" : cwd}/${display}`;
    const ok = isExecutableFile(lookup);
    if (ok === undefined) return undefined;
    if (ok && !quiet) outLines.push(display);
    return ok;
  };
  for (let op = i; op < args.length; op++) {
    const name = args[op]!;
    if (name === "") return undefined;
    if (name.includes("/")) {
      const res = probeOne(name);
      if (res !== true) return undefined;
    } else {
      let found = false;
      let start = 0;
      for (let cursor = 0; cursor <= pathEnv.length; cursor++) {
        if (cursor === pathEnv.length || pathEnv.charCodeAt(cursor) === 58) {
          const dir = cursor === start ? "." : pathEnv.slice(start, cursor);
          const display = `${dir}/${name}`;
          const res = probeOne(display);
          if (res === undefined) return undefined;
          if (res) {
            found = true;
            if (!all) break;
          }
          start = cursor + 1;
        }
      }
      if (!found) return undefined;
    }
  }
  return outLines.length === 0 ? "" : `${outLines.join("\n")}\n`;
}
