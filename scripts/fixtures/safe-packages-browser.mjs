import { Shell, browserCommands, createMemoryFileSystem, FsError } from "@poe-platform/safe-bash/browser";
import { FsError as CoreFsError } from "@poe-platform/safe-fs/core";
import { FsError as CompatibilityFsError } from "@poe-platform/safe-js/fs/core";

if (FsError !== CoreFsError) throw new Error("Browser filesystem identity diverged");
if (FsError !== CompatibilityFsError) throw new Error("Compatibility filesystem identity diverged");
const shell = new Shell({ fs: createMemoryFileSystem() }).use(browserCommands());
try {
  const result = await shell.exec("printf 'b\\na\\n' | sort");
  if (result.exitCode !== 0 || result.stdout !== "a\nb\n") throw new Error("Browser shell smoke failed");
} finally { await shell.dispose(); }
