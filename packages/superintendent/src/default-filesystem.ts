export { createHostFileSystem as createDefaultFileSystem } from "@poe-code/safe-fs/node";
export function defaultCwd(): string { return process.cwd(); }
export function defaultHome(): string { return process.env.HOME ?? process.env.USERPROFILE ?? process.cwd(); }
