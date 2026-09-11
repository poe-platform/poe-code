import type { CommandDefinition, VirtualShellPlugin } from "../../contracts/index.js";
import { createWgetCommand } from "./wget.js";
import { createCurlCommand } from "./curl.js";
import type { NetworkCommandsOptions } from "./types.js";

export * from "./types.js";
export { createFetchTransport, type FetchTransportOptions } from "./fetch-transport.js";
export { createOriginAuthorizer, type OriginAllowlist, type OriginAuthorizerOptions } from "./authorizer.js";
export { createCurlCommand } from "./curl.js";
export { createWgetCommand } from "./wget.js";

export function createNetworkCommands(options: NetworkCommandsOptions): readonly CommandDefinition[] {
  return [createCurlCommand(options), createWgetCommand(options)];
}

export function networkCommands(options: NetworkCommandsOptions): VirtualShellPlugin {
  const definitions = createNetworkCommands(options);
  return {
    name: "network-commands",
    setup(host) {
      if (!options.replace) for (const definition of definitions) if (host.commands.has(definition.name)) throw new Error(`Command already registered: ${definition.name}`);
      for (const definition of definitions) host.commands.register(definition, { replace: options.replace ?? false });
    },
  };
}

export const createCurlCommands = createNetworkCommands;
export const curlCommands = networkCommands;
