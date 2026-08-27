import * as host from "node:fs/promises";
import type { Stats } from "node:fs";
import { basename, dirname, join } from "node:path";
import { suiteRoot } from "../helpers.js";

export interface QualifiedModeFixtures {
  readonly uid: number;
  readonly gid: number;
  setMode(name: string, mode: number): Promise<number>;
}

function requirePrerequisite(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(`metadata permission prerequisite: ${message}`);
}

function sameEntry(before: Stats, after: Stats): boolean {
  return before.dev === after.dev && before.ino === after.ino
    && before.isDirectory() === after.isDirectory() && before.isFile() === after.isFile();
}

export async function qualifyModeFixtures(root: string, names: readonly string[]): Promise<QualifiedModeFixtures> {
  try {
    requirePrerequisite(typeof process.getuid === "function" && typeof process.getgid === "function"
      && typeof process.geteuid === "function" && typeof process.getegid === "function", "POSIX caller identity unavailable");
    const uid = process.getuid();
    const gid = process.getgid();
    requirePrerequisite(uid === process.geteuid() && gid === process.getegid(), "real/effective caller identities must match");
    const rootStat = await host.lstat(root);
    const canonicalRoot = await host.realpath(root);
    requirePrerequisite(rootStat.isDirectory() && !rootStat.isSymbolicLink() && rootStat.uid === uid,
      "namespace must be an owned real directory");
    requirePrerequisite(dirname(canonicalRoot) === await host.realpath(suiteRoot)
      && basename(canonicalRoot).startsWith(".native-"), "namespace must be a metadata test-owned .native-* root");
    requirePrerequisite(names.length > 0 && new Set(names).size === names.length, "fixture names must be nonempty and unique");
    const entries = new Map<string, Stats>();
    for (const name of names) {
      requirePrerequisite(name !== "" && name !== "." && name !== ".." && !/[\/\\\0]/u.test(name),
        "fixture names must be direct children");
      const entry = await host.lstat(join(canonicalRoot, name));
      requirePrerequisite(!entry.isSymbolicLink() && (entry.isFile() || entry.isDirectory()) && entry.uid === uid,
        `${name}: expected an owned regular file or directory, never a symlink`);
      entries.set(name, entry);
    }
    for (const [name, before] of entries) {
      await host.chown(join(canonicalRoot, name), before.uid, gid);
      const after = await host.lstat(join(canonicalRoot, name));
      requirePrerequisite(sameEntry(before, after) && after.uid === before.uid && after.gid === gid,
        `${name}: primary-group qualification did not preserve owner and entry identity`);
    }
    return {
      uid, gid,
      async setMode(name, mode) {
        try {
          const original = entries.get(name);
          requirePrerequisite(original, `${name}: fixture was not qualified`);
          requirePrerequisite(Number.isSafeInteger(mode) && mode >= 0 && mode <= 0o7777, `${name}: invalid initial mode`);
          const currentRoot = await host.lstat(canonicalRoot);
          requirePrerequisite(sameEntry(rootStat, currentRoot) && currentRoot.uid === uid, "qualified namespace changed");
          const target = join(canonicalRoot, name);
          const before = await host.lstat(target);
          requirePrerequisite(sameEntry(original, before) && before.uid === uid && before.gid === gid,
            `${name}: qualified ownership, group or entry changed before initial mode`);
          await host.chmod(target, mode);
          const after = await host.lstat(target);
          requirePrerequisite(sameEntry(original, after) && after.uid === uid && after.gid === gid
            && (after.mode & 0o7777) === mode,
          `${name}: requested initial mode ${mode.toString(8)} was not established exactly`);
          return after.mode & 0o7777;
        } catch (error) {
          throw new Error(`metadata permission prerequisite: cannot establish initial mode for ${name}`, { cause: error });
        }
      },
    };
  } catch (error) {
    throw new Error("metadata permission prerequisite: cannot qualify owned native fixtures", { cause: error });
  }
}
