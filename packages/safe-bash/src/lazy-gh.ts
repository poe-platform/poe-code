import { createLazyCommandLoader, createLazyCommands, lazyCommandPlugin } from "./plugins/lazy-command.js";

type ghModule = typeof import("./commands/gh/index.js");
const loadgh = createLazyCommandLoader(() => import("./commands/gh/index.js"));
export const ghMetadata = [
  { name: "gh", description: "Work seamlessly with GitHub from the command line" }
] as const;
export const createGhCommand: ghModule["createGhCommand"] = (...args) =>
  createLazyCommands(ghMetadata, async () => {
    const module = await loadgh();
    return () => [module.createGhCommand(...args)];
  })[0]!;
export const createGhCommands: ghModule["createGhCommands"] = (...args) =>
  createLazyCommands(ghMetadata, async () => {
    const module = await loadgh();
    return () => module.createGhCommands(...args);
  });
export const ghCommands: ghModule["ghCommands"] = (options = {}) =>
  lazyCommandPlugin("gh-commands", createGhCommands(options), options.replace ?? false);
export type { GhCommandOptions, GhCommandsOptions, GhLimits } from "./commands/gh/index.js";

