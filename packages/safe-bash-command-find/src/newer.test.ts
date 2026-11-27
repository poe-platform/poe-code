import assert from "node:assert/strict";
import test from "node:test";
import { createMemoryFileSystem } from "@poe-code/safe-fs";
import { toByteSource, type FileStat, type FileSystem } from "safe-bash-contracts";
import { createFindCommand } from "./index.js";

async function run(fs: FileSystem, args: string[], env: Record<string, string> = {}) {
  let stdout = "", stderr = "";
  const result = await createFindCommand().execute({
    command: "find", args, cwd: "/", env, fs,
    signal: new AbortController().signal, stdin: toByteSource(""),
    stdout: { async write(bytes) { stdout += new TextDecoder().decode(bytes); } },
    stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } },
  });
  return { ...result, stdout, stderr };
}

const fields = { a: "atimeMs", c: "ctimeMs", m: "mtimeMs", B: "birthtimeMs" } as const;
for (const [x, field] of Object.entries(fields)) {
  for (const [y, referenceField] of Object.entries(fields)) {
    test(`find -newer${x}${y} compares the selected timestamps strictly`, async context => {
      const fs = createMemoryFileSystem();
      const reference: FileStat = { type: "file", size: 0, mode: 0o644, atimeMs: 100, ctimeMs: 200, mtimeMs: 300, birthtimeMs: 400 };
      context.mock.method(fs, "lstat", async (path: string) => path === "/reference" ? reference : {
        ...reference, [field]: reference[referenceField]! + (path === "/older" ? -1 : path === "/newer" ? 1 : 0),
      });
      assert.deepEqual(await run(fs, ["older", "equal", "newer", `-newer${x}${y}`, "reference"]),
        { exitCode: 0, stdout: "newer\n", stderr: "" });
    });
  }
  test(`find -newer${x}t compares the selected timestamp to a date`, async context => {
    const fs = createMemoryFileSystem();
    context.mock.method(fs, "lstat", async (path: string) => ({
      type: "file", size: 0, mode: 0o644, atimeMs: 0, ctimeMs: 0, mtimeMs: 0, birthtimeMs: 0,
      [field]: Date.UTC(2020, 5, 1) + (path === "/older" ? -1 : path === "/newer" ? 1 : 0),
    }));
    assert.deepEqual(await run(fs, ["older", "equal", "newer", `-newer${x}t`, "2020-06-01"]),
      { exitCode: 0, stdout: "newer\n", stderr: "" });
  });
}

test("find snapshots a shared reference once for different timestamp fields", async context => {
  const fs = createMemoryFileSystem();
  await fs.writeFile("/candidate", new Uint8Array());
  await fs.writeFile("/reference", new Uint8Array());
  await fs.utimes("/candidate", 150, 150);
  await fs.utimes("/reference", 100, 200);
  const lstat = fs.lstat.bind(fs);
  let reads = 0;
  context.mock.method(fs, "lstat", async (path: string) => {
    if (path === "/reference") reads++;
    return lstat(path);
  });
  assert.deepEqual(await run(fs, ["candidate", "-newerma", "reference", "!", "-newermm", "reference"]),
    { exitCode: 0, stdout: "candidate\n", stderr: "" });
  assert.equal(reads, 1);
});

for (const [date, timezone] of [["2020-06-01", "UTC"], ["2020-05-31 20:00:00", "EST5EDT"],
  ["2020-06-01T02:00:00+02:00", "UTC"], ["@1590969600", "UTC"], ["1 day ago", "UTC"]]) {
  test(`find date comparison parses ${date} in ${timezone}`, async context => {
    context.mock.method(Date, "now", () => Date.UTC(2020, 5, 2));
    const fs = createMemoryFileSystem();
    await fs.writeFile("/file", new Uint8Array());
    await fs.utimes("/file", 0, Date.UTC(2020, 5, 1) + 1);
    assert.deepEqual(await run(fs, ["file", "-newermt", date!, "!", "-newermt", "@1590969600.001"], { TZ: timezone! }),
      { exitCode: 0, stdout: "file\n", stderr: "" });
  });
}

for (const args of [["-newermt"], ["-newermt", "not-a-date"], ["-newermt", "2020-02-30"],
  ["-newerma", "missing"], ["-newertm", "reference"], ["-newermx", "reference"]]) {
  test(`find validates ${args.join(" ")} before deleting`, async () => {
    const fs = createMemoryFileSystem();
    await fs.writeFile("/keep", new Uint8Array());
    const result = await run(fs, ["keep", "-delete", ...args]);
    assert.notEqual(result.exitCode, 0);
    assert.notEqual(result.stderr, "");
    assert.equal(result.stdout, "");
    assert.ok(await fs.lstat("/keep"));
  });
}

test("find treats missing candidate birth time as false and rejects missing reference birth time", async context => {
  const fs = createMemoryFileSystem();
  await fs.writeFile("/file", new Uint8Array());
  const { birthtimeMs: ignored, ...stat } = await fs.lstat("/file");
  context.mock.method(fs, "lstat", async () => stat);
  assert.deepEqual(await run(fs, ["file", "-newerBt", "@0"]), { exitCode: 0, stdout: "", stderr: "" });
  const result = await run(fs, ["file", "-delete", "-newermB", "file"]);
  assert.notEqual(result.exitCode, 0);
  assert.ok(result.stderr.includes("birth time"));
  assert.equal(result.stdout, "");
  assert.deepEqual(await fs.readdir("/"), [{ name: "file", type: "file" }]);
});
