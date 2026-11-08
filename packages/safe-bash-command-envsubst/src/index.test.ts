import assert from "node:assert/strict";
import test from "node:test";
import { createMemoryFileSystem } from "@poe-code/safe-fs";
import { createBytePipe, createCommandArguments, writeText } from "safe-bash-contracts";
import { createEnvsubstCommand } from "./index.js";

async function runEnvsubst(args: string[], input: string, env: Record<string, string>) {
  const stdinPipe = createBytePipe();
  await writeText(stdinPipe.writable, input);
  await stdinPipe.close();
  const stdoutPipe = createBytePipe();
  const stderrPipe = createBytePipe();
  const cmd = createEnvsubstCommand();
  const res = await cmd.execute({
    command: "envsubst",
    args: createCommandArguments(args).args,
    cwd: "/",
    env,
    fs: createMemoryFileSystem(),
    stdin: stdinPipe.readable,
    stdout: stdoutPipe.writable,
    stderr: stderrPipe.writable,
    signal: new AbortController().signal,
  });
  await stdoutPipe.close();
  await stderrPipe.close();
  const chunks: Uint8Array[] = [];
  for await (const c of stdoutPipe.readable) chunks.push(c);
  return { exitCode: res.exitCode, stdout: Buffer.concat(chunks).toString("utf8") };
}

test("envsubst substitutes variables, restricts via SHELL-FORMAT, and supports -v", async () => {
  const r1 = await runEnvsubst([], "Hello $USER, ${GREETING} ($1 $${NONE:-x})!\n", { USER: "alice", GREETING: "welcome" });
  assert.equal(r1.exitCode, 0);
  assert.equal(r1.stdout, "Hello alice, welcome ($1 $${NONE:-x})!\n");

  const r2 = await runEnvsubst(["$USER"], "Hello $USER, ${GREETING}!\n", { USER: "alice", GREETING: "welcome" });
  assert.equal(r2.stdout, "Hello alice, ${GREETING}!\n");

  const r3 = await runEnvsubst(["-v", "$FOO and ${BAR} and $FOO"], "", {});
  assert.equal(r3.stdout, "FOO\nBAR\nFOO\n");
});
