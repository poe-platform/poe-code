import { createHostFileSystem } from "@poe-code/safe-fs/node";
export { homedir } from "node:os";
let provider: ReturnType<typeof createHostFileSystem> | undefined;
export function defaultFileSystem() { return provider ??= createHostFileSystem(); }
