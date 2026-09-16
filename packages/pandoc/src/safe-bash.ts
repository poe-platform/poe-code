import { inspectFormats } from "./inspection.js";
import { PandocError } from "./errors.js";
import { convert } from "./engine.js";
import type { ConversionContext, ConversionOptions } from "./types.js";

/** Structural subset of safe-bash CommandContext: no filesystem or ambient host access. */
export interface FormatInspectionContext {
  readonly args: readonly string[];
  readonly signal: AbortSignal;
  readonly stdout: { write(bytes: Uint8Array): Promise<void> };
  readonly stderr: { write(bytes: Uint8Array): Promise<void> };
}

export interface PandocCommandContext extends FormatInspectionContext {
  readonly stdin: AsyncIterable<Uint8Array>;
}

function conversionArgs(args: readonly string[]): ConversionOptions {
  const options: { from?: string; to?: string; lossy?: boolean } = {};
  const names = new Map([["-f", "from"], ["--from", "from"], ["-t", "to"], ["--to", "to"]] as const);
  const fail = (): never => {throw new PandocError("E_OPTION", "convert", "Use -f FORMAT -t FORMAT [--lossy] with byte stdin; file arguments are unsupported");};
  for(let i = 0; i < args.length; i++) {
    const arg = args[i]!;
    if(arg === "--lossy") {if(options.lossy) fail(); options.lossy = true; continue;}
    const equals = arg.indexOf("=");
    const name = equals < 0 ? arg : arg.slice(0, equals);
    const key = names.get(name as "-f" | "--from" | "-t" | "--to");
    if(!key || options[key] !== undefined) return fail();
    const value = equals < 0 ? args[++i] : arg.slice(equals + 1);
    if(!value || value.startsWith("-")) return fail();
    options[key] = value;
  }
  if(!options.from || !options.to) return fail();
  return {from: options.from, to: options.to, ...(options.lossy ? {lossy: true} : {})};
}

/** Opt-in byte-only conversion adapter. All conversion and limits belong to the SDK.
 * Hosts register this command explicitly; it never opens files or invokes native tools. */
export function createPandocCommand(capabilities: Omit<ConversionContext, "output" | "signal"> = {}) {
  return {
    name: "pandoc",
    description: "Convert byte stdin with explicit formats or list format capabilities",
    async execute(context: PandocCommandContext): Promise<{exitCode: number}> {
      context.signal.throwIfAborted();
      const encoder = new TextEncoder();
      let bytes: Uint8Array;
      try {
        if(context.args.some(arg => arg.startsWith("--list-"))) bytes = encoder.encode(inspectFormats(context.args, capabilities));
        else {
          const options = conversionArgs(context.args);
          const result = await convert([{chunks: context.stdin}], options, {...capabilities, signal: context.signal});
          for(const diagnostic of result.diagnostics) {
            await context.stderr.write(encoder.encode(`${diagnostic.code}: ${diagnostic.location ? `${diagnostic.location}: ` : ""}${diagnostic.message}\n`));
            context.signal.throwIfAborted();
          }
          bytes = result.kind === "text" ? encoder.encode(result.text) : result.bytes;
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
