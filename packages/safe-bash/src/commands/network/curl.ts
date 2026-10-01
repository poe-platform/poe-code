import { createCurlCommand as createPortableCommand } from "safe-bash-command-curl";
import { createDefaultHttpTransport } from "#safe-bash-network-platform";
import { limitsFor } from "./shared.js";
import type { NetworkCommandsOptions } from "./types.js";
export * from "safe-bash-command-curl/curl";
export function createCurlCommand(options: NetworkCommandsOptions = {}) {
 const limits = limitsFor(options.limits);
 return createPortableCommand({ ...options, transport: options.transport ?? createDefaultHttpTransport({ maxHeaderBytes: limits.maxHeaderBytes }) });
}
