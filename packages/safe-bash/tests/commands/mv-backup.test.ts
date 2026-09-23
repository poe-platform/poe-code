import assert from "node:assert/strict";
import test from "node:test";
import { fixture, run } from "./helpers.js";
import { FsError, type FileSystem } from "../../src/contracts/index.js";

for (const [args, backup] of [
  [["--backup=numbered"], "output.~1~"],
  [["-b", "--suffix=.saved"], "output.saved"],
  [["-b", "-S", ".audit"], "output.audit"],
  [["--backup"], "output~"],
] as const) {
  test(`mv ${args.join(" ")} preserves overwritten bytes`, async () => {
    const fs = await fixture({ input: "new\n", output: "old\n" });
    const result = await run("mv", [...args, "input", "output"], { fs });
    assert.equal(result.exitCode, 0, result.stderr);
    assert.equal(result.stdout, "");
    assert.equal(result.stderr, "");
    assert.equal(Buffer.from(await fs.readFile("/work/output")).toString(), "new\n");
    assert.equal(Buffer.from(await fs.readFile(`/work/${backup}`)).toString(), "old\n");
    await assert.rejects(fs.lstat("/work/input"), { code: "ENOENT" });
  });
}

test("mv existing backups increment the largest numbered suffix", async () => {
  const fs = await fixture({ input: "new", output: "old", "output.~2~": "previous", "output.~10~": "latest" });
  const result = await run("mv", ["--backup=existing", "input", "output"], { fs });
  assert.equal(result.exitCode, 0, result.stderr);
  assert.equal(Buffer.from(await fs.readFile("/work/output.~11~")).toString(), "old");
  assert.equal(Buffer.from(await fs.readFile("/work/output.~10~")).toString(), "latest");
});

test("mv backup rejects same-file moves without changing files", async () => {
  const fs = await fixture({ input: "kept" });
  const result = await run("mv", ["-b", "input", "input"], { fs });
  assert.equal(result.exitCode, 1);
  assert.equal(Buffer.from(await fs.readFile("/work/input")).toString(), "kept");
  await assert.rejects(fs.lstat("/work/input~"), { code: "ENOENT" });
});

test("mv backup leaves destinations intact when the source is missing", async () => {
  const fs = await fixture({ output: "kept" });
  assert.equal((await run("mv", ["-b", "input", "output"], { fs })).exitCode, 1);
  assert.equal(Buffer.from(await fs.readFile("/work/output")).toString(), "kept");
  await assert.rejects(fs.lstat("/work/output~"), { code: "ENOENT" });
});

test("mv rejects combining backups with no-clobber", async () => {
  const fs = await fixture({ input: "new", output: "old" });
  assert.equal((await run("mv", ["-bn", "input", "output"], { fs })).exitCode, 2);
  assert.equal(Buffer.from(await fs.readFile("/work/output")).toString(), "old");
});

for (const args of [["--backup=none"], ["--suffix=.saved"]]) {
  test(`mv ${args.join(" ")} does not enable backups`, async () => {
    const fs = await fixture({ input: "new", output: "old" });
    assert.equal((await run("mv", [...args, "input", "output"], { fs })).exitCode, 0);
    assert.deepEqual((await fs.readdir("/work")).map(entry => entry.name), ["output"]);
  });
}

test("mv honors backup environment settings", async () => {
  const fs = await fixture({ input: "new", output: "old" });
  const result = await run("mv", ["-b", "input", "output"], { fs, env: { VERSION_CONTROL: "simple", SIMPLE_BACKUP_SUFFIX: ".env" } });
  assert.equal(result.exitCode, 0, result.stderr);
  assert.equal(Buffer.from(await fs.readFile("/work/output.env")).toString(), "old");
});

test("mv restores the destination if source rename fails", async () => {
  const backing = await fixture({ input: "new", output: "old" });
  const fs: FileSystem = new Proxy(backing, { get(target, property) {
    if (property === "rename") return async (source: string, destination: string, options: Parameters<FileSystem["rename"]>[2]) => {
      if (source === "/work/input") throw new FsError("EACCES", { path: source });
      await backing.rename(source, destination, options);
    };
    const member: unknown = Reflect.get(target, property, target);
    return typeof member === "function" ? member.bind(target) : member;
  } });
  assert.equal((await run("mv", ["-b", "input", "output"], { fs })).exitCode, 1);
  assert.equal(Buffer.from(await backing.readFile("/work/output")).toString(), "old");
  assert.equal(Buffer.from(await backing.readFile("/work/input")).toString(), "new");
  await assert.rejects(backing.lstat("/work/output~"), { code: "ENOENT" });
});

test("mv backs up a destination symlink itself", async () => {
  const fs = await fixture({ input: "new", referent: "kept" });
  await fs.symlink("referent", "/work/output");
  const result = await run("mv", ["-b", "input", "output"], { fs });
  assert.equal(result.exitCode, 0, result.stderr);
  assert.equal(await fs.readlink("/work/output~"), "referent");
  assert.equal(Buffer.from(await fs.readFile("/work/referent")).toString(), "kept");
});

test("mv simple backups replace an older backup", async () => {
  const fs = await fixture({ input: "new", output: "old", "output~": "older" });
  const result = await run("mv", ["--backup=simple", "input", "output"], { fs });
  assert.equal(result.exitCode, 0, result.stderr);
  assert.equal(Buffer.from(await fs.readFile("/work/output~")).toString(), "old");
});
