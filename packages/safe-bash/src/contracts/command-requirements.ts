import type { CommandContext, CommandDefinition } from "./command.js";
import type { FileSystemCapabilities } from "./filesystem.js";
import { FsError } from "./errors.js";

export interface CommandFileSystemRequirement {
  readonly id: string;
  readonly description: string;
  readonly capabilities: readonly string[];
  readonly anyOf?: readonly (readonly string[])[];
  readonly mutates?: boolean;
}

export interface CommandModeSupport extends CommandFileSystemRequirement {
  readonly status: "supported" | "unsupported" | "unknown";
  readonly missing: readonly string[];
  readonly unknown: readonly string[];
}

export interface CommandSupport {
  readonly status: "supported" | "partial" | "unsupported";
  readonly declared: boolean;
  readonly modes: readonly CommandModeSupport[];
}

function evaluateMode(requirement: CommandFileSystemRequirement, capabilities: FileSystemCapabilities): CommandModeSupport {
  const missing = requirement.capabilities.filter(name => capabilities[name] === false);
  const unknown = requirement.capabilities.filter(name => capabilities[name] === undefined);
  if (requirement.mutates && capabilities.readOnly === true) missing.push("readOnly");
  const alternatives = requirement.anyOf;
  if (alternatives && !alternatives.some(group => group.every(name => capabilities[name] === true))) {
    if (alternatives.every(group => group.some(name => capabilities[name] === false))) {
      missing.push(...alternatives.flatMap(group => group.filter(name => capabilities[name] === false)));
    } else {
      unknown.push(...alternatives.filter(group => !group.some(name => capabilities[name] === false))
        .flatMap(group => group.filter(name => capabilities[name] === undefined)));
    }
  }
  return {
    ...requirement,
    status: missing.length ? "unsupported" : unknown.length ? "unknown" : "supported",
    missing: [...new Set(missing)], unknown: [...new Set(unknown)],
  };
}

export function evaluateCommandSupport(
  command: Pick<CommandDefinition, "filesystemRequirements"> | CommandDefinition,
  capabilities: FileSystemCapabilities,
): CommandSupport {
  const modes = (command.filesystemRequirements ?? []).map(requirement => evaluateMode(requirement, capabilities));
  return {
    declared: command.filesystemRequirements !== undefined,
    status: command.filesystemRequirements !== undefined && modes.every(mode => mode.status === "supported") ? "supported"
      : modes.length && modes.every(mode => mode.status === "unsupported") ? "unsupported" : "partial",
    modes,
  };
}

export function assertCommandRequirements(
  context: Pick<CommandContext, "fs" | "command" | "signal">,
  requirements: readonly CommandFileSystemRequirement[],
  selected: readonly string[],
  capabilities: FileSystemCapabilities = context.fs.capabilities,
): void {
  context.signal.throwIfAborted();
  for (const id of new Set(selected)) {
    const requirement = requirements.find(mode => mode.id === id);
    if (!requirement) throw new TypeError(`Unknown filesystem requirement mode: ${id}`);
    const support = evaluateMode(requirement, capabilities);
    if (support.status === "unsupported") {
      throw new FsError(support.missing.includes("readOnly") ? "EROFS" : "ENOTSUP", {
        syscall: context.command,
        message: `${requirement.description} requires unavailable filesystem capabilities: ${support.missing.join(", ")}`,
      });
    }
  }
}
