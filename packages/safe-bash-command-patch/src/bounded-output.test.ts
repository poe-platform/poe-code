import assert from "node:assert/strict";
import test from "node:test";
import { toByteSource } from "safe-bash-contracts";
import { createPatchCommand } from "./index.js";
import { contents, filesystem, run } from "./helpers.test.js";

for (const atomic of [false, true]) for (const failure of ["none", "sink", "cancel"]) test(`verbose patch status uses bounded writes: atomic=${atomic}, ${failure}`, async () => {
  const lines = Array.from({ length: 650 }, (_, index) => `line${index}\n`);
  const fs = await filesystem({ target: lines.join("") });
  const input = "--- target\n+++ target\n" + lines.map((line, index) => `@@ -${index + 1} +${index + 1} @@\n-${line}+new${index}\n`).join("");
  let output = "", diagnostic = "", writes = 0;
  const controller = new AbortController(), reason = new Error("status sink stopped");
  const result = createPatchCommand().execute({ command: "patch", args: ["--verbose", ...(atomic ? ["--atomic"] : [])],
    cwd: "/work", env: {}, fs, signal: controller.signal, stdin: toByteSource(input),
    stdout: { async write(bytes) {
      assert.ok(bytes.length <= 16384, `oversized status write: ${bytes.length}`); await Promise.resolve();
      if (++writes === 2) {
        if (failure === "sink") throw reason;
        if (failure === "cancel") controller.abort(reason);
      }
      output += new TextDecoder().decode(bytes);
    } },
    stderr: { async write(bytes) { diagnostic += new TextDecoder().decode(bytes); } },
  });
  if (failure === "cancel") await assert.rejects(Promise.resolve(result), error => error === reason);
  else assert.equal((await result).exitCode, failure === "none" ? 0 : 2, diagnostic);
  if (failure === "none") assert.ok(output.endsWith("Hunk #650 succeeded at 650.\ndone\n"));
  assert.equal(await contents(fs, "target"), atomic || failure === "none" ? lines.map((_, index) => `new${index}\n`).join("") : lines.join(""));
  assert.deepEqual((await fs.readdir("/work")).map(entry => entry.name), ["target"]);
});

for (const failure of ["none", "storage", "cancel"]) test(`reject output spills with bounded writes and cleanup: ${failure}`, async t => {
  const fs = await filesystem({ target: "actual\n" });
  const old = "a".repeat(300000), next = "b".repeat(300000);
  const patch = `--- target\n+++ target\n@@ -1 +1 @@\n-${old}\n+${next}\n`;
  const controller = new AbortController(), reason = new Error("reject spill failed");
  const open = fs.open.bind(fs);
  let opened = 0, closed = 0, writes = 0;
  t.mock.method(fs, "open", async (...args: Parameters<typeof fs.open>) => {
    const handle = await open(...args); opened++;
    return new Proxy(handle, { get(target, key) {
      if (key === "write") return async (...args: Parameters<typeof handle.write>) => {
        assert.ok(args[0].length <= 16384); writes++;
        if (failure === "storage") throw reason;
        if (failure === "cancel") controller.abort(reason);
        return target.write(...args);
      };
      if (key === "close") return async (...args: Parameters<typeof handle.close>) => { closed++; return target.close(...args); };
      const value = Reflect.get(target, key, target);
      return typeof value === "function" ? value.bind(target) : value;
    } });
  });
  const result = run("patch", [], { fs, input: patch, signal: controller.signal });
  if (failure === "cancel") await assert.rejects(result, error => error === reason);
  else {
    const output = await result;
    assert.equal(output.exitCode, failure === "none" ? 1 : 2, output.stderr);
    if (failure !== "none") assert.equal(output.stdout, "");
  }
  assert.ok(writes > 0); assert.equal(closed, opened);
  assert.equal(await contents(fs, "target"), "actual\n");
  if (failure === "none") assert.equal(await contents(fs, "target.rej"), patch);
  assert.deepEqual((await fs.readdir("/work")).map(entry => entry.name).sort(), failure === "none" ? ["target", "target.orig", "target.rej"] : ["target"]);
});
