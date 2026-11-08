
import { zipExtendedHelp,zipHelp,zipLicense,zipVersion } from "safe-bash-zip-engine/zip/help";

export { DEFAULT_ARCHIVE_LIMITS } from "safe-bash-io-engine/commands/archive/internal";
export type { ArchiveCommandsOptions,ArchiveLimits,ZipEncryptionProfile,ZipHost } from "safe-bash-io-engine/commands/archive/internal";

export function evalSyncZip(args: readonly string[]): string | undefined {
  if (args.length === 1) {
    const a = args[0]!;
    if (a === "-h" || a === "--help" || a === "-?") return zipHelp;
    if (a === "-h2" || a === "--more-help") return zipExtendedHelp;
    if (a === "-v" || a === "--version") return zipVersion;
    if (a === "-L" || a === "--license") return zipLicense;
  }
  return undefined;
}