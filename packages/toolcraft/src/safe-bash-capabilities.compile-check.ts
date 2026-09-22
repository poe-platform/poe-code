import type { ShellExecOptions, BoundedRegexProvider } from "@poe-platform/safe-bash";
import type { ToolcraftCapabilities } from "./safe-bash.js";

const revoked: ShellExecOptions = { capabilities: { fetch: undefined, regex: undefined, services: undefined } };
const provider: BoundedRegexProvider = { createWorker() { throw new Error("synthetic provider"); } };
const supplied: ToolcraftCapabilities<{ client: object }> = {
  services: { client: {} },
  regex: { executor: provider, limits: { requestTimeoutMs: 17 } },
  fetch: undefined,
  humanInLoop: undefined
};
void revoked;
void supplied;
