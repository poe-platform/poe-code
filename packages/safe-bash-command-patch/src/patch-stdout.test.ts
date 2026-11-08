import assert from "node:assert/strict";
import test from "node:test";
import { contents, filesystem, replacement, run } from "./helpers.test.js";

const noNewline = "--- target\n+++ target\n@@ -1,2 +1,2 @@\n a\n-b\n+B\n\\ No newline at end of file\n";

for (const args of [["-o", "-"], ["-o-"], ["--output=-"], ["--output", "-"]]) {
  for (const mode of [[], ["-s"], ["--dry-run"], ["--atomic"], ["--atomic", "--dry-run"], ["-b"]]) {
    test(`stdout destination preserves bytes and namespace: ${[...args, ...mode].join(" ")}`, async () => {
      const fs = await filesystem({ target: "a\nb\n", "-": "sentinel" });
      const original = await fs.stat("/work/target");
      const dash = await fs.stat("/work/-");
      const result = await run("patch", [...args, ...mode], { fs, input: noNewline });
      assert.equal(result.exitCode, 0, result.stderr);
      assert.equal(result.stdout, "a\nB");
      assert.equal(result.stderr, mode.includes("-s") ? "" : `${mode.includes("--dry-run") ? "checking" : "patching"} file - (read from target)\n`);
      assert.equal(await contents(fs, "target"), "a\nb\n");
      assert.equal(await contents(fs, "-"), "sentinel");
      const targetAfter = await fs.stat("/work/target");
      const dashAfter = await fs.stat("/work/-");
      assert.deepEqual({ ...targetAfter, atimeMs: original.atimeMs }, original);
      assert.deepEqual({ ...dashAfter, atimeMs: dash.atimeMs }, dash);
      assert.deepEqual((await fs.readdir("/work")).map(entry => entry.name).sort(), ["-", "target"]);
    });
  }
}

for (const atomic of [false, true]) {
  test(`stdout concatenates separate and repeated source sections (atomic=${atomic})`, async () => {
    const result = await run("patch", ["-s", "-o-", ...(atomic ? ["--atomic"] : [])], {
      files: { target: "a\nb\n", second: "a\nb\n" },
      input: noNewline + noNewline.replaceAll("target", "second") + noNewline,
    });
    assert.equal(result.exitCode, 0, result.stderr);
    assert.equal(result.stdout, "a\nBa\nBa\nB");
    assert.equal(await contents(result.fs, "target"), "a\nb\n");
    assert.equal(await contents(result.fs, "second"), "a\nb\n");
  });
}

for (const args of [[], ["-r", "rejects"], ["-r", "-"], ["--dry-run"]]) {
  test(`stdout partial failure retains GNU rejects without backups: ${args.join(" ")}`, async () => {
    const result = await run("patch", ["-s", "-b", "-o-", ...args], {
      files: { target: "old\nkeep\nwrong\n" }, input: replacement + "@@ -3 +3 @@\n-tail\n+TAIL\n",
    });
    assert.equal(result.exitCode, 1);
    assert.equal(result.stdout, "new\nkeep\nwrong\n");
    assert.equal(await contents(result.fs, "target"), "old\nkeep\nwrong\n");
    const destination = args.includes("--dry-run") || args.includes("-") ? undefined : args.includes("rejects") ? "rejects" : "-.rej";
    assert.equal(result.stderr, `1 out of 2 hunks FAILED${destination ? ` -- saving rejects to file ${destination}` : ""}\n`);
    assert.deepEqual((await result.fs.readdir("/work")).map(entry => entry.name).sort(), destination ? [destination, "target"].sort() : ["target"]);
    if (destination) assert.match(await contents(result.fs, destination), /-tail\n\+TAIL\n/u);
  });
}

test("stdout deletion does not remove its source", async () => {
  const result = await run("patch", ["-s", "-o-"], { files: { target: "old\n" }, input: "--- target\n+++ /dev/null\n@@ -1 +0,0 @@\n-old\n" });
  assert.equal(result.exitCode, 0, result.stderr);
  assert.equal(result.stdout, "");
  assert.equal(await contents(result.fs, "target"), "old\n");
});

test("atomic stdout does not emit a prefix when a later hunk fails", async () => {
  const result = await run("patch", ["-s", "-o-", "--atomic"], {
    files: { target: "old\n", second: "wrong\n" }, input: replacement + replacement.replaceAll("target", "second"),
  });
  assert.equal(result.exitCode, 1);
  assert.equal(result.stdout, "");
  assert.equal(await contents(result.fs, "target"), "old\n");
});

test("stdout enforces the output ceiling before emitting data", async () => {
  const result = await run("patch", ["-s", "-o-"], { files: { target: "old\n" }, input: replacement, options: { maxOutputBytes: 3 } });
  assert.equal(result.exitCode, 2);
  assert.equal(result.stdout, "");
  assert.match(result.stderr, /output byte limit/u);
  assert.equal(await contents(result.fs, "target"), "old\n");
});

for (const failure of ["none", "write", "cancel"] as const) {
  test(`stdout streams bounded, awaited chunks and closes retained resources after ${failure}`, async () => {
    const text = "x".repeat(128 * 1024) + "\nold\n";
    const fs = await filesystem({ target: text });
    const controller = new AbortController();
    const reason = new Error("stdout failure");
    let reads = 0, closed = 0, writes = 0, active = 0;
    const chunks: Uint8Array[] = [];
    const observed = new Proxy(fs, { get(target, key) {
      if (key === "openReadFile") return async (...args: Parameters<typeof fs.openReadFile>) => {
        reads++;
        const handle = await target.openReadFile(...args);
        return { ...handle, async close() { closed++; await handle.close(); } };
      };
      const value: unknown = Reflect.get(target, key, target);
      return typeof value === "function" ? value.bind(target) : value;
    } });
    const operation = run("patch", ["-s", "-o-"], { fs: observed, signal: controller.signal,
      input: "--- target\n+++ target\n@@ -2 +2 @@\n-old\n+new\n",
      stdout: { async write(chunk) {
        assert.ok(chunk.length <= 16384);
        assert.equal(++active, 1);
        try {
          await Promise.resolve();
          if (++writes === 2) {
            if (failure === "write") throw reason;
            if (failure === "cancel") controller.abort(reason);
          }
          chunks.push(chunk.slice());
        } finally { active--; }
      } },
    });
    if (failure === "cancel") await assert.rejects(operation, error => error === reason);
    else {
      const result = await operation;
      assert.equal(result.exitCode, failure === "none" ? 0 : 2, result.stderr);
    }
    assert.ok(writes >= 2);
    assert.ok(reads > 0);
    assert.equal(closed, reads);
    assert.equal(active, 0);
    if (failure === "none") assert.equal(Buffer.concat(chunks).toString(), text.slice(0, -4) + "new\n");
    assert.equal(await contents(fs, "target"), text);
    assert.deepEqual((await fs.readdir("/work")).map(entry => entry.name), ["target"]);
  });
}
