export { isAbsolutePath as isAbsolute } from "@poe-code/safe-fs/runtime-core";
export const spawnChildProcess: typeof import("node:child_process").spawn = () => {
  throw new Error("ACP requires an injected transport or process capability in Workers.");
};
