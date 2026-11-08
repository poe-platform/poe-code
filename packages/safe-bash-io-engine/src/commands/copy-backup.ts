import { UsageError } from "../internal.js";

export interface CopyBackup {
  readonly mode: "simple" | "numbered" | "existing";
  readonly suffix: string;
}

export function matchBackupMode(control: string): CopyBackup["mode"] | "none" {
  const aliases: Readonly<Record<string, CopyBackup["mode"] | "none">> = {
    none: "none", off: "none", numbered: "numbered", t: "numbered",
    existing: "existing", nil: "existing", simple: "simple", never: "simple",
  };
  if (Object.hasOwn(aliases, control)) return aliases[control]!;
  const matches = Object.keys(aliases).filter(alias => alias.startsWith(control));
  if (matches.length && new Set(matches.map(alias => aliases[alias])).size === 1) return aliases[matches[0]!]!;
  throw new UsageError(`${matches.length ? "ambiguous" : "invalid"} argument '${control}' for 'backup type'`);
}

export function normalizeBackupSuffix(suffix: string | undefined): string {
  return !suffix || suffix.includes("/") ? "~" : suffix;
}
