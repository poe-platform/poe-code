import { Shell } from "poe-code/safe-bash/shell";
import { baseAgentCommands, createBoundedRegexProvider, type BaseAgentCommandsOptions } from "poe-code/safe-bash/registry";
import { MemoryFileSystem } from "poe-code/safe-fs/core";
const options: BaseAgentCommandsOptions = { regexExecutor: createBoundedRegexProvider() };
const shell: Shell = new Shell({ fs: new MemoryFileSystem() }).use(baseAgentCommands(options));
void shell;
