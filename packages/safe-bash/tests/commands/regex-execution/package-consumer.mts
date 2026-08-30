import {
  MemoryFileSystem, Shell, standardCommands, searchCommands,
  createStandardCommands, createSearchCommands, type RegexExecutionOptions,
} from "virtual-bash";

const regex: RegexExecutionOptions = { requestTimeoutMs: 1000, startupTimeoutMs: 3000, maxWorkers: 2 };
const standard = createStandardCommands({ regex });
const search = createSearchCommands({ regex });
const shell = new Shell({ fs: new MemoryFileSystem() })
  .use(standardCommands({ regex })).use(searchCommands({ regex }));
await shell.exec("printf 'cat\\n' | grep -E 'c.t' | rg cat -");
await shell.dispose();
void standard;
void search;
