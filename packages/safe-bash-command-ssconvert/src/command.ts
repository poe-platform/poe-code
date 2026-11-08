import { createStoredZipArchive, readZipArchiveEntries } from "@poe-code/office-package/zip-sync";
import { createSyncSsconvertEvaluator } from "./sync.js";
import { createCommandBindings, type SsconvertCommandBindings } from "./command-bindings.js";

export type { SsconvertCommandsOptions } from "./command-bindings.js";

/** Built-in formats and rendering for existing command imports. */
let evaluator: ReturnType<typeof createSyncSsconvertEvaluator> | undefined;
export function evalSyncSsconvert(...args: Parameters<ReturnType<typeof createSyncSsconvertEvaluator>>) {
  evaluator ??= createSyncSsconvertEvaluator({ read: readZipArchiveEntries, write: createStoredZipArchive });
  return evaluator(...args);
}
const bindings = createCommandBindings(
  async (options) => (await import("./engine.js")).createEngine(options),
  true,
  evalSyncSsconvert
);
export const createSsconvertCommand: SsconvertCommandBindings["createSsconvertCommand"] = bindings.createSsconvertCommand;
export const createSsconvertCommands: SsconvertCommandBindings["createSsconvertCommands"] = bindings.createSsconvertCommands;
export const ssconvertCommands: SsconvertCommandBindings["ssconvertCommands"] = bindings.ssconvertCommands;
