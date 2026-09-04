import { Shell, browserCommands, createMemoryFileSystem, FsError } from "@poe-platform/safe-bash/browser";
import { FsError as CoreFsError } from "@poe-platform/safe-fs/core";
import { FsError as CompatibilityFsError } from "@poe-platform/safe-js/fs/core";

if (FsError !== CoreFsError) throw new Error("Browser filesystem identity diverged");
if (FsError !== CompatibilityFsError) throw new Error("Compatibility filesystem identity diverged");
const shell = new Shell({ fs: createMemoryFileSystem() }).use(browserCommands());
try {
  const result = await shell.exec("printf 'b\\na\\n' | sort");
  if (result.exitCode !== 0 || result.stdout !== "a\nb\n") throw new Error("Browser shell smoke failed");
  for (const [script, expected] of [
    ["printf 'a,b\\nc,d\\n' | cut -d , -f 2", "b\nd\n"],
    ["printf 'a\\tb\\tc\\n' | cut -f 1,3", "a\tc\n"],
    ["printf 'a,,c\\n,b,\\n' > /fields; cut -d , -f 2,3 /fields", ",c\nb,\n"],
  ]) {
    const output = await shell.exec(script);
    if (output.exitCode !== 0 || output.stderr !== "" || output.stdout !== expected) {
      throw new Error(`Browser cut smoke failed: ${script}: ${JSON.stringify(output)}`);
    }
  }
} finally { await shell.dispose(); }
