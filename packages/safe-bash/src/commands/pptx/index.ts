import { collectBytes, FsError, getCommandArguments, writeBytes, type CommandDefinition, type VirtualShellPlugin } from "../../contracts/index.js";
import { pathOf } from "../internal.js";

export interface PptxCommandEngine {
  execute(request: {
    readonly args: readonly Uint8Array[];
    readonly signal: AbortSignal;
    readonly readInput: (path: string, maxBytes: number) => Promise<Uint8Array>;
  }): Promise<{
    readonly exitCode: number;
    readonly stdout: Uint8Array;
    readonly stderr: Uint8Array;
  }>;
}

export interface PptxCommandsOptions {
  readonly engine: PptxCommandEngine;
  readonly replace?: boolean;
}

export function createPptxCommands(options: PptxCommandsOptions): readonly CommandDefinition[] {
  if (!options?.engine || typeof options.engine.execute !== "function") throw new TypeError("An explicit pptx command engine is required.");
  const engine = options.engine;
  return [{ name: "pptx", async execute(context) {
    const arguments_ = getCommandArguments(context);
    const result = await engine.execute({
      args: arguments_.args.map((_, index) => arguments_.bytes(index)!),
      signal: context.signal,
      async readInput(path, maxBytes) {
        try {
          context.signal.throwIfAborted();
          return path === "-"
            ? await collectBytes(context.stdin, { maxBytes, signal: context.signal })
            : await context.fs.readFile(pathOf(context, path), { maxBytes, signal: context.signal });
        } catch (error) {
          context.signal.throwIfAborted();
          throw Object.assign(new Error("Input could not be read."), { code: error instanceof FsError && error.code === "EFBIG" ? "resource-limit" : "io-failure" });
        }
      }
    });
    if (result.stdout.length) await writeBytes(context.stdout, result.stdout, context.signal);
    if (result.stderr.length) await writeBytes(context.stderr, result.stderr, context.signal);
    return { exitCode: result.exitCode };
  } }];
}

export function pptxCommands(options: PptxCommandsOptions): VirtualShellPlugin {
  const commands = createPptxCommands(options);
  const replace = options.replace ?? false;
  return { name: "pptx-commands", setup(host) {
    for (const command of commands) host.commands.register(command, { replace });
  } };
}
