import { createLazyCommandLoader, createLazyCommands, lazyCommandPlugin } from "./plugins/lazy-command.js";
import { getRuntimeBackingFileSystem } from "safe-bash-contracts/runtime-control";

import type { CommandContext } from "./contracts/index.js";

type ghModule = typeof import("./commands/gh/index.js");
const loadgh = /* @__PURE__ */ createLazyCommandLoader(() => import("./commands/gh/index.js"));
export const ghMetadata = [
  { name: "gh", description: "Work seamlessly with GitHub from the command line" }
] as const;
export const createGhCommand: ghModule["createGhCommand"] = (options = {}) => {
  const backends = new WeakMap<CommandContext["fs"], InstanceType<ghModule["GitHubBackend"]>>();
  return createLazyCommands(ghMetadata, async () => {
    const module = await loadgh();
    return () => [{
      ...ghMetadata[0],
      async execute(context) {
        const filesystem = getRuntimeBackingFileSystem(context.fs) ?? context.fs;
        let backend = options.backend ?? backends.get(filesystem);
        if (!backend) {
          backend = module.createGitHubBackend({
            defaultHost: options.defaultHost,
            defaultUser: options.defaultUser,
            defaultToken: options.defaultToken,
            now: options.now,
          });
          backends.set(filesystem, backend);
        }
        return module.createGhCommand({ ...options, backend }).execute(context);
      },
    }];
  })[0]!;
};
export const createGhCommands: ghModule["createGhCommands"] = (options = {}) =>
  [createGhCommand(options)];
export const ghCommands: ghModule["ghCommands"] = (options = {}) =>
  lazyCommandPlugin("gh-commands", createGhCommands(options), options.replace ?? false);
export type { GhCommandOptions, GhCommandsOptions, GhLimits } from "./commands/gh/index.js";
