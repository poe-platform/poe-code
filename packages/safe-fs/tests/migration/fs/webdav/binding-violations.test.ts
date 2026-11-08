import assert from "node:assert/strict";
import { test } from "vitest";
import { FsError } from "../../../../src/contracts/errors.js";
import { createMemoryFileSystem } from "../../../../src/fs/memory/index.js";
import { createMountFileSystem } from "../../../../src/fs/mount/index.js";
import { WebDavFileSystem } from "../../../../src/fs/webdav/index.js";
import type { WebDavFetch } from "../../../../src/fs/webdav/index.js";
import { MockDav } from "./mock.js";

const original = new TextEncoder().encode("source sentinel");
const damaged = new TextEncoder().encode("contract violation damaged source");
const baseUrl = "https://violation.example/dav/";

for (const direction of ["to-remote", "from-remote"] as const) {
  test(`NONCOMPLIANT characterization: Mock metadata with local content routing ${direction}`, async () => {
    const memory = createMemoryFileSystem();
    await memory.writeFile("/source", original);
    const mock = new MockDav();
    mock.files.set("/source", original.slice());
    const effects: string[] = [];
    const fetch: WebDavFetch = async (url, init) => {
      if (init.method === "GET") { effects.push("GET"); return new Response(damaged); }
      if (init.method === "PUT") {
        effects.push("PUT");
        assert.deepEqual(new Uint8Array(await new Response(init.body).arrayBuffer()), original);
        await memory.writeFile("/source", damaged);
        return new Response(null, { status: 500 });
      }
      return mock.fetch(url, init);
    };
    const remote = new WebDavFileSystem({ baseUrl, fetch, overwritePolicy: "etag", requestStreamSupport: true });
    assert.equal(await remote.compareEntry("/source", memory, "/source"), "distinct");
    const mounted = createMountFileSystem({ root: createMemoryFileSystem(), mounts: { "/local": memory, "/remote": remote } });
    const paths = direction === "to-remote" ? ["/local/source", "/remote/source"] : ["/remote/source", "/local/source"];
    const failure = await mounted.copyFile(paths[0]!, paths[1]!).then(() => undefined, error => error);
    if (direction === "to-remote") { assert.ok(failure instanceof FsError); assert.equal(failure.code, "EIO"); }
    else assert.equal(failure, undefined);
    assert.deepEqual(effects, [direction === "to-remote" ? "PUT" : "GET"]);
    assert.deepEqual(await memory.readFile("/source"), damaged);
    assert.deepEqual(mock.files.get("/source"), original);
    console.info(JSON.stringify({ classification: "host binding violation, NOT compliant workflow success", direction, effects, source: [...await memory.readFile("/source")] }));
  });
}
