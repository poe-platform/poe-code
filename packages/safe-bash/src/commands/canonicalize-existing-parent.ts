import { basename, dirname, FsError, joinPath, type CommandContext } from "../contracts/index.js";
import { yieldTurn } from "../contracts/yield.js";
import { codeOf } from "./internal.js";

export async function canonicalizeExistingParent(context: CommandContext, path: string): Promise<string> {
  try { return await context.fs.realpath(path, { signal: context.signal }); }
  catch (error) {
    context.signal.throwIfAborted();
    if (codeOf(error) !== "ENOENT") throw error;
  }
  const links = new Set<string>();
  while (true) {
    context.signal.throwIfAborted();
    if (links.size > 0 && links.size % 32 === 0) await yieldTurn(context.signal);
    // Resolve the parent physically before inspecting the last component. Missing
    // ancestors must still fail, even when a later '..' would remove them.
    const parent = await context.fs.realpath(dirname(path), { signal: context.signal });
    const candidate = joinPath(parent, basename(path));
    let stat;
    try { stat = await context.fs.lstat(candidate, { signal: context.signal }); }
    catch (error) {
      context.signal.throwIfAborted();
      if (codeOf(error) === "ENOENT") return candidate;
      throw error;
    }
    if (stat.type !== "symlink") return context.fs.realpath(path, { signal: context.signal });
    if (links.has(candidate)) throw new FsError("ELOOP", { path: candidate });
    links.add(candidate);
    const capabilities = await context.fs.capabilitiesFor?.(candidate, { signal: context.signal }) ?? context.fs.capabilities;
    context.signal.throwIfAborted();
    if (!context.fs.readlink || capabilities.readlink === false) throw new FsError("ENOTSUP", { syscall: "readlink", path: candidate });
    const target = await context.fs.readlink(candidate, { signal: context.signal });
    path = target.startsWith("/") ? target : `${parent}/${target}`;
  }
}
