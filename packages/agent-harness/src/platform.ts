export { createHostFileSystem as createDefaultFileSystem } from "@poe-code/safe-fs/node";
export { default as hostEnvironment } from "node:os";
export { fileURLToPath } from "node:url";
export const cwd = (): string => process.cwd();
