import { createOpCommand, type OpCommandOptions } from "./cli.js";
import { createSecretHandlers } from "./secrets.js";
import { createCompletionHandler } from "./completion.js";
import { createEnvironmentHandlers } from "./environment-commands.js";
import { createDocumentHandlers } from "./documents.js";
import { createItemHandlers } from "./items.js";

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

export function createOp(options: OpCommandOptions) {
  return createOpCommand({
    ...options,
    handlers: { ...createSecretHandlers(options.backend), ...createDocumentHandlers(options.backend), ...createItemHandlers(options.backend), ...createEnvironmentHandlers(options.backend), completion: createCompletionHandler(options.channel), ...options.handlers },
  });
}
