import type { FileSystem } from "./filesystem.js";
import type { CommandFileSystemRequirement } from "./command-requirements.js";
import type { ByteSink, ByteSource } from "./io.js";
import { concatShellValues, shellValueBytes, shellValueFromBytes, shellValueText, type ShellValue, type ValueAllocation, type ValueReservation } from "./value.js";

export interface CommandArguments {
  readonly args: readonly string[];
  readonly values: readonly ShellValue[];
  bytes(index: number): Uint8Array | undefined;
  slice(start?: number, end?: number): CommandArguments;
  select(indices: readonly number[]): CommandArguments;
  concat(...others: readonly CommandArguments[]): CommandArguments;
  withValues(values: readonly (ShellValue | Uint8Array)[]): CommandArguments;
  join(separator?: ShellValue): ShellValue;
}

const argumentCarriers = new WeakSet<CommandArguments>();

function argumentAllocation(allocation?: ValueAllocation) {
  const reservations: ValueReservation[] = [];
  const tracked: ValueAllocation | undefined = allocation && {
    assertOpen() { allocation.assertOpen(); },
    reserve(bytes, slots) {
      const reservation = allocation.reserve(bytes, slots);
      let released = false;
      const owned: ValueReservation = {
        commit(value) { reservation.commit(value); },
        release() {
          if (released) return;
          released = true;
          reservation.release();
        },
      };
      reservations.push(owned);
      return owned;
    },
  };
  return {
    allocation: tracked,
    rollback(error: unknown): never {
      const failures: unknown[] = [error];
      for (let index = reservations.length - 1; index >= 0; index--) {
        try { reservations[index]!.release(); }
        catch (cleanup) { failures.push(cleanup); }
      }
      if (failures.length > 1) throw new AggregateError(failures, "Command argument allocation and release failed");
      throw error;
    },
  };
}

function ownedCommandArguments(
  size: number | (() => number), valueAt: (index: number) => ShellValue | Uint8Array, allocation?: ValueAllocation,
  extent?: () => number,
): CommandArguments {
  allocation?.assertOpen();
  const length = typeof size === "number" ? size : size();
  const bytes = 128 + length * 40;
  const slots = length * 4 + 1;
  if (!Number.isSafeInteger(length) || length < 0 || !Number.isSafeInteger(bytes) || !Number.isSafeInteger(slots)) {
    throw new RangeError("Command argument allocation is too large");
  }
  const transaction = argumentAllocation(allocation);
  const reservation = transaction.allocation?.reserve(bytes, slots);
  try {
    if (extent && extent() !== length) throw new TypeError("Command argument extent changed during admission");
    const snapshot: (ShellValue | Uint8Array)[] = [];
    for (let index = 0; index < length; index++) snapshot.push(valueAt(index));
    if (extent && extent() !== length) throw new TypeError("Command argument extent changed during admission");
    const values: ShellValue[] = [];
    const args: string[] = [];
    for (const incoming of snapshot) {
      const value = incoming instanceof Uint8Array ? shellValueFromBytes(incoming, transaction.allocation) : incoming;
      args.push(shellValueText(value));
      values.push(value);
    }
    Object.freeze(values);
    Object.freeze(args);
    const carrier: CommandArguments = Object.freeze({
      args, values,
      bytes(index: number) {
        return Number.isInteger(index) && index >= 0 && index < length ? shellValueBytes(values[index]!, allocation) : undefined;
      },
      slice(start = 0, end = length) {
        const offset = (index: number): number => {
          const integral = Math.trunc(index) || 0;
          return integral < 0 ? Math.max(0, length + integral) : Math.min(length, integral);
        };
        const first = offset(start);
        return ownedCommandArguments(Math.max(0, offset(end) - first), index => values[first + index]!, allocation);
      },
      select(indices: readonly number[]) {
        return ownedCommandArguments(() => {
          if (!Array.isArray(indices)) throw new TypeError("Command argument selection must be an array");
          return indices.length;
        }, index => {
          const selected = indices[index]!;
          if (!Number.isInteger(selected) || selected < 0 || selected >= length) throw new RangeError("Command argument index is out of range");
          return values[selected]!;
        }, allocation, () => indices.length);
      },
      concat(...others: readonly CommandArguments[]) {
        let total = length;
        for (const other of others) {
          if (!argumentCarriers.has(other)) throw new TypeError("Expected owned command arguments");
          total += other.values.length;
        }
        return ownedCommandArguments(total, index => {
          if (index < length) return values[index]!;
          let offset = index - length;
          for (const other of others) {
            if (offset < other.values.length) return other.values[offset]!;
            offset -= other.values.length;
          }
          throw new RangeError("Command argument index is out of range");
        }, allocation);
      },
      withValues(incoming: readonly (ShellValue | Uint8Array)[]) {
        return ownedCommandArguments(() => {
          if (!Array.isArray(incoming)) throw new TypeError("Command arguments must be an array");
          return incoming.length;
        }, index => incoming[index]!, allocation, () => incoming.length);
      },
      join(separator: ShellValue = "") {
        allocation?.assertOpen();
        const count = Math.max(0, length * 2 - 1);
        const bytes = 128 + count * 16;
        if (!Number.isSafeInteger(bytes) || !Number.isSafeInteger(count + 1)) throw new RangeError("Command argument join allocation is too large");
        const transaction = argumentAllocation(allocation);
        const scratch = transaction.allocation?.reserve(bytes, count + 1);
        try {
          const parts: ShellValue[] = [];
          for (let index = 0; index < length; index++) {
            if (index) parts.push(separator);
            parts.push(values[index]!);
          }
          Object.freeze(parts);
          scratch?.commit(parts);
          const result = concatShellValues(parts, transaction.allocation);
          scratch?.release();
          return result;
        } catch (error) {
          return transaction.rollback(error);
        }
      },
    });
    reservation?.commit(carrier);
    argumentCarriers.add(carrier);
    return carrier;
  } catch (error) {
    return transaction.rollback(error);
  }
}

export function createCommandArguments(values: readonly ShellValue[], allocation?: ValueAllocation): CommandArguments {
  return ownedCommandArguments(() => {
    if (!Array.isArray(values)) throw new TypeError("Command arguments must be an array");
    return values.length;
  }, index => values[index]!, allocation, () => values.length);
}

export function getCommandArguments(context: Pick<CommandContext, "args" | "argumentValues">): CommandArguments {
  const carrier = context.argumentValues;
  if (carrier === undefined) return createCommandArguments(context.args);
  if (!argumentCarriers.has(carrier)) throw new TypeError("Expected owned command arguments");
  if (carrier.args !== context.args) throw new TypeError("Command argument identity does not match its carrier");
  return carrier;
}

export interface CommandInvokeOptions {
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

export type CommandInvoker = (
  command: string,
  args: readonly string[],
  options?: CommandInvokeOptions,
) => Promise<CommandResult>;

export type InvocationCleanup = () => void | Promise<void>;

export interface CommandContext {
  readonly command: string;
  readonly args: readonly string[];
  readonly argumentValues?: CommandArguments;
  readonly stdin: ByteSource;
  readonly stdinIsDefault?: boolean;
  readonly stdout: ByteSink;
  readonly stderr: ByteSink;
  cwd: string;
  env: Record<string, string>;
  readonly fs: FileSystem;
  readonly signal: AbortSignal;
  readonly invoke?: CommandInvoker;
  readonly registerCleanup?: (cleanup: InvocationCleanup) => void;
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
  readonly filesystemRequirements?: readonly CommandFileSystemRequirement[];
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
    const { name, execute } = command;
    if (typeof name !== "string" || !name || /[\s/\0]/u.test(name)) {
      throw new TypeError("Command names must be nonempty and contain no whitespace, slash, or NUL");
    }
    if (typeof execute !== "function") {
      throw new TypeError("Command execute must be a function");
    }
    if (this.#commands.has(name) && !options.replace) {
      throw new Error(`Command already registered: ${name}`);
    }
    this.#commands.set(name, Object.freeze({ ...command, name, execute }));
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
