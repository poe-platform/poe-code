import { expect, it } from "vitest";
import { Volume } from "memfs";
import { Presentation, createPresentation, createPptxCommandEngine } from "./index.js";
import { Slide } from "./slide-model.js";

const context = {
  limits: { maxBytes: 262144, maxReads: 1000, chunkBytes: 4096 },
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
  relationshipLimits: { maxBytes: 65536, maxParts: 64, maxRelationships: 64 },
  validationLimits: {
    maxBytes: 65536,
    maxNodes: 4000,
    maxDepth: 32,
    maxParts: 64,
    maxRelationships: 64,
    maxEntries: 64
  }
};
const decode = (bytes: Uint8Array) => new TextDecoder().decode(bytes);

it("exposes the owning slide part as a synchronous live package view", async () => {
  const deck = await Presentation(
    await createPresentation({ slides: [{ name: "Harbor" }] }, context),
    context
  );
  const slide = deck.slides[0]!;
  const part = slide.part;
  expect(part).toBeDefined();
  expect(part).not.toBeInstanceOf(Promise);
  expect(part).toBe(slide.part);
  expect(part.package).toBe(deck.part.package);
  expect(part).toBe(deck.part.package.get_part("/ppt/slides/slide1.xml"));
  expect(part.content_type).toBe(
    "application/vnd.openxmlformats-officedocument.presentationml.slide+xml"
  );
  const source = part.blob;
  expect(decode(source)).toContain("Harbor");
  source.fill(0);
  expect(decode(part.blob)).toContain("Harbor");
  slide.name = "Estuary";
  expect(decode(part.blob)).toContain("Estuary");
  expect(part.rels.some((relationship) => relationship.type.endsWith("/slideLayout"))).toBe(true);

  const volume = Volume.fromJSON({});
  volume.writeFileSync("/deck.pptx", await deck.save());
  const result = await createPptxCommandEngine({
    context,
    maxArgumentBytes: 8192,
    maxOutputBytes: 262144
  }).execute({
    args: ["xml", "get", "/deck.pptx", "--part", part.partname, "--scope", "slides", "--json"].map(
      (value) => new TextEncoder().encode(value)
    ),
    signal: new AbortController().signal,
    readInput: async (path) => new Uint8Array(volume.readFileSync(path) as Buffer),
    publishOutput: async () => {
      throw new Error("Read-only access must not publish.");
    }
  });
  expect(result.exitCode, decode(result.stdout) + decode(result.stderr)).toBe(0);
  expect(JSON.parse(decode(result.stdout))).toMatchObject({
    operation: "xml.get",
    affected: 0,
    data: { part: part.partname, xml: decode(part.blob) }
  });
  expect(
    (await Presentation(new Uint8Array(volume.readFileSync("/deck.pptx") as Buffer), context))
      .slides[0]!.part.partname
  ).toBe(part.partname);
});

it("rejects a detached slide part lookup instead of exposing an absent owner", async () => {
  const deck = await Presentation(
    await createPresentation({ slides: [{ name: "Cove" }] }, context),
    context
  );
  const xml = deck.slides[0]!.element;
  const detached = new Slide(257, { read: () => ({ root: xml }) as never, write: () => {} });
  expect(() => detached.part).toThrowError(
    expect.objectContaining({ code: "property-unavailable" })
  );
});
