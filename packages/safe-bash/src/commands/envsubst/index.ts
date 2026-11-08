import { builtInDirectContextExecutors } from "../internal.js";
import type { CommandDefinition, VirtualShellPlugin } from "../../contracts/index.js";
import {
  createEnvsubstCommand as createRawEnvsubstCommand,
  createEnvsubstCommands as createRawEnvsubstCommands,
  envsubstCommands as rawEnvsubstCommands,
  settings,
  type EnvsubstCommandsOptions,
} from "safe-bash-command-envsubst";

export { settings, type EnvsubstCommandsOptions, type EnvsubstLimits, type EnvsubstOptions } from "safe-bash-command-envsubst";

export function createEnvsubstCommand(options: EnvsubstCommandsOptions = {}): CommandDefinition {
  const def = createRawEnvsubstCommand(options);
  builtInDirectContextExecutors.add(def.execute);
  return def;
}

export function createEnvsubstCommands(options: EnvsubstCommandsOptions = {}): readonly CommandDefinition[] {
  const defs = createRawEnvsubstCommands(options);
  for (let i = 0; i < defs.length; i++) builtInDirectContextExecutors.add(defs[i]!.execute);
  return defs;
}

export function envsubstCommands(options: EnvsubstCommandsOptions = {}): VirtualShellPlugin {
  createEnvsubstCommands(options);
  return rawEnvsubstCommands(options);
}
