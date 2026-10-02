import { Shell, createMemoryFileSystem, createNumfmtCommand } from "@poe-platform/safe-bash";
import { createNumfmtCommands, numfmtCommands, type NumfmtCommandsOptions, type NumfmtLimits, type NumfmtOptions } from "@poe-platform/safe-bash/commands/numfmt";
const limits: Partial<NumfmtLimits> = { maxOutputBytes: 1024, maxRecordBytes: 1024 };
const options: NumfmtCommandsOptions = { limits };
const legacy: NumfmtOptions = { maxRecordBytes: 1024 };
createNumfmtCommand(legacy);
createNumfmtCommands(options);
new Shell({ fs: createMemoryFileSystem() }).use(numfmtCommands(options));
