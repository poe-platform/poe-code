import assert from "node:assert/strict";
import test from "node:test";
import { createHash } from "node:crypto";
import { createMemoryFileSystem } from "@poe-code/safe-fs";
import { toByteSource, type FileSystem } from "safe-bash-contracts";
import { Budget } from "safe-bash-diff-engine/shared";
import { createDiffCommand } from "./index.js";

for (const [args, expected] of [
  [[], "2c2\n< old\n---\n> new\n"],
  [["-n"], "d2 1\na2 1\nnew\n"],
  [["-D", "FLAG"], "first\n#ifndef FLAG\nold\n#else /* FLAG */\nnew\n#endif /* FLAG */\nlast\n"],
  [["-u"], "--- /left\n+++ /right\n@@ -1,3 +1,3 @@\n first\n-old\n+new\n last\n"],
  [["-c"], "*** /left\n--- /right\n***************\n*** 1,3 ****\n  first\n! old\n  last\n--- 1,3 ----\n  first\n! new\n  last\n"],
] as const) test(`indexed document output: ${args}`, async t => {
  const fs = createMemoryFileSystem();
  await fs.writeFile("/left", new TextEncoder().encode("first\nold\nlast\n"));
  await fs.writeFile("/right", new TextEncoder().encode("first\nnew\nlast\n"));
  t.mock.method(Budget.prototype, "readDiff", async () => assert.fail("whole document loader"));
  let output = "", error = "";
  const result = await createDiffCommand().execute({
    command: "diff", args: [...args, "/left", "/right"], cwd: "/", env: {}, fs,
    signal: new AbortController().signal, stdin: toByteSource(""),
    stdout: { async write(bytes) { assert.ok(bytes.length <= 16384); await Promise.resolve(); output += new TextDecoder().decode(bytes); } },
    stderr: { async write(bytes) { error += new TextDecoder().decode(bytes); } },
  });
  assert.equal(result.exitCode, 1, error);
  assert.equal(output, expected);
});

test("indexed hunks preserve buffered output across deterministic edit patterns", async () => {
  const fs = createMemoryFileSystem();
  const execute = async (args: string[]) => {
    const chunks: Uint8Array[] = [];
    let error = "";
    const result = await createDiffCommand().execute({
      command: "diff", args: [...args, "/left", "/right"], cwd: "/", env: {}, fs,
      signal: new AbortController().signal, stdin: toByteSource(""),
      stdout: { async write(bytes) { chunks.push(bytes.slice()); } },
      stderr: { async write(bytes) { error += new TextDecoder().decode(bytes); } },
    });
    return { ...result, output: Buffer.concat(chunks), error };
  };
  let seed = 1786;
  const random = () => { seed = Math.imul(seed, 1664525) + 1013904223 >>> 0; return seed; };
  for (let example = 0; example < 32; example++) {
    const make = () => {
      let text = "";
      for (let line = 0, count = random() % 12; line < count; line++) text += ["a\n", "b\n", "c\r\n", "é\n", "\n"][random() % 5];
      return random() % 2 ? text.slice(0, -1) : text;
    };
    await fs.writeFile("/left", new TextEncoder().encode(make()));
    await fs.writeFile("/right", new TextEncoder().encode(make()));
    for (const options of [[], ["-U0"], ["-U1"], ["-u"], ["-C0"], ["-C1"], ["-c"], ["-n"], ["-D", "FLAG"]]) {
      const expected = await execute([...options, "-I", "^NEVER$"]);
      assert.deepEqual(await execute(options), expected, `example ${example}: ${options}`);
    }
  }
});

for (const failure of ["none", "write", "cancel"] as const) test(`generated long-line diff uses bounded caller IO and cleanup: ${failure}`, async t => {
  const fs = createMemoryFileSystem();
  await fs.writeFile("/left", new Uint8Array());
  await fs.writeFile("/right", new Uint8Array());
  const size = 512 * 1024 + 7;
  const slab = new Uint8Array(65536);
  const controller = new AbortController(), reason = new Error("injected storage failure");
  let opened = 0, closed = 0, writes = 0, reads = 0, inputClosed = 0, outputBytes = 0;
  let outstanding = 0, peak = 0, error = "";
  const hash = createHash("sha256");
  const view = new Proxy(fs, { get(target, key) {
    if (key === "readFile" || key === "readStream" || key === "writeFile") return () => assert.fail(`whole payload IO: ${String(key)}`);
    if (key === "stat" || key === "lstat") return async (path: string) => {
      const stat = await target[key](path);
      return path === "/left" || path === "/right" ? { ...stat, size } : stat;
    };
    if (key === "openReadFile") return async (path: string) => {
      const stat = { ...await target.stat(path), size };
      return {
        async stat() { return stat; },
        async read(position: number, length: number) {
          assert.ok(length <= slab.length); assert.ok(position + length <= size);
          reads++; slab.fill(path === "/left" ? 65 : 66); return slab.subarray(0, length);
        },
        async close() { inputClosed++; },
      };
    };
    if (key === "open") return async (...args: Parameters<NonNullable<FileSystem["open"]>>) => {
      const descriptor = await target.open!(...args); opened++;
      return new Proxy(descriptor, { get(handle, method) {
        if (method === "write") return async (...params: Parameters<typeof descriptor.write>) => {
          assert.ok(params[0].byteLength <= 16384);
          outstanding += params[0].byteLength; peak = Math.max(peak, outstanding);
          try {
            writes++;
            if (writes === 2 && failure === "write") throw reason;
            if (writes === 2 && failure === "cancel") controller.abort(reason);
            return await handle.write(...params);
          } finally { outstanding -= params[0].byteLength; }
        };
        if (method === "close") return async (...params: Parameters<typeof descriptor.close>) => { closed++; return handle.close(...params); };
        const value = Reflect.get(handle, method, handle);
        return typeof value === "function" ? value.bind(handle) : value;
      } });
    };
    const value = Reflect.get(target, key, target);
    return typeof value === "function" ? value.bind(target) : value;
  } }) as FileSystem;
  t.mock.method(Budget.prototype, "readDiff", async () => assert.fail("whole document loader"));
  const execute = async () => createDiffCommand().execute({
    command: "diff", args: ["/left", "/right"], cwd: "/", env: {}, fs: view,
    signal: controller.signal, stdin: toByteSource(""),
    stdout: { async write(bytes) { assert.ok(bytes.length <= 16384); await new Promise(resolve => setImmediate(resolve)); hash.update(bytes); outputBytes += bytes.length; } },
    stderr: { async write(bytes) { error += new TextDecoder().decode(bytes); } },
  });
  if (failure === "cancel") await assert.rejects(execute(), failure => failure === reason);
  else {
    const result = await execute();
    assert.equal(result.exitCode, failure === "none" ? 1 : 2, error);
  }
  assert.equal(closed, opened);
  assert.ok(inputClosed >= 1);
  assert.equal(outstanding, 0); assert.equal(peak, 16384);
  assert.deepEqual((await fs.readdir("/")).map(entry => entry.name).sort(), ["left", "right"]);
  if (failure !== "none") assert.equal(outputBytes, 0);
  else {
    assert.equal(reads, 2 * Math.ceil(size / slab.length));
    assert.ok(opened >= 3, "both documents and the output must spill through caller storage");
    assert.ok(writes > 32);
    const expected = createHash("sha256");
    expected.update("1c1\n< ");
    for (let i = 0; i < size; i += slab.length) { slab.fill(65); expected.update(slab.subarray(0, Math.min(slab.length, size - i))); }
    expected.update("\n\\ No newline at end of file\n---\n> ");
    for (let i = 0; i < size; i += slab.length) { slab.fill(66); expected.update(slab.subarray(0, Math.min(slab.length, size - i))); }
    expected.update("\n\\ No newline at end of file\n");
    assert.equal(hash.digest("hex"), expected.digest("hex"));
  }
});

for (const args of [["-u", "-", "/right"], ["-u", "/dev/stdin", "/right"], ["-Nu", "/missing", "/right"], ["--from-file=-", "/right", "/right"], ["-s", "-", "-"]]) {
  test(`indexed diff stages stdin once and supports empty operands: ${args}`, async t => {
    const fs = createMemoryFileSystem();
    await fs.writeFile("/right", new TextEncoder().encode("new\n"));
    const run = async (forceBuffer: boolean) => {
      let stdout = "", stderr = "", pulls = 0;
      const result = await createDiffCommand().execute({
        command: "diff", args: [...(forceBuffer ? ["-I", "^NEVER$"] : []), ...args], cwd: "/", env: {}, fs,
        signal: new AbortController().signal,
        stdin: (async function* () { pulls++; yield new TextEncoder().encode("old\n"); })(),
        stdout: { async write(bytes) { stdout += new TextDecoder().decode(bytes); } },
        stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } },
      });
      return { ...result, stdout, stderr, pulls };
    };
    const expected = await run(true);
    t.mock.method(Budget.prototype, "read", async () => assert.fail("whole stdin loader"));
    t.mock.method(Budget.prototype, "readDiff", async () => assert.fail("whole file loader"));
    assert.deepEqual(await run(false), expected);
  });
}

test("LCS cells spill to caller storage instead of allocating a full matrix", async () => {
  const fs = createMemoryFileSystem();
  await fs.writeFile("/left", new TextEncoder().encode("a\n".repeat(200)));
  await fs.writeFile("/right", new TextEncoder().encode("b\n".repeat(200)));
  let opened = 0, closed = 0;
  const view = new Proxy(fs, { get(target, key) {
    if (key === "open") return async (...args: Parameters<NonNullable<FileSystem["open"]>>) => {
      opened++;
      const handle = await target.open!(...args);
      return new Proxy(handle, { get(descriptor, method) {
        if (method === "close") return async (...params: Parameters<typeof handle.close>) => { closed++; return descriptor.close(...params); };
        const value = Reflect.get(descriptor, method, descriptor);
        return typeof value === "function" ? value.bind(descriptor) : value;
      } });
    };
    const value = Reflect.get(target, key, target);
    return typeof value === "function" ? value.bind(target) : value;
  } });
  let stdout = "", stderr = "";
  const result = await createDiffCommand({ maxMatrixCells: 201 * 201 }).execute({
    command: "diff", args: ["/left", "/right"], cwd: "/", env: {}, fs: view,
    signal: new AbortController().signal, stdin: toByteSource(""),
    stdout: { async write(bytes) { stdout += new TextDecoder().decode(bytes); } },
    stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } },
  });
  assert.equal(result.exitCode, 1, stderr);
  assert.equal(stdout, "1,200c1,200\n" + "< a\n".repeat(200) + "---\n" + "> b\n".repeat(200));
  assert.equal(opened, 1, "only the matrix exceeds its cache in this fixture");
  assert.equal(closed, opened);
});
