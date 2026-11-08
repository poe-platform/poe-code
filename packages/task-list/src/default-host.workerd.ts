import type { FileSystem } from "@poe-code/safe-fs/contracts";
import type { Runner } from "@poe-code/process-runner";
export function createDefaultFileSystem(): FileSystem {
  throw new Error("Task lists require an injected filesystem in this runtime.");
}
export function createDefaultRunner(): Runner {
  throw new Error("GitHub authentication requires an explicit token or injected runner in this runtime.");
}
