import assert from "node:assert/strict";
import test from "node:test";
import { contents, filesystem, run } from "./helpers.test.js";

const input = "--- f\n+++ f\n@@ -1 +1 @@\n-a\n+b\n";

test("forward reapplication saves the skipped patch and preserves the target", async () => {
  const fs = await filesystem({ f: "a\n", p: input });
  const first = await run("patch", ["-p0", "-N"], { fs, input });
  assert.equal(first.exitCode, 0);
  assert.equal(first.stderr, "");
  assert.equal(await contents(fs, "f"), "b\n");
  const second = await run("patch", ["-p0", "-N"], { fs, input });
  assert.equal(second.exitCode, 1);
  assert.equal(second.stderr, "");
  assert.equal(second.stdout, "patching file f\nReversed (or previously applied) patch detected!  Skipping patch.\n1 out of 1 hunk ignored -- saving rejects to file f.rej\n");
  assert.deepEqual((await fs.readdir("/work")).map(entry => entry.name).sort(), ["f", "f.rej", "p"]);
  assert.equal(await contents(fs, "f.rej"), input);
  assert.equal(await contents(fs, "f"), "b\n");
});

for (const args of [["-s"], ["-r", "rejects"], ["-r", "-"], ["--atomic"]]) {
  test(`forward skipped rejects respect ${args.join(" ")}`, async () => {
    const result = await run("patch", ["-p0", "-N", ...args], { files: { f: "b\n" }, input });
    assert.equal(result.exitCode, 1);
    assert.equal(result.stderr, "");
    assert.equal(await contents(result.fs, "f"), "b\n");
    const destination = args.includes("-") ? undefined : args.includes("rejects") ? "rejects" : "f.rej";
    assert.equal(result.stdout, `${args.includes("-s") ? "" : "patching file f\n"}Reversed (or previously applied) patch detected!  Skipping patch.\n1 out of 1 hunk ignored${destination ? ` -- saving rejects to file ${destination}` : ""}\n`);
    if (destination) assert.equal(await contents(result.fs, destination), input);
    else assert.deepEqual((await result.fs.readdir("/work")).map(entry => entry.name), ["f"]);
  });
}
