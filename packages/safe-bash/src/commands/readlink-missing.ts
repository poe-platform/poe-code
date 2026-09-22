import { dirname, FsError, joinPath, type CommandContext } from "../contracts/index.js";
import { yieldTurn } from "../contracts/yield.js";
import { codeOf } from "./internal.js";

export async function canonicalizeReadlinkMissing(context: CommandContext, path: string): Promise<string> {
  const pending: (string | { readonly link: string })[] = path.split("/").reverse();
  const expanding = new Set<string>();
  let resolved = "/";
  let steps = 0;
  while (pending.length > 0) {
    context.signal.throwIfAborted();
    if (++steps % 32 === 0) await yieldTurn(context.signal);
    const component = pending.pop()!;
    if (typeof component !== "string") { expanding.delete(component.link); continue; }
    if (component === "" || component === ".") continue;
    if (component === "..") { resolved = dirname(resolved); continue; }
    const candidate = joinPath(resolved, component);
    let link: string | undefined;
    try {
      const stat = await context.fs.lstat(candidate, { signal: context.signal });
      if (stat.type === "symlink" && !expanding.has(candidate)) {
        const capabilities = await context.fs.capabilitiesFor?.(candidate, { signal: context.signal }) ?? context.fs.capabilities;
        if (!context.fs.readlink || capabilities.readlink === false) throw new FsError("ENOTSUP", { syscall: "readlink", path: candidate });
        link = await context.fs.readlink(candidate, { signal: context.signal });
      }
    } catch (error) {
      context.signal.throwIfAborted();
      if (codeOf(error) !== "ENOENT" && codeOf(error) !== "ENOTDIR" && codeOf(error) !== "ELOOP") throw error;
    }
    if (link === undefined) { resolved = candidate; continue; }
    expanding.add(candidate);
    pending.push({ link: candidate });
    const components = link.split("/");
    for (let index = components.length - 1; index >= 0; index--) pending.push(components[index]!);
    if (link.startsWith("/")) resolved = "/";
  }
  return resolved;
}
