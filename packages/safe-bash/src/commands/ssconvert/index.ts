import { syncCommandEvaluators } from "../internal.js";
import { createSyncSsconvertEvaluator } from "safe-bash-command-ssconvert";
import { createStoredZipArchive, readZipArchiveEntries } from "safe-bash-command-soffice";

export * from "safe-bash-command-ssconvert";

export const evalSyncSsconvert = createSyncSsconvertEvaluator({
  read: readZipArchiveEntries,
  write: createStoredZipArchive,
});
syncCommandEvaluators.evalSyncSsconvert = evalSyncSsconvert;
