import type { CommandDefinition, CommandHandler } from "safe-bash-contracts";
import { FsError, type CommandContext } from "safe-bash-contracts";
import { define, diagnostic, eachOperand, options, output, pathOf, requireOperands } from "safe-bash-command-io-engine/internal";
import { admitFilesystemModes } from "safe-bash-command-io-engine/commands/filesystem-requirements";
import { PublicDiagnostic } from "safe-bash-contracts/diagnostics";
import { canonicalizeReadlinkMissing } from "safe-bash-command-io-engine/commands/readlink-missing";
import { canonicalizeExistingParent } from "safe-bash-command-io-engine/commands/canonicalize-existing-parent";
function needCapability(context: CommandContext, capability: "symlink" | "link" | "readlink" | "utimes"): void {
  const declaration = { symlink: "symlinks", link: "hardlinks", readlink: "readlink", utimes: "timestamps" }[capability];
  if (!context.fs.capabilitiesFor && context.fs.capabilities[declaration] === false) throw new FsError("ENOTSUP", { syscall: capability });
  if (!context.fs[capability]) throw new FsError("ENOTSUP", { syscall: capability });
}
import type { VirtualShellPlugin } from "safe-bash-contracts";
export interface ReadlinkLimits { readonly maxArgumentBytes: number; }
export interface ReadlinkCommandsOptions { readonly replace?: boolean; readonly limits?: Partial<ReadlinkLimits>; }
export function createReadlinkCommand(configuration: ReadlinkCommandsOptions = {}): CommandDefinition {
 const max = configuration.limits?.maxArgumentBytes ?? Infinity; if (max !== Infinity && (!Number.isSafeInteger(max) || max < 1)) throw new RangeError("maxArgumentBytes must be positive");
 const definition = define("readlink", async context => {
  if (max !== Infinity) { let bytes = 0; for (const value of getCommandArguments(context).values) { bytes += shellValueByteLength(value); if (bytes > max) throw new FsError("EFBIG", { message: "argument byte limit exceeded" }); } }
      const canonicalOptions: Record<string, string> = { canonicalize: "f", "canonicalize-existing": "e", "canonicalize-missing": "m" };
      let verboseMode = "default" as "default" | "verbose" | "quiet";
      const parsed = options(context.args, "femnzvqs", { ...canonicalOptions, zero: "z", "no-newline": "n", verbose: "v", quiet: "q", silent: "s" }, false, undefined, undefined, key => {
        if (key === "v") verboseMode = "verbose";
        else if (key === "q" || key === "s") verboseMode = "quiet";
      });
      requireOperands(parsed.operands);
      if (parsed.flags.has("n") && parsed.operands.length > 1 && verboseMode !== "quiet") {
        await diagnostic(context, new PublicDiagnostic("ignoring --no-newline with multiple arguments"));
      }
      let mode = "link";
      for (const argument of context.args) {
        if (argument === "--") break;
        const flags = argument.startsWith("--") ? canonicalOptions[argument.slice(2)] ?? ""
          : argument.startsWith("-") ? argument.slice(1) : "";
        for (const flag of flags) if (flag === "f" || flag === "e" || flag === "m") mode = flag;
      }
      const operandContext = verboseMode === "quiet"
        ? { ...context, stderr: { async write() {} } }
        : verboseMode === "default"
        ? { ...context, stderr: { async write(bytes: Uint8Array) {
            const text = new TextDecoder().decode(bytes);
            if (!text.includes("EINVAL") && !text.includes("ENOENT")) await context.stderr.write(bytes);
          } } }
        : context;
      return eachOperand(operandContext, parsed.operands, async operand => {
        const path = pathOf(context, operand);
        await admitFilesystemModes(context, "readlink", [mode === "link" ? "link" : "canonical"], [path]);
        let result: string;
        if (mode === "m") result = await canonicalizeReadlinkMissing(context, path);
        else if (mode === "e") result = await context.fs.realpath(path, { signal: context.signal });
        else if (mode === "f") result = await canonicalizeExistingParent(context, path);
        else {
          needCapability(context, "readlink");
          result = await context.fs.readlink!(path, { signal: context.signal });
        }
        await output(context, result + (parsed.flags.has("n") && parsed.operands.length === 1 ? "" : parsed.flags.has("z") ? "\0" : "\n"));
      });
    });
 return definition;
}
export function createReadlinkCommands(options: ReadlinkCommandsOptions = {}): readonly CommandDefinition[] { return [createReadlinkCommand(options)]; }
export function readlinkCommands(options: ReadlinkCommandsOptions = {}): VirtualShellPlugin { const commands = createReadlinkCommands(options); return { name: "readlink-commands", setup(host) { if (!options.replace) for (const command of commands) if (host.commands.has(command.name)) throw new Error(`Command already registered: ${command.name}`); for (const command of commands) host.commands.register(command, {replace: options.replace ?? false}); } }; }

import { getCommandArguments } from "safe-bash-contracts";
import { shellValueByteLength } from "safe-bash-contracts/value";
