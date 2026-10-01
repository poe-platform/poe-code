import { createRequire } from "node:module";
import { spawn } from "node:child_process";
import { callNative, protect } from "./host-errors.js";

const native = createRequire(import.meta.url)("./toolcraft-rust.node");
const operations = {
  undefined: () => undefined,
  defaultBin: () => ({ execPath: process.execPath, entryArgs: [process.argv[1]] }),
  defaultSpawn: () => spawn,
  spawnChild: (fn, execPath, entryArgs, approvalId) => fn(execPath, [...entryArgs, "approvals", "run", approvalId], {
    detached: true, stdio: "ignore", env: process.env, cwd: process.cwd()
  }),
  unref: child => child.unref(),
  invalidOperation() { throw new TypeError("Invalid approval spawn operation"); }
};
const host = { operate: protect((name, args) => operations[name](...args)), get: protect((value, key) => value[key]) };

export function spawnApprovalRunner(approvalId, runtimeOptions, spawnFn) {
  return callNative(native.approvalGatePolicy, "spawn", [approvalId, runtimeOptions, spawnFn], host);
}
export default spawnApprovalRunner;
