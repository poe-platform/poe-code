import assert from "node:assert/strict";
import test from "node:test";
import { WebDavFileSystem } from "../../../../src/fs/webdav/index.js";

function fixture(after: "stable" | "changed" | "omitted" | "denied" | "abort") {
  const methods: string[] = [];
  const controller = new AbortController();
  let metadata = "";
  const filesystem = new WebDavFileSystem({
    baseUrl: "https://postcondition.example/dav/",
    fetch: async (_url, init) => {
      methods.push(init.method!);
      if (init.method === "PROPPATCH") {
        metadata = String(init.body).match(/<v:timestamps>(.*?)<\/v:timestamps>/)![1]!;
        return new Response('<d:multistatus xmlns:d="DAV:"><d:response><d:href>/dav/directory/</d:href>'
          + '<d:propstat><d:prop><v:timestamps xmlns:v="urn:virtual-bash:metadata"/></d:prop>'
          + '<d:status>HTTP/1.1 200 OK</d:status></d:propstat></d:response></d:multistatus>', { status: 207 });
      }
      if (metadata && after === "denied") return new Response(null, { status: 403 });
      if (metadata && after === "abort") controller.abort(new Error("postcondition cancelled"));
      const etag = metadata && after === "changed" ? '"after"' : '"before"';
      return new Response('<d:multistatus xmlns:d="DAV:"><d:response><d:href>/dav/directory/</d:href>'
        + '<d:propstat><d:prop><d:resourcetype><d:collection/></d:resourcetype>'
        + `<d:getetag>${etag}</d:getetag><d:getlastmodified>Thu, 01 Jan 1970 00:00:00 GMT</d:getlastmodified>`
        + (metadata && after !== "omitted" ? `<v:timestamps xmlns:v="urn:virtual-bash:metadata">${metadata}</v:timestamps>` : "")
        + '</d:prop><d:status>HTTP/1.1 200 OK</d:status></d:propstat></d:response></d:multistatus>', { status: 207 });
    },
  });
  return { filesystem, methods, controller };
}

for (const behavior of ["changed", "omitted"] as const) {
  test(`utimes rejects accepted property with ${behavior} observable timestamp binding`, async () => {
    const { filesystem, methods } = fixture(behavior);
    await assert.rejects(filesystem.utimes("/directory", 1234.5, -6789), { code: "EAGAIN", syscall: "utimes", path: "/directory" });
    assert.deepEqual(methods, ["PROPFIND", "PROPPATCH", "PROPFIND"]);
  });
}

test("utimes validates a stable successful property exactly once without retry", async () => {
  const { filesystem, methods } = fixture("stable");
  await filesystem.utimes("/directory", 1234.5, -6789);
  assert.deepEqual(methods, ["PROPFIND", "PROPPATCH", "PROPFIND"]);
});

for (const behavior of ["denied", "abort"] as const) {
  test(`utimes postcondition preserves ${behavior} instead of returning success`, async () => {
    const { filesystem, methods, controller } = fixture(behavior);
    await assert.rejects(filesystem.utimes("/directory", 1234.5, -6789, { signal: controller.signal }), { code: behavior === "denied" ? "EACCES" : "ECANCELED" });
    assert.deepEqual(methods, ["PROPFIND", "PROPPATCH", "PROPFIND"]);
  });
}
