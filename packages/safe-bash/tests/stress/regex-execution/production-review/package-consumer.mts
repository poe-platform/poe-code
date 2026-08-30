import { Shell, MemoryFileSystem, standardCommands, searchCommands, type RegexExecutionOptions, type SearchOptions, type StandardCommandsOptions } from 'virtual-bash';

const regex: RegexExecutionOptions = { requestTimeoutMs: 1000, startupTimeoutMs: 3000, maxWorkers: 2, maxQueuedRequests: 4, maxQueuedBytes: 1024 };
const standard: StandardCommandsOptions = { regex };
const search: SearchOptions = { regex };
const shell = new Shell({ fs: new MemoryFileSystem() }).use(standardCommands(standard)).use(searchCommands(search));
await shell.dispose();
