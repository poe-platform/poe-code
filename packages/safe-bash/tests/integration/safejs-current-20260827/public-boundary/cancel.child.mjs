import assert from "node:assert/strict";
import { setTimeout as delay } from "node:timers/promises";
import { makeSafeJsFsModule, makeSafeJsShellModule } from "virtual-bash";
import { command, declareHostOperation, makeFsModule, memory, rejected, run } from "./helpers.mjs";

const mode = process.argv[2];
const fs = await memory();
const controller = new AbortController();
const reason = new Error(`public cancellation ${mode}`);
let calls = 0;
let inputCloses = 0;
function stop() {
  calls += 1;
  controller.abort(reason);
  return Promise.reject(new Error(`late rejection ${mode}`));
}
let error;
if (mode === "command-fs") {
  fs.readFile = () => stop();
  error = await rejected(command('import { readFile, writeFile } from "fs"; await readFile("pending", "utf8"); await writeFile("after", "wrong");', { fs, signal: controller.signal }));
} else if (mode === "command-stdin") {
  const stdin = { [Symbol.asyncIterator]() { return {
    next: () => stop(), async return() { inputCloses += 1; return { done: true, value: undefined }; },
  }; } };
  error = await rejected(command('import { readText } from "stdio"; import { writeFile } from "fs"; await readText(); await writeFile("after", "wrong");', { fs, signal: controller.signal, stdin }));
} else if (mode === "command-stdout" || mode === "command-console") {
  const first = mode === "command-console" ? 'console.log("first");' : 'import { write } from "stdio"; await write("first");';
  error = await rejected(command(`${first} import { writeFile } from "fs"; await writeFile("after", "wrong");`, {
    fs, signal: controller.signal, stdout: { write: () => stop() },
  }));
} else if (mode === "fs-module") {
  fs.readFile = () => stop();
  const module = makeSafeJsFsModule(makeFsModule, fs, { cwd: "/work", signal: controller.signal });
  error = await rejected(run('import { readFile, writeFile } from "fs"; await readFile("pending", "utf8"); await writeFile("after", "wrong");', {
    modules: { fs: module }, signal: controller.signal,
  }));
} else if (mode === "shell-module") {
  const shell = makeSafeJsShellModule(() => stop(), { fs, signal: controller.signal, replayPolicy: "read-side-effect", declareHostOperation });
  error = await rejected(run('import { exec } from "shell"; await exec("first"); await exec("after");', {
    modules: { shell }, signal: controller.signal,
  }));
} else throw new Error(`Unknown cancellation mode: ${mode}`);

assert.equal(calls, 1);
if (mode.startsWith("command-")) assert.equal(error, reason);
else assert.equal(error.message, reason.message);
assert.deepEqual(await fs.readdir("/work"), []);
await delay(40);
process.stdout.write(`${JSON.stringify({ mode, calls, inputCloses, exactReasonIdentity: error === reason,
  errorName: error.name, errorMessage: error.message, lateRejectionObserved: true, afterEffects: 0 })}\n`);
