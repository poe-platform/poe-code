import { evalSyncStat } from "./stat.js";
import { registerDefaultExecutors } from "../internal.js";
import type { CommandDefinition, VirtualShellPlugin } from "../../contracts/index.js";
import { createInstallCommand } from "safe-bash-command-install";
import { createChmodCommand } from "./chmod.js";
import { createStatCommand } from "./stat.js";
import { createMktempCommand } from "./mktemp.js";
import { truncateCommand } from "../truncate.js";
import { settings, type MetadataCommandsOptions } from "./internal.js";
export type { MetadataCommandsOptions, MetadataLimits } from "./internal.js";

export function createMetadataCommands(options: MetadataCommandsOptions = {}): readonly CommandDefinition[] {
  const normalized = settings(options);
  return registerDefaultExecutors([createChmodCommand(options), createStatCommand(options), createMktempCommand(options), truncateCommand({ ...options, limits: normalized.limits }), createInstallCommand()], options);
}

export function metadataCommands(options: MetadataCommandsOptions = {}): VirtualShellPlugin {
  const commands = createMetadataCommands(options);
  return { name: "metadata-commands", setup(host) {
    if (!options.replace) for (const command of commands) if (host.commands.has(command.name)) throw new Error(`Command already registered: ${command.name}`);
    for (const command of commands) host.commands.register(command, { replace: options.replace ?? false });
  } };
}

export { evalSyncStat, type SyncStatInfo } from "./stat.js";

export { evalSyncMktemp } from "./mktemp.js";

export { evalSyncTruncate } from "safe-bash-command-truncate";

import { syncCommandEvaluators } from "../internal.js";
syncCommandEvaluators.evalSyncStat = evalSyncStat;
