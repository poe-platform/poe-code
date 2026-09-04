import { describe, expect, it } from "vitest";
import { WebDavFileSystem } from "../src/fs/webdav/webdav.js";
import { parseXml, XmlResponseLimitError } from "../src/fs/webdav/xml.js";
import { multistatus, resource, xmlResponse } from "./migration/fs/webdav/mock.js";

function remote(xml: string, maxEntries = 10_000, maxXmlBytes = 2 * 1024 * 1024) {
  return new WebDavFileSystem({
    baseUrl: "https://example.invalid/dav/", maxEntries, maxXmlBytes,
    fetch: async () => xmlResponse(xml),
  });
}

describe("WebDAV XML allocation admission", () => {
  // The multistatus root and directory resource contain exactly eleven elements.
  it.each([99_989, 99_990])("admits independent node boundary with %s ignored elements", async count => {
    const xml = multistatus(resource("/dav/", true), "<x/>".repeat(count));
    const result = remote(xml).stat("/");
    if (count === 99_989) await expect(result).resolves.toMatchObject({ type: "directory" });
    else await expect(result).rejects.toMatchObject({ code: "EIO", cause: { message: expect.stringContaining("XML resource limit") } });
  });

  // The root namespace declaration consumes one attribute; sibling scopes do not accumulate.
  it.each([9_999, 10_000])("admits independent attribute boundary with %s ignored attributes", async count => {
    const xml = multistatus(resource("/dav/", true), '<x a=""/>'.repeat(count));
    const result = remote(xml).stat("/");
    if (count === 9_999) await expect(result).resolves.toMatchObject({ type: "directory" });
    else await expect(result).rejects.toMatchObject({ code: "EIO", cause: { message: expect.stringContaining("XML attribute limit") } });
  });

  it("refuses the excess DAV response before parsing its malformed descendants", async () => {
    const xml = multistatus(resource("/dav/", true), "<z:response><broken></z:response>");
    await expect(remote(xml, 1).readdir("/")).rejects.toMatchObject({
      code: "EFBIG", syscall: "PROPFIND", path: "",
    });
  });

  it("preserves the existing complete-response overflow error profile", async () => {
    const xml = multistatus(resource("/dav/", true), resource("/dav/child"));
    await expect(remote(xml, 1).readdir("/")).rejects.toMatchObject({
      code: "EFBIG", syscall: "PROPFIND", path: "", message: expect.stringContaining("response exceeds entry limit"),
    });
    await expect(remote(xml, 2).readdir("/")).resolves.toEqual([{ name: "child", type: "file" }]);
  });

  it("retains the independent response-byte limit", async () => {
    const xml = multistatus(resource("/dav/", true));
    const bytes = new TextEncoder().encode(xml).byteLength;
    await expect(remote(xml, 1, bytes).stat("/")).resolves.toMatchObject({ type: "directory" });
    await expect(remote(xml, 1, bytes - 1).stat("/")).rejects.toMatchObject({ code: "EFBIG" });
  });

  it.each([false, null, 0, ""])("preserves caller cancellation before XML admission: %j", async reason => {
    const caller = new AbortController();
    const fs = new WebDavFileSystem({
      baseUrl: "https://example.invalid/dav/", maxEntries: 1,
      fetch: async () => {
        caller.abort(reason);
        return xmlResponse(multistatus(resource("/dav/", true), "<z:response><broken></z:response>"));
      },
    });
    await expect(fs.readdir("/", { signal: caller.signal })).rejects.toMatchObject({ code: "ECANCELED", cause: reason });
  });

  it("applies the same entry admission to UTF-16 XML", async () => {
    const xml = multistatus(resource("/dav/", true), "<z:response><broken></z:response>");
    const fs = new WebDavFileSystem({
      baseUrl: "https://example.invalid/dav/", maxEntries: 1,
      fetch: async () => new Response(Buffer.from(xml, "utf16le"), { status: 207 }),
    });
    await expect(fs.readdir("/")).rejects.toMatchObject({ code: "EFBIG" });
  });
});

describe("direct DAV response admission", () => {
  it("counts self-closing and ordinary direct responses before their descendants", () => {
    expect(() => parseXml('<multistatus xmlns="DAV:"><response/><response><broken></response></multistatus>', { maxResponses: 1 }))
      .toThrow(XmlResponseLimitError);
    expect(parseXml('<multistatus xmlns="DAV:"><response/><response/></multistatus>', { maxResponses: 2 }).children).toHaveLength(2);
    expect(parseXml('<multistatus xmlns="DAV:"><response/><response/></multistatus>').children).toHaveLength(2);
  });

  it("counts expanded DAV names, not foreign names, nested responses, or non-multistatus roots", () => {
    const xml = '<d:multistatus xmlns:d="DAV:" xmlns:f="urn:foreign">'
      + '<f:response/><d:wrapper><d:response/><d:response/></d:wrapper>'
      + '<response xmlns="DAV:"><d:response/></response></d:multistatus>';
    expect(parseXml(xml, { maxResponses: 1 }).children).toHaveLength(3);
    expect(parseXml('<r xmlns="DAV:"><response/><response/></r>', { maxResponses: 1 }).children).toHaveLength(2);
    expect(parseXml('<multistatus><response/><response/></multistatus>', { maxResponses: 1 }).children).toHaveLength(2);
    expect(() => parseXml('<d:multistatus xmlns:d="DAV:"><d:response/><x:response xmlns:x="DAV:"/></d:multistatus>', { maxResponses: 1 }))
      .toThrow(XmlResponseLimitError);
  });

  it.each([0, -1, 1.5, Infinity, NaN, Number.MAX_SAFE_INTEGER + 1])("rejects invalid response limit %s", maxResponses => {
    expect(() => parseXml("<root/>", { maxResponses })).toThrow(RangeError);
  });

  it("retains malformed XML errors before the excess response has been identified", () => {
    expect(() => parseXml('<multistatus xmlns="DAV:"><response><bad></response><response/></multistatus>', { maxResponses: 1 }))
      .toThrow("mismatched closing tag");
    expect(() => parseXml('<multistatus xmlns="DAV:"><response/><x:response/></multistatus>', { maxResponses: 1 }))
      .toThrow("unbound element prefix");
  });
});
