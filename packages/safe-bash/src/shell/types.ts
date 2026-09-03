import type { ByteSink, ByteSource, CommandContext, CommandRegistry, CommandResult, FileSystem } from "../contracts/index.js";
import type { CommandArguments } from "../contracts/command.js";

export interface ShellInvokeOptions {
  readonly argumentValues?: CommandArguments;
  readonly signal?: AbortSignal | undefined;
  readonly stdin?: ByteSource;
  readonly stdinIsDefault?: boolean;
  readonly stdout?: ByteSink;
  readonly stderr?: ByteSink;
  readonly cwd?: string;
  readonly env?: Readonly<Record<string, string>>;
  readonly replaceEnv?: boolean;
}

export interface ShellCommandContext extends CommandContext {
  readonly invoke: (command: string, args: readonly string[], options?: ShellInvokeOptions) => Promise<CommandResult>;
}

export interface ShellLimits {
  readonly maxInputBytes?: number;
  readonly maxOutputBytes?: number;
  readonly maxCommands?: number;
  readonly maxLoopIterations?: number;
  readonly maxSubstitutionDepth?: number;
  readonly maxSourceBytes?: number;
  readonly maxExpansionFields?: number;
  readonly maxExpansionBytes?: number;
  readonly maxWallClockMs?: number;
  readonly maxCpuMs?: number;
  readonly pipeHighWaterMark?: number;
}

export interface ShellOptions {
  readonly fs: FileSystem;
  readonly commands?: CommandRegistry;
  readonly cwd?: string;
  readonly env?: Readonly<Record<string, string>>;
  readonly limits?: ShellLimits;
}

export interface ShellExecOptions {
  readonly fs?: FileSystem;
  readonly cwd?: string;
  readonly env?: Readonly<Record<string, string>>;
  readonly stdin?: string | Uint8Array | ByteSource;
  readonly stdout?: ByteSink;
  readonly stderr?: ByteSink;
  readonly signal?: AbortSignal;
  readonly limits?: ShellLimits;
}

export interface ShellResult {
  readonly stdout: string;
  readonly stderr: string;
  readonly stdoutBytes: Uint8Array;
  readonly stderrBytes: Uint8Array;
  readonly exitCode: number;
}

export class ShellSyntaxError extends SyntaxError {
  constructor(readonly reason: string, readonly offset: number, readonly exitCode = 2, readonly incompleteCommand?: { name: string; line: number }, readonly unclosedQuote?: { quote: string; line: number }) {
    super(`${reason} at offset ${offset}`);
    this.name = "ShellSyntaxError";
  }
}

export class ShellLimitError extends Error {
  constructor(readonly limit: keyof ShellLimits) {
    super(`Shell limit exceeded: ${limit}`);
    this.name = "ShellLimitError";
  }
}
