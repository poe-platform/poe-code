import { randomBytes } from "node:crypto";
import { FsError, type FileStat } from "../../contracts/index.js";
import { writeFileOutputCounted } from "../../contracts/filesystem-output.js";
import { MikeError, type NativeWork } from "./native-work.js";

export async function publishInPlace(path: string, data: Uint8Array, original: FileStat, work: NativeWork): Promise<void> {
  const fs = work.context.fs;
  const parent = path.slice(0, path.lastIndexOf("/")) || "/";
  const temporary = `${parent === "/" ? "" : parent}/.yq-${randomBytes(12).toString("hex")}`;
  let created = false;
  const capabilities = fs.capabilitiesFor ? await work.track(fs.capabilitiesFor(parent, { signal: work.signal })) : fs.capabilities;
  work.assertOpen();
  if (!capabilities.write || !capabilities.exclusiveCreate || !capabilities.remove) throw new MikeError("in-place update requires VFS write, exclusive creation and removal capabilities");
  const outputContext = { signal: work.signal, ...(work.context.registerCleanup ? { registerCleanup: work.context.registerCleanup } : {}) };
  let settled!: () => void;
  const writerDone = new Promise<void>(resolve => { settled = resolve; });
  work.register(async () => {
    await writerDone;
    if (created) {
      try { await fs.rm(temporary); }
      catch (error) { if (!(error instanceof FsError) || error.code !== "ENOENT") throw error; }
    }
  });
  try {
    await work.track(writeFileOutputCounted(outputContext, data, async () => {
      await fs.writeFile(temporary, data, { flag: "wx", mode: original.mode & 0o7777, signal: work.signal });
      created = true;
      return data.byteLength;
    }));
  } finally { settled(); }
  work.assertOpen();
  if (fs.chmod && capabilities.permissions) { await work.track(fs.chmod(temporary, original.mode & 0o7777, { signal: work.signal })); work.assertOpen(); }
  const target = await work.track(fs.lstat(path, { signal: work.signal }));
  work.assertOpen();
  if (target.type !== "symlink" && capabilities.rename) {
    try { await work.track(fs.rename(temporary, path, { signal: work.signal })); created = false; work.assertOpen(); return; }
    catch (error) { work.assertOpen(); if (!(error instanceof FsError)) throw error; }
  }
  await work.track(writeFileOutputCounted(outputContext, data, async () => {
    await fs.writeFile(path, data, { flag: "w", signal: work.signal });
    return data.byteLength;
  }));
  work.assertOpen();
}
