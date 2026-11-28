import assert from "node:assert/strict";
import { test } from "node:test";
import { createMemoryFileSystem } from "@poe-code/safe-fs";
import { createCommandArguments, toByteSource } from "safe-bash-contracts";
import { command, evalSyncChecksum } from "./index.js";

for (const [algorithm, checksum] of [
  ["md5", "60b725f10c9c85c70d97880dfe8191b3"],
  ["sha256", "87428fc522803d31065e7bce3cf03fe475096631e5e07bbd7a0fde60c4cf25c7"],
] as const) {
  for (const separator of [" ", "  ", " *", "\t"]) {
    for (const manifest of ["sums", "-"]) {
      test(`${algorithm} verifies ${JSON.stringify(separator)} separated checksums from ${manifest}`, async () => {
        const fs = createMemoryFileSystem();
        await fs.mkdir("/work");
        await fs.writeFile("/work/f", new TextEncoder().encode("a\n"));
        const contents = `${checksum}${separator}f\n`;
        if (manifest !== "-") await fs.writeFile("/work/sums", new TextEncoder().encode(contents));
        let stdout = "";
        let stderr = "";
        const definition = command(`${algorithm}sum`, algorithm, Infinity);
        const result = await definition.execute({
          command: definition.name, args: manifest === "-" ? ["-c"] : ["-c", manifest],
          cwd: "/work", env: {}, fs, stdin: toByteSource(manifest === "-" ? contents : ""),
          stdout: { async write(bytes) { stdout += new TextDecoder().decode(bytes); } },
          stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } },
          signal: new AbortController().signal,
        });
        assert.equal(stderr, "");
        assert.equal(result.exitCode, 0);
        assert.equal(stdout, "f: OK\n");
        assert.equal(evalSyncChecksum(
          definition.name, new TextEncoder().encode(contents), ["-c"],
          name => name === "f" ? new TextEncoder().encode("a\n") : undefined,
          manifest === "-" ? undefined : manifest,
        ), stdout);
      });
    }
  }
}

test("checksums report cumulative source bytes to the host input budget", async () => {
  const seen: number[] = [];
  const fs = createMemoryFileSystem();
  await fs.writeFile("/one", new TextEncoder().encode("ab"));
  await fs.writeFile("/two", new TextEncoder().encode("cd"));
  const result = await command("sha256sum", "sha256", Infinity).execute({
    command: "sha256sum", args: ["/one", "/two"], cwd: "/", env: {}, fs, stdin: toByteSource(""),
    stdout: { async write() {} }, stderr: { async write() {} }, signal: new AbortController().signal,
    inputBudget: { maxBytes: 3, check(total) { seen.push(total); if (total > 3) throw new Error("host limit"); } },
  });
  assert.equal(result.exitCode, 1);
  assert.deepEqual(seen, [2, 4]);
});
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
