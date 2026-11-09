import assert from "node:assert/strict";
import test from "node:test";
import { createMemoryFileSystem } from "@poe-code/safe-fs";
import { createCommandArguments, toByteSource } from "safe-bash-contracts";
import { createSpongeCommand, evalSyncSponge, settings } from "./index.js";

test("sponge command definition exports standard contract", () => {
  const def = createSpongeCommand();
  assert.equal(def.name, "sponge");
  assert.equal(typeof def.execute, "function");
});

test("sponge input quotas are optional with equivalent flat and nested options", () => {
  assert.equal(settings().maxBufferedBytes, Infinity);
  assert.equal(settings({ limits: { ["maxBufferedBytes" as string]: undefined } }).maxBufferedBytes, Infinity);
  for (const value of [Infinity, 16]) {
    assert.equal(settings({ maxBufferedBytes: value }).maxBufferedBytes, value);
    assert.equal(settings({ limits: { maxBufferedBytes: value } }).maxBufferedBytes, value);
  }
  for (const value of [-Infinity, NaN, -1, 0, 1.5]) assert.throws(() => settings({ maxBufferedBytes: value }), RangeError);
});

test("sponge declines synchronous file writes that cannot replace the destination", () => {
  const bytes = new Uint8Array([0, 255, 10]);
  assert.equal(evalSyncSponge(bytes, ["out"], undefined, () => {
    assert.fail("in-place writer must not be called");
  }), undefined);
  assert.equal(evalSyncSponge(bytes, []), undefined);
  assert.equal(evalSyncSponge(bytes, ["-a", "out"]), undefined);
});

for (const append of [false, true]) {
  for (const path of ["missing/../f", "f/", "f/.", "f/../f", "./f", "dir/../f"]) {
    for (const absolute of [false, true]) {
      const target = absolute ? `/work/${path}` : path;
      test(`sponge ${append ? "append" : "overwrite"} respects traversal of ${target}`, async () => {
        const fs = createMemoryFileSystem();
        await fs.mkdir("/work/dir", { recursive: true });
        await fs.writeFile("/work/f", new TextEncoder().encode("OLD"));
        const values = createCommandArguments([...(append ? ["-a"] : []), target]);
        let diagnostic = "";
        const result = await createSpongeCommand().execute({
          command: "sponge", args: values.args, argumentValues: values, cwd: "/work", env: {}, fs,
          stdin: toByteSource("abc"),
          stdout: { async write() { assert.fail("sponge should not produce output"); } },
          stderr: { async write(bytes) { diagnostic += new TextDecoder().decode(bytes); } },
          signal: new AbortController().signal,
        });
        const valid = path === "./f" || path === "dir/../f";
        assert.equal(new TextDecoder().decode(await fs.readFile("/work/f")), valid ? (append ? "OLDabc" : "abc") : "OLD");
        assert.equal(result.exitCode, valid ? 0 : 1, diagnostic);
        assert.equal(diagnostic.length > 0, !valid);
      });
    }
  }
}
