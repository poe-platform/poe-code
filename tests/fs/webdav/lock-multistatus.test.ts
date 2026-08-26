import assert from "node:assert/strict";
import test from "node:test";
import { FsError } from "../../../src/contracts/errors.js";
import { WebDavFileSystem } from "../../../src/fs/webdav/index.js";
import type { WebDavFileSystemOptions } from "../../../src/fs/webdav/index.js";
import { escapeXml, MockDav, multistatus, xmlResponse } from "./mock.js";

function member(href: string, status: number): string {
  return `<z:response><z:href>${escapeXml(href)}</z:href><z:status>HTTP/1.1 ${status} Failure</z:status></z:response>`;
}

function fixture(response: Response, options: Partial<WebDavFileSystemOptions> = {}) {
  const mock = new MockDav();
  mock.files.set("/source", null);
  mock.files.set("/source/file", new Uint8Array([1]));
  mock.files.set("/target", null);
  const before = new Map(mock.files);
  const methods: (string | undefined)[] = [];
  const fs = new WebDavFileSystem({ ...options, baseUrl: "https://example.test/dav/", fetch: async (url, init) => {
    methods.push(init.method);
    if (init.method === "LOCK") return response;
    return mock.fetch(url, init);
  } });
  const unchanged = (): void => {
    assert.deepEqual(methods, ["PROPFIND", "PROPFIND", "LOCK"]);
    assert.deepEqual(mock.files, before);
    assert.equal(mock.locks.size, 0);
    assert.equal(response.body?.locked, false);
  };
  return { fs, unchanged, methods };
}

for (const status of [423, 403]) {
  for (const rootFirst of [false, true]) {
    test(`LOCK 207 retains child ${status} instead of ${rootFirst ? "preceding" : "following"} root 424`, async () => {
      const entries = [member("/dav/target/child", status), member("/dav/target/", 424)];
      if (rootFirst) entries.reverse();
      const { fs, unchanged } = fixture(xmlResponse(multistatus(...entries), { "Lock-Token": "<urn:uuid:not-granted>" }));
      await assert.rejects(fs.rename("/source", "/target"), (error: unknown) => {
        assert.ok(error instanceof FsError);
        assert.equal(error.code, status === 423 ? "EBUSY" : "EACCES");
        assert.equal(error.syscall, "LOCK");
        assert.equal(error.path, "/target");
        assert.ok(error.cause instanceof FsError);
        assert.equal(error.cause.syscall, "LOCK");
        assert.equal(error.cause.path, "/target/child");
        assert.match(error.cause.message, new RegExp(`HTTP status ${status}`));
        return true;
      });
      unchanged();
    });
  }
}

for (const status of [403, 423, 424]) {
  test(`LOCK 207 retains a root-only ${status} failure and cause`, async () => {
    const { fs, unchanged } = fixture(xmlResponse(multistatus(member("/dav/target/", status))));
    await assert.rejects(fs.rename("/source", "/target"), (error: unknown) => {
      assert.ok(error instanceof FsError);
      assert.equal(error.code, status === 403 ? "EACCES" : status === 423 ? "EBUSY" : "EIO");
      assert.equal(error.syscall, "LOCK");
      assert.equal(error.path, "/target");
      assert.ok(error.cause instanceof FsError);
      assert.equal(error.cause.path, "/target");
      assert.match(error.cause.message, new RegExp(`HTTP status ${status}`));
      return true;
    });
    unchanged();
  });
}

for (const href of ["https://foreign.test/dav/target/child", "/outside/child", "/dav/other/child", "/dav/target-sibling/child",
  "/dav/target/%2e%2e/child", "/dav/target/child%2fescape", "/dav/", "//foreign.test/dav/target/child"]) {
  test(`LOCK 207 validates every href before reporting a failure: ${href}`, async () => {
    const { fs, unchanged } = fixture(xmlResponse(multistatus(member("/dav/target/child", 423), member(href, 403))));
    await assert.rejects(fs.rename("/source", "/target"), { code: "EACCES", syscall: "LOCK", path: "/target" });
    unchanged();
  });
}

for (const [name, xml] of [
  ["malformed XML", '<z:multistatus xmlns:z="DAV:"><z:response>'],
  ["wrong namespace", '<z:multistatus xmlns:z="urn:foreign"/>'],
  ["missing status", multistatus('<z:response><z:href>/dav/target/</z:href></z:response>')],
  ["invalid status", multistatus(member("/dav/target/", 423).replace("HTTP/1.1 423", "not-a-status"))],
  ["duplicate member", multistatus(member("/dav/target/", 423), member("/dav/target/", 403))],
  ["empty multistatus", multistatus()],
  ["success-only multistatus", multistatus(member("/dav/target/", 200))],
  ["late malformed member", multistatus(member("/dav/target/child", 423), "<z:response/>")],
] as const) {
  test(`LOCK 207 rejects ${name} with LOCK context and a cause`, async () => {
    const { fs, unchanged } = fixture(xmlResponse(xml));
    await assert.rejects(fs.rename("/source", "/target"), (error: unknown) => {
      assert.ok(error instanceof FsError);
      assert.equal(error.code, "EIO");
      assert.equal(error.syscall, "LOCK");
      assert.equal(error.path, "/target");
      assert.ok(error.cause instanceof Error);
      unchanged();
      return true;
    });
  });
}

for (const limit of ["bytes", "entries"] as const) {
  test(`LOCK 207 enforces ${limit} budget and cancels the body`, async () => {
    let cancelled = false;
    const xml = limit === "bytes" ? " ".repeat(2049) : multistatus(member("/dav/target/", 424), member("/dav/target/child", 423));
    const response = new Response(new ReadableStream<Uint8Array>({
      start(controller) { controller.enqueue(new TextEncoder().encode(xml)); },
      pull(controller) { if (limit === "entries") controller.close(); },
      cancel() { cancelled = true; },
    }), { status: 207 });
    const { fs, unchanged } = fixture(response, limit === "bytes" ? { maxXmlBytes: 2048 } : { maxEntries: 1 });
    await assert.rejects(fs.rename("/source", "/target"), { code: "EFBIG", syscall: "LOCK", path: "/target" });
    if (limit === "bytes") assert.equal(cancelled, true);
    unchanged();
  });
}

test("LOCK multistatus handling does not relax root replacement policy", async () => {
  const { fs, methods } = fixture(xmlResponse(multistatus(member("/dav/", 403))));
  await assert.rejects(fs.rename("/source", "/"), { code: "EBUSY", syscall: "MOVE" });
  await assert.rejects(fs.rename("/", "/target"), { code: "EBUSY", syscall: "MOVE" });
  await assert.rejects(fs.copyFile("/source/file", "/"), { code: "EBUSY", syscall: "COPY" });
  assert.deepEqual(methods, []);
});
