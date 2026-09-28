import type { CommandDefinition, VirtualShellPlugin } from "safe-bash-contracts";
import { createGrepCommands } from "safe-bash-command-grep/index";
import { alias } from "safe-bash-io-engine/commands/grep-aliases/aliases";
import type { GrepAliasOptions } from "safe-bash-search-engine/alias-options";
export type EgrepCommandsOptions = GrepAliasOptions;
export interface EgrepLimits { readonly maxPatternBytes: number; }
export function createEgrepCommand(options: EgrepCommandsOptions = {}): CommandDefinition { return alias("egrep", createGrepCommands({ ...options.regex, ...(options.regexExecutor === undefined ? {} : { regexExecutor: options.regexExecutor }) })[0]!); }
export function createEgrepCommands(options: EgrepCommandsOptions = {}): readonly CommandDefinition[] { return [createEgrepCommand(options)]; }
export function egrepCommands(options: EgrepCommandsOptions = {}): VirtualShellPlugin { const commands = createEgrepCommands(options); return { name: "egrep-commands", setup(host) { if (!options.replace) for (const command of commands) if (host.commands.has(command.name)) throw new Error(`Command already registered: ${command.name}`); for (const command of commands) host.commands.register(command, {replace: options.replace ?? false}); } }; }
