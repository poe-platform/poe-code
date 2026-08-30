import { Shell, MemoryFileSystem, agentCommands, ShellLimitError } from 'virtual-bash';
import { FsError, type CommandInvokeOptions, type CommandContext, type ByteSource } from 'virtual-bash/contracts';

const filesystem = new MemoryFileSystem();
await filesystem.writeFile('/fixture', new Uint8Array([0, 255]));
const input: ByteSource = { async *[Symbol.asyncIterator]() { yield new Uint8Array([0, 255]); } };
const invocation: CommandInvokeOptions = { env: { KEEP: 'value' }, replaceEnv: true, stdin: input, stdinIsDefault: false };
const command = async (context: CommandContext) => {
  if (!context.invoke) throw new Error('Literal invocation required');
  return context.invoke('env', ['-S', 'record "a b"'], invocation);
};
const shell = new Shell({ fs: filesystem, env: {} }).use(agentCommands()).use({
  name: 'packed-declaration-proof',
  setup(host) { host.commands.register({ name: 'record', execute: command }); host.use(async (context, next) => next()); },
});
const result = await shell.exec('record', { stdin: input });
const bytes: Uint8Array = result.stdoutBytes;
const status: number = result.exitCode;
const reason: Error = new FsError('ENOENT', { path: '/cancel' });
const limit: Error = new ShellLimitError('maxCommands');
void [bytes, status, reason, limit];
await shell.dispose();
