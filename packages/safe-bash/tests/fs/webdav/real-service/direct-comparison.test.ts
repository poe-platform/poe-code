import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { FsError } from "../../../../src/contracts/errors.js";
import { WebDavFileSystem, type WebDavFileSystemOptions } from "../../../../src/fs/webdav/index.js";

const capture = JSON.parse(await readFile(new URL("./evidence/apache-final/raw.json", import.meta.url), "utf8")) as {
  events: { method: string; status: number; body: string; headers: Record<string, string> }[];
};
const grant = capture.events.find(event => event.method === "LOCK" && event.status === 200)!;
type Callback = NonNullable<WebDavFileSystemOptions["compareEntry"]>;
function fixture(compareEntry?: Callback) {
  const files = new Map([["/source", "SOURCE"], ["/target", "OLD"]]);
  const methods: string[] = [];
  const filesystem = new WebDavFileSystem({ baseUrl: "https://authority.example/dav/", ...(compareEntry ? { compareEntry } : {}), fetch: async (url, init) => {
    const path = new URL(url).pathname.slice(4);
    const method = init.method!;
    methods.push(method);
    if (method === "PROPFIND") {
      if (!files.has(path)) return new Response(null, { status: 404 });
      return new Response('<d:multistatus xmlns:d="DAV:"><d:response>'
        + `<d:href>/dav${path}</d:href><d:propstat><d:prop><d:resourcetype/><d:getcontentlength>${files.get(path)!.length}</d:getcontentlength>`
        + `<d:getetag>"${path.slice(1)}"</d:getetag></d:prop><d:status>HTTP/1.1 200 OK</d:status></d:propstat></d:response></d:multistatus>`, { status: 207 });
    }
    if (method === "LOCK") return new Response(grant.body, { headers: { "Lock-Token": grant.headers["lock-token"]! } });
    if (method === "UNLOCK") return new Response(null, { status: 204 });
    assert.ok(method === "COPY" || method === "MOVE");
    files.set("/target", files.get("/source")!);
    if (method === "MOVE") files.delete("/source");
    return new Response(null, { status: 204 });
  } });
  return { filesystem, files, methods };
}
const code = (expected: string) => (error: unknown) => { assert.ok(error instanceof FsError); assert.equal(error.code, expected); return true; };

for (const operation of ["copyFile", "rename"] as const) {
  for (const outcome of ["same", "unknown", "error", "abort", "invalid"] as const) {
    test(`direct ${operation} honors ${outcome} authority before effects`, async () => {
      const controller = new AbortController();
      const reason = new FsError("ENOENT");
      let calls = 0;
      const { filesystem, files, methods } = fixture(async function(path, peer, peerPath, options) {
        calls++; assert.equal(this, filesystem); assert.equal(peer, filesystem);
        assert.equal(path, "/source"); assert.equal(peerPath, "/target"); assert.equal(options?.signal, controller.signal);
        if (outcome === "error") throw new FsError("EACCES");
        if (outcome === "abort") { controller.abort(reason); return "distinct"; }
        if (outcome === "invalid") return "invalid" as "unknown";
        return outcome;
      });
      await assert.rejects(filesystem[operation]("/source", "/target", { signal: controller.signal }), outcome === "abort"
        ? error => error === reason : code(outcome === "same" ? "EINVAL" : outcome === "unknown" ? "ENOTSUP" : outcome === "error" ? "EACCES" : "EIO"));
      assert.equal(calls, 1); assert.ok(methods.every(method => method === "PROPFIND"));
      assert.equal(files.get("/source"), "SOURCE"); assert.equal(files.get("/target"), "OLD");
    });
  }
  test(`direct ${operation} allows explicit distinct and queries once`, async () => {
    let calls = 0;
    const { filesystem, files, methods } = fixture(async () => { calls++; return "distinct"; });
    await filesystem[operation]("/source", "/target");
    assert.equal(calls, 1); assert.equal(files.get("/target"), "SOURCE");
    assert.equal(files.has("/source"), operation === "copyFile");
    assert.ok(methods.includes("LOCK")); assert.ok(methods.includes("UNLOCK"));
  });
  test(`direct ${operation} honors a late override instead of constructor callback`, async () => {
    const { filesystem, methods } = fixture(async () => { assert.fail("constructor callback superseded"); });
    let calls = 0;
    filesystem.compareEntry = async () => { calls++; return "same"; };
    await assert.rejects(filesystem[operation]("/source", "/target"), code("EINVAL"));
    assert.equal(calls, 1); assert.ok(methods.every(method => method === "PROPFIND"));
  });
  test(`direct ${operation} notices an override without a constructor callback`, async () => {
    const { filesystem, methods } = fixture();
    filesystem.compareEntry = async () => { throw new FsError("EACCES"); };
    await assert.rejects(filesystem[operation]("/source", "/target"), code("EACCES"));
    assert.ok(methods.every(method => method === "PROPFIND"));
  });
  test(`direct ${operation} keeps absent-target native creation`, async () => {
    const { filesystem, files, methods } = fixture(async () => { assert.fail("no existing target to compare"); });
    files.delete("/target"); await filesystem[operation]("/source", "/target");
    assert.equal(files.get("/target"), "SOURCE"); assert.ok(!methods.includes("LOCK"));
  });
}
for (const outcome of ["same", "unknown", "distinct", "error", "abort"] as const) {
  test(`lexical self-rename preserves ${outcome} precedence`, async () => {
    const controller = new AbortController();
    const reason = new FsError("ENOENT");
    let calls = 0;
    const { filesystem, files, methods } = fixture(async () => {
      calls++;
      if (outcome === "error") throw new FsError("EACCES");
      if (outcome === "abort") { controller.abort(reason); return "same"; }
      return outcome;
    });
    const operation = filesystem.rename("/source", "/source", { signal: controller.signal });
    if (outcome === "same" || outcome === "unknown") await operation;
    else await assert.rejects(operation, outcome === "abort" ? error => error === reason : code(outcome === "distinct" ? "EIO" : "EACCES"));
    assert.equal(calls, 1); assert.equal(files.get("/source"), "SOURCE"); assert.ok(methods.every(method => method === "PROPFIND"));
  });
}
