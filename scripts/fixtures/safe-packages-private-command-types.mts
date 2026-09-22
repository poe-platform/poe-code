import { Shell, type CommandDefinition } from "@poe-platform/safe-bash";
import { getCommandArguments, type CommandArguments } from "@poe-platform/safe-bash/contracts/command";
import { shellValueFromBytes } from "@poe-platform/safe-bash/contracts/value";
import { MemoryFileSystem } from "@poe-platform/safe-fs/core";
import { createExiftoolCommand, createExiftoolArguments, exiftoolCommands, type ExiftoolCommandOptions } from "@poe-platform/safe-bash/commands/exiftool";

const options: ExiftoolCommandOptions = { limits: { maxInputBytes: 1024 } };
const command: CommandDefinition = createExiftoolCommand(options);
const carrier: CommandArguments = createExiftoolArguments({ files: ["/image.png"], format: "json" }, { signal: new AbortController().signal });
const bytes: Uint8Array | undefined = getCommandArguments({ args: carrier.args, argumentValues: carrier }).withValues([shellValueFromBytes(Uint8Array.of(255))]).bytes(0);
const shell: Shell = new Shell({ fs: new MemoryFileSystem() }).use(exiftoolCommands(options));
void command;
void bytes;
await shell.dispose();
