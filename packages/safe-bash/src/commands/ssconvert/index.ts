import { syncCommandEvaluators } from "../internal.js";
import {
  createSyncSsconvertEvaluator,
  createSsconvertCommand as createRawCommand,
  createSsconvertCommands as createRawCommands,
  ssconvertCommands as rawPlugin,
  type SsconvertCommandsOptions,
} from "safe-bash-command-ssconvert";
import { createStoredZipArchive, readZipArchiveEntries } from "@poe-code/office-package/zip-sync";

export * from "safe-bash-command-ssconvert";

let evaluator: ReturnType<typeof createSyncSsconvertEvaluator> | undefined;
export function evalSyncSsconvert(...args: Parameters<ReturnType<typeof createSyncSsconvertEvaluator>>) {
  evaluator ??= createSyncSsconvertEvaluator({ read: readZipArchiveEntries, write: createStoredZipArchive });
  return evaluator(...args);
}

export function createSsconvertCommand(options: SsconvertCommandsOptions = {}) {
  syncCommandEvaluators.evalSyncSsconvert = evalSyncSsconvert;
  return createRawCommand(options);
}

export function createSsconvertCommands(options: SsconvertCommandsOptions = {}) {
  syncCommandEvaluators.evalSyncSsconvert = evalSyncSsconvert;
  return createRawCommands(options);
}

export function ssconvertCommands(options: SsconvertCommandsOptions = {}) {
  syncCommandEvaluators.evalSyncSsconvert = evalSyncSsconvert;
  return rawPlugin(options);
}
