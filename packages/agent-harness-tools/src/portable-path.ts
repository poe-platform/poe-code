import { posixPath } from "@poe-code/safe-fs/contracts";
export const path = {
  ...posixPath,
  resolve(...parts: string[]): string {
    return posixPath.resolve(globalThis.process?.cwd?.() ?? "/", ...parts);
  }
};
