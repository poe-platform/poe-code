import { execFileSync } from "node:child_process";

export function runNpm(args, options = {}) {
  const npmExecPath = (options.env ?? process.env).npm_execpath;
  return execFileSync(
    npmExecPath ? process.execPath : "npm",
    npmExecPath ? [npmExecPath, ...args] : args,
    options
  );
}
