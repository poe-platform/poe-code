import { Shell, MemoryFileSystem, agentCommands, createAgentCommands, standardCommands, createStandardCommands, ShellLimitError, type AgentCommandsOptions, type StandardCommandsOptions, type ReadDirectoryOptions as BashReadDirectoryOptions } from 'virtual-bash';
import { FsError, type CommandInvokeOptions, type CommandContext, type ByteSource, type CommandDefinition, type VirtualShellPlugin, type ReadDirectoryOptions } from 'virtual-bash/contracts';
import { browserCommands, createBrowserCommands, type BrowserCommandsOptions, type ReadDirectoryOptions as BrowserReadDirectoryOptions } from 'virtual-bash/browser';
import type { FileSystem as RootFileSystem, ReadDirectoryOptions as RootReadDirectoryOptions } from 'poe-code/safe-fs';

const directoryOptions: RootReadDirectoryOptions = { maxEntries: 1, signal: new AbortController().signal };
const contractDirectoryOptions: ReadDirectoryOptions = directoryOptions;
const bashDirectoryOptions: BashReadDirectoryOptions = contractDirectoryOptions;
const browserDirectoryOptions: BrowserReadDirectoryOptions = bashDirectoryOptions;
const zeroDirectoryOptions: ReadDirectoryOptions = { maxEntries: 0 };
const legacyDirectoryOptions: RootReadDirectoryOptions = {};
const standardOptions: StandardCommandsOptions = { maxDirectoryEntries: 0 };
const agentOptions: AgentCommandsOptions = { maxDirectoryEntries: 1 };
const browserOptions: BrowserCommandsOptions = { maxDirectoryEntries: 2 };
const commandSets: readonly (readonly CommandDefinition[])[] = [
  createStandardCommands(), createStandardCommands(standardOptions),
  createAgentCommands(), createAgentCommands(agentOptions),
  createBrowserCommands(), createBrowserCommands(browserOptions),
];
const plugins: readonly VirtualShellPlugin[] = [
  standardCommands(), standardCommands(standardOptions),
  agentCommands(), agentCommands(agentOptions),
  browserCommands(), browserCommands(browserOptions),
];
// @ts-expect-error Directory entry limits are numeric, not strings.
const invalidDirectoryOptions: ReadDirectoryOptions = { maxEntries: '1' };
// @ts-expect-error Standard command entry limits are numeric, not strings.
const invalidStandardOptions: StandardCommandsOptions = { maxDirectoryEntries: '1' };
// @ts-expect-error Agent command entry limits are numeric, not strings.
const invalidAgentOptions: AgentCommandsOptions = { maxDirectoryEntries: '1' };
// @ts-expect-error Browser command entry limits are numeric, not strings.
const invalidBrowserOptions: BrowserCommandsOptions = { maxDirectoryEntries: '1' };

const filesystem = new MemoryFileSystem();
await filesystem.writeFile('/fixture', new Uint8Array([0, 255]));
const readDirectory: RootFileSystem['readdir'] = filesystem.readdir.bind(filesystem);
await readDirectory('/', browserDirectoryOptions);
await filesystem.readdir('/', { maxEntries: 1 });
const input: ByteSource = { async *[Symbol.asyncIterator]() { yield new Uint8Array([0, 255]); } };
const invocation: CommandInvokeOptions = { env: { KEEP: 'value' }, replaceEnv: true, stdin: input, stdinIsDefault: false };
const command = async (context: CommandContext) => {
  if (!context.invoke) throw new Error('Literal invocation required');
  return context.invoke('env', ['-S', 'record "a b"'], invocation);
};
const shell = new Shell({ fs: filesystem, env: {}, limits: { maxRedirects: 64 } }).use(agentCommands()).use({
  name: 'packed-declaration-proof',
  setup(host) { host.commands.register({ name: 'record', execute: command }); host.use(async (context, next) => next()); },
});
const result = await shell.exec('record', { stdin: input });
const bytes: Uint8Array = result.stdoutBytes;
const status: number = result.exitCode;
const reason: Error = new FsError('ENOENT', { path: '/cancel' });
const limit: Error = new ShellLimitError('maxCommands');
void [bytes, status, reason, limit, zeroDirectoryOptions, legacyDirectoryOptions, commandSets, plugins,
  invalidDirectoryOptions, invalidStandardOptions, invalidAgentOptions, invalidBrowserOptions];
await shell.dispose();
