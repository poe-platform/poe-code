import type { CommandDefinition, VirtualShellPlugin } from "safe-bash-contracts";
import { command } from "safe-bash-checksum-engine";
import { sha512 } from "@noble/hashes/sha2.js";
import { bytesToHex } from "@noble/hashes/utils.js";

export interface Sha512sumLimits {
  readonly maxInputBytes: number;
  readonly maxArgumentBytes: number;
}

export interface Sha512sumCommandsOptions {
  readonly replace?: boolean | undefined;
  readonly maxInputBytes?: number | undefined;
  readonly limits?: Partial<Sha512sumLimits> | undefined;
}

export type Sha512sumOptions = Sha512sumCommandsOptions;

export function settings(options: Sha512sumCommandsOptions = {}): Sha512sumLimits {
  const limits: Sha512sumLimits = {
    maxInputBytes: options.limits?.maxInputBytes ?? options.maxInputBytes ?? Infinity,
    maxArgumentBytes: options.limits?.maxArgumentBytes ?? Infinity,
  };
  for (const [name, value] of Object.entries(limits)) {
    if (value !== Infinity && (!Number.isSafeInteger(value) || value < 1)) {
      throw new RangeError(`${name} must be a positive safe integer or Infinity`);
    }
  }
  return limits;
}

export function sha512Hex(data: Uint8Array): string {
  return bytesToHex(sha512(data));
}

export function createSha512sumCommand(options: Sha512sumCommandsOptions = {}): CommandDefinition {
  const limits = settings(options);
  return command("sha512sum", "sha512", limits.maxInputBytes, limits.maxArgumentBytes);
}

export function createSha512sumCommands(options: Sha512sumCommandsOptions = {}): readonly CommandDefinition[] {
  return Object.freeze([createSha512sumCommand(options)]);
}

export function sha512sumCommands(options: Sha512sumCommandsOptions = {}): VirtualShellPlugin {
  const commands = createSha512sumCommands(options);
  return {
    name: "sha512sum-commands",
    setup(host) {
      if (!options.replace) {
        for (const command of commands) {
          if (host.commands.has(command.name)) {
            throw new Error(`Command already registered: ${command.name}`);
          }
        }
      }
      for (const command of commands) {
        host.commands.register(command, { replace: options.replace ?? false });
      }
    },
  };
}
