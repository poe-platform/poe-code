import assert from "node:assert/strict";
import { test } from "node:test";
import { createMemoryFileSystem } from "@poe-code/safe-fs";
import { createCommandArguments, toByteSource } from "safe-bash-contracts";
import { createGrepCommands } from "./index.js";

test("grep help works through the standalone portable factory", async () => {
 const values = createCommandArguments(["--help"]);
 let output = "";
 const result = await createGrepCommands()[0]!.execute({
  command: "grep", args: values.args, argumentValues: values, cwd: "/", env: {},
  fs: createMemoryFileSystem(), stdin: toByteSource(""),
  stdout: { async write(bytes) { output += new TextDecoder().decode(bytes); } },
  stderr: { async write(bytes) { output += new TextDecoder().decode(bytes); } },
  signal: new AbortController().signal,
 });
 assert.equal(result.exitCode, 0, output);
 assert.ok(output.length > 0);
});

test("grep reads each tenant's batched input without a global Buffer", async () => {
  const filesystems = await Promise.all(["first", "other"].map(async tenant => {
    const fs = createMemoryFileSystem();
    await fs.writeFile("/input", new TextEncoder().encode(`${tenant} line\n`.repeat(40)));
    return fs;
  }));
  const originalBuffer = globalThis.Buffer;
  Object.defineProperty(globalThis, "Buffer", { value: undefined, configurable: true, writable: true });
  try {
    const command = createGrepCommands()[0]!;
    for (const fs of [filesystems[0]!, filesystems[1]!, filesystems[0]!]) {
      const values = createCommandArguments(["^first", "/input"]);
      let stdout = "", stderr = "";
      const result = await command.execute({
        command: "grep", args: values.args, argumentValues: values, cwd: "/", env: {},
        fs, stdin: toByteSource(""),
        stdout: { async write(bytes) { stdout += new TextDecoder().decode(bytes); } },
        stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } },
        signal: new AbortController().signal,
      });
      const matches = fs === filesystems[0];
      assert.equal(result.exitCode, matches ? 0 : 1, stderr);
      assert.equal(stdout, matches ? "first line\n".repeat(40) : "");
    }
  } finally {
    Object.defineProperty(globalThis, "Buffer", { value: originalBuffer, configurable: true, writable: true });
  }
});

for (const flags of [["-n"], ["-n", "--line-buffered"]]) {
  test(`concurrent grep isolates large numbered batches (${flags.join(" ")})`, async () => {
    const command = createGrepCommands()[0]!;
    await Promise.all(["A", "B"].map(async tenant => {
      const fs = createMemoryFileSystem();
      const lines = Array.from({ length: 200 }, (_, i) => `TENANT_${tenant}_${i}_${tenant.repeat(600)}`);
      await fs.writeFile("/input", new TextEncoder().encode(lines.join("\n") + "\n"));
      let stdout = "", stderr = "";
      const values = createCommandArguments([...flags, "TENANT_", "/input"]);
      const result = await command.execute({
        command: "grep", args: values.args, argumentValues: values, cwd: "/", env: {}, fs,
        stdin: toByteSource(""), signal: new AbortController().signal,
        stdout: { async write(bytes) { await Promise.resolve(); stdout += new TextDecoder().decode(bytes); } },
        stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } },
      });
      assert.equal(result.exitCode, 0, stderr);
      assert.equal(stderr, "");
      assert.equal(stdout, lines.map((line, i) => `${i + 1}:${line}\n`).join(""));
    }));
  });
}
