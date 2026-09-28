import * as commands from "@poe-platform/safe-bash";
import { FsError, createMemoryFileSystem } from "@poe-platform/safe-fs/core";
import { FsError as ContractFsError } from "@poe-platform/safe-bash/contracts";

if (commands.FsError !== FsError || ContractFsError !== FsError) throw new Error("Packed filesystem error identity diverged");
const fs = createMemoryFileSystem();
await fs.mkdir("/work");
await fs.writeFile("/work/file.ts", new Uint8Array());
try {
  await fs.readFile("/work/.gitignore");
  throw new Error("Missing ignore file unexpectedly exists");
} catch (error) {
  if (!(error instanceof FsError) || error.code !== "ENOENT") throw error;
}
const shell = new commands.Shell({ fs, cwd: "/work" });
shell.commands.register(commands.createFdCommand(), { replace: true });
shell.commands.register(commands.createExiftoolCommand(), { replace: true });
try {
  const found = await shell.exec("fd");
  if (found.exitCode !== 0 || found.stdout !== "file.ts\n") throw new Error("FD failed with missing ignore files: " + found.stderr);
  const encoded = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAAC3RFWHRUaXRsZQBIZWxsb83PwM8AAAARdEVYdERlc2NyaXB0aW9uAFdvcmxkC2fZ1QAAAAxJREFUeJxj+M/AAAADAQEAyf6S7wAAAABJRU5ErkJggg==";
  const original = Uint8Array.from(atob(encoded), character => character.charCodeAt(0));
  await fs.writeFile("/work/image.png", original);
  const edited = await shell.exec("exiftool -Title=new image.png");
  if (edited.exitCode !== 0) throw new Error("ExifTool failed with missing backup: " + edited.stderr);
  const backup = await fs.readFile("/work/image.png_original");
  if (backup.length !== original.length || !backup.every((byte, index) => byte === original[index])) throw new Error("ExifTool backup differs from its input");
  const title = await shell.exec("exiftool -s3 -Title image.png");
  if (title.exitCode !== 0 || title.stdout !== "new\n") throw new Error("ExifTool metadata edit failed: " + title.stderr);
} finally {
  await shell.dispose();
}
