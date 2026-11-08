import {
  FsError,
  readBytes,
  writeBytes,
  writeText,
  type CommandContext,
  type CommandDefinition,
  type VirtualShellPlugin
} from "safe-bash-contracts";
import { writeFileOutput } from "safe-bash-contracts/filesystem-output-budget";
export { renderGraph } from "./render.js";
export interface GraphvizLimits {
  readonly maxInputBytes: number;
  readonly maxOutputBytes: number;
  readonly maxNodes: number;
  readonly maxEdges: number;
  readonly maxPixels: number;
  readonly maxLayoutCost: number;
}
export interface GraphvizCommandsOptions {
  readonly replace?: boolean;
  readonly limits?: Partial<GraphvizLimits>;
}
export class UsageError extends Error {}
export function settings(options: GraphvizCommandsOptions): GraphvizLimits {
  const limits = {
    maxInputBytes: 1048576,
    maxOutputBytes: 16777216,
    maxNodes: 256,
    maxEdges: 2048,
    maxPixels: 16000000,
    maxLayoutCost: 100000000,
    ...options.limits
  };
  for (const [key, value] of Object.entries(limits))
    if (!Number.isSafeInteger(value) || value < 0) throw new RangeError(`Invalid ${key}`);
  return Object.freeze(limits);
}
function resolve(cwd: string, name: string): string {
  const parts: string[] = [];
  for (const part of (name.startsWith("/") ? name : cwd + "/" + name).split("/")) {
    if (part === "..") parts.pop();
    else if (part && part !== ".") parts.push(part);
  }
  return "/" + parts.join("/");
}
export function inputReader(
  context: CommandContext,
  limits: GraphvizLimits
): (name?: string, literal?: string) => Promise<string> {
  let total = 0;
  return async (name = "-", literal) => {
    const chunks: Uint8Array[] = [];
    let size = 0;
    const source =
      literal !== undefined
        ? [new TextEncoder().encode(literal)]
        : name === "-"
          ? readBytes(context.stdin, context.signal)
          : [
              await context.fs.readFile(resolve(context.cwd, name), {
                signal: context.signal,
                maxBytes: limits.maxInputBytes - total
              })
            ];
    for await (const bytes of source) {
      context.signal.throwIfAborted();
      total += bytes.length;
      context.inputBudget?.check(total);
      if (total > limits.maxInputBytes) throw new UsageError("input byte limit exceeded");
      chunks.push(bytes.slice());
      size += bytes.length;
    }
    const bytes = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) {
      bytes.set(chunk, offset);
      offset += chunk.length;
    }
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  };
}
export async function output(
  context: CommandContext,
  bytes: Uint8Array,
  path: string,
  limits: GraphvizLimits
): Promise<void> {
  context.signal.throwIfAborted();
  if (bytes.length > limits.maxOutputBytes) throw new UsageError("output byte limit exceeded");
  if (path === "-") await writeBytes(context.stdout, bytes, context.signal);
  else
    await writeFileOutput(context, bytes, (data) =>
      context.fs.writeFile(resolve(context.cwd, path), data, { signal: context.signal })
    );
}
export async function diagnostic(
  context: CommandContext,
  error: unknown
): Promise<{ exitCode: number }> {
  context.signal.throwIfAborted();
  if (
    !(
      error instanceof UsageError ||
      error instanceof SyntaxError ||
      error instanceof RangeError ||
      error instanceof FsError
    )
  )
    throw error;
  await writeText(context.stderr, `${context.command}: ${error.message}\n`);
  return { exitCode: 1 };
}
export function plugin(
  name: string,
  commands: readonly CommandDefinition[],
  replace = false
): VirtualShellPlugin {
  return {
    name,
    setup(host) {
      if (!replace)
        for (const command of commands)
          if (host.commands.has(command.name))
            throw new Error(`Command already registered: ${command.name}`);
      for (const command of commands) host.commands.register(command, { replace });
    }
  };
}
export { layoutCommand } from "./command.js";
export {
  parseDot,
  serializeDot,
  layoutGraph,
  renderSvg,
  optimizeSvg
} from "@poe-code/graphviz-ast";
