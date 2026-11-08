import { spawn } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";

const [outputPrefix, command, ...args] = process.argv.slice(2);
if (!outputPrefix || !command) throw new Error("usage: node capture-command.mjs OUTPUT_PREFIX COMMAND [ARG...]");
const prefix = resolve(outputPrefix);
await mkdir(dirname(prefix), { recursive: true });
const result = await new Promise((resolvePromise, rejectPromise) => {
  const child = spawn(command, args, { stdio: ["ignore", "pipe", "pipe"] });
  const stdout = [];
  const stderr = [];
  child.stdout.on("data", chunk => stdout.push(Buffer.from(chunk)));
  child.stderr.on("data", chunk => stderr.push(Buffer.from(chunk)));
  child.on("error", rejectPromise);
  child.on("close", (status, signal) => resolvePromise({ status, signal, stdout: Buffer.concat(stdout), stderr: Buffer.concat(stderr) }));
});
await writeFile(`${prefix}.stdout`, result.stdout);
await writeFile(`${prefix}.stderr`, result.stderr);
await writeFile(`${prefix}.status.json`, `${JSON.stringify({ command, args, status: result.status, signal: result.signal }, null, 2)}\n`);
process.stdout.write(`${JSON.stringify({ prefix, status: result.status, stdoutBytes: result.stdout.byteLength, stderrBytes: result.stderr.byteLength })}\n`);
process.exitCode = result.status === 0 ? 0 : 1;
