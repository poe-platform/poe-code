import { Shell, MemoryFileSystem, agentCommands, standardCommands, searchCommands, type RegexExecutionOptions, type SearchOptions, type StandardCommandsOptions } from 'virtual-bash';

const regex: RegexExecutionOptions = { requestTimeoutMs: 1000, startupTimeoutMs: 3000, maxWorkers: 2, maxQueuedRequests: 4, maxQueuedBytes: 1024 };
const standard: StandardCommandsOptions = { regex };
const search: SearchOptions = { regex };
const aggregate = new Shell({fs: new MemoryFileSystem()}).use(agentCommands({search}));
const separate = new Shell({fs: new MemoryFileSystem()}).use(standardCommands(standard)).use(searchCommands(search));
await aggregate.exec("grep -E '^a' | rg 'b$'", {stdin: 'ab\n'});
await aggregate.dispose();
await separate.dispose();
