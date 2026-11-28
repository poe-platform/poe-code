import assert from "node:assert/strict";
import test from "node:test";
import { gzipSync } from "node:zlib";
import { createMemoryFileSystem } from "@poe-code/safe-fs";
import { createCommandArguments, toByteSource } from "safe-bash-contracts";
import { createZcmpCommand } from "./index.js";

for (const maxDecodedBytes of [100, 2]) test(`zcmp reads gzip files with a ${maxDecodedBytes} byte budget`, async () => {
  const fs = createMemoryFileSystem();
  const compressed = gzipSync("hi\n");
  await fs.writeFile("/a.gz", compressed);
  await fs.writeFile("/a", new TextEncoder().encode("hi\n"));
  const args = createCommandArguments(["a.gz", "a"]);
  let stdout = "", stderr = "";
  const result = await createZcmpCommand({ maxDecodedBytes }).execute({
    command: "zcmp", args: args.args, argumentValues: args, fs, cwd: "/", env: {},
    stdin: toByteSource(""), signal: new AbortController().signal,
    stdout: { async write(bytes) { stdout += new TextDecoder().decode(bytes); } },
    stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } },
  });
  if (maxDecodedBytes === 100) {
    assert.equal(result.exitCode, 0, stderr);
    assert.equal(stdout, "");
    assert.equal(stderr, "");
  } else {
    assert.equal(result.exitCode, 2, stderr);
    assert.match(stderr, /decompression decoded byte limit exceeded/);
  }
  assert.deepEqual(await fs.readFile("/a.gz"), new Uint8Array(compressed));
});
