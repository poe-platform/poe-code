import assert from "node:assert/strict";
import test from "node:test";
import { gunzipSync, gzipSync } from "node:zlib";
import { memory, run, wrap } from "./helpers.js";

const fixture = {
  files: { file: "WRONG root source must remain", "target/file": "RIGHT selected source" },
  directories: ["target/inner"], links: { jump: "target/inner" },
};

for (const mode of ["-c", "-k"]) test(`gzip ${mode} pins source across a transient ancestor swap`, async () => {
  const fs = await memory({ files: { "sub/a": "ordinary", "private/a": "topsecret" } });
  const swap = async <T>(read: () => Promise<T>): Promise<T> => {
    await fs.rename("/work/sub", "/work/held");
    await fs.symlink("/work/private", "/work/sub");
    try { return await read(); }
    finally { await fs.rm("/work/sub"); await fs.rename("/work/held", "/work/sub"); }
  };
  let closed = 0;
  const wrapped = wrap(fs, {
    readStream: (path, options) => (async function* () {
      const chunks = await swap(async () => {
        const data: Uint8Array[] = [];
        for await (const chunk of fs.readStream(path, options)) data.push(chunk);
        return data;
      });
      yield* chunks;
    })(),
    async openReadFile(path, options) {
      const handle = await fs.openReadFile(path, options);
      return { stat: handle.stat.bind(handle),
        read: (offset, length, readOptions) => swap(() => handle.read(offset, length, readOptions)),
        async close() { closed++; await handle.close(); } };
    },
  });
  const actual = await run("gzip", [mode, "sub/a"], "", {}, { fs: wrapped });
  assert.equal(actual.exitCode, 0, actual.stderr.toString());
  const compressed = mode === "-c" ? actual.stdout : await fs.readFile("/work/sub/a.gz");
  assert.equal(gunzipSync(compressed).toString(), "ordinary");
  assert.equal(closed, 1);
  assert.equal(Buffer.from(await fs.readFile("/work/sub/a")).toString(), "ordinary");
});

for (const mode of ["-c", "-k"]) test(`gzip ${mode} rejects a different file opened after preflight`, async () => {
  const fs = await memory({ files: { "sub/a": "ordinary", "private/a": "topsecret" } });
  let reads = 0;
  let closes = 0;
  const wrapped = wrap(fs, { async openReadFile(_path, options) {
    const handle = await fs.openReadFile("/work/private/a", options);
    return { stat: handle.stat.bind(handle),
      async read(offset, length, readOptions) { reads++; return handle.read(offset, length, readOptions); },
      async close() { closes++; await handle.close(); } };
  } });
  const actual = await run("gzip", [mode, "sub/a"], "", {}, { fs: wrapped });
  assert.equal(actual.exitCode, 1);
  assert.equal(reads, 0);
  assert.equal(closes, 1);
  assert.equal(actual.stdout.length, 0);
  await assert.rejects(fs.lstat("/work/sub/a.gz"), { code: "ENOENT" });
  assert.deepEqual((await fs.readdir("/work/sub")).map(entry => entry.name), ["a"]);
});

test("gzip refuses a backend without retained reads before acquiring source or output", async () => {
  const fs = await memory({ files: { a: "ordinary" } });
  const capabilities = { ...fs.capabilities, retainedRead: false };
  const wrapped = wrap(fs, { capabilities, async capabilitiesFor() { return capabilities; },
    async openReadFile() { assert.fail("unsupported source acquired"); },
    async mkdir() { assert.fail("output stage acquired"); } });
  for (const mode of ["-c", "-k"]) {
    const actual = await run("gzip", [mode, "a"], "", {}, { fs: wrapped });
    assert.equal(actual.exitCode, 1);
    assert.equal(actual.stdout.length, 0);
  }
});

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
