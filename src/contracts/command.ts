import type { FileSystem } from "./filesystem.js";
import type { ByteSink, ByteSource } from "./io.js";

export interface CommandContext {
  readonly command: string;
  readonly args: readonly string[];
  readonly stdin: ByteSource;
  readonly stdout: ByteSink;
  readonly stderr: ByteSink;
  cwd: string;
  env: Record<string, string>;
  readonly fs: FileSystem;
  readonly signal: AbortSignal;
}

export interface CommandResult {
  readonly exitCode: number;
}

export type CommandHandler = (
  context: CommandContext,
) => CommandResult | Promise<CommandResult>;

export type AsyncCommandHandler = (context: CommandContext) => Promise<CommandResult>;

export interface CommandDefinition {
  readonly name: string;
  readonly description?: string;
  readonly execute: CommandHandler;
}

export interface RegisterCommandOptions {
  readonly replace?: boolean;
}

export class CommandRegistry {
  readonly #commands = new Map<string, CommandDefinition>();

  constructor(commands: Iterable<CommandDefinition> = []) {
    for (const command of commands) this.register(command);
  }

  register(command: CommandDefinition, options: RegisterCommandOptions = {}): this {
    if (!command.name || /[\s/\0]/u.test(command.name)) {
      throw new TypeError("Command names must be nonempty and contain no whitespace, slash, or NUL");
    }
    if (typeof command.execute !== "function") {
      throw new TypeError("Command execute must be a function");
    }
    if (this.#commands.has(command.name) && !options.replace) {
      throw new Error(`Command already registered: ${command.name}`);
    }
    this.#commands.set(command.name, Object.freeze({ ...command }));
    return this;
  }

  get(name: string): CommandDefinition | undefined {
    return this.#commands.get(name);
  }

  has(name: string): boolean {
    return this.#commands.has(name);
  }

  unregister(name: string): boolean {
    return this.#commands.delete(name);
  }

  list(): readonly CommandDefinition[] {
    return Array.from(this.#commands.values());
  }
}

export function validateExitCode(exitCode: number): number {
  if (!Number.isInteger(exitCode) || exitCode < 0 || exitCode > 255) {
    throw new RangeError("Exit status must be an integer between 0 and 255");
  }
  return exitCode;
}
