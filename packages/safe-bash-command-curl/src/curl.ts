import type { CommandDefinition } from "safe-bash-contracts";
import type { NetworkCommandsOptions } from "safe-bash-network-engine/types";
import { createTransferCommand } from "safe-bash-network-engine/transfer";
import { parseCurlInput } from "./input.js";
export { createTransferCommand } from "safe-bash-network-engine/transfer";

export function createCurlCommand(options: NetworkCommandsOptions = {}): CommandDefinition {
  return createTransferCommand(options, {
    name: "curl",
    help: "Usage: curl [HTTP(S) URL] [-X METHOD] [-H HEADER] [-d DATA] [-L] [-o VFSFILE]\nExplicit host authorization is required. See network/README.md for supported flags and limits.\n",
    version: "virtual-bash curl 0.0 (HTTP HTTPS; Node streaming transport)\n",
    parse: parseCurlInput,
    status: code => code,
  });
}
