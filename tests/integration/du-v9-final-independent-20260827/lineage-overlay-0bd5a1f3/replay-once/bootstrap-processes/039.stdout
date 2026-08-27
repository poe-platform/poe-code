import { spawn } from "node:child_process";

if (process.argv[2] !== "grandchild") throw new Error("usage: node process-timeout-control.mjs grandchild");
const grandchild = spawn(process.execPath, [
  "-e",
  "process.on('SIGTERM', () => {}); setInterval(() => {}, 1000)",
], { detached: false, stdio: "ignore" });
if (!Number.isSafeInteger(grandchild.pid) || grandchild.pid < 1) throw new Error("control grandchild has no pid");
process.stdout.write(`${JSON.stringify({ controlPid: process.pid, grandchildPid: grandchild.pid })}\n`);
setInterval(() => {}, 1_000);
