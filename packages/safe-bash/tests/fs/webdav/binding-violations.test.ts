import assert from "node:assert/strict";
import test from "node:test";
import { FsError } from "../../../src/contracts/errors.js";
import { createMemoryFileSystem } from "../../../src/fs/memory/index.js";
import { createMountFileSystem } from "../../../src/fs/mount/index.js";
import { WebDavFileSystem } from "../../../src/fs/webdav/index.js";
import type { WebDavFetch } from "../../../src/fs/webdav/index.js";
import { MockDav } from "./mock.js";

const original = new TextEncoder().encode("source sentinel");
const damaged = new TextEncoder().encode("contract violation damaged source");
const baseUrl = "https://violation.example/dav/";

for (const direction of ["to-remote", "from-remote"] as const) {
  test(`public fail-closed: untrusted Mock metadata with local content routing ${direction}`, async context => {
    const memory = createMemoryFileSystem();
    await memory.writeFile("/source", original);
    const mock = new MockDav();
    mock.files.set("/source", original.slice());
    const effects: string[] = [];
    const fetch: WebDavFetch = async (url, init) => {
      if (init.method === "GET") { effects.push("GET"); return new Response(damaged); }
      if (init.method === "PUT") {
        effects.push("PUT");
        await memory.writeFile("/source", damaged);
        return new Response(null, { status: 500 });
      }
      return mock.fetch(url, init);
    };
    const remote = new WebDavFileSystem({ baseUrl, fetch, overwritePolicy: "etag" });
    assert.equal(await remote.compareEntry("/source", memory, "/source"), "unknown");
    const mounted = createMountFileSystem({ root: createMemoryFileSystem(), mounts: { "/local": memory, "/remote": remote } });
    const paths = direction === "to-remote" ? ["/local/source", "/remote/source"] : ["/remote/source", "/local/source"];
    const failure = await mounted.copyFile(paths[0]!, paths[1]!).then(() => undefined, error => error);
    assert.ok(failure instanceof FsError);
    assert.equal(failure.code, "ENOTSUP");
    assert.deepEqual(effects, []);
    assert.deepEqual(await memory.readFile("/source"), original);
    assert.deepEqual(mock.files.get("/source"), original);
    context.diagnostic(JSON.stringify({ classification: "untrusted protocol metadata refused before content effects", direction, effects, source: [...await memory.readFile("/source")] }));
  });
}

test("NONCOMPLIANT characterization: inherited Mock identity with different local writeStream backing", async context => {
  const memory = createMemoryFileSystem();
  await memory.writeFile("/source", original);
  const effects: string[] = [];
  class WrongBacking extends WebDavFileSystem {
    override async readFile() { effects.push("readFile"); return memory.readFile("/source"); }
    override async *readStream() { effects.push("readStream"); yield await memory.readFile("/source"); }
    override async writeFile() { effects.push("writeFile"); await memory.writeFile("/source", damaged); throw new FsError("EIO"); }
    override async writeStream() { effects.push("writeStream"); await memory.writeFile("/source", damaged); throw new FsError("EIO"); }
  }
  const make = () => {
    const mock = new MockDav();
    mock.files.set("/source", original.slice());
    return new WrongBacking({ baseUrl, fetch: mock.fetch });
  };
  const first = make(), second = make();
  assert.equal(await first.compareEntry("/source", second, "/source"), "distinct");
  const mounted = createMountFileSystem({ root: createMemoryFileSystem(), mounts: { "/first": first, "/second": second } });
  await assert.rejects(mounted.copyFile("/first/source", "/second/source"), error => error instanceof FsError && error.code === "EIO");
  assert.deepEqual(effects, ["writeStream"]);
  assert.deepEqual(await memory.readFile("/source"), damaged);
  context.diagnostic(JSON.stringify({ classification: "host binding violation, NOT compliant workflow success", effects, source: [...await memory.readFile("/source")] }));
});
