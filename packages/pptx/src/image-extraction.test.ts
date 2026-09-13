import { createHash } from "node:crypto";
import { Volume } from "memfs";
import { afterAll, beforeAll, expect, it, vi } from "vitest";
beforeAll(() => {
  const timer = globalThis.setTimeout;
  vi.spyOn(globalThis, "setTimeout").mockImplementation(((callback: () => void, delay?: number) =>
    delay === 0 ? setImmediate(callback) : timer(callback, delay)) as typeof setTimeout);
});
afterAll(() => vi.restoreAllMocks());
import { storedArchive } from "../tests/fixtures/archive.js";
import { extractImages, readSelectionIndex } from "./index.js";

const p = "http://schemas.openxmlformats.org/presentationml/2006/main";
const a = "http://schemas.openxmlformats.org/drawingml/2006/main";
const r = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";
const context = {
  limits: { maxBytes: 262144, maxReads: 100, chunkBytes: 4096 },
  archiveLimits: {
    maxArchiveBytes: 262144,
    maxEntryBytes: 65536,
    maxTotalBytes: 262144,
    maxMembers: 64,
    maxPathBytes: 256,
    maxDepth: 16,
    maxPaxBytes: 1024,
    maxTextBytes: 65536,
    chunkSize: 4096
  },
  xmlLimits: { maxBytes: 65536, maxNodes: 4000, maxDepth: 32 },
  relationshipLimits: { maxBytes: 65536, maxParts: 64, maxRelationships: 64 }
};
const art = new TextEncoder().encode(
  '<svg xmlns="http://www.w3.org/2000/svg"><script>throw 17</script></svg>'
);
const limits = { maxOutputBytes: 65536, maxOutputs: 64 };
function fixture(type = "image/svg+xml", external = false) {
  const entries: { name: string; bytes: Uint8Array }[] = [];
  const xml = (name: string, value: string) =>
    entries.push({ name, bytes: new TextEncoder().encode(value) });
  const rels = (name: string, rows: [string, string, string, boolean?][]) =>
    xml(
      name,
      `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${rows.map(([id, kind, target, remote]) => `<Relationship Id="${id}" Type="${r}/${kind}" Target="${target}"${remote ? ' TargetMode="External"' : ""}/>`).join("")}</Relationships>`
    );
  const pic = (id: number, ref: string) =>
    `<p:pic><p:nvPicPr><p:cNvPr id="${id}" name="../../escape.svg"/></p:nvPicPr><p:blipFill><a:blip r:${external ? "link" : "embed"}="${ref}"/><a:srcRect l="12000"/></p:blipFill><p:spPr/></p:pic>`;
  const drawing = (tag: string, body: string) =>
    `<p:${tag} xmlns:p="${p}" xmlns:a="${a}" xmlns:r="${r}"><p:cSld><p:spTree>${body}</p:spTree></p:cSld></p:${tag}>`;
  xml(
    "[Content_Types].xml",
    `<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="xml" ContentType="application/xml"/><Default Extension="dat" ContentType="${type}"/></Types>`
  );
  rels("_rels/.rels", [["main", "officeDocument", "deck.xml"]]);
  xml(
    "deck.xml",
    `<p:presentation xmlns:p="${p}" xmlns:r="${r}"><p:sldIdLst><p:sldId id="256" r:id="s1"/></p:sldIdLst></p:presentation>`
  );
  rels("_rels/deck.xml.rels", [["s1", "slide", "slide.xml"]]);
  xml("slide.xml", drawing("sld", pic(2, "first") + pic(3, "first") + pic(4, "copy")));
  rels("_rels/slide.xml.rels", [
    ["first", "image", external ? "https://example.invalid/a" : "private-name.dat", external],
    ["copy", "image", "duplicate.dat"],
    ["layout", "slideLayout", "layout.xml"],
    ["notes", "notesSlide", "notes.xml"]
  ]);
  for (const [owner, tag] of [
    ["notes", "notes"],
    ["layout", "sldLayout"]
  ]) {
    xml(`${owner}.xml`, drawing(tag!, pic(2, "first")));
    rels(`_rels/${owner}.xml.rels`, [
      ["first", "image", external ? "https://example.invalid/a" : "private-name.dat", external]
    ]);
  }
  entries.push({ name: "private-name.dat", bytes: art }, { name: "duplicate.dat", bytes: art });
  const fs = Volume.fromJSON({});
  fs.writeFileSync("/input.pptx", storedArchive(entries));
  return new Uint8Array(fs.readFileSync("/input.pptx") as Buffer);
}
it("extracts every selected occurrence with original bytes and independently calculated hashes", async () => {
  const input = fixture();
  const before = input.slice();
  const result = await extractImages(input, limits, context);
  expect(result.map((x) => x.name)).toEqual([
    "part-000001.svg",
    "part-000002.svg",
    "part-000003.svg"
  ]);
  expect(result.map((x) => x.sourceParts)).toEqual([
    ["/private-name.dat"],
    ["/private-name.dat"],
    ["/duplicate.dat"]
  ]);
  for (const item of result) {
    expect(item.bytes).toEqual(art);
    expect(item.sha256).toBe(createHash("sha256").update(art).digest("hex"));
    expect(item.occurrences).toHaveLength(1);
  }
  result[0]!.bytes.fill(0);
  expect(result[1]!.bytes).toEqual(art);
  expect(input).toEqual(before);
});
it("groups identical bytes only explicitly and retains all selected provenance", async () => {
  const result = await extractImages(
    fixture(),
    { ...limits, unique: true, scope: "shared" },
    context
  );
  expect(result).toHaveLength(1);
  expect(result[0]!.sourceParts).toEqual(["/private-name.dat", "/duplicate.dat"]);
  expect(result[0]!.occurrences.map((x) => x.scope)).toEqual([
    "slides",
    "slides",
    "slides",
    "layouts",
    "notes"
  ]);
});
it.each(["notes", "layouts"] as const)("extracts images from explicit %s owners", async (scope) => {
  const result = await extractImages(fixture(), { ...limits, scope, slide: 1 }, context);
  expect(result).toHaveLength(1);
  expect(result[0]!.occurrences[0]!.scope).toBe(scope);
  expect(result[0]!.bytes).toEqual(art);
});
it("uses scoped positions and selection tokens without deduplicating unrelated occurrences", async () => {
  const input = fixture();
  const index = await readSelectionIndex(input, context);
  const picked = await extractImages(input, { ...limits, slide: 1, image: 2 }, context);
  expect(picked.map((x) => x.occurrences[0]!.shapeId)).toEqual(["3"]);
  const token = index.objects.find((x) => x.part === "/slide.xml" && x.id === "3")!.token;
  expect((await extractImages(input, { ...limits, select: token }, context))[0]!.bytes).toEqual(
    art
  );
});
it.each([
  [art.length * 3 - 1, 3],
  [art.length * 3, 2]
])(
  "enforces cumulative bytes and output counts before returning data (%s, %s)",
  async (maxOutputBytes, maxOutputs) => {
    await expect(
      extractImages(fixture(), { maxOutputBytes, maxOutputs }, context)
    ).rejects.toMatchObject({ code: "resource-limit" });
  }
);
it("accepts exact limits and counts unique resources only when requested", async () => {
  expect(
    await extractImages(fixture(), { maxOutputBytes: art.length * 3, maxOutputs: 3 }, context)
  ).toHaveLength(3);
  expect(
    await extractImages(
      fixture(),
      { maxOutputBytes: art.length, maxOutputs: 1, unique: true },
      context
    )
  ).toHaveLength(1);
});
it("uses bin for unknown content types and never uses embedded names", async () => {
  expect(
    (await extractImages(fixture("application/x-opaque"), limits, context)).map((x) => x.name)
  ).toEqual(["part-000001.bin", "part-000002.bin", "part-000003.bin"]);
});
it("rejects selected external images without fetching or silently dropping them", async () => {
  await expect(extractImages(fixture(undefined, true), limits, context)).rejects.toMatchObject({
    code: "unsupported-edit"
  });
});
it.each([0, -1, 1.5, Infinity])("rejects invalid extraction budgets %s", async (maxOutputs) => {
  await expect(extractImages(fixture(), { ...limits, maxOutputs }, context)).rejects.toMatchObject({
    code: "invalid-value"
  });
});
it("honors cancellation and rejects bare host paths", async () => {
  const controller = new AbortController();
  controller.abort();
  await expect(
    extractImages(fixture(), limits, { ...context, signal: controller.signal })
  ).rejects.toBeDefined();
  await expect(extractImages("/host.pptx" as never, limits, context)).rejects.toBeDefined();
});

it.each([
  ["image/bmp", "bmp"],
  ["image/gif", "gif"],
  ["image/jpeg", "jpg"],
  ["image/png", "png"],
  ["image/tiff", "tiff"],
  ["image/x-wmf", "wmf"],
  ["image/x-emf", "emf"],
  ["image/vnd.ms-photo", "wdp"],
  ["image/jpg", "bin"]
])("preserves exact opaque %s bytes with admitted extension %s", async (contentType, extension) => {
  const [output] = await extractImages(fixture(contentType), { ...limits, unique: true }, context);
  expect(output!.name).toBe(`part-000001.${extension}`);
  expect(output!.bytes).toEqual(art);
  expect(output!.contentType).toBe(contentType);
  expect(output!.sha256).toBe(createHash("sha256").update(art).digest("hex"));
});
it("selects exact content hashes within the chosen owner scope", async () => {
  const sha256 = createHash("sha256").update(art).digest("hex");
  expect(await extractImages(fixture(), { ...limits, sha256 }, context)).toHaveLength(3);
  expect(
    await extractImages(fixture(), { ...limits, sha256, unique: true, scope: "notes" }, context)
  ).toHaveLength(1);
  await expect(
    extractImages(fixture(), { ...limits, sha256: "0".repeat(64) }, context)
  ).rejects.toMatchObject({ code: "missing-selection" });
});
it.each(["", "a".repeat(63), "A".repeat(64), "g".repeat(64)])(
  "rejects malformed exact hash selectors %s",
  async (sha256) => {
    await expect(extractImages(fixture(), { ...limits, sha256 }, context)).rejects.toMatchObject({
      code: "invalid-value"
    });
  }
);
it.each([
  { unknown: true },
  { slide: 0 },
  { image: 1.5 },
  { scope: "unknown" },
  { unique: "true" },
  { select: "" },
  { select: "token", slide: 1 }
])("rejects invalid extraction selection before consuming explicit input %j", async (selection) => {
  let reads = 0;
  const source = {
    read: async () => {
      reads++;
      return null;
    }
  };
  await expect(
    extractImages(source, { ...limits, ...selection } as never, context)
  ).rejects.toBeDefined();
  expect(reads).toBe(0);
});
