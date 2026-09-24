import { dirname, FsError, type ByteSource, type CommandContext, type FileStat, type FileSystem } from "../../contracts/index.js";
import { writeFileOutput } from "../../contracts/filesystem-output.js";
import { compareCopyIdentity } from "../copy-identity.js";
import { Budget, bytes, virtualPath } from "./shared.js";

interface Target {
  readonly path: string;
  readonly parent: FileStat;
  readonly original: FileStat;
  readonly backup: FileStat | null;
  readonly fs: FileSystem;
}

export async function prepareInPlace(context: CommandContext, files: readonly string[], suffix: string): Promise<Target[]> {
  const fs = context.fs;
  if (!fs.confineExtraction || !fs.writeFileConditional || !fs.openReadFile) {
    throw new FsError("ENOTSUP", { message: "in-place editing requires retained ancestry, retained reads and atomic conditional writes" });
  }
  const targets = [];
  for (const file of files) {
    // Retained views reject symlink ancestry and dot-dot traversal. Remove only
    // redundant separators and '.' so ordinary './file' operands still work.
    const operand = virtualPath(context, file);
    const path = "/" + operand.split("/").filter(part => part && part !== ".").join("/");
    const capabilities = await fs.capabilitiesFor?.(path, { signal: context.signal }) ?? fs.capabilities;
    if (capabilities.atomicFileMutation !== true || capabilities.retainedRead !== true) {
      throw new FsError("ENOTSUP", { path, message: "in-place editing requires retained reads and atomic conditional writes" });
    }
    const parent = await fs.lstat(dirname(path), { signal: context.signal });
    const original = await fs.lstat(operand, { signal: context.signal });
    if (parent.type !== "directory" || original.type !== "file") throw new FsError("ENOTSUP", { path, message: "in-place editing requires regular files and directory parents" });
    let backup: FileStat | null = null;
    if (suffix) {
      try { backup = await fs.lstat(path + suffix, { signal: context.signal }); }
      catch (error) { if (!(error instanceof FsError) || error.code !== "ENOENT") throw error; }
      if (backup && backup.type !== "file") throw new FsError("ENOTSUP", { path: path + suffix, message: "in-place backups require regular files" });
      if (backup && compareCopyIdentity(original, backup) === "same") throw new FsError("EINVAL", { path, message: "backup aliases the edited file" });
    }
    targets.push({ path, parent, original, backup });
  }
  const view = await fs.confineExtraction([...new Set(targets.map(target => dirname(target.path)))], { signal: context.signal });
  if (!view.writeFileConditional) throw new FsError("ENOTSUP", { message: "in-place editing requires atomic conditional writes" });
  return targets.map(target => ({ ...target, fs: view }));
}

export async function editInPlace<Result>(context: CommandContext, target: Target, suffix: string, budget: Budget,
  run: (input: ByteSource) => Promise<{ readonly data: Uint8Array; readonly result: Result }>): Promise<Result> {
  const reader = await context.fs.openReadFile!(target.path, { signal: context.signal });
  let closing: Promise<void> | undefined;
  const close = () => closing ??= reader.close();
  try {
    context.registerCleanup?.(close);
    const identity = compareCopyIdentity(target.original, await reader.stat({ signal: context.signal }));
    if (identity !== "same") throw new FsError(identity === "unknown" ? "ENOTSUP" : "EAGAIN", { path: target.path, message: "in-place reader does not match the inspected file" });
    const source = async function* (): ByteSource {
      let position = 0;
      while (true) {
        const chunk = await reader.read(position, 64 * 1024, { signal: context.signal });
        if (!chunk.byteLength) return;
        position += chunk.byteLength;
        yield chunk;
      }
    };
    const { data, result } = await run(source());
    if (suffix) {
      let original = "";
      for await (const chunk of source()) {
        budget.step();
        original = budget.check(original + Buffer.from(chunk).toString("latin1"));
        await budget.checkpoint();
      }
      // Backups preserve the existing copy semantics: only rewritten output
      // consumes the Shell output budget. The text buffer budget still applies.
      context.signal.throwIfAborted();
      await target.fs.writeFileConditional!(target.path + suffix, bytes(original), { parent: target.parent, expected: target.backup, signal: context.signal });
      context.signal.throwIfAborted();
    }
    await writeFileOutput(context, data, async chunk => {
      await target.fs.writeFileConditional!(target.path, chunk, { parent: target.parent, expected: target.original, signal: context.signal });
    });
    return result;
  } finally { await close(); }
}
