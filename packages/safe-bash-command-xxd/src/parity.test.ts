import assert from "node:assert/strict";
import test from "node:test";
import { execFileSync } from "node:child_process";
import { createMemoryFileSystem } from "@poe-code/safe-fs";
import { createCommandArguments, toByteSource } from "safe-bash-contracts";
import { createXxdCommand } from "./index.js";

async function run(args: string[], input: string | Uint8Array = "", fs = createMemoryFileSystem()) {
  const values = createCommandArguments(args);
  const chunks: Uint8Array[] = [];
  let stderr = "";
  const result = await createXxdCommand().execute({
    command: "xxd", args: values.args, argumentValues: values, cwd: "/", env: {}, fs,
    stdin: toByteSource(input), signal: new AbortController().signal,
    stdout: { async write(bytes) { chunks.push(bytes.slice()); } },
    stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } },
  });
  const bytes = Buffer.concat(chunks);
  return { ...result, bytes, stdout: bytes.toString(), stderr };
}

test("seek past EOF succeeds with empty output", async () => {
  const fs = createMemoryFileSystem();
  await fs.writeFile("/data", Buffer.from("abc"));
  const result = await run(["-s", "100", "/data"], "", fs);
  assert.equal(result.exitCode, 0, result.stderr);
  assert.equal(result.stdout, "");
});

test("negative file seeks use EOF and preserve addresses", async () => {
  const fs = createMemoryFileSystem();
  await fs.writeFile("/data", Buffer.from("abcdef"));
  for (const seek of ["-2", "+-2"]) {
    const result = await run(["-s", seek, "/data"], "", fs);
    assert.equal(result.exitCode, 0, result.stderr);
    assert.equal(result.stdout, "00000004: 6566                                     ef\n");
  }
  assert.equal((await run(["-s", "-7", "/data"], "", fs)).exitCode, 4);
});

test("autoskip collapses zero runs, preserves final line, and toggles", async () => {
  const input = new Uint8Array(80);
  for (const flag of ["-a", "-autoskip"]) {
    const result = await run([flag], input);
    assert.equal(result.exitCode, 0, result.stderr);
    assert.equal(result.stdout, "00000000: 0000 0000 0000 0000 0000 0000 0000 0000  ................\n*\n00000040: 0000 0000 0000 0000 0000 0000 0000 0000  ................\n");
    const reversed = await run(["-r"], result.stdout);
    assert.equal(reversed.exitCode, 0, reversed.stderr);
    assert.deepEqual(reversed.bytes, Buffer.from(input));
  }
  for (const args of [["-a", "-a"], ["-a", "-autoskip"], ["-autoskip", "-autoskip"], ["-a", "-a", "-a"]]) {
    const result = await run(args, input);
    assert.equal(result.exitCode, 0, result.stderr);
    assert.equal(result.stdout, execFileSync("/usr/bin/xxd", args, { input }).toString());
  }
});

test("capitalize affects include identifiers and length suffix only", async () => {
  for (const flag of ["-C", "-capitalize"]) {
    const result = await run(["-i", flag, "-n", "a-b"], "z");
    assert.equal(result.exitCode, 0, result.stderr);
    assert.equal(result.stdout, "unsigned char A_B[] = {\n  0x7a\n};\nunsigned int A_B_LEN = 1;\n");
  }
});

test("reverse pads initial and interior sparse addresses", async () => {
  const result = await run(["-r"], "00000004: 4142  AB\n00000008: 43  C\n");
  assert.equal(result.exitCode, 0, result.stderr);
  assert.deepEqual(result.bytes, Buffer.from([0, 0, 0, 0, 65, 66, 0, 0, 67]));
});

test("file operands write forward and reversed bytes with empty stdout", async () => {
  const fs = createMemoryFileSystem();
  await fs.writeFile("/input", Buffer.from("AB"));
  const forward = await run(["-p", "/input", "/dump"], "", fs);
  assert.equal(forward.exitCode, 0, forward.stderr);
  assert.equal(forward.stdout, "");
  assert.equal(new TextDecoder().decode(await fs.readFile("/dump")), "4142\n");
  const reverse = await run(["-r", "-p", "/dump", "/output"], "", fs);
  assert.equal(reverse.exitCode, 0, reverse.stderr);
  assert.equal(reverse.stdout, "");
  assert.equal(new TextDecoder().decode(await fs.readFile("/output")), "AB");
});
