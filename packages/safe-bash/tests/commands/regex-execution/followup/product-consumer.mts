import { Shell, MemoryFileSystem, agentCommands, standardCommands, searchCommands, type RegexExecutionOptions } from "virtual-bash";

const regex: RegexExecutionOptions = { requestTimeoutMs: 40, startupTimeoutMs: 3000, maxWorkers: 2 };
const shell = new Shell({ fs: new MemoryFileSystem() }).use(standardCommands({ regex })).use(searchCommands({ regex }));
await shell.exec("grep -E '^a'", { stdin: "ab\n" });
await shell.dispose();
const aggregate = new Shell({ fs: new MemoryFileSystem() }).use(agentCommands());
await aggregate.dispose();
