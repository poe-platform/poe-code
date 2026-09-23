import type { ByteSink, ByteSource, CommandContext, CommandRegistry, CommandResult, FileSystem } from "../contracts/index.js";
import type { ShellExtension } from "./extensions.js";
import type { InternalErrorHandler, CommandArguments, InvocationCapabilities } from "../contracts/command.js";
import type { BoundedRegexProvider } from "../commands/regex-execution/provider.js";
import type { RegexExecutionOptions } from "../commands/regex-execution/protocol.js";
import type { PredicateIdentity } from "../commands/file-predicates.js";

export interface ShellCapabilities extends InvocationCapabilities {
  /** Explicit caller identity for conditional ownership predicates; never inferred from the host. */
  readonly predicateIdentity?: PredicateIdentity | undefined;
  readonly regex?: {
    readonly executor: BoundedRegexProvider;
    readonly limits: Readonly<RegexExecutionOptions>;
  } | undefined;
}

export interface ShellInvokeOptions {
  /** Zeroth argument identity; command remains the name used for lookup. */
  readonly argv0?: string | undefined;
  readonly admittedHandles?: CommandContext["admittedHandles"];
  readonly processSignals?: CommandContext["processSignals"];
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

/** Resource quotas are unlimited when omitted; each supplied quota is independent. */
export interface ShellLimits {
  readonly maxParseUnits?: number;
  readonly maxInputBytes?: number;
  readonly maxOutputBytes?: number;
  readonly maxCommands?: number;
  readonly maxFileSystemOperations?: number;
  readonly maxPathComponents?: number;
  /** Maximum redirects per executed command, including implicit |&; unlimited when omitted.
   * Zero permits only redirect-free commands. Not a global byte or filesystem-call budget. */
  readonly maxRedirects?: number;
  readonly maxPipelineStages?: number;
  readonly maxLoopIterations?: number;
  readonly maxSubstitutionDepth?: number;
  readonly maxSourceBytes?: number;
  readonly maxExpansionFields?: number;
  readonly maxExpansionBytes?: number;
  readonly maxWallClockMs?: number;
  readonly maxCpuMs?: number;
  readonly pipeHighWaterMark?: number;
}

export interface ShellParseOptions {
  readonly maxParseUnits?: number;
}

export interface ShellOptions {
  readonly capabilities?: ShellCapabilities;
  readonly onInternalError?: InternalErrorHandler;
  readonly fs: FileSystem;
  /** Default adds a synthetic null device; provided uses the supplied filesystem's device paths. */
  readonly deviceView?: "default" | "provided";
  readonly commands?: CommandRegistry;
  readonly cwd?: string;
  readonly env?: Readonly<Record<string, string>>;
  readonly limits?: ShellLimits;
  readonly extensions?: readonly ShellExtension[];
}

export interface ShellExecOptions {
  readonly capabilities?: ShellCapabilities;
  readonly admittedHandles?: CommandContext["admittedHandles"];
  readonly processSignals?: CommandContext["processSignals"];
  readonly onInternalError?: InternalErrorHandler;
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
