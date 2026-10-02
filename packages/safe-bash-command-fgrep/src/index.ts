import type { CommandDefinition, VirtualShellPlugin } from "safe-bash-contracts";
import { createGrepCommands } from "safe-bash-command-grep/index";
import { alias } from "safe-bash-command-grep/aliases";
import type { GrepAliasOptions } from "safe-bash-command-grep/alias-options";
export type FgrepCommandsOptions = GrepAliasOptions;
export interface FgrepLimits { readonly maxPatternBytes: number; }
export function createFgrepCommand(options: FgrepCommandsOptions = {}): CommandDefinition { return alias("fgrep", createGrepCommands({ ...options.regex, ...(options.regexExecutor === undefined ? {} : { regexExecutor: options.regexExecutor }) })[0]!); }
export function createFgrepCommands(options: FgrepCommandsOptions = {}): readonly CommandDefinition[] { return [createFgrepCommand(options)]; }
export function fgrepCommands(options: FgrepCommandsOptions = {}): VirtualShellPlugin { const commands = createFgrepCommands(options); return { name: "fgrep-commands", setup(host) { if (!options.replace) for (const command of commands) if (host.commands.has(command.name)) throw new Error(`Command already registered: ${command.name}`); for (const command of commands) host.commands.register(command, {replace: options.replace ?? false}); } }; }
