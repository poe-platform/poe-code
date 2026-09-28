import type { CommandDefinition, CommandHandler } from "safe-bash-contracts";
import { tryGetMemoryDirectoryEntryNamesSync } from "@poe-code/safe-fs/core";
import { basename, dirname, FsError, isPathWithin, joinPath, normalizePath, relativePath, type CommandContext, type FileStat, type FileSystem } from "safe-bash-contracts";
import { codeOf, define, diagnostic, eachOperand, options, output, pathOf, requireOperands, UsageError } from "safe-bash-command-io-engine/internal";
import { admitFilesystemModes } from "safe-bash-command-io-engine/commands/filesystem-requirements";
import { yieldTurn } from "safe-bash-contracts/yield";
import { canonicalizeReadlinkMissing } from "safe-bash-command-io-engine/commands/readlink-missing";
import { canonicalizeExistingParent } from "safe-bash-command-io-engine/commands/canonicalize-existing-parent";
import { getRuntimeBackingFileSystem } from "safe-bash-contracts/runtime-control";
async function maybeStat(context: CommandContext, path: string, follow = true, allowNonDirectory = false): Promise<FileStat | undefined> {
  if (!allowNonDirectory && path !== "/" && path !== "/dev" && !path.startsWith("/dev/")) {
    const backing = getRuntimeBackingFileSystem(context.fs) as (FileSystem & { symlinkCount?: number }) | undefined;
    if (backing && backing.symlinkCount === 0) {
      const parentEntries = tryGetMemoryDirectoryEntryNamesSync(backing, dirname(path));
      if (parentEntries !== undefined && !parentEntries.has(basename(path))) {
        context.fs.canonicalizeMissingTarget?.(path, { signal: context.signal });
        return undefined;
      }
    }
  }
  try { return await context.fs[follow ? "stat" : "lstat"](path, { signal: context.signal }); }
  catch (error) {
    context.signal.throwIfAborted();
    const code = codeOf(error);
    if (
      code === "ENOENT"
      || (allowNonDirectory && code === "ENOTDIR")
      || (follow && (code === "ENOTDIR" || code === "ELOOP") && await context.fs.lstat(path, { signal: context.signal }).then(stat => stat.type === "symlink", () => false))
    ) {
      return undefined;
    }
    throw error;
  }
}
async function canonicalMissing(
  context: CommandContext, path: string, mode: "copy" | "preflight" | "realpath" = "copy",
): Promise<string> {
  // Copy-target resolution folds missing suffixes lexically. Missing-mode
  // canonicalization must instead resume symlink traversal after each '..'.
  if (mode === "realpath" && (path.split("/").includes("..") || path !== "/" && path.endsWith("/"))) {
    return canonicalizeReadlinkMissing(context, path);
  }
  if (mode !== "copy") {
    context.signal.throwIfAborted();
    try {
      const canonical = context.fs.canonicalizeMissingTarget?.(path, { signal: context.signal });
      context.signal.throwIfAborted();
      if (canonical !== undefined) return canonical;
    } catch (error) {
      context.signal.throwIfAborted();
      if (mode === "realpath" && (codeOf(error) === "ENOENT" || codeOf(error) === "ELOOP")) {
        return canonicalizeReadlinkMissing(context, path);
      }
      // Copy-target hooks require directories; realpath -m does not.
      if (mode !== "realpath" || codeOf(error) !== "ENOTDIR") throw error;
    }
  }
  const originalPath = path;
  const suffix: string[] = [];
  let canonical: string;
  while (true) {
    if (mode === "realpath") {
      context.signal.throwIfAborted();
      if (suffix.length > 0 && suffix.length % 32 === 0) await yieldTurn(context.signal);
    }
    try { canonical = await context.fs.realpath(path, { signal: context.signal }); break; }
    catch (error) {
      context.signal.throwIfAborted();
      if (mode === "realpath" && codeOf(error) === "ELOOP") return canonicalizeReadlinkMissing(context, originalPath);
      if (codeOf(error) !== "ENOENT" && !(mode === "realpath" && codeOf(error) === "ENOTDIR") || path === "/") throw error;
      const link = await maybeStat(context, path, false, mode === "realpath");
      if (link?.type === "symlink") {
        if (mode === "realpath") return canonicalizeReadlinkMissing(context, originalPath);
        throw error;
      }
      suffix.push(basename(path));
      path = dirname(path);
    }
  }
  for (let index = suffix.length - 1; index >= 0; index--) {
    if (mode === "realpath") {
      context.signal.throwIfAborted();
      if ((suffix.length - index) % 32 === 0) await yieldTurn(context.signal);
    }
    canonical = joinPath(canonical, suffix[index]!);
  }
  return canonical;
}
import type { VirtualShellPlugin } from "safe-bash-contracts";
export interface RealpathLimits { readonly maxArgumentBytes: number; }
export interface RealpathCommandsOptions { readonly replace?: boolean; readonly limits?: Partial<RealpathLimits>; }
export function createRealpathCommand(configuration: RealpathCommandsOptions = {}): CommandDefinition {
 const max = configuration.limits?.maxArgumentBytes ?? Infinity; if (max !== Infinity && (!Number.isSafeInteger(max) || max < 1)) throw new RangeError("maxArgumentBytes must be positive");
 const definition = define("realpath", async context => {
  if (max !== Infinity) { let bytes = 0; for (const value of getCommandArguments(context).values) { bytes += shellValueByteLength(value); if (bytes > max) throw new FsError("EFBIG", { message: "argument byte limit exceeded" }); } }
      const args: string[] = [];
      const relative = new Map<string, string>();
      let ended = false;
      for (let index = 0; index < context.args.length; index++) {
        const argument = context.args[index]!;
        if (argument === "--") ended = true;
        const key = argument.split("=", 1)[0]!;
        if (!ended && (key === "--relative-to" || key === "--relative-base")) {
          const equals = argument.indexOf("=");
          const directory = equals < 0 ? context.args[++index] : argument.slice(equals + 1);
          if (directory === undefined) throw new UsageError(`option '${key}' requires an argument`);
          relative.set(key, directory);
        } else args.push(argument);
      }
      let mode = "E";
      let traversal = "P";
      let strip = false;
      const parsed = options(args, "EemszLPq", {
        canonicalize: "E", "canonicalize-existing": "e", "canonicalize-missing": "m",
        logical: "L", physical: "P", quiet: "q", strip: "s", "no-symlinks": "s", zero: "z",
      }, false, undefined, undefined, key => {
        if (key === "E" || key === "e" || key === "m") mode = key;
        if (key === "L") traversal = "L";
        if (key === "P") { traversal = "P"; strip = false; }
        if (key === "s") strip = true;
      });
      requireOperands(parsed.operands);
      const canonical = async (operand: string): Promise<string> => {
        let path = pathOf(context, operand);
        if (strip || traversal === "L") {
          context.signal.throwIfAborted();
          const lexical = normalizePath(path);
          if (mode !== "m") {
            let prefix = "/";
            const components = path.split("/");
            for (let index = 1; index < components.length; index++) {
              const component = components[index]!;
              if (!component || component === "." && index < components.length - 1) continue;
              if (component === ".." || component === ".") {
                const parent = await context.fs.stat(prefix, { signal: context.signal });
                if (parent.type !== "directory") throw new FsError("ENOTDIR", { path: prefix });
              }
              prefix = normalizePath(component, prefix);
              if (mode === "e" || index < components.length - 1) {
                const stat = mode === "e" ? await context.fs.stat(prefix, { signal: context.signal }) : await maybeStat(context, prefix);
                if (index < components.length - 1 && stat !== undefined && stat.type !== "directory") throw new FsError("ENOTDIR", { path: prefix });
              }
            }
            if (mode === "e") await context.fs.stat(lexical, { signal: context.signal });
          }
          if (strip) return lexical;
          path = lexical;
        }
        await admitFilesystemModes(context, "realpath", ["canonical"], [path], mode === "m");
        if (mode === "m") {
          try { await maybeStat(context, path, false, true); }
          catch (error) {
            context.signal.throwIfAborted();
            if (codeOf(error) !== "ELOOP") throw error;
            return canonicalizeReadlinkMissing(context, path);
          }
        }
        return mode === "m" ? await canonicalMissing(context, path, "realpath")
          : mode === "e" ? await context.fs.realpath(path, { signal: context.signal })
          : await canonicalizeExistingParent(context, path);
      };
      const baseOperand = relative.get("--relative-base");
      const toOperand = relative.get("--relative-to") ?? baseOperand;
      let base: string | undefined;
      let to: string | undefined;
      try {
        base = baseOperand === undefined ? undefined : await canonical(baseOperand);
        to = toOperand === undefined ? undefined : await canonical(toOperand);
      } catch (error) {
        context.signal.throwIfAborted();
        if (!parsed.flags.has("q")) await diagnostic(context, error);
        return { exitCode: 1 };
      }
      const operandContext = parsed.flags.has("q") ? { ...context, stderr: { async write() {} } } : context;
      return eachOperand(operandContext, parsed.operands, async operand => {
        const resolved = await canonical(operand);
        const display = to !== undefined && (base === undefined || isPathWithin(base, to) && isPathWithin(base, resolved))
          ? relativePath(to, resolved) || "." : resolved;
        await output(context, display + (parsed.flags.has("z") ? "\0" : "\n"));
      });
    });
 return definition;
}
export function createRealpathCommands(options: RealpathCommandsOptions = {}): readonly CommandDefinition[] { return [createRealpathCommand(options)]; }
export function realpathCommands(options: RealpathCommandsOptions = {}): VirtualShellPlugin { const commands = createRealpathCommands(options); return { name: "realpath-commands", setup(host) { if (!options.replace) for (const command of commands) if (host.commands.has(command.name)) throw new Error(`Command already registered: ${command.name}`); for (const command of commands) host.commands.register(command, {replace: options.replace ?? false}); } }; }

import { getCommandArguments } from "safe-bash-contracts";
import { shellValueByteLength } from "safe-bash-contracts/value";
