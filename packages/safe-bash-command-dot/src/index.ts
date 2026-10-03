import { parseDot, layoutGraph, renderSvg } from "@poe-code/graphviz-ast";
import { commandRuntimeIdentity, getCommandArguments, type CommandDefinition, type VirtualShellPlugin } from "safe-bash-contracts";
import { InputByteBudget, collectBytes, writeBytes } from "safe-bash-contracts/io";
import { resolvePath } from "safe-bash-contracts/path";
import { createOutputOperation } from "safe-bash-contracts/output";
import { writeFileOutput } from "safe-bash-contracts/filesystem-output-budget";
import { inheritYieldCheckpoint, yieldTurn } from "safe-bash-contracts/yield";

export interface DotLimits { readonly maxInputBytes: number; readonly maxNodes: number; readonly maxPixels: number; readonly maxLayoutCost: number }
export interface DotCommandsOptions { readonly limits?: Partial<DotLimits>; readonly replace?: boolean }

export function createDotCommand(options: DotCommandsOptions = {}): CommandDefinition {
  const maxInputBytes = InputByteBudget.limit(options.limits?.maxInputBytes ?? 1024 * 1024);
  const maxNodes = InputByteBudget.limit(options.limits?.maxNodes ?? 10_000);
  const maxPixels = InputByteBudget.limit(options.limits?.maxPixels ?? 16_000_000);
  const maxLayoutCost = InputByteBudget.limit(options.limits?.maxLayoutCost ?? 100_000_000);
  return { name: "dot", runtimeIdentity: commandRuntimeIdentity, async execute(context) {
    return new InputByteBudget(maxInputBytes, context.inputBudget).run(context, async context => {
      const operation = createOutputOperation(context, { write: async () => {} });
      inheritYieldCheckpoint(context.signal, operation.signal);
      try {
        const args = getCommandArguments(context).args; let format = "svg"; let output: string | undefined; let input: string | undefined; let positional = false;
        const diagnostic = async (message: string) => { await writeBytes(context.stderr, new TextEncoder().encode(`dot: ${message}\n`), operation.signal); return { exitCode: 1 }; };
        for (let i = 0; i < args.length; i++) {
          const arg = args[i]!;
          if (!positional && arg === "--") { positional = true; continue; }
          if (!positional && (arg === "--help" || arg === "-?")) {
            await writeBytes(operation.child(context.stdout).output, new TextEncoder().encode("Usage: dot -Tsvg|-Tpdf|-Tpng [-o OUTPUT] [INPUT]\n"), operation.signal); return { exitCode: 0 };
          }
          if (!positional && arg.startsWith("-T")) { format = arg.slice(2) || args[++i] || ""; continue; }
          if (!positional && arg === "-o") { output = args[++i]; if (!output) return diagnostic("missing output path"); continue; }
          if (!positional && arg.startsWith("-") && arg !== "-") return diagnostic(`unsupported option ${arg}`);
          if (input !== undefined) return diagnostic("expected at most one input"); input = arg;
        }
        if (format !== "svg" && format !== "pdf" && format !== "png") return diagnostic(`unsupported format ${format}`);
        const bytes = !input || input === "-" ? await collectBytes(context.stdin, { signal: operation.signal }) : await context.fs.readFile(resolvePath(context.cwd, input), { signal: operation.signal });
        await yieldTurn(operation.signal);
        let svg: string;
        try {
          const graph = parseDot(new TextDecoder().decode(bytes));
          // Every node/edge/subgraph statement is admitted before layout work.
          let count = 0; let edges = 0; let minlen = 1; let extremalRank = false;
          const visit = (value: unknown): number => {
            if (value === null || typeof value !== "object") return 0;
            if (++count > maxNodes) throw new RangeError("graph node limit exceeded");
            const record = value as Record<string, unknown>;
            if (typeof record.minlen === "string" && Number.isFinite(Number(record.minlen))) minlen = Math.max(minlen, Math.round(Number(record.minlen)));
            if (["min", "max", "source", "sink"].includes(String(record.rank))) extremalRank = true;
            let references = typeof record.id === "string" && !("kind" in record) ? 1 : 0;
            for (const [key, child] of Object.entries(record)) {
              if (Array.isArray(child)) {
                let previous = 0;
                for (const item of child) {
                  const current = visit(item);
                  if (key === "endpoints") { edges += previous * current; previous = current; }
                  references += current;
                }
              } else references += visit(child);
            }
            return references;
          };
          visit(graph);
          // Subgraph edges expand as Cartesian products. Each edge can cross
          // every rank, and crossing minimization compares segment pairs.
          const rankSpan = count * minlen;
          const expanded = count + (edges + (extremalRank ? count * count : 0)) * rankSpan;
          const cost = expanded * expanded;
          if (!Number.isSafeInteger(cost) || cost > maxLayoutCost) throw new RangeError("graph layout cost limit exceeded");
          svg = renderSvg(layoutGraph(graph));
        } catch (error) { operation.signal.throwIfAborted(); return diagnostic(error instanceof Error ? error.message : "invalid graph"); }
        await yieldTurn(operation.signal);
        const rendered = format === "svg" ? new TextEncoder().encode(svg) : await (await import("safe-bash-svg-engine")).renderSvgDocument(svg, format, { signal: operation.signal, maxNodes, maxPixels });
        if (output && output !== "-") await writeFileOutput(context, rendered, data => context.fs.writeFile(resolvePath(context.cwd, output!), data, { signal: operation.signal }));
        else await writeBytes(operation.child(context.stdout).output, rendered, operation.signal);
        return { exitCode: 0 };
      } finally { await operation.close(); }
    });
  } };
}
export function createDotCommands(options: DotCommandsOptions = {}): readonly CommandDefinition[] { return [createDotCommand(options)]; }
export function dotCommands(options: DotCommandsOptions = {}): VirtualShellPlugin {
  const commands = createDotCommands(options);
  return { name: "dot", setup(host) { for (const command of commands) host.commands.register(command, { replace: options.replace ?? false }); } };
}
