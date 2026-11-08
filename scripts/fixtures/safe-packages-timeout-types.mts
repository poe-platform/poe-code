import { Shell, createMemoryFileSystem, createTimeoutCommand, createTimeoutCommands, type TimeoutLimits, type TimeoutCommandsOptions } from "@poe-platform/safe-bash";
import { timeoutCommands, createTimeoutCommand as subpathFactory, type TimeoutScheduler, type KillAfterPolicy } from "@poe-platform/safe-bash/commands/timeout";
const limits: TimeoutLimits = { maxArguments: 100, maxArgumentBytes: 1024, maxOutputBytes: 1024 };
const scheduler: TimeoutScheduler = { now: () => 0, setTimeout: () => 0, clearTimeout() {} };
const killAfterPolicy: KillAfterPolicy = async () => ({ exitCode: 137 });
const options: TimeoutCommandsOptions = { limits, scheduler, killAfterPolicy, replace: true };
const shell = new Shell({ fs: createMemoryFileSystem() }).use(timeoutCommands(options));
shell.commands.register(createTimeoutCommand(options), { replace: true });
void [createTimeoutCommands(options), subpathFactory(options)];
