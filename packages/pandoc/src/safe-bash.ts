import { inspectFormats } from "./inspection.js";
import { PandocError } from "./errors.js";
import { convert } from "./engine.js";
import type { ConversionContext, ConversionOptions } from "./types.js";
import type { MetaValue } from "./ast-types.js";

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
  const options: { from?: string; to?: string; lossy?: boolean; standalone?: boolean; rawContent?: "reject" | "escape" | "retain" } = {};
  const metadata: Record<string, MetaValue> = Object.create(null) as Record<string, MetaValue>;
  const names = new Map([["-f", "from"], ["--from", "from"], ["-t", "to"], ["--to", "to"], ["--raw-content", "rawContent"]] as const);
  const fail = (): never => {throw new PandocError("E_OPTION", "convert", "Use -f FORMAT -t FORMAT [--lossy] [-s|--standalone] [-M KEY=VALUE] [--raw-content=reject|escape|retain] with byte stdin; files, templates, variables, styles and includes are unsupported");};
  for(let i = 0; i < args.length; i++) {
    const arg = args[i]!;
    if(arg === "--lossy") {if(options.lossy) fail(); options.lossy = true; continue;}
    if(arg === "--standalone" || arg === "-s") {if(options.standalone) fail(); options.standalone = true; continue;}
    if(arg === "--metadata" || arg.startsWith("--metadata=") || arg.startsWith("-M")) {
      const value = arg === "--metadata" || arg === "-M" ? args[++i] : arg.startsWith("--metadata=") ? arg.slice(11) : arg.slice(2);
      if(value === undefined) fail();
      const split = Math.min(...[value!.indexOf("="), value!.indexOf(":")].filter(n => n >= 0));
      if(!Number.isFinite(split) || split < 1) fail();
      const key = value!.slice(0, split);
      if(Object.hasOwn(metadata, key) || [...key].some(ch => !(ch >= "a" && ch <= "z") && !(ch >= "A" && ch <= "Z") && !(ch >= "0" && ch <= "9") && ch !== "-" && ch !== "_")) fail();
      metadata[key] = {t: "MetaString", c: value!.slice(split + 1)};
      continue;
    }
    const equals = arg.indexOf("=");
    const name = equals < 0 ? arg : arg.slice(0, equals);
    const key = names.get(name as "-f" | "--from" | "-t" | "--to" | "--raw-content");
    if(!key || options[key] !== undefined) return fail();
    const value = equals < 0 ? args[++i] : arg.slice(equals + 1);
    if(!value || value.startsWith("-")) return fail();
    if(key === "rawContent") {if(value !== "reject" && value !== "escape" && value !== "retain") fail(); options.rawContent = value as "reject" | "escape" | "retain";}
    else options[key] = value;
  }
  if(!options.from || !options.to) return fail();
  return {...options, from: options.from, to: options.to, ...(Object.keys(metadata).length ? {metadata} : {})};
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
