import assert from "node:assert/strict";
import test from "node:test";
import { MemoryFileSystem } from "@poe-code/safe-fs";
import { toByteSource } from "safe-bash-contracts";
import { RegexExecutor } from "safe-bash-regex-engine/execution/portable";
import { createBoundedRegexProvider } from "safe-bash-regex-engine/execution/bounded-provider";
import { createGrepCommands } from "./grep.js";

for (const [args, expected, code] of [
  [["-r", "a[0-9]", "."], "./t:a1\n", 0],
  [["-c", "z", "nul"], "0\n", 1],
  [["-c", "z[0-9]", "nul"], "0\n", 1],
  [["-I", "a[0-9]", "bin", "t"], "t:a1\n", 0],
  [["-ao", "a", "nul"], "a\n", 0],
  [["--binary-files=text", "-o", "a", "nul"], "a\n", 0],
  [["-E", "a[0-9]", "utf8"], "café a1 😀\n", 0],
] as const) test(`binary files do not abort grep ${args.join(" ")}`, async () => {
  const fs = new MemoryFileSystem();
  await fs.mkdir("/work");
  await fs.writeFile("/work/bin", Uint8Array.of(255, 254, 97, 10));
  await fs.writeFile("/work/t", Buffer.from("a1\n"));
  await fs.writeFile("/work/nul", Buffer.from("a\0b\n"));
  if (args.some(arg => arg === "utf8")) await fs.writeFile("/work/utf8", Buffer.from("café a1 😀\n"));
  const executor = new RegexExecutor(createBoundedRegexProvider());
  const stdout: Uint8Array[] = [], stderr: Uint8Array[] = [];
  try {
    const result = await createGrepCommands(executor)[0]!.execute({
      command: "grep", args, cwd: "/work", env: {}, fs,
      signal: new AbortController().signal, stdin: toByteSource(""),
      stdout: { async write(bytes) { stdout.push(bytes.slice()); } },
      stderr: { async write(bytes) { stderr.push(bytes.slice()); } },
    });
    assert.equal(Buffer.concat(stderr).toString(), "");
    assert.equal(result.exitCode, code);
    assert.equal(Buffer.concat(stdout).toString(), expected);
  } finally { await executor.dispose(); }
});
