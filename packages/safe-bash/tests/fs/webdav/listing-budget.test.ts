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
  const options = { baseUrl: "https://example.test/dav/", fetch: async () => xmlResponse(body), maxXmlBytes: Buffer.byteLength(body), maxEntries: 257 };
  assert.equal((await new WebDavFileSystem(options).readdir("/")).length, 256);
  await assert.rejects(new WebDavFileSystem({ ...options, maxEntries: 256 }).readdir("/"), { code: "EFBIG" });
  await assert.rejects(new WebDavFileSystem({ ...options, maxXmlBytes: options.maxXmlBytes - 1 }).readdir("/"), { code: "EFBIG" });
});

test("metadata-rich listings retain XML structural admission when byte and entry budgets permit them", async () => {
  const body = listing(12_000);
  const maxXmlBytes = Buffer.byteLength(body);
  const options = { baseUrl: "https://example.test/dav/", fetch: async () => xmlResponse(body), maxXmlBytes, maxEntries: 12_001 };
  await assert.rejects(new WebDavFileSystem(options).readdir("/"), { code: "EFBIG", message: /XML content node limit exceeded/ });
});

test("minimal listings retain XML structural admission independently of byte and entry budgets", async () => {
  const body = multistatus(...Array.from({ length: 12_001 }, (_, index) => {
    const directory = index === 0;
    return `<z:response><z:href>${directory ? "/dav/" : `/dav/file${index - 1}`}</z:href><z:propstat><z:prop>`
      + `<z:resourcetype>${directory ? "<z:collection/>" : ""}</z:resourcetype>`
      + `<z:getcontentlength>${directory ? 0 : 1}</z:getcontentlength>`
      + `</z:prop><z:status>HTTP/1.1 200 OK</z:status></z:propstat></z:response>`;
  }));
  const maxXmlBytes = Buffer.byteLength(body);
  assert.ok(maxXmlBytes > 2 * 1024 * 1024);
  const options = { baseUrl: "https://example.test/dav/", fetch: async () => xmlResponse(body), maxXmlBytes, maxEntries: 12_001 };
  await assert.rejects(new WebDavFileSystem(options).readdir("/"), { code: "EFBIG", message: /XML content node limit exceeded/ });
});
