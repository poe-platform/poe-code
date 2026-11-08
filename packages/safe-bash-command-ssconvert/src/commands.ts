import { createEngine } from "@poe-code/spreadsheet-engine";
import { createCommandBindings, type SsconvertCommandBindings } from "./command-bindings.js";

export type { SsconvertCommandsOptions } from "./command-bindings.js";

/** Explicit formats and capabilities, using the same neutral engine as the SDK. */
const bindings = createCommandBindings(createEngine);
export const createSsconvertCommand: SsconvertCommandBindings["createSsconvertCommand"] = bindings.createSsconvertCommand;
export const createSsconvertCommands: SsconvertCommandBindings["createSsconvertCommands"] = bindings.createSsconvertCommands;
export const ssconvertCommands: SsconvertCommandBindings["ssconvertCommands"] = bindings.ssconvertCommands;
