import assert from "node:assert/strict";
import test from "node:test";
import { replacement } from "./fixtures.js";
import { expectedBytes, fileBytes, memory, run } from "./helpers.js";

for (const [name, quoted, args] of [
  ["decoded absolute", '"\\057work/target"', []],
  ["decoded traversal", '"\\056\\056/target"', []],
  ["traversal cannot disappear during strip", '"\\056\\056/target"', ["-p1"]],
  ["traversal after strip", '"a/\\056\\056/target"', ["-p1"]],
  ["decoded NUL", '"target\\000suffix"', []],
  ["decoded backslash traversal", '"..\\\\target"', []],
  ["explicit target cannot override unsafe decoded header", '"\\057work/target"', ["target"]],
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

for (const [name, quoted, linkTarget, linkPath] of [
  ["quoted final symlink", '"alias"', "target", "/work/alias"],
  ["quoted ancestor symlink", '"alias/target"', "dir", "/work/alias"],
] as const) test(`quoted-path security: ${name}`, async () => {
  const files = { first: "old\n", target: "old\n", "dir/target": "old\n" };
  const filesystem = await memory(files);
  await filesystem.symlink(linkTarget, linkPath);
  const originalLink = await filesystem.lstat(linkPath);
  const result = await run("patch", [], filesystem, replacement("first") + replacement(quoted));
  assert.equal(result.status, 2, result.stderr.toString());
  assert.deepEqual(result.stdout, Buffer.alloc(0));
  assert.deepEqual(await fileBytes(filesystem, Object.keys(files)), expectedBytes(files));
  assert.deepEqual(await filesystem.lstat(linkPath), originalLink);
});
