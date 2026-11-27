import assert from "node:assert/strict";
import test from "node:test";
import { createMemoryFileSystem } from "@poe-code/safe-fs";
import { toByteSource } from "safe-bash-contracts";
import { createGrepCommands } from "./index.js";

async function run(args: string[], bytes: Uint8Array) {
  const fs = createMemoryFileSystem();
  await fs.mkdir("/work");
  await fs.writeFile("/work/bin", bytes);
  await fs.writeFile("/work/t", new TextEncoder().encode("a1\n"));
  let stdout = "", stderr = "";
  const result = await createGrepCommands()[0]!.execute({
    command: "grep", args, cwd: "/work", env: {}, fs,
    stdin: toByteSource(bytes), signal: new AbortController().signal,
    stdout: { async write(chunk) { stdout += new TextDecoder().decode(chunk); } },
    stderr: { async write(chunk) { stderr += new TextDecoder().decode(chunk); } },
  });
  return { ...result, stdout, stderr };
}

for (const bytes of [Uint8Array.of(255, 254, 97, 10), Uint8Array.of(97, 0, 98, 10)]) {
  test(`recursive grep continues past binary byte ${bytes[1]}`, async () => {
    assert.deepEqual(await run(["-r", "a[0-9]", "."], bytes), {
      exitCode: 0, stdout: "./t:a1\n", stderr: "",
    });
  });
  test(`grep counts absent matches in binary byte ${bytes[1]}`, async () => {
    assert.deepEqual(await run(["-c", "z", "bin"], bytes), {
      exitCode: 1, stdout: "0\n", stderr: "",
    });
    assert.deepEqual(await run(["-c", "z[0-9]", "bin"], bytes), {
      exitCode: 1, stdout: "0\n", stderr: "",
    });
  });
  for (const args of [["z", "bin"], ["z"], ["--binary-files=binary", "z[0-9]", "bin"], ["-I", "z[0-9]", "bin"]]) {
    test(`grep ${args.join(" ")} skips unsupported binary byte ${bytes[1]}`, async () => {
      assert.deepEqual(await run(args, bytes), { exitCode: 1, stdout: "", stderr: "" });
    });
  }
}

test("recursive grep still reports invalid patterns", async () => {
  const result = await run(["-r", "[", "."], Uint8Array.of(255, 10));
  assert.equal(result.exitCode, 2);
  assert.notEqual(result.stderr, "");
});
