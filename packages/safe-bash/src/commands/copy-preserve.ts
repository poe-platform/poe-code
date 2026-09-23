import { FsError, type CommandContext, type FileStat } from "../contracts/index.js";
import type { copyOptions } from "./copy-backup.js";
import { admitFilesystemModes } from "./filesystem-requirements.js";

export type CopyAttribute = "mode" | "ownership" | "timestamps" | "links";

export type CopyOptions = ReturnType<typeof copyOptions> & {
  readonly confirmOverwrite?: (operand: string) => Promise<boolean>;
};

export async function admitCopyPreservation(
  context: CommandContext, preserve: ReadonlySet<CopyAttribute>, source: FileStat, target: string, existing?: FileStat,
): Promise<void> {
  const modes: string[] = [];
  if (preserve.has("mode") && source.type !== "symlink") {
    modes.push("mode");
    if (!context.fs.chmod) throw new FsError("ENOTSUP", { syscall: "chmod", path: target });
  }
  if (preserve.has("timestamps")) {
    modes.push("timestamps");
    // The filesystem contract has no no-follow timestamp mutation.
    if (!context.fs.utimes || source.type === "symlink") throw new FsError("ENOTSUP", { syscall: "utimes", path: target });
  }
  if (preserve.has("ownership")) {
    if (source.uid === undefined || source.gid === undefined
      || existing && (existing.uid !== source.uid || existing.gid !== source.gid)) {
      throw new FsError("ENOTSUP", { syscall: "cp", path: target, message: "preserving ownership requires matching reported owners; ownership changes are unavailable" });
    }
  }
  if (modes.length) await admitFilesystemModes(context, "cp", modes, [target]);
}

export async function preserveCopyMetadata(
  context: CommandContext, preserve: ReadonlySet<CopyAttribute>, source: FileStat, target: string,
): Promise<void> {
  if (preserve.has("ownership")) {
    const copied = await context.fs.lstat(target, { signal: context.signal });
    // Content copies follow their destination; preserved links do not.
    const owner = source.type !== "symlink" && copied.type === "symlink"
      ? await context.fs.stat(target, { signal: context.signal }) : copied;
    if (owner.uid !== source.uid || owner.gid !== source.gid) {
      throw new FsError("ENOTSUP", { syscall: "cp", path: target, message: "ownership changes are unavailable" });
    }
  }
  if (preserve.has("mode") && source.type !== "symlink") {
    await context.fs.chmod!(target, source.mode & 0o7777, { signal: context.signal });
  }
  if (preserve.has("timestamps")) {
    await context.fs.utimes!(target, source.atimeMs, source.mtimeMs, { signal: context.signal });
  }
}
