import fs from "node:fs";
import path from "node:path";

// Native modules may already be mapped; replace rather than overwrite their inode.
export function copyNativeBinding(source, destination, fileSystem = fs) {
  const staging = fileSystem.mkdtempSync(path.join(path.dirname(destination), ".native-binding-"));
  try {
    const replacement = path.join(staging, path.basename(destination));
    fileSystem.copyFileSync(source, replacement);
    fileSystem.renameSync(replacement, destination);
  } finally {
    fileSystem.rmSync(staging, { recursive: true, force: true });
  }
}
