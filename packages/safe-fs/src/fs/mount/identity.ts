import type { FileStat } from "../../contracts/filesystem.js";

function complete(stat: FileStat): boolean {
  const { identityScope, dev, ino } = stat;
  return ((typeof identityScope === "object" && identityScope !== null) || typeof identityScope === "symbol")
    && typeof dev === "number" && Number.isSafeInteger(dev) && dev >= 0
    && typeof ino === "number" && Number.isSafeInteger(ino) && ino >= 0;
}

function opaqueComplete(stat: FileStat): boolean {
  return ((typeof stat.identityScope === "object" && stat.identityScope !== null) || typeof stat.identityScope === "symbol")
    && typeof stat.opaqueIdentity === "string" && stat.opaqueIdentity.length > 0 && stat.opaqueIdentity.length <= 4096;
}

export function compareIdentity(left: FileStat | undefined, right: FileStat | undefined): "same" | "distinct" | "unknown" {
  if (!left || !right) return "unknown";
  if (complete(left) && complete(right)) return left.identityScope === right.identityScope && left.dev === right.dev && left.ino === right.ino ? "same" : "distinct";
  if (opaqueComplete(left) && opaqueComplete(right)) return left.identityScope === right.identityScope && left.opaqueIdentity === right.opaqueIdentity ? "same" : "distinct";
  if ((complete(left) || opaqueComplete(left)) && (complete(right) || opaqueComplete(right)) && left.identityScope !== right.identityScope) return "distinct";
  return "unknown";
}
