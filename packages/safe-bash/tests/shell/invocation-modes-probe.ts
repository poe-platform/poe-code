import assert from "node:assert/strict";
import { setTimeout as delay } from "node:timers/promises";
import type { ByteSource } from "../../src/contracts/index.js";
import { ShellLimitError } from "../../src/shell/index.js";
import { setup } from "./helpers.js";

const scenario = process.argv[2];
const { shell, fs, commands } = setup();
if (scenario?.startsWith("recursive-")) {
  let source: string;
  let stdin = "";
  if (scenario === "recursive-c") source = `export CODE='bash -c "$CODE"'; bash -c "$CODE"`;
  else if (scenario === "recursive-stdin") { source = "bash -s"; stdin = "bash -s\n".repeat(20); }
  else { source = "PATH=; tool"; await fs.writeFile("/tool", Buffer.from("#!/bin/bash\nPATH=; tool"), { mode: 0o755 }); }
  await assert.rejects(shell.exec(source, { stdin, limits: { maxSubstitutionDepth: 6 } }), error => error instanceof ShellLimitError && error.limit === "maxSubstitutionDepth");
} else if (scenario === "cancel-empty-chunks" || scenario === "cancel-incomplete-unit") {
  const controller = new AbortController();
  const reason = new Error("active streaming parser cancellation");
  let reads = 0;
  const stdin: ByteSource = { async *[Symbol.asyncIterator]() {
    if (scenario === "cancel-incomplete-unit") yield Buffer.from("if true; then\n");
    while (true) { reads++; yield scenario === "cancel-empty-chunks" ? new Uint8Array() : Buffer.from(":\n"); }
  } };
  const timer = setTimeout(() => controller.abort(reason), 20);
  try { await assert.rejects(shell.exec("bash -s", { stdin, signal: controller.signal }), error => error === reason); }
  finally { clearTimeout(timer); }
  assert.ok(reads > 0);
} else if (scenario === "source-limit") {
  const stdin: ByteSource = { async *[Symbol.asyncIterator]() { yield Buffer.from("#" + "x".repeat(100000)); throw new Error("must not drain beyond ceiling"); } };
  await assert.rejects(shell.exec("bash -s", { stdin, limits: { maxSourceBytes: 40 } }), error => error instanceof ShellLimitError && error.limit === "maxSourceBytes");
} else if (scenario === "output-limit") {
  await assert.rejects(shell.exec("bash -s", { stdin: "bytes | pass\n", limits: { maxOutputBytes: 2, pipeHighWaterMark: 1 } }), error => error instanceof ShellLimitError && error.limit === "maxOutputBytes");
} else if (scenario === "syntax-without-eof") {
  let reads = 0;
  const stdin: ByteSource = { [Symbol.asyncIterator]() { return { async next() { reads++; if (reads === 1) return { done: false, value: Buffer.from(")\n") }; throw new Error("fatal syntax must not await EOF"); }, async return() { return { done: true, value: undefined }; } }; } };
  const result = await shell.exec("bash -s", { stdin });
  assert.equal(result.exitCode, 2, result.stderr);
  assert.equal(reads, 1);
} else {
  const controller = new AbortController();
  const reason = Object.assign(new Error("invocation caller abort"), { code: "ENOENT" });
  let entered = false;
  const block = async (signal: AbortSignal): Promise<never> => {
    entered = true;
    setTimeout(() => controller.abort(reason), 15);
    if (scenario === "late-source") { await delay(40); throw new Error("late source rejection"); }
    return new Promise<never>((_resolve, reject) => signal.addEventListener("abort", () => reject(signal.reason), { once: true }));
  };
  let source = "bash -s";
  let reads = 0;
  const stdin: ByteSource = { [Symbol.asyncIterator]() { return {
    async next() {
      reads++;
      if (scenario === "cancel-drain" && reads === 1) return { value: Buffer.from("pass\n"), done: false };
      if (scenario === "cancel-command" && reads === 1) return { value: Buffer.from("block\n"), done: false };
      return block(controller.signal);
    },
    async return() { return { done: true, value: undefined }; },
  }; } };
  if (scenario === "cancel-lookup") { source = "PATH=/blocked; tool"; fs.stat = async (_path, options) => { assert.ok(options?.signal); return block(options.signal); }; }
  else if (scenario === "cancel-command") commands.register({ name: "block", execute: async context => block(context.signal) });
  else assert.ok(["cancel-source", "cancel-drain", "late-source"].includes(scenario ?? ""));
  await assert.rejects(shell.exec(source, { stdin, signal: controller.signal }), error => error === reason);
  assert.equal(entered, true);
  await delay(65);
}
console.log(`${scenario}: passed`);
