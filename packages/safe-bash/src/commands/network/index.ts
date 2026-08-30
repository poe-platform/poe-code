import type { CommandDefinition, VirtualShellPlugin } from "../../contracts/index.js";
import { createCurlCommand } from "./curl.js";
import type { NetworkCommandsOptions } from "./types.js";

export * from "./types.js";
export { createNodeHttpTransport, type NodeHttpTransportOptions } from "./transport.js";
export { createCurlCommand } from "./curl.js";

export function createNetworkCommands(options: NetworkCommandsOptions): readonly CommandDefinition[] {
  return [createCurlCommand(options)];
}

export function networkCommands(options: NetworkCommandsOptions): VirtualShellPlugin {
  const definitions = createNetworkCommands(options);
  return {
    name: "network-commands",
    setup(host) {
      if (!options.replace && host.commands.has("curl")) throw new Error("Command already registered: curl");
      for (const definition of definitions) host.commands.register(definition, { replace: options.replace ?? false });
    },
  };
}

export const createCurlCommands = createNetworkCommands;
export const curlCommands = networkCommands;
