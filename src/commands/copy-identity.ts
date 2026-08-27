import type { FileStat } from "../contracts/index.js";

function complete(stat: FileStat): boolean {
  return ((typeof stat.identityScope === "object" && stat.identityScope !== null) || typeof stat.identityScope === "symbol")
    && typeof stat.dev === "number" && Number.isSafeInteger(stat.dev) && stat.dev >= 0
    && typeof stat.ino === "number" && Number.isSafeInteger(stat.ino) && stat.ino >= 0;
}

export function compareCopyIdentity(left: FileStat | undefined, right: FileStat | undefined): "same" | "distinct" | "unknown" {
  if (!left || !right || !complete(left) || !complete(right)) return "unknown";
  return left.identityScope === right.identityScope && left.dev === right.dev && left.ino === right.ino ? "same" : "distinct";
}
