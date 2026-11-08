import { evalSyncRg } from "./sync.js";
import type { CommandDefinition } from "safe-bash-contracts";
import { RegexExecutor } from "safe-bash-regex-engine/execution/portable";
import { createBoundedRegexProvider } from "safe-bash-regex-engine/execution/bounded-provider";
import { createRgCommand as createRgWithExecutor } from "./rg-command.js";
import type { SearchOptions } from "./options.js";

export function createRgCommand(options: SearchOptions = {}): CommandDefinition {
  const provider = options.regexExecutor === undefined ? createBoundedRegexProvider() : options.regexExecutor;
  return createRgWithExecutor(new RegexExecutor(provider, options.regex), options);
}

import type { VirtualShellPlugin } from "safe-bash-contracts";
export type { SearchOptions as RgCommandsOptions } from "./options.js";
export interface RgLimits { readonly maxOutputBytes: number; readonly maxLineBytes: number; readonly maxFileBytes: number; readonly maxFiles: number; readonly maxPatternBytes: number; }
export function createRgCommands(options: SearchOptions = {}): readonly CommandDefinition[] { return [createRgCommand(options)]; }
export function rgCommands(options: SearchOptions = {}): VirtualShellPlugin { const commands = createRgCommands(options); return { name: "rg-commands", setup(host) { if (!options.replace) for (const command of commands) if (host.commands.has(command.name)) throw new Error(`Command already registered: ${command.name}`); for (const command of commands) host.commands.register(command, {replace: options.replace ?? false}); } }; }

export { createRgCommand as rgCommand };

export * from "./sync.js";

import { syncCommandEvaluators } from "safe-bash-contracts/runtime-control";
syncCommandEvaluators.evalSyncRg = evalSyncRg;
