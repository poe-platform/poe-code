import assert from "node:assert/strict";
import { test } from "node:test";
import { createMemoryFileSystem } from "@poe-code/safe-fs";
import { createCommandArguments, toByteSource } from "safe-bash-contracts";
import { command, evalSyncChecksum } from "./index.js";
test("portable engine preserves standard output bytes", async () => { let output = ""; const definition = command("sha256sum", "sha256", Infinity); const result = await definition.execute({ command: definition.name, args: [], cwd: "/", env: {}, fs: createMemoryFileSystem(), stdin: toByteSource(""), stdout: { async write(bytes) { output += new TextDecoder().decode(bytes); } }, stderr: { async write() {} }, signal: new AbortController().signal }); assert.equal(result.exitCode, 0); assert.equal(output, "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855  -\n"); });


test("file-backed sync evaluation defers when operands also require stdin", () => {
  const bytes = new TextEncoder().encode("hello\n");
  assert.equal(evalSyncChecksum("md5sum", bytes, ["-"], () => bytes, "f.txt"), undefined);
  assert.equal(evalSyncChecksum("cksum", bytes, ["-"], () => bytes, "f.txt"), undefined);
});

test("argument quota rejects without allocating byte copies", async () => {
  let guarded = false;
  const values = createCommandArguments(["é"], {
    assertOpen() {},
    reserve() {
      if (guarded) throw new Error("argument copied before admission");
      return { commit() {}, release() {} };
    }
  });
  guarded = true;
  let stderr = "";
  const result = await command("sha512sum", "sha512", Infinity, 1).execute({
    command: "sha512sum", args: values.args, argumentValues: values,
    cwd: "/", env: {}, fs: createMemoryFileSystem(), stdin: toByteSource(""),
    stdout: { async write() { assert.fail("unexpected checksum output"); } },
    stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } },
    signal: new AbortController().signal
  });
  assert.equal(result.exitCode, 1);
  assert.ok(stderr.includes("EFBIG"), stderr);
});
