import { dirname, FsError, type CommandContext } from "../contracts/index.js";
import { codeOf } from "./internal.js";

/** Resolve final symlinks while allowing their target to be created exclusively. */
export async function touchTarget(context: CommandContext, path: string): Promise<string> {
  for (let links = 0; ; links++) {
    context.signal.throwIfAborted();
    let stat;
    try { stat = await context.fs.lstat(path, { signal: context.signal }); }
    catch (error) {
      context.signal.throwIfAborted();
      if (codeOf(error) === "ENOENT") return path;
      throw error;
    }
    if (stat.type !== "symlink") return path;
    if (links === 40) throw new FsError("ELOOP", { syscall: "touch", path });
    const capabilities = await context.fs.capabilitiesFor?.(path, { signal: context.signal }) ?? context.fs.capabilities;
    if (!context.fs.readlink || capabilities.readlink === false) throw new FsError("ENOTSUP", { syscall: "readlink", path });
    const target = await context.fs.readlink(path, { signal: context.signal });
    path = target.startsWith("/") ? target : `${dirname(path)}/${target}`;
  }
}
