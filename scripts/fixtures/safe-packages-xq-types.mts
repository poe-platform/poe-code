import { createXqCommand, createXqCommands, xqCommands, type XqLimits, type XqCommandsOptions } from "@poe-platform/safe-bash";
import { createXqCommand as subpath, type XqLimits as SubpathLimits } from "@poe-platform/safe-bash/commands/xq";
import type { CommandDefinition } from "@poe-platform/safe-bash/contracts/command";
const limits: Partial<XqLimits & SubpathLimits> = { maxInputBytes: 1024, maxNodes: 128 };
const options: XqCommandsOptions = { limits, replace: true };
const commands: readonly CommandDefinition[] = [createXqCommand(options), subpath(options), ...createXqCommands(options)];
void [commands, xqCommands(options)];
