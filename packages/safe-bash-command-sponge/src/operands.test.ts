import assert from "node:assert/strict";
import test from "node:test";
import { createMemoryFileSystem } from "@poe-code/safe-fs";
import { createCommandArguments, toByteSource } from "safe-bash-contracts";
import { createSpongeCommand, evalSyncSponge } from "./index.js";

for (const options of [[], ["-a"], ["--"]]) {
  test(`sponge writes only the first file operand with ${JSON.stringify(options)}`, async () => {
    const fs = createMemoryFileSystem();
    const encoder = new TextEncoder();
    const decoder = new TextDecoder();
    await fs.writeFile("/f", encoder.encode("OLD"));
    await fs.writeFile("/existing", encoder.encode("KEEP"));
    const values = createCommandArguments([...options, "f", "second", "existing"]);
    let stdout = "";
    let stderr = "";
    const result = await createSpongeCommand().execute({
      command: "sponge", args: values.args, argumentValues: values, cwd: "/", env: {},
      fs, stdin: toByteSource("abc"),
      stdout: { async write(bytes) { stdout += decoder.decode(bytes); } },
      stderr: { async write(bytes) { stderr += decoder.decode(bytes); } },
      signal: new AbortController().signal,
    });
    assert.equal(result.exitCode, 0, stderr);
    assert.equal(stdout, "");
    assert.equal(stderr, "");
    assert.equal(decoder.decode(await fs.readFile("/f")), options.includes("-a") ? "OLDabc" : "abc");
    assert.equal(decoder.decode(await fs.readFile("/existing")), "KEEP");
    await assert.rejects(fs.stat("/second"), { code: "ENOENT" });
  });
}

test("synchronous sponge writes only the first file operand", () => {
  const bytes = new TextEncoder().encode("abc");
  const writes: string[] = [];
  assert.equal(evalSyncSponge(bytes, ["f", "second", "existing"], undefined, (path, value) => {
    writes.push(path);
    assert.deepEqual(value, bytes);
    return true;
  }), "");
  assert.deepEqual(writes, ["f"]);
});
