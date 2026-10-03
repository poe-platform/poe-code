import {
  commandRuntimeIdentity,
  getCommandArguments,
  writeText,
  type CommandDefinition
} from "safe-bash-contracts";
import { InputByteBudget } from "safe-bash-contracts/io";
import { createOutputOperation } from "safe-bash-contracts/output";
import { inheritYieldCheckpoint, yieldTurn } from "safe-bash-contracts/yield";
import {
  diagnostic,
  inputReader,
  output,
  renderGraph,
  settings,
  UsageError,
  type GraphvizCommandsOptions
} from "./index.js";
/** Shared Graphviz argument dialect; each entry point supplies its default engine. */
export function layoutCommand(name: string, options: GraphvizCommandsOptions): CommandDefinition {
  const limits = settings(options);
  return {
    name,
    description: "Render DOT graphs as SVG, raster images or layout data",
    runtimeIdentity: commandRuntimeIdentity,
    async execute(context) {
      return new InputByteBudget(limits.maxInputBytes, context.inputBudget).run(
        context,
        async (context) => {
          const operation = createOutputOperation(context, { write: async () => {} });
          inheritYieldCheckpoint(context.signal, operation.signal);
          context = {
            ...context,
            signal: operation.signal,
            stdout: operation.child(context.stdout).output
          };
          try {
            context.signal.throwIfAborted();
            const args = getCommandArguments(context).args;
            let format = "svg",
              layout = name,
              outfile = "-",
              end = false;
            const files: string[] = [];
            const attributes = {
              graph: Object.create(null) as Record<string, string>,
              node: Object.create(null) as Record<string, string>,
              edge: Object.create(null) as Record<string, string>
            };
            for (let i = 0; i < args.length; i++) {
              const arg = args[i]!;
              if (!end && arg === "--") {
                end = true;
                continue;
              }
              if (!end && (arg === "--help" || arg === "-?")) {
                await writeText(
                  context.stdout,
                  `Usage: ${name} [-Tsvg|pdf|png|jpg|jpeg|webp|json|dot|canon|plain] [-o FILE]\n       [-Gname=value] [-Nname=value] [-Ename=value] [-Kdot|neato] [FILE ...]\nReads stdin when FILE is omitted or -. -V prints version.\n`
                );
                return { exitCode: 0 };
              }
              if (!end && arg === "-V") {
                await writeText(context.stderr, `${name} (Safe Bash Graphviz) 0.0.1\n`);
                return { exitCode: 0 };
              }
              if (!end && arg.startsWith("-") && arg !== "-") {
                const flag = arg[1]!,
                  value = arg.slice(2) || args[++i];
                if (!value) throw new UsageError(`missing value for -${flag}`);
                if (flag === "T") format = value;
                else if (flag === "K") layout = value;
                else if (flag === "o") outfile = value;
                else if (flag === "G" || flag === "N" || flag === "E") {
                  const eq = value.indexOf("=");
                  if (eq < 1) throw new UsageError(`expected -${flag}name=value`);
                  attributes[flag === "G" ? "graph" : flag === "N" ? "node" : "edge"][
                    value.slice(0, eq)
                  ] = value.slice(eq + 1);
                } else throw new UsageError(`unknown option: ${arg}`);
              } else files.push(arg);
            }
            if (
              ![
                "svg",
                "pdf",
                "png",
                "jpg",
                "jpeg",
                "webp",
                "json",
                "dot",
                "canon",
                "plain"
              ].includes(format)
            )
              throw new UsageError(`unknown format: ${format}`);
            if (layout !== "dot" && layout !== "neato")
              throw new UsageError(`unsupported layout: ${layout} (choose dot or neato)`);
            const read = inputReader(context, limits),
              chunks: Uint8Array[] = [];
            let size = 0;
            for (const file of files.length ? files : ["-"]) {
              const source = await read(file);
              await yieldTurn(context.signal);
              const bytes = await renderGraph(
                source,
                format,
                layout,
                attributes,
                limits,
                context.signal
              );
              await yieldTurn(context.signal);
              size += bytes.length;
              if (size > limits.maxOutputBytes) throw new UsageError("output byte limit exceeded");
              chunks.push(bytes);
            }
            const bytes = new Uint8Array(size);
            let offset = 0;
            for (const chunk of chunks) {
              bytes.set(chunk, offset);
              offset += chunk.length;
            }
            await output(context, bytes, outfile, limits);
            return { exitCode: 0 };
          } catch (error) {
            return diagnostic(context, error);
          } finally {
            await operation.close();
          }
        }
      );
    }
  };
}
