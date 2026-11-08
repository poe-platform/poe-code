import { afterAll, beforeAll, expect, it, vi } from "vitest";
import { Volume } from "memfs";
import { SaxesParser } from "saxes";
import { createHash } from "node:crypto";
import { addImage, createPresentation, readImages } from "./index.js";
import { inspectZip } from "../tests/zip-reader.js";
const context = {
  limits: { maxBytes: 1000000, maxReads: 1000, chunkBytes: 4096 },
  archiveLimits: {
    maxArchiveBytes: 1000000,
    maxEntryBytes: 100000,
    maxTotalBytes: 1000000,
    maxMembers: 100,
    maxPathBytes: 256,
    maxDepth: 16,
    maxPaxBytes: 1024,
    maxTextBytes: 100000,
    chunkSize: 4096
  },
  xmlLimits: { maxBytes: 100000, maxNodes: 10000, maxDepth: 40 },
  relationshipLimits: { maxBytes: 100000, maxParts: 100, maxRelationships: 200 }
};
beforeAll(() => {
  const timer = globalThis.setTimeout;
  vi.spyOn(globalThis, "setTimeout").mockImplementation(((callback: () => void, delay?: number) =>
    delay === 0 ? setImmediate(callback) : timer(callback, delay)) as typeof setTimeout);
});
afterAll(() => vi.restoreAllMocks());
const tile = new Uint8Array([
  71, 73, 70, 56, 57, 97, 4, 0, 2, 0, 128, 0, 0, 0, 0, 0, 20, 90, 160, 33, 249, 4, 1, 0, 0, 0, 0,
  44, 0, 0, 0, 0, 1, 0, 1, 0, 0, 2, 2, 68, 1, 0, 59
]);
it("sizes admitted JPEG density ties to even and retains the original media hash", async () => {
  const bytes = new Uint8Array([
    255, 216, 255, 224, 0, 16, 74, 70, 73, 70, 0, 1, 2, 2, 0, 75, 0, 25, 0, 0, 255, 192, 0, 11, 8,
    0, 64, 0, 190, 1, 1, 17, 0, 255, 218, 0, 8, 1, 1, 0, 0, 63, 0, 19, 255, 0, 20, 255, 217
  ]);
  const hash = createHash("sha256").update(bytes).digest("hex");
  const input = await createPresentation({ slides: [{}] }, context);
  const output = await addImage(input, { slide: 1, bytes, contentType: "image/jpeg" }, context);
  const entries = parts(output);
  expect(attrs(entries.get("ppt/slides/slide1.xml")!, "ext").at(-1)).toEqual({
    cx: "914400",
    cy: "914400"
  });
  expect(createHash("sha256").update(entries.get("ppt/media/image1.jpg")!).digest("hex")).toBe(
    hash
  );
  expect((await readImages(output, {}, context)).media[0]).toMatchObject({
    dpiX: 190,
    dpiY: 64,
    pixelWidth: 190,
    pixelHeight: 64,
    sha256: hash
  });
});
function parts(bytes: Uint8Array) {
  const vfs = Volume.fromJSON({});
  vfs.writeFileSync("/result.pptx", bytes);
  return new Map(
    inspectZip(new Uint8Array(vfs.readFileSync("/result.pptx") as Buffer)).map((x) => [
      x.name,
      x.payload
    ])
  );
}
function attrs(bytes: Uint8Array, local: string) {
  const result: Record<string, string>[] = [];
  const parser = new SaxesParser({ xmlns: true });
  parser.on("opentag", (tag) => {
    if (tag.local === local)
      result.push(
        Object.fromEntries(
          Object.values(tag.attributes)
            .filter((a) => a.uri !== "http://www.w3.org/2000/xmlns/")
            .map((a) => [a.name, a.value])
        )
      );
  });
  parser.write(new TextDecoder().decode(bytes)).close();
  return result;
}
it.each([
  [{}, [0, 0, 50800, 25400], [0, 0, 0, 0]],
  [{ width: 100 }, [0, 0, 100, 50], [0, 0, 0, 0]],
  [{ height: 100 }, [0, 0, 200, 100], [0, 0, 0, 0]],
  [{ width: 103, height: 77 }, [0, 0, 103, 77], [0, 0, 0, 0]],
  [{ width: 3 }, [0, 0, 3, 2], [0, 0, 0, 0]],
  [{ width: 6, height: 8, top: -3, fit: "contain" as const }, [0, -1, 6, 3], [0, 0, 0, 0]],
  [{ width: 8, height: 3, left: -2, fit: "contain" as const }, [-1, 0, 6, 3], [0, 0, 0, 0]],
  [{ width: 8, height: 2, fit: "contain" as const }, [2, 0, 4, 2], [0, 0, 0, 0]],
  [{ width: 8, height: 2, fit: "cover" as const }, [0, 0, 8, 2], [0, 25000, 0, 25000]],
  [{ width: 8, height: 4, fit: "cover" as const }, [0, 0, 8, 4], [0, 0, 0, 0]],
  [{ width: 2, height: 99999, fit: "cover" as const }, [0, 0, 2, 99999], [49999, 0, 49999, 0]],
  [{ width: 100, height: 100, fit: "contain" as const }, [0, 25, 100, 50], [0, 0, 0, 0]],
  [{ width: 100, height: 100, fit: "cover" as const }, [0, 0, 100, 100], [25000, 0, 25000, 0]],
  [{ width: 100, height: 100, fit: "stretch" as const }, [0, 0, 100, 100], [0, 0, 0, 0]]
])("inserts byte-preserving media with explicit geometry %j", async (sizing, geometry, crop) => {
  const input = await createPresentation({ slides: [{ name: "Coast" }] }, context);
  const output = await addImage(
    input,
    { slide: 1, bytes: tile, contentType: "image/gif", altText: "Sea & sky", ...sizing },
    context
  );
  const entries = parts(output);
  expect(entries.get("ppt/media/image1.gif")).toEqual(tile);
  const slide = entries.get("ppt/slides/slide1.xml")!;
  expect(attrs(slide, "off").at(-1)).toEqual({ x: String(geometry[0]), y: String(geometry[1]) });
  expect(attrs(slide, "ext").at(-1)).toEqual({ cx: String(geometry[2]), cy: String(geometry[3]) });
  expect(attrs(slide, "srcRect")).toEqual([
    { l: String(crop[0]), t: String(crop[1]), r: String(crop[2]), b: String(crop[3]) }
  ]);
  expect(attrs(slide, "cNvPr").at(-1)).toMatchObject({ descr: "Sea & sky" });
  expect(attrs(entries.get("ppt/slides/_rels/slide1.xml.rels")!, "Relationship")).toContainEqual({
    Id: "rId2",
    Type: "http://schemas.openxmlformats.org/officeDocument/2006/relationships/image",
    Target: "../media/image1.gif"
  });
  expect(attrs(entries.get("[Content_Types].xml")!, "Override")).toContainEqual({
    PartName: "/ppt/media/image1.gif",
    ContentType: "image/gif"
  });
  for (const [name, bytes] of parts(input))
    if (
      ![
        "ppt/slides/slide1.xml",
        "ppt/slides/_rels/slide1.xml.rels",
        "[Content_Types].xml"
      ].includes(name)
    )
      expect(entries.get(name)).toEqual(bytes);
  expect((await readImages(output, {}, context)).occurrences).toHaveLength(1);
});
it.each([
  [2, 4, "25000"],
  [4, 6, "16667"]
])("covers a square with portrait pixels %i by %i", async (pixelWidth, pixelHeight, crop) => {
  const bytes = new Uint8Array(tile);
  bytes[6] = pixelWidth;
  bytes[8] = pixelHeight;
  const input = await createPresentation({ slides: [{}] }, context);
  const output = await addImage(
    input,
    { slide: 1, bytes, contentType: "image/gif", width: 120, height: 120, fit: "cover" },
    context
  );
  const entries = parts(output);
  const slide = entries.get("ppt/slides/slide1.xml")!;
  expect(entries.get("ppt/media/image1.gif")).toEqual(bytes);
  expect(attrs(slide, "off").at(-1)).toEqual({ x: "0", y: "0" });
  expect(attrs(slide, "ext").at(-1)).toEqual({ cx: "120", cy: "120" });
  expect(attrs(slide, "srcRect")).toEqual([{ l: "0", t: crop, r: "0", b: crop }]);
});
it("allocates independent picture, relationship and media identities", async () => {
  const input = await createPresentation({ slides: [{}] }, context);
  const options = { slide: 1, bytes: tile, contentType: "image/gif" };
  const output = await addImage(await addImage(input, options, context), options, context);
  const entries = parts(output);
  expect(entries.get("ppt/media/image1.gif")).toEqual(tile);
  expect(entries.get("ppt/media/image2.gif")).toEqual(tile);
  expect(attrs(entries.get("ppt/slides/slide1.xml")!, "cNvPr").map((x) => x.id)).toEqual([
    "1",
    "2",
    "3"
  ]);
  expect(attrs(entries.get("ppt/slides/slide1.xml")!, "blip").map((x) => x["r:embed"])).toEqual([
    "rId2",
    "rId3"
  ]);
});
it.each([
  { width: 0 },
  { height: 0 },
  { width: 0, height: 100, fit: "stretch" },
  { height: -1 },
  { width: NaN },
  { width: 1e30 },
  { left: Infinity },
  { slide: 0 },
  { fit: "bad" },
  { fit: "cover" },
  { width: 100, fit: "cover" },
  { height: 100, fit: "stretch" },
  { bytes: new Uint8Array([1, 2]) },
  { contentType: "image/png" },
  { extra: true }
])("rejects invalid admission or ambiguous sizing %j", async (patch) => {
  const input = await createPresentation({ slides: [{}] }, context);
  await expect(
    addImage(
      input,
      { slide: 1, bytes: tile, contentType: "image/gif", ...patch } as Parameters<
        typeof addImage
      >[1],
      context
    )
  ).rejects.toBeDefined();
});
it("owns supplied image bytes before asynchronous package acquisition", async () => {
  const input = await createPresentation({ slides: [{}] }, context);
  const bytes = new Uint8Array(tile);
  const promise = addImage(input, { slide: 1, bytes, contentType: "image/gif" }, context);
  bytes.fill(0);
  expect(parts(await promise).get("ppt/media/image1.gif")).toEqual(tile);
});
it("rejects derived dimensions that round to zero EMUs", async () => {
  const input = await createPresentation({ slides: [{}] }, context);
  const bytes = new Uint8Array(tile);
  bytes[6] = 6;
  for (const sizing of [{ width: 1 }, { width: 1, height: 7, fit: "contain" as const }])
    await expect(
      addImage(input, { slide: 1, bytes, contentType: "image/gif", ...sizing }, context)
    ).rejects.toMatchObject({ code: "invalid-value" });
});
it("uses an explicit box with default stretch for a supported container without dimensions", async () => {
  const input = await createPresentation({ slides: [{}] }, context);
  const bytes = new Uint8Array([255, 216, 255, 217]);
  const base = { slide: 1, bytes, contentType: "image/jpeg" };
  await expect(addImage(input, base, context)).rejects.toMatchObject({ code: "invalid-value" });
  await expect(
    addImage(input, { ...base, width: 300, height: 200, fit: "contain" }, context)
  ).rejects.toMatchObject({ code: "invalid-value" });
  const output = await addImage(
    input,
    { ...base, width: 300, height: 200, fit: "stretch" },
    context
  );
  expect(parts(output).get("ppt/media/image1.jpg")).toEqual(bytes);
  const defaultOutput = await addImage(input, { ...base, width: 301, height: 203 }, context);
  expect(attrs(parts(defaultOutput).get("ppt/slides/slide1.xml")!, "ext").at(-1)).toEqual({
    cx: "301",
    cy: "203"
  });
});
it.each([
  { width: 1, height: 1000000 },
  { width: 1000000, height: 1 },
  { width: 2, height: 100001 }
])("rejects cover crops that round to an empty source rectangle %j", async (box) => {
  const input = await createPresentation({ slides: [{}] }, context);
  await expect(
    addImage(
      input,
      { slide: 1, bytes: tile, contentType: "image/gif", ...box, fit: "cover" },
      context
    )
  ).rejects.toMatchObject({ code: "invalid-value" });
});
it("snapshots image options before asynchronous reads", async () => {
  const input = await createPresentation({ slides: [{}] }, context);
  const options = { slide: 1, bytes: tile, contentType: "image/gif", altText: "Coast" };
  const pending = addImage(input, options, context);
  options.contentType = "application/octet-stream";
  options.altText = "Changed";
  const entries = parts(await pending);
  expect(attrs(entries.get("[Content_Types].xml")!, "Override").at(-1)).toMatchObject({
    ContentType: "image/gif"
  });
  expect(attrs(entries.get("ppt/slides/slide1.xml")!, "cNvPr").at(-1)).toMatchObject({
    descr: "Coast"
  });
});
it("honors host image byte ceilings before publication", async () => {
  const input = await createPresentation({ slides: [{}] }, context);
  await expect(
    addImage(
      input,
      { slide: 1, bytes: tile, contentType: "image/gif" },
      { ...context, archiveLimits: { ...context.archiveLimits, maxEntryBytes: 20 } }
    )
  ).rejects.toMatchObject({ code: "resource-limit" });
});
it("retains an original RGBA PNG compressed payload and transparent pixel", async () => {
  const { crc32, deflateSync, inflateSync } = await import("node:zlib");
  const chunk = (name: string, payload: Uint8Array) => {
    const data = Buffer.concat([Buffer.from(name), payload]);
    const prefix = Buffer.alloc(4),
      suffix = Buffer.alloc(4);
    prefix.writeUInt32BE(payload.length);
    suffix.writeUInt32BE(crc32(data));
    return Buffer.concat([prefix, data, suffix]);
  };
  const header = Buffer.alloc(13);
  header.writeUInt32BE(2);
  header.writeUInt32BE(1, 4);
  header[8] = 8;
  header[9] = 6;
  const pixels = new Uint8Array([0, 12, 34, 56, 0, 78, 90, 123, 255]);
  const compressed = deflateSync(pixels);
  const bytes = new Uint8Array(
    Buffer.concat([
      Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
      chunk("IHDR", header),
      chunk("IDAT", compressed),
      chunk("IEND", new Uint8Array())
    ])
  );
  const input = await createPresentation({ slides: [{}] }, context);
  const output = await addImage(input, { slide: 1, bytes, contentType: "image/png" }, context);
  const stored = parts(output).get("ppt/media/image1.png")!;
  expect(stored).toEqual(bytes);
  expect(new Uint8Array(inflateSync(stored.subarray(41, 41 + compressed.length)))).toEqual(pixels);
  expect(attrs(parts(output).get("ppt/slides/slide1.xml")!, "ext").at(-1)).toEqual({
    cx: "25400",
    cy: "12700"
  });
});
it("uses JPEG frame dimensions without altering compressed bytes", async () => {
  const bytes = new Uint8Array([
    255, 216, 255, 192, 0, 11, 8, 0, 3, 0, 6, 1, 1, 17, 0, 255, 218, 0, 8, 1, 1, 0, 0, 63, 0, 19,
    255, 0, 24, 255, 217
  ]);
  const input = await createPresentation({ slides: [{}] }, context);
  const output = await addImage(
    input,
    { slide: 1, bytes, contentType: "image/jpeg", height: 100 },
    context
  );
  expect(parts(output).get("ppt/media/image1.jpg")).toEqual(bytes);
  expect(attrs(parts(output).get("ppt/slides/slide1.xml")!, "ext").at(-1)).toEqual({
    cx: "200",
    cy: "100"
  });
});
