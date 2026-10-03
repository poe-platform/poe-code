import { renderSvgDocument } from "safe-bash-svg-engine";
import { commandRuntimeIdentity, getCommandArguments, type CommandDefinition, type VirtualShellPlugin } from "safe-bash-contracts";
import { InputByteBudget, collectBytes, writeBytes } from "safe-bash-contracts/io";
import { resolvePath } from "safe-bash-contracts/path";
import { createOutputOperation } from "safe-bash-contracts/output";
import { writeFileOutput } from "safe-bash-contracts/filesystem-output-budget";
import { inheritYieldCheckpoint } from "safe-bash-contracts/yield";

export interface RsvgConvertLimits { readonly maxInputBytes: number; readonly maxNodes: number; readonly maxPixels: number }
export interface RsvgConvertCommandsOptions { readonly limits?: Partial<RsvgConvertLimits>; readonly replace?: boolean }
export function createRsvgConvertCommand(options: RsvgConvertCommandsOptions = {}): CommandDefinition {
  const maxInputBytes = InputByteBudget.limit(options.limits?.maxInputBytes ?? 4 * 1024 * 1024);
  const maxNodes = InputByteBudget.limit(options.limits?.maxNodes ?? 10_000);
  const maxPixels = InputByteBudget.limit(options.limits?.maxPixels ?? 16_000_000);
  return { name: "rsvg-convert", runtimeIdentity: commandRuntimeIdentity, async execute(context) {
    return new InputByteBudget(maxInputBytes, context.inputBudget).run(context, async context => {
      const operation = createOutputOperation(context, { write: async () => {} });
      inheritYieldCheckpoint(context.signal, operation.signal);
      try {
        const args = getCommandArguments(context).args; let format = "png"; let output: string | undefined; let input: string | undefined; let positional = false;
        const diagnostic = async (message: string) => { await writeBytes(context.stderr, new TextEncoder().encode(`rsvg-convert: ${message}\n`), operation.signal); return { exitCode: 1 }; };
        for (let i = 0; i < args.length; i++) {
          const arg = args[i]!;
          if (!positional && arg === "--") { positional = true; continue; }
          if (!positional && arg === "--help") {
            await writeBytes(operation.child(context.stdout).output, new TextEncoder().encode("Usage: rsvg-convert [-f pdf|png] [-o OUTPUT] [INPUT]\n"), operation.signal); return { exitCode: 0 };
          }
          if (!positional && (arg === "-f" || arg === "--format")) { format = args[++i] ?? ""; continue; }
          if (!positional && (arg === "-o" || arg === "--output")) { output = args[++i]; if (!output) return diagnostic("missing output path"); continue; }
          if (!positional && arg.startsWith("-") && arg !== "-") return diagnostic(`unsupported option ${arg}`);
          if (input !== undefined) return diagnostic("expected at most one input"); input = arg;
        }
        if (format !== "pdf" && format !== "png") return diagnostic(`unsupported format ${format}`);
        const bytes = !input || input === "-" ? await collectBytes(context.stdin, { signal: operation.signal }) : await context.fs.readFile(resolvePath(context.cwd, input), { signal: operation.signal });
        let rendered: Uint8Array;
        try { rendered = await renderSvgDocument(new TextDecoder().decode(bytes), format, { signal: operation.signal, maxNodes, maxPixels }); }
        catch (error) { operation.signal.throwIfAborted(); return diagnostic(error instanceof Error ? error.message : "invalid SVG"); }
        if (output && output !== "-") await writeFileOutput(context, rendered, data => context.fs.writeFile(resolvePath(context.cwd, output!), data, { signal: operation.signal }));
        else await writeBytes(operation.child(context.stdout).output, rendered, operation.signal);
        return { exitCode: 0 };
      } finally { await operation.close(); }
    });
  } };
}
export function createRsvgConvertCommands(options: RsvgConvertCommandsOptions = {}): readonly CommandDefinition[] { return [createRsvgConvertCommand(options)]; }
export function rsvgConvertCommands(options: RsvgConvertCommandsOptions = {}): VirtualShellPlugin {
  const commands = createRsvgConvertCommands(options);
  return { name: "rsvg-convert", setup(host) { for (const command of commands) host.commands.register(command, { replace: options.replace ?? false }); } };
}
