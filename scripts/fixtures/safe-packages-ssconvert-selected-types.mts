import { createSsconvertCommand, createSsconvertCommands, ssconvertCommands,
  type SsconvertCommandsOptions } from "@poe-platform/safe-bash/ssconvert/commands";
import { csvFormat } from "@poe-platform/safe-bash/ssconvert/formats/csv";
import { xlsxFormat } from "@poe-platform/safe-bash/ssconvert/formats/xlsx";
import type { CommandDefinition, VirtualShellPlugin } from "@poe-platform/safe-bash/contracts";
const options: SsconvertCommandsOptions = { formats: [csvFormat, xlsxFormat], limits: { inputBytes: 1000000 } };
const command: CommandDefinition = createSsconvertCommand(options);
const commands: readonly CommandDefinition[] = createSsconvertCommands(options);
const plugin: VirtualShellPlugin = ssconvertCommands(options);
void [command, commands, plugin];
