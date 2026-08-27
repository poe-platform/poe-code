import { FsError, type EntryComparison, type FileStat, type FileSystem, type FsOptions } from "../contracts/index.js";

function complete(stat: FileStat): boolean {
  return ((typeof stat.identityScope === "object" && stat.identityScope !== null) || typeof stat.identityScope === "symbol")
    && typeof stat.dev === "number" && Number.isSafeInteger(stat.dev) && stat.dev >= 0
    && typeof stat.ino === "number" && Number.isSafeInteger(stat.ino) && stat.ino >= 0;
}

export function compareCopyIdentity(left: FileStat | undefined, right: FileStat | undefined): "same" | "distinct" | "unknown" {
  if (!left || !right || !complete(left) || !complete(right)) return "unknown";
  return left.identityScope === right.identityScope && left.dev === right.dev && left.ino === right.ino ? "same" : "distinct";
}

export async function compareObservedEntries(
  fs: FileSystem, path: string, stat: FileStat,
  peer: FileSystem, peerPath: string, peerStat: FileStat,
  options: FsOptions = {},
): Promise<EntryComparison> {
  options.signal?.throwIfAborted();
  const identity = compareCopyIdentity(stat, peerStat);
  if (identity !== "unknown") return identity;
  let result: EntryComparison = "unknown";
  const operands: readonly [FileSystem, string, FileSystem, string][] = fs === peer
    ? [[fs, path, peer, peerPath]]
    : [[fs, path, peer, peerPath], [peer, peerPath, fs, path]];
  for (const [owner, ownPath, other, otherPath] of operands) {
    options.signal?.throwIfAborted();
    if (!owner.compareEntry) continue;
    let answer: EntryComparison;
    try { answer = await owner.compareEntry(ownPath, other, otherPath, options); }
    catch (error) { options.signal?.throwIfAborted(); throw error; }
    options.signal?.throwIfAborted();
    if (answer !== "same" && answer !== "distinct" && answer !== "unknown") {
      throw new FsError("EIO", { path, dest: peerPath, message: "invalid entry comparison answer" });
    }
    if (answer === "unknown") continue;
    if (result !== "unknown" && result !== answer) {
      throw new FsError("EIO", { path, dest: peerPath, message: "conflicting entry comparison answers" });
    }
    result = answer;
  }
  return result;
}
