import assert from "node:assert/strict";
import test from "node:test";
import { createMemoryFileSystem } from "@poe-code/safe-fs";
import { toByteSource, type FileSystem } from "safe-bash-contracts";
import { Budget } from "safe-bash-diff-engine/shared";
import { compareBrief } from "./brief.js";
import { createDiffCommand } from "./index.js";

for (const different of [false, true]) test(`brief comparison streams generated operands, different=${different}`, async t => {
  const fs = createMemoryFileSystem();
  await fs.writeFile("/left", new Uint8Array());
  await fs.writeFile("/right", new Uint8Array());
  const size = 8 * 1024 * 1024 + 3;
  let closed = 0, reads = 0, total = 0;
  // Reused producer storage: no payload-sized fixture or RAM spool.
  const slab = new Uint8Array(65536);
  const view = new Proxy(fs, { get(target, key) {
    if (key === "readFile" || key === "readStream" || key === "writeFile" || key === "createStagedFile") return () => assert.fail(`unexpected ${String(key)}`);
    if (key === "lstat" || key === "stat") return async (path: string) => {
      const stat = await target[key](path);
      return stat.type === "file" ? { ...stat, size } : stat;
    };
    if (key === "openReadFile") return async (path: string) => {
      const stat = { ...await target.stat(path), size };
      return {
        async stat() { return stat; },
        async read(position: number, length: number) {
          assert.ok(length <= slab.length, "read requests stay within one block");
          assert.ok(position + length <= size);
          reads++;
          slab.fill(65);
          if (different && path === "/right" && position + length === size) slab[length - 1] = 66;
          return slab.subarray(0, length);
        },
        async close() { closed++; },
      };
    };
    const value = Reflect.get(target, key, target);
    return typeof value === "function" ? value.bind(target) : value;
  } }) as FileSystem;
  t.mock.method(Budget.prototype, "readDiff", async () => assert.fail("payload-wide loader"));
  let output = "";
  const result = await createDiffCommand().execute({
    command: "diff", args: ["-qs", "/left", "/right"], cwd: "/", env: {}, fs: view,
    signal: new AbortController().signal, stdin: toByteSource(""),
    inputBudget: { maxBytes: size * 2, check(bytes) { total = bytes; } },
    stdout: { async write(bytes) { await new Promise(resolve => setImmediate(resolve)); output += new TextDecoder().decode(bytes); } },
    stderr: { async write(bytes) { assert.fail(new TextDecoder().decode(bytes)); } },
  });
  assert.equal(result.exitCode, different ? 1 : 0);
  assert.equal(output, `Files /left and /right ${different ? "differ" : "are identical"}\n`);
  assert.equal(closed, 2);
  assert.equal(total, size * 2);
  assert.equal(reads, 2 * Math.ceil(size / slab.length));
});

for (const [left, right] of [
  [[], []], [[65], []], [[], [65]], [[65, 10], [65]],
  [[255, 0, 10], [255, 0, 10]], [[255, 0, 10], [254, 0, 10]],
  [[65, 66, 67, 68, 10], [65, 66, 67, 68, 10]],
] as const) test(`brief comparison handles independently short reads: ${left} / ${right}`, async () => {
  const fs = createMemoryFileSystem();
  await fs.writeFile("/left", new Uint8Array(left));
  await fs.writeFile("/right", new Uint8Array(right));
  let closed = 0;
  const view = new Proxy(fs, { get(target, key) {
    if (key === "openReadFile") return async (path: string) => {
      const handle = await target.openReadFile!(path);
      return {
        stat: handle.stat.bind(handle),
        read: (position: number, length: number) => handle.read(position, Math.min(length, path === "/left" ? 1 : 3)),
        async close() { closed++; await handle.close(); },
      };
    };
    const value = Reflect.get(target, key, target);
    return typeof value === "function" ? value.bind(target) : value;
  } }) as FileSystem;
  let output = "";
  const result = await createDiffCommand().execute({
    command: "diff", args: ["-q", "/left", "/right"], cwd: "/", env: {}, fs: view,
    signal: new AbortController().signal, stdin: toByteSource(""),
    stdout: { async write(bytes) { output += new TextDecoder().decode(bytes); } },
    stderr: { async write(bytes) { assert.fail(new TextDecoder().decode(bytes)); } },
  });
  const same = left.length === right.length && left.every((byte, index) => right[index] === byte);
  assert.equal(result.exitCode, same ? 0 : 1);
  assert.equal(output, same ? "" : "Files /left and /right differ\n");
  assert.equal(closed, 2);
});

for (const [name, args, left, right, limits, status] of [
  ["combined input quota", [], "abc", "def", { maxInputBytes: 5 }, 2],
  ["combined line quota", [], "a\nb", "c\nd", { maxLines: 3 }, 2],
  ["binary skips line quota", [], "a\n\0", "c\nd", { maxLines: 1 }, 1],
  ["forced binary text counts lines", ["-a"], "a\n\0", "c\nd", { maxLines: 1 }, 2],
  ["equal unforced skips line quota", [], "a\nb", "a\nb", { maxLines: 1 }, 0],
  ["equal forced skips line quota", ["-a"], "a\nb", "a\nb", { maxLines: 1 }, 0],
] as const) test(`brief preserves ${name}`, async () => {
  const fs = createMemoryFileSystem();
  await fs.writeFile("/left", new TextEncoder().encode(left));
  await fs.writeFile("/right", new TextEncoder().encode(right));
  let output = "", error = "";
  const result = await createDiffCommand(limits).execute({
    command: "diff", args: ["-q", ...args, "/left", "/right"], cwd: "/", env: {}, fs,
    signal: new AbortController().signal, stdin: toByteSource(""),
    stdout: { async write(bytes) { output += new TextDecoder().decode(bytes); } },
    stderr: { async write(bytes) { error += new TextDecoder().decode(bytes); } },
  });
  assert.equal(result.exitCode, status, error);
  if (status === 2) { assert.equal(output, ""); assert.match(error, /limit exceeded/u); }
  else assert.equal(error, "");
});

for (const fail of [false, true]) test(`comparison bounds outstanding blocks and retires both sources: failure=${fail}`, async t => {
  let outstanding = 0, peak = 0, closed = 0;
  const reason = new Error("read failure");
  t.mock.method(Budget.prototype, "diffSource", async function* (path: string) {
    try {
      for (let index = 0; index < 16; index++) {
        if (fail && path === "/right" && index === 1) throw reason;
        const chunk = new Uint8Array(65536);
        outstanding += chunk.length;
        peak = Math.max(peak, outstanding);
        try { yield chunk; } finally { outstanding -= chunk.length; }
      }
    } finally { closed++; }
  });
  const budget = new Budget({
    command: "diff", args: [], cwd: "/", env: {}, fs: createMemoryFileSystem(),
    signal: new AbortController().signal, stdin: toByteSource(""),
    stdout: { async write() {} }, stderr: { async write() {} },
  }, {});
  if (fail) await assert.rejects(compareBrief(budget, "/left", "/right", false), error => error === reason);
  else assert.equal(await compareBrief(budget, "/left", "/right", false), true);
  assert.equal(peak, 2 * 65536);
  assert.equal(outstanding, 0);
  assert.equal(closed, 2);
});
