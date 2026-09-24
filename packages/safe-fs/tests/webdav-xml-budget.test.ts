import { afterEach, expect, it, vi } from "vitest";
import { WebDavFileSystem } from "../src/fs/webdav/webdav.js";
import { multistatus, resource, xmlResponse } from "./migration/fs/webdav/mock.js";

afterEach(() => vi.restoreAllMocks());

it.each([
  "<x/>".repeat(100_000),
  "<x>".repeat(256) + "</x>".repeat(256),
  "<!--x-->".repeat(100_000),
  "<![CDATA[]]>".repeat(100_000),
  "<?pi x?>".repeat(100_000),
])("bounds non-DAV XML structure independently of response count", async extra => {
  const fs = new WebDavFileSystem({
    baseUrl: "https://example.invalid/dav/", maxEntries: 1, maxXmlBytes: 2 * 1024 * 1024,
    fetch: async () => xmlResponse(multistatus(resource("/dav/", true), extra)),
  });
  await expect(fs.stat("/")).rejects.toMatchObject({ code: "EFBIG" });
});

it.each(["cancel", "timeout"])("honors %s while parsing XML", async mode => {
  const caller = new AbortController();
  const decode = TextDecoder.prototype.decode;
  vi.spyOn(TextDecoder.prototype, "decode").mockImplementation(function (...args) {
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
