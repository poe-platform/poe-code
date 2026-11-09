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

for (const args of [["-"], ["--", "-"], ["-v", "-"], ["--variables", "-"], ["-v", "--", "-"]]) {
  test(`envsubst ${args.join(" ")} treats a lone dash as a format operand`, async () => {
    const result = await runEnvsubst(args, "$A", { A: "blue" });
    assert.equal(result.exitCode, 0);
    assert.equal(result.stdout, args.includes("-v") || args.includes("--variables") ? "" : "$A");
  });
}

for (const option of ["-x", "--invalid"]) {
  test(`envsubst still rejects ${option}`, async () => {
    const result = await runEnvsubst([option], "$A", { A: "blue" });
    assert.equal(result.exitCode, 1);
    assert.equal(result.stdout, "");
  });
}

// GNU gettext-runtime 0.21: version wins over help; unknown letters still fail.
for (const [args, equivalent] of [
  [["-vv", "$A ${B} $A"], ["-v", "-v", "$A ${B} $A"]],
  [["-vvv", "$A"], ["-v", "$A"]],
  [["-vh"], ["--help"]],
  [["-hV"], ["--version"]],
  [["-Vh"], ["--version"]],
  [["-vVh"], ["--version"]],
  [["-h", "-V"], ["--version"]],
  [["-vv", "--", "-$A"], ["-v", "--", "-$A"]],
  [["--", "-vv"], ["--", "-vv"]],
]) {
  test(`envsubst grouped options: ${args!.join(" ")}`, async () => {
    const expected = await runEnvsubst(equivalent!, "input $A", { A: "value" });
    assert.equal(expected.exitCode, 0);
    assert.deepEqual(await runEnvsubst(args!, "input $A", { A: "value" }), expected);
  });
}

for (const option of ["-vx", "-xv", "-hx", "-Vx", "-xV", "-vhx"]) {
  test(`envsubst rejects unknown letters in ${option}`, async () => {
    assert.deepEqual(await runEnvsubst([option, "$A"], "", {}), { exitCode: 1, stdout: "" });
  });
}
