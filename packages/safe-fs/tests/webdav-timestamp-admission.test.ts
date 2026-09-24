import { afterEach, expect, it, vi } from "vitest";
import { WebDavFileSystem } from "../src/fs/webdav/webdav.js";
import { escapeXml, multistatus, resource, xmlResponse } from "./migration/fs/webdav/mock.js";

afterEach(() => vi.restoreAllMocks());

function remote(text: string) {
  const extra = '<z:propstat><z:prop><v:timestamps xmlns:v="urn:virtual-bash:metadata">'
    + escapeXml(text) + '</v:timestamps></z:prop><z:status>HTTP/1.1 200 OK</z:status></z:propstat>';
  const xml = multistatus(resource("/dav/", true, 0, extra, '"version"'));
  return new WebDavFileSystem({ baseUrl: "https://example.invalid/dav/",
    maxXmlBytes: Buffer.byteLength(xml),
    fetch: async () => xmlResponse(xml) });
}

const valid = { version: 1, etag: '"version"', type: "directory", atimeMs: -2000.5, mtimeMs: 3000 };

it.each([
  '{"junk":[' + '{},'.repeat(550_000) + '{}]}',
  JSON.stringify({ ...valid, junk: 1 }),
  JSON.stringify({ ...valid, atimeMs: [] }),
  JSON.stringify({ ...valid, atimeMs: { nested: {} } }),
  JSON.stringify(valid).slice(0, -1) + ',"version":1}',
  '[' + JSON.stringify(valid) + ']',
  ' '.repeat(4097) + JSON.stringify(valid),
])("rejects untrusted metadata before parsing its full JSON graph (%#)", async text => {
  const parse = vi.spyOn(JSON, "parse");
  await expect(remote(text).stat("/")).rejects.toMatchObject({ code: "EIO" });
  expect(parse.mock.calls.some(([input]) => input === text)).toBe(false);
});

it("retains scalar timestamps and escaped strings", async () => {
  await expect(remote(JSON.stringify(valid)).stat("/")).resolves.toMatchObject({ atimeMs: -2000.5, mtimeMs: 3000 });
});

it("ignores valid metadata for a stale entity tag", async () => {
  await expect(remote(JSON.stringify({ ...valid, etag: '"old"' })).stat("/")).resolves.toMatchObject({ atimeMs: 0 });
});
