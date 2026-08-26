import assert from "node:assert/strict";
import test from "node:test";
import { contents, filesystem, native, replacement, run } from "./helpers.js";

const create = (name: string) => `--- /dev/null\n+++ ${name}\n@@ -0,0 +1 @@\n+old\n`;
const remove = (name: string) => `--- ${name}\n+++ /dev/null\n@@ -1 +0,0 @@\n-old\n`;
const replace = (oldName: string, newName = oldName) => replacement.replace("--- target", `--- ${oldName}`).replace("+++ target", `+++ ${newName}`);

async function snapshot(fs: Awaited<ReturnType<typeof filesystem>>) {
  const entries: unknown[] = [];
  const visit = async (path: string): Promise<void> => {
    const stat = await fs.lstat(path);
    entries.push({ path, type: stat.type, ino: stat.ino, dev: stat.dev, mode: stat.mode, nlink: stat.nlink,
      ...(stat.type === "file" ? { bytes: Buffer.from(await fs.readFile(path)).toString("hex") } : {}),
      ...(stat.type === "symlink" ? { link: await fs.readlink(path) } : {}),
    });
    if (stat.type === "directory") for (const entry of (await fs.readdir(path)).sort((left, right) => left.name.localeCompare(right.name))) await visit(`${path}/${entry.name}`);
  };
  await visit("/work");
  return entries;
}

for (const kind of ["symlink", "hardlink", "symlink-parent"] as const) {
  for (const atomic of [false, true]) for (const dryRun of [false, true]) {
    test(`followup created target outranks unused ${kind}, atomic=${atomic}, dryRun=${dryRun}`, async () => {
      const fs = await filesystem({ sentinel: "untouched\n" });
      const unused = kind === "symlink-parent" ? "unused-long-name/sentinel" : "unused-long-name";
      if (kind === "hardlink") await fs.link("/work/sentinel", "/work/unused-long-name");
      else await fs.symlink(kind === "symlink-parent" ? "." : "sentinel", "/work/unused-long-name");
      const before = await snapshot(fs);
      const link = await fs.lstat("/work/unused-long-name");
      const result = await run("patch", ["--batch", "-p0", ...(atomic ? ["--atomic"] : []), ...(dryRun ? ["--dry-run"] : [])], { fs, input: create("a") + replace("a", unused) });
      assert.equal(result.exitCode, dryRun && !atomic ? 2 : 0, result.stderr);
      if (dryRun) assert.deepEqual(await snapshot(fs), before);
      else {
        assert.deepEqual(await fs.lstat("/work/unused-long-name"), link);
        assert.equal(await contents(fs, "a"), "new\n");
        assert.equal(await contents(fs, "sentinel"), "untouched\n");
        if (kind !== "hardlink") assert.equal(await fs.readlink("/work/unused-long-name"), kind === "symlink-parent" ? "." : "sentinel");
        assert.deepEqual((await fs.readdir("/work")).map(entry => entry.name).sort(), ["a", "sentinel", "unused-long-name"]);
      }
    });
  }
}

for (const atomic of [false, true]) {
  test(`followup input may remain an unused header candidate after creation, atomic=${atomic}`, async () => {
    const input = create("a") + replace("a", "input.patch");
    const fs = await filesystem({ "input.patch": input });
    const result = await run("patch", ["-p0", "-i", "input.patch", ...(atomic ? ["--atomic"] : [])], { fs });
    assert.equal(result.exitCode, 0, result.stderr);
    assert.equal(await contents(fs, "a"), "new\n");
    assert.equal(await contents(fs, "input.patch"), input);
  });

  test(`followup repeated create/delete/recreate selects current target, atomic=${atomic}`, async () => {
    const fs = await filesystem({ sentinel: "untouched\n" });
    await fs.symlink("sentinel", "/work/unused-long-name");
    const result = await run("patch", ["-p0", ...(atomic ? ["--atomic"] : [])], {
      fs, input: create("a") + remove("a") + create("a") + replace("a", "unused-long-name"),
    });
    assert.equal(result.exitCode, 0, result.stderr);
    assert.equal(await contents(fs, "a"), "new\n");
    assert.equal(await contents(fs, "sentinel"), "untouched\n");
  });

  test(`followup deletion exposing selected symlink is rejected before effects, atomic=${atomic}`, async () => {
    const fs = await filesystem({ a: "old\n", sentinel: "old\n" });
    await fs.symlink("sentinel", "/work/unused-long-name");
    const before = await snapshot(fs);
    const result = await run("patch", ["-p0", ...(atomic ? ["--atomic"] : [])], { fs, input: remove("a") + replace("a", "unused-long-name") });
    assert.equal(result.exitCode, 2);
    assert.match(result.stderr, /symlink/u);
    assert.deepEqual(await snapshot(fs), before);
  });

  for (const suffix of ["orig", "rej"]) {
    test(`followup actual ${suffix} cannot alias later selected creation, atomic=${atomic}`, async () => {
      const fs = await filesystem({ target: "wrong\n" });
      const before = await snapshot(fs);
      const result = await run("patch", [...(atomic ? ["--atomic"] : [])], { fs, input: replacement + create(`target.${suffix}`) });
      assert.notEqual(result.exitCode, 0);
      assert.deepEqual(await snapshot(fs), before);
    });
  }

  test(`followup newly created parents affect candidate ranking, atomic=${atomic}`, async () => {
    const fs = await filesystem();
    const input = create("z/seed") + create("a/file").replace("--- /dev/null", "--- z/file");
    const result = await run("patch", ["-p0", ...(atomic ? ["--atomic"] : [])], { fs, input });
    assert.equal(result.exitCode, 0, result.stderr);
    assert.equal(await contents(fs, "z/seed"), "old\n");
    assert.equal(await contents(fs, "z/file"), "old\n");
    await assert.rejects(fs.lstat("/work/a"), { code: "ENOENT" });
  });
}

for (const dryRun of [false, true]) test(`followup atomic reverse selection follows inverse section order, dryRun=${dryRun}`, async () => {
  const fs = await filesystem({ sentinel: "untouched\n" });
  await fs.symlink("sentinel", "/work/unused-long-name");
  const before = await snapshot(fs);
  const input = replace("a", "unused-long-name") + remove("a").replace("-old", "-new");
  const result = await run("patch", ["--atomic", "-R", "-p0", ...(dryRun ? ["--dry-run"] : [])], { fs, input });
  assert.equal(result.exitCode, 0, result.stderr);
  if (dryRun) assert.deepEqual(await snapshot(fs), before);
  else {
    assert.equal(await contents(fs, "a"), "old\n");
    assert.equal(await contents(fs, "sentinel"), "untouched\n");
    assert.equal(await fs.readlink("/work/unused-long-name"), "sentinel");
  }
});

test("followup namespace preview observes cancellation during a pending target read", async () => {
  const backing = await filesystem({ a: "old\n", sentinel: "untouched\n" });
  await backing.symlink("sentinel", "/work/unused-long-name");
  const before = await snapshot(backing);
  const controller = new AbortController();
  const reason = new Error("cancel namespace preview");
  let reads = 0;
  const fs = new Proxy(backing, {
    get(target, key) {
      if (key === "readStream") return undefined;
      if (key === "readFile") return (path: string, options: { signal?: AbortSignal }) => {
        assert.equal(path, "/work/a");
        assert.equal(options.signal, controller.signal);
        reads++;
        controller.abort(reason);
        return new Promise<Uint8Array>(() => {});
      };
      const value: unknown = Reflect.get(target, key);
      return typeof value === "function" ? value.bind(target) : value;
    },
  });
  await assert.rejects(run("patch", ["-p0"], { fs, input: replace("a") + replace("a", "unused-long-name"), signal: controller.signal }), error => error === reason);
  assert.equal(reads, 1);
  assert.deepEqual(await snapshot(backing), before);
});

test("followup namespace preview shares the invocation input budget", async () => {
  const fs = await filesystem({ a: "old\n" });
  const before = await snapshot(fs);
  const input = replace("a") + replace("a", "unused-long-name");
  const result = await run("patch", ["-p0"], { fs, input, options: { maxInputBytes: Buffer.byteLength(input) + 1 } });
  assert.equal(result.exitCode, 2, result.stderr);
  assert.match(result.stderr, /EFBIG.*maxBytes/u);
  assert.deepEqual(await snapshot(fs), before);
});

for (const [label, initial, input, args] of [
  ["create then replace", {}, create("a") + replace("a", "unused-long-name"), []],
  ["delete then reselect", { a: "old\n", "unused-long-name": "old\n" }, remove("a") + replace("a", "unused-long-name"), []],
  ["failed deletion retains candidate with rejects discarded", { a: "wrong\n", "unused-long-name": "old\n" }, remove("a") + replace("a", "unused-long-name"), ["-r", "-"]],
  ["reverse creation removes candidate", { a: "old\n", "unused-long-name": "old\n" }, create("a") + replace("a", "unused-long-name"), []],
  ["empty result under -E removes candidate", { a: "old\n", "unused-long-name": "old\n" }, remove("a").replace("+++ /dev/null", "+++ a") + replace("a", "unused-long-name"), ["-E"]],
] as const) test(`followup current namespace matches GNU: ${label}`, async () => {
  const files = { ...initial };
  const expected = await native("patch", ["--batch", "-p0", ...args], files, input);
  const actual = await run("patch", ["--batch", "-p0", ...args], { files, input });
  assert.equal(actual.exitCode, expected.exitCode, actual.stderr);
  const paths = (await actual.fs.readdir("/work")).map(entry => entry.name).sort();
  assert.deepEqual(paths, Object.keys(expected.files).sort());
  for (const path of paths) assert.equal(await contents(actual.fs, path), expected.files[path], path);
});
