import { defaultPythonCommands } from "./default-runtime.js";
import type { CommandDefinition, VirtualShellPlugin } from "../../contracts/index.js";
import { createPythonExecutorCommands, pythonExecutorCommands, type PythonCommandsOptions } from "./executor.js";

export * from "./executor.js";

export function createPythonCommands(options?: PythonCommandsOptions): readonly CommandDefinition[] {
  if (options === undefined) return defaultPythonCommands;
  return createPythonExecutorCommands(options);
}

export function pythonCommands(options?: PythonCommandsOptions): VirtualShellPlugin {
  if (options === undefined) {
    return {
      name: "python-commands",
      setup(host) {
        for (const command of defaultPythonCommands) host.commands.register(command, { replace: false });
      }
    };
  }
  return pythonExecutorCommands(options);
}
