import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import * as office from "./index.js";

it("exposes caller-backed XML indexing without a presentation-engine dependency", async () => {
  const fs = new MemoryFileSystem(), encoder = new TextEncoder(), payload = "<&".repeat(50000);
  const source = (async function* () {
    yield encoder.encode('<root xmlns="urn:test"><item>');
    for (let index = 0; index < 50; index++) yield encoder.encode("&lt;&amp;".repeat(1000));
    yield encoder.encode("</item></root>");
  })();
  const document = await office.openRetainedXmlDocument(source, { workingStorage: { fs, directory: "/", cacheBytes: 16384 } });
  let actual = "";
  for await (const bytes of document.text(document.root)) { expect(bytes.length).toBeLessThanOrEqual(16384); actual += new TextDecoder().decode(bytes); }
  expect(actual).toBe(payload);
  await document.close(); expect(await fs.readdir("/")).toEqual([]);
});
