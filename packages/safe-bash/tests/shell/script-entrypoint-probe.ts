import assert from "node:assert/strict";
import { setTimeout as delay } from "node:timers/promises";
import { ShellLimitError } from "../../src/shell/index.js";
import { setup } from "./helpers.js";

const scenario = process.argv[2];
const { shell, fs, commands } = setup();
const controller = new AbortController();
const reason = Object.assign(new Error("script caller abort"), { code: "ENOENT" });
await fs.writeFile("/program", new TextEncoder().encode("#!/bin/bash\nblock"), { mode: 0o755 });

if (scenario === "recursion") {
  await fs.writeFile("/program", new TextEncoder().encode("#!/bin/bash\n./program"));
  await assert.rejects(shell.exec("./program", { limits: { maxSubstitutionDepth: 8 } }), (error) => error instanceof ShellLimitError && error.limit === "maxSubstitutionDepth");
} else if (scenario === "output-limit") {
  await fs.writeFile("/program", new TextEncoder().encode("#!/bin/bash\nbytes | pass"));
  await assert.rejects(shell.exec("./program", { limits: { maxOutputBytes: 2, pipeHighWaterMark: 1 } }), (error) => error instanceof ShellLimitError && error.limit === "maxOutputBytes");
} else if (scenario === "source-limit") {
  const readFile = fs.readFile.bind(fs);
  fs.readFile = async (path, options) => {
    assert.ok(options?.signal);
    assert.equal(options.maxBytes, 21);
    await readFile(path);
    return new Uint8Array(100);
  };
  await assert.rejects(shell.exec("./program", { limits: { maxSourceBytes: 30 } }), (error) => error instanceof ShellLimitError && error.limit === "maxSourceBytes");
} else {
  let entered = false;
  const block = async (signal: AbortSignal | undefined): Promise<never> => {
    assert.ok(signal);
    entered = true;
    const timer = setTimeout(() => controller.abort(reason), 15);
    try {
      if (scenario === "late-rejection") {
        await delay(40);
        throw new Error("late VFS read rejection");
      }
      return await new Promise<never>((_resolve, reject) => signal.addEventListener("abort", () => reject(signal.reason), { once: true }));
    } finally { clearTimeout(timer); }
  };
  if (scenario === "cancel-stat") fs.stat = async (_path, options) => block(options?.signal);
  else if (scenario === "cancel-read" || scenario === "late-rejection") fs.readFile = async (_path, options) => block(options?.signal);
  else if (scenario === "cancel-command") commands.register({ name: "block", execute: async (context) => block(context.signal) });
  else throw new Error(`Unknown scenario: ${scenario}`);
  await assert.rejects(shell.exec("./program", { signal: controller.signal }), (error) => error === reason);
  assert.equal(entered, true);
  await delay(60);
}
console.log(`${scenario}: passed`);
