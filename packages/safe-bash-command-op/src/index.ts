import { createOpCommand, type OpCommandOptions } from "./cli.js";
import { createSecretHandlers } from "./secrets.js";
import { createCompletionHandler } from "./completion.js";
import { createEnvironmentHandlers } from "./environment-commands.js";
import { createDocumentHandlers } from "./documents.js";
import { createItemHandlers } from "./items.js";
import { createObjectBackend } from "./backend.js";
import type { CommandDefinition, VirtualShellPlugin } from "safe-bash-contracts";

export interface OpCommandsOptions extends OpCommandOptions {
  readonly replace?: boolean;
}

export * from "./types.js";
export * from "./cli.js";
export type { OpConfirmOverwrite, OpSelectPlugin } from "./host-contracts.js";
export type { OpAdminHook, OpAdminHookResult, OpAdminContext } from "./admin.js";
export type { OpItemTemplate } from "./templates.js";
export { createObjectBackend } from "./backend.js";
export { parseSecretReference } from "./references.js";
export { createSecretHandlers } from "./secrets.js";
export { captureEnvironment, restoreEnvironment, type EnvironmentSnapshot } from "./environment.js";
export { createEnvironmentHandlers, type EnvironmentCommandContext } from "./environment-commands.js";
export { createDocumentHandlers, type OpDocumentHandlerOptions } from "./documents.js";
export { createItemHandlers } from "./items.js";

export function createOp(options: OpCommandOptions = {}) {
  const backend = options.backend ?? createObjectBackend();
  return createOpCommand({
    ...options,
    backend,
    handlers: { ...createSecretHandlers(backend), ...createDocumentHandlers(backend), ...createItemHandlers(backend), ...createEnvironmentHandlers(backend), completion: createCompletionHandler(options.channel), ...options.handlers },
  });
}

export function createOpCommands(options: OpCommandsOptions = {}): readonly CommandDefinition[] {
  return [createOp(options)];
}

export function opCommands(options: OpCommandsOptions = {}): VirtualShellPlugin {
  const commands = createOpCommands(options);
  return {
    name: "op-commands",
    setup(host) {
      for (const command of commands) host.commands.register(command, { replace: options.replace ?? false });
    }
  };
}
