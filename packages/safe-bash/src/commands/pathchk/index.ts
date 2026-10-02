import {
  createPathchkCommand as createRawPathchkCommand,
  createPathchkCommands as createRawPathchkCommands,
  type PathchkCommandsOptions,
} from "safe-bash-command-pathchk";
import type { CommandDefinition, VirtualShellPlugin } from "../../contracts/index.js";
import { registerDefaultExecutor, registerDefaultExecutors } from "../internal.js";
export * from "safe-bash-command-pathchk";

export function createPathchkCommand(options: PathchkCommandsOptions = {}): CommandDefinition {
  return registerDefaultExecutor(createRawPathchkCommand(options), options);
}

export function createPathchkCommands(options: PathchkCommandsOptions = {}): readonly CommandDefinition[] {
  return registerDefaultExecutors(createRawPathchkCommands(options), options);
}

export function pathchkCommands(options: PathchkCommandsOptions = {}): VirtualShellPlugin {
  const commands = createPathchkCommands(options);
  const replace = options.replace ?? false;
  return {
    name: "pathchk-commands",
    setup(host) {
      if (!replace) {
        for (const command of commands) {
          if (host.commands.has(command.name)) throw new Error(`Command already registered: ${command.name}`);
        }
      }
      for (const command of commands) host.commands.register(command, { replace });
    },
  };
}
const PORTABLE_CHAR_RE = /^[A-Za-z0-9._-]+$/;
const sharedUtf8Encoder = new TextEncoder();

const PATHCHK_HELP_TEXT = `Usage: pathchk [OPTION]... NAME...
Diagnose invalid or unportable file names.

  -p                  check for most POSIX systems
  -P                  check for empty names and leading "-"
      --portability   check for all POSIX systems (equivalent to -p -P)
      --help          display this help and exit
      --version       output version information and exit
`;

const PATHCHK_VERSION_TEXT = `pathchk (Sandbox VFS-ish/GNU coreutils) 9.7
`;

function resolveVfsPath(cwd: string, target: string): string {
  const raw = target.startsWith("/") ? target : (cwd.endsWith("/") ? cwd + target : `${cwd}/${target}`);
  const parts = raw.split("/");
  const stack: string[] = [];
  for (const part of parts) {
    if (!part || part === ".") continue;
    if (part === "..") stack.pop();
    else stack.push(part);
  }
  return "/" + stack.join("/");
}

export function evalSyncPathchk(
  opArgs: readonly string[],
  cwd = "/",
  statTypeSync?: (path: string) => "file" | "directory" | "symlink" | "missing" | undefined,
): string | undefined {
  let checkBasicPosix = false;
  let checkExtraPosix = false;
  const operands: string[] = [];
  let endOfOptions = false;

  for (let i = 0; i < opArgs.length; i++) {
    const arg = opArgs[i]!;
    if (!endOfOptions && arg === "--") {
      endOfOptions = true;
      continue;
    }
    if (!endOfOptions && arg === "--help") return PATHCHK_HELP_TEXT;
    if (!endOfOptions && arg === "--version") return PATHCHK_VERSION_TEXT;
    if (!endOfOptions && arg === "--portability") {
      checkBasicPosix = true;
      checkExtraPosix = true;
      continue;
    }
    if (!endOfOptions && arg.startsWith("--") && arg.length > 2) return undefined;
    if (!endOfOptions && arg.startsWith("-") && arg.length > 1) {
      for (let j = 1; j < arg.length; j++) {
        const ch = arg[j]!;
        if (ch === "p") checkBasicPosix = true;
        else if (ch === "P") checkExtraPosix = true;
        else return undefined;
      }
      continue;
    }
    operands.push(arg);
  }

  if (operands.length === 0) return undefined;

  const pathMax = checkBasicPosix ? 256 : 4096;
  const nameMax = checkBasicPosix ? 14 : 255;

  for (const name of operands) {
    if (name.length === 0) return undefined;
    const bytes = sharedUtf8Encoder.encode(name);
    if (bytes.byteLength >= pathMax) return undefined;

    const components = name.split("/").filter(Boolean);
    let byteOffset = 0;
    for (const comp of components) {
      while (bytes[byteOffset] === 47) byteOffset++;
      const componentStart = byteOffset;
      while (byteOffset < bytes.length && bytes[byteOffset] !== 47) byteOffset++;
      const compBytes = byteOffset - componentStart;
      if (checkExtraPosix && comp.startsWith("-")) return undefined;
      if (checkBasicPosix && !PORTABLE_CHAR_RE.test(comp)) return undefined;
      if (compBytes > nameMax) return undefined;
    }

    if (!checkBasicPosix) {
      if (!statTypeSync) return undefined;
      const full = name.startsWith("/") ? name : `${cwd}/${name}`;
      const parts = full.split("/");
      let current = "";
      for (let k = 0; k < parts.length - 1; k++) {
        if (!parts[k]) continue;
        current += "/" + parts[k]!;
        const st = statTypeSync(resolveVfsPath("/", current));
        if (st === undefined) return undefined;
        if (st === "missing") break;
        if (st !== "directory") return undefined;
      }
    }
  }

  return "";
}

import { syncCommandEvaluators } from "../internal.js";
syncCommandEvaluators.evalSyncPathchk = evalSyncPathchk;
