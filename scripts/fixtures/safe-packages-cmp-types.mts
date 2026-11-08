import { Shell } from "@poe-platform/safe-bash";
import { createCmpCommand, createCmpCommands, cmpCommands, type CmpLimits, type CmpCommandsOptions } from "@poe-platform/safe-bash/commands/cmp";
import { createCmpCommand as existingRoute } from "@poe-platform/safe-bash/cmp";
const limits: CmpLimits = { maxChunkBytes: 4096, maxFallbackBytes: 8192 };
const options: CmpCommandsOptions = { limits, comparisonBlockBytes: 4096, replace: true };
const shell = new Shell().use(cmpCommands(options));
shell.commands.register(createCmpCommand(options), { replace: true });
const commands: ReturnType<typeof existingRoute>[] = [...createCmpCommands(options)];
void commands;
