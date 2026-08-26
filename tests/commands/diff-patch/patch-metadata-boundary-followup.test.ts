import assert from "node:assert/strict";
import test from "node:test";
import { contents, native, replacement, run } from "./helpers.js";

const input = replacement.replaceAll("target", "first") + replacement + "-old\n";
const files = { first: "old\n", target: "old\n" };

test("followup atomic staging rejects orphan deletion payload before any effects", async () => {
  const result = await run("patch", ["--atomic"], { files, input });
  assert.equal(result.exitCode, 2, result.stderr);
  assert.equal(result.stdout, "");
  assert.match(result.stderr, /unexpected deletion/u);
  assert.equal(await contents(result.fs, "first"), "old\n");
  assert.equal(await contents(result.fs, "target"), "old\n");
  assert.deepEqual((await result.fs.readdir("/work")).map(entry => entry.name).sort(), ["first", "target"]);
});

test("followup default GNU scanning still accepts trailing deletion-like text", async () => {
  const expected = await native("patch", ["--batch"], files, input);
  assert.equal(expected.exitCode, 0, expected.stderr);
  const result = await run("patch", ["--batch"], { files, input });
  assert.equal(result.exitCode, expected.exitCode, result.stderr);
  assert.equal(result.stdout, expected.stdout);
  assert.equal(result.stderr, expected.stderr);
  assert.equal(await contents(result.fs, "first"), expected.files.first);
  assert.equal(await contents(result.fs, "target"), expected.files.target);
});
