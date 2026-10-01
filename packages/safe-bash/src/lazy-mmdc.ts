import { createLazyCommandLoader, createLazyCommands, lazyCommandPlugin } from "./plugins/lazy-command.js";
import { snapshotMmdcSettings } from "safe-bash-command-mmdc/settings";

type MmdcModule = typeof import("./commands/mmdc/index.js");
const loadMmdc = createLazyCommandLoader(() => import("./commands/mmdc/index.js"));
const metadata = [{ name: "mmdc", description: "Render Mermaid diagrams to SVG or PNG" }] as const;

export const createMmdcCommands: MmdcModule["createMmdcCommands"] = (settings) => {
  const captured = snapshotMmdcSettings(settings);
  return createLazyCommands(metadata, async () => {
    const module = await loadMmdc();
    return () => module.createMmdcCommands(captured);
  });
};

export const createMmdcCommand: MmdcModule["createMmdcCommand"] = (settings) => {
  const captured = snapshotMmdcSettings(settings);
  return createLazyCommands(metadata, async () => {
    const module = await loadMmdc();
    return () => [module.createMmdcCommand(captured)];
  })[0]!;
};

export const mmdcCommands: MmdcModule["mmdcCommands"] = (settings = {}) => {
  const commands = createMmdcCommands(settings);
  return Object.freeze(Object.assign([...commands], lazyCommandPlugin("mmdc-commands", commands, settings.replace ?? false)));
};

export type { MmdcSettings, MmdcCommandsOptions } from "./commands/mmdc/index.js";
