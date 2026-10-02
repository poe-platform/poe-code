export { posixPath as nativePath } from "@poe-code/safe-fs/runtime-core";
export function homedir(): string { throw new Error("Skills require an explicit homeDir in Workers."); }
