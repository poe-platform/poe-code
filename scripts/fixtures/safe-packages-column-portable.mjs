import { Shell, createMemoryFileSystem, standardCommands, createColumnCommand, FsError } from "@poe-platform/safe-bash";
import { columnCommands, createColumnCommand as subpathFactory } from "@poe-platform/safe-bash/commands/column";

import { FsError as contractError } from "@poe-platform/safe-bash/contracts";

export const verification = (async () => {
  if (createColumnCommand !== subpathFactory || FsError !== contractError) {
    throw new Error("Column public exports have different runtime identities");
  }
  const fs = createMemoryFileSystem();
  const shell = new Shell({ fs }).use(standardCommands()).use(columnCommands());
  try {
    await fs.writeFile("/input", new TextEncoder().encode("a 1\nlong 2\n"));
    await fs.writeFile("/run.sh", new TextEncoder().encode("cat /input | column -t"));
    for (const source of ["column -t /input", "cat /input | column -t", "sh /run.sh"]) {
      const result = await shell.exec(source);
      if (result.exitCode !== 0 || result.stdout !== "a     1\nlong  2\n" || result.stderr !== "") {
        throw new Error("Portable column execution failed: " + source);
      }
    }
    const controller = new AbortController(), reason = new Error("column cancellation");
    controller.abort(reason);
    try { await shell.exec("column -t /input", { signal: controller.signal }); }
    catch (error) { if (error === reason) return; throw error; }
    throw new Error("Column failed to preserve cancellation identity");
  } finally { await shell.dispose(); }
})();
