import { expect, it } from "vitest";
import { WebDavFileSystem } from "../src/fs/webdav/webdav.js";
import { MockDav, multistatus, resource, xmlResponse } from "./migration/fs/webdav/mock.js";

it.each(["/a".repeat(257), "/".repeat(65_537)])("admits directory paths beyond former ceilings (%#)", async path => {
  const fs = new WebDavFileSystem({
    baseUrl: "https://example.invalid/dav/",
    fetch: async url => xmlResponse(multistatus(resource(new URL(url).pathname, true))),
  });
  await expect(fs.stat(path)).resolves.toMatchObject({ type: "directory" });
  await expect(fs.access(path, 1)).resolves.toBeUndefined();
});

it.each(["/.".repeat(257) + "/file", "/".repeat(65_537) + "file"])("writes paths beyond former ceilings (%#)", async path => {
  const mock = new MockDav();
  const fs = new WebDavFileSystem({ baseUrl: "https://example.invalid/dav/", fetch: mock.fetch });
  const data = new Uint8Array([42]);
  await fs.writeFile(path, data);
  expect(mock.files.get("/file")).toEqual(data);
});

it.each(["stat", "access", "writeFile"] as const)("enforces explicit path limits before %s requests", async operation => {
  let requests = 0;
  const fs = new WebDavFileSystem({
    baseUrl: "https://example.invalid/dav/",
    fetch: async () => { requests++; return xmlResponse(multistatus()); },
  });
  for (const pathLimits of [{ maxPathComponents: 1 }, { maxPathBytes: 3 }]) {
    const options = { pathLimits };
    const result = operation === "stat" ? fs.stat("/a/b", options)
      : operation === "access" ? fs.access("/a/b", 1, options)
      : fs.writeFile("/a/b", new Uint8Array(), options);
    await expect(result).rejects.toMatchObject({ code: "ENAMETOOLONG" });
  }
  expect(requests).toBe(0);
});
