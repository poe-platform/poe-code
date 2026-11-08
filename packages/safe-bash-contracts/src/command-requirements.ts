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

function isModeUnsupported(requirement: CommandFileSystemRequirement, capabilities: FileSystemCapabilities): boolean {
  if (requirement.mutates && capabilities.readOnly === true) return true;
  for (let i = 0; i < requirement.capabilities.length; i++) {
    if (capabilities[requirement.capabilities[i]!] === false) return true;
  }
  const alternatives = requirement.anyOf;
  if (alternatives) {
    let anyGroupPossible = false;
    for (let g = 0; g < alternatives.length; g++) {
      const group = alternatives[g]!;
      let groupFailed = false;
      for (let i = 0; i < group.length; i++) {
        if (capabilities[group[i]!] === false) {
          groupFailed = true;
          break;
        }
      }
      if (!groupFailed) {
        anyGroupPossible = true;
        break;
      }
    }
    if (!anyGroupPossible) return true;
  }
  return false;
}

export function assertCommandRequirements(
  context: Pick<CommandContext, "fs" | "command" | "signal">,
  requirements: readonly CommandFileSystemRequirement[],
  selected: readonly string[],
  capabilities?: FileSystemCapabilities,
): void {
  context.signal.throwIfAborted();
  let resolvedCapabilities = capabilities;
  for (let i = 0; i < selected.length; i++) {
    const id = selected[i]!;
    let requirement: CommandFileSystemRequirement | undefined;
    for (let r = 0; r < requirements.length; r++) {
      if (requirements[r]!.id === id) {
        requirement = requirements[r]!;
        break;
      }
    }
    if (!requirement) throw new TypeError(`Unknown filesystem requirement mode: ${id}`);
    if (!requirement.mutates && requirement.capabilities.length === 0 && (!requirement.anyOf || requirement.anyOf.length === 0)) {
      continue;
    }
    resolvedCapabilities ??= context.fs.capabilities;
    if (isModeUnsupported(requirement, resolvedCapabilities)) {
      const support = evaluateMode(requirement, resolvedCapabilities);
      throw new FsError(support.missing.includes("readOnly") ? "EROFS" : "ENOTSUP", {
        syscall: context.command,
        message: `${requirement.description} requires unavailable filesystem capabilities: ${support.missing.join(", ")}`,
      });
    }
  }
}
