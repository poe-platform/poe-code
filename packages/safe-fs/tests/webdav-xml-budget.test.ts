import { afterEach, expect, it, vi } from "vitest";
import { WebDavFileSystem } from "../src/fs/webdav/webdav.js";
import * as xml from "../src/fs/webdav/xml.js";
import { multistatus, resource, xmlResponse } from "./migration/fs/webdav/mock.js";

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

it.each([
  "<x/>".repeat(1024),
  "<x>".repeat(256) + "</x>".repeat(256),
  "<!--x-->".repeat(1024),
  "<![CDATA[]]>".repeat(1024),
  "<?pi x?>".repeat(1024),
])("bounds non-DAV XML structure independently of response count", async extra => {
  const parser = vi.spyOn(xml, "parseXmlSteps");
  const fs = new WebDavFileSystem({
    baseUrl: "https://example.invalid/dav/", maxEntries: 1, maxXmlBytes: 2 * 1024 * 1024,
    xmlLimits: { maxNodes: 512, maxContentNodes: 512, maxDepth: 256, maxAttributes: 512 },
    fetch: async () => xmlResponse(multistatus(resource("/dav/", true), extra)),
  });
  await expect(fs.stat("/")).rejects.toMatchObject({ code: "EFBIG" });
  expect(parser).toHaveBeenCalledWith(expect.any(String), expect.objectContaining({
    maxNodes: 512, maxContentNodes: 512, maxDepth: 256,
  }));
});

it.each(["cancel", "timeout"])("honors %s while parsing XML", async mode => {
  const caller = new AbortController();
  const decode = TextDecoder.prototype.decode;
  vi.spyOn(TextDecoder.prototype, "decode").mockImplementation(function (this: TextDecoder, ...args) {
    const result = decode.apply(this, args);
    if (mode === "cancel") setTimeout(() => caller.abort("during parsing"), 0);
    else queueMicrotask(() => vi.advanceTimersByTime(10));
    return result;
  });
  if (mode === "timeout") vi.useFakeTimers();
  try {
    const fs = new WebDavFileSystem({
      baseUrl: "https://example.invalid/dav/", timeoutMs: 10,
      fetch: async () => xmlResponse(multistatus(resource("/dav/", true), "<x/>".repeat(10_000))),
    });
    await expect(fs.stat("/", { signal: caller.signal })).rejects.toMatchObject({
      code: mode === "cancel" ? "ECANCELED" : "ETIMEDOUT",
    });
  } finally { vi.useRealTimers(); }
});

it("accepts deeply nested metadata with no default XML structure limits", async () => {
  const fs = new WebDavFileSystem({
    baseUrl: "https://example.invalid/dav/",
    fetch: async () => xmlResponse(multistatus(resource("/dav/", true), "<x>".repeat(300) + "</x>".repeat(300))),
  });
  await expect(fs.stat("/")).resolves.toMatchObject({ type: "directory" });
});

it("passes unlimited XML text and structure budgets by default", async () => {
  const parser = vi.spyOn(xml, "parseXmlSteps");
  const fs = new WebDavFileSystem({ baseUrl: "https://example.invalid/dav/",
    fetch: async () => xmlResponse(multistatus(resource("/dav/", true))) });
  await fs.stat("/");
  expect(parser).toHaveBeenCalledWith(expect.any(String), { maxTextLength: Infinity });
});

it("accepts more than 100000 XML nodes by default", async () => {
  const body = multistatus(resource("/dav/", true), "<x/>".repeat(100_001));
  const fs = new WebDavFileSystem({ baseUrl: "https://example.invalid/dav/",
    fetch: async () => xmlResponse(body) });
  await expect(fs.readdir("/")).resolves.toEqual([]);
});

it("enforces an explicitly configured XML attribute limit", async () => {
  const fs = new WebDavFileSystem({ baseUrl: "https://example.invalid/dav/", xmlLimits: { maxAttributes: 1 },
    fetch: async () => xmlResponse(multistatus(resource("/dav/", true), '<x a="1" b="2"/>')) });
  await expect(fs.stat("/")).rejects.toMatchObject({ code: "EFBIG" });
});

it("accepts metadata bytes above the former default ceiling", async () => {
  const fs = new WebDavFileSystem({ baseUrl: "https://example.invalid/dav/",
    fetch: async () => xmlResponse(multistatus(resource("/dav/", true), "<x>" + "a".repeat(1024 * 1024) + "</x>")) });
  await expect(fs.stat("/")).resolves.toMatchObject({ type: "directory" });
});
