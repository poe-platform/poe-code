import { createLazyCommandLoader, createLazyCommands, lazyCommandPlugin } from "./plugins/lazy-command.js";

type MmdcModule = typeof import("./commands/mmdc/index.js");
const loadMmdc = createLazyCommandLoader(() => import("./commands/mmdc/index.js"));
const metadata = [{ name: "mmdc", description: "Render Mermaid diagrams to SVG or PNG" }] as const;

export const createMmdcCommands: MmdcModule["createMmdcCommands"] = (...args) =>
  createLazyCommands(metadata, async () => {
    const module = await loadMmdc();
    return () => module.createMmdcCommands(...args);
  });

export const createMmdcCommand: MmdcModule["createMmdcCommand"] = (...args) =>
  createLazyCommands(metadata, async () => {
    const module = await loadMmdc();
    return () => [module.createMmdcCommand(...args)];
  })[0]!;

export const mmdcCommands: MmdcModule["mmdcCommands"] = (settings = {}) => {
  const commands = createMmdcCommands(settings);
  return Object.freeze(Object.assign([...commands], lazyCommandPlugin("mmdc-commands", commands, settings.replace ?? false)));
};

export type { MmdcSettings, MmdcCommandsOptions } from "./commands/mmdc/index.js";
