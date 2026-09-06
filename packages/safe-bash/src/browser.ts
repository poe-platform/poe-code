import type { CommandDefinition, VirtualShellPlugin } from "./contracts/index.js";
import { basicCommands } from "./commands/basic.js";
import { filesystemCommands } from "./commands/filesystem.js";
import { predicateCommands } from "./commands/predicates.js";
import { streamCommands } from "./commands/streams.js";
import { textCommands } from "./commands/text.js";
import { directExecutor, executionCommands, type ExecutionCommandsOptions } from "./commands/execution.js";
import { diagnostic } from "./commands/internal.js";

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
export type { ExecutionCommandsOptions } from "./commands/execution.js";

export interface BrowserCommandsOptions {
  readonly execution?: ExecutionCommandsOptions;
  readonly replace?: boolean;
  readonly maxDirectoryEntries?: number;
  readonly maxTeeTargets?: number;
  readonly maxTailFollowHandles?: number;
}

export function createBrowserCommands(options: BrowserCommandsOptions = {}): readonly CommandDefinition[] {
  const commands = [
    ...basicCommands(), ...filesystemCommands(options.maxDirectoryEntries), ...predicateCommands(),
    ...streamCommands(options.maxTeeTargets, options.maxTailFollowHandles), ...textCommands(),
  ];
  if (options.execution !== undefined) commands.push(...executionCommands(directExecutor(async context => {
    const command = commands.find(definition => definition.name === context.command);
    if (command) return command.execute(context);
    await diagnostic(context, new Error("command not found"));
    return { exitCode: 127 };
  }), options.execution));
  return commands;
}

export function browserCommands(options: BrowserCommandsOptions = {}): VirtualShellPlugin {
  return {
    name: "browser-commands",
    setup(host) {
      const commands = createBrowserCommands(options);
      if (!options.replace) {
        for (const command of commands) {
          if (host.commands.has(command.name)) throw new Error(`Command already registered: ${command.name}`);
        }
      }
      for (const command of commands) host.commands.register(command, { replace: options.replace ?? false });
    },
  };
}
