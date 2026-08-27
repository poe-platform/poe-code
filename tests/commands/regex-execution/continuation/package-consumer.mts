import { MemoryFileSystem, Shell, agentCommands, createSearchCommands, createStandardCommands, type RegexExecutionOptions } from "virtual-bash";

const regex: RegexExecutionOptions = { requestTimeoutMs: 1000, startupTimeoutMs: 3000, maxWorkers: 2, maxQueuedRequests: 64, maxQueuedBytes: 128 * 1024 * 1024 };
const shell = new Shell({ fs: new MemoryFileSystem() }).use(agentCommands({ search: { regex } }));
await shell.exec("rg --files -g '*.ts'");
await shell.dispose();
createSearchCommands({ regex });
createStandardCommands({ regex });
