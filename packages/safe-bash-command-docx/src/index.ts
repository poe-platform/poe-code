import { shellValueByteLength } from "safe-bash-contracts/value";
import {
  FsError,
  getCommandArguments,
  type ByteSink,
  type ByteSource,
  type CommandContext,
  type CommandDefinition,
  type FileSystem,
  type VirtualShellPlugin
} from "safe-bash-contracts";
import { validateExitCode } from "safe-bash-contracts/command";

/** Explicit invocation capabilities for an injected document operation engine. */
export interface DocxCommandRequest {
  readonly args: readonly Uint8Array[];
  readonly cwd: string;
  readonly filesystem: FileSystem;
  readonly stdin: ByteSource;
  readonly stdinIsDefault?: boolean;
  readonly stdout: ByteSink;
  readonly stderr: ByteSink;
  readonly signal: AbortSignal;
  readonly registerCleanup?: CommandContext["registerCleanup"];
}

export interface DocxCommandEngine {
  execute(request: DocxCommandRequest): Promise<{ readonly exitCode: number }>;
}

export interface DocxLimits {
  readonly maxArgumentBytes: number;
}

export interface DocxCommandOptions {
  readonly engine: DocxCommandEngine;
  readonly replace?: boolean;
  readonly limits?: Partial<DocxLimits>;
}

export type DocxCommandsOptions = DocxCommandOptions;

export function createDocxCommand(options: DocxCommandOptions): CommandDefinition {
  if (!options?.engine || typeof options.engine.execute !== "function")
    throw new TypeError("An explicit docx command engine is required.");
  if (options.replace !== undefined && typeof options.replace !== "boolean")
    throw new TypeError("docx replace must be boolean.");
  const maxArgumentBytes = options.limits?.maxArgumentBytes ?? Infinity;
  if (maxArgumentBytes !== Infinity && (!Number.isSafeInteger(maxArgumentBytes) || maxArgumentBytes < 0)) {
    throw new RangeError("maxArgumentBytes must be a nonnegative safe integer or Infinity");
  }
  const engine = options.engine;
  return {
    name: "docx",
    async execute(context) {
      context.signal.throwIfAborted();
      const arguments_ = getCommandArguments(context);
      let argumentBytes = 0;
      for (let index = 0; index < arguments_.args.length; index++) {
        const bytes = shellValueByteLength(arguments_.values[index]!);
        if (bytes > maxArgumentBytes - argumentBytes) throw new FsError("EFBIG", { message: "document argument limit exceeded" });
        argumentBytes += bytes;
      }
      const result = await engine.execute({
        args: Object.freeze(arguments_.args.map((_, index) => arguments_.bytes(index)!)),
        cwd: context.cwd,
        filesystem: context.fs,
        stdin: context.stdin,
        ...(context.stdinIsDefault === undefined ? {} : { stdinIsDefault: context.stdinIsDefault }),
        stdout: context.stdout,
        stderr: context.stderr,
        signal: context.signal,
        ...(context.registerCleanup === undefined ? {} : { registerCleanup: context.registerCleanup })
      });
      context.signal.throwIfAborted();
      return { exitCode: validateExitCode(result.exitCode) };
    }
  };
}

export function createDocxCommands(options: DocxCommandsOptions): readonly CommandDefinition[] {
  return [createDocxCommand(options)];
}

export function docxCommands(options: DocxCommandOptions): VirtualShellPlugin {
  const command = createDocxCommand(options);
  const replace = options.replace ?? false;
  return {
    name: "docx-commands",
    setup(host) {
      if (!replace && host.commands.has(command.name))
        throw new Error("Command already registered: docx");
      host.commands.register(command, { replace });
    }
  };
}
