import type { CommandDefinition, VirtualShellPlugin } from "./contracts/index.js";
import { basicCommands } from "./commands/basic.js";
import { filesystemCommands } from "./commands/filesystem.js";
import { predicateCommands } from "./commands/predicates.js";
import { streamCommands } from "./commands/streams.js";
import { textCommands } from "./commands/text.js";

export * from "./contracts/index.js";
export * from "./shell/index.js";
export * from "./fs/memory/index.js";
export * from "./fs/readonly/index.js";
export * from "./fs/mount/index.js";
export * from "./fs/overlay/index.js";
export { createFetchTransport } from "./commands/network/fetch-transport.js";
export type { FetchTransportOptions } from "./commands/network/fetch-transport.js";
export { createOriginAuthorizer } from "./commands/network/authorizer.js";
export type { OriginAllowlist, OriginAuthorizerOptions } from "./commands/network/authorizer.js";
export { cloudflareWorkerNetworkLimits } from "./commands/network/types.js";
export { portableSearchCommands, type PortableSearchOptions } from "./commands/search/portable.js";
export * from "./commands/regex-execution/public.js";

export interface BrowserCommandsOptions {
  readonly replace?: boolean;
}

export function createBrowserCommands(): readonly CommandDefinition[] {
  return [
    ...basicCommands(), ...filesystemCommands(), ...predicateCommands(),
    ...streamCommands(), ...textCommands(),
  ];
}

export function browserCommands(options: BrowserCommandsOptions = {}): VirtualShellPlugin {
  return {
    name: "browser-commands",
    setup(host) {
      const commands = createBrowserCommands();
      if (!options.replace) {
        for (const command of commands) {
          if (host.commands.has(command.name)) throw new Error(`Command already registered: ${command.name}`);
        }
      }
      for (const command of commands) host.commands.register(command, { replace: options.replace ?? false });
    },
  };
}
