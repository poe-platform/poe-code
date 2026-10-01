import { createWgetCommand as createPortableCommand } from "safe-bash-command-wget";
import { createDefaultHttpTransport, requiresFiniteUrlLimits } from "#safe-bash-network-platform";
import { limitsFor } from "./shared.js";
import type { NetworkCommandsOptions } from "./types.js";
export * from "safe-bash-command-wget/wget";
export function createWgetCommand(options: NetworkCommandsOptions) {
 if (typeof options?.authorize !== "function") throw new TypeError("wget requires an explicit network authorizer");
 const limits = limitsFor(options.limits);
 if (requiresFiniteUrlLimits && (!Number.isFinite(limits.maxUrls) || !Number.isFinite(limits.maxBufferBytes))) throw new TypeError("Portable network commands require finite maxUrls and maxBufferBytes limits");
 return createPortableCommand({ ...options, transport: options.transport ?? createDefaultHttpTransport({ maxHeaderBytes: limits.maxHeaderBytes }) });
}
