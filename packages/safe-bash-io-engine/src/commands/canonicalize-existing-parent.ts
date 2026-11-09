import { dirname, FsError, joinPath, type CommandContext } from "safe-bash-contracts";
import { yieldTurn } from "safe-bash-contracts/yield";
import { codeOf } from "safe-bash-io-engine/internal";

export async function canonicalizeExistingParent(context: CommandContext, path: string, requireFinal = false): Promise<string> {
  try { return await context.fs.realpath(path, { signal: context.signal }); }
  catch (error) {
    context.signal.throwIfAborted();
    if (codeOf(error) !== "ELOOP" && (requireFinal || codeOf(error) !== "ENOENT")) throw error;
  }
  // Walk components ourselves: filesystem realpath limits link traversals, while
  // GNU canonicalization permits arbitrarily long chains that are not cycles.
  const pending: (string | { readonly link: string })[] = path.split("/").reverse();
  const expanding = new Set<string>();
  let remaining = pending.length;
  let resolved = "/";
  let steps = 0;
  while (pending.length > 0) {
    context.signal.throwIfAborted();
    if (++steps % 32 === 0) await yieldTurn(context.signal);
    const component = pending.pop()!;
    if (typeof component !== "string") { expanding.delete(component.link); continue; }
    remaining--;
    if (component === "" || component === ".") continue;
    if (component === "..") { resolved = dirname(resolved); continue; }
    const candidate = joinPath(resolved, component);
    let stat;
    try { stat = await context.fs.lstat(candidate, { signal: context.signal }); }
    catch (error) {
      context.signal.throwIfAborted();
      if (!requireFinal && codeOf(error) === "ENOENT" && !pending.some(part => typeof part === "string" && part !== "")) return candidate;
      throw error;
    }
    if (stat.type !== "symlink") {
      if (remaining > 0 && stat.type !== "directory") throw new FsError("ENOTDIR", { path: candidate });
      resolved = candidate;
      continue;
    }
    if (expanding.has(candidate)) throw new FsError("ELOOP", { path: candidate });
    const capabilities = await context.fs.capabilitiesFor?.(candidate, { signal: context.signal }) ?? context.fs.capabilities;
    context.signal.throwIfAborted();
    if (!context.fs.readlink || capabilities.readlink === false) throw new FsError("ENOTSUP", { syscall: "readlink", path: candidate });
    const target = await context.fs.readlink(candidate, { signal: context.signal });
    expanding.add(candidate);
    pending.push({ link: candidate });
    const components = target.split("/");
    remaining += components.length;
    for (let index = components.length - 1; index >= 0; index--) pending.push(components[index]!);
    if (target.startsWith("/")) resolved = "/";
  }
  return resolved;
}
