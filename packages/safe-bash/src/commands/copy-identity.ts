import { FsError, type EntryComparison, type FileStat, type FileSystem, type FsOptions } from "../contracts/index.js";

import { compareCopyIdentity } from "safe-bash-contracts/filesystem-identity";
export { compareCopyIdentity } from "safe-bash-contracts/filesystem-identity";

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
