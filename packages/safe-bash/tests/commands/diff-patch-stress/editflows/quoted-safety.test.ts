import assert from "node:assert/strict";
import test from "node:test";
import { instrument, snapshot } from "../safety/helpers.js";
import { replacement } from "./fixtures.js";
import { expectedBytes, fileBytes, memory, run } from "./helpers.js";

for (const [name, quoted, args] of [
  ["decoded absolute", '"\\057work/target"', []],
  ["decoded traversal", '"\\056\\056/target"', []],
  ["traversal cannot disappear during strip", '"\\056\\056/target"', ["-p1"]],
  ["traversal after strip", '"a/\\056\\056/target"', ["-p1"]],
  ["decoded NUL", '"target\\000suffix"', []],
  ["decoded backslash traversal", '"..\\\\target"', []],
] as const) test(`quoted-path security: ${name}`, async () => {
  const files = { target: "old\n", first: "old\n", sentinel: "untouched\n" };
  const filesystem = await memory(files);
  await filesystem.writeFile("/target", Buffer.from("outside cwd\n"));
  const before = await filesystem.lstat("/work/target");
  const argumentsList: readonly string[] = args;
  const stripped = argumentsList.includes("-p1");
  const firstSection = argumentsList.includes("target") ? "" : replacement(stripped ? "a/first" : "first");
  const result = await run("patch", args, filesystem, firstSection + replacement(stripped ? "a/target" : "target", quoted));
  assert.equal(result.status, 2, result.stderr.toString());
  assert.deepEqual(result.stdout, Buffer.alloc(0));
  assert.deepEqual(await fileBytes(filesystem, Object.keys(files)), expectedBytes(files));
  assert.deepEqual(Buffer.from(await filesystem.readFile("/target")), Buffer.from("outside cwd\n"));
  const after = await filesystem.lstat("/work/target");
  assert.deepEqual({ ...after, atimeMs: before.atimeMs }, before);
});

test("quoted-path security: explicit target overrides absolute header without touching header names", async () => {
  const filesystem = await memory({ authorized: "old\n", target: "old\n", first: "old\n", sentinel: "untouched\n" });
  await filesystem.writeFile("/target", Buffer.from("outside cwd\n"));
  const before = await snapshot(filesystem);
  const target = "/work/authorized";
  const original = await filesystem.lstat(target);
  const expected = before.map(entry => {
    assert(typeof entry === "object" && entry !== null && "path" in entry);
    return entry.path === target ? { ...entry, data: Buffer.from("new\n").toString("hex") } : entry;
  });
  const observed = instrument(filesystem);
  const result = await run("patch", ["authorized"], observed.fs, replacement("target", '"\\057work/target"'));
  assert.equal(result.status, 0, result.stderr.toString());
  assert.deepEqual(result.stderr, Buffer.alloc(0));
  assert.deepEqual(result.stdout, Buffer.from("patching file authorized\n"));
  assert.deepEqual(observed.mutations().map(operation => ({ method: operation.method, path: operation.path })),
    [{ method: "publishStagedFile", path: target }]);
  const published = await filesystem.lstat(target);
  assert.notEqual(published.ino, original.ino, "publication replaces the target with its staged file");
  assert.deepEqual(await snapshot(filesystem), expected.map(entry => entry.path === target ? { ...entry, ino: published.ino } : entry),
    "Only the explicit target changes; header names and all other VFS entries remain intact");
});

for (const [name, quoted, linkTarget, linkPath, args] of [
  ["quoted final symlink", '"alias"', "target", "/work/alias", []],
  ["selected quoted ancestor symlink with -p0", '"alias/target"', "dir", "/work/alias", ["-p0"]],
] as const) test(`quoted-path security: ${name}`, async () => {
  const files = { first: "old\n", target: "old\n", "dir/target": "old\n" };
  const filesystem = await memory(files);
  await filesystem.symlink(linkTarget, linkPath);
  const originalLink = await filesystem.lstat(linkPath);
  const result = await run("patch", args, filesystem, replacement("first") + replacement(quoted));
  assert.equal(result.status, 2, result.stderr.toString());
  assert.deepEqual(result.stdout, Buffer.alloc(0));
  assert.deepEqual(await fileBytes(filesystem, Object.keys(files)), expectedBytes(files));
  assert.deepEqual(await filesystem.lstat(linkPath), originalLink);
});

test("quoted-path security: GNU default strips the unselected symlink ancestor and changes only basenames", async () => {
  const filesystem = await memory({ first: "old\n", target: "old\n", "dir/target": "old\n" });
  await filesystem.symlink("dir", "/work/alias");
  const before = await snapshot(filesystem);
  const observed = instrument(filesystem);
  const result = await run("patch", [], observed.fs, replacement("first") + replacement('"alias/target"'));
  assert.equal(result.status, 0, result.stderr.toString());
  assert.deepEqual(result.stdout, Buffer.from("patching file first\npatching file target\n"));
  assert.deepEqual(result.stderr, Buffer.alloc(0));
  assert.deepEqual(observed.mutations().map(operation => ({ method: operation.method, path: operation.path })),
    [{ method: "publishStagedFile", path: "/work/first" }, { method: "publishStagedFile", path: "/work/target" }]);
  const expected = await Promise.all(before.map(async entry => {
    assert(typeof entry === "object" && entry !== null && "path" in entry && "ino" in entry);
    if (entry.path !== "/work/first" && entry.path !== "/work/target") return entry;
    const published = await filesystem.lstat(entry.path);
    assert.notEqual(published.ino, entry.ino, "publication replaces each selected target with its staged file");
    return { ...entry, ino: published.ino, data: Buffer.from("new\n").toString("hex") };
  }));
  assert.deepEqual(await snapshot(filesystem), expected, "Only the selected basenames change; aliases, referents and other entries remain intact");
});
