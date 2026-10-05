import assert from "node:assert/strict";
import test from "node:test";
import { toByteSource, type CommandContext } from "safe-bash-contracts";
import { Budget } from "safe-bash-diff-engine/shared";
import { directoryMatches } from "./stored-directory.js";
import { filesystem, run } from "./helpers.test-support.js";

test("recursive diff consumes directory iterators without collecting listings", async t => {
  const fs = await filesystem({ "left/A": "old\n", "left/a": "old\n", "left/B": "old\n",
    "right/A": "new\n", "right/b": "new\n", "right/c": "new\n" });
  const readdir = fs.readdir.bind(fs);
  t.mock.method(fs, "readdir", async (path: Parameters<typeof fs.readdir>[0], options: Parameters<typeof fs.readdir>[1]) => {
    assert.ok(path !== "/work/left" && path !== "/work/right", "collected a directory listing");
    return readdir(path, options);
  });
  const actual = await run("diff", ["-rq", "--ignore-file-name-case", "left", "right"], { fs });
  assert.equal(actual.exitCode, 1, actual.stderr);
  assert.equal(actual.stdout, "Files left/A and right/A differ\nOnly in left: a\nFiles left/B and right/b differ\nOnly in right: c\n");
});

test("small directory comparisons do not require spill capability", async t => {
  const fs = await filesystem({ "left/a": "old\n", "right/a": "new\n" });
  t.mock.method(fs, "open", async () => assert.fail("unexpected spill acquisition"));
  const result = await run("diff", ["-rq", "left", "right"], { fs });
  assert.equal(result.exitCode, 1, result.stderr);
  assert.equal(result.stdout, "Files left/a and right/a differ\n");
});

test("spilling a compared working directory does not invalidate its own iterator", async () => {
  const fs = await filesystem();
  for (let index = 0; index < 1152; index++) await fs.writeFile(`/work/${String(index).padStart(4, "0")}-${"x".repeat(220)}`, new Uint8Array());
  const context: CommandContext = { fs, cwd: "/work", env: {}, command: "diff", args: [], signal: new AbortController().signal,
    stdin: toByteSource(""), stdout: { async write() {} }, stderr: { async write() {} } };
  let count = 0;
  for await (const match of directoryMatches(".", undefined, new Budget(context, {}), false, Infinity, async () => false)) {
    assert.equal(match.left?.slice(0, 4), String(1151 - count).padStart(4, "0")); count++;
  }
  assert.equal(count, 1152);
});

for (const failure of ["none", "write", "cancel"]) test(`directory records spill with bounded writes and cleanup: ${failure}`, async t => {
  const fs = await filesystem(), controller = new AbortController(), reason = new Error("directory storage failed");
  const context: CommandContext = { fs, cwd: "/work", env: {}, command: "diff", args: [], signal: controller.signal,
    stdin: toByteSource(""), stdout: { async write() {} }, stderr: { async write() {} } };
  let opened = 0, closed = 0, writes = 0, iterated = 0, retired = 0;
  const name = (index: number) => `entry-${String(index).padStart(5, "0")}-${"λ".repeat(128)}`;
  t.mock.method(fs, "iterateDirectory", async function* () {
    iterated++;
    try { for (let index = 767; index >= 0; index--) yield { name: name(index), type: "file" as const }; }
    finally { retired++; }
  });
  const open = fs.open.bind(fs);
  t.mock.method(fs, "open", async (...args: Parameters<typeof fs.open>) => {
    const handle = await open(...args); opened++;
    return new Proxy(handle, { get(target, key) {
      if (key === "write") return async (...args: Parameters<typeof handle.write>) => {
        assert.ok(args[0].length <= 16384); writes++;
        if (failure === "write") throw reason;
        if (failure === "cancel") controller.abort(reason);
        return target.write(...args);
      };
      if (key === "close") return async (...args: Parameters<typeof handle.close>) => { closed++; return target.close(...args); };
      const value = Reflect.get(target, key, target);
      return typeof value === "function" ? value.bind(target) : value;
    } });
  });
  const execute = async () => {
    let index = 767;
    for await (const match of directoryMatches("left", "right", new Budget(context, {}), false, Infinity, async () => false)) {
      assert.deepEqual(match, { left: name(index), right: name(index) }); index--;
    }
    assert.equal(index, -1);
  };
  if (failure === "none") await execute();
  else await assert.rejects(execute(), error => error === reason);
  assert.ok(writes > 0); assert.equal(opened, closed); assert.equal(iterated, retired);
  assert.deepEqual(await fs.readdir("/work"), []);
});
