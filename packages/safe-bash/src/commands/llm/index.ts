import type { CommandDefinition, VirtualShellPlugin } from "../../contracts/index.js";
import { createCommand } from "./command.js";
import type { LlmCommandsOptions } from "./types.js";
export type { LlmProvider, LlmModel, LlmRequest, LlmCommandsOptions } from "./types.js";

export function createLlmCommands(options: LlmCommandsOptions): readonly CommandDefinition[] {
  return [createCommand(options)];
}

export function llmCommands(options: LlmCommandsOptions): VirtualShellPlugin {
  const commands = createLlmCommands(options);
  return { name: "llm-commands", setup(host) {
    for (const command of commands) host.commands.register(command, { replace: options.replace ?? false });
  } };
}
