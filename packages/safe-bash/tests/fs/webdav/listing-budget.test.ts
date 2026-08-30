import assert from "node:assert/strict";
import { test } from "node:test";
import { WebDavFileSystem } from "../../../src/fs/webdav/index.js";
import { multistatus, resource, xmlResponse } from "./mock.js";

function listing(count: number): string {
  return multistatus(resource("/dav/", true), ...Array.from({ length: count }, (_, index) => resource(`/dav/file${index}`, false, 1)
    .replace("<z:response>", '<z:response xmlns:z="DAV:" xml:lang="en">')));
}

test("root plus 256 locally namespaced DAV children fit the advertised listing budget", async () => {
  const body = listing(256);
  assert.ok(Buffer.byteLength(body) < 2 * 1024 * 1024);
  const fs = new WebDavFileSystem({ baseUrl: "https://example.test/dav/", fetch: async () => xmlResponse(body) });
  const entries = await fs.readdir("/");
  assert.equal(entries.length, 256);
  assert.ok(entries.every((entry) => entry.type === "file"));
});

test("configured large listings are bounded by bytes and entries, not hidden document counters", async () => {
  const body = listing(12_000);
  const maxXmlBytes = Buffer.byteLength(body);
  const options = { baseUrl: "https://example.test/dav/", fetch: async () => xmlResponse(body), maxXmlBytes, maxEntries: 12_001 };
  assert.equal((await new WebDavFileSystem(options).readdir("/")).length, 12_000);
  await assert.rejects(new WebDavFileSystem({ ...options, maxEntries: 12_000 }).readdir("/"), { code: "EFBIG" });
  await assert.rejects(new WebDavFileSystem({ ...options, maxXmlBytes: maxXmlBytes - 1 }).readdir("/"), { code: "EFBIG" });
});
