import { inspectFormats } from "./inspection.js";
import { PandocError } from "./errors.js";
import { convert } from "./engine.js";
import type { ConversionContext, ResourceFileSystem } from "./types.js";
import { parseConversionArgs } from "./cli.js";
import type { CommandInputs } from "./cli.js";

/** Structural subset of safe-bash CommandContext: no filesystem or ambient host access. */
export interface FormatInspectionContext {
  readonly args: readonly string[];
  readonly signal: AbortSignal;
  readonly stdout: { write(bytes: Uint8Array): Promise<void> };
  readonly stderr: { write(bytes: Uint8Array): Promise<void> };
}

export interface PandocCommandContext extends FormatInspectionContext, CommandInputs {
  readonly fs?: ResourceFileSystem & {readFile(path: string, options?: {signal?: AbortSignal}): Promise<Uint8Array>};
  readonly stdin: AsyncIterable<Uint8Array> | Iterable<Uint8Array>;
}

/** Opt-in conversion adapter. File access requires explicit injected callbacks;
 * all conversion and limits belong to the SDK. It never invokes native tools. */
export function createPandocCommand(capabilities: Omit<ConversionContext, "output" | "signal" | "resources" | "resourceFiles" | "resourceCwd"> = {}) {
  const configured: typeof capabilities = Object.fromEntries(Object.keys(capabilities)
    .filter(key => ["reader", "writer", "limits", "yield"].includes(key))
    .map(key => [key, capabilities[key as keyof typeof capabilities]]));
  return {
    name: "pandoc",
    description: "Convert explicit inputs and formats or list format capabilities",
    async execute(context: PandocCommandContext): Promise<{exitCode: number}> {
      context.signal.throwIfAborted();
      const encoder = new TextEncoder();
      let bytes: Uint8Array;
      try {
        if(context.args.some(arg => arg.startsWith("--list-"))) bytes = encoder.encode(inspectFormats(context.args, configured));
        else {
          const files: CommandInputs = context.fs ? {
            ...(context.cwd === undefined ? {} : {cwd: context.cwd}), stdin: context.stdin,
            readFile: (path, signal) => context.fs!.readFile(path.startsWith("/") ? path : `${context.cwd ?? "/"}/${path}`, {signal}),
            writeFile: (path, bytes, signal) => context.fs!.writeFile(path.startsWith("/") ? path : `${context.cwd ?? "/"}/${path}`, bytes, {signal})
          } : context;
          const {options, operands, destination} = parseConversionArgs(context.args, files, context.signal);
          const result = await convert(operands ?? [{chunks: context.stdin}], options, {...configured, signal: context.signal,
            ...(context.fs === undefined ? {} : {resourceFiles: context.fs}),
            ...(context.cwd === undefined ? {} : {resourceCwd: context.cwd}),
            ...(destination === undefined ? {} : {output: {publish: async (bytes: Uint8Array, signal: AbortSignal | undefined) => files.writeFile!(destination, bytes, signal!)}})});
          for(const diagnostic of result.diagnostics) {
            await context.stderr.write(encoder.encode(`${diagnostic.code}: ${diagnostic.location ? `${diagnostic.location}: ` : ""}${diagnostic.message}\n`));
            context.signal.throwIfAborted();
          }
          bytes = result.kind === "text" ? encoder.encode(result.text) : result.bytes;
          if (destination !== undefined) return {exitCode: 0};
        }
      } catch(error) {
        context.signal.throwIfAborted();
        if(!(error instanceof PandocError)) throw error;
        // AST messages already include their path; capability messages do not.
        const location = error.location && !error.message.startsWith(`${error.location}:`) ? `${error.location}: ` : "";
        await context.stderr.write(encoder.encode(`${error.code}: ${location}${error.message}\n`));
        context.signal.throwIfAborted();
        return {exitCode: 2};
      }
      await context.stdout.write(bytes);
      context.signal.throwIfAborted();
      return {exitCode: 0};
    }
  };
}
/** Opt-in safe-bash command for registry inspection; conversion command wiring is separate. */
export function createFormatInspectionCommand(capabilities: ConversionContext = {}) {
  return {
    name: "pandoc",
    description: "List available document formats and dialect extensions",
    async execute(context: FormatInspectionContext): Promise<{ exitCode: number }> {
      context.signal.throwIfAborted();
      let text: string;
      try {
        text = inspectFormats(context.args, capabilities);
      } catch (error) {
        if (!(error instanceof PandocError)) throw error;
        await context.stderr.write(new TextEncoder().encode(`${error.code}: ${error.message}\n`));
        context.signal.throwIfAborted();
        return { exitCode: 2 };
      }
      await context.stdout.write(new TextEncoder().encode(text));
      context.signal.throwIfAborted();
      return { exitCode: 0 };
    }
  };
}
