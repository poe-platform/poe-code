import { createHostFileSystem } from "@poe-code/safe-fs/node";
export { homedir } from "node:os";
export { default as path } from "node:path";
let provider: ReturnType<typeof createHostFileSystem> | undefined;
export function defaultFileSystem() { return provider ??= createHostFileSystem(); }
