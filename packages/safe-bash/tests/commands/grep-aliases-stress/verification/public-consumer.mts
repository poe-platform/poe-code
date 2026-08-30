import { Shell, MemoryFileSystem, type CommandDefinition, type VirtualShellPlugin, type RegexExecutionOptions } from 'virtual-bash';
import { createGrepAliasCommands, grepAliasCommands, egrepCommand, fgrepCommand, type GrepAliasOptions } from './node_modules/virtual-bash/dist/commands/grep-aliases/index.js';

const regex: RegexExecutionOptions = { maxWorkers: 1, maxQueuedRequests: 1, maxQueuedBytes: 4096, requestTimeoutMs: 1500, startupTimeoutMs: 1500, idleTimeoutMs: 1000 };
const options: GrepAliasOptions = { regex, replace: false };
const definitions: readonly CommandDefinition[] = createGrepAliasCommands(options);
const plugin: VirtualShellPlugin = grepAliasCommands(options);
const extended: CommandDefinition = egrepCommand(options);
const fixed: CommandDefinition = fgrepCommand(options);
const shell = new Shell({ fs: new MemoryFileSystem(), limits: { maxOutputBytes: 6144, maxCommands: 4 } });
void definitions;
void plugin;
void extended;
void fixed;
void shell;
