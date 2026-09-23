import { FsError, type CommandContext, type FileStat } from "../contracts/index.js";
import { codeOf, pathOf } from "./internal.js";
import { assertCommandRequirements } from "../contracts/command-requirements.js";
import { predicateRequirements } from "./portable-requirements.js";
import { compareCopyIdentity } from "./copy-identity.js";

export interface PredicateIdentity {
  readonly effectiveUid?: number;
  readonly effectiveGid?: number;
}

type FilePredicateContext = Pick<CommandContext, "fs" | "cwd" | "signal"> & { readonly command?: string };

async function metadata(context: FilePredicateContext, path: string): Promise<FileStat | undefined> {
  const requirementsContext = { ...context, command: context.command ?? "[[" };
  assertCommandRequirements(requirementsContext, predicateRequirements, ["metadata"]);
  try {
    if (context.fs.capabilitiesFor) assertCommandRequirements(requirementsContext, predicateRequirements, ["metadata"],
      await context.fs.capabilitiesFor(pathOf(context, path), { signal: context.signal }));
    const stat = await context.fs.stat(pathOf(context, path), { signal: context.signal });
    context.signal.throwIfAborted();
    return stat;
  } catch (error) {
    context.signal.throwIfAborted();
    if (["ENOENT", "ENOTDIR", "EACCES", "ELOOP"].includes(codeOf(error) ?? "")) return undefined;
    throw error;
  }
}

export async function evaluateFilePredicate(context: FilePredicateContext, operator: string, left: string, right?: string, identity: PredicateIdentity = {}): Promise<boolean> {
  const first = await metadata(context, left);
  if (right !== undefined) {
    const second = await metadata(context, right);
    if (operator === "-nt") return first !== undefined && (!second || first.mtimeMs > second.mtimeMs);
    if (operator === "-ot") return second !== undefined && (!first || first.mtimeMs < second.mtimeMs);
    const comparison = compareCopyIdentity(first, second);
    if (comparison !== "unknown") return comparison === "same";
    return first?.ino !== undefined && second?.ino !== undefined && first.type === second.type && first.ino === second.ino && first.dev === second.dev;
  }
  if (!first) return false;
  switch (operator) {
    case "-b": return (first.mode & 0o170000) === 0o060000;
    case "-p": return (first.mode & 0o170000) === 0o010000;
    case "-S": return (first.mode & 0o170000) === 0o140000;
    case "-u": return (first.mode & 0o4000) !== 0;
    case "-g": return (first.mode & 0o2000) !== 0;
    case "-k": return (first.mode & 0o1000) !== 0;
    case "-O": case "-G": {
      const caller = operator === "-O" ? identity.effectiveUid : identity.effectiveGid;
      const owner = operator === "-O" ? first.uid : first.gid;
      if (caller === undefined || owner === undefined) throw new FsError("ENOTSUP", { message: "ownership predicate requires caller and filesystem identity" });
      if (!Number.isSafeInteger(caller) || caller < 0) throw new TypeError("caller identity must be a nonnegative safe integer");
      return caller === owner;
    }
    default: throw new TypeError(`unknown file predicate: ${operator}`);
  }
}
