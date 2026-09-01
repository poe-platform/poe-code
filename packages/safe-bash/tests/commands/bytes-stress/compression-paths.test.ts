import assert from "node:assert/strict";
import test from "node:test";
import { gunzipSync, gzipSync } from "node:zlib";
import { run } from "./helpers.js";

const fixture = {
  files: { file: "WRONG root source must remain", "target/file": "RIGHT selected source" },
  directories: ["target/inner"], links: { jump: "target/inner" },
};

test("gzip stdin-output path follows symlink before dot-dot with canonical traversal", async () => {
  const actual = await run("gzip", ["-cn", "jump/../file"], "", fixture);
  assert.equal(actual.exitCode, 0, actual.stderr.toString());
  assert.equal(gunzipSync(actual.stdout).toString(), fixture.files["target/file"]);
});

for (const keep of [false, true]) test(`gzip path resolution publishes beside real source, keep=${keep}`, async () => {
  const args = [keep ? "-kn" : "-n", "jump/../file"];
  const actual = await run("gzip", args, "", fixture);
  assert.equal(actual.exitCode, 0, actual.stderr.toString());
  await assert.rejects(actual.fs.lstat("/work/file.gz"), { code: "ENOENT" });
  if (keep) assert.equal(Buffer.from(await actual.fs.readFile("/work/target/file")).toString(), fixture.files["target/file"]);
  else await assert.rejects(actual.fs.lstat("/work/target/file"), { code: "ENOENT" });
  assert.deepEqual((await actual.fs.readdir("/work/target")).map(entry => entry.name).sort(), keep ? ["file", "file.gz", "inner"] : ["file.gz", "inner"]);
});

test("gunzip dot-dot path never truncates the lexical sibling", async () => {
  const data = { files: { "file.gz": gzipSync("WRONG"), file: "PROTECTED", "target/file.gz": gzipSync("RIGHT") }, directories: fixture.directories, links: fixture.links };
  const actual = await run("gunzip", ["-f", "jump/../file.gz"], "", data);
  assert.equal(actual.exitCode, 0, actual.stderr.toString());
  assert.equal(Buffer.from(await actual.fs.readFile("/work/file")).toString(), "PROTECTED");
  await assert.rejects(actual.fs.lstat("/work/target/file.gz"), { code: "ENOENT" });
});

test("canonical output overlap through dot-dot aliases is rejected before edits", async () => {
  const data = { ...fixture, files: { ...fixture.files, "target/file.gz": "preexisting" } };
  const result = await run("gzip", ["-f", "jump/../file", "target/file.gz"], "", data);
  assert.notEqual(result.exitCode, 0);
  for (const [name, value] of Object.entries(data.files)) assert.equal(Buffer.from(await result.fs.readFile(`/work/${name}`)).toString(), value);
});
